import type { Pool } from 'pg';

// Diagnostic-only: when a lead is identified as coming from Facebook/Meta but the
// webhook payload had no ctwa_clid/externalAdReply (campaign/conjunto/anúncio all
// empty), we have no other record of what Evolution actually sent — there's no
// raw payload log anywhere else. Persisting the raw body here lets us inspect,
// after the fact, whether Evolution ever forwarded the ad-tracking context for
// that message, instead of staying in the dark like before.
export async function ensureAdTrackingDebugSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_ad_tracking_debug (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      phone TEXT,
      canal TEXT,
      raw_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_crm_ad_tracking_debug_created_at
      ON public.crm_ad_tracking_debug (created_at DESC)
  `);
}

export async function logMissingAdTracking(
  pool: Pool,
  opts: { clientId: string; phone: string; canal: string; rawPayload: unknown },
): Promise<void> {
  try {
    await ensureAdTrackingDebugSchema(pool);
    await pool.query(
      `INSERT INTO public.crm_ad_tracking_debug (client_id, phone, canal, raw_payload)
       VALUES ($1, $2, $3, $4)`,
      [opts.clientId, opts.phone, opts.canal, JSON.stringify(opts.rawPayload)],
    );
  } catch (err) {
    console.error('[crm-tracking-debug]', err);
  }
}
