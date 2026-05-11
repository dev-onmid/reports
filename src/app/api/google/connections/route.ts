import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

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
  const pool = makeServerPool();
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
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.google_connections WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
