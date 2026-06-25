-- Leadlovers Integration
-- Run after all other migrations.

CREATE TABLE IF NOT EXISTS public.leadlovers_config (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     TEXT NOT NULL,
  webhook_url  TEXT NOT NULL,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id)
);

CREATE TABLE IF NOT EXISTS public.leadlovers_campaigns (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       TEXT NOT NULL,
  name           TEXT NOT NULL,
  webhook_url    TEXT NOT NULL,
  status         TEXT DEFAULT 'rascunho', -- rascunho | ativa | pausada | concluida
  total_contacts INTEGER DEFAULT 0,
  total_sent     INTEGER DEFAULT 0,
  total_errors   INTEGER DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leadlovers_schedule_rules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES public.leadlovers_campaigns(id) ON DELETE CASCADE,
  date_from        DATE NOT NULL,
  date_to          DATE NOT NULL,
  qty_per_day      INTEGER NOT NULL,
  interval_minutes INTEGER,           -- NULL = send all at once at send_time
  send_time        TIME DEFAULT '09:00',
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leadlovers_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     TEXT NOT NULL,
  campaign_id  UUID REFERENCES public.leadlovers_campaigns(id) ON DELETE SET NULL,
  nome         TEXT,
  email        TEXT,
  telefone     TEXT,
  empresa      TEXT,
  extra_data   JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'pendente', -- pendente | enviado | erro
  sent_at      TIMESTAMPTZ,
  error_msg    TEXT,
  retry_count  INTEGER DEFAULT 0,
  next_send_at TIMESTAMPTZ,
  position     INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.leadlovers_dispatch_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id  UUID NOT NULL REFERENCES public.leadlovers_campaigns(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES public.leadlovers_contacts(id) ON DELETE CASCADE,
  dispatched_at TIMESTAMPTZ DEFAULT NOW(),
  status        TEXT NOT NULL,  -- success | error
  http_status   INTEGER,
  error_msg     TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ll_contacts_owner    ON public.leadlovers_contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_ll_contacts_campaign ON public.leadlovers_contacts(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_ll_contacts_due      ON public.leadlovers_contacts(next_send_at) WHERE status = 'pendente';
CREATE INDEX IF NOT EXISTS idx_ll_campaigns_owner   ON public.leadlovers_campaigns(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_ll_dispatch_campaign ON public.leadlovers_dispatch_log(campaign_id, dispatched_at);

-- Disable RLS (consistent with rest of the app)
ALTER TABLE public.leadlovers_config         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leadlovers_campaigns      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leadlovers_schedule_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leadlovers_contacts       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leadlovers_dispatch_log   DISABLE ROW LEVEL SECURITY;

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leadlovers_config         TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leadlovers_campaigns      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leadlovers_schedule_rules TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leadlovers_contacts       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leadlovers_dispatch_log   TO anon, authenticated;
