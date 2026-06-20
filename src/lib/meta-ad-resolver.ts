import type { Pool } from 'pg';
import { getFreshMetaToken } from '@/lib/meta-token';

// WhatsApp's own ad-referral payload (contextInfo.externalAdReply / Cloud API's "referral"
// object) NEVER includes campaign/adset names — only `source_id`, which IS the ad's Graph
// API object ID ("Meta ID for the ad or post"). To get the real campaign/conjunto/anúncio
// names we have to make a second call to the Marketing API using that ID, exactly like
// third-party WhatsApp-ad-tracking tools do. Results are cached since the same ad gets
// clicked by many leads and campaign/adset names rarely change.

export type MetaAdHierarchy = {
  ad_name: string | null;
  adset_name: string | null;
  campaign_name: string | null;
};

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — names rarely change

export async function ensureMetaAdHierarchyCacheSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_ad_hierarchy_cache (
      ad_id TEXT PRIMARY KEY,
      ad_name TEXT,
      adset_name TEXT,
      campaign_name TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getClientMetaAdsToken(pool: Pool, clientId: string): Promise<string | null> {
  const { rows: links } = await pool.query<{ connection_id: string | null }>(
    `SELECT connection_id FROM public.client_account_links
      WHERE client_id = $1 AND platform IN ('meta_ads', 'meta') AND connection_id IS NOT NULL
      ORDER BY created_at ASC LIMIT 1`,
    [clientId],
  ).catch(() => ({ rows: [] as Array<{ connection_id: string | null }> }));
  const connectionId = links[0]?.connection_id;
  if (!connectionId) return null;

  const { rows } = await pool.query<{ id: string; app_id: string; access_token: string; token_expiry: string | null }>(
    `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
    [connectionId],
  ).catch(() => ({ rows: [] }));
  const conn = rows[0];
  if (!conn) return null;
  return getFreshMetaToken(conn).catch(() => null);
}

export async function resolveMetaAdHierarchy(
  pool: Pool,
  clientId: string,
  adId: string,
): Promise<MetaAdHierarchy | null> {
  try {
    await ensureMetaAdHierarchyCacheSchema(pool);

    const { rows: [cached] } = await pool.query<{
      ad_name: string | null; adset_name: string | null; campaign_name: string | null; fetched_at: string;
    }>(
      `SELECT ad_name, adset_name, campaign_name, fetched_at FROM public.meta_ad_hierarchy_cache WHERE ad_id = $1`,
      [adId],
    );
    const isFresh = cached && (Date.now() - new Date(cached.fetched_at).getTime()) < CACHE_TTL_MS;
    if (isFresh) {
      return { ad_name: cached.ad_name, adset_name: cached.adset_name, campaign_name: cached.campaign_name };
    }

    const token = await getClientMetaAdsToken(pool, clientId);
    if (!token) {
      // No ads connection configured for this client — fall back to a stale cache entry
      // if we have one, rather than nothing.
      return cached ? { ad_name: cached.ad_name, adset_name: cached.adset_name, campaign_name: cached.campaign_name } : null;
    }

    const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
    url.searchParams.set('fields', 'name,adset{name},campaign{name}');
    url.searchParams.set('access_token', token);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      return cached ? { ad_name: cached.ad_name, adset_name: cached.adset_name, campaign_name: cached.campaign_name } : null;
    }
    const json = await res.json() as { name?: string; adset?: { name?: string }; campaign?: { name?: string } };
    const result: MetaAdHierarchy = {
      ad_name: json.name ?? null,
      adset_name: json.adset?.name ?? null,
      campaign_name: json.campaign?.name ?? null,
    };

    await pool.query(
      `INSERT INTO public.meta_ad_hierarchy_cache (ad_id, ad_name, adset_name, campaign_name, fetched_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (ad_id) DO UPDATE SET
         ad_name = EXCLUDED.ad_name, adset_name = EXCLUDED.adset_name,
         campaign_name = EXCLUDED.campaign_name, fetched_at = NOW()`,
      [adId, result.ad_name, result.adset_name, result.campaign_name],
    ).catch(() => null);

    return result;
  } catch (err) {
    console.error('[meta-ad-resolver]', err);
    return null;
  }
}
