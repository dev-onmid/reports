import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type FacebookPageData = {
  pageId: string;
  pageName: string;
  picture: string | null;
  fans: number;
  fanAdds: number;
  reach: number;
  impressions: number;
  engagements: number;
  pageViews: number;
  dailySeries: {
    reach: number[];
    impressions: number[];
    engagements: number[];
    pageViews: number[];
    fanAdds: number[];
  };
};

export type InstagramPageData = {
  igUserId: string;
  username: string;
  picture: string | null;
  followers: number;
  reach: number;
  views: number;
  profileViews: number;
  websiteClicks: number;
  accountsEngaged: number;
  totalInteractions: number;
  likes: number;
  saves: number;
  dailySeries: {
    reach: number[];
    views: number[];
    profileViews: number[];
    websiteClicks: number[];
    accountsEngaged: number[];
    totalInteractions: number[];
    likes: number[];
    saves: number[];
  };
};

export type PageInsightsResult = {
  clientId: string;
  clientName?: string;
  facebook: FacebookPageData | null;
  instagram: InstagramPageData | null;
};

type PageEntry = {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; name?: string; username?: string; profile_picture_url?: string };
};

type ConnRow = { id: string; app_id: string; access_token: string; token_expiry: string | null };

function sumValues(values: { value: number }[]): number {
  return (values ?? []).reduce((s, r) => s + (r.value ?? 0), 0);
}

// Returns { total, daily } so callers can use the aggregate number AND the per-day sparkline data.
async function fetchOneMetric(
  id: string,
  metric: string,
  period: string,
  since: number,
  until: number,
  token: string,
  metricType?: string,
): Promise<{ total: number; daily: number[] }> {
  try {
    const mt = metricType ? `&metric_type=${metricType}` : '';
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${id}/insights` +
      `?metric=${metric}&period=${period}&since=${since}&until=${until}${mt}&access_token=${token}`,
    );
    if (!res.ok) return { total: 0, daily: [] };
    const d = await res.json() as { data?: { values?: { value: number }[]; total_value?: { value: number } }[] };
    if (!d.data?.[0]) return { total: 0, daily: [] };
    const m = d.data[0];
    const daily = (m.values ?? []).map(v => v.value);
    const total = m.total_value?.value != null ? m.total_value.value : sumValues(m.values ?? []);
    return { total, daily };
  } catch { return { total: 0, daily: [] }; }
}

// Split [since, until] (unix seconds) into ≤28-day windows. Meta's IG account-level
// insights reject ranges longer than ~30 days, so a monthly (or previous-month)
// period must be requested in pieces and summed — otherwise the call returns 0.
function chunkRange(since: number, until: number): Array<{ since: number; until: number }> {
  const chunks: Array<{ since: number; until: number }> = [];
  const STEP = 28 * 86400; // seconds
  for (let cursor = since; cursor <= until; ) {
    const end = Math.min(cursor + STEP - 1, until);
    chunks.push({ since: cursor, until: end });
    cursor = end + 1;
  }
  return chunks.length ? chunks : [{ since, until }];
}

// Chunked account-metric fetch. Sums the metric across ≤28-day windows and, when
// metric_type=total_value comes back empty (some accounts/older windows reject it
// even though the per-day series exists), retries without it and sums the daily
// values — so the previous period isn't silently zeroed. Mirrors the delivery
// report builder, the proven path for period-over-period IG comparisons.
async function fetchIgMetricChunked(
  igId: string,
  metric: string,
  since: number,
  until: number,
  token: string,
  metricType?: string,
): Promise<{ total: number; daily: number[] }> {
  const chunks = chunkRange(since, until);
  const parts = await Promise.all(
    chunks.map(c => fetchOneMetric(igId, metric, 'day', c.since, c.until, token, metricType)),
  );
  let total = parts.reduce((s, p) => s + p.total, 0);
  const daily = parts.flatMap(p => p.daily);
  if (metricType && total === 0) {
    const fb = await Promise.all(
      chunks.map(c => fetchOneMetric(igId, metric, 'day', c.since, c.until, token)),
    );
    total = fb.reduce((s, p) => s + p.total, 0);
    if (daily.length === 0) return { total, daily: fb.flatMap(p => p.daily) };
  }
  return { total, daily };
}

// One-shot batch fetch for IG daily series — uses period=day WITHOUT metric_type=total_value
// so each metric returns its per-day `values` array (trends accurate; totals may differ
// from deduped metric_type calls but are only used for sparklines, not for display numbers).
async function fetchIgDailySeries(
  igId: string,
  token: string,
  since: number,
  until: number,
): Promise<Record<string, number[]>> {
  try {
    const metrics = 'reach,views,profile_views,website_clicks,accounts_engaged,total_interactions,likes,saves';
    // Chunk so ranges longer than ~30 days (e.g. a full month) still return a series
    // instead of an empty payload; concatenate each metric's per-day values in order.
    const chunks = chunkRange(since, until);
    const perChunk = await Promise.all(chunks.map(async (c) => {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${igId}/insights` +
        `?metric=${metrics}&period=day&since=${c.since}&until=${c.until}&access_token=${token}`,
      );
      if (!res.ok) return {};
      const d = await res.json() as { data?: { name: string; values?: { value: number }[] }[]; error?: unknown };
      if (d.error || !d.data) return {};
      const r: Record<string, number[]> = {};
      for (const m of d.data) if (m.values?.length) r[m.name] = m.values.map(v => v.value);
      return r;
    }));
    const result: Record<string, number[]> = {};
    for (const chunkResult of perChunk) {
      for (const [name, values] of Object.entries(chunkResult)) {
        result[name] = (result[name] ?? []).concat(values);
      }
    }
    return result;
  } catch { return {}; }
}

