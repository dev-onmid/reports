import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export async function POST(request: NextRequest) {
  const { pageId, platform } = await request.json() as { pageId: string; platform: 'instagram' | 'facebook' };
  if (!pageId) return Response.json({ error: 'Missing pageId' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [conn] } = await pool.query(
      `SELECT * FROM public.meta_connections WHERE status = 'connected' LIMIT 1`
    );
    if (!conn) return Response.json({ error: 'Nenhuma conexão Meta ativa' }, { status: 400 });

    const userToken = await getFreshMetaToken(conn);

    // Fetch all pages with their Instagram accounts and tokens
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token,instagram_business_account{id}&limit=100&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json() as {
      data?: Array<{
        id: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
    };
    const pages = pagesData.data ?? [];

    // For Instagram: find the Facebook page that owns this Instagram account
    // For Facebook: find the page directly by ID
    let fbPageId: string;
    let pageToken: string;

    if (platform === 'instagram') {
      const parent = pages.find(p => p.instagram_business_account?.id === pageId);
      if (!parent) {
        return Response.json({
          error: `Nenhuma página Facebook encontrada vinculada a este Instagram (ID: ${pageId}). Verifique se a conta está conectada.`,
        }, { status: 400 });
      }
      fbPageId = parent.id;
      pageToken = parent.access_token;
    } else {
      const page = pages.find(p => p.id === pageId);
      fbPageId = pageId;
      pageToken = page?.access_token ?? userToken;
    }

    // Instagram: subscribe the IG Business Account directly using instagram_manage_messages
    // (does NOT require pages_messaging — uses the IG account ID, not the FB page ID)
    if (platform === 'instagram') {
      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscribed_fields: 'messages,comments', access_token: userToken }),
        }
      );
      const igData = await igRes.json() as { success?: boolean; error?: { message?: string } };
      if (!igRes.ok || !igData.success) {
        return Response.json({ error: igData.error?.message ?? 'Falha ao inscrever conta Instagram' }, { status: 400 });
      }
      return Response.json({ ok: true, ig_id: pageId, subscribed_fields: 'messages,comments' });
    }

    // Facebook Pages: subscribe the page to receive feed + messages events
    const fields = 'feed,messages';

    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${fbPageId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscribed_fields: fields, access_token: pageToken }),
      }
    );
    const subData = await subRes.json() as { success?: boolean; error?: { message?: string } };

    if (!subRes.ok || !subData.success) {
      return Response.json({
        error: subData.error?.message ?? 'Falha ao inscrever página',
      }, { status: 400 });
    }

    return Response.json({ ok: true, fb_page_id: fbPageId, subscribed_fields: fields });
  } finally {
    await pool.end();
  }
}
