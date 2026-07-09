import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolveMetaPeriod } from '@/lib/period-utils';
import { countMetaResults } from '@/lib/meta-results';

export type MetaAdWithMetrics = {
  id: string;
  name: string;
  status: string;
  body?: string;
  title?: string;
  imageUrl?: string;
  creativeId?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adsetId } = await params;
  const connectionId = req.nextUrl.searchParams.get('connectionId') ?? '';
  const period = req.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = req.nextUrl.searchParams.get('dateTo') ?? '';

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

  const metaPeriod = resolveMetaPeriod(period, dateFrom, dateTo);
  const [, since, until] = metaPeriod.split(':');
  const insightField = `insights.time_range(${JSON.stringify({ since, until })}){spend,impressions,clicks,actions}`;

  const url = new URL(`https://graph.facebook.com/v21.0/${adsetId}/ads`);
  url.searchParams.set('fields', `id,name,status,effective_status,creative{id,body,title,image_url,thumbnail_url},${insightField}`);
  url.searchParams.set('limit', '50');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API HTTP ${res.status}` }, { status: res.status });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { data?: any[] };
  const ads: MetaAdWithMetrics[] = (data.data ?? []).map((ad) => {
    const cr = ad.creative ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const insightRow = (ad.insights?.data?.[0] ?? {}) as Record<string, any>;
    const spend = parseFloat(insightRow.spend ?? '0');
    const impressions = parseInt(insightRow.impressions ?? '0', 10);
    const clicks = parseInt(insightRow.clicks ?? '0', 10);
    const leads = countMetaResults((insightRow.actions ?? []) as { action_type: string; value: string }[]);

    return {
      id: ad.id,
      name: ad.name,
      status: ad.effective_status ?? ad.status ?? 'ACTIVE',
      body: cr.body ?? '',
      title: cr.title ?? '',
      imageUrl: cr.image_url ?? cr.thumbnail_url ?? '',
      creativeId: cr.id,
      spend,
      impressions,
      clicks,
      leads,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpl: leads > 0 ? spend / leads : 0,
    };
  });

  return Response.json(ads);
}
