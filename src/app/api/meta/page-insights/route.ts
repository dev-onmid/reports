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

    const [fanRes, insRes] = await Promise.all([
      fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=fan_count&access_token=${pageToken}`,
      ),
      fetch(
        `https://graph.facebook.com/v21.0/${pageId}/insights` +
        `?metric=page_fan_adds,page_impressions_unique,page_impressions,page_post_engagements,page_views_total` +
        `&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
      ),
    ]);

    const fanData = fanRes.ok
      ? await fanRes.json() as { fan_count?: number }
      : { fan_count: 0 };

    const metricMap: Record<string, number> = {};
    if (insRes.ok) {
      const insData = await insRes.json() as {
        data?: { name: string; values: { value: number; end_time: string }[] }[];
      };
      for (const m of insData.data ?? []) metricMap[m.name] = sumValues(m.values);
    }

    return {
      pageId,
      pageName,
      picture,
      fans: fanData.fan_count ?? 0,
      fanAdds: metricMap.page_fan_adds ?? 0,
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
  userToken: string,
  from: string,
  to: string,
): Promise<InstagramPageData | null> {
  try {
    const since = Math.floor(new Date(from).getTime() / 1000);
    const until = Math.floor(new Date(to + 'T23:59:59').getTime() / 1000);

    const [profileRes, insRes] = await Promise.all([
      fetch(`https://graph.facebook.com/v21.0/${ig.id}?fields=followers_count&access_token=${userToken}`),
      fetch(
        `https://graph.facebook.com/v21.0/${ig.id}/insights` +
        `?metric=reach,impressions,profile_views,website_clicks` +
        `&period=day&since=${since}&until=${until}&access_token=${userToken}`,
      ),
    ]);

    const profileData = profileRes.ok
      ? await profileRes.json() as { followers_count?: number }
      : {};

    const metricMap: Record<string, number> = {};
    if (insRes.ok) {
      const insData = await insRes.json() as {
        data?: { name: string; values: { value: number; end_time: string }[] }[];
      };
      for (const m of insData.data ?? []) metricMap[m.name] = sumValues(m.values);
    }

    return {
      igUserId: ig.id,
      username: ig.username ? `@${ig.username}` : (ig.name ?? ig.id),
      picture: ig.profile_picture_url ?? null,
      followers: (profileData as { followers_count?: number }).followers_count ?? 0,
      reach: metricMap.reach ?? 0,
      impressions: metricMap.impressions ?? 0,
      profileViews: metricMap.profile_views ?? 0,
      websiteClicks: metricMap.website_clicks ?? 0,
    };
  } catch {
    return null;
  }
}

type ConnRow = { id: string; app_id: string; access_token: string; token_expiry: string | null };

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').filter(Boolean);
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');

  if (!clientIds.length || !from || !to)
    return Response.json({ error: 'clientIds, from e to são obrigatórios' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Get clients linked via meta_ads ad accounts
    const { rows: links } = await pool.query(
      `SELECT DISTINCT ON (cal.client_id)
              cal.client_id, cal.connection_id, c.name AS client_name
         FROM public.client_account_links cal
         JOIN public.clients c ON c.id = cal.client_id
        WHERE cal.client_id = ANY($1)
          AND cal.platform = 'meta_ads'
          AND cal.connection_id IS NOT NULL`,
      [clientIds],
    );

    // Build per-client map: clientId → { connId, name }
    const clientConnMap = new Map<string, { connId: string; name: string }>(
      links.map((l: { client_id: string; connection_id: string; client_name: string }) =>
        [l.client_id, { connId: l.connection_id, name: l.client_name }]),
    );

    // Clients without a meta_ads link — try fallback to any active connection
    const unlinkedIds = clientIds.filter(id => !clientConnMap.has(id));
    let fallbackConn: ConnRow | null = null;
    if (unlinkedIds.length > 0) {
      const { rows: fallbackRows } = await pool.query(
        `SELECT * FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
      );
      fallbackConn = fallbackRows[0] ?? null;
      if (fallbackConn) {
        const { rows: clientRows } = await pool.query(
          `SELECT id, name FROM public.clients WHERE id = ANY($1)`,
          [unlinkedIds],
        );
        const nameMap = new Map(clientRows.map((r: { id: string; name: string }) => [r.id, r.name]));
        for (const id of unlinkedIds) {
          clientConnMap.set(id, { connId: fallbackConn.id, name: nameMap.get(id) ?? id });
        }
      }
    }

    if (clientConnMap.size === 0) return Response.json([]);

    // Load all unique connections
    const connIds = [...new Set([...clientConnMap.values()].map(e => e.connId))];
    const { rows: conns } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE id = ANY($1) AND status = 'connected'`,
      [connIds],
    );
    const connMap = new Map<string, ConnRow>(conns.map((c: ConnRow) => [c.id, c]));

    const results = await Promise.all(
      clientIds.map(async (clientId): Promise<PageInsightsResult> => {
        const entry = clientConnMap.get(clientId);
        const conn = entry ? connMap.get(entry.connId) : null;
        if (!conn) return { clientId, facebook: null, instagram: null };

        try {
          const token = await getFreshMetaToken(conn);

          const pagesRes = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts` +
            `?fields=id,name,picture{url},access_token` +
            `,instagram_business_account{id,name,username,profile_picture_url}` +
            `&limit=10&access_token=${token}`,
          );
          if (!pagesRes.ok) return { clientId, clientName: entry?.name, facebook: null, instagram: null };

          const pagesData = await pagesRes.json() as {
            data?: {
              id: string; name: string; access_token: string;
              picture?: { data?: { url?: string } };
              instagram_business_account?: {
                id: string; name?: string; username?: string; profile_picture_url?: string;
              };
            }[];
          };

          const page = pagesData.data?.[0];
          if (!page) return { clientId, clientName: entry?.name, facebook: null, instagram: null };

          const [facebook, instagram] = await Promise.all([
            fetchFbPage(page.id, page.access_token, page.name, page.picture?.data?.url ?? null, from, to),
            page.instagram_business_account
              ? fetchIgPage(page.instagram_business_account, token, from, to)
              : Promise.resolve(null),
          ]);

          return { clientId, clientName: entry?.name, facebook, instagram };
        } catch {
          return { clientId, clientName: entry?.name, facebook: null, instagram: null };
        }
      }),
    );

    return Response.json(results);
  } finally {
    await pool.end();
  }
}
