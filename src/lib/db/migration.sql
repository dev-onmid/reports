-- ON REPORT — Vercel Postgres migration
-- Cole no Vercel → Storage → seu banco → Query → Execute
-- (ou use npx vercel postgres run migration.sql)

-- ─── Users ───────────────────────────────────────────────────────────────────

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

-- ─── Clients ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  segment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Ativo'
);

-- ─── Payments ────────────────────────────────────────────────────────────────

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

-- ─── Meta integration (single global row) ────────────────────────────────────

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

INSERT INTO meta_integration (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- ─── Meta ads connections (client → ad accounts) ──────────────────────────

CREATE TABLE IF NOT EXISTS meta_ads_connections (
  client_id TEXT PRIMARY KEY,
  profile_id TEXT,
  account_ids TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ,
  last_sync TIMESTAMPTZ
);

-- ─── Meta assets cache (ad accounts list) ────────────────────────────────

CREATE TABLE IF NOT EXISTS meta_assets_cache (
  id TEXT PRIMARY KEY,
  name TEXT,
  account_status INTEGER,
  currency TEXT,
  amount_spent TEXT
);

-- ─── Activity logs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Seed: users ─────────────────────────────────────────────────────────

INSERT INTO users (id, name, email, password, role, status) VALUES
  ('1', 'Admin',       'admin@onmid.com',     'admin123', 'Administrador', 'Ativo'),
  ('4', 'Matheus',     'matheus@onmid.com.br', '1234',    'Administrador', 'Ativo'),
  ('2', 'Maria Silva', 'maria@onmid.com',      'maria123', 'Usuário',      'Ativo'),
  ('3', 'João Costa',  'joao@onmid.com',       'joao123',  'Visualizador', 'Inativo')
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, dashboard, clientes, relatorios, configuracoes, integracoes) VALUES
  ('1', TRUE, TRUE, TRUE, TRUE,  TRUE),
  ('4', TRUE, TRUE, TRUE, TRUE,  TRUE),
  ('2', TRUE, TRUE, TRUE, FALSE, FALSE),
  ('3', TRUE, FALSE, FALSE, FALSE, FALSE)
ON CONFLICT DO NOTHING;

-- ─── Seed: clients ───────────────────────────────────────────────────────

INSERT INTO clients (id, name, segment, status) VALUES
  ('1', 'Tech Solutions', 'Tecnologia', 'Ativo'),
  ('2', 'OdontoPrime',    'Saúde',      'Ativo'),
  ('3', 'Bella Imóveis',  'Imobiliária','Alerta')
ON CONFLICT DO NOTHING;
