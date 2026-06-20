import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveGaqlPeriod } from '@/lib/period-utils';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

export type GoogleAd = {
  id: string;
  adGroupId: string;
  name: string;
  type: string;
  status: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
};

async function getFreshToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }) {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token!;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adGroupId } = await params;
  const connectionId = req.nextUrl.searchParams.get('connectionId') ?? '';
  const accountId = req.nextUrl.searchParams.get('accountId') ?? '';
  const loginCustomerId = req.nextUrl.searchParams.get('loginCustomerId') ?? '';
  const period = req.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = req.nextUrl.searchParams.get('dateTo') ?? '';

  if (!accountId) return Response.json({ error: 'accountId é obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  let conn: { access_token: string; refresh_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Google não encontrada.' }, { status: 404 });

  const accessToken = await getFreshToken(conn);
  const gaqlPeriod = resolveGaqlPeriod(period, dateFrom, dateTo);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const query = `
    SELECT
      ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
      ad_group_ad.status, ad_group.id,
      metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
    FROM ad_group_ad
    WHERE ad_group.id = ${adGroupId}
      AND ${gaqlPeriod}
      AND ad_group_ad.status IN ('ENABLED', 'PAUSED')
      AND metrics.cost_micros > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 50
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${accountId}/googleAds:search`,
    { method: 'POST', headers, body: JSON.stringify({ query }) },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Google Ads API HTTP ${res.status}` }, { status: res.status });
  }

  const data = await res.json() as { results?: Record<string, unknown>[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ads: GoogleAd[] = (data.results ?? []).map((row: any) => {
    const ad = row.adGroupAd?.ad ?? {};
    const agRow = row.adGroup ?? {};
    const metrics = row.metrics ?? {};
    const spend = Number(metrics.costMicros ?? 0) / 1_000_000;
    const clicks = Number(metrics.clicks ?? 0);
    const impressions = Number(metrics.impressions ?? 0);
    const leads = Number(metrics.conversions ?? 0);
    return {
      id: String(ad.id),
      adGroupId: String(agRow.id ?? adGroupId),
      name: ad.name ?? ad.type ?? `Anúncio ${ad.id}`,
      type: ad.type ?? '',
      status: row.adGroupAd?.status ?? 'ENABLED',
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
