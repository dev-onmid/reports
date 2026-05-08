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

function mapToGaqlPeriod(p: string): string {
  const map: Record<string, string> = {
    last_7d: 'LAST_7_DAYS', last_30d: 'LAST_30_DAYS',
    last_month: 'LAST_MONTH', this_month: 'THIS_MONTH',
  };
  return map[p] ?? 'LAST_30_DAYS';
}

function mapToMetaPeriod(p: string): string {
  const map: Record<string, string> = {
    last_7d: 'last_7_days', last_30d: 'last_30_days',
    last_month: 'last_month', this_month: 'this_month',
  };
  return map[p] ?? 'last_30_days';
}

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

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
    { method: 'POST', headers: gadsHeaders(accessToken, loginCustomerId), body: JSON.stringify({ query }) }
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

async function fetchGadsAccountMetrics(customerId: string, accessToken: string, loginCustomerId: string | undefined, gaqlPeriod: string) {
  const data = await gadsSearch(
    customerId,
    `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion
     FROM customer WHERE segments.date DURING ${gaqlPeriod}`,
    accessToken,
    loginCustomerId,
  );
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (data.results?.[0] as any)?.metrics;
  if (!m) return null;
  const spend = (m.costMicros ?? 0) / 1_000_000;
  const conversions = Number(m.conversions ?? 0);
  return {
    cost: spend,
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cpc: (m.averageCpc ?? 0) / 1_000_000,
    conversions,
    cpa: conversions > 0 ? spend / conversions : 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // This is an MCC — list its sub-accounts
      const subData = await gadsSearch(
        custId,
        'SELECT customer_client.id, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level = 1',
        accessToken,
        custId,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of subData?.results ?? [] as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (r as any).customerClient;
        if (sub?.id && !sub.manager) mccMap[String(sub.id)] = custId;
      }
    })
  );
  return mccMap;
}

const LEAD_ACTIONS = [
  'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection',
];

async function fetchMetaAccountMetrics(accountId: string, accessToken: string, metaPeriod: string) {
  const fields = 'spend,impressions,clicks,actions';
  const url = `https://graph.facebook.com/v21.0/${accountId}/insights?fields=${fields}&level=account&date_preset=${metaPeriod}&access_token=${accessToken}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  if (data.error) return null;
  const row = data.data?.[0] ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leads = ((row.actions as { action_type: string; value: string }[]) ?? [])
    .filter(a => LEAD_ACTIONS.includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
  return {
    spend: parseFloat(row.spend || '0'),
    impressions: parseInt(row.impressions || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    leads,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const gaqlPeriod = mapToGaqlPeriod(period);
  const metaPeriod = mapToMetaPeriod(period);

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[], googleConns: any[], metaConns: any[];
  try {
    const [l, g, m] = await Promise.all([
      pool.query('SELECT * FROM public.client_account_links WHERE client_id = $1', [clientId]),
      pool.query('SELECT * FROM public.google_connections'),
      pool.query('SELECT * FROM public.meta_connections'),
    ]);
    links = l.rows; googleConns = g.rows; metaConns = m.rows;
  } finally {
    await pool.end();
  }

  const gadsLinks = links.filter(l => l.platform === 'google_ads');
  const metaLinks = links.filter(l => l.platform === 'meta_ads');

  // ── Google Ads ─────────────────────────────────────────────────────────────
  type GResult = { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number };
  let googleResult: GResult | null = null;

  if (gadsLinks.length > 0) {
    // Group by connection_id so we refresh each token once
    const byConn = gadsLinks.reduce<Record<string, string[]>>((acc, l) => {
      (acc[l.connection_id] ??= []).push(l.account_id);
      return acc;
    }, {});

    const connMetrics: GResult[] = [];
    await Promise.allSettled(
      Object.entries(byConn).map(async ([connId, accountIds]) => {
        const conn = googleConns.find(c => c.id === connId);
        if (!conn) return;
        const accessToken = await getFreshGoogleToken(conn);
        const mccMap = await buildMccMap(accessToken);

        await Promise.allSettled(
          accountIds.map(async (accountId) => {
            const loginCustomerId = mccMap[accountId];
            const m = await fetchGadsAccountMetrics(accountId, accessToken, loginCustomerId, gaqlPeriod);
            if (m) connMetrics.push(m);
          })
        );
      })
    );

    if (connMetrics.length > 0) {
      const agg = connMetrics.reduce((a, m) => ({
        cost: a.cost + m.cost, impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks, conversions: a.conversions + m.conversions, cpc: 0, cpa: 0,
      }), { cost: 0, impressions: 0, clicks: 0, conversions: 0, cpc: 0, cpa: 0 });
      agg.cpc = agg.clicks > 0 ? agg.cost / agg.clicks : 0;
      agg.cpa = agg.conversions > 0 ? agg.cost / agg.conversions : 0;
      googleResult = agg;
    }
  }

  // ── Meta Ads ───────────────────────────────────────────────────────────────
  type MResult = { spend: number; impressions: number; clicks: number; leads: number; cpl: number };
  let metaResult: MResult | null = null;

  if (metaLinks.length > 0) {
    const allMetrics: Array<{ spend: number; impressions: number; clicks: number; leads: number }> = [];
    await Promise.allSettled(
      metaLinks.map(async (link) => {
        const conn = metaConns.find(c => c.id === link.connection_id);
        if (!conn) return;
        const m = await fetchMetaAccountMetrics(link.account_id, conn.access_token, metaPeriod);
        if (m) allMetrics.push(m);
      })
    );

    if (allMetrics.length > 0) {
      const agg = allMetrics.reduce((a, m) => ({
        spend: a.spend + m.spend, impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks, leads: a.leads + m.leads, cpl: 0,
      }), { spend: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 });
      agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
      metaResult = agg;
    }
  }

  return Response.json({ google: googleResult, meta: metaResult });
}
