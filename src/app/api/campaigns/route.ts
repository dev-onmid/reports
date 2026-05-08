import type { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { google } from 'googleapis';

type SortKey = 'spend' | 'leads' | 'impressions' | 'clicks' | 'cpl' | 'ctr';

export type CampaignPerformance = {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  accountId: string;
  accountName: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number;
};

function makePool() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString) {
    return new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
  }

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

function mapToMetaPeriod(p: string): string {
  const map: Record<string, string> = {
    last_7d: 'last_7_days',
    last_30d: 'last_30_days',
    last_month: 'last_month',
    this_month: 'this_month',
  };
  return map[p] ?? 'last_30_days';
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

function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function accountMatches(a: string, b: string) {
  return normalizeMetaAccountId(a) === normalizeMetaAccountId(b);
}

const META_RESULT_ACTIONS = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.lead',
  'onsite_conversion.lead',
  'onsite_web_lead',
  'onsite_web_app_lead',
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'messaging_conversation_started_7d',
  'total_messaging_connection',
  'onsite_conversion.messaging_first_reply',
];

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const sortBy = (request.nextUrl.searchParams.get('sortBy') ?? 'spend') as SortKey;
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '30', 10), 100);
  const requestedClientIds = (request.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let metaConns: any[], googleConns: any[], links: any[];
  try {
    const [m, g, l] = await Promise.all([
      pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'"),
      pool.query("SELECT * FROM public.google_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? pool.query(
          `SELECT client_id, platform, connection_id, account_id
           FROM public.client_account_links
           WHERE client_id = ANY($1::text[])
             AND platform IN ('meta_ads', 'google_ads')`,
          [requestedClientIds],
        )
        : Promise.resolve({ rows: [] }),
    ]);
    metaConns = m.rows;
    googleConns = g.rows;
    links = l.rows;
  } finally {
    await pool.end();
  }

  if (shouldFilterByClient && links.length === 0) return Response.json([]);

  const campaigns: CampaignPerformance[] = [];
  const metaPeriod = mapToMetaPeriod(period);
  const gaqlPeriod = mapToGaqlPeriod(period);

  const linksByPlatformAndConn = new Map<string, string[]>();
  for (const link of links) {
    const key = `${link.platform}:${link.connection_id}`;
    const list = linksByPlatformAndConn.get(key) ?? [];
    list.push(link.account_id);
    linksByPlatformAndConn.set(key, list);
  }

  await Promise.allSettled(
    metaConns.map(async (conn) => {
      const token = conn.access_token as string;
      const allowed = shouldFilterByClient ? linksByPlatformAndConn.get(`meta_ads:${conn.id}`) ?? [] : [];
      if (shouldFilterByClient && allowed.length === 0) return;

      const acctRes = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=100&access_token=${token}`);
      if (!acctRes.ok) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acctData = await acctRes.json() as { data?: any[] };
      const accounts = shouldFilterByClient
        ? (acctData.data ?? []).filter((account) => allowed.some((id) => accountMatches(id, account.id)))
        : acctData.data ?? [];

      await Promise.allSettled(
        accounts.map(async (account) => {
          const url = new URL(`https://graph.facebook.com/v21.0/${account.id}/insights`);
          url.searchParams.set('level', 'campaign');
          url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions');
          url.searchParams.set('date_preset', metaPeriod);
          url.searchParams.set('sort', 'spend_descending');
          url.searchParams.set('limit', String(limit));
          url.searchParams.set('access_token', token);

          const res = await fetch(url.toString());
          if (!res.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = await res.json() as { data?: any[] };
          for (const row of data.data ?? []) {
            const spend = parseFloat(row.spend || '0');
            if (spend <= 0) continue;
            const impressions = parseInt(row.impressions || '0', 10);
            const clicks = parseInt(row.clicks || '0', 10);
            const leads = ((row.actions ?? []) as { action_type: string; value: string }[])
              .filter(a => META_RESULT_ACTIONS.includes(a.action_type))
              .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
            campaigns.push({
              id: row.campaign_id,
              name: row.campaign_name ?? `Campanha ${row.campaign_id}`,
              platform: 'meta',
              accountId: account.id,
              accountName: account.name,
              spend,
              impressions,
              clicks,
              leads,
              ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
              cpc: clicks > 0 ? spend / clicks : 0,
              cpl: leads > 0 ? spend / leads : 0,
            });
          }
        }),
      );
    }),
  );

  await Promise.allSettled(
    googleConns.map(async (conn) => {
      const allowed = shouldFilterByClient ? linksByPlatformAndConn.get(`google_ads:${conn.id}`) ?? [] : [];
      if (shouldFilterByClient && allowed.length === 0) return;

      const accessToken = await getFreshGoogleToken(conn);
      const mccMap = await buildMccMap(accessToken);
      const accountIds = shouldFilterByClient ? allowed : Object.keys(mccMap);

      await Promise.allSettled(
        accountIds.map(async (accountId) => {
          const loginCustomerId = mccMap[accountId];
          const data = await gadsSearch(
            accountId,
            `SELECT campaign.id, campaign.name, campaign.status,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions
             FROM campaign
             WHERE segments.date DURING ${gaqlPeriod}
               AND campaign.status = ENABLED
               AND metrics.cost_micros > 0
             ORDER BY metrics.cost_micros DESC
             LIMIT ${limit}`,
            accessToken,
            loginCustomerId,
          );

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          for (const row of (data?.results ?? []) as any[]) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const campaign = (row as any).campaign ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const metrics = (row as any).metrics ?? {};
            const spend = Number(metrics.costMicros ?? 0) / 1_000_000;
            if (spend <= 0) continue;
            const clicks = Number(metrics.clicks ?? 0);
            const impressions = Number(metrics.impressions ?? 0);
            const leads = Number(metrics.conversions ?? 0);
            campaigns.push({
              id: String(campaign.id),
              name: campaign.name ?? `Campanha ${campaign.id}`,
              platform: 'google',
              accountId,
              accountName: accountId,
              spend,
              impressions,
              clicks,
              leads,
              ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
              cpc: clicks > 0 ? spend / clicks : 0,
              cpl: leads > 0 ? spend / leads : 0,
            });
          }
        }),
      );
    }),
  );

  campaigns.sort((a, b) => {
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    if (sortBy === 'cpl') return av - bv;
    return bv - av;
  });

  return Response.json(campaigns.slice(0, limit));
}
