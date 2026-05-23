import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.dashboard_configs (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id  TEXT NOT NULL UNIQUE,
      blocks     JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// GET /api/dashboard-configs?clientId=xxx
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ blocks: [] });

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `SELECT blocks, updated_at FROM public.dashboard_configs WHERE client_id = $1`,
      [clientId],
    );
    if (rows.length === 0) return Response.json({ blocks: [], updatedAt: null });
    return Response.json({ blocks: rows[0].blocks, updatedAt: rows[0].updated_at });
  } finally {
    await pool.end();
  }
}

// PUT /api/dashboard-configs?clientId=xxx  { blocks: [...] }
export async function PUT(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId obrigatório' }, { status: 400 });

  const body = await req.json() as { blocks: unknown[] };

  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.dashboard_configs (client_id, blocks, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (client_id)
         DO UPDATE SET blocks = $2, updated_at = NOW()
         RETURNING id, updated_at`,
      [clientId, JSON.stringify(body.blocks)],
    );
    return Response.json({ id: rows[0].id, updatedAt: rows[0].updated_at });
  } finally {
    await pool.end();
  }
}

// GET /api/dashboard-configs/all — lista clientes que têm config salva
export async function PATCH(req: NextRequest) {
  // Usado para listar clientes com config (para o "Copiar de...")
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    const { rows } = await pool.query(`
      SELECT dc.client_id, dc.updated_at, c.name as client_name
        FROM public.dashboard_configs dc
        LEFT JOIN public.clients c ON c.id = dc.client_id
        ORDER BY dc.updated_at DESC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
