CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Usuário',
  status TEXT NOT NULL DEFAULT 'Ativo'
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dashboard BOOLEAN NOT NULL DEFAULT TRUE,
  clientes BOOLEAN NOT NULL DEFAULT TRUE,
  relatorios BOOLEAN NOT NULL DEFAULT FALSE,
  configuracoes BOOLEAN NOT NULL DEFAULT FALSE,
  integracoes BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Ativo'
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  date TEXT NOT NULL,
  destination TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta_integration (
  id TEXT PRIMARY KEY DEFAULT 'global',
  status TEXT NOT NULL DEFAULT 'disconnected',
  app_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  meta_user_id TEXT NOT NULL DEFAULT '',
  meta_user_name TEXT NOT NULL DEFAULT '',
  meta_user_picture TEXT,
  connected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meta_ads_connections (
  client_id TEXT PRIMARY KEY,
  profile_id TEXT,
  account_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ,
  last_sync TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meta_assets_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  account_status INTEGER,
  currency TEXT,
  amount_spent TEXT
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
