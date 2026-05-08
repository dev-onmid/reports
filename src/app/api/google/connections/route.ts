import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? '',
    picture: r.picture ?? null,
    accessToken: r.access_token ?? '',
    refreshToken: r.refresh_token ?? '',
    tokenExpiry: r.token_expiry ?? null,
    scope: r.scope ?? '',
    accountType: r.account_type ?? 'gmb',
    status: r.status ?? 'connected',
    connectedAt: r.connected_at ?? new Date().toISOString(),
  };
}

export async function GET() {
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.google_connections ORDER BY connected_at DESC'
    );
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const pool = makePool();
  try {
    await pool.query('DELETE FROM public.google_connections WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
