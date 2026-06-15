import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type IgPost = {
  id: string;
  clientId: string;
  username: string;
  profilePicture?: string;
  caption?: string;
  mediaType: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  videoViews: number;
  publishedInPeriod: boolean;
};

type ConnRow = { id: string; app_id: string; access_token: string; token_expiry: string | null };
type PageEntry = {
  id: string; name: string; access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

// Resolves any period key to explicit { since, until } YYYY-MM-DD strings.
function resolveDateRange(period: string, dateFrom: string, dateTo: string): { since: string; until: string } {
  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
  if (period === 'custom' && isValidDate(dateFrom) && isValidDate(dateTo)) {
    return { since: dateFrom, until: dateTo };
  }
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const daysAgo = (n: number) => { const d = new Date(now); d.setDate(d.getDate() - n); return fmt(d); };
  switch (period) {
    case 'yesterday':   return { since: daysAgo(1), until: daysAgo(1) };
    case 'last_7d':     return { since: daysAgo(7), until: daysAgo(1) };
    case 'last_14d':    return { since: daysAgo(14), until: daysAgo(1) };
    case 'last_30d':    return { since: daysAgo(30), until: daysAgo(1) };
    case 'this_month':  return { since: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), until: fmt(now) };
    case 'last_month':  return {
      since: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      until: fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
    default:            return { since: daysAgo(30), until: daysAgo(1) };
  }
}

async function getIgAccount(accountId: string, token: string): Promise<{ igId: string; username: string; picture?: string; pageToken: string } | null> {
  // Try promote_pages first (per ad account), then /me/accounts fallback
  const tryPages = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json() as { data?: PageEntry[] };
      const page = data.data?.find(p => p.instagram_business_account) ?? data.data?.[0];
      if (!page?.instagram_business_account) return null;
      const ig = page.instagram_business_account;
      return { igId: ig.id, username: ig.username ?? ig.id, picture: ig.profile_picture_url, pageToken: page.access_token };
    } catch { return null; }
  };

  const fields = 'id,name,access_token,instagram_business_account{id,username,profile_picture_url}';
  if (accountId) {
    const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const result = await tryPages(`https://graph.facebook.com/v21.0/${id}/promote_pages?fields=${fields}&limit=5&access_token=${token}`);
    if (result) return result;
  }
  return tryPages(`https://graph.facebook.com/v21.0/me/accounts?fields=${fields}&limit=20&access_token=${token}`);
}

