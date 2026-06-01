-- CRM: contatos e mensagens por cliente

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    TEXT        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone        TEXT        NOT NULL,
  name         TEXT,
  origin       TEXT        NOT NULL DEFAULT 'organic',
  ctwa_clid    TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  status       TEXT        NOT NULL DEFAULT 'novo',
  instance_id  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_client  ON public.crm_contacts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_phone   ON public.crm_contacts (phone);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_status  ON public.crm_contacts (client_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_origin  ON public.crm_contacts (client_id, origin);

CREATE TABLE IF NOT EXISTS public.crm_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID        NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  client_id   TEXT        NOT NULL,
  instance_id TEXT,
  direction   TEXT        NOT NULL CHECK (direction IN ('in', 'out')),
  text        TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_messages_contact ON public.crm_messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_messages_client  ON public.crm_messages (client_id, created_at DESC);
