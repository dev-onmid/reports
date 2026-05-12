import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  body?: string;
  title?: string;
  imageUrl?: string;
  creativeId?: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: campaignId } = await params;
  const connectionId = req.nextUrl.searchParams.get('connectionId') ?? '';

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      conn = rows[0] ?? null;
    }
    if (!conn) {
      const { rows } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = rows[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Meta não encontrada.' }, { status: 404 });

  const token = await getFreshMetaToken(conn);
  const url = new URL(`https://graph.facebook.com/v21.0/${campaignId}/ads`);
  url.searchParams.set('fields', 'id,name,status,effective_status,creative{id,body,title,thumbnail_url,effective_object_story_spec}');
  url.searchParams.set('limit', '20');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API HTTP ${res.status}` }, { status: res.status });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { data?: any[] };
  const ads: MetaAd[] = (data.data ?? []).map((ad) => {
    const cr = ad.creative ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec = cr.effective_object_story_spec as any;
    const linkData = spec?.link_data ?? spec?.video_data ?? spec?.photo_data ?? {};
    return {
      id: ad.id,
      name: ad.name,
      status: ad.effective_status ?? ad.status ?? 'ACTIVE',
      body: cr.body ?? linkData.message ?? '',
      title: cr.title ?? linkData.name ?? '',
      imageUrl: cr.thumbnail_url ?? linkData.picture ?? '',
      creativeId: cr.id,
    };
  });

  return Response.json(ads);
}
