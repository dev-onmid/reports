-- Multiple Meta Ads connections (replaces single meta_integration row)
CREATE TABLE IF NOT EXISTS meta_connections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'connected',
  app_id      TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  user_id     TEXT NOT NULL DEFAULT '',
  user_name   TEXT NOT NULL DEFAULT '',
  user_picture TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Multiple Google connections (Google Ads + Google Business)
CREATE TABLE IF NOT EXISTS google_connections (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  picture      TEXT,
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  token_expiry  TIMESTAMPTZ,
  scope        TEXT NOT NULL DEFAULT '',
  account_type TEXT NOT NULL DEFAULT 'gmb', -- 'gmb' | 'google_ads'
  status       TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_connections TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON google_connections TO anon, authenticated;
ALTER TABLE meta_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE google_connections DISABLE ROW LEVEL SECURITY;
