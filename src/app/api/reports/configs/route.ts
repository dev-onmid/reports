import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.report_configs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id      TEXT NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
      name           TEXT NOT NULL,
      whatsapp_group TEXT,
      zapi_client_id UUID,
      send_day       INTEGER NOT NULL DEFAULT 1,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.diagnostic_reports
      ADD COLUMN IF NOT EXISTS public_token  TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
      ADD COLUMN IF NOT EXISTS html_content  TEXT,
      ADD COLUMN IF NOT EXISTS config_id     UUID,
      ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS template_slug TEXT NOT NULL DEFAULT 'diagnostico-performance';
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(`
      SELECT
        rc.id, rc.client_id, rc.name, rc.whatsapp_group,
        rc.zapi_client_id, rc.send_day, rc.active, rc.created_at,
        c.name AS client_name,
        z.name AS zapi_name,
        (SELECT COUNT(*) FROM public.diagnostic_reports dr
         WHERE dr.config_id = rc.id) AS report_count,
        (SELECT created_at FROM public.diagnostic_reports dr
         WHERE dr.config_id = rc.id ORDER BY created_at DESC LIMIT 1) AS last_run_at,
        (SELECT public_token FROM public.diagnostic_reports dr
         WHERE dr.config_id = rc.id ORDER BY created_at DESC LIMIT 1) AS last_token
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      LEFT JOIN public.zapi_clients z ON z.id = rc.zapi_client_id
      ORDER BY rc.created_at DESC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    clientId: string;
    name: string;
    whatsappGroup?: string;
    zapiClientId?: string;
    sendDay?: number;
  };
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.report_configs (client_id, name, whatsapp_group, zapi_client_id, send_day)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [body.clientId, body.name, body.whatsappGroup ?? null, body.zapiClientId ?? null, body.sendDay ?? 1],
    );
    return Response.json(rows[0]);
  } finally {
    await pool.end();
  }
}
