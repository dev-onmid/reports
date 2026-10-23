import type { Pool } from 'pg';
import { getFreshMetaToken } from '@/lib/meta-token';
import { memoizarSchema } from '@/lib/schema-memo';

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

export async function getClientMetaAdsToken(pool: Pool, clientId: string): Promise<string | null> {
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

// ── Página de origem do anúncio ───────────────────────────────────────────────
// Evento de mensagem (CAPI business_messaging) exige que `page_id` e `ctwa_clid`
// sejam da MESMA Página (subcode 2804072). Cliente que anuncia por duas Páginas
// (Cost: Dra. Tayná × Cost Odontologia) tinha o evento recusado sempre que o lead
// vinha da Página que não é a do `client_conversion_config.meta_page_id`. A Página
// sai do criativo do anúncio (`source_id` do referral) e não muda — cache longo.

type CriativoMeta = {
  actor_id?: string;
  effective_object_story_id?: string;
  object_story_spec?: { page_id?: string };
};

/** Página dona do criativo: spec explícita → ator → prefixo do post ("PAGE_POST"). */
export function paginaDoCriativo(creative: CriativoMeta | null | undefined): string | null {
  if (!creative) return null;
  const candidatos = [
    creative.object_story_spec?.page_id,
    creative.actor_id,
    creative.effective_object_story_id?.split('_')[0],
  ];
  return candidatos.find(v => !!v && /^\d+$/.test(v)) ?? null;
}

const garantirCachePagina = memoizarSchema(async (pool: Pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_ad_page_cache (
      ad_id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
});

/** Página do anúncio (`source_id` do lead CTWA), ou null se não der para saber. */
export async function resolverPaginaDoAnuncio(pool: Pool, clientId: string, adId: string): Promise<string | null> {
  if (!pareceIdMeta(adId)) return null;
  try {
    await garantirCachePagina(pool);
    const { rows: [cached] } = await pool.query<{ page_id: string }>(
      `SELECT page_id FROM public.meta_ad_page_cache WHERE ad_id = $1`, [adId],
    );
    if (cached) return cached.page_id;

    const token = await getClientMetaAdsToken(pool, clientId);
    if (!token) return null;
    const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
    url.searchParams.set('fields', 'creative{actor_id,effective_object_story_id,object_story_spec{page_id}}');
    url.searchParams.set('access_token', token);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json() as { creative?: CriativoMeta };
    const pageId = paginaDoCriativo(json.creative);
    if (!pageId) return null;
    await pool.query(
      `INSERT INTO public.meta_ad_page_cache (ad_id, page_id) VALUES ($1, $2)
       ON CONFLICT (ad_id) DO UPDATE SET page_id = EXCLUDED.page_id, fetched_at = NOW()`,
      [adId, pageId],
    ).catch(() => null);
    return pageId;
  } catch (err) {
    console.error('[meta-ad-resolver] página do anúncio', err);
    return null;
  }
}

/**
 * ID de objeto do Meta (campanha/conjunto/anúncio): só dígitos e longo.
 * ⚠️ Serve para distinguir o parâmetro AUTOMÁTICO da Meta (que manda ID) do
 * template da agência (que usa `{{campaign.name}}`) — só o primeiro precisa de
 * tradução. Nome de campanha real nunca é só dígitos.
 */
export function pareceIdMeta(valor: string | null | undefined): boolean {
  return !!valor && /^\d{10,}$/.test(valor.trim());
}
