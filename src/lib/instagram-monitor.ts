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
  /** Página do Facebook dona da conta IG — usada pelo Sorteador pra listar posts/comentários do FB. */
  pageId?: string; pageName?: string;
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
    pageId: page.id,
    pageName: page.name,
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
  // Match DETERMINÍSTICO: acha a página cujo instagram_business_account.id bate
  // com o id do link direto. Nunca "chuta" — se não achar exato, retorna null.
  const fetchPageMatching = async (url: string, matchIgId: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const data = await res.json() as { data?: PageEntry[] };
      return pageToIgResult((data.data ?? []).find(p => p.instagram_business_account?.id === matchIgId));
    } catch { return null; }
  };

  // Fallback SEGURO: só resolve quando a lista tem EXATAMENTE UMA página com conta
  // IG (conexão/conta de cliente único). Numa conexão de agência com várias páginas,
  // "a primeira" era um chute que puxava a conta de OUTRO cliente (bug @istambulgastrobar
  // aparecendo em Istambul, La Pasta Gialla, Leone Gelateria, Sorrifácil Rio Branco…).
  const fetchUniqueIgPage = async (url: string) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) return null;
      const data = await res.json() as { data?: PageEntry[] };
      const withIg = (data.data ?? []).filter(p => p.instagram_business_account);
      return withIg.length === 1 ? pageToIgResult(withIg[0]) : null;
    } catch { return null; }
  };

  // 0) Deterministic: the client was linked directly to this Instagram account.
  if (directIgId) {
    const result = await fetchPageMatching(`https://graph.facebook.com/v21.0/me/accounts?fields=${PAGE_FIELDS}&limit=100&access_token=${token}`, directIgId);
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
    // 2) Conta sem anúncios: usa promote_pages SÓ se for inequívoco (1 página IG).
    const result = await fetchUniqueIgPage(`https://graph.facebook.com/v21.0/${id}/promote_pages?fields=${PAGE_FIELDS}&limit=25&access_token=${token}`);
    if (result) return result;
  }
  // 3) Último recurso: me/accounts SÓ se a conexão tiver 1 página IG (cliente único).
  //    Conexão com várias páginas → ambíguo → null (cliente aparece "sem conta").
  return fetchUniqueIgPage(`https://graph.facebook.com/v21.0/me/accounts?fields=${PAGE_FIELDS}&limit=100&access_token=${token}`);
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
       monitored           BOOLEAN NOT NULL DEFAULT TRUE,
       error               TEXT,
       fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    // Tabela pode já existir sem a coluna (deploy anterior)
    `ALTER TABLE public.social_monitor_snapshots
       ADD COLUMN IF NOT EXISTS monitored BOOLEAN NOT NULL DEFAULT TRUE`,
    // Ganho LÍQUIDO de seguidores no período. ⚠️ NÃO é `followers`, que é
    // snapshot total e ignora since/until — comparar dois totais daria sempre 0.
    `ALTER TABLE public.social_monitor_snapshots
       ADD COLUMN IF NOT EXISTS followers_gained_28d BIGINT`,
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
  followersGained28d: number | null;
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
    posts30d: null, avgLikes: null, avgComments: null, reach28d: null,
    followersGained28d: null, error,
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

/**
 * Soma a série DIÁRIA de uma métrica de perfil nos últimos 28 dias.
 * ⚠️ Sem `metric_type`: `follower_count` só responde como série diária.
 */
async function fetchMetricSum28d(igId: string, pageToken: string, metric: string): Promise<number | null> {
  try {
    const until = Math.floor(Date.now() / 1000);
    const since = until - 28 * 86400;
    const url = new URL(`https://graph.facebook.com/v21.0/${igId}/insights`);
    url.searchParams.set('metric', metric);
    url.searchParams.set('period', 'day');
    url.searchParams.set('since', String(since));
    url.searchParams.set('until', String(until));
    url.searchParams.set('access_token', pageToken);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ name: string; values?: Array<{ value?: number }> }> };
    const serie = data.data?.find(m => m.name === metric)?.values;
    if (!serie) return null;   // métrica ausente ≠ zero
    return serie.reduce((sum, v) => sum + (v.value ?? 0), 0);
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

  // As duas séries em paralelo — +1 chamada Graph por conta por coleta.
  const [reach, ganho] = await Promise.all([
    fetchMetricSum28d(ig.igId, ig.pageToken, 'reach'),
    fetchMetricSum28d(ig.igId, ig.pageToken, 'follower_count'),
  ]);
  snap.reach28d = reach;
  snap.followersGained28d = ganho;
  return snap;
}

/** Upsert que NUNCA toca em red_after_days — a régua configurada sobrevive ao refresh. */
export async function upsertSnapshot(pool: Pool, snap: SocialSnapshot): Promise<void> {
  await pool.query(
    `INSERT INTO public.social_monitor_snapshots (
       client_id, ig_id, ig_username, profile_picture_url, followers,
       last_post_at, last_post_permalink, last_post_thumbnail, last_post_caption,
       posts_30d, avg_likes, avg_comments, reach_28d, followers_gained_28d, error, fetched_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
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
       followers_gained_28d = EXCLUDED.followers_gained_28d,
       error = EXCLUDED.error,
       fetched_at = now()`,
    [
      snap.clientId, snap.igId, snap.igUsername, snap.profilePicture, snap.followers,
      snap.lastPostAt, snap.lastPostPermalink, snap.lastPostThumbnail, snap.lastPostCaption,
      snap.posts30d, snap.avgLikes, snap.avgComments, snap.reach28d,
      snap.followersGained28d, snap.error,
    ],
  );
}