async function fetchInsightsBatch(
  mediaItems: Array<{ id: string; isVideo: boolean }>,
  pageToken: string,
): Promise<Map<string, { reach: number; saves: number; videoViews: number }>> {
  const result = new Map<string, { reach: number; saves: number; videoViews: number }>();

  // First batch: all posts — reach + saved (safe for all media types)
  const baseBatch = mediaItems.map(m => ({
    method: 'GET',
    relative_url: `${m.id}/insights?metric=reach,saved&period=lifetime`,
  }));
  try {
    const body = new URLSearchParams({ access_token: pageToken, batch: JSON.stringify(baseBatch) });
    const res = await fetch('https://graph.facebook.com/v21.0/', { method: 'POST', body });
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: Array<{ code: number; body: string } | null> = await res.json();
      for (let i = 0; i < mediaItems.length; i++) {
        const item = items[i];
        if (item?.code === 200) {
          try {
            const d = JSON.parse(item.body) as { data?: { name: string; values?: { value: number }[] }[] };
            const r = { reach: 0, saves: 0, videoViews: 0 };
            for (const m of d.data ?? []) {
              const val = m.values?.[0]?.value ?? 0;
              if (m.name === 'reach') r.reach = val;
              if (m.name === 'saved') r.saves = val;
            }
            result.set(mediaItems[i].id, r);
          } catch {}
        }
      }
    }
  } catch {}

  // Second batch: video/reel posts — video_views + plays
  const videoPosts = mediaItems.filter(m => m.isVideo);
  if (videoPosts.length > 0) {
    const videoBatch = videoPosts.map(m => ({
      method: 'GET',
      relative_url: `${m.id}/insights?metric=video_views,plays&period=lifetime`,
    }));
    try {
      const body = new URLSearchParams({ access_token: pageToken, batch: JSON.stringify(videoBatch) });
      const res = await fetch('https://graph.facebook.com/v21.0/', { method: 'POST', body });
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: Array<{ code: number; body: string } | null> = await res.json();
        for (let i = 0; i < videoPosts.length; i++) {
          const item = items[i];
          if (item?.code === 200) {
            try {
              const d = JSON.parse(item.body) as { data?: { name: string; values?: { value: number }[] }[] };
              let videoViews = 0;
              for (const m of d.data ?? []) {
                const val = m.values?.[0]?.value ?? 0;
                if (m.name === 'video_views' || m.name === 'plays') videoViews = Math.max(videoViews, val);
              }
              const existing = result.get(videoPosts[i].id) ?? { reach: 0, saves: 0, videoViews: 0 };
              result.set(videoPosts[i].id, { ...existing, videoViews });
            } catch {}
          }
        }
      }
    } catch {}
  }

  return result;
}

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '').split(',').filter(Boolean);
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '24'), 50);
  const sortBy = req.nextUrl.searchParams.get('sortBy') ?? 'reach';
  const period = req.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = req.nextUrl.searchParams.get('dateTo') ?? '';

  if (!clientIds.length) return Response.json([]);

  // Always resolve to explicit dates so that every period key filters posts correctly.
  const { since: sinceDate, until: untilDate } = resolveDateRange(period, dateFrom, dateTo);
  const since = Math.floor(new Date(sinceDate + 'T00:00:00Z').getTime() / 1000);
  const until = Math.min(
    Math.floor(new Date(untilDate + 'T23:59:59Z').getTime() / 1000),
    Math.floor(Date.now() / 1000),
  );

  const pool = makeServerPool();
  try {
    const { rows: links } = await pool.query(
      `SELECT cal.client_id, cal.connection_id, cal.account_id
         FROM public.client_account_links cal
        WHERE cal.client_id = ANY($1) AND cal.platform = 'meta_ads' AND cal.connection_id IS NOT NULL`,
      [clientIds],
    );

    const linkedIds = new Set((links as { client_id: string }[]).map(l => l.client_id));
    const unlinkedIds = clientIds.filter(id => !linkedIds.has(id));
    let fallbackConnId: string | null = null;
    if (unlinkedIds.length > 0) {
      const { rows } = await pool.query(`SELECT id FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`);
      fallbackConnId = rows[0]?.id ?? null;
    }

    const connIds = [...new Set([
      ...(links as { connection_id: string }[]).map(l => l.connection_id),
      ...(fallbackConnId ? [fallbackConnId] : []),
    ])];
    const { rows: conns } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE id = ANY($1) AND status = 'connected'`, [connIds],
    );
    const connMap = new Map<string, ConnRow>((conns as ConnRow[]).map(c => [c.id, c]));

    const allPosts: IgPost[] = [];
    const seenAccounts = new Set<string>();

    await Promise.allSettled(clientIds.map(async (clientId) => {
      const link = (links as { client_id: string; connection_id: string; account_id: string }[])
        .find(l => l.client_id === clientId);
      const connId = link?.connection_id ?? fallbackConnId;
      const accountId = link?.account_id ?? '';
      if (!connId) return;
      const conn = connMap.get(connId);
      if (!conn) return;

      try {
        const token = await getFreshMetaToken(conn);
        const ig = await getIgAccount(accountId, token);
        if (!ig || seenAccounts.has(ig.igId)) return;
        seenAccounts.add(ig.igId);

        const mediaFields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
        const mediaUrl = new URL(`https://graph.facebook.com/v21.0/${ig.igId}/media`);
        mediaUrl.searchParams.set('fields', mediaFields);
        mediaUrl.searchParams.set('limit', '30');
        mediaUrl.searchParams.set('since', String(since));
        mediaUrl.searchParams.set('until', String(until));
        mediaUrl.searchParams.set('access_token', ig.pageToken);

        const mediaRes = await fetch(mediaUrl.toString());
        if (!mediaRes.ok) return;
        const mediaData = await mediaRes.json() as { data?: Record<string, unknown>[] };
        const media = (mediaData.data ?? []) as Array<{
          id: string; caption?: string; media_type?: string; media_product_type?: string;
          media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string;
          like_count?: number; comments_count?: number;
        }>;
        if (!media.length) return;

        const mediaForInsights = media.map(m => ({
          id: m.id,
          isVideo: m.media_product_type === 'REELS' || m.media_type === 'VIDEO',
        }));
        const insights = await fetchInsightsBatch(mediaForInsights, ig.pageToken);

        for (const m of media) {
          const ins = insights.get(m.id) ?? { reach: 0, saves: 0, videoViews: 0 };
          const isVideo = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
          const postTs = m.timestamp ? new Date(m.timestamp).getTime() : 0;
          allPosts.push({
            id: m.id,
            clientId,
            username: ig.username,
            profilePicture: ig.picture,
            caption: m.caption,
            mediaType: m.media_product_type ?? m.media_type ?? 'IMAGE',
            mediaUrl: !isVideo ? m.media_url : undefined,
            thumbnailUrl: m.thumbnail_url ?? (isVideo ? undefined : m.media_url),
            permalink: m.permalink ?? '',
            timestamp: m.timestamp ?? '',
            likes: m.like_count ?? 0,
            comments: m.comments_count ?? 0,
            reach: ins.reach,
            saves: ins.saves,
            videoViews: ins.videoViews,
            publishedInPeriod: postTs >= since * 1000 && postTs <= until * 1000,
          });
        }
      } catch {}
    }));

    allPosts.sort((a, b) => {
      if (sortBy === 'views') return Math.max(b.videoViews, b.reach) - Math.max(a.videoViews, a.reach);
      if (sortBy === 'likes') return b.likes - a.likes;
      if (sortBy === 'saves') return b.saves - a.saves;
      if (sortBy === 'comments') return b.comments - a.comments;
      return b.reach - a.reach;
    });

    return Response.json(allPosts.slice(0, limit));
  } finally {
    await pool.end();
  }
}
