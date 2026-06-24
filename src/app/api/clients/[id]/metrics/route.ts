import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { getFreshMetaToken } from '@/lib/meta-token';
import { getCached, setCached, cachedJson, TTL_4H } from '@/lib/api-cache';

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

function toMetaAccountNodeId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

function normalizeGoogleCustomerId(accountId: string) {
  return accountId.replace(/\D/g, '');
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
  const normalizedCustomerId = normalizeGoogleCustomerId(customerId);
  if (!normalizedCustomerId) return null;
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${normalizedCustomerId}/googleAds:search`,
    { method: 'POST', headers: gadsHeaders(accessToken, loginCustomerId), body: JSON.stringify({ query }) }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[metrics/gads] search failed customer=${normalizedCustomerId} loginCustomer=${loginCustomerId} status=${res.status}`, errText.slice(0, 300));
    return null;
  }
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

async function fetchGadsAccountMetrics(customerId: string, accessToken: string, loginCustomerId: string | undefined, gaqlPeriod: string) {
  const query = `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.average_cpc, metrics.conversions, metrics.all_conversions, metrics.cost_per_conversion,
       metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share,
       metrics.search_absolute_top_impression_share, metrics.search_top_impression_share
     FROM customer WHERE ${gaqlPeriod}`;
  let data = await gadsSearch(customerId, query, accessToken, loginCustomerId);
  // If the primary attempt failed and we had a loginCustomerId, retry without it (direct account fallback).
  // If there was no loginCustomerId, retry with the account itself as login (MCC self-access fallback).
  if (!data) {
    const fallbackLogin = loginCustomerId ? undefined : customerId;
    console.log(`[metrics/gads] retrying customer=${customerId} fallbackLogin=${fallbackLogin ?? 'none'}`);
    data = await gadsSearch(customerId, query, accessToken, fallbackLogin);
  }
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (data.results?.[0] as any)?.metrics;
  if (!m) {
    console.log(`[metrics/gads] empty results customer=${customerId} period=${gaqlPeriod} loginCustomer=${loginCustomerId}`);
    return null;
  }
  const spend = (m.costMicros ?? 0) / 1_000_000;
  const primaryConv = Number(m.conversions ?? 0);
  const allConv = Number(m.allConversions ?? 0);
  // Use all_conversions when primary conversions = 0 (account may not have primary conversion actions configured)
  const conversions = primaryConv > 0 ? primaryConv : allConv;
  return {
    cost: spend,
    impressions: Number(m.impressions ?? 0),
    clicks: Number(m.clicks ?? 0),
    cpc: (m.averageCpc ?? 0) / 1_000_000,
    conversions,
    cpa: conversions > 0 ? spend / conversions : 0,
    searchImprShare: (Number(m.searchImpressionShare ?? 0)) * 100,
    searchBudgetLostIS: (Number(m.searchBudgetLostImpressionShare ?? 0)) * 100,
    searchRankLostIS: (Number(m.searchRankLostImpressionShare ?? 0)) * 100,
    searchAbsTopIS: (Number(m.searchAbsoluteTopImpressionShare ?? 0)) * 100,
    searchTopIS: (Number(m.searchTopImpressionShare ?? 0)) * 100,
  };
}

type DailyMetrics = {
  date: string;
  meta?: { spend: number; reach: number; impressions: number; clicks: number; leads: number };
  google?: { cost: number; impressions: number; clicks: number; conversions: number };
  crm?: { revenue: number; sales: number; leads: number };
};
type CrmDailyRow = { date: string; revenue: number; sales: number; leads: number };

