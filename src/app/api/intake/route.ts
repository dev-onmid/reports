import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_intakes (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT,
      data        JSONB       NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_client_intakes_submitted ON public.client_intakes (submitted_at DESC);
  `);
}

export async function POST(request: NextRequest) {
  const body = await request.json() as Record<string, unknown>;
  const pool = makeServerPool();

  try {
    await ensureTable(pool);

    const name    = String(body.nome_empresa ?? '').trim();
    const segment = String(body.segmento ?? 'Não informado').trim();

    if (!name) {
      return Response.json({ error: 'Nome da empresa é obrigatório' }, { status: 400 });
    }

    // Create client record
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await pool.query(
      `INSERT INTO public.clients (id, name, segment, status) VALUES ($1, $2, $3, 'Ativo') ON CONFLICT DO NOTHING`,
      [clientId, name, segment],
    );

    // Store full intake data
    const { rows: [intake] } = await pool.query(
      `INSERT INTO public.client_intakes (client_id, data) VALUES ($1, $2) RETURNING id`,
      [clientId, JSON.stringify(body)],
    );

    return Response.json({ ok: true, clientId, intakeId: intake.id }, { status: 201 });
  } finally {
    await pool.end();
  }
}
