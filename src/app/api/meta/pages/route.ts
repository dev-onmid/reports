import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type MetaPage = {
  id: string;
  name: string;
  instagramAccountId?: string;
  instagramUsername?: string;
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
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,name,username}&limit=100&access_token=${conn.access_token as string}`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return Response.json({ error: 'Failed to fetch pages', detail: body }, { status: 502 });
  }

  const data = await res.json() as {
    data?: Array<{
      id: string;
      name: string;
      instagram_business_account?: { id: string; name?: string; username?: string };
    }>
  };

  return Response.json(
    (data.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      instagramAccountId: p.instagram_business_account?.id,
      instagramUsername: p.instagram_business_account?.username ?? p.instagram_business_account?.name,
    }) satisfies MetaPage)
  );
}
