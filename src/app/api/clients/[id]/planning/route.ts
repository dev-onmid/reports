import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_planning (
      client_id   TEXT PRIMARY KEY,
      tkm         NUMERIC NOT NULL DEFAULT 9000,
      cpl_meta    NUMERIC NOT NULL DEFAULT 30,
      stages      JSONB NOT NULL DEFAULT '[]',
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
      `SELECT tkm::float, cpl_meta::float AS "cplMeta", stages
         FROM public.client_planning WHERE client_id = $1`,
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
  const body = await req.json() as { tkm: number; cplMeta: number; stages: unknown[] };
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_planning (client_id, tkm, cpl_meta, stages, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET tkm = $2, cpl_meta = $3, stages = $4, updated_at = NOW()
       RETURNING tkm::float, cpl_meta::float AS "cplMeta", stages`,
      [id, body.tkm, body.cplMeta, JSON.stringify(body.stages)],
    );
    return Response.json(row);
  } finally {
    await pool.end();
  }
}
