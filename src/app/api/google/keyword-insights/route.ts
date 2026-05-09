import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { google } from 'googleapis';

export type GoogleKeywordInsight = {
  keyword: string;
  matchType: string;
  accountId: string;
  accountName: string;
  campaignName: string;
  adGroupName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cpa: number;
};

export type GoogleAdPreview = {
  id: string;
  accountId: string;
  accountName: string;
  campaignName: string;
  adGroupName: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  path1?: string;
  path2?: string;
  impressions: number;
  clicks: number;
  cost: number;
};

export type GoogleKeywordInsightsResponse = {
  keywords: GoogleKeywordInsight[];
  ads: GoogleAdPreview[];
};

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

function makePool() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString) return new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  return new Pool({
    host: process.env.POSTGRES_HOST ?? 'aws-1-us-east-2.pooler.supabase.com',
    port: Number(process.env.POSTGRES_PORT ?? 6543),
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    user: process.env.POSTGRES_USER ?? 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.SUPABASE_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

function mapToGaqlPeriod(p: string): string {
  const map: Record<string, string> = {
    last_7d: 'LAST_7_DAYS',
    last_30d: 'LAST_30_DAYS',
    last_month: 'LAST_MONTH',
    this_month: 'THIS_MONTH',
  };
  return map[p] ?? 'LAST_30_DAYS';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeRows(pool: Pool, query: string, params: unknown[] = []): Promise<any[]> {
  try {
    const { rows } = await pool.query(query, params);
    return rows;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return [];
    throw error;
  }
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
  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
    { method: 'POST', headers: gadsHeaders(accessToken, loginCustomerId), body: JSON.stringify({ query }) },
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

async function getFreshGoogleToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }): Promise<string> {
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
  const listRes = await fetch('https://googleads.googleapis.com/v20/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN },
  });
  if (!listRes.ok) return {};
  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };

  const mccMap: Record<string, string> = {};
  await Promise.allSettled(
    resourceNames.map(async (rn) => {
      const custId = rn.replace('customers/', '');
      const data = await gadsSearch(custId, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', accessToken);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (data?.results?.[0] as any)?.customer;
      if (!c?.manager) return;
      const subData = await gadsSearch(
        custId,
        'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level = 1',
        accessToken,
        custId,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of (subData?.results ?? []) as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (r as any).customerClient;
        if (sub?.id && !sub.manager) mccMap[String(sub.id)] = custId;
      }
    }),
  );
  return mccMap;
}

async function fetchKeywords(accountId: string, accountName: string, accessToken: string, loginCustomerId: string | undefined, gaqlPeriod: string) {
  const data = await gadsSearch(
    accountId,
    `SELECT
       campaign.name,
       ad_group.name,
       ad_group_criterion.keyword.text,
       ad_group_criterion.keyword.match_type,
       metrics.impressions,
       metrics.clicks,
       metrics.cost_micros,
       metrics.conversions
     FROM keyword_view
     WHERE segments.date DURING ${gaqlPeriod}
       AND metrics.impressions > 0
     ORDER BY metrics.clicks DESC
     LIMIT 30`,
    accessToken,
    loginCustomerId,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.results ?? []) as any[]).map((row): GoogleKeywordInsight => {
    const metrics = row.metrics ?? {};
    const cost = Number(metrics.costMicros ?? 0) / 1_000_000;
    const clicks = Number(metrics.clicks ?? 0);
    const impressions = Number(metrics.impressions ?? 0);
    const conversions = Number(metrics.conversions ?? 0);
    return {
      keyword: row.adGroupCriterion?.keyword?.text ?? 'Palavra-chave',
      matchType: row.adGroupCriterion?.keyword?.matchType ?? 'UNKNOWN',
      accountId,
      accountName,
      campaignName: row.campaign?.name ?? 'Campanha',
      adGroupName: row.adGroup?.name ?? 'Grupo',
      impressions,
      clicks,
      cost,
      conversions,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? cost / clicks : 0,
      cpa: conversions > 0 ? cost / conversions : 0,
    };
  });
}

