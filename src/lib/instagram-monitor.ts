import type { Pool } from 'pg';

// ── Resolução cliente → conta Instagram ──────────────────────────────────────
// Fonte canônica da resolução "qual conta IG é deste cliente", compartilhada
// pelo feed de posts (/api/meta/ig-posts) e pelo Monitor de Redes Sociais.

export type ConnRow = { id: string; app_id: string; access_token: string; token_expiry: string | null };

export type PageEntry = {
  id: string; name: string; access_token: string;
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string; followers_count?: number };
};

export type ResolvedIgAccount = {
  igId: string; username: string; picture?: string; followers?: number; pageToken: string;
};

const PAGE_FIELDS = 'id,name,access_token,instagram_business_account{id,username,profile_picture_url,followers_count}';

// Deterministic resolution: instead of "<adAccount>/promote_pages" (a broad
// permission-based list of pages this token COULD promote — in a shared agency
// Business Manager this can surface OTHER clients' pages first), read the page_id
// straight out of a real ad this account is running. That's a 1:1 fact tied to the
// client's actual campaigns, not a guess. promote_pages stays only as a last resort.
export async function resolvePageIdFromAds(accountId: string, token: string): Promise<string | null> {
  const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const url = `https://graph.facebook.com/v21.0/${id}/ads?fields=creative{object_story_spec{page_id},effective_object_story_id}&limit=25&access_token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json() as {
      data?: Array<{ creative?: { object_story_spec?: { page_id?: string }; effective_object_story_id?: string } }>;
    };
    for (const ad of data.data ?? []) {
      const cr = ad.creative;
      const pageId = cr?.object_story_spec?.page_id ?? cr?.effective_object_story_id?.split('_')[0];
      if (pageId) return pageId;
    }
  } catch { /* fall through to promote_pages */ }
  return null;
}

export function pageToIgResult(page: PageEntry | undefined): ResolvedIgAccount | null {
  if (!page?.instagram_business_account) return null;
  const ig = page.instagram_business_account;
  return {
    igId: ig.id,
    username: ig.username ?? ig.id,
    picture: ig.profile_picture_url,
    followers: ig.followers_count,
    pageToken: page.access_token,
  };
}

// directIgId: quando o cliente tem link platform='instagram' (picker da lista de
// clientes), casa o instagram_business_account.id contra me/accounts ANTES de
// qualquer heurística via conta de anúncio.
export async function getIgAccount(accountId: string, token: string, directIgId?: string): Promise<ResolvedIgAccount | null> {
  // Single page by ID (used for the deterministic ads-based resolution)
  const fetchSinglePage = async (url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      return pageToIgResult(await res.json() as PageEntry);
    } catch { return null; }
  };
  // List of pages (used for the promote_pages / me/accounts guesses)
  const fetchPageList = async (url: string, matchIgId?: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const data = await res.json() as { data?: PageEntry[] };
      const pages = data.data ?? [];
      if (matchIgId) return pageToIgResult(pages.find(p => p.instagram_business_account?.id === matchIgId));
      return pageToIgResult(pages.find(p => p.instagram_business_account) ?? pages[0]);
    } catch { return null; }
  };

  // 0) Deterministic: the client was linked directly to this Instagram account.
  if (directIgId) {
    const result = await fetchPageList(`https://graph.facebook.com/v21.0/me/accounts?fields=${PAGE_FIELDS}&limit=50&access_token=${token}`, directIgId);
    if (result) return result;
  }

  if (accountId) {
    const id = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    // 1) Deterministic: the page this account's own ads actually run as.
    const pageId = await resolvePageIdFromAds(accountId, token);
    if (pageId) {
      const result = await fetchSinglePage(`https://graph.facebook.com/v21.0/${pageId}?fields=${PAGE_FIELDS}&access_token=${token}`);
      if (result) return result;
    }
    // 2) Fallback only if the account has no ads yet: the old "could promote" guess.
    const result = await fetchPageList(`https://graph.facebook.com/v21.0/${id}/promote_pages?fields=${PAGE_FIELDS}&limit=5&access_token=${token}`);
    if (result) return result;
  }
  return fetchPageList(`https://graph.facebook.com/v21.0/me/accounts?fields=${PAGE_FIELDS}&limit=20&access_token=${token}`);
}

