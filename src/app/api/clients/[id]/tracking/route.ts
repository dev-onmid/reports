import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// ── Schema ───────────────────────────────────────────────────────────────────

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_tracking_config (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id         TEXT NOT NULL UNIQUE,
      pixel_id          TEXT NOT NULL DEFAULT '',
      meta_token        TEXT NOT NULL DEFAULT '',
      gatilho_compra    TEXT NOT NULL DEFAULT 'compra aprovada',
      eventos_ativos    JSONB NOT NULL DEFAULT '{"lead":true,"purchase":true}',
      whatsapp_provider TEXT NOT NULL DEFAULT 'zapi',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.client_tracking_config
      ADD COLUMN IF NOT EXISTS whatsapp_provider TEXT NOT NULL DEFAULT 'zapi';
    CREATE TABLE IF NOT EXISTS public.client_zapi_instances (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT NOT NULL,
      nome        TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      token       TEXT NOT NULL DEFAULT '',
      ativo       BOOLEAN NOT NULL DEFAULT true,
      provider    TEXT NOT NULL DEFAULT 'zapi',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.client_zapi_instances ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'zapi';
    CREATE INDEX IF NOT EXISTS idx_czapi_client_id ON public.client_zapi_instances (client_id);
  `);
  // Evolve whatsapp_leads for multi-tenant
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.whatsapp_leads (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      telefone              TEXT NOT NULL,
      ctwa_clid             TEXT,
      source_id             TEXT,
      campanha              TEXT,
      conjunto              TEXT,
      anuncio               TEXT,
      pixel_id              TEXT,
      evento_lead_enviado   BOOLEAN NOT NULL DEFAULT false,
      evento_compra_enviado BOOLEAN NOT NULL DEFAULT false,
      valor_compra          NUMERIC,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.whatsapp_leads ADD COLUMN IF NOT EXISTS client_id TEXT;
    ALTER TABLE public.whatsapp_leads ADD COLUMN IF NOT EXISTS zapi_instance_id UUID;
    DROP INDEX IF EXISTS idx_whatsapp_leads_telefone;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_leads_telefone_client
      ON public.whatsapp_leads (telefone, client_id)
      WHERE client_id IS NOT NULL;
  `);
}

// ── GET — fetch config for client ────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows: [row] } = await pool.query(
      `SELECT pixel_id, meta_token, gatilho_compra, eventos_ativos, whatsapp_provider
       FROM public.client_tracking_config WHERE client_id = $1`,
      [id],
    );
    return Response.json(row ?? {
      pixel_id: '', meta_token: '',
      gatilho_compra: 'compra aprovada',
      eventos_ativos: { lead: true, purchase: true },
      whatsapp_provider: 'zapi',
    });
  } finally {
    await pool.end();
  }
}

// ── POST — upsert config for client ──────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    pixel_id?: string;
    meta_token?: string;
    gatilho_compra?: string;
    eventos_ativos?: { lead: boolean; purchase: boolean };
    whatsapp_provider?: 'zapi' | 'evolution';
  };

  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const provider = body.whatsapp_provider === 'evolution' ? 'evolution' : 'zapi';
    await pool.query(`
      INSERT INTO public.client_tracking_config
        (client_id, pixel_id, meta_token, gatilho_compra, eventos_ativos, whatsapp_provider, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (client_id) DO UPDATE SET
        pixel_id           = EXCLUDED.pixel_id,
        meta_token         = EXCLUDED.meta_token,
        gatilho_compra     = EXCLUDED.gatilho_compra,
        eventos_ativos     = EXCLUDED.eventos_ativos,
        whatsapp_provider  = EXCLUDED.whatsapp_provider,
        updated_at         = NOW()
    `, [
      id,
      body.pixel_id      ?? '',
      body.meta_token    ?? '',
      body.gatilho_compra ?? 'compra aprovada',
      JSON.stringify(body.eventos_ativos ?? { lead: true, purchase: true }),
      provider,
    ]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
