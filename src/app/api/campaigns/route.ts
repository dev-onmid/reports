import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { getFreshMetaToken } from '@/lib/meta-token';

type SortKey = 'spend' | 'leads' | 'impressions' | 'clicks' | 'cpl' | 'ctr';

export type CampaignPerformance = {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  accountId: string;
  accountName: string;
  connectionId: string;
  loginCustomerId?: string;
  status: string;
  objective?: string;
  dailyBudget?: number;
  budgetResourceName?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number;
  searchImprShare?: number;
  searchBudgetLostIS?: number;
  searchAbsTopIS?: number;
};

function normalizeMetaObjective(objective: string | undefined): string | null {
  if (!objective) return null;
  const obj = objective.toUpperCase();
  if (['OUTCOME_LEADS', 'LEAD_GENERATION'].includes(obj)) return 'leads';
  if (['OUTCOME_TRAFFIC', 'LINK_CLICKS', 'TRAFFIC'].includes(obj)) return 'trafego';
  if (['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES', 'STORE_VISITS'].includes(obj)) return 'vendas';
  if (['OUTCOME_ENGAGEMENT', 'ENGAGEMENT', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'PAGE_LIKES'].includes(obj)) return 'engajamento';
  if (['OUTCOME_AWARENESS', 'BRAND_AWARENESS', 'REACH'].includes(obj)) return 'reconhecimento';
  if (['OUTCOME_APP_PROMOTION', 'APP_INSTALLS'].includes(obj)) return 'app';
  return null;
}

function normalizeGoogleChannelType(channelType: string | undefined): string | null {
  if (!channelType) return null;
  const type = channelType.toUpperCase();
  if (type === 'SEARCH') return 'trafego';
  if (type === 'DISPLAY') return 'reconhecimento';
  if (type === 'SHOPPING') return 'vendas';
  if (['VIDEO', 'DISCOVERY'].includes(type)) return 'reconhecimento';
  if (['PERFORMANCE_MAX', 'SMART'].includes(type)) return 'vendas';
  return 'trafego';
}