async function fetchFbPage(
  pageId: string,
  pageToken: string,
  pageName: string,
  picture: string | null,
  from: string,
  to: string,
): Promise<FacebookPageData | null> {
  try {
    const since = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
    // Cap until at now to avoid future timestamps (Meta rejects them)
    const untilRaw = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);
    const until = Math.min(untilRaw, Math.floor(Date.now() / 1000));

    // Each metric in its own request — a deprecated metric won't zero out the others.
    // page_post_engagements was deprecated in v18+; page_engaged_users is the replacement.
    const [fanRes, reachRes, impressionsRes, engagementsRes, pageViewsRes, fanAddsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=fan_count&access_token=${pageToken}`),
      fetchOneMetric(pageId, 'page_impressions_unique', 'day', since, until, pageToken),
      fetchOneMetric(pageId, 'page_impressions',        'day', since, until, pageToken),
      fetchOneMetric(pageId, 'page_engaged_users',      'day', since, until, pageToken),
      fetchOneMetric(pageId, 'page_views_total',        'day', since, until, pageToken),
      fetchOneMetric(pageId, 'page_fan_adds_unique',    'day', since, until, pageToken),
    ]);

    const fanData = fanRes.ok ? await fanRes.json() as { fan_count?: number } : {};

    return {
      pageId, pageName, picture,
      fans:        fanData.fan_count ?? 0,
      fanAdds:     fanAddsRes.total,
      reach:       reachRes.total,
      impressions: impressionsRes.total,
      engagements: engagementsRes.total,
      pageViews:   pageViewsRes.total,
      dailySeries: {
        reach:       reachRes.daily,
        impressions: impressionsRes.daily,
        engagements: engagementsRes.daily,
        pageViews:   pageViewsRes.daily,
        fanAdds:     fanAddsRes.daily,
      },
    };
  } catch {
    return null;
  }
}

async function fetchIgPage(
  ig: { id: string; name?: string; username?: string; profile_picture_url?: string },
  pageToken: string,
  from: string,
  to: string,
): Promise<InstagramPageData | null> {
  try {
    const since = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
    // Cap until at now to avoid future timestamps (Meta rejects them for insights)
    const untilRaw = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);
    const until = Math.min(untilRaw, Math.floor(Date.now() / 1000));

    // IG account-level metrics (/{ig-user-id}/insights) v21.0 — confirmed via debug:
    //   reach       → period=day, NO metric_type
    //   all others  → period=day + metric_type=total_value
    //   (total_over_range is incompatible with all these metrics for this account type;
    //    impressions is not in the valid metric list — views is the correct one)
    const [
      profileRes,
      reachRes, viewsRes, profileViewsRes, websiteClicksRes,
      accountsEngagedRes, totalInteractionsRes, likesRes, savesRes,
      dailyMap,
    ] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${ig.id}?fields=followers_count&access_token=${pageToken}`),
      fetchIgMetricChunked(ig.id, 'reach',              since, until, pageToken),
      fetchIgMetricChunked(ig.id, 'views',              since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'profile_views',      since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'website_clicks',     since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'accounts_engaged',   since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'total_interactions', since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'likes',              since, until, pageToken, 'total_value'),
      fetchIgMetricChunked(ig.id, 'saves',              since, until, pageToken, 'total_value'),
      // One extra call without metric_type to get daily breakdowns for all metrics at once.
      // The totals from this call may differ (no cross-day deduplication) so they're only
      // used for sparklines; display numbers come from the metric_type=total_value calls above.
      fetchIgDailySeries(ig.id, pageToken, since, until),
    ]);

    const profileData = profileRes.ok ? await profileRes.json() as { followers_count?: number } : {};

    return {
      igUserId: ig.id,
      username: ig.username ?? (ig.name ?? ig.id),
      picture: ig.profile_picture_url ?? null,
      followers: profileData.followers_count ?? 0,
      reach:             reachRes.total,
      views:             viewsRes.total,
      profileViews:      profileViewsRes.total,
      websiteClicks:     websiteClicksRes.total,
      accountsEngaged:   accountsEngagedRes.total,
      totalInteractions: totalInteractionsRes.total,
      likes:             likesRes.total,
      saves:             savesRes.total,
      dailySeries: {
        // Prefer the batch daily fetch (no deduplication, but accurate per-day trend);
        // fall back to the fetchOneMetric daily array (only non-empty for reach).
        reach:             dailyMap['reach']              ?? reachRes.daily,
        views:             dailyMap['views']              ?? viewsRes.daily,
        profileViews:      dailyMap['profile_views']      ?? profileViewsRes.daily,
        websiteClicks:     dailyMap['website_clicks']     ?? websiteClicksRes.daily,
        accountsEngaged:   dailyMap['accounts_engaged']   ?? accountsEngagedRes.daily,
        totalInteractions: dailyMap['total_interactions'] ?? totalInteractionsRes.daily,
        likes:             dailyMap['likes']              ?? likesRes.daily,
        saves:             dailyMap['saves']              ?? savesRes.daily,
      },
    };
  } catch {
    return null;
  }
}

