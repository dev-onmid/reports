import { makeServerPool } from '@/lib/server-db';
import type { WhatsAppTarget } from '@/lib/balance-alerts';

/**
 * Destination rows for the daily low-balance alert, shared by the cron, the
 * config CRUD and the "test now" button. Kept here (rather than inline in one
 * route) because the cron used to SELECT from a table only the Pagamentos
 * screen ever created.
 */
export async function ensureBalanceAlertTables(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.balance_alert_configs (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      whatsapp_group TEXT NOT NULL,
      zapi_client_id UUID NOT NULL,
      active         BOOLEAN NOT NULL DEFAULT true,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.balance_alert_configs ADD COLUMN IF NOT EXISTS dias_antecedencia INTEGER NOT NULL DEFAULT 3;
    ALTER TABLE public.balance_alert_configs ADD COLUMN IF NOT EXISTS email_to TEXT;
  `);
}

export type BalanceAlertConfigRow = {
  id: string;
  whatsapp_group: string;
  dias_antecedencia: number | null;
  email_to: string | null;
  zapi_provider: string | null;
  zapi_instance_id: string | null;
  zapi_token: string | null;
  zapi_security_token: string | null;
};

/**
 * Evolution and Z-API instances share the zapi_clients table and only `provider`
 * tells them apart. The previous version ignored it and posted every alert to
 * api.z-api.io — which silently failed for Evolution instances, the only kind
 * the app can create today.
 */
export function buildTarget(cfg: BalanceAlertConfigRow): WhatsAppTarget | null {
  if (!cfg.zapi_instance_id) return null;
  if ((cfg.zapi_provider ?? 'zapi') === 'evolution') {
    return { provider: 'evolution', instanceName: cfg.zapi_instance_id, group: cfg.whatsapp_group };
  }
  if (!cfg.zapi_token) return null;
  return {
    provider: 'zapi',
    zapi: {
      instanceId: cfg.zapi_instance_id,
      token: cfg.zapi_token,
      clientToken: cfg.zapi_security_token ?? '',
    },
    group: cfg.whatsapp_group,
  };
}

/** SELECT list shared by the cron and the test route. */
export const BALANCE_CONFIG_SELECT = `
  SELECT bac.id, bac.whatsapp_group, bac.dias_antecedencia, bac.email_to,
         z.provider AS zapi_provider, z.instance_id AS zapi_instance_id,
         z.token AS zapi_token, z.security_token AS zapi_security_token
  FROM public.balance_alert_configs bac
  LEFT JOIN public.zapi_clients z ON z.id = bac.zapi_client_id AND z.active = true
`;
