import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureSocialMonitorSchema } from '@/lib/instagram-monitor';

export const dynamic = 'force-dynamic';

type SnapshotRow = {
  client_id: string;
  ig_id: string | null;
  ig_username: string | null;
  profile_picture_url: string | null;
  followers: number | null;
  last_post_at: string | null;
  last_post_permalink: string | null;
  last_post_thumbnail: string | null;
  last_post_caption: string | null;
  posts_30d: number | null;
  avg_likes: string | null;   // NUMERIC chega como string no pg
  avg_comments: string | null;
  reach_28d: string | null;   // BIGINT chega como string no pg
  red_after_days: number;
  error: string | null;
  fetched_at: string;
};

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureSocialMonitorSchema(pool);
    const { rows } = await pool.query(`SELECT * FROM public.social_monitor_snapshots`);
    const snapshots = (rows as SnapshotRow[]).map(r => ({
      clientId: r.client_id,
      igId: r.ig_id,
      igUsername: r.ig_username,
      profilePicture: r.profile_picture_url,
      followers: r.followers,
      lastPostAt: r.last_post_at,
      lastPostPermalink: r.last_post_permalink,
      lastPostThumbnail: r.last_post_thumbnail,
      lastPostCaption: r.last_post_caption,
      posts30d: r.posts_30d,
      avgLikes: r.avg_likes !== null ? Number(r.avg_likes) : null,
      avgComments: r.avg_comments !== null ? Number(r.avg_comments) : null,
      reach28d: r.reach_28d !== null ? Number(r.reach_28d) : null,
      redAfterDays: r.red_after_days,
      error: r.error,
      fetchedAt: r.fetched_at,
    }));
    const lastRunAt = snapshots.reduce<string | null>(
      (max, s) => (!max || s.fetchedAt > max ? s.fetchedAt : max), null,
    );
    return Response.json({ snapshots, lastRunAt });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao carregar monitor' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// Salva a régua de alerta por cliente (dias sem post para ficar vermelho).
// Funciona antes mesmo da 1ª coleta: o INSERT cria a linha só com a config.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as { clientId?: string; redAfterDays?: number } | null;
  const clientId = String(body?.clientId ?? '').trim();
  const redAfterDays = Number(body?.redAfterDays);
  if (!clientId || !Number.isInteger(redAfterDays) || redAfterDays < 1 || redAfterDays > 90) {
    return Response.json({ error: 'clientId e redAfterDays (inteiro 1–90) são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureSocialMonitorSchema(pool);
    await pool.query(
      `INSERT INTO public.social_monitor_snapshots (client_id, red_after_days)
       VALUES ($1, $2)
       ON CONFLICT (client_id) DO UPDATE SET red_after_days = EXCLUDED.red_after_days`,
      [clientId, redAfterDays],
    );
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Erro ao salvar régua' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
