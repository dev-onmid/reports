import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

type ActionBody = {
  action: 'pause' | 'activate' | 'set_budget';
  connectionId: string;
  accountId: string;
  loginCustomerId?: string;
  budgetResourceName?: string;
  dailyBudget?: number;
};

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
  const { id: campaignId } = await params;
  const body = await req.json() as ActionBody;
  const { action, connectionId, accountId, loginCustomerId, budgetResourceName, dailyBudget } = body;

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

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;

  // Budget mutation
  if (action === 'set_budget') {
    if (!budgetResourceName || dailyBudget == null) {
      return Response.json({ error: 'budgetResourceName e dailyBudget são obrigatórios.' }, { status: 400 });
    }
    const res = await fetch(
      `https://googleads.googleapis.com/v24/customers/${accountId}/campaignBudgets:mutate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operations: [{
            update: { resourceName: budgetResourceName, amountMicros: Math.round(dailyBudget * 1_000_000) },
            updateMask: 'amountMicros',
          }],
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return Response.json({ error: err.error?.message ?? `Google Ads API HTTP ${res.status}` }, { status: res.status });
    }
    return Response.json({ ok: true, dailyBudget });
  }

  // Status mutation
  const newGadsStatus = action === 'pause' ? 'PAUSED' : 'ENABLED';
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${accountId}/campaigns:mutate`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        operations: [{
          update: {
            resourceName: `customers/${accountId}/campaigns/${campaignId}`,
            status: newGadsStatus,
          },
          updateMask: 'status',
        }],
      }),
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json(
      { error: err.error?.message ?? `Google Ads API HTTP ${res.status}` },
      { status: res.status },
    );
  }

  return Response.json({ ok: true, newStatus: newGadsStatus });
}
