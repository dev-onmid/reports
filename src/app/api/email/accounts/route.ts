import { makeServerPool } from '@/lib/server-db';

async function ensureTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.email_campaigns (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_email TEXT        NOT NULL,
      name          TEXT        NOT NULL,
      subject       TEXT        NOT NULL,
      body_html     TEXT        NOT NULL,
      status        TEXT        NOT NULL DEFAULT 'pending',
      scheduled_at  TIMESTAMPTZ,
      finished_at   TIMESTAMPTZ,
      total         INTEGER     NOT NULL DEFAULT 0,
      sent          INTEGER     NOT NULL DEFAULT 0,
      failed        INTEGER     NOT NULL DEFAULT 0,
      interval_min  INTEGER     NOT NULL DEFAULT 10,
      interval_max  INTEGER     NOT NULL DEFAULT 30,
      next_tick_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.email_recipients (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id  UUID        NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
      email        TEXT        NOT NULL,
      name         TEXT,
      status       TEXT        NOT NULL DEFAULT 'pending',
      sent_at      TIMESTAMPTZ,
      error_msg    TEXT,
      position     INTEGER     NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_email_recipients_campaign ON public.email_recipients (campaign_id, status);
    ALTER TABLE public.email_recipients ADD COLUMN IF NOT EXISTS open_count  INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.email_recipients ADD COLUMN IF NOT EXISTS opened_at   TIMESTAMPTZ;
    ALTER TABLE public.email_recipients ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE public.email_recipients ADD COLUMN IF NOT EXISTS clicked_at  TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON public.email_campaigns (status);
    CREATE TABLE IF NOT EXISTS public.email_flows (
      id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      account_email TEXT       NOT NULL,
      name         TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'active',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS public.email_flow_steps (
      id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
      flow_id     UUID    NOT NULL REFERENCES public.email_flows(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      subject     TEXT    NOT NULL,
      body_html   TEXT    NOT NULL,
      delay_days  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS public.email_flow_contacts (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      flow_id       UUID        NOT NULL REFERENCES public.email_flows(id) ON DELETE CASCADE,
      email         TEXT        NOT NULL,
      name          TEXT,
      current_step  INTEGER     NOT NULL DEFAULT 0,
      next_send_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status        TEXT        NOT NULL DEFAULT 'active',
      enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_flow_contacts_next ON public.email_flow_contacts (flow_id, status, next_send_at);
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureTables(pool);
    const { rows } = await pool.query(
      `SELECT id, email, display_name, picture, connected_at
       FROM public.google_connections
       WHERE account_type = 'gmail' AND status = 'connected'
       ORDER BY connected_at DESC`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
