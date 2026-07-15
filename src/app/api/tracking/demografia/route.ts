import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { getCached, setCached, cachedJson, TTL_4H } from '@/lib/api-cache';

// ── Demografia agregada das campanhas (Meta + Google) ────────────────────────
// Idade/gênero/região NÃO existem por lead (WhatsApp/clique não entregam) —
// mas as plataformas entregam AGREGADO por conta: "quem a campanha alcançou e
// converteu". Este endpoint puxa os breakdowns dos últimos 30 dias das contas
// vinculadas ao cliente e devolve num shape único pros painéis de rastreamento
// e futuras análises de campanha com IA. Cache 4h (mesmo padrão do metrics).

export const dynamic = 'force-dynamic';

type Bucket = { label: string; impressions: number; clicks: number; spend: number; leads: number };

function toMetaAccountNodeId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}
function normalizeGoogleCustomerId(accountId: string) {
  return String(accountId ?? '').replace(/\D/g, '');
}

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

// ── Meta: insights com breakdowns ─────────────────────────────────────────────

// Mesmos action_types do metrics route (não somar famílias — ver CLAUDE.md)
const META_FORM_ACTIONS = ['onsite_conversion.lead_grouped'];
const SITE_LEAD_ACTIONS = ['offsite_conversion.fb_pixel_lead', 'onsite_web_lead'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaRowLeads(row: any): number {
  const actions = ((row.actions as { action_type: string; value: string }[]) ?? []);
  const getAction = (type: string) => {
    const found = actions.find(a => a.action_type === type);
    return found ? parseInt(found.value || '0', 10) : 0;
  };
  const sumActions = (types: string[]) => actions
    .filter(a => types.includes(a.action_type))
    .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
  const conversations = Math.max(
    getAction('messaging_conversation_started_7d'),
    getAction('onsite_conversion.messaging_conversation_started_7d'),
  );
  return sumActions(META_FORM_ACTIONS) + sumActions(SITE_LEAD_ACTIONS) + conversations;
}

async function fetchMetaBreakdown(
  accountId: string,
  token: string,
  breakdowns: string,
  labelOf: (row: Record<string, unknown>) => string,
): Promise<Bucket[]> {
  const url = new URL(`https://graph.facebook.com/v21.0/${toMetaAccountNodeId(accountId)}/insights`);
  url.searchParams.set('fields', 'spend,impressions,clicks,actions');
  url.searchParams.set('level', 'account');
  url.searchParams.set('breakdowns', breakdowns);
  url.searchParams.set('date_preset', 'last_30d');
  url.searchParams.set('limit', '200');
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  if (data.error) return [];
  return ((data.data ?? []) as Record<string, unknown>[]).map(row => ({
    label: labelOf(row),
    impressions: parseInt(String(row.impressions ?? '0'), 10),
    clicks: parseInt(String(row.clicks ?? '0'), 10),
    spend: parseFloat(String(row.spend ?? '0')),
    leads: metaRowLeads(row),
  })).filter(b => b.label);
}

// ── Google: GAQL por segmento ─────────────────────────────────────────────────

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

async function gadsSearch(customerId: string, query: string, accessToken: string, loginCustomerId?: string) {
  const normalized = normalizeGoogleCustomerId(customerId);
  if (!normalized) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${normalized}/googleAds:search`,
    { method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(9000) },
  ).catch(() => null);
  if (!res || !res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

// Reaproveita o mccMap cacheado pelo metrics route (mesma chave `mccmap:{connId}`)
async function buildMccMap(accessToken: string, connectionId: string): Promise<Record<string, string>> {
  const cacheKey = `mccmap:${connectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached.data as Record<string, string>;
  const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN },
  }).catch(() => null);
  if (!listRes || !listRes.ok) { setCached(cacheKey, {}, TTL_4H); return {}; }
  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
  const mccMap: Record<string, string> = {};
  await Promise.allSettled(resourceNames.map(async (rn) => {
    const custId = normalizeGoogleCustomerId(rn.replace('customers/', ''));
    const data = await gadsSearch(custId, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', accessToken);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (data?.results?.[0] as any)?.customer;
    if (!c?.manager) return;
    const subData = await gadsSearch(
      custId,
      'SELECT customer_client.id, customer_client.level FROM customer_client WHERE customer_client.level >= 1',
      accessToken,
      custId,
    );
    for (const r of subData?.results ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = (r as any).customerClient;
      if (sub?.id) mccMap[normalizeGoogleCustomerId(String(sub.id))] = custId;
    }
  }));
  setCached(cacheKey, mccMap, TTL_4H);
  return mccMap;
}

