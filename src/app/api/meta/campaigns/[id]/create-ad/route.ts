import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

type CreateAdBody = {
  connectionId: string;
  accountId: string;
  adsetId: string;
  sourceCreativeId: string;
  newBody: string;
  newTitle?: string;
  pauseSourceAdId?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await params; // campaignId not used directly here

  const body = await req.json() as CreateAdBody;
  const { connectionId, accountId, adsetId, sourceCreativeId, newBody, newTitle, pauseSourceAdId } = body;

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      conn = rows[0] ?? null;
    }
    if (!conn) {
      const { rows } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = rows[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Meta não encontrada.' }, { status: 404 });

  const token = await getFreshMetaToken(conn);
  const actId = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

  // 1. Fetch the source creative's full spec
  const creativeRes = await fetch(
    `https://graph.facebook.com/v21.0/${sourceCreativeId}?fields=effective_object_story_spec,object_story_spec,image_hash,thumbnail_url&access_token=${token}`,
  );
  if (!creativeRes.ok) {
    return Response.json({ error: 'Não foi possível buscar o criativo original.' }, { status: 502 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const creative = await creativeRes.json() as any;

  // Build new object_story_spec by patching the message/body
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseSpec = (creative.object_story_spec ?? creative.effective_object_story_spec) as any;
  if (!baseSpec) {
    return Response.json({ error: 'Criativo sem object_story_spec — tipo não suportado para duplicação.' }, { status: 422 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newSpec: any = JSON.parse(JSON.stringify(baseSpec));
  if (newSpec.link_data) {
    newSpec.link_data.message = newBody;
    if (newTitle) newSpec.link_data.name = newTitle;
  } else if (newSpec.video_data) {
    newSpec.video_data.message = newBody;
    if (newTitle) newSpec.video_data.title = newTitle;
  } else if (newSpec.photo_data) {
    newSpec.photo_data.caption = newBody;
  }

  // 2. Create new creative
  const newCreativeRes = await fetch(`https://graph.facebook.com/v21.0/${actId}/adcreatives`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Copy IA — ${new Date().toLocaleDateString('pt-BR')}`,
      object_story_spec: newSpec,
      access_token: token,
    }),
  });
  if (!newCreativeRes.ok) {
    const err = await newCreativeRes.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? 'Erro ao criar criativo.' }, { status: 502 });
  }
  const newCreative = await newCreativeRes.json() as { id: string };

  // 3. Create new ad
  const newAdRes = await fetch(`https://graph.facebook.com/v21.0/${actId}/ads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `Copy IA — ${new Date().toLocaleDateString('pt-BR')}`,
      adset_id: adsetId,
      creative: { creative_id: newCreative.id },
      status: 'ACTIVE',
      access_token: token,
    }),
  });
  if (!newAdRes.ok) {
    const err = await newAdRes.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? 'Erro ao criar anúncio.' }, { status: 502 });
  }
  const newAd = await newAdRes.json() as { id: string };

  // 4. Pause old ad if requested
  if (pauseSourceAdId) {
    await fetch(`https://graph.facebook.com/v21.0/${pauseSourceAdId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED', access_token: token }),
    });
  }

  return Response.json({ ok: true, newAdId: newAd.id });
}
