// Sorteador — lado servidor: resolve a conta social do cliente (reusa a
// resolução canônica de instagram-monitor) e busca posts/comentários na Graph
// API. Consumido pelas rotas /api/sorteios/*. Server-only (importa pg via tipos
// e meta-token) — a lógica pura das regras vive em src/lib/sorteio.ts.
import type { Pool } from 'pg';
import { getFreshMetaToken } from '@/lib/meta-token';
import { getIgAccount, type ConnRow, type ResolvedIgAccount } from '@/lib/instagram-monitor';
import type { ComentarioSorteio, RedeSorteio } from '@/lib/sorteio';

const GRAPH = 'https://graph.facebook.com/v21.0';

export type PostSorteio = {
  rede: RedeSorteio;
  id: string;
  legenda: string;
  permalink: string;
  thumb?: string;
  timestamp?: string;
  comentarios: number;
  curtidas: number;
  mediaType?: string;
};

export type ContaSorteio = ResolvedIgAccount & { clientId: string };

type LinkRow = { client_id: string; connection_id: string | null; account_id: string | null; platform: string };

// Mesma ordem de resolução do Monitor Social: link direto de Instagram vence,
// conta de anúncios em seguida, fallback = conexão conectada mais recente.
export async function resolveContaDoCliente(pool: Pool, clientId: string): Promise<ContaSorteio | null> {
  const { rows: links } = await pool.query<LinkRow>(
    `SELECT client_id, connection_id, account_id, platform
       FROM public.client_account_links
      WHERE client_id = $1 AND platform IN ('meta_ads','meta','instagram')`,
    [clientId],
  );
  const igLink = links.find((l) => l.platform === 'instagram' && l.account_id);
  const adsLink = links.find((l) => l.platform !== 'instagram' && (l.connection_id || l.account_id));
  const connId = adsLink?.connection_id ?? igLink?.connection_id ?? null;

  let conn: ConnRow | undefined;
  if (connId) {
    const { rows } = await pool.query<ConnRow>(
      `SELECT * FROM public.meta_connections WHERE id = $1 AND status = 'connected'`, [connId],
    );
    conn = rows[0];
  }
  if (!conn) {
    const { rows } = await pool.query<ConnRow>(
      `SELECT * FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
    );
    conn = rows[0];
  }
  if (!conn) return null;

  const token = await getFreshMetaToken(conn);
  const ig = await getIgAccount(adsLink?.account_id ?? '', token, igLink?.account_id ?? undefined);
  if (!ig) return null;
  return { ...ig, clientId };
}

async function graphGet<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

export async function listarPosts(conta: ContaSorteio): Promise<PostSorteio[]> {
  const posts: PostSorteio[] = [];

  const igUrl = new URL(`${GRAPH}/${conta.igId}/media`);
  igUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,comments_count,like_count');
  igUrl.searchParams.set('limit', '30');
  igUrl.searchParams.set('access_token', conta.pageToken);
  const igData = await graphGet<{ data?: Array<{
    id: string; caption?: string; media_type?: string; media_product_type?: string;
    thumbnail_url?: string; media_url?: string; permalink?: string; timestamp?: string;
    comments_count?: number; like_count?: number;
  }> }>(igUrl.toString());
  for (const m of igData?.data ?? []) {
    const isVideo = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
    posts.push({
      rede: 'instagram',
      id: m.id,
      legenda: m.caption ?? '',
      permalink: m.permalink ?? '',
      thumb: m.thumbnail_url ?? (isVideo ? undefined : m.media_url),
      timestamp: m.timestamp,
      comentarios: m.comments_count ?? 0,
      curtidas: m.like_count ?? 0,
      mediaType: m.media_product_type ?? m.media_type,
    });
  }

  if (conta.pageId) {
    const fbUrl = new URL(`${GRAPH}/${conta.pageId}/posts`);
    fbUrl.searchParams.set('fields', 'id,message,permalink_url,created_time,full_picture,comments.summary(true).limit(0),reactions.summary(true).limit(0)');
    fbUrl.searchParams.set('limit', '30');
    fbUrl.searchParams.set('access_token', conta.pageToken);
    const fbData = await graphGet<{ data?: Array<{
      id: string; message?: string; permalink_url?: string; created_time?: string; full_picture?: string;
      comments?: { summary?: { total_count?: number } };
      reactions?: { summary?: { total_count?: number } };
    }> }>(fbUrl.toString());
    for (const p of fbData?.data ?? []) {
      posts.push({
        rede: 'facebook',
        id: p.id,
        legenda: p.message ?? '',
        permalink: p.permalink_url ?? '',
        thumb: p.full_picture,
        timestamp: p.created_time,
        comentarios: p.comments?.summary?.total_count ?? 0,
        curtidas: p.reactions?.summary?.total_count ?? 0,
      });
    }
  }

  return posts;
}

export type ImportacaoComentarios = {
  comentarios: ComentarioSorteio[];
  /** true quando parou pelo cap/orçamento — pode haver comentários não importados. */
  truncado: boolean;
};

const MAX_COMENTARIOS = 5000;

// Importa TODOS os comentários do post, paginando até o cap ou o orçamento de
// tempo (deadlineMs). IG: top-level + até 50 respostas por comentário (campo
// replies). FB: filter=stream achata respostas (parent{id} marca isReply).
export async function importarComentarios(
  conta: ContaSorteio,
  rede: RedeSorteio,
  postId: string,
  deadlineMs: number,
): Promise<ImportacaoComentarios> {
  const comentarios: ComentarioSorteio[] = [];
  let truncado = false;

  let next: string | null = rede === 'instagram'
    ? `${GRAPH}/${postId}/comments?fields=${encodeURIComponent('id,text,username,timestamp,like_count,from{id,username},replies{id,text,username,timestamp,like_count,from{id,username}}')}&limit=50&access_token=${encodeURIComponent(conta.pageToken)}`
    : `${GRAPH}/${postId}/comments?fields=${encodeURIComponent('id,message,from{id,name},created_time,like_count,parent{id},message_tags')}&filter=stream&order=chronological&limit=100&access_token=${encodeURIComponent(conta.pageToken)}`;

  while (next) {
    if (Date.now() > deadlineMs || comentarios.length >= MAX_COMENTARIOS) { truncado = true; break; }

    if (rede === 'instagram') {
      type IgComment = {
        id: string; text?: string; username?: string; timestamp?: string; like_count?: number;
        from?: { id?: string; username?: string };
        replies?: { data?: IgComment[] };
      };
      const page: { data?: IgComment[]; paging?: { next?: string } } | null =
        await graphGet<{ data?: IgComment[]; paging?: { next?: string } }>(next);
      if (!page) break;
      for (const c of page.data ?? []) {
        const username = c.from?.username ?? c.username ?? '';
        if (username) {
          comentarios.push({
            id: c.id, username, userId: c.from?.id, texto: c.text ?? '',
            timestamp: c.timestamp, likeCount: c.like_count, isReply: false,
          });
        }
        for (const r of c.replies?.data ?? []) {
          const ru = r.from?.username ?? r.username ?? '';
          if (!ru) continue;
          comentarios.push({
            id: r.id, username: ru, userId: r.from?.id, texto: r.text ?? '',
            timestamp: r.timestamp, likeCount: r.like_count, isReply: true,
          });
        }
      }
      next = page.paging?.next ?? null;
    } else {
      type FbComment = {
        id: string; message?: string; created_time?: string; like_count?: number;
        from?: { id?: string; name?: string };
        parent?: { id?: string };
        message_tags?: Array<{ name?: string }>;
      };
      const page: { data?: FbComment[]; paging?: { next?: string } } | null =
        await graphGet<{ data?: FbComment[]; paging?: { next?: string } }>(next);
      if (!page) break;
      for (const c of page.data ?? []) {
        // Sem `from` = perfil que restringiu apps — não dá pra identificar nem
        // premiar; fica fora em vez de virar "anônimo" no sorteio.
        if (!c.from?.name) continue;
        comentarios.push({
          id: c.id,
          username: c.from.name,
          userId: c.from.id,
          texto: c.message ?? '',
          timestamp: c.created_time,
          likeCount: c.like_count,
          isReply: Boolean(c.parent?.id),
          mencoes: (c.message_tags ?? []).map((t: { name?: string }) => t.name ?? '').filter(Boolean),
        });
      }
      next = page.paging?.next ?? null;
    }
  }

  return { comentarios, truncado };
}
