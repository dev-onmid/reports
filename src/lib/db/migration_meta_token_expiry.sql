-- Add token_expiry to meta_connections to support long-lived token refresh
ALTER TABLE meta_connections ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMPTZ;
