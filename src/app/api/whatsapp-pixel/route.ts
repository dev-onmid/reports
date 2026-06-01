import { makeServerPool } from '@/lib/server-db';
import type { NextRequest } from 'next/server';

function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  return pool.query(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_pixel_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pixel_id TEXT NOT NULL DEFAULT '',
      meta_token TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.whatsapp_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      telefone TEXT NOT NULL,
      ctwa_clid TEXT,
      source_id TEXT,
      campanha TEXT,
      conjunto TEXT,
      anuncio TEXT,
      pixel_id TEXT,
      evento_lead_enviado BOOLEAN NOT NULL DEFAULT false,
      evento_compra_enviado BOOLEAN NOT NULL DEFAULT false,
      valor_compra NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_leads_telefone
      ON public.whatsapp_leads (telefone);
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `SELECT pixel_id, meta_token FROM public.whatsapp_pixel_config LIMIT 1`,
    );
    return Response.json(rows[0] ?? { pixel_id: '', meta_token: '' });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { pixel_id?: string; meta_token?: string };
  const { pixel_id, meta_token } = body;

  if (!pixel_id || !meta_token) {
    return Response.json({ error: 'pixel_id e meta_token são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows: existing } = await pool.query(
      `SELECT id FROM public.whatsapp_pixel_config LIMIT 1`,
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE public.whatsapp_pixel_config SET pixel_id = $1, meta_token = $2, updated_at = NOW()`,
        [pixel_id, meta_token],
      );
    } else {
      await pool.query(
        `INSERT INTO public.whatsapp_pixel_config (pixel_id, meta_token) VALUES ($1, $2)`,
        [pixel_id, meta_token],
      );
    }
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
