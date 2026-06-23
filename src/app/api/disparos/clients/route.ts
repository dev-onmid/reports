import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { createEvolutionInstance, setEvolutionWebhook } from '@/lib/evolution-api';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.zapi_clients (
      id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT        NOT NULL,
      instance_id    TEXT        NOT NULL,
      token          TEXT        NOT NULL,
      security_token TEXT,
      active         BOOLEAN     NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.zapi_clients ADD COLUMN IF NOT EXISTS security_token TEXT;
    ALTER TABLE public.zapi_clients ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'zapi';
    CREATE TABLE IF NOT EXISTS public.zapi_campaigns (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id     UUID        NOT NULL REFERENCES public.zapi_clients(id) ON DELETE CASCADE,
      name          TEXT        NOT NULL,
      message       TEXT        NOT NULL,
      image_url     TEXT,
      status        TEXT        NOT NULL DEFAULT 'pending',
      starts_at     TIMESTAMPTZ NOT NULL,
      ends_at       TIMESTAMPTZ,
      interval_min  INTEGER     NOT NULL DEFAULT 5,
      interval_max  INTEGER     NOT NULL DEFAULT 15,
      total         INTEGER     NOT NULL DEFAULT 0,
      sent          INTEGER     NOT NULL DEFAULT 0,
      failed        INTEGER     NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.zapi_numbers (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id  UUID        NOT NULL REFERENCES public.zapi_campaigns(id) ON DELETE CASCADE,
      phone        TEXT        NOT NULL,
      name         TEXT,
      status       TEXT        NOT NULL DEFAULT 'pending',
      sent_at      TIMESTAMPTZ,
      error_msg    TEXT,
      position     INTEGER     NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_zapi_numbers_campaign ON public.zapi_numbers (campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_zapi_campaigns_status ON public.zapi_campaigns (status);
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `SELECT id, name, instance_id, provider, active, created_at FROM public.zapi_clients ORDER BY created_at DESC`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

// New instances can only be created on Evolution (our own, simpler to operate) — Z-API
// stays available for the instances already registered, managed from Configurações.
export async function POST(request: NextRequest) {
  const { name } = await request.json() as { name: string };

  if (!name) {
    return Response.json({ error: 'name é obrigatório' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureTables(pool);

    const instanceId = `disparo-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Date.now().toString(36)}`;

    let token: string;
    try {
      const created = await createEvolutionInstance(instanceId);
      token = created.hash;
    } catch (err) {
      return Response.json({ error: `Erro ao criar instância na Evolution API: ${String(err)}` }, { status: 502 });
    }

    const { rows } = await pool.query(
      `INSERT INTO public.zapi_clients (name, instance_id, token, provider) VALUES ($1, $2, $3, 'evolution') RETURNING id, name, instance_id, provider, active, created_at`,
      [name, instanceId, token],
    );

    const appUrl = new URL(request.url).origin;
    await setEvolutionWebhook(instanceId, `${appUrl}/api/webhook/whatsapp/${rows[0].id}`);

    return Response.json(rows[0], { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json() as { id: string };
  if (!id) return Response.json({ error: 'id obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.zapi_clients WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
