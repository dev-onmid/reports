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

  const listRes = await fetch('https://googleads.googleapis.com/v19/customers:listAccessibleCustomers', {
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

  const accounts = (
    await Promise.allSettled(
      resourceNames.map(async (resourceName: string) => {
        const customerId = resourceName.replace('customers/', '');
        const res = await fetch(
          `https://googleads.googleapis.com/v19/customers/${customerId}/googleAds:search`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'developer-token': developerToken,
              'Content-Type': 'application/json',
            },
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
      })
    )
  )
    .filter(
      (r): r is PromiseFulfilledResult<{ id: string; name: string; currency: string; status: string; isManager: boolean }> =>
        r.status === 'fulfilled' && r.value !== null
    )
    .map((r) => r.value);

  return Response.json(accounts);
}