// ── Resolução em LOTE (compartilhada) ────────────────────────────────────────
//
// Esta parte vivia dentro de /api/social-monitor/refresh/route.ts. Virou lib
// porque o Planejador de Publicações precisa exatamente da mesma coisa: dado um
// punhado de clientes, "qual conta IG e com qual page token".
//
// ⚠️ NENHUMA resolução nova foi escrita aqui — é o mesmo caminho de sempre
// (links → conexão → token fresco → getIgAccount). Reescrever reintroduziria o
// bug de conta cruzada corrigido em 04/08, em que o fallback chutava a primeira
// página da conexão e vários clientes recebiam a MESMA conta.

export type LinkRow = {
  client_id: string; connection_id: string | null; account_id: string | null; platform: string;
};

export type InsumoMeta = {
  clientId: string;
  accountId: string;
  directIgId: string | null;
  token: Promise<string | null>;
  /** Clientes que compartilham conta têm a mesma chave — serve para não repetir chamadas na Graph. */
  cacheKey: string;
};

/**
 * Resolve os INSUMOS da Graph para cada cliente (conta de anúncio, IG direto e
 * token). Devolve o token como Promise porque ele é renovado UMA vez por
 * conexão, não por cliente.
 */
export async function resolverInsumosMeta(
  pool: Pool,
  clientIds: string[],
  getFreshToken: (conn: ConnRow) => Promise<string>,
): Promise<InsumoMeta[]> {
  if (clientIds.length === 0) return [];

  const { rows: links } = await pool.query(
    `SELECT client_id, connection_id, account_id, platform
       FROM public.client_account_links
      WHERE client_id = ANY($1) AND platform IN ('meta_ads','meta','instagram')
      ORDER BY created_at ASC`,
    [clientIds],
  );
  const linksByClient = new Map<string, LinkRow[]>();
  for (const l of links as LinkRow[]) {
    const list = linksByClient.get(l.client_id) ?? [];
    list.push(l);
    linksByClient.set(l.client_id, list);
  }

  const { rows: fallbackRows } = await pool.query(
    `SELECT id FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
  );
  const fallbackConnId: string | null = fallbackRows[0]?.id ?? null;

  const connIds = [...new Set([
    ...(links as LinkRow[]).map(l => l.connection_id).filter((id): id is string => Boolean(id)),
    ...(fallbackConnId ? [fallbackConnId] : []),
  ])];
  const { rows: conns } = connIds.length
    ? await pool.query(`SELECT * FROM public.meta_connections WHERE id = ANY($1) AND status = 'connected'`, [connIds])
    : { rows: [] };
  const connMap = new Map<string, ConnRow>((conns as ConnRow[]).map(c => [c.id, c]));

  const tokenCache = new Map<string, Promise<string | null>>();
  const tokenFor = (connId: string | null): Promise<string | null> => {
    if (!connId) return Promise.resolve(null);
    if (!tokenCache.has(connId)) {
      const conn = connMap.get(connId);
      tokenCache.set(connId, conn ? getFreshToken(conn).catch(() => null) : Promise.resolve(null));
    }
    return tokenCache.get(connId)!;
  };

  return clientIds.map((clientId) => {
    const clientLinks = linksByClient.get(clientId) ?? [];
    const igLink = clientLinks.find(l => l.platform === 'instagram' && l.account_id);
    const adsLink = clientLinks.find(l => l.platform !== 'instagram' && (l.connection_id || l.account_id));
    const connId = adsLink?.connection_id ?? igLink?.connection_id ?? fallbackConnId;
    const accountId = adsLink?.account_id ?? '';
    const directIgId = igLink?.account_id ?? null;
    return {
      clientId, accountId, directIgId,
      token: tokenFor(connId),
      cacheKey: `${connId ?? ''}|${accountId}|${directIgId ?? ''}`,
    };
  });
}

/**
 * Resolve a conta IG publicável de cada cliente. Cliente sem conta resolvível
 * entra no mapa com `null` — o chamador precisa distinguir "não tem conta" de
 * "não foi pedido", e sumir com o cliente em silêncio esconderia o motivo.
 */
export async function resolverContasIg(
  pool: Pool,
  clientIds: string[],
  getFreshToken: (conn: ConnRow) => Promise<string>,
): Promise<Map<string, ResolvedIgAccount | null>> {
  const insumos = await resolverInsumosMeta(pool, clientIds, getFreshToken);
  const cache = new Map<string, Promise<ResolvedIgAccount | null>>();
  const saida = new Map<string, ResolvedIgAccount | null>();

  await Promise.all(insumos.map(async (ins) => {
    if (!cache.has(ins.cacheKey)) {
      cache.set(ins.cacheKey, (async () => {
        const token = await ins.token;
        if (!token) return null;
        try {
          return await getIgAccount(ins.accountId, token, ins.directIgId ?? undefined);
        } catch { return null; }
      })());
    }
    saida.set(ins.clientId, await cache.get(ins.cacheKey)!);
  }));
  return saida;
}
