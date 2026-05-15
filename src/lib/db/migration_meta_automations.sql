-- Webhook verification token (one row, generated once)
CREATE TABLE IF NOT EXISTS public.meta_webhook_config (
  id           TEXT PRIMARY KEY DEFAULT 'global',
  verify_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex')
);
INSERT INTO public.meta_webhook_config (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- Automation rules
CREATE TABLE IF NOT EXISTS public.meta_automations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    TEXT,
  account_id   TEXT NOT NULL,
  account_name TEXT,
  platform     TEXT NOT NULL,   -- 'instagram' | 'facebook'
  trigger_type TEXT NOT NULL,   -- 'any_comment' | 'keyword_comment' | 'any_dm' | 'keyword_dm'
  keyword      TEXT,
  action       TEXT NOT NULL,   -- 'reply_comment' | 'send_dm' | 'reply_and_dm'
  reply_message TEXT NOT NULL,
  dm_message   TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_automations_account ON public.meta_automations (account_id);

-- Execution log
CREATE TABLE IF NOT EXISTS public.meta_automation_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id UUID,
  platform     TEXT,
  event_type   TEXT,
  account_id   TEXT,
  sender_id    TEXT,
  trigger_text TEXT,
  action_taken TEXT,
  status       TEXT NOT NULL DEFAULT 'success',
  error_msg    TEXT,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meta_automation_logs_triggered ON public.meta_automation_logs (triggered_at DESC);
