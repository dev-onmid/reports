import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.balance_alert_configs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      whatsapp_group TEXT NOT NULL,
      zapi_client_id UUID NOT NULL,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(`
      SELECT bac.id, bac.whatsapp_group, bac.zapi_client_id, bac.active, bac.created_at,
             z.name AS zapi_name
      FROM public.balance_alert_configs bac
      LEFT JOIN public.zapi_clients z ON z.id = bac.zapi_client_id
      ORDER BY bac.created_at DESC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as { whatsappGroup: string; zapiClientId: string };
  if (!body.whatsappGroup || !body.zapiClientId) {
    return Response.json({ error: 'whatsappGroup e zapiClientId são obrigatórios' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.balance_alert_configs (whatsapp_group, zapi_client_id) VALUES ($1, $2) RETURNING *`,
      [body.whatsappGroup, body.zapiClientId],
    );
    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}
