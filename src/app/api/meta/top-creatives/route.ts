import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveMetaPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { getFreshMetaToken } from '@/lib/meta-token';
import { countMetaResults, type MetaAction } from '@/lib/meta-results';

// Leads/conversas pela contagem CANÔNICA (lib/meta-results): uma prioridade por
// família, nunca somando aliases. A lista local antiga somava `lead` +
// `onsite_conversion.lead_grouped` + … e contava o mesmo lead 2–3 vezes.

function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function toMetaAccountNodeId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

function accountMatches(a: string, b: string) {
  return normalizeMetaAccountId(a) === normalizeMetaAccountId(b);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeRows(pool: ReturnType<typeof makeServerPool>, query: string, params: unknown[] = []): Promise<any[]> {
  try {
    const { rows } = await pool.query(query, params);
    return rows;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return [];
    throw error;
  }
}

export type TopCreative = {
  adId: string;
  adName: string;
  accountId: string;
  accountName: string;
  campaignId?: string;
  campaignName?: string;
  adSetId?: string;
  adSetName?: string;
  /** Stable thumbnail / best image for display — never an expiring signed URL */
  imageUrl?: string;
  /** Secondary fallback thumbnail */
  thumbnailUrl?: string;
  /** Video source URL (may expire — used only for in-overlay playback attempt) */
  videoUrl?: string;
  /** Detected creative format for UI badges */
  mediaType: 'image' | 'video' | 'carousel' | 'unknown';
  permalink?: string;
  headline?: string;
  body?: string;
  /** effective_status do anúncio no Meta (ACTIVE, PAUSED, ADSET_PAUSED, ARCHIVED…) — para o selo Ativo/Pausado. */
  status?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
  /** Vídeo: reproduções de 3s (o "gancho") — `actions.video_view`. */
  views3s?: number;
  /** Vídeo: ThruPlays (15s ou até o fim) — a "retenção". */
  thruplays?: number;
  /** Vídeo: quem assistiu 25/50/75/100% — a curva de retenção. */
  p25?: number;
  p50?: number;
  p75?: number;
  p100?: number;
};

/** Soma um campo de vídeo do insights (vem como lista de {action_type, value}). */
function somaAcao(lista: unknown): number {
  if (!Array.isArray(lista)) return 0;
  return lista.reduce((s: number, a: { value?: string }) => s + (parseFloat(a?.value ?? '0') || 0), 0);
}

// ── Video ID collection ───────────────────────────────────────────────────────
// Meta Ads has THREE ways a creative can reference a video:
//   1. creative.video_id           — direct (Reels, boosted posts)
//   2. object_story_spec.video_data.video_id — standard video ads
//   3. asset_feed_spec.videos[].video_id    — Advantage+/dynamic creatives
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractVideoIds(creative: Record<string, any>): string[] {
  const ids: string[] = [];
  const storySpec = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};

  if (typeof creative.video_id === 'string' && creative.video_id) ids.push(creative.video_id);
  if (typeof storySpec.video_data?.video_id === 'string') ids.push(storySpec.video_data.video_id);
  for (const v of (assetFeed.videos ?? []) as Array<Record<string, string>>) {
    if (typeof v.video_id === 'string' && v.video_id) ids.push(v.video_id);
  }

  return [...new Set(ids)];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectMediaType(creative: Record<string, any>): TopCreative['mediaType'] {
  const objectType = (creative.object_type as string ?? '').toUpperCase();
  if (objectType === 'VIDEO' || objectType === 'REELS') return 'video';

  const videoIds = extractVideoIds(creative);
  if (videoIds.length > 0) return 'video';

  const storySpec = creative.object_story_spec ?? {};
  const assetFeed = creative.asset_feed_spec ?? {};
  const childAttachments = (storySpec.link_data?.child_attachments ?? []) as unknown[];
  if (childAttachments.length > 1) return 'carousel';
  if ((assetFeed.videos ?? []).length > 0) return 'video';
  if (creative.image_url || creative.thumbnail_url) return 'image';

  return 'unknown';
}

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = request.nextUrl.searchParams.get('dateTo') ?? '';
  const sortBy = request.nextUrl.searchParams.get('sortBy') ?? 'spend';
  // `all=1`: TODOS os anúncios que veicularam no período (funil de criativos) —
  // o ranking de "Melhores criativos" continua limitado a 50.
  const todos = request.nextUrl.searchParams.get('all') === '1';
  const limit = todos ? 500 : Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20'), 50);
  const metaPeriod = resolveMetaPeriod(period, dateFrom, dateTo);
  const requestedClientIds = (request.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;
  // Modo "anúncios específicos": a caixa de Vendas por anúncio precisa do
  // preview EXATO dos anúncios que venderam — que podem nem ter veiculado no
  // período (venda de hoje, anúncio de mês passado). Aí o criativo vem do
  // próprio anúncio e as métricas do período entram só se existirem.
  const requestedAdIds = [...new Set((request.nextUrl.searchParams.get('adIds') ?? '')
    .split(',').map((id) => id.trim()).filter((id) => /^\d{6,}$/.test(id)))].slice(0, 50);
  const adIdsMode = requestedAdIds.length > 0;

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[] = [];
  try {
    const [connectionsRows, linksRows, legacyLinks, legacyIntegration] = await Promise.all([
      safeRows(pool, "SELECT * FROM public.meta_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? safeRows(
          pool,
          `SELECT client_id, connection_id, account_id
           FROM public.client_account_links
           WHERE platform = 'meta_ads'
             AND client_id = ANY($1::text[])`,
          [requestedClientIds],
        )
        : Promise.resolve([]),
      shouldFilterByClient
        ? safeRows(pool, 'SELECT * FROM public.meta_ads_connections WHERE client_id = ANY($1::text[])', [requestedClientIds])
        : Promise.resolve([]),
      safeRows(pool, "SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'"),
    ]);
    conns = connectionsRows;
    links = linksRows;

    const legacyMeta = legacyIntegration[0];
    if (legacyMeta?.access_token) {
      conns.push({ id: 'legacy-meta-global', access_token: legacyMeta.access_token });
      for (const legacyLink of legacyLinks) {
        for (const accountId of legacyLink.account_ids ?? []) {
          links.push({
            client_id: legacyLink.client_id,
            connection_id: 'legacy-meta-global',
            account_id: accountId,
            account_name: accountId,
          });
        }
      }
    }
  } finally {
    await pool.end();
  }

  const allowedByConnection = new Map<string, Array<{ id: string; name: string }>>();
  for (const link of links) {
    if (!link.connection_id || !link.account_id) continue;
    const list = allowedByConnection.get(link.connection_id) ?? [];
    list.push({ id: link.account_id, name: link.account_name ?? link.account_id });
    allowedByConnection.set(link.connection_id, list);
  }

  if (shouldFilterByClient && allowedByConnection.size === 0) {
    return Response.json([]);
  }

  const allCreatives: TopCreative[] = [];

  await Promise.allSettled(
    conns.map(async (conn) => {
      const token = await getFreshMetaToken(conn);
      const allowedAccounts = shouldFilterByClient ? allowedByConnection.get(conn.id) ?? [] : [];
      if (shouldFilterByClient && allowedAccounts.length === 0) return;

      let accounts: Array<{ id: string; name: string }> = allowedAccounts;
      if (!shouldFilterByClient) {
        const acctRes = await fetch(
          `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=100&access_token=${token}`
        );
        if (!acctRes.ok) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acctData = await acctRes.json() as { data?: any[] };
        accounts = acctData.data ?? [];
      }

      const seenAccounts = new Set<string>();
      accounts = accounts.filter((account) => {
        const normalized = normalizeMetaAccountId(account.id);
        if (seenAccounts.has(normalized)) return false;
        seenAccounts.add(normalized);
        return shouldFilterByClient || allowedAccounts.some((allowed) => accountMatches(allowed.id, account.id));
      });

      await Promise.allSettled(
        accounts.map(async (account) => {
          // Fetch top ads insights sorted by spend
          const insightsUrl = new URL(`https://graph.facebook.com/v21.0/${toMetaAccountNodeId(account.id)}/insights`);
          insightsUrl.searchParams.set('level', 'ad');
          insightsUrl.searchParams.set('fields', 'ad_id,ad_name,campaign_id,campaign_name,adset_id,adset_name,spend,impressions,clicks,actions,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions');
          applyMetaDateToUrl(insightsUrl, metaPeriod);
          insightsUrl.searchParams.set('sort', 'spend_descending');
          insightsUrl.searchParams.set('limit', String(adIdsMode ? 50 : limit));
          if (adIdsMode) {
            insightsUrl.searchParams.set('filtering', JSON.stringify([{ field: 'ad.id', operator: 'IN', value: requestedAdIds }]));
          }
          insightsUrl.searchParams.set('access_token', token);

          const insightsRes = await fetch(insightsUrl.toString());
          if (!insightsRes.ok && !adIdsMode) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const insightsData = (insightsRes.ok ? await insightsRes.json() : {}) as { data?: any[] };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let adsInsights: any[] = insightsData.data ?? [];
          if (adsInsights.length === 0 && !adIdsMode) return;

          // Batch-fetch creative details
          // video_id is the direct reference on the creative object (used for Reels and boosted posts).
          // object_type distinguishes VIDEO/REELS/PHOTO/LINK for badge rendering.
          const adIds = adIdsMode ? requestedAdIds : adsInsights.map(a => a.ad_id as string).filter(Boolean);
          const creativeFields = [
            'body', 'title', 'image_url', 'thumbnail_url',
            'video_id', 'object_type',
            'object_story_spec', 'asset_feed_spec',
            'instagram_permalink_url', 'effective_object_story_id',
          ].join(',');
          const adFields = `name,effective_status${adIdsMode ? ',account_id,campaign{id,name},adset{id,name}' : ''},creative{${creativeFields}}`;
          // `?ids=` aceita até 50 por chamada — com `all=1` são centenas.
          const lotes: string[][] = [];
          for (let i = 0; i < adIds.length; i += 50) lotes.push(adIds.slice(i, i + 50));
          const respostas = await Promise.all(lotes.map(l => fetch(
            `https://graph.facebook.com/v21.0/?ids=${l.join(',')}&fields=${adFields}&access_token=${token}`
          ).catch(() => null)));
          const batchRes = { ok: respostas.every(r => r?.ok) };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let batchData: Record<string, any> = {};
          for (const r of respostas) if (r?.ok) Object.assign(batchData, await r.json().catch(() => ({})));
          if (adIdsMode && !batchRes.ok) {
            // `?ids=` falha INTEIRO se um único anúncio foi apagado — cai para um a um.
            const um = await Promise.all(adIds.map(async (id) => {
              const r = await fetch(`https://graph.facebook.com/v21.0/${id}?fields=${adFields}&access_token=${token}`).catch(() => null);
              return r?.ok ? [id, await r.json()] as const : null;
            }));
            batchData = Object.fromEntries(um.filter((x): x is NonNullable<typeof x> => !!x));
          }
          if (adIdsMode) {
            // Só os anúncios DESTA conta; quem não veiculou no período entra com métricas zeradas.
            const porId = new Map(adsInsights.map(a => [String(a.ad_id), a]));
            adsInsights = adIds
              .filter(id => batchData[id] && accountMatches(String(batchData[id].account_id ?? ''), account.id))
              .map(id => porId.get(id) ?? {
                ad_id: id,
                ad_name: batchData[id].name,
                campaign_id: batchData[id].campaign?.id,
                campaign_name: batchData[id].campaign?.name,
                adset_id: batchData[id].adset?.id,
                adset_name: batchData[id].adset?.name,
                spend: '0', impressions: '0', clicks: '0', actions: [],
              });
            if (adsInsights.length === 0) return;
          }

          // Collect all unique video IDs from every ad in this batch
          const allVideoIds = [...new Set(
            Object.values(batchData).flatMap((adObj: unknown) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ad = adObj as Record<string, any>;
              return extractVideoIds(ad.creative ?? {});
            })
          )];

          // Fetch video thumbnails: picture is a stable CDN URL (no expiry param),
          // unlike creative.thumbnail_url which contains oe= (Unix expiry timestamp).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const videoBatchData: Record<string, any> = {};
          for (let i = 0; i < allVideoIds.length; i += 50) {
            const vRes = await fetch(
              `https://graph.facebook.com/v21.0/?ids=${allVideoIds.slice(i, i + 50).join(',')}&fields=source,picture,thumbnails{uri,height,width}&access_token=${token}`
            ).catch(() => null);
            if (vRes?.ok) {
              Object.assign(videoBatchData, await vRes.json().catch(() => ({})));
            }
          }

          for (const insight of adsInsights) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const adData: Record<string, any> = batchData[insight.ad_id] ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const creative: Record<string, any> = adData.creative ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const storySpec: Record<string, any> = creative.object_story_spec ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const assetFeed: Record<string, any> = creative.asset_feed_spec ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const videoData: Record<string, any> = storySpec.video_data ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const linkData: Record<string, any> = storySpec.link_data ?? {};

            const videoIds = extractVideoIds(creative);

            // Find the best video info: first video ID that has a stable picture URL
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const videoInfo: Record<string, any> = videoIds.reduce((best, vid) => {
              if (best.picture) return best;
              return videoBatchData[vid] ?? {};
            }, {} as Record<string, unknown>);

            // Best-quality thumbnail from video thumbnails API (sorted by height desc)
            const videoThumbs: Array<{ uri: string; height?: number }> = videoInfo.thumbnails?.data ?? [];
            const bestThumb = videoThumbs.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0]?.uri;

            // asset_feed has direct image/video asset URLs from Advantage+/dynamic creatives
            const assetFeedImages = (assetFeed.images ?? []) as Array<Record<string, string>>;
            const assetFeedVideos = (assetFeed.videos ?? []) as Array<Record<string, string>>;
            const assetFeedImageUrl: string | undefined =
              assetFeedImages[0]?.url ??
              assetFeedVideos[0]?.thumbnail_url ??
              undefined;

            // imageUrl priority:
            // 1. asset_feed direct URL (Advantage+ originals)
            // 2. Video ad's image_url (explicit thumbnail set at ad creation)
            // 3. Best-resolution frame from thumbnails API
            // 4. Video object's picture (stable CDN, mas PEQUENA)
            // 5. Static ad image_url
            // 6. story spec photo / link picture
            // creative.thumbnail_url is intentionally LAST — it carries an oe= expiry param
            //
            // ⚠️ `picture` vinha ANTES do frame de maior resolução e as miniaturas
            // saíam borradas (é uma thumb pequena esticada pro card). Agora o frame
            // nítido vence; o `picture` estável fica como fallback em `thumbnailUrl`
            // — se a URL do frame expirar, o card cai nele em vez de quebrar.
            const imageUrl: string | undefined =
              assetFeedImageUrl ??
              (videoData.image_url as string | undefined) ??
              bestThumb ??
              (videoInfo.picture as string | undefined) ??
              (creative.image_url as string | undefined) ??
              (storySpec.photo_data?.url as string | undefined) ??
              (linkData.picture as string | undefined) ??
              (creative.thumbnail_url as string | undefined) ??
              undefined;

            const mediaType = detectMediaType(creative);

            const leads = countMetaResults(insight.actions as MetaAction[] | undefined);
            const spend = parseFloat(insight.spend || '0');
            const clicks = parseInt(insight.clicks || '0', 10);
            const impressions = parseInt(insight.impressions || '0', 10);

            // Build permalink: prefer Instagram URL, fallback to Facebook post URL
            const igPermalink: string | undefined = creative.instagram_permalink_url ?? undefined;
            const storyId: string | undefined = creative.effective_object_story_id ?? undefined;
            const fbPermalink = storyId
              ? (() => {
                const [pageId, postId] = storyId.split('_');
                return postId ? `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${pageId}` : undefined;
              })()
              : undefined;
            const permalink = igPermalink ?? fbPermalink;

            allCreatives.push({
              adId: insight.ad_id,
              adName: insight.ad_name ?? adData.name ?? `Ad ${insight.ad_id}`,
              accountId: account.id,
              accountName: account.name,
              campaignId: insight.campaign_id ?? undefined,
              campaignName: insight.campaign_name ?? undefined,
              adSetId: insight.adset_id ?? undefined,
              adSetName: insight.adset_name ?? undefined,
              imageUrl,
              // Fallback ESTÁVEL: o `picture` do vídeo não expira (ao contrário do
              // frame nítido e do creative.thumbnail_url, que carregam oe=).
              thumbnailUrl: (videoInfo.picture as string | undefined) ?? (creative.thumbnail_url as string | undefined) ?? undefined,
              videoUrl: (videoInfo.source as string | undefined) ?? undefined,
              mediaType,
              permalink,
              headline: (creative.title as string | undefined) ?? undefined,
              body: (creative.body as string | undefined) ?? undefined,
              status: (adData.effective_status as string | undefined) ?? undefined,
              spend,
              impressions,
              clicks,
              leads,
              ctr: impressions > 0 ? clicks / impressions * 100 : 0,
              cpl: leads > 0 ? spend / leads : 0,
              views3s: ((insight.actions ?? []) as Array<{ action_type?: string; value?: string }>)
                .filter(a => a.action_type === 'video_view')
                .reduce((s, a) => s + (parseFloat(a.value ?? '0') || 0), 0),
              thruplays: somaAcao(insight.video_thruplay_watched_actions),
              p25: somaAcao(insight.video_p25_watched_actions),
              p50: somaAcao(insight.video_p50_watched_actions),
              p75: somaAcao(insight.video_p75_watched_actions),
              p100: somaAcao(insight.video_p100_watched_actions),
            });
          }
        })
      );
    })
  );

  // Sort client-side for flexibility
  allCreatives.sort((a, b) => {
    const av = a[sortBy as keyof TopCreative] as number ?? 0;
    const bv = b[sortBy as keyof TopCreative] as number ?? 0;
    if (sortBy === 'cpl') return av - bv;
    return bv - av;
  });

  if (adIdsMode) {
    // A mesma conta pode estar em duas conexões — um anúncio, um card.
    const vistos = new Set<string>();
    return Response.json(allCreatives.filter(c => !vistos.has(c.adId) && !!vistos.add(c.adId)));
  }
  if (todos) {
    const vistos = new Set<string>();
    return Response.json(allCreatives.filter(c => !vistos.has(c.adId) && !!vistos.add(c.adId)));
  }
  return Response.json(allCreatives.slice(0, limit));
}
