import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { createEvolutionInstance, setEvolutionWebhook, webhookOrigin } from '@/lib/evolution-api';
import {
  ensureMetaInstanceColumns, guardarTokenMeta, inscreverAppNoWaba, verificarNumeroMeta,
} from '@/lib/meta-whatsapp';
import {
  ensureTolkiInstanceColumns, gerarTokenWebhookTolki, guardarApiKeyTolki, listarConexoesTolki,
} from '@/lib/tolki';

const COLUNAS_PUBLICAS = `id, nome, instance_id,
              CASE WHEN provider = 'meta' THEN '' ELSE token END AS token,
              ativo, provider, created_at,
              meta_waba_id, meta_display_phone, meta_verified_name,
              (tolki_api_key IS NOT NULL AND tolki_api_key <> '') AS tolki_tem_api_key`;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureMetaInstanceColumns(pool);
    await ensureTolkiInstanceColumns(pool);
    // O token da API oficial é permanente e nunca volta para o navegador; o da
    // Tolki é o Bearer que o cliente precisa colar lá, então volta. A chave da
    // API da Tolki nunca volta — só se existe.
    const { rows } = await pool.query(
      `SELECT ${COLUNAS_PUBLICAS}
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
    tolki_api_key?: string;
    provider?: 'zapi' | 'evolution' | 'meta' | 'tolki';
  };

  if (!body.nome) {
    return Response.json({ error: 'nome é obrigatório' }, { status: 400 });
  }

  const provider = body.provider === 'evolution' ? 'evolution'
    : body.provider === 'meta' ? 'meta'
    : body.provider === 'tolki' ? 'tolki'
    : 'zapi';
  let instanceId = (body.instance_id ?? '').trim();
  let token = (body.token ?? '').trim();
  const wabaId = (body.waba_id ?? '').trim();
  const tolkiApiKey = (body.tolki_api_key ?? '').trim();

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

  // Tolki: a chave da API valida e descobre a conexão (o número); o token do
  // webhook é gerado aqui e o cliente cola na Tolki.
  let conexaoTolki: { phone: string | null; name: string } | null = null;
  if (provider === 'tolki') {
    if (!tolkiApiKey) {
      return Response.json({ error: 'A chave da API da Tolki (X-API-Key) é obrigatória.' }, { status: 400 });
    }
    const conexoes = await listarConexoesTolki(tolkiApiKey);
    if (!conexoes.ok) {
      return Response.json({ error: `A Tolki recusou a chave da API: ${conexoes.error}` }, { status: 400 });
    }
    const whatsapp = conexoes.data.filter(c => c.type !== 'webchat');
    const escolhida = instanceId
      ? whatsapp.find(c => c.id === instanceId)
      : whatsapp.length === 1 ? whatsapp[0] : undefined;
    if (!escolhida) {
      return Response.json({
        error: instanceId
          ? 'Essa conexão não existe nessa conta da Tolki.'
          : whatsapp.length === 0
            ? 'Nenhuma conexão de WhatsApp nessa conta da Tolki.'
            : 'Essa conta tem mais de uma conexão — informe o ID da conexão.',
        conexoes: whatsapp,
      }, { status: 400 });
    }
    instanceId = escolhida.id;
    conexaoTolki = { phone: escolhida.phone, name: escolhida.name };
    token = gerarTokenWebhookTolki();
  }

  const pool = makeServerPool();
  try {
    await ensureMetaInstanceColumns(pool);
    await ensureTolkiInstanceColumns(pool);
    const { rows: [row] } = await pool.query(`
      INSERT INTO public.client_zapi_instances
        (client_id, nome, instance_id, token, provider, meta_waba_id, meta_display_phone, meta_verified_name, tolki_api_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${COLUNAS_PUBLICAS}
    `, [
      id, body.nome, instanceId,
      provider === 'meta' ? guardarTokenMeta(token) : token,
      provider,
      provider === 'meta' ? wabaId : null,
      numero?.displayPhone ?? conexaoTolki?.phone ?? null,
      numero?.verifiedName ?? conexaoTolki?.name ?? null,
      provider === 'tolki' ? guardarApiKeyTolki(tolkiApiKey) : null,
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
