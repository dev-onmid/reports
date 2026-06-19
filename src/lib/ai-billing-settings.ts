import { makeServerPool } from '@/lib/server-db';
import { USD_TO_BRL } from '@/lib/ai-usage-config';

export type AiBillingSettings = {
  openai_credit_usd: number;
  claude_credit_usd: number;
  alert_enabled: boolean;
  alert_threshold_usd: number;
  alert_phone: string;
  zapi_client_id: string;
  last_alert_at: string | null;
};

export const DEFAULT_AI_BILLING_SETTINGS: AiBillingSettings = {
  openai_credit_usd: 0,
  claude_credit_usd: 0,
  alert_enabled: false,
  alert_threshold_usd: 2,
  alert_phone: '',
  zapi_client_id: '',
  last_alert_at: null,
};

export function envCreditUsd(provider: 'openai' | 'claude'): number {
  const specific = Number(process.env[provider === 'openai' ? 'AI_OPENAI_CREDIT_USD' : 'AI_CLAUDE_CREDIT_USD'] ?? '');
  if (Number.isFinite(specific) && specific > 0) return specific;
  const sharedUsd = Number(process.env.AI_CLOUD_CREDIT_USD ?? '');
  if (Number.isFinite(sharedUsd) && sharedUsd > 0) return sharedUsd;
  const sharedBrl = Number(process.env.AI_CLOUD_CREDIT_BRL ?? '');
  if (Number.isFinite(sharedBrl) && sharedBrl > 0) return sharedBrl / USD_TO_BRL;
  return 0;
}

export async function ensureAiBillingSettingsTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.ai_billing_settings (
      id                  TEXT PRIMARY KEY DEFAULT 'global',
      openai_credit_usd   NUMERIC(12,2) NOT NULL DEFAULT 0,
      claude_credit_usd   NUMERIC(12,2) NOT NULL DEFAULT 0,
      alert_enabled       BOOLEAN NOT NULL DEFAULT false,
      alert_threshold_usd NUMERIC(12,2) NOT NULL DEFAULT 2,
      alert_phone         TEXT NOT NULL DEFAULT '',
      zapi_client_id      UUID,
      last_alert_at       TIMESTAMPTZ,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getAiBillingSettings(pool: ReturnType<typeof makeServerPool>): Promise<AiBillingSettings> {
  await ensureAiBillingSettingsTable(pool);
  const { rows: [row] } = await pool.query(`
    SELECT
      openai_credit_usd::float,
      claude_credit_usd::float,
      alert_enabled,
      alert_threshold_usd::float,
      alert_phone,
      COALESCE(zapi_client_id::text, '') AS zapi_client_id,
      last_alert_at
    FROM public.ai_billing_settings
    WHERE id = 'global'
  `);

  if (!row) {
    const openai = envCreditUsd('openai');
    const claude = envCreditUsd('claude');
    await pool.query(
      `INSERT INTO public.ai_billing_settings (id, openai_credit_usd, claude_credit_usd)
       VALUES ('global', $1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [openai, claude],
    );
    return { ...DEFAULT_AI_BILLING_SETTINGS, openai_credit_usd: openai, claude_credit_usd: claude };
  }

  return {
    openai_credit_usd: Number(row.openai_credit_usd ?? 0),
    claude_credit_usd: Number(row.claude_credit_usd ?? 0),
    alert_enabled: Boolean(row.alert_enabled),
    alert_threshold_usd: Number(row.alert_threshold_usd ?? 2),
    alert_phone: String(row.alert_phone ?? ''),
    zapi_client_id: String(row.zapi_client_id ?? ''),
    last_alert_at: row.last_alert_at ? new Date(row.last_alert_at).toISOString() : null,
  };
}

export async function saveAiBillingSettings(
  pool: ReturnType<typeof makeServerPool>,
  settings: Partial<AiBillingSettings>,
): Promise<AiBillingSettings> {
  await ensureAiBillingSettingsTable(pool);
  const next = {
    openai_credit_usd: Number(settings.openai_credit_usd ?? 0),
    claude_credit_usd: Number(settings.claude_credit_usd ?? 0),
    alert_enabled: Boolean(settings.alert_enabled),
    alert_threshold_usd: Number(settings.alert_threshold_usd ?? 2),
    alert_phone: String(settings.alert_phone ?? '').replace(/\D/g, ''),
    zapi_client_id: String(settings.zapi_client_id ?? ''),
  };
  await pool.query(
    `INSERT INTO public.ai_billing_settings
       (id, openai_credit_usd, claude_credit_usd, alert_enabled, alert_threshold_usd, alert_phone, zapi_client_id, updated_at)
     VALUES ('global', $1, $2, $3, $4, $5, NULLIF($6, '')::uuid, NOW())
     ON CONFLICT (id) DO UPDATE SET
       openai_credit_usd = EXCLUDED.openai_credit_usd,
       claude_credit_usd = EXCLUDED.claude_credit_usd,
       alert_enabled = EXCLUDED.alert_enabled,
       alert_threshold_usd = EXCLUDED.alert_threshold_usd,
       alert_phone = EXCLUDED.alert_phone,
       zapi_client_id = EXCLUDED.zapi_client_id,
       updated_at = NOW()`,
    [
      Number.isFinite(next.openai_credit_usd) ? next.openai_credit_usd : 0,
      Number.isFinite(next.claude_credit_usd) ? next.claude_credit_usd : 0,
      next.alert_enabled,
      Number.isFinite(next.alert_threshold_usd) ? next.alert_threshold_usd : 2,
      next.alert_phone,
      next.zapi_client_id,
    ],
  );
  return getAiBillingSettings(pool);
}
