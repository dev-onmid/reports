import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import type { AdSetTargeting } from '@/app/api/meta/campaigns/[id]/adsets/route';

type UpdateBody = {
  connectionId: string;
  targeting: AdSetTargeting;
  daily_budget?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adsetId } = await params;
  const body = await req.json() as UpdateBody;
  const { connectionId, targeting, daily_budget } = body;

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      conn = rows[0] ?? null;
    }
    if (!conn) {
      const { rows } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = rows[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Meta não encontrada.' }, { status: 404 });

  const token = await getFreshMetaToken(conn);

  const payload: Record<string, unknown> = { targeting, access_token: token };
  if (daily_budget != null) payload.daily_budget = Math.round(daily_budget * 100);

  const res = await fetch(`https://graph.facebook.com/v21.0/${adsetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API HTTP ${res.status}` }, { status: res.status });
  }

  return Response.json({ ok: true });
}
