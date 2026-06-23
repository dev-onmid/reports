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

    // The /chats endpoint paginates (default page size ~30) — a single call
    // only returns the first page. Page through until Z-API returns a
    // short/empty page, capped to avoid looping forever on a flaky response.
    const pageSize = 100;
    const chats: Array<Record<string, unknown>> = [];
    for (let page = 1; page <= 30; page++) {
      const res = await fetch(
        `${BASE}/${instance_id}/token/${token}/chats?page=${page}&pageSize=${pageSize}`,
        { headers },
      );

      if (!res.ok) {
        if (page === 1) {
          const text = await res.text().catch(() => '');
          return Response.json({ error: `Z-API error ${res.status}: ${text}` }, { status: 502 });
        }
        break;
      }

      const raw = await res.json() as unknown;
      // Z-API may return array directly or { value: [...] }
      const batch: Array<Record<string, unknown>> = Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>)
        : Array.isArray((raw as Record<string, unknown>).value)
          ? ((raw as Record<string, unknown>).value as Array<Record<string, unknown>>)
          : [];

      chats.push(...batch);
      if (batch.length < pageSize) break;
    }

    const seen = new Set<string>();
    const deduped = chats.filter((c) => {
      const key = String(c.phone ?? c.id ?? '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const filtered = deduped.filter((c) => {
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
