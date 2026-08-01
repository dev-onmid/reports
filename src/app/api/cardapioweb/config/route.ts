import type { NextRequest } from 'next/server';
import { randomBytes } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import {
  ensureCardapioWebSchema, getConnection, getMerchant, maskToken,
  CardapioWebError, CONN_COLS,
} from '@/lib/cardapioweb';
import { normalizarRegua } from '@/lib/cardapioweb-recorrencia';

/**
 * Conexão do Cardápio Web POR CLIENTE (código da loja + token).
 *
 * O token cru NUNCA volta ao browser: o GET devolve `token_masked`. Isso é
 * deliberado — a doc do Cardápio Web diz que o token "concede acesso amplo", e
 * com ele daria para cancelar pedido e editar o cardápio do cliente.
 */

function publico(row: Record<string, unknown> | null) {
  if (!row) return null;
  const { api_token, webhook_token, ...resto } = row as Record<string, string>;
  return {
    ...resto,
    token_masked: maskToken(api_token),
    // O token do webhook PODE voltar: ele é o valor que o usuário precisa colar
    // no portal do lojista, e sozinho não dá acesso a nada — só autentica a
    // chamada que o Cardápio Web faz para nós.
    webhook_token: webhook_token ?? null,
  };
}

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const conn = await getConnection(pool, clientId);
    if (!conn) return Response.json({ conexao: null });

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS pedidos, MAX(created_at) AS ultimo_pedido
         FROM public.cardapioweb_orders WHERE client_id = $1`,
      [clientId],
    ).catch(() => ({ rows: [{ pedidos: 0, ultimo_pedido: null }] }));

    return Response.json({
      conexao: publico(conn as unknown as Record<string, unknown>),
      pedidos_sincronizados: rows[0]?.pedidos ?? 0,
      ultimo_pedido: rows[0]?.ultimo_pedido ?? null,
    });
  } catch {
    return Response.json({ conexao: null });
  } finally {
    await pool.end();
  }
}

/**
 * Salva a conexão. O token é VALIDADO contra `GET /merchant` antes de entrar no
 * banco — token errado devolve erro na hora, em vez de gravar uma conexão morta
 * que só falharia silenciosamente no cron horas depois.
 */
export async function POST(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    clientId?: string; token?: string; sandbox?: boolean;
    janelaDias?: number; inatividadeDias?: number;
  };
  const clientId = body.clientId?.trim();
  const token = body.token?.trim();
  if (!clientId || !token) {
    return Response.json({ error: 'clientId e token são obrigatórios.' }, { status: 400 });
  }
  const sandbox = body.sandbox === true;

  let merchant;
  try {
    merchant = await getMerchant({ api_token: token, sandbox });
  } catch (err) {
    const e = err as CardapioWebError;
    const dica = e.status === 401 || e.status === 403
      ? 'Token recusado pelo Cardápio Web. Confira se copiou o token inteiro do portal do lojista (Configurações → Integrações → API).'
      : e.message;
    return Response.json({ error: dica, status: e.status }, { status: 400 });
  }

  const regua = normalizarRegua({ janelaDias: body.janelaDias, inatividadeDias: body.inatividadeDias });

  const pool = makeServerPool();
  try {
    await ensureCardapioWebSchema(pool);
    // Token do webhook gerado por nós e mostrado uma vez na tela para o usuário
    // colar no portal do lojista. Preservado no UPDATE: regerar a cada save
    // quebraria o webhook já cadastrado do outro lado, em silêncio.
    const webhookToken = randomBytes(24).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO public.cardapioweb_connections
         (client_id, api_token, merchant_id, merchant_name, webhook_token, sandbox,
          janela_dias, inatividade_dias)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id) DO UPDATE SET
         api_token = $2, merchant_id = $3, merchant_name = $4, sandbox = $6,
         janela_dias = $7, inatividade_dias = $8, active = true,
         ultimo_erro = NULL, updated_at = NOW()
       RETURNING ${CONN_COLS}`,
      [
        clientId, token,
        merchant?.id != null ? String(merchant.id) : null,
        merchant?.name ?? null,
        webhookToken, sandbox,
        regua.janelaDias, regua.inatividadeDias,
      ],
    );
    return Response.json({ ok: true, conexao: publico(rows[0] as Record<string, unknown>) });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao salvar a conexão.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

/** Ajusta só a régua de recorrência, sem exigir o token de novo. */
export async function PATCH(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    clientId?: string; janelaDias?: number; inatividadeDias?: number; active?: boolean;
  };
  if (!body.clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCardapioWebSchema(pool);
    const atual = await getConnection(pool, body.clientId);
    if (!atual) return Response.json({ error: 'Conexão não encontrada.' }, { status: 404 });

    const regua = normalizarRegua({
      janelaDias: body.janelaDias ?? atual.janela_dias,
      inatividadeDias: body.inatividadeDias ?? atual.inatividade_dias,
    });

    const { rows } = await pool.query(
      `UPDATE public.cardapioweb_connections
          SET janela_dias = $2, inatividade_dias = $3,
              active = COALESCE($4, active), updated_at = NOW()
        WHERE client_id = $1
        RETURNING ${CONN_COLS}`,
      [body.clientId, regua.janelaDias, regua.inatividadeDias,
       typeof body.active === 'boolean' ? body.active : null],
    );
    return Response.json({ ok: true, conexao: publico(rows[0] as Record<string, unknown>) });
  } finally {
    await pool.end();
  }
}

/**
 * Remove a conexão. Os PEDIDOS são preservados de propósito: o histórico já
 * sincronizado é dado do cliente, e apagá-lo por causa de uma troca de token
 * significaria refazer 30 minutos de importação limitada por rate limit.
 */
export async function DELETE(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCardapioWebSchema(pool);
    await pool.query('DELETE FROM public.cardapioweb_connections WHERE client_id = $1', [clientId]);
    return Response.json({ ok: true, pedidos_preservados: true });
  } finally {
    await pool.end();
  }
}
