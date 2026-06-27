import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type RelevanceRankings = {
  ad_id: string;
  quality_ranking: string | null;
  engagement_rate_ranking: string | null;
  conversion_rate_ranking: string | null;
};

async function resolveToken(connectionId: string, pool: ReturnType<typeof makeServerPool>) {
  if (connectionId) {
    const { rows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
  }
  const { rows } = await pool.query(
    `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry
       FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
  );
  if (!rows[0]) throw new Error('Conexão Meta não encontrada.');
  return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adId } = await params;
  const connectionId = req.nextUrl.searchParams.get('connectionId') ?? '';

  const pool = makeServerPool();
  let token: string;
  try {
    token = await resolveToken(connectionId, pool);
  } finally {
    await pool.end();
  }

  const url = new URL(`https://graph.facebook.com/v21.0/${adId}`);
  url.searchParams.set('fields', 'id,name,quality_ranking,engagement_rate_ranking,conversion_rate_ranking');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API ${res.status}` }, { status: res.status });
  }

  const data = await res.json() as {
    id: string;
    quality_ranking?: string;
    engagement_rate_ranking?: string;
    conversion_rate_ranking?: string;
  };

  return Response.json({
    ad_id: data.id,
    quality_ranking: data.quality_ranking ?? null,
    engagement_rate_ranking: data.engagement_rate_ranking ?? null,
    conversion_rate_ranking: data.conversion_rate_ranking ?? null,
  } satisfies RelevanceRankings);
}
