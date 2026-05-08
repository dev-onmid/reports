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
    if (expiry > Date.now() + 5 * 60 * 1000) {
      return conn.access_token;
    }
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials.access_token!;
}

export async function GET(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  if (!connectionId) return Response.json({ error: 'Missing connectionId' }, { status: 400 });

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.google_connections WHERE id = $1',
      [connectionId]
    );
    conn = rows[0];
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 });

  const accessToken = await getFreshAccessToken(conn);
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

  const listRes = await fetch('https://googleads.googleapis.com/v20/customers:listAccessibleCustomers', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
    },
  });

  if (!listRes.ok) {
    const body = await listRes.text();
    return Response.json({ error: body }, { status: listRes.status });
  }

  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };

  type AdsAccount = { id: string; name: string; currency: string; status: string; isManager: boolean; mccId?: string };

  async function fetchCustomerInfo(customerId: string, loginCustomerId?: string): Promise<AdsAccount | null> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

    const res = await fetch(
      `https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status, customer.manager FROM customer LIMIT 1',
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { results?: { customer?: { id?: string; descriptiveName?: string; currencyCode?: string; status?: string; manager?: boolean } }[] };
    const row = data.results?.[0]?.customer;
    if (!row) return null;
    return {
      id: customerId,
      name: row.descriptiveName ?? `Conta ${customerId}`,
      currency: row.currencyCode ?? 'BRL',
      status: row.status ?? 'ENABLED',
      isManager: row.manager ?? false,
    };
  }

  async function fetchMccSubAccounts(mccId: string): Promise<AdsAccount[]> {
    const res = await fetch(
      `https://googleads.googleapis.com/v20/customers/${mccId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': developerToken,
          'login-customer-id': mccId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
                         customer_client.status, customer_client.manager, customer_client.level
                  FROM customer_client
                  WHERE customer_client.level = 1`,
        }),
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as { results?: { customerClient?: { id?: string; descriptiveName?: string; currencyCode?: string; status?: string; manager?: boolean } }[] };
    return (data.results ?? [])
      .map((r) => r.customerClient)
      .filter(Boolean)
      .map((c) => ({
        id: String(c!.id ?? ''),
        name: c!.descriptiveName ?? `Conta ${c!.id}`,
        currency: c!.currencyCode ?? 'BRL',
        status: c!.status ?? 'ENABLED',
        isManager: c!.manager ?? false,
        mccId,
      }));
  }

  const topLevel = (
    await Promise.allSettled(resourceNames.map((r: string) => fetchCustomerInfo(r.replace('customers/', ''))))
  )
    .filter((r): r is PromiseFulfilledResult<AdsAccount> => r.status === 'fulfilled' && r.value !== null)
    .map((r) => r.value);

  const subAccountArrays = await Promise.allSettled(
    topLevel.filter((a) => a.isManager).map((a) => fetchMccSubAccounts(a.id))
  );

  const subAccounts = subAccountArrays
    .filter((r): r is PromiseFulfilledResult<AdsAccount[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value);

  const allIds = new Set(topLevel.map((a) => a.id));
  const newSubAccounts = subAccounts.filter((a) => !allIds.has(a.id));

  return Response.json([...topLevel, ...newSubAccounts]);
}
