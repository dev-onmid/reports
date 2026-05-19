import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const BASE = 'https://api.z-api.io/instances';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get('clientId');
  const type = searchParams.get('type') ?? 'all'; // groups | conversations | all

  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

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
      `${BASE}/${instance_id}/token/${token}/chats?conversationLimit=300`,
      { headers },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return Response.json({ error: `Z-API error ${res.status}: ${text}` }, { status: 502 });
    }

    const raw = await res.json() as unknown;

    // Z-API may return array directly or { value: [...] }
    const chats: Array<Record<string, unknown>> = Array.isArray(raw)
      ? (raw as Array<Record<string, unknown>>)
      : Array.isArray((raw as Record<string, unknown>).value)
        ? ((raw as Record<string, unknown>).value as Array<Record<string, unknown>>)
        : [];

    const filtered = chats.filter((c) => {
      if (type === 'groups') return c.isGroup === true;
      if (type === 'conversations') return c.isGroup !== true;
      return true;
    });

    const result = filtered.map((c) => ({
      phone: String(c.phone ?? c.id ?? ''),
      name: String(c.name ?? c.pushname ?? c.phone ?? ''),
      isGroup: c.isGroup === true,
      membersCount: typeof c.participantsCount === 'number' ? c.participantsCount : undefined,
      profilePicUrl: typeof c.profilePicUrl === 'string' ? c.profilePicUrl : undefined,
    }));

    return Response.json(result);
  } finally {
    await pool.end();
  }
}