async function fetchGadsAccountDailyMetrics(customerId: string, accessToken: string, loginCustomerId: string | undefined, gaqlPeriod: string) {
  const query = `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.all_conversions
     FROM customer WHERE ${gaqlPeriod}
     ORDER BY segments.date`;
  let data = await gadsSearch(customerId, query, accessToken, loginCustomerId);
  if (!data) {
    const fallbackLogin = loginCustomerId ? undefined : customerId;
    data = await gadsSearch(customerId, query, accessToken, fallbackLogin);
  }
  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data.results ?? []) as any[]).map((row) => {
    const m = row.metrics ?? {};
    return {
      date: row.segments?.date as string,
      cost: Number(m.costMicros ?? 0) / 1_000_000,
      impressions: Number(m.impressions ?? 0),
      clicks: Number(m.clicks ?? 0),
      conversions: (() => { const p = Number(m.conversions ?? 0); const a = Number(m.allConversions ?? 0); return p > 0 ? p : a; })(),
    };
  }).filter((row) => row.date);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildMccMap(accessToken: string, connectionId: string): Promise<Record<string, string>> {
  const cacheKey = `mccmap:${connectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached.data as Record<string, string>;

  const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN },
  });
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    console.error(`[metrics/gads] listAccessibleCustomers failed status=${listRes.status}`, errText.slice(0, 300));
    setCached(cacheKey, {}, TTL_4H);
    return {};
  }
  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };

  const mccMap: Record<string, string> = {};
  await Promise.allSettled(
    resourceNames.map(async (rn) => {
      const custId = normalizeGoogleCustomerId(rn.replace('customers/', ''));
      const data = await gadsSearch(custId, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', accessToken);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (data?.results?.[0] as any)?.customer;
      if (!c?.manager) return;
      // This is an MCC — list all sub-accounts at any depth (not just level=1)
      const subData = await gadsSearch(
        custId,
        'SELECT customer_client.id, customer_client.level FROM customer_client WHERE customer_client.level >= 1',
        accessToken,
        custId,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of subData?.results ?? [] as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sub = (r as any).customerClient;
        // Map every sub-account (including nested MCCs) to this top-level MCC as login-customer-id
        if (sub?.id) mccMap[normalizeGoogleCustomerId(String(sub.id))] = custId;
      }
    })
  );
  setCached(cacheKey, mccMap, TTL_4H);
  return mccMap;
}

// Formulários Meta (Instant Forms / Lead Ads) — mutuamente exclusivos com SITE
const META_FORM_ACTIONS = [
  'onsite_conversion.lead_grouped', // formulários on-Meta (Instant Form, Lead Ad)
];

// Conversões de site via Pixel (offsite) — mutuamente exclusivos com META_FORM
const SITE_LEAD_ACTIONS = [
  'offsite_conversion.fb_pixel_lead', // pixel Meta disparado no site
  'onsite_web_lead',                  // lead via Instant Experience web
];

async function fetchMetaAccountMetrics(accountId: string, accessToken: string, metaPeriod: string) {
  const url = new URL(`https://graph.facebook.com/v21.0/${toMetaAccountNodeId(accountId)}/insights`);
  url.searchParams.set('fields', 'spend,reach,impressions,clicks,actions');
  url.searchParams.set('level', 'account');
  url.searchParams.set('access_token', accessToken);
  applyMetaDateToUrl(url, metaPeriod);
  const res = await fetch(url.toString());
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  if (data.error) return null;
  const row = data.data?.[0] ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions = ((row.actions as { action_type: string; value: string }[]) ?? []);

  const getAction = (type: string) => {
    const found = actions.find(a => a.action_type === type);
    return found ? parseInt(found.value || '0', 10) : 0;
  };
  const sumActions = (types: string[]) => actions
    .filter(a => types.includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);

  const formLeads = sumActions(META_FORM_ACTIONS);
  const siteLeads = sumActions(SITE_LEAD_ACTIONS);

  // Meta reporta conversas com dois nomes diferentes dependendo da versão da campanha.
  // Pegar o maior entre os dois para evitar double-counting quando ambos retornam.
  const conversations = Math.max(
    getAction('messaging_conversation_started_7d'),
    getAction('onsite_conversion.messaging_conversation_started_7d'),
  );

  return {
    spend: parseFloat(row.spend || '0'),
    reach: parseInt(row.reach || '0', 10),
    impressions: parseInt(row.impressions || '0', 10),
    clicks: parseInt(row.clicks || '0', 10),
    leads: formLeads + siteLeads + conversations,
    formLeads,
    siteLeads,
    conversations,
  };
}

