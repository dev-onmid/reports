import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { createEvolutionInstance, setEvolutionWebhook, webhookOrigin } from '@/lib/evolution-api';
import {
  ensureMetaInstanceColumns, guardarTokenMeta, inscreverAppNoWaba, verificarNumeroMeta,
} from '@/lib/meta-whatsapp';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureMetaInstanceColumns(pool);
    // O token da API oficial é permanente e nunca volta para o navegador.
    const { rows } = await pool.query(
      `SELECT id, nome, instance_id,
              CASE WHEN provider = 'meta' THEN '' ELSE token END AS token,
              ativo, provider, created_at,
              meta_waba_id, meta_display_phone, meta_verified_name
       FROM public.client_zapi_instances
       WHERE client_id = $1 ORDER BY created_at ASC`,
      [id],
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    nome?: string;
    instance_id?: string;
    token?: string;
    waba_id?: string;
    provider?: 'zapi' | 'evolution' | 'meta';
  };

  if (!body.nome) {
    return Response.json({ error: 'nome é obrigatório' }, { status: 400 });
  }

  const provider = body.provider === 'evolution' ? 'evolution' : body.provider === 'meta' ? 'meta' : 'zapi';
  const instanceId = (body.instance_id ?? '').trim();
  let token = (body.token ?? '').trim();
  const wabaId = (body.waba_id ?? '').trim();

  if (provider === 'zapi') {
    if (!instanceId || !token) {
      return Response.json({ error: 'instance_id e token são obrigatórios para Z-API' }, { status: 400 });
    }
  }

  if (provider === 'evolution') {
    if (!instanceId) {
      return Response.json({ error: 'Nome da instância (Evolution API) é obrigatório' }, { status: 400 });
    }
    try {
      const created = await createEvolutionInstance(instanceId);
      token = created.hash;
    } catch (err) {
      return Response.json(
        { error: `Erro ao criar instância na Evolution API: ${String(err)}` },
        { status: 502 },
      );
    }
  }

  let numero: Awaited<ReturnType<typeof verificarNumeroMeta>> | null = null;
  let inscricao: Awaited<ReturnType<typeof inscreverAppNoWaba>> | null = null;
  if (provider === 'meta') {
    if (!/^\d{5,}$/.test(instanceId) || !/^\d{5,}$/.test(wabaId) || !token) {
      return Response.json({ error: 'ID do número, ID da conta WhatsApp Business e token são obrigatórios (os IDs são só números).' }, { status: 400 });
    }
    numero = await verificarNumeroMeta(instanceId, token);
    if (!numero.ok) {
      return Response.json({ error: `A Meta recusou o token/ID do número: ${numero.error}` }, { status: 400 });
    }
    inscricao = await inscreverAppNoWaba(wabaId, token);
  }

  const pool = makeServerPool();
  try {
    await ensureMetaInstanceColumns(pool);
    const { rows: [row] } = await pool.query(`
      INSERT INTO public.client_zapi_instances
        (client_id, nome, instance_id, token, provider, meta_waba_id, meta_display_phone, meta_verified_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, nome, instance_id,
                CASE WHEN provider = 'meta' THEN '' ELSE token END AS token,
                ativo, provider, created_at,
                meta_waba_id, meta_display_phone, meta_verified_name
    `, [
      id, body.nome, instanceId,
      provider === 'meta' ? guardarTokenMeta(token) : token,
      provider,
      provider === 'meta' ? wabaId : null,
      numero?.displayPhone ?? null,
      numero?.verifiedName ?? null,
    ]);

    if (provider === 'evolution') {
      const appUrl = webhookOrigin(req.url);
      await setEvolutionWebhook(instanceId, `${appUrl}/api/webhook/whatsapp/${row.id}`);
    }

    return Response.json({
      ...row,
      ...(inscricao ? { webhook_inscrito: inscricao.ok, webhook_erro: inscricao.error } : {}),
    }, { status: 201 });
  } finally {
    await pool.end();
  }
}