// ── Monitor de Redes Sociais: schema + snapshot ──────────────────────────────

let schemaEnsured = false;

export async function ensureSocialMonitorSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS public.social_monitor_snapshots (
       client_id           TEXT PRIMARY KEY,
       ig_id               TEXT,
       ig_username         TEXT,
       profile_picture_url TEXT,
       followers           INTEGER,
       last_post_at        TIMESTAMPTZ,
       last_post_permalink TEXT,
       last_post_thumbnail TEXT,
       last_post_caption   TEXT,
       posts_30d           INTEGER,
       avg_likes           NUMERIC,
       avg_comments        NUMERIC,
       reach_28d           BIGINT,
       red_after_days      INTEGER NOT NULL DEFAULT 2,
       error               TEXT,
       fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    `CREATE INDEX IF NOT EXISTS social_monitor_last_post_idx
       ON public.social_monitor_snapshots (last_post_at)`,
  ];
  for (const sql of stmts) await pool.query(sql).catch(() => {});
  schemaEnsured = true;
}

export type SocialSnapshot = {
  clientId: string;
  igId: string | null;
  igUsername: string | null;
  profilePicture: string | null;
  followers: number | null;
  lastPostAt: string | null;
  lastPostPermalink: string | null;
  lastPostThumbnail: string | null;
  lastPostCaption: string | null;
  posts30d: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  reach28d: number | null;
  error: string | null;
};

export type SnapshotTarget = {
  clientId: string;
  /** Conta de anúncio Meta vinculada ('' quando não há) — usada só como heurística de resolução. */
  accountId: string;
  /** instagram_business_account.id do link direto platform='instagram', se existir. */
  directIgId: string | null;
  /** Token de usuário já renovado (getFreshMetaToken). */
  token: string | null;
};

type MediaItem = {
  id: string; caption?: string; media_type?: string; media_product_type?: string;
  media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string;
  like_count?: number; comments_count?: number;
};

const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

function emptySnapshot(clientId: string, error: string | null): SocialSnapshot {
  return {
    clientId, igId: null, igUsername: null, profilePicture: null, followers: null,
    lastPostAt: null, lastPostPermalink: null, lastPostThumbnail: null, lastPostCaption: null,
    posts30d: null, avgLikes: null, avgComments: null, reach28d: null, error,
  };
}

async function fetchMedia(igId: string, pageToken: string, params: Record<string, string>): Promise<MediaItem[]> {
  const url = new URL(`https://graph.facebook.com/v21.0/${igId}/media`);
  url.searchParams.set('fields', MEDIA_FIELDS);
  url.searchParams.set('access_token', pageToken);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`media HTTP ${res.status}`);
  const data = await res.json() as { data?: MediaItem[] };
  return data.data ?? [];
}

async function fetchReach28d(igId: string, pageToken: string): Promise<number | null> {
  try {
    const until = Math.floor(Date.now() / 1000);
    const since = until - 28 * 86400;
    const url = new URL(`https://graph.facebook.com/v21.0/${igId}/insights`);
    url.searchParams.set('metric', 'reach');
    url.searchParams.set('period', 'day');
    url.searchParams.set('since', String(since));
    url.searchParams.set('until', String(until));
    url.searchParams.set('access_token', pageToken);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ name: string; values?: Array<{ value?: number }> }> };
    const series = data.data?.find(m => m.name === 'reach')?.values ?? [];
    return series.reduce((sum, v) => sum + (v.value ?? 0), 0);
  } catch { return null; }
}