function readMetaInsightRow(row: Record<string, unknown>) {
  const actions = ((row.actions as { action_type: string; value: string }[]) ?? []);
  const getAction = (type: string) => {
    const found = actions.find(a => a.action_type === type);
    return found ? parseInt(found.value || '0', 10) : 0;
  };
  const sumActions = (types: string[]) => actions
    .filter(a => types.includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
  const formLeads = sumActions(META_FORM_ACTIONS);
  const siteLeads = sumActions(SITE_LEAD_ACTIONS);
  const conversations = Math.max(
    getAction('messaging_conversation_started_7d'),
    getAction('onsite_conversion.messaging_conversation_started_7d'),
  );
  return {
    spend: parseFloat(String(row.spend || '0')),
    reach: parseInt(String(row.reach || '0'), 10),
    impressions: parseInt(String(row.impressions || '0'), 10),
    clicks: parseInt(String(row.clicks || '0'), 10),
    leads: formLeads + siteLeads + conversations,
    formLeads,
    siteLeads,
    conversations,
  };
}

async function fetchMetaAccountDailyMetrics(accountId: string, accessToken: string, metaPeriod: string) {
  const url = new URL(`https://graph.facebook.com/v21.0/${toMetaAccountNodeId(accountId)}/insights`);
  url.searchParams.set('fields', 'spend,reach,impressions,clicks,actions,date_start');
  url.searchParams.set('level', 'account');
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('access_token', accessToken);
  applyMetaDateToUrl(url, metaPeriod);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  if (data.error) return [];
  return ((data.data ?? []) as Record<string, unknown>[]).map((row) => ({
    date: String(row.date_start ?? ''),
    ...readMetaInsightRow(row),
  })).filter((row) => row.date);
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

async function ensureCrmMetricsColumns(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS lead_date DATE,
      ADD COLUMN IF NOT EXISTS lead_name TEXT,
      ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
      ADD COLUMN IF NOT EXISTS data DATE,
      ADD COLUMN IF NOT EXISTS nome TEXT,
      ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
      ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE
  `);
}

function crmDateRange(period: string, dateFrom: string, dateTo: string) {
  const resolved = resolveMetaPeriod(period, dateFrom, dateTo);
  const [, from, to] = resolved.split(':');
  return { from, to };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = request.nextUrl.searchParams.get('dateTo') ?? '';
  const gaqlPeriod = resolveGaqlPeriod(period, dateFrom, dateTo);
  const metaPeriod = resolveMetaPeriod(period, dateFrom, dateTo);
  const crmPeriod = crmDateRange(period, dateFrom, dateTo);

  const cacheKey = `metrics:v4:${clientId}:${period}:${dateFrom}:${dateTo}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[], googleConns: any[], metaConns: any[];
  let crmResult: { revenue: number; sales: number; leads: number; ticket: number } | null = null;
  let crmDailyRows: CrmDailyRow[] = [];
  try {
    await ensureCrmMetricsColumns(pool);
    const [newLinks, g, m, legacyMetaLinks, legacyMetaIntegration] = await Promise.all([
      safeRows(pool, 'SELECT * FROM public.client_account_links WHERE client_id = $1', [clientId]),
      safeRows(pool, "SELECT * FROM public.google_connections WHERE status = 'connected'"),
      safeRows(pool, "SELECT * FROM public.meta_connections WHERE status = 'connected'"),
      safeRows(pool, 'SELECT * FROM public.meta_ads_connections WHERE client_id = $1', [clientId]),
      safeRows(pool, "SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'"),
    ]);
    links = newLinks;
    googleConns = g;
    metaConns = m;

    const crmRows = await safeRows(
      pool,
      `SELECT
          COALESCE(SUM(COALESCE(NULLIF(revenue, 0), valor_rs, 0)), 0)::float AS revenue,
          COUNT(*) FILTER (WHERE COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0 OR fechou = TRUE)::int AS sales,
          COUNT(*)::int AS leads
         FROM public.crm_leads
        WHERE client_id = $1
          AND (
            COALESCE(lead_date, data) IS NULL
            OR COALESCE(lead_date, data) BETWEEN $2 AND $3
          )`,
      [clientId, crmPeriod.from, crmPeriod.to],
    );
    const crm = crmRows[0];
    if (crm) {
      const revenue = Number(crm.revenue ?? 0);
      const sales = Number(crm.sales ?? 0);
      crmResult = {
        revenue,
        sales,
        leads: Number(crm.leads ?? 0),
        ticket: sales > 0 ? revenue / sales : 0,
      };
    }
    crmDailyRows = await safeRows(
      pool,
      `SELECT
          COALESCE(lead_date, data)::text AS date,
          COALESCE(SUM(COALESCE(NULLIF(revenue, 0), valor_rs, 0)), 0)::float AS revenue,
          COUNT(*) FILTER (WHERE COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0 OR fechou = TRUE)::int AS sales,
          COUNT(*)::int AS leads
         FROM public.crm_leads
        WHERE client_id = $1
          AND COALESCE(lead_date, data) BETWEEN $2 AND $3
        GROUP BY COALESCE(lead_date, data)
        ORDER BY COALESCE(lead_date, data)`,
      [clientId, crmPeriod.from, crmPeriod.to],
    ) as CrmDailyRow[];

    const legacyMeta = legacyMetaIntegration[0];
    if (legacyMeta?.access_token) {
      metaConns.push({ id: 'legacy-meta-global', access_token: legacyMeta.access_token });
      for (const legacyLink of legacyMetaLinks) {
        for (const accountId of legacyLink.account_ids ?? []) {
          links.push({
            platform: 'meta_ads',
            connection_id: 'legacy-meta-global',
            account_id: accountId,
          });
        }
      }
    }
  } finally {
    await pool.end();
  }

  const gadsLinks = links.filter(l => l.platform === 'google_ads');
  const metaLinks = links.filter(l => l.platform === 'meta_ads');

  // ── Google Ads ─────────────────────────────────────────────────────────────
  type GResult = { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number;
  searchImprShare: number; searchBudgetLostIS: number; searchRankLostIS: number; searchAbsTopIS: number; searchTopIS: number; };
  let googleResult: GResult | null = null;
  const dailyMap: Record<string, DailyMetrics> = {};

  if (gadsLinks.length > 0) {
    const uniqueAccountIds = [...new Set(
      gadsLinks.map(l => normalizeGoogleCustomerId(l.account_id)).filter(Boolean)
    )];

    // Build a set of connection IDs explicitly linked to this client's accounts,
    // then sort so those come first — avoids building MCC maps for unrelated connections.
    const linkedConnIds = new Set(gadsLinks.map(l => l.connection_id).filter(Boolean));
    const sortedConns = [
      ...googleConns.filter(c => linkedConnIds.has(c.id)),
      ...googleConns.filter(c => !linkedConnIds.has(c.id)),
    ];

    console.log(`[metrics] client=${clientId} gads uniqueAccounts=${uniqueAccountIds.join(',')} connections=${sortedConns.length} linked=${[...linkedConnIds].join(',')}`);

    const connMetrics: GResult[] = [];
    const connDaily: Awaited<ReturnType<typeof fetchGadsAccountDailyMetrics>> = [];
    const seenAccounts = new Set<string>();

    // Process connections sequentially so each gets a chance to resolve accounts
    // that a previous connection failed to fetch (e.g. different MCC hierarchies).
    for (const conn of sortedConns) {
      const pendingIds = uniqueAccountIds.filter(id => !seenAccounts.has(id));
      if (pendingIds.length === 0) break;

      let accessToken: string;
      let mccMap: Record<string, string>;
      try {
        accessToken = await getFreshGoogleToken(conn);
        mccMap = await buildMccMap(accessToken, conn.id);
      } catch (e) {
        console.error('[metrics] google token/mcc error', e);
        continue;
      }

      // Accounts within a single connection can still be fetched in parallel —
      // each accountId maps to exactly one entry, so there's no race here.
      await Promise.allSettled(
        pendingIds.map(async (accountId) => {
          const loginCustomerId = mccMap[accountId];
          const m = await fetchGadsAccountMetrics(accountId, accessToken, loginCustomerId, gaqlPeriod);
          if (m) {
            seenAccounts.add(accountId);
            connMetrics.push(m);
            const daily = await fetchGadsAccountDailyMetrics(accountId, accessToken, loginCustomerId, gaqlPeriod);
            connDaily.push(...daily);
          }
        })
      );
    }

    if (connMetrics.length > 0) {
      const agg = connMetrics.reduce((a, m) => ({
        cost: a.cost + m.cost,
        impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks,
        conversions: a.conversions + m.conversions,
        cpc: 0,
        cpa: 0,
        searchImprShare: Math.max(a.searchImprShare, m.searchImprShare),
        searchBudgetLostIS: Math.max(a.searchBudgetLostIS, m.searchBudgetLostIS),
        searchRankLostIS: Math.max(a.searchRankLostIS, m.searchRankLostIS),
        searchAbsTopIS: Math.max(a.searchAbsTopIS, m.searchAbsTopIS),
        searchTopIS: Math.max(a.searchTopIS, m.searchTopIS),
      }), { cost: 0, impressions: 0, clicks: 0, conversions: 0, cpc: 0, cpa: 0, searchImprShare: 0, searchBudgetLostIS: 0, searchRankLostIS: 0, searchAbsTopIS: 0, searchTopIS: 0 });
      agg.cpc = agg.clicks > 0 ? agg.cost / agg.clicks : 0;
      agg.cpa = agg.conversions > 0 ? agg.cost / agg.conversions : 0;
      googleResult = agg;
    }
    for (const row of connDaily) {
      const item = dailyMap[row.date] ?? { date: row.date };
      const google = item.google ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
      google.cost += row.cost;
      google.impressions += row.impressions;
      google.clicks += row.clicks;
      google.conversions += row.conversions;
      dailyMap[row.date] = { ...item, google };
    }
  }

  // ── Meta Ads ───────────────────────────────────────────────────────────────
  type MResult = { spend: number; reach: number; impressions: number; clicks: number; leads: number; formLeads: number; siteLeads: number; conversations: number; cpl: number };
  let metaResult: MResult | null = null;

  if (metaLinks.length > 0) {
    const allMetrics: Array<{ spend: number; reach: number; impressions: number; clicks: number; leads: number; formLeads: number; siteLeads: number; conversations: number }> = [];
    const allDaily: Awaited<ReturnType<typeof fetchMetaAccountDailyMetrics>> = [];
    await Promise.allSettled(
      metaLinks.map(async (link) => {
        const conn = metaConns.find(c => c.id === link.connection_id);
        if (!conn) return;
        const token = await getFreshMetaToken(conn);
        const m = await fetchMetaAccountMetrics(link.account_id, token, metaPeriod);
        if (m) allMetrics.push(m);
        const daily = await fetchMetaAccountDailyMetrics(link.account_id, token, metaPeriod);
        allDaily.push(...daily);
      })
    );

    if (allMetrics.length > 0) {
      const agg = allMetrics.reduce((a, m) => ({
        spend: a.spend + m.spend, reach: a.reach + m.reach, impressions: a.impressions + m.impressions,
        clicks: a.clicks + m.clicks, leads: a.leads + m.leads,
        formLeads: a.formLeads + m.formLeads, siteLeads: a.siteLeads + m.siteLeads,
        conversations: a.conversations + m.conversations, cpl: 0,
      }), { spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0, formLeads: 0, siteLeads: 0, conversations: 0, cpl: 0 });
      agg.cpl = agg.leads > 0 ? agg.spend / agg.leads : 0;
      metaResult = agg;
    }
    for (const row of allDaily) {
      const item = dailyMap[row.date] ?? { date: row.date };
      const meta = item.meta ?? { spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0 };
      meta.spend += row.spend;
      meta.reach += row.reach;
      meta.impressions += row.impressions;
      meta.clicks += row.clicks;
      meta.leads += row.leads;
      dailyMap[row.date] = { ...item, meta };
    }
  }

  for (const row of crmDailyRows) {
    const date = String(row.date).split('T')[0];
    const item = dailyMap[date] ?? { date };
    dailyMap[date] = {
      ...item,
      crm: {
        revenue: Number(row.revenue ?? 0),
        sales: Number(row.sales ?? 0),
        leads: Number(row.leads ?? 0),
      },
    };
  }

  const result = { google: googleResult, meta: metaResult, crm: crmResult, daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)) };
  setCached(cacheKey, result);
  return cachedJson(result, false);
}
