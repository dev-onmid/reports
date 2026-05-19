import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const BASE = 'https://api.z-api.io/instances';

function normalizeGroupId(raw: string): string {
  return raw.replace(/-group$/i, '').replace(/@g\.us$/, '');
}

async function tryFetch(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  const text = await res.text().catch(() => '');
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body, text };
}

function extractMembers(body: unknown): Array<Record<string, unknown>> | null {
  if (Array.isArray(body) && body.length > 0) return body as Array<Record<string, unknown>>;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    for (const key of ['participants', 'value', 'members', 'data']) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0)
        return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return null;
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

    const base = `${BASE}/${instance_id}/token/${token}`;
    const stripped = normalizeGroupId(groupId);
    const withSuffix = `${stripped}@g.us`;

    // Try all combinations of endpoint param name × groupId format
    const attempts = [
      `${base}/group-members?phone=${encodeURIComponent(withSuffix)}`,
      `${base}/group-members?phone=${encodeURIComponent(stripped)}`,
      `${base}/group-members?phone=${encodeURIComponent(groupId)}`,
      `${base}/group-members?groupId=${encodeURIComponent(withSuffix)}`,
      `${base}/group-members?groupId=${encodeURIComponent(stripped)}`,
      `${base}/group-members?groupId=${encodeURIComponent(groupId)}`,
    ];

    const logs: string[] = [];

    for (const url of attempts) {
      const { ok, status, body, text } = await tryFetch(url, headers);
      const members = extractMembers(body);
      logs.push(`[${status}] ${url.split('?')[1]} → ${text.slice(0, 60)}`);

      if (ok && members) {
        const result = members.map((m) => ({
          phone: String(m.phone ?? m.id ?? m.jid ?? '')
            .replace('@s.whatsapp.net', '')
            .replace('@c.us', '')
            .replace(/@g\.us$/, '')
            .replace(/\D/g, ''),
          name: String(m.name ?? m.pushname ?? m.notify ?? ''),
          admin: m.admin === true || m.isSuperAdmin === true || m.isAdmin === true,
        })).filter((m) => m.phone.length >= 8);

        if (result.length > 0) return Response.json(result);
      }
    }

    return Response.json({
      error: `Nenhum membro encontrado. Tentativas:\n${logs.join('\n')}`,
    }, { status: 502 });
  } finally {
    await pool.end();
  }
}
