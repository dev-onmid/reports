import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

async function getFreshToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }) {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token!;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adGroupId } = await params;
  const { action, connectionId, accountId, loginCustomerId } = await req.json() as {
    action: 'pause' | 'activate';
    connectionId: string;
    accountId: string;
    loginCustomerId?: string;
  };

  const pool = makeServerPool();
  let conn: { access_token: string; refresh_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Google não encontrada.' }, { status: 404 });

  const accessToken = await getFreshToken(conn);
  const newStatus = action === 'pause' ? 'PAUSED' : 'ENABLED';

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  const res = await fetch(
    `https://googleads.googleapis.com/v20/customers/${accountId}/adGroups:mutate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName: `customers/${accountId}/adGroups/${adGroupId}`,
            status: newStatus,
          },
          updateMask: 'status',
        }],
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Google Ads API HTTP ${res.status}` }, { status: res.status });
  }

  return Response.json({ ok: true, newStatus });
}
