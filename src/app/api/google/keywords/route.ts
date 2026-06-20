import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveGaqlPeriod } from '@/lib/period-utils';
import { getCached, setCached, cachedJson, TTL_4H } from '@/lib/api-cache';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

export type GoogleKeyword = {
  text: string;
  matchType: string;
  campaignName: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpl: number;
};

const MATCH_TYPE_LABELS: Record<string, string> = {
  EXACT: 'Exata',
  PHRASE: 'Frase',
  BROAD: 'Ampla',
  UNSPECIFIED: '—',
  UNKNOWN: '—',
};

function normalizeGoogleCustomerId(accountId: string) {
  return accountId.replace(/\D/g, '');
}

function gadsHeaders(accessToken: string, loginCustomerId?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}

async function gadsSearch(customerId: string, query: string, accessToken: string, loginCustomerId?: string) {
  const normalizedId = normalizeGoogleCustomerId(customerId);
  if (!normalizedId) return null;
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${normalizedId}/googleAds:search`,
    { method: 'POST', headers: gadsHeaders(accessToken, loginCustomerId), body: JSON.stringify({ query }) },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[keywords] gadsSearch failed customer=${normalizedId} status=${res.status}`, errText.slice(0, 300));
    return null;
  }
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

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

async function buildMccMap(accessToken: string): Promise<Record<string, string>> {
  const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN },
  });
  if (!listRes.ok) return {};
  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
  const mccMap: Record<string, string> = {};
  await Promise.allSettled(
    resourceNames.map(async (rn) => {
      const custId = normalizeGoogleCustomerId(rn.replace('customers/', ''));
      const data = await gadsSearch(custId, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', accessToken);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (data?.results?.[0] as any)?.customer;
      if (!c?.manager) return;
      const subData = await gadsSearch(
        custId,
        'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level = 1',
        accessToken, custId,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (subData?.results ?? []) as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (r as any).customerClient;
        if (sub?.id && !sub.manager) mccMap[normalizeGoogleCustomerId(String(sub.id))] = custId;
      }
    }),
  );
  return mccMap;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeRows(pool: ReturnType<typeof makeServerPool>, query: string, params: unknown[] = []): Promise<any[]> {
  try {
    const { rows } = await pool.query(query, params);
    return rows;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return [];
    throw error;
  }
}

export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = req.nextUrl.searchParams.get('dateTo') ?? '';
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '30', 10), 100);
  const requestedClientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').map(id => id.trim()).filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;

  const gaqlPeriod = resolveGaqlPeriod(period, dateFrom, dateTo);

  const cacheKey = `google:keywords:${period}:${dateFrom}:${dateTo}:${requestedClientIds.sort().join(',')}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);


  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let googleConns: any[], links: any[];
  try {
    [googleConns, links] = await Promise.all([
      safeRows(pool, "SELECT * FROM public.google_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? safeRows(pool,
          `SELECT account_id FROM public.client_account_links
           WHERE client_id = ANY($1::text[]) AND platform = 'google_ads'`,
          [requestedClientIds])
        : Promise.resolve([]),
    ]);
  } finally {
    await pool.end();
  }

  const allAccountIds = shouldFilterByClient
    ? [...new Set(links.map((l: { account_id: string }) => normalizeGoogleCustomerId(l.account_id)).filter(Boolean))]
    : [];

  if (shouldFilterByClient && allAccountIds.length === 0) return Response.json([]);

  const keywords: GoogleKeyword[] = [];
  const seenAccounts = new Set<string>();

  await Promise.allSettled(
    googleConns.map(async (conn) => {
      const accessToken = await getFreshToken(conn);
      const mccMap = await buildMccMap(accessToken);
      const accountIds = shouldFilterByClient ? allAccountIds : Object.keys(mccMap);

      await Promise.allSettled(
        accountIds.map(async (accountId) => {
          if (seenAccounts.has(accountId)) return;
          const loginCustomerId = mccMap[accountId];

          const data = await gadsSearch(
            accountId,
            `SELECT
               ad_group_criterion.keyword.text,
               ad_group_criterion.keyword.match_type,
               campaign.name,
               ad_group.name,
               metrics.impressions,
               metrics.clicks,
               metrics.cost_micros,
               metrics.conversions,
               metrics.ctr,
               metrics.average_cpc
             FROM keyword_view
             WHERE ${gaqlPeriod}
               AND campaign.status IN ('ENABLED', 'PAUSED')
               AND ad_group.status = 'ENABLED'
               AND ad_group_criterion.status = 'ENABLED'
               AND metrics.impressions > 0
             ORDER BY metrics.impressions DESC
             LIMIT ${limit}`,
            accessToken,
            loginCustomerId,
          );

          if (data?.results?.length) seenAccounts.add(accountId);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of (data?.results ?? []) as any[]) {
            const kw = row.adGroupCriterion?.keyword ?? {};
            const m = row.metrics ?? {};
            const spend = Number(m.costMicros ?? 0) / 1_000_000;
            const conversions = Number(m.conversions ?? 0);
            const clicks = Number(m.clicks ?? 0);
            const impressions = Number(m.impressions ?? 0);
            keywords.push({
              text: kw.text ?? '—',
              matchType: MATCH_TYPE_LABELS[kw.matchType ?? ''] ?? kw.matchType ?? '—',
              campaignName: row.campaign?.name ?? '',
              adGroupName: row.adGroup?.name ?? '',
              impressions,
              clicks,
              spend,
              conversions,
              ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
              cpc: clicks > 0 ? spend / clicks : 0,
              cpl: conversions > 0 ? spend / conversions : 0,
            });
          }
        }),
      );
    }),
  );

  keywords.sort((a, b) => b.impressions - a.impressions);

  const result = keywords.slice(0, limit);
  setCached(cacheKey, result, TTL_4H);
  return cachedJson(result, false);
}
