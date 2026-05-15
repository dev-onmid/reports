import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';
import { getFreshMetaToken } from '@/lib/meta-token';

export type AudienceSlice = { label: string; value: number };
export type AudienceBreakdowns = {
  age: AudienceSlice[];
  gender: AudienceSlice[];
  platform: AudienceSlice[];
  device: AudienceSlice[];
};
export type AudienceResponse = {
  meta: AudienceBreakdowns;
  google: AudienceBreakdowns;
};

const EMPTY_BREAKDOWNS: AudienceBreakdowns = { age: [], gender: [], platform: [], device: [] };
const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

const META_PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  audience_network: 'Audience Network',
  messenger: 'Messenger',
  unknown: 'Desconhecido',
};

const META_GENDER_LABELS: Record<string, string> = {
  male: 'Masculino',
  female: 'Feminino',
  unknown: 'Indefinido',
};

const GOOGLE_GENDER_LABELS: Record<string, string> = {
  MALE: 'Masculino',
  FEMALE: 'Feminino',
  UNDETERMINED: 'Indefinido',
};

const GOOGLE_AGE_LABELS: Record<string, string> = {
  AGE_RANGE_18_24: '18-24',
  AGE_RANGE_25_34: '25-34',
  AGE_RANGE_35_44: '35-44',
  AGE_RANGE_45_54: '45-54',
  AGE_RANGE_55_64: '55-64',
  AGE_RANGE_65_UP: '65+',
  AGE_RANGE_UNDETERMINED: 'Indefinido',
  UNKNOWN: 'Desconhecido',
};

const GOOGLE_DEVICE_LABELS: Record<string, string> = {
  MOBILE: 'Celular',
  DESKTOP: 'Desktop',
  TABLET: 'Tablet',
  CONNECTED_TV: 'TV',
  OTHER: 'Outros',
  UNKNOWN: 'Desconhecido',
};

const GOOGLE_PLATFORM_LABELS: Record<string, string> = {
  SEARCH: 'Pesquisa',
  SEARCH_PARTNERS: 'Parceiros',
  CONTENT: 'Display',
  YOUTUBE_SEARCH: 'YouTube Search',
  YOUTUBE_WATCH: 'YouTube',
  MIXED: 'Misto',
  UNSPECIFIED: 'Não especificado',
  UNKNOWN: 'Desconhecido',
};



function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function normalizeGoogleCustomerId(accountId: string) {
  return accountId.replace(/\D/g, '');
}

function toMetaAccountNodeId(accountId: string) {
  return accountId.startsWith('act_') ? accountId : `act_${accountId}`;
}

function addSlice(map: Map<string, number>, label: string | undefined, value: number) {
  const key = label && label.trim() ? label : 'Desconhecido';
  map.set(key, (map.get(key) ?? 0) + value);
}

function mapToSlices(map: Map<string, number>): AudienceSlice[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value);
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
    `https://googleads.googleapis.com/v20/customers/${normalizedCustomerId}/googleAds:search`,
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

