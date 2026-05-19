import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const BASE = 'https://api.z-api.io/instances';

function normalizeGroupId(groupId: string): string {
  // Remove -group suffix and @g.us, then rebuild the canonical Z-API format
  // Z-API accepts: "120363427351645831-group" or "5511999999999-1234567890@g.us"
  // The chats endpoint returns phones with -group suffix — strip it to get the raw ID
  return groupId
    .replace('@g.us', '')
    .replace(/-group$/i, '');
}

async function fetchMembers(
  instanceId: string,
  token: string,
  headers: Record<string, string>,
  groupId: string,
): Promise<{ ok: boolean; members?: Array<Record<string, unknown>>; error?: string }> {
  const res = await fetch(
    `${BASE}/${instanceId}/token/${token}/group-members?groupId=${encodeURIComponent(groupId)}`,
    { headers },
  );

  const text = await res.text().catch(() => '');

  if (!res.ok) {
    return { ok: false, error: `Z-API ${res.status}: ${text.slice(0, 200)}` };
  }

  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: `Resposta inválida: ${text.slice(0, 80)}` }; }

  let members: Array<Record<string, unknown>> = [];
  if (Array.isArray(raw)) {
    members = raw as Array<Record<string, unknown>>;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.participants)) members = obj.participants as Array<Record<string, unknown>>;
    else if (Array.isArray(obj.value)) members = obj.value as Array<Record<string, unknown>>;
    else if (Array.isArray(obj.members)) members = obj.members as Array<Record<string, unknown>>;
  }

  return { ok: true, members };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const groupId = searchParams.get('groupId');

  if (!clientId || !groupId) {
    return Response.json({ error: 'clientId e groupId são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT instance_id, token, security_token FROM public.zapi_clients WHERE id = $1`,
      [clientId],
    );
    if (rows.length === 0) return Response.json({ error: 'Instância não encontrada' }, { status: 404 });

    const { instance_id, token, security_token } = rows[0] as {
      instance_id: string; token: string; security_token: string | null;
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (security_token) headers['Client-Token'] = security_token;

    // Try multiple groupId formats — Z-API can be inconsistent
    const candidates = [
      groupId,                              // as-is from chats
      normalizeGroupId(groupId),            // stripped
      `${normalizeGroupId(groupId)}@g.us`,  // with @g.us
    ].filter((v, i, arr) => arr.indexOf(v) === i); // deduplicate

    let lastError = '';
    for (const candidate of candidates) {
      const result = await fetchMembers(instance_id, token, headers, candidate);
      if (result.ok && result.members && result.members.length > 0) {
        const normalized = result.members.map((m) => ({
          phone: String(m.phone ?? m.id ?? '')
            .replace('@s.whatsapp.net', '')
            .replace('@c.us', '')
            .replace(/@g\.us$/, '')
            .replace(/\D/g, ''),
          name: String(m.name ?? m.pushname ?? m.phone ?? ''),
          admin: m.admin === true || m.isSuperAdmin === true || m.isAdmin === true,
        })).filter((m) => m.phone.length >= 8);
        return Response.json(normalized);
      }
      if (result.error) lastError = result.error;
      // If ok but empty, keep trying other formats
    }

    return Response.json({ error: lastError || 'Nenhum membro encontrado' }, { status: 502 });
  } finally {
    await pool.end();
  }
}
