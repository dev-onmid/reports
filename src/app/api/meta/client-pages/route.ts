import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export type ClientPage = {
  platform: 'instagram' | 'facebook';
  account_id: string;
  account_name: string;
  picture_url: string | null;
};

export async function GET(request: NextRequest) {
  const clientId = request.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'Missing clientId' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Get the client's specific Meta ad account IDs and their connection
    const { rows: links } = await pool.query(
      `SELECT cal.account_id, cal.connection_id
       FROM public.client_account_links cal
       WHERE cal.client_id = $1
         AND cal.platform = 'meta_ads'
         AND cal.connection_id IS NOT NULL`,
      [clientId]
    );
    if (!links.length) return Response.json([]);

    // Get the first valid connection token
    const connectionId = links[0].connection_id as string;
    const { rows: [conn] } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE id = $1 AND status = 'connected'`,
      [connectionId]
    );
    if (!conn) return Response.json([]);

    const token = await getFreshMetaToken(conn);
    const pages: ClientPage[] = [];
    const seen = new Set<string>();

    // For each ad account, fetch its promote_pages (only the pages tied to that specific ad account)
    await Promise.all(
      links.map(async (link: { account_id: string }) => {
        const adAccountId = link.account_id.startsWith('act_') ? link.account_id : `act_${link.account_id}`;
        try {
          const res = await fetch(
            `https://graph.facebook.com/v21.0/${adAccountId}/promote_pages` +
            `?fields=id,name,picture{url},instagram_business_account{id,name,username,profile_picture_url}` +
            `&limit=50&access_token=${token}`
          );
          if (!res.ok) return;
          const data = await res.json() as {
            data?: Array<{
              id: string;
              name: string;
              picture?: { data?: { url?: string } };
              instagram_business_account?: {
                id: string;
                name?: string;
                username?: string;
                profile_picture_url?: string;
              };
            }>;
          };

          for (const p of data.data ?? []) {
            const fbKey = `fb::${p.id}`;
            if (!seen.has(fbKey)) {
              seen.add(fbKey);
              pages.push({
                platform: 'facebook',
                account_id: p.id,
                account_name: p.name,
                picture_url: p.picture?.data?.url ?? null,
              });
            }
            if (p.instagram_business_account) {
              const igKey = `ig::${p.instagram_business_account.id}`;
              if (!seen.has(igKey)) {
                seen.add(igKey);
                const igName = p.instagram_business_account.username
                  ? `@${p.instagram_business_account.username}`
                  : (p.instagram_business_account.name ?? p.name);
                pages.push({
                  platform: 'instagram',
                  account_id: p.instagram_business_account.id,
                  account_name: igName,
                  picture_url: p.instagram_business_account.profile_picture_url ?? null,
                });
              }
            }
          }
        } catch { /* skip failed ad account */ }
      })
    );

    return Response.json(pages);
  } finally {
    await pool.end();
  }
}
