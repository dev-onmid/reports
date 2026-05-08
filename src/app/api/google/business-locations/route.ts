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

async function getFreshAccessToken(conn: {
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
}): Promise<string> {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials.access_token!;
}

type GmbLocation = {
  locationId: string;
  accountId: string;
  name: string;
  address?: string;
  phone?: string;
  websiteUrl?: string;
  metrics?: GmbMetrics;
};

type GmbMetrics = {
  impressions: number;
  searchImpressions: number;
  mapsImpressions: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
};

async function gmbGet(url: string, accessToken: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchLocationMetrics(
  locationName: string,
  accessToken: string,
): Promise<GmbMetrics | null> {
  const now = new Date();
  const end = { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = { year: startDate.getFullYear(), month: startDate.getMonth() + 1, day: startDate.getDate() };

  const res = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricTimeSeries`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dailyMetrics: [
          'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
          'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
          'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
          'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
          'WEBSITE_CLICKS',
          'CALL_CLICKS',
          'BUSINESS_DIRECTION_REQUESTS',
        ],
        dailyRange: { startDate: start, endDate: end },
      }),
    },
  );
  if (!res.ok) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { multiDailyMetricTimeSeries?: any[] };
  const series = data.multiDailyMetricTimeSeries ?? [];

  function sumMetric(metricName: string): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entry = series.find((s: any) => s.dailyMetric === metricName);
    if (!entry) return 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (entry.timeSeries?.datedValues ?? []).reduce((sum: number, v: any) => sum + (Number(v.value) || 0), 0);
  }

  const desktopSearch = sumMetric('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH');
  const mobileSearch = sumMetric('BUSINESS_IMPRESSIONS_MOBILE_SEARCH');
  const desktopMaps = sumMetric('BUSINESS_IMPRESSIONS_DESKTOP_MAPS');
  const mobileMaps = sumMetric('BUSINESS_IMPRESSIONS_MOBILE_MAPS');

  return {
    impressions: desktopSearch + mobileSearch + desktopMaps + mobileMaps,
    searchImpressions: desktopSearch + mobileSearch,
    mapsImpressions: desktopMaps + mobileMaps,
    websiteClicks: sumMetric('WEBSITE_CLICKS'),
    callClicks: sumMetric('CALL_CLICKS'),
    directionRequests: sumMetric('BUSINESS_DIRECTION_REQUESTS'),
  };
}

export async function GET(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  const noMetrics = request.nextUrl.searchParams.get('noMetrics') === 'true';
  if (!connectionId) return Response.json({ error: 'Missing connectionId' }, { status: 400 });

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.google_connections WHERE id = $1',
      [connectionId],
    );
    conn = rows[0];
  } finally {
    await pool.end();
  }
  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 });

  const accessToken = await getFreshAccessToken(conn);

  // List accounts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountsData = await gmbGet('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', accessToken) as any;
  if (!accountsData) return Response.json({ error: 'Failed to list GMB accounts' }, { status: 502 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts: any[] = accountsData.accounts ?? [];
  if (accounts.length === 0) return Response.json([]);

  const locations: GmbLocation[] = [];

  await Promise.allSettled(
    accounts.map(async (account) => {
      const accountName: string = account.name; // e.g. "accounts/123456"
      const accountId = accountName.replace('accounts/', '');

      const locData = await gmbGet(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,phoneNumbers,websiteUri,storefrontAddress`,
        accessToken,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any;
      if (!locData) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const locs: any[] = locData.locations ?? [];
      await Promise.allSettled(
        locs.map(async (loc) => {
          const locationName: string = loc.name; // e.g. "locations/987654"
          const locationId = locationName.replace('locations/', '');

          const addressParts = [
            loc.storefrontAddress?.addressLines?.[0],
            loc.storefrontAddress?.locality,
            loc.storefrontAddress?.administrativeArea,
          ].filter(Boolean);

          const entry: GmbLocation = {
            locationId,
            accountId,
            name: loc.title ?? `Local ${locationId}`,
            address: addressParts.join(', ') || undefined,
            phone: loc.phoneNumbers?.primaryPhone ?? undefined,
            websiteUrl: loc.websiteUri ?? undefined,
          };

          if (!noMetrics) {
            entry.metrics = await fetchLocationMetrics(locationName, accessToken) ?? undefined;
          }

          locations.push(entry);
        }),
      );
    }),
  );

  return Response.json(locations);
}
