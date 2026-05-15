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

    // Get the page access token
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,access_token&limit=100&access_token=${userToken}`
    );
    const pagesData = await pagesRes.json() as { data?: Array<{ id: string; access_token: string }> };
    const page = (pagesData.data ?? []).find(p => p.id === pageId);
    const pageToken = page?.access_token ?? userToken;

    // Subscribe the page to the app with the needed webhook fields
    const fields = platform === 'instagram'
      ? 'instagram_incoming_messages,comments,mentions'
      : 'feed,messages';

    const subRes = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
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

    return Response.json({ ok: true, subscribed_fields: fields });
  } finally {
    await pool.end();
  }
}
