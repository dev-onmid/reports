import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { randomBytes } from 'node:crypto';
import { maskToken, tokenEhMascara } from '@/lib/anotaai';

const ENSURE = `
  CREATE TABLE IF NOT EXISTS public.client_anota_ai_stores (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id          TEXT NOT NULL,
    store_name         TEXT NOT NULL,
    store_id           TEXT NOT NULL,
    ifood_store_id     TEXT,
    integration_token  TEXT NOT NULL,
    active             BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status   TEXT,
    last_test_message  TEXT,
    last_test_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_client_anota_ai_stores_client ON public.client_anota_ai_stores (client_id);
`;

type AnotaAiPayload = {
  id?: string;
  storeName?: string;
  storeId?: string;
  ifoodStoreId?: string;
  integrationToken?: string;
  active?: boolean;
};

/**
 * O token NUNCA volta inteiro ao browser — só o suficiente pra reconhecer qual
 * é. Ele dá acesso aos pedidos da loja do cliente na API do Anota AI; devolvê-lo
 * a cada carregamento de tela é o mesmo padrão que vazou o Cofre.
 *
 * Como a tela reusa o valor ao EDITAR, o PUT trata "vazio ou mascarado" como
 * "manter o token atual" — assim editar o nome da loja não apaga a credencial.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function semToken(r: any) {
  const { _rawToken, ...resto } = r;
  return { ...resto, integrationToken: maskToken(_rawToken), tokenConfigurado: Boolean(_rawToken) };
}

/**
 * "Token Externo" do Portal de Integração — o valor que o Anota AI devolve pra
 * nós em cada webhook, e a única autenticação disponível nesse caminho.
 *
 * Gerado sob demanda na primeira leitura: a loja pode ter sido cadastrada antes
 * desta coluna existir, e exigir recadastro só pra isso seria atrito à toa.
 * Diferente do token DELES, este pode voltar inteiro ao browser — é justamente
 * o que precisa ser copiado pro portal, e sozinho não dá acesso a nada.
 */
async function garantirWebhookToken(pool: ReturnType<typeof makeServerPool>, clientId: string) {
  await pool.query(
    `UPDATE public.client_anota_ai_stores
        SET webhook_token = $2, updated_at = NOW()
      WHERE client_id = $1 AND (webhook_token IS NULL OR webhook_token = '')`,
    [clientId, randomBytes(24).toString('hex')],
  ).catch(() => {});
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    await pool.query('ALTER TABLE public.client_anota_ai_stores ADD COLUMN IF NOT EXISTS webhook_token TEXT').catch(() => {});
    await garantirWebhookToken(pool, clientId);
    const { rows } = await pool.query(
      `SELECT
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "_rawToken",
         webhook_token AS "webhookToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM public.client_anota_ai_stores
       WHERE client_id = $1
       ORDER BY active DESC, store_name ASC`,
      [clientId],
    );
    return Response.json(rows.map(semToken));
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await params;
  const body = await req.json() as AnotaAiPayload;
  const storeName = clean(body.storeName);
  const storeId = clean(body.storeId);
  const integrationToken = clean(body.integrationToken);

  if (!storeName || !storeId || !integrationToken) {
    return Response.json({ error: 'Nome da loja, ID da loja e token são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `INSERT INTO public.client_anota_ai_stores
         (client_id, store_name, store_id, ifood_store_id, integration_token, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "_rawToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [clientId, storeName, storeId, clean(body.ifoodStoreId) || null, integrationToken, body.active ?? true],
    );
    return Response.json(semToken(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await params;
  const body = await req.json() as AnotaAiPayload;
  const id = clean(body.id);
  const storeName = clean(body.storeName);
  const storeId = clean(body.storeId);
  const integrationToken = clean(body.integrationToken);

  if (!id || !storeName || !storeId) {
    return Response.json({ error: 'ID, nome da loja e ID da loja são obrigatórios.' }, { status: 400 });
  }
  // Token vazio ou ainda mascarado = manter o que está gravado. Sem isso,
  // editar o nome da loja gravaria os bolinhas por cima da credencial real.
  const trocarToken = Boolean(integrationToken) && !tokenEhMascara(integrationToken);

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    const { rows } = await pool.query(
      `UPDATE public.client_anota_ai_stores
       SET store_name = $3,
           store_id = $4,
           ifood_store_id = $5,
           integration_token = CASE WHEN $8::boolean THEN $6 ELSE integration_token END,
           active = $7,
           updated_at = NOW()
       WHERE id = $1 AND client_id = $2
       RETURNING
         id::text,
         store_name AS "storeName",
         store_id AS "storeId",
         ifood_store_id AS "ifoodStoreId",
         integration_token AS "_rawToken",
         active,
         last_test_status AS "lastTestStatus",
         last_test_message AS "lastTestMessage",
         last_test_at AS "lastTestAt",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [id, clientId, storeName, storeId, clean(body.ifoodStoreId) || null, integrationToken, body.active ?? true, trocarToken],
    );
    if (!rows[0]) return Response.json({ error: 'Loja não encontrada.' }, { status: 404 });
    return Response.json(semToken(rows[0]));
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!getSession(req)) return unauthorized();
  const { id: clientId } = await params;
  const storeId = req.nextUrl.searchParams.get('storeId');
  if (!storeId) return Response.json({ error: 'storeId obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await pool.query(ENSURE);
    await pool.query(
      `DELETE FROM public.client_anota_ai_stores WHERE id = $1 AND client_id = $2`,
      [storeId, clientId],
    );
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