async function fetchMetaBreakdown(accountId: string, token: string, metaPeriod: string, breakdown: string, labelMap: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/v21.0/${toMetaAccountNodeId(accountId)}/insights`);
  url.searchParams.set('fields', 'reach,impressions');
  url.searchParams.set('breakdowns', breakdown);
  applyMetaDateToUrl(url, metaPeriod);
  url.searchParams.set('access_token', token);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json() as { data?: Record<string, string>[] };
  return (data.data ?? []).map((row) => ({
    label: labelMap[row[breakdown]] ?? row[breakdown] ?? 'Desconhecido',
    value: parseInt(row.reach || row.impressions || '0', 10),
  }));
}

async function fetchGoogleBreakdown(
  accountId: string,
  accessToken: string,
  loginCustomerId: string | undefined,
  gaqlPeriod: string,
  segment: 'ageRange' | 'gender' | 'device' | 'adNetworkType',
  labelMap: Record<string, string> = {},
) {
  const segmentField = {
    ageRange: 'segments.age_range',
    gender: 'segments.gender',
    device: 'segments.device',
    adNetworkType: 'segments.ad_network_type',
  }[segment];
  const data = await gadsSearch(
    accountId,
    `SELECT ${segmentField}, metrics.impressions, metrics.cost_micros
     FROM campaign
     WHERE ${gaqlPeriod}
       AND metrics.cost_micros > 0`,
    accessToken,
    loginCustomerId,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.results ?? []) as any[]).map((row) => {
    const raw = String(row.segments?.[segment] ?? 'UNKNOWN');
    return {
      label: labelMap[raw] ?? raw.replaceAll('_', ' '),
      value: Number(row.metrics?.impressions ?? 0),
    };
  });
}

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = request.nextUrl.searchParams.get('dateTo') ?? '';
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
          links.push({ platform: 'meta_ads', connection_id: 'legacy-meta-global', account_id: accountId });
        }
      }
    }
  } finally {
    await pool.end();
  }

  if (shouldFilterByClient && links.length === 0) return Response.json({ meta: EMPTY_BREAKDOWNS, google: EMPTY_BREAKDOWNS } satisfies AudienceResponse);

  const byPlatformAndConn = new Map<string, string[]>();
  for (const link of links) {
    const key = `${link.platform}:${link.connection_id}`;
    const list = byPlatformAndConn.get(key) ?? [];
    const accountId = link.platform === 'google_ads' ? normalizeGoogleCustomerId(link.account_id) : link.account_id;
    if (!accountId) continue;
    list.push(accountId);
    byPlatformAndConn.set(key, [...new Set(list)]);
  }

  const metaMaps = {
    age: new Map<string, number>(),
    gender: new Map<string, number>(),
    platform: new Map<string, number>(),
    device: new Map<string, number>(),
  };
  const googleMaps = {
    age: new Map<string, number>(),
    gender: new Map<string, number>(),
    platform: new Map<string, number>(),
    device: new Map<string, number>(),
  };
  const metaPeriod = resolveMetaPeriod(period, dateFrom, dateTo);
  const gaqlPeriod = resolveGaqlPeriod(period, dateFrom, dateTo);

  await Promise.allSettled(metaConns.map(async (conn) => {
    const accountIds = shouldFilterByClient ? byPlatformAndConn.get(`meta_ads:${conn.id}`) ?? [] : [];
    if (shouldFilterByClient && accountIds.length === 0) return;
    const ids = shouldFilterByClient ? accountIds : [];
    const token = await getFreshMetaToken(conn);
    await Promise.allSettled(ids.map(async (accountId) => {
      const [age, gender, platform, device] = await Promise.all([
        fetchMetaBreakdown(accountId, token, metaPeriod, 'age'),
        fetchMetaBreakdown(accountId, token, metaPeriod, 'gender', META_GENDER_LABELS),
        fetchMetaBreakdown(accountId, token, metaPeriod, 'publisher_platform', META_PLATFORM_LABELS),
        fetchMetaBreakdown(accountId, token, metaPeriod, 'impression_device'),
      ]);
      age.forEach((item) => addSlice(metaMaps.age, item.label, item.value));
      gender.forEach((item) => addSlice(metaMaps.gender, item.label, item.value));
      platform.forEach((item) => addSlice(metaMaps.platform, item.label, item.value));
      device.forEach((item) => addSlice(metaMaps.device, item.label, item.value));
    }));
  }));

  await Promise.allSettled(googleConns.map(async (conn) => {
    const accountIds = shouldFilterByClient ? byPlatformAndConn.get(`google_ads:${conn.id}`) ?? [] : [];
    if (shouldFilterByClient && accountIds.length === 0) return;
    const accessToken = await getFreshGoogleToken(conn);
    const mccMap = await buildMccMap(accessToken);
    const ids = shouldFilterByClient ? accountIds : Object.keys(mccMap);
    await Promise.allSettled(ids.map(async (accountId) => {
      const normalizedAccountId = normalizeGoogleCustomerId(accountId);
      if (!normalizedAccountId) return;
      const loginCustomerId = mccMap[normalizedAccountId];
      const [age, gender, platform, device] = await Promise.all([
        fetchGoogleBreakdown(normalizedAccountId, accessToken, loginCustomerId, gaqlPeriod, 'ageRange', GOOGLE_AGE_LABELS),
        fetchGoogleBreakdown(normalizedAccountId, accessToken, loginCustomerId, gaqlPeriod, 'gender', GOOGLE_GENDER_LABELS),
        fetchGoogleBreakdown(normalizedAccountId, accessToken, loginCustomerId, gaqlPeriod, 'adNetworkType', GOOGLE_PLATFORM_LABELS),
        fetchGoogleBreakdown(normalizedAccountId, accessToken, loginCustomerId, gaqlPeriod, 'device', GOOGLE_DEVICE_LABELS),
      ]);
      age.forEach((item) => addSlice(googleMaps.age, item.label, item.value));
      gender.forEach((item) => addSlice(googleMaps.gender, item.label, item.value));
      platform.forEach((item) => addSlice(googleMaps.platform, item.label, item.value));
      device.forEach((item) => addSlice(googleMaps.device, item.label, item.value));
    }));
  }));

  return Response.json({
    meta: {
      age: mapToSlices(metaMaps.age),
      gender: mapToSlices(metaMaps.gender),
      platform: mapToSlices(metaMaps.platform),
      device: mapToSlices(metaMaps.device),
    },
    google: {
      age: mapToSlices(googleMaps.age),
      gender: mapToSlices(googleMaps.gender),
      platform: mapToSlices(googleMaps.platform),
      device: mapToSlices(googleMaps.device),
    },
  } satisfies AudienceResponse);
}