/**
 * Busca o snapshot completo de um cliente na Graph API (3 chamadas típicas:
 * resolução de página, media 30d, reach 28d). Nunca lança: qualquer falha vira
 * um snapshot com `error` preenchido (linha cinza na UI, nunca some da lista).
 */
export async function fetchClientSnapshot(target: SnapshotTarget): Promise<SocialSnapshot> {
  const { clientId, accountId, directIgId, token } = target;
  if (!token) return emptySnapshot(clientId, 'Sem conexão Meta disponível');

  let ig: ResolvedIgAccount | null;
  try {
    ig = await getIgAccount(accountId, token, directIgId ?? undefined);
  } catch {
    ig = null;
  }
  if (!ig) return emptySnapshot(clientId, 'Conta do Instagram não encontrada');

  const snap: SocialSnapshot = {
    ...emptySnapshot(clientId, null),
    igId: ig.igId,
    igUsername: ig.username,
    profilePicture: ig.picture ?? null,
    followers: ig.followers ?? null,
  };

  try {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    let media = await fetchMedia(ig.igId, ig.pageToken, { limit: '50', since: String(since) });
    snap.posts30d = media.length;

    if (media.length > 0) {
      const totalLikes = media.reduce((s, m) => s + (m.like_count ?? 0), 0);
      const totalComments = media.reduce((s, m) => s + (m.comments_count ?? 0), 0);
      snap.avgLikes = Math.round((totalLikes / media.length) * 10) / 10;
      snap.avgComments = Math.round((totalComments / media.length) * 10) / 10;
    } else {
      // Nenhum post em 30 dias: busca o último post histórico — essencial para
      // "N dias sem post" quando o abandono passa de um mês.
      media = await fetchMedia(ig.igId, ig.pageToken, { limit: '1' });
    }

    const last = media[0];
    if (last) {
      const isVideo = last.media_product_type === 'REELS' || last.media_type === 'VIDEO';
      snap.lastPostAt = last.timestamp ?? null;
      snap.lastPostPermalink = last.permalink ?? null;
      snap.lastPostThumbnail = last.thumbnail_url ?? (isVideo ? null : last.media_url ?? null);
      snap.lastPostCaption = last.caption?.slice(0, 200) ?? null;
    }
  } catch (e) {
    snap.error = e instanceof Error ? e.message : 'Falha ao buscar posts';
    return snap;
  }

  snap.reach28d = await fetchReach28d(ig.igId, ig.pageToken);
  return snap;
}

/** Upsert que NUNCA toca em red_after_days — a régua configurada sobrevive ao refresh. */
export async function upsertSnapshot(pool: Pool, snap: SocialSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO public.social_monitor_snapshots (
       client_id, ig_id, ig_username, profile_picture_url, followers,
       last_post_at, last_post_permalink, last_post_thumbnail, last_post_caption,
       posts_30d, avg_likes, avg_comments, reach_28d, error, fetched_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
     ON CONFLICT (client_id) DO UPDATE SET
       ig_id = EXCLUDED.ig_id,
       ig_username = EXCLUDED.ig_username,
       profile_picture_url = EXCLUDED.profile_picture_url,
       followers = EXCLUDED.followers,
       last_post_at = EXCLUDED.last_post_at,
       last_post_permalink = EXCLUDED.last_post_permalink,
       last_post_thumbnail = EXCLUDED.last_post_thumbnail,
       last_post_caption = EXCLUDED.last_post_caption,
       posts_30d = EXCLUDED.posts_30d,
       avg_likes = EXCLUDED.avg_likes,
       avg_comments = EXCLUDED.avg_comments,
       reach_28d = EXCLUDED.reach_28d,
       error = EXCLUDED.error,
       fetched_at = now()`,
    [
      snap.clientId, snap.igId, snap.igUsername, snap.profilePicture, snap.followers,
      snap.lastPostAt, snap.lastPostPermalink, snap.lastPostThumbnail, snap.lastPostCaption,
      snap.posts30d, snap.avgLikes, snap.avgComments, snap.reach28d, snap.error,
    ],
  );
}
