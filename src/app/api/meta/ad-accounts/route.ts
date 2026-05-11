import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type MetaAdAccount = {
  id: string;
  name: string;
  accountStatus: number; // 1 = active
  currency?: string;
};

export async function GET(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  if (!connectionId) return Response.json({ error: 'Missing connectionId' }, { status: 400 });

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    const { rows } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1', [connectionId]);
    conn = rows[0];
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 });

  const res = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,account_status,currency&limit=100&access_token=${conn.access_token as string}`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return Response.json({ error: 'Failed to fetch ad accounts', detail: body }, { status: 502 });
  }

  const data = await res.json() as { data?: Array<{ id: string; name: string; account_status: number; currency?: string }> };
  return Response.json(
    (data.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      accountStatus: a.account_status,
      currency: a.currency,
    }) satisfies MetaAdAccount)
  );
}
