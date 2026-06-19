import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getAiBillingSettings, saveAiBillingSettings } from '@/lib/ai-billing-settings';

async function ensureZapiClients(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.zapi_clients (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT NOT NULL,
      instance_id    TEXT NOT NULL,
      token          TEXT NOT NULL,
      security_token TEXT,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.zapi_clients ADD COLUMN IF NOT EXISTS security_token TEXT;
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    const settings = await getAiBillingSettings(pool);
    await ensureZapiClients(pool);
    const { rows: zapi_clients } = await pool.query(
      `SELECT id::text, name, instance_id, active
         FROM public.zapi_clients
        ORDER BY created_at DESC`,
    );
    return Response.json({ settings, zapi_clients });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const pool = makeServerPool();
  try {
    const settings = await saveAiBillingSettings(pool, body);
    return Response.json({ ok: true, settings });
  } finally {
    await pool.end();
  }
}