async function fetchAds(accountId: string, accountName: string, accessToken: string, loginCustomerId: string | undefined, gaqlPeriod: string) {
  const data = await gadsSearch(
    accountId,
    `SELECT
       campaign.name,
       ad_group.name,
       ad_group_ad.ad.id,
       ad_group_ad.ad.type,
       ad_group_ad.ad.final_urls,
       ad_group_ad.ad.responsive_search_ad.headlines,
       ad_group_ad.ad.responsive_search_ad.descriptions,
       ad_group_ad.ad.responsive_search_ad.path1,
       ad_group_ad.ad.responsive_search_ad.path2,
       ad_group_ad.ad.expanded_text_ad.headline_part1,
       ad_group_ad.ad.expanded_text_ad.headline_part2,
       ad_group_ad.ad.expanded_text_ad.headline_part3,
       ad_group_ad.ad.expanded_text_ad.description,
       ad_group_ad.ad.expanded_text_ad.description2,
       metrics.impressions,
       metrics.clicks,
       metrics.cost_micros
     FROM ad_group_ad
     WHERE segments.date DURING ${gaqlPeriod}
       AND ad_group_ad.status = ENABLED
       AND metrics.impressions > 0
     ORDER BY metrics.impressions DESC
     LIMIT 12`,
    accessToken,
    loginCustomerId,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.results ?? []) as any[]).map((row): GoogleAdPreview => {
    const ad = row.adGroupAd?.ad ?? {};
    const rsa = ad.responsiveSearchAd ?? {};
    const eta = ad.expandedTextAd ?? {};
    const metrics = row.metrics ?? {};
    const headlines = (rsa.headlines ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((asset: any) => asset.text as string)
      .filter(Boolean);
    const descriptions = (rsa.descriptions ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((asset: any) => asset.text as string)
      .filter(Boolean);

    return {
      id: String(ad.id ?? `${accountId}-${row.campaign?.name ?? 'ad'}`),
      accountId,
      accountName,
      campaignName: row.campaign?.name ?? 'Campanha',
      adGroupName: row.adGroup?.name ?? 'Grupo',
      headlines: headlines.length > 0
        ? headlines.slice(0, 4)
        : [eta.headlinePart1, eta.headlinePart2, eta.headlinePart3].filter(Boolean),
      descriptions: descriptions.length > 0
        ? descriptions.slice(0, 3)
        : [eta.description, eta.description2].filter(Boolean),
      finalUrls: ad.finalUrls ?? [],
      path1: rsa.path1 ?? undefined,
      path2: rsa.path2 ?? undefined,
      impressions: Number(metrics.impressions ?? 0),
      clicks: Number(metrics.clicks ?? 0),
      cost: Number(metrics.costMicros ?? 0) / 1_000_000,
    };
  });
}

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const requestedClientIds = (request.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;
  const gaqlPeriod = mapToGaqlPeriod(period);

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let googleConns: any[], links: any[];
  try {
    const [g, l] = await Promise.all([
      safeRows(pool, "SELECT * FROM public.google_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? safeRows(
          pool,
          `SELECT client_id, connection_id, account_id, account_name
           FROM public.client_account_links
           WHERE platform = 'google_ads'
             AND client_id = ANY($1::text[])`,
          [requestedClientIds],
        )
        : Promise.resolve([]),
    ]);
    googleConns = g;
    links = l;
  } finally {
    await pool.end();
  }

  if (shouldFilterByClient && links.length === 0) return Response.json({ keywords: [], ads: [] } satisfies GoogleKeywordInsightsResponse);

  const linksByConn = new Map<string, Array<{ id: string; name: string }>>();
  for (const link of links) {
    const list = linksByConn.get(link.connection_id) ?? [];
    list.push({ id: link.account_id, name: link.account_name ?? link.account_id });
    linksByConn.set(link.connection_id, list);
  }

  const keywords: GoogleKeywordInsight[] = [];
  const ads: GoogleAdPreview[] = [];

  await Promise.allSettled(googleConns.map(async (conn) => {
    const accessToken = await getFreshGoogleToken(conn);
    const mccMap = await buildMccMap(accessToken);
    const linkedAccounts = shouldFilterByClient ? linksByConn.get(conn.id) ?? [] : Object.keys(mccMap).map((id) => ({ id, name: id }));
    if (shouldFilterByClient && linkedAccounts.length === 0) return;

    await Promise.allSettled(linkedAccounts.map(async (account) => {
      const loginCustomerId = mccMap[account.id];
      const [accountKeywords, accountAds] = await Promise.all([
        fetchKeywords(account.id, account.name, accessToken, loginCustomerId, gaqlPeriod),
        fetchAds(account.id, account.name, accessToken, loginCustomerId, gaqlPeriod),
      ]);
      keywords.push(...accountKeywords);
      ads.push(...accountAds);
    }));
  }));

  keywords.sort((a, b) => b.clicks - a.clicks);
  ads.sort((a, b) => b.impressions - a.impressions);

  return Response.json({
    keywords: keywords.slice(0, 20),
    ads: ads.slice(0, 10),
  } satisfies GoogleKeywordInsightsResponse);
}
