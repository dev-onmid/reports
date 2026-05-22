import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_goals (
      client_id   TEXT PRIMARY KEY,
      type        TEXT NOT NULL DEFAULT 'revenue',
      label       TEXT NOT NULL DEFAULT 'Faturamento',
      format      TEXT NOT NULL DEFAULT 'currency',
      target      NUMERIC NOT NULL DEFAULT 0,
      partial     NUMERIC NOT NULL DEFAULT 0,
      realized    NUMERIC NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `SELECT type, label, format, target::float, partial::float, realized::float
         FROM public.client_goals WHERE client_id = $1`,
      [id],
    );
    return Response.json(row ?? null);
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json() as {
    type: string; label: string; format: string;
    target: number; partial: number; realized: number;
  };
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_goals (client_id, type, label, format, target, partial, realized, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET type = $2, label = $3, format = $4, target = $5, partial = $6, realized = $7, updated_at = NOW()
       RETURNING type, label, format, target::float, partial::float, realized::float`,
      [id, body.type, body.label, body.format, body.target, body.partial, body.realized],
    );
    return Response.json(row);
  } finally {
    await pool.end();
  }
}