const GOOGLE_AGE_LABELS: Record<string, string> = {
  AGE_RANGE_18_24: '18-24', AGE_RANGE_25_34: '25-34', AGE_RANGE_35_44: '35-44',
  AGE_RANGE_45_54: '45-54', AGE_RANGE_55_64: '55-64', AGE_RANGE_65_UP: '65+',
  AGE_RANGE_UNDETERMINED: 'indefinido',
};
const GOOGLE_GENDER_LABELS: Record<string, string> = {
  MALE: 'masculino', FEMALE: 'feminino', UNDETERMINED: 'indefinido',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function gadsBucket(label: string, m: any): Bucket {
  return {
    label,
    impressions: Number(m?.impressions ?? 0),
    clicks: Number(m?.clicks ?? 0),
    spend: Number(m?.costMicros ?? 0) / 1_000_000,
    leads: (() => { const p = Number(m?.conversions ?? 0); const a = Number(m?.allConversions ?? 0); return p > 0 ? p : a; })(),
  };
}

async function fetchGoogleAgeGender(customerId: string, token: string, loginCustomerId?: string) {
  const metrics = 'metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions';
  const period = 'segments.date DURING LAST_30_DAYS';
  const [ageData, genderData] = await Promise.all([
    gadsSearch(customerId, `SELECT ad_group_criterion.age_range.type, ${metrics} FROM age_range_view WHERE ${period}`, token, loginCustomerId),
    gadsSearch(customerId, `SELECT ad_group_criterion.gender.type, ${metrics} FROM gender_view WHERE ${period}`, token, loginCustomerId),
  ]);
  const idade: Bucket[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (ageData?.results ?? []) as any[]) {
    const type = r.adGroupCriterion?.ageRange?.type;
    if (type) idade.push(gadsBucket(GOOGLE_AGE_LABELS[type] ?? type, r.metrics));
  }
  const genero: Bucket[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (genderData?.results ?? []) as any[]) {
    const type = r.adGroupCriterion?.gender?.type;
    if (type) genero.push(gadsBucket(GOOGLE_GENDER_LABELS[type] ?? type, r.metrics));
  }
  return { idade: mergeBuckets(idade), genero: mergeBuckets(genero) };
}

async function fetchGoogleRegions(customerId: string, token: string, loginCustomerId?: string): Promise<Bucket[]> {
  const data = await gadsSearch(
    customerId,
    `SELECT geographic_view.country_criterion_id, segments.geo_target_region,
            metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.all_conversions
       FROM geographic_view WHERE segments.date DURING LAST_30_DAYS`,
    token, loginCustomerId,
  );
  if (!data?.results?.length) return [];
  // segments.geo_target_region vem como resource name geoTargetConstants/{id}
  const byRegion = new Map<string, Bucket>();
  const regionIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of data.results as any[]) {
    const region = String(r.segments?.geoTargetRegion ?? '');
    const id = region.replace('geoTargetConstants/', '');
    if (!id) continue;
    regionIds.add(id);
    const cur = byRegion.get(id) ?? { label: id, impressions: 0, clicks: 0, spend: 0, leads: 0 };
    const b = gadsBucket(id, r.metrics);
    cur.impressions += b.impressions; cur.clicks += b.clicks; cur.spend += b.spend; cur.leads += b.leads;
    byRegion.set(id, cur);
  }
  if (regionIds.size === 0) return [];
  // Resolve nomes dos geo targets (1 query em lote)
  const names = new Map<string, string>();
  const idList = [...regionIds].slice(0, 100).join(',');
  const nameData = await gadsSearch(
    customerId,
    `SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${idList})`,
    token, loginCustomerId,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (nameData?.results ?? []) as any[]) {
    const g = r.geoTargetConstant;
    if (g?.id) names.set(String(g.id), String(g.name ?? g.id));
  }
  return [...byRegion.entries()]
    .map(([id, b]) => ({ ...b, label: names.get(id) ?? id }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 12);
}

// ── Agregação ─────────────────────────────────────────────────────────────────

function mergeBuckets(buckets: Bucket[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const b of buckets) {
    const cur = map.get(b.label) ?? { label: b.label, impressions: 0, clicks: 0, spend: 0, leads: 0 };
    cur.impressions += b.impressions; cur.clicks += b.clicks; cur.spend += b.spend; cur.leads += b.leads;
    map.set(b.label, cur);
  }
  return [...map.values()].sort((a, b) => b.clicks - a.clicks);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId é obrigatório' }, { status: 400 });

  const cacheKey = `tracking-demografia:v1:${clientId}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let metaConns: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let googleConns: any[] = [];
  try {
    const [l, m, g] = await Promise.all([
      pool.query('SELECT * FROM public.client_account_links WHERE client_id = $1', [clientId]).then(r => r.rows).catch(() => []),
      pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'").then(r => r.rows).catch(() => []),
      pool.query("SELECT * FROM public.google_connections WHERE status = 'connected'").then(r => r.rows).catch(() => []),
    ]);
    links = l; metaConns = m; googleConns = g;
  } finally {
    await pool.end();
  }

  const metaLinks = links.filter(l => l.platform === 'meta_ads' || l.platform === 'meta');
  const gadsLinks = links.filter(l => l.platform === 'google_ads');

  const meta = { idadeGenero: [] as Array<Bucket & { genero: string }>, regiao: [] as Bucket[] };
  const googleOut = { idade: [] as Bucket[], genero: [] as Bucket[], regiao: [] as Bucket[] };

  // ── Meta: age+gender e region por conta vinculada ──
  await Promise.allSettled(metaLinks.map(async (link) => {
    const conn = metaConns.find(c => c.id === link.connection_id) ?? metaConns[0];
    if (!conn) return;
    const token = await getFreshMetaToken(conn);
    const [ageGender, region] = await Promise.all([
      fetchMetaBreakdown(link.account_id, token, 'age,gender', row => `${row.age ?? '?'}|${row.gender ?? '?'}`),
      fetchMetaBreakdown(link.account_id, token, 'region', row => String(row.region ?? '')),
    ]);
    for (const b of ageGender) {
      const [age, gender] = b.label.split('|');
      meta.idadeGenero.push({ ...b, label: age, genero: gender === 'male' ? 'masculino' : gender === 'female' ? 'feminino' : 'indefinido' });
    }
    meta.regiao.push(...region);
  }));
  meta.regiao = mergeBuckets(meta.regiao).slice(0, 12);

  // ── Google: sequencial por conexão (mesmo padrão do metrics) ──
  if (gadsLinks.length > 0) {
    const uniqueIds = [...new Set(gadsLinks.map(l => normalizeGoogleCustomerId(l.account_id)).filter(Boolean))];
    const linkedConnIds = new Set(gadsLinks.map(l => l.connection_id).filter(Boolean));
    const sortedConns = [
      ...googleConns.filter(c => linkedConnIds.has(c.id)),
      ...googleConns.filter(c => !linkedConnIds.has(c.id)),
    ];
    const seen = new Set<string>();
    for (const conn of sortedConns) {
      const pending = uniqueIds.filter(id => !seen.has(id));
      if (pending.length === 0) break;
      let token: string, mccMap: Record<string, string>;
      try {
        token = await getFreshGoogleToken(conn);
        mccMap = await buildMccMap(token, conn.id);
      } catch { continue; }
      await Promise.allSettled(pending.map(async (accountId) => {
        const login = mccMap[accountId];
        const [ag, regions] = await Promise.all([
          fetchGoogleAgeGender(accountId, token, login),
          fetchGoogleRegions(accountId, token, login),
        ]);
        if (ag.idade.length > 0 || ag.genero.length > 0 || regions.length > 0) {
          seen.add(accountId);
          googleOut.idade.push(...ag.idade);
          googleOut.genero.push(...ag.genero);
          googleOut.regiao.push(...regions);
        }
      }));
    }
    googleOut.idade = mergeBuckets(googleOut.idade);
    googleOut.genero = mergeBuckets(googleOut.genero);
    googleOut.regiao = mergeBuckets(googleOut.regiao).slice(0, 12);
  }

  const result = {
    meta: (meta.idadeGenero.length > 0 || meta.regiao.length > 0) ? meta : null,
    google: (googleOut.idade.length > 0 || googleOut.genero.length > 0 || googleOut.regiao.length > 0) ? googleOut : null,
    periodo: 'últimos 30 dias',
  };
  setCached(cacheKey, result, TTL_4H);
  return cachedJson(result, false);
}
