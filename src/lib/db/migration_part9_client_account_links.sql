-- Client account links used by the unified integrations UI.
-- Keeps each client linked to specific Meta Ads / Google Ads accounts.

CREATE TABLE IF NOT EXISTS client_account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  connection_id TEXT,
  account_id TEXT NOT NULL,
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, platform, connection_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_client_account_links_client_id
  ON client_account_links (client_id);

CREATE INDEX IF NOT EXISTS idx_client_account_links_platform
  ON client_account_links (platform);

GRANT SELECT, INSERT, UPDATE, DELETE ON client_account_links TO anon, authenticated;
ALTER TABLE client_account_links DISABLE ROW LEVEL SECURITY;
