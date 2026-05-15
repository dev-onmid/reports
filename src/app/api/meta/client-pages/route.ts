import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type ClientPage = {
  platform: 'instagram' | 'facebook';
  account_id: string;
  account_name: string;
  label: string;
};

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'Missing clientId' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Get unique connection IDs linked to this client
    const { rows: links } = await pool.query(
      `SELECT DISTINCT connection_id FROM public.client_account_links
       WHERE client_id = $1 AND connection_id IS NOT NULL`,
      [clientId]
    );
    if (!links.length) return Response.json([]);

    const connectionIds = links.map((l: { connection_id: string }) => l.connection_id);

    // Fetch access tokens for those connections
    const { rows: conns } = await pool.query(
      `SELECT id, access_token FROM public.meta_connections
       WHERE id = ANY($1) AND status = 'connected'`,
      [connectionIds]
    );
    if (!conns.length) return Response.json([]);

    const pages: ClientPage[] = [];

    await Promise.all(
      conns.map(async (conn: { id: string; access_token: string }) => {
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,name,username}&limit=100&access_token=${conn.access_token}`
          );
          if (!res.ok) return;
          const data = await res.json() as {
            data?: Array<{
              id: string;
              name: string;
              instagram_business_account?: { id: string; name?: string; username?: string };
            }>
          };
          for (const p of data.data ?? []) {
            pages.push({ platform: 'facebook', account_id: p.id, account_name: p.name, label: `${p.name} (Facebook)` });
            if (p.instagram_business_account) {
              const igName = p.instagram_business_account.username
                ? `@${p.instagram_business_account.username}`
                : (p.instagram_business_account.name ?? p.name);
              pages.push({ platform: 'instagram', account_id: p.instagram_business_account.id, account_name: igName, label: `${igName} (Instagram)` });
            }
          }
        } catch { /* skip failed connection */ }
      })
    );

    return Response.json(pages);
  } finally {
    await pool.end();
  }
}
