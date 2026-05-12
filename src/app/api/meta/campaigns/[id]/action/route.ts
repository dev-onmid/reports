import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

type ActionBody = {
  action: 'pause' | 'activate' | 'set_budget';
  connectionId: string;
  dailyBudget?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params;
  const body = await req.json() as ActionBody;
  const { action, connectionId, dailyBudget } = body;

  const pool = makeServerPool();
  let conn: { access_token: string; token_expiry: string | null; label?: string } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
    if (!conn) {
      // fallback: legacy global integration
      const { rows: legacy } = await pool.query(
        `SELECT access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = legacy[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Meta não encontrada.' }, { status: 404 });

  const token = await getFreshMetaToken(conn);

  const payload: Record<string, string | number> = {};

  if (action === 'pause') payload.status = 'PAUSED';
  else if (action === 'activate') payload.status = 'ACTIVE';
  else if (action === 'set_budget' && dailyBudget != null) {
    // Meta expects budget in cents of the account currency
    payload.daily_budget = Math.round(dailyBudget * 100);
  } else {
    return Response.json({ error: 'Ação inválida.' }, { status: 400 });
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${campaignId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, access_token: token }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json(
      { error: err.error?.message ?? `Meta API HTTP ${res.status}` },
      { status: res.status },
    );
  }

  const newStatus = action === 'pause' ? 'PAUSED' : action === 'activate' ? 'ACTIVE' : undefined;
  return Response.json({ ok: true, newStatus });
}
