import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { google } from 'googleapis';

function makePool() {
  return new Pool({
    host: 'aws-1-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

async function getFreshAccessToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }): Promise<string> {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials.access_token!;
}

type AdsMetrics = {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  conversions: number;
  conversionValue: number;
  cpa: number;
  roas: number;
};

type AdsAccount = {
  id: string;
  name: string;
  currency: string;
  status: string;
  isManager: boolean;
  mccId?: string;
  metrics?: AdsMetrics;
};

function makeHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
  const h: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) h['login-customer-id'] = loginCustomerId;
  return h;
}

async function gadsSearch(customerId: string, query: string, accessToken: string, developerToken: string, loginCustomerId?: string) {
  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: makeHeaders(accessToken, developerToken, loginCustomerId),
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

async function fetchAccountMetrics(customerId: string, accessToken: string, developerToken: string, loginCustomerId?: string, period = 'THIS_MONTH'): Promise<AdsMetrics | null> {
  const data = await gadsSearch(
    customerId,
    `SELECT
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value,
      metrics.cost_per_conversion,
      metrics.search_impression_share,
      metrics.all_conversions,
      metrics.all_conversions_value
    FROM customer
    WHERE segments.date DURING ${period}`,
    accessToken,
    developerToken,
    loginCustomerId
  );
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (data.results?.[0] as any)?.metrics;
  if (!m) return null;

  const spend = (m.costMicros ?? 0) / 1_000_000;
  const conversions = Number(m.conversions ?? 0);
  const conversionValue = Number(m.conversionsValue ?? 0);

  return {
    spend,
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    ctr: (m.ctr ?? 0) * 100,
    cpc: (m.averageCpc ?? 0) / 1_000_000,
    conversions,
    conversionValue,
    cpa: conversions > 0 ? spend / conversions : 0,
    roas: spend > 0 ? conversionValue / spend : 0,
  };
}

async function fetchCustomerInfo(customerId: string, accessToken: string, developerToken: string, loginCustomerId?: string): Promise<AdsAccount | null> {
  const data = await gadsSearch(
    customerId,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status, customer.manager FROM customer LIMIT 1',
    accessToken,
    developerToken,
    loginCustomerId
  );
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (data.results?.[0] as any)?.customer;
  if (!c) return null;
  return {
    id: customerId,
    name: c.descriptiveName ?? `Conta ${customerId}`,
    currency: c.currencyCode ?? 'BRL',
    status: c.status ?? 'ENABLED',
    isManager: c.manager ?? false,
  };
}

async function fetchMccSubAccounts(mccId: string, accessToken: string, developerToken: string): Promise<AdsAccount[]> {
  const data = await gadsSearch(
    mccId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
            customer_client.status, customer_client.manager, customer_client.level
     FROM customer_client
     WHERE customer_client.level = 1`,
    accessToken,
    developerToken,
    mccId
  );
  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((r: any) => r.customerClient).filter(Boolean).map((c: any) => ({
    id: String(c.id ?? ''),
    name: c.descriptiveName ?? `Conta ${c.id}`,
    currency: c.currencyCode ?? 'BRL',
    status: c.status ?? 'ENABLED',
    isManager: c.manager ?? false,
    mccId,
  }));
}

export async function GET(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  const period = request.nextUrl.searchParams.get('period') ?? 'THIS_MONTH';
  if (!connectionId) return Response.json({ error: 'Missing connectionId' }, { status: 400 });

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    const { rows } = await pool.query('SELECT * FROM public.google_connections WHERE id = $1', [connectionId]);
    conn = rows[0];
  } finally {
    await pool.end();
  }
  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 });

  const accessToken = await getFreshAccessToken(conn);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

  const listRes = await fetch('https://googleads.googleapis.com/v20/customers:listAccessibleCustomers', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'developer-token': developerToken },
  });
  if (!listRes.ok) {
    const body = await listRes.text();
    return Response.json({ error: body }, { status: listRes.status });
  }

  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };

  const topLevel = (
    await Promise.allSettled(
      resourceNames.map((r: string) => fetchCustomerInfo(r.replace('customers/', ''), accessToken, developerToken))
    )
  )
    .filter((r): r is PromiseFulfilledResult<AdsAccount> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  const subAccountArrays = await Promise.allSettled(
    topLevel.filter((a) => a.isManager).map((a) => fetchMccSubAccounts(a.id, accessToken, developerToken))
  );
  const subAccounts = subAccountArrays
    .filter((r): r is PromiseFulfilledResult<AdsAccount[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const topIds = new Set(topLevel.map((a) => a.id));
  const allAccounts = [...topLevel, ...subAccounts.filter((a) => !topIds.has(a.id))];

  // Fetch metrics for all accounts in parallel
  const withMetrics = await Promise.allSettled(
    allAccounts.map(async (account) => {
      if (account.isManager) return { ...account };
      const metrics = await fetchAccountMetrics(account.id, accessToken, developerToken, account.mccId, period);
      return { ...account, metrics: metrics ?? undefined };
    })
  );

  const result = withMetrics
    .filter((r): r is PromiseFulfilledResult<AdsAccount> => r.status === 'fulfilled')
    .map((r) => r.value);

  return Response.json(result);
}
