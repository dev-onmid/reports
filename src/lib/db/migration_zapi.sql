-- Z-API WhatsApp Manager Tables

CREATE TABLE IF NOT EXISTS public.zapi_clients (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  instance_id TEXT        NOT NULL,
  token       TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.zapi_campaigns (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES public.zapi_clients(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  message       TEXT        NOT NULL,
  image_url     TEXT,
  status        TEXT        NOT NULL DEFAULT 'pending',
  -- pending | running | paused | done | cancelled
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
  -- pending | sent | failed
  sent_at      TIMESTAMPTZ,
  error_msg    TEXT,
  position     INTEGER     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_zapi_numbers_campaign ON public.zapi_numbers (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_zapi_campaigns_status ON public.zapi_campaigns (status);
