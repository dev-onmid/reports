-- Webhook configurations
CREATE TABLE IF NOT EXISTS public.webhook_configs (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT    NOT NULL,
  token       TEXT    NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  description TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_token ON public.webhook_configs (token);

-- Incoming webhook log
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT,
  config_name TEXT,
  event_type  TEXT,
  payload     JSONB,
  status      TEXT    NOT NULL DEFAULT 'success',
  result      JSONB,
  error_msg   TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_received_at ON public.webhook_logs (received_at DESC);