const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

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
  const normalizedCustomerId = normalizeGoogleCustomerId(customerId);
  if (!normalizedCustomerId) return null;
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${normalizedCustomerId}/googleAds:search`,
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
        accessToken,
        custId,
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

function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function toMetaAccountNodeId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
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

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = request.nextUrl.searchParams.get('dateTo') ?? '';
  const sortBy = (request.nextUrl.searchParams.get('sortBy') ?? 'spend') as SortKey;
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '30', 10), 100);
  const requestedClientIds = (request.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let metaConns: any[], googleConns: any[], links: any[];
  try {
    const [m, g, l, legacyMetaLinks, legacyMetaIntegration] = await Promise.all([
      safeRows(pool, "SELECT * FROM public.meta_connections WHERE status = 'connected'"),
      safeRows(pool, "SELECT * FROM public.google_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? safeRows(
          pool,
          `SELECT client_id, platform, connection_id, account_id
           FROM public.client_account_links
           WHERE client_id = ANY($1::text[])
             AND platform IN ('meta_ads', 'google_ads')`,
          [requestedClientIds],
        )
        : Promise.resolve([]),
      shouldFilterByClient
        ? safeRows(pool, 'SELECT * FROM public.meta_ads_connections WHERE client_id = ANY($1::text[])', [requestedClientIds])
        : Promise.resolve([]),
      safeRows(pool, "SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'"),
    ]);
    metaConns = m;
    googleConns = g;
    links = l;

    const legacyMeta = legacyMetaIntegration[0];
    if (legacyMeta?.access_token) {
      metaConns.push({ id: 'legacy-meta-global', access_token: legacyMeta.access_token });
      for (const legacyLink of legacyMetaLinks) {
        for (const accountId of legacyLink.account_ids ?? []) {
          links.push({
            platform: 'meta_ads',
            connection_id: 'legacy-meta-global',
            account_id: accountId,
            account_name: accountId,
          });
        }
      }
    }
  } finally {
    await pool.end();
  }

  if (shouldFilterByClient && links.length === 0) return Response.json([]);

  const campaigns: CampaignPerformance[] = [];
  const metaPeriod = resolveMetaPeriod(period, dateFrom, dateTo);
  const gaqlPeriod = resolveGaqlPeriod(period, dateFrom, dateTo);

  const linksByPlatformAndConn = new Map<string, Array<{ id: string; name: string }>>();
  for (const link of links) {
    const key = `${link.platform}:${link.connection_id}`;
    const list = linksByPlatformAndConn.get(key) ?? [];
    const accountId = link.platform === 'google_ads' ? normalizeGoogleCustomerId(link.account_id) : link.account_id;
    if (!accountId) continue;
    list.push({ id: accountId, name: link.account_name ?? link.account_id });
    linksByPlatformAndConn.set(key, list);
  }

  await Promise.allSettled(
    metaConns.map(async (conn) => {
      const token = await getFreshMetaToken(conn);
      const allowed = shouldFilterByClient ? linksByPlatformAndConn.get(`meta_ads:${conn.id}`) ?? [] : [];
      if (shouldFilterByClient && allowed.length === 0) return;

      let accounts: Array<{ id: string; name: string }> = allowed;
      if (!shouldFilterByClient) {
        const acctRes = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=100&access_token=${token}`);
        if (!acctRes.ok) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acctData = await acctRes.json() as { data?: any[] };
        accounts = acctData.data ?? [];
      }

      const seenAccounts = new Set<string>();
      accounts = accounts.filter((account) => {
        const normalized = normalizeMetaAccountId(account.id);
        if (seenAccounts.has(normalized)) return false;
        seenAccounts.add(normalized);
        return shouldFilterByClient || allowed.some((item) => accountMatches(item.id, account.id));
      });

      await Promise.allSettled(
        accounts.map(async (account) => {
          const acctNode = toMetaAccountNodeId(account.id);

          // Fetch campaign statuses in parallel with insights
          const statusUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/campaigns`);
          statusUrl.searchParams.set('fields', 'id,effective_status,daily_budget,lifetime_budget,objective');
          statusUrl.searchParams.set('limit', '200');
          statusUrl.searchParams.set('access_token', token);

          const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
          url.searchParams.set('level', 'campaign');
          url.searchParams.set('fields', 'campaign_id,campaign_name,spend,impressions,clicks,actions');
          applyMetaDateToUrl(url, metaPeriod);
          url.searchParams.set('sort', 'spend_descending');
          url.searchParams.set('limit', String(limit));
          url.searchParams.set('access_token', token);

          const [insightsRes, statusRes] = await Promise.all([fetch(url.toString()), fetch(statusUrl.toString())]);
          if (!insightsRes.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const insightsData = await insightsRes.json() as { data?: any[] };
          const statusData: Record<string, { status: string; dailyBudget?: number; objective?: string }> = {};
          if (statusRes.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sd = await statusRes.json() as { data?: any[] };
            for (const c of sd.data ?? []) {
              statusData[c.id] = {
                status: c.effective_status ?? 'ACTIVE',
                dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : (c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined),
                objective: c.objective ?? undefined,
              };
            }
          }

          for (const row of insightsData.data ?? []) {
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
              connectionId: conn.id,
              status: statusData[row.campaign_id]?.status ?? 'ACTIVE',
              objective: normalizeMetaObjective(statusData[row.campaign_id]?.objective) ?? undefined,
              dailyBudget: statusData[row.campaign_id]?.dailyBudget,
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

  // Collect all google_ads account IDs for the client regardless of connection_id
  // (connection_id in client_account_links may point to a stale/old connection row)
  const allGadsAccountIds = shouldFilterByClient
    ? [...new Set(links.filter(l => l.platform === 'google_ads').map(l => normalizeGoogleCustomerId(l.account_id)).filter(Boolean))]
    : [];

  const seenGoogleCampaigns = new Set<string>();

  await Promise.allSettled(
    googleConns.map(async (conn) => {
      if (shouldFilterByClient && allGadsAccountIds.length === 0) return;

      const accessToken = await getFreshGoogleToken(conn);
      const mccMap = await buildMccMap(accessToken);
      const accountIds = shouldFilterByClient ? allGadsAccountIds : Object.keys(mccMap);

      await Promise.allSettled(
        accountIds.map(async (accountId) => {
          const normalizedAccountId = normalizeGoogleCustomerId(accountId);
          if (!normalizedAccountId) return;
          const loginCustomerId = mccMap[normalizedAccountId];
          const data = await gadsSearch(
            normalizedAccountId,
            `SELECT campaign.id, campaign.name, campaign.status,
                    campaign.advertising_channel_type,
                    campaign_budget.amount_micros, campaign_budget.resource_name,
                    metrics.cost_micros, metrics.impressions, metrics.clicks,
                    metrics.conversions,
                    metrics.search_impression_share,
                    metrics.search_budget_lost_impression_share,
                    metrics.search_absolute_top_impression_share
             FROM campaign
             WHERE ${gaqlPeriod}
               AND campaign.status IN ('ENABLED', 'PAUSED')
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
            const dedupKey = `${normalizedAccountId}:${campaign.id}`;
            if (seenGoogleCampaigns.has(dedupKey)) continue;
            seenGoogleCampaigns.add(dedupKey);
            const clicks = Number(metrics.clicks ?? 0);
            const impressions = Number(metrics.impressions ?? 0);
            const leads = Number(metrics.conversions ?? 0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const budget = (row as any).campaignBudget ?? {};
            const rawIS = Number(metrics.searchImpressionShare ?? 0);
            const rawBudgetLostIS = Number(metrics.searchBudgetLostImpressionShare ?? 0);
            const rawAbsTopIS = Number(metrics.searchAbsoluteTopImpressionShare ?? 0);
            campaigns.push({
              id: String(campaign.id),
              name: campaign.name ?? `Campanha ${campaign.id}`,
              platform: 'google',
              accountId: normalizedAccountId,
              accountName: normalizedAccountId,
              connectionId: conn.id,
              loginCustomerId: loginCustomerId ?? undefined,
              status: campaign.status ?? 'ENABLED',
              objective: normalizeGoogleChannelType(campaign.advertisingChannelType) ?? undefined,
              dailyBudget: budget.amountMicros ? Number(budget.amountMicros) / 1_000_000 : undefined,
              budgetResourceName: budget.resourceName ?? undefined,
              spend,
              impressions,
              clicks,
              leads,
              ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
              cpc: clicks > 0 ? spend / clicks : 0,
              cpl: leads > 0 ? spend / leads : 0,
              searchImprShare: rawIS > 0 ? rawIS * 100 : undefined,
              searchBudgetLostIS: rawBudgetLostIS > 0 ? rawBudgetLostIS * 100 : undefined,
              searchAbsTopIS: rawAbsTopIS > 0 ? rawAbsTopIS * 100 : undefined,
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