// Fetch pages linked to a specific ad account (most accurate per-client mapping)
async function fetchPromotePages(adAccountId: string, token: string): Promise<PageEntry[]> {
  try {
    const id = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${id}/promote_pages` +
      `?fields=id,name,picture{url},access_token,instagram_business_account{id,name,username,profile_picture_url}` +
      `&limit=10&access_token=${token}`,
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: PageEntry[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

// Fetch all pages accessible by user token (fallback when no ad account)
async function fetchUserPages(token: string): Promise<PageEntry[]> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts` +
      `?fields=id,name,picture{url},access_token,instagram_business_account{id,name,username,profile_picture_url}` +
      `&limit=50&access_token=${token}`,
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: PageEntry[] };
    return data.data ?? [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '').split(',').filter(Boolean);
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  if (!clientIds.length || !from || !to)
    return Response.json({ error: 'clientIds, from e to são obrigatórios' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Get all meta_ads links for these clients (with account_id for promote_pages)
    const { rows: links } = await pool.query(
      `SELECT cal.client_id, cal.connection_id, cal.account_id, c.name AS client_name
         FROM public.client_account_links cal
         JOIN public.clients c ON c.id = cal.client_id
        WHERE cal.client_id = ANY($1)
          AND cal.platform = 'meta_ads'
          AND cal.connection_id IS NOT NULL`,
      [clientIds],
    );

    // clientId → [ { connId, accountId, name } ]
    const clientLinksMap = new Map<string, { connId: string; accountId: string; name: string }[]>();
    for (const l of links as { client_id: string; connection_id: string; account_id: string; client_name: string }[]) {
      const arr = clientLinksMap.get(l.client_id) ?? [];
      arr.push({ connId: l.connection_id, accountId: l.account_id, name: l.client_name });
      clientLinksMap.set(l.client_id, arr);
    }

    // Clients without any meta_ads link — use fallback connection
    const unlinkedIds = clientIds.filter(id => !clientLinksMap.has(id));
    let fallbackConn: ConnRow | null = null;
    if (unlinkedIds.length > 0) {
      const { rows: fbRows } = await pool.query(
        `SELECT * FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
      );
      fallbackConn = fbRows[0] ?? null;
      if (fallbackConn) {
        const { rows: clientRows } = await pool.query(
          `SELECT id, name FROM public.clients WHERE id = ANY($1)`, [unlinkedIds],
        );
        const nameMap = new Map(clientRows.map((r: { id: string; name: string }) => [r.id, r.name]));
        for (const id of unlinkedIds) {
          clientLinksMap.set(id, [{ connId: fallbackConn.id, accountId: '', name: nameMap.get(id) ?? id }]);
        }
      }
    }

    if (clientLinksMap.size === 0) return Response.json([]);

    // Load all unique connections
    const allConnIds = [...new Set([...clientLinksMap.values()].flat().map(e => e.connId))];
    const { rows: conns } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE id = ANY($1) AND status = 'connected'`, [allConnIds],
    );
    const connMap = new Map<string, ConnRow>(conns.map((c: ConnRow) => [c.id, c]));

    // Cache user pages per connection to avoid repeated API calls
    const userPagesCache = new Map<string, PageEntry[]>();

    const results = await Promise.all(
      clientIds.map(async (clientId): Promise<PageInsightsResult> => {
        const linkEntries = clientLinksMap.get(clientId);
        if (!linkEntries?.length) return { clientId, facebook: null, instagram: null };

        const { connId, accountId, name: clientName } = linkEntries[0];
        const conn = connMap.get(connId);
        if (!conn) return { clientId, clientName, facebook: null, instagram: null };

        try {
          const token = await getFreshMetaToken(conn);

          // Prefer promote_pages for specific ad account; fall back to /me/accounts
          let page: PageEntry | undefined;
          if (accountId) {
            const pages = await fetchPromotePages(accountId, token);
            page = pages[0];
          }

          if (!page) {
            if (!userPagesCache.has(connId)) {
              userPagesCache.set(connId, await fetchUserPages(token));
            }
            page = userPagesCache.get(connId)?.[0];
          }

          if (!page) return { clientId, clientName, facebook: null, instagram: null };

          const [facebook, instagram] = await Promise.all([
            fetchFbPage(page.id, page.access_token, page.name, page.picture?.data?.url ?? null, from, to),
            page.instagram_business_account
              ? fetchIgPage(page.instagram_business_account, page.access_token, from, to)
              : Promise.resolve(null),
          ]);

          return { clientId, clientName, facebook, instagram };
        } catch {
          return { clientId, clientName, facebook: null, instagram: null };
        }
      }),
    );

    return Response.json(results);
  } finally {
    await pool.end();
  }
}
