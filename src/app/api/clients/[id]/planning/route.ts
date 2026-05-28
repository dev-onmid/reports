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
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS simple_mode BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE public.client_planning ADD COLUMN IF NOT EXISTS inv_pla_simple NUMERIC NOT NULL DEFAULT 0`);
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
      `SELECT tkm::float, cpl_meta::float AS "cplMeta", stages,
              simple_mode AS "simpleMode", inv_pla_simple::float AS "invPlaSimple"
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
  const body = await req.json() as { tkm: number; cplMeta: number; stages: unknown[]; simpleMode?: boolean; invPlaSimple?: number };
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows: [row] } = await pool.query(
      `INSERT INTO public.client_planning (client_id, tkm, cpl_meta, stages, simple_mode, inv_pla_simple, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET tkm = $2, cpl_meta = $3, stages = $4, simple_mode = $5, inv_pla_simple = $6, updated_at = NOW()
       RETURNING tkm::float, cpl_meta::float AS "cplMeta", stages,
                 simple_mode AS "simpleMode", inv_pla_simple::float AS "invPlaSimple"`,
      [id, body.tkm, body.cplMeta, JSON.stringify(body.stages), body.simpleMode ?? false, body.invPlaSimple ?? 0],
    );
    return Response.json(row);
  } finally {
    await pool.end();
  }
}
