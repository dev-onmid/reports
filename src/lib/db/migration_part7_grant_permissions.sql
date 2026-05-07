-- Garante que a chave anon tenha todos os privilégios necessários nas tabelas
-- Isso é necessário para que INSERT, UPDATE e DELETE funcionem com a anon key

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  clients,
  users,
  user_permissions,
  payments,
  meta_integration,
  meta_ads_connections,
  meta_assets_cache,
  google_ads_integration,
  google_ads_connections,
  google_ads_accounts,
  activity_logs
TO anon, authenticated;
