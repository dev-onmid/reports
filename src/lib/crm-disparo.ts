import type { Pool } from 'pg';
import { getClientInstance, type WaInstance } from '@/lib/followup-send';
import { getEvolutionState } from '@/lib/evolution-api';

/**
 * Resolves the client's registered WhatsApp instance and verifies it is
 * actually connected right now. Disparos must never send through an
 * instance that isn't both registered AND live-connected for this client.
 */
export async function getConnectedClientInstance(
  pool: Pool,
  clientId: string,
): Promise<{ instance: WaInstance } | { instance: null; reason: 'no_instance' | 'disconnected' | 'unknown' }> {
  const instance = await getClientInstance(pool, clientId);
  if (!instance) return { instance: null, reason: 'no_instance' };

  try {
    if (instance.provider === 'evolution') {
      const state = await getEvolutionState(instance.instanceId);
      if (state.state !== 'open') return { instance: null, reason: 'disconnected' };
      return { instance };
    }

    const res = await fetch(
      `https://api.z-api.io/instances/${instance.instanceId}/token/${instance.token}/status`,
      { headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return { instance: null, reason: 'unknown' };
    const data = await res.json() as { connected?: boolean; status?: string; value?: string };
    const connected = data.connected === true || data.value === 'CONNECTED' || data.status === 'CONNECTED';
    if (!connected) return { instance: null, reason: 'disconnected' };
    return { instance };
  } catch {
    return { instance: null, reason: 'unknown' };
  }
}

export async function ensureCrmDisparoSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_lead_tags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#0ea5e9',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_tags_client_name_idx
      ON public.crm_lead_tags (client_id, lower(name));

    CREATE TABLE IF NOT EXISTS public.crm_lead_tag_assignments (
      lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES public.crm_lead_tags(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (lead_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS crm_lead_tag_assignments_tag_idx
      ON public.crm_lead_tag_assignments (tag_id);

    CREATE TABLE IF NOT EXISTS public.crm_disparo_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      name TEXT NOT NULL,
      message TEXT NOT NULL,
      messages JSONB,
      image_url TEXT,
      audience_filter JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ,
      active_from TEXT,
      active_until TEXT,
      interval_min INT NOT NULL DEFAULT 8,
      interval_max INT NOT NULL DEFAULT 20,
      message_index INT NOT NULL DEFAULT 0,
      next_tick_at TIMESTAMPTZ,
      total INT NOT NULL DEFAULT 0,
      sent INT NOT NULL DEFAULT 0,
      failed INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS crm_disparo_campaigns_client_idx
      ON public.crm_disparo_campaigns (client_id);
    CREATE INDEX IF NOT EXISTS crm_disparo_campaigns_status_idx
      ON public.crm_disparo_campaigns (status, next_tick_at);

    CREATE TABLE IF NOT EXISTS public.crm_disparo_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id UUID NOT NULL REFERENCES public.crm_disparo_campaigns(id) ON DELETE CASCADE,
      lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
      phone TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      error_msg TEXT,
      position INT NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS crm_disparo_leads_campaign_idx
      ON public.crm_disparo_leads (campaign_id, status, position);
  `);
}
