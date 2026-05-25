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
};

export type InstagramPageData = {
  igUserId: string;
  username: string;
  picture: string | null;
  followers: number;
  reach: number;
  impressions: number;
  profileViews: number;
  websiteClicks: number;
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

async function fetchFbPage(
  pageId: string,
  pageToken: string,
  pageName: string,
  picture: string | null,
  from: string,
  to: string,
): Promise<FacebookPageData | null> {
  try {
    const since = Math.floor(new Date(from).getTime() / 1000);
    const until = Math.floor(new Date(to + 'T23:59:59').getTime() / 1000);

    // Request metrics in two groups — some metrics were deprecated in v17+ and cause the
    // entire batch to fail with "(#100) The value must be a valid insights metric".
    // We fetch fan_adds_unique separately so a deprecation doesn't zero out everything.
    const [fanRes, insRes, fanAddsRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${pageId}?fields=fan_count&access_token=${pageToken}`),
      fetch(
        `https://graph.facebook.com/v21.0/${pageId}/insights` +
        `?metric=page_impressions_unique,page_impressions,page_post_engagements,page_views_total` +
        `&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
      ),
      fetch(
        `https://graph.facebook.com/v21.0/${pageId}/insights` +
        `?metric=page_fan_adds_unique&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
      ),
    ]);

    const fanData = fanRes.ok ? await fanRes.json() as { fan_count?: number } : {};
    const metricMap: Record<string, number> = {};
    if (insRes.ok) {
      const insData = await insRes.json() as { data?: { name: string; values: { value: number }[] }[] };
      for (const m of insData.data ?? []) metricMap[m.name] = sumValues(m.values);
    }
    if (fanAddsRes.ok) {
      const fanAddsData = await fanAddsRes.json() as { data?: { name: string; values: { value: number }[] }[] };
      for (const m of fanAddsData.data ?? []) metricMap[m.name] = sumValues(m.values);
    }

    return {
      pageId, pageName, picture,
      fans: (fanData as { fan_count?: number }).fan_count ?? 0,
      fanAdds: metricMap.page_fan_adds_unique ?? 0,
      reach: metricMap.page_impressions_unique ?? 0,
      impressions: metricMap.page_impressions ?? 0,
      engagements: metricMap.page_post_engagements ?? 0,
      pageViews: metricMap.page_views_total ?? 0,
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
    const since = Math.floor(new Date(from).getTime() / 1000);
    const until = Math.floor(new Date(to + 'T23:59:59').getTime() / 1000);

    const [profileRes, insRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${ig.id}?fields=followers_count&access_token=${pageToken}`),
      fetch(
        `https://graph.facebook.com/v21.0/${ig.id}/insights` +
        `?metric=reach,impressions,profile_views,website_clicks` +
        `&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
      ),
    ]);

    const profileData = profileRes.ok ? await profileRes.json() as { followers_count?: number } : {};
    const metricMap: Record<string, number> = {};
    if (insRes.ok) {
      const insData = await insRes.json() as { data?: { name: string; values: { value: number }[] }[] };
      for (const m of insData.data ?? []) metricMap[m.name] = sumValues(m.values);
    }

    return {
      igUserId: ig.id,
      username: ig.username ? `@${ig.username}` : (ig.name ?? ig.id),
      picture: ig.profile_picture_url ?? null,
      followers: profileData.followers_count ?? 0,
      reach: metricMap.reach ?? 0,
      impressions: metricMap.impressions ?? 0,
      profileViews: metricMap.profile_views ?? 0,
      websiteClicks: metricMap.website_clicks ?? 0,
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
