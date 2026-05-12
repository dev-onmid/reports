-- Tabela de anúncios salvos da biblioteca Meta Ad Library
CREATE TABLE IF NOT EXISTS public.saved_ads (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT        NOT NULL,
  ad_archive_id TEXT        NOT NULL,
  page_id       TEXT,
  page_name     TEXT,
  ad_snapshot_url TEXT,
  creative_bodies     JSONB DEFAULT '[]',
  creative_titles     JSONB DEFAULT '[]',
  publisher_platforms JSONB DEFAULT '[]',
  delivery_start_time TEXT,
  delivery_stop_time  TEXT,
  ad_active_status    TEXT DEFAULT 'ACTIVE',
  spend               JSONB,
  impressions         JSONB,
  notes               TEXT,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, ad_archive_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_ads_client_id ON public.saved_ads (client_id);
