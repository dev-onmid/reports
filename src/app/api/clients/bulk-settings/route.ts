import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
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
    );
    CREATE TABLE IF NOT EXISTS public.client_planning (
      client_id   TEXT PRIMARY KEY,
      tkm         NUMERIC NOT NULL DEFAULT 9000,
      cpl_meta    NUMERIC NOT NULL DEFAULT 30,
      stages      JSONB NOT NULL DEFAULT '[]',
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function GET(req: NextRequest) {
  const clientIds = req.nextUrl.searchParams.get('clientIds')?.split(',').filter(Boolean) ?? [];
  if (clientIds.length === 0) return Response.json({ goals: {}, planning: {} });

  const pool = makeServerPool();
  try {
    await ensureTables(pool);

    const [goalsRes, planningRes] = await Promise.all([
      pool.query(
        `SELECT client_id, type, label, format, target::float, partial::float, realized::float
           FROM public.client_goals WHERE client_id = ANY($1)`,
        [clientIds],
      ),
      pool.query(
        `SELECT client_id, tkm::float, cpl_meta::float AS "cplMeta", stages
           FROM public.client_planning WHERE client_id = ANY($1)`,
        [clientIds],
      ),
    ]);

    const goals: Record<string, unknown> = {};
    for (const row of goalsRes.rows) {
      const { client_id, ...rest } = row;
      goals[client_id as string] = rest;
    }

    const planning: Record<string, unknown> = {};
    for (const row of planningRes.rows) {
      const { client_id, ...rest } = row;
      planning[client_id as string] = rest;
    }

    return Response.json({ goals, planning });
  } finally {
    await pool.end();
  }
}
