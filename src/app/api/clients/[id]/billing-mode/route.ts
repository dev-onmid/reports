import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureColumn(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(
    `ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ads_billing_mode TEXT NOT NULL DEFAULT 'prepaid'`,
  ).catch(() => {});
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureColumn(pool);
    const { rows: [row] } = await pool.query(
      `SELECT ads_billing_mode FROM public.clients WHERE id = $1`,
      [id],
    );
    return Response.json({ mode: row?.ads_billing_mode ?? 'prepaid' });
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { mode } = await req.json() as { mode: 'prepaid' | 'card' };
  if (mode !== 'prepaid' && mode !== 'card')
    return Response.json({ error: 'Invalid mode' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensureColumn(pool);
    await pool.query(
      `UPDATE public.clients SET ads_billing_mode = $1 WHERE id = $2`,
      [mode, id],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
