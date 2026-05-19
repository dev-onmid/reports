import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const BASE = 'https://api.z-api.io/instances';

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

    const res = await fetch(
      `${BASE}/${instance_id}/token/${token}/group-members?groupId=${encodeURIComponent(groupId)}`,
      { headers },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return Response.json({ error: `Z-API error ${res.status}: ${text}` }, { status: 502 });
    }

    const raw = await res.json() as unknown;

    // Normalize: Z-API may return array or { participants: [...] } or { value: [...] }
    let members: Array<Record<string, unknown>> = [];
    if (Array.isArray(raw)) {
      members = raw as Array<Record<string, unknown>>;
    } else if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.participants)) members = obj.participants as Array<Record<string, unknown>>;
      else if (Array.isArray(obj.value)) members = obj.value as Array<Record<string, unknown>>;
    }

    const result = members.map((m) => ({
      phone: String(m.phone ?? m.id ?? '')
        .replace('@s.whatsapp.net', '')
        .replace('@c.us', '')
        .replace(/\D/g, ''),
      name: String(m.name ?? m.pushname ?? m.phone ?? ''),
      admin: m.admin === true || m.isSuperAdmin === true,
    })).filter((m) => m.phone.length >= 8);

    return Response.json(result);
  } finally {
    await pool.end();
  }
}
