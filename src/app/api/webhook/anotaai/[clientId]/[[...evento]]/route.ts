import { timingSafeEqual } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureAnotaAiSchema, listarLojas, getPedido, upsertPedido, type AnotaAiOrder,
} from '@/lib/anotaai';

/**
 * Webhook do Anota AI. Cadastrado pelo lojista no Portal de Integração, que tem
 * TRÊS destinos: Pedidos Realizados, Atualizados e Cancelados.
 *
 * Os três apontam para cá de propósito. O tratamento é idêntico nos três casos:
 * pegamos o `order_id` e relemos o pedido pela API, então o estado atual vem da
 * fonte em vez de ser inferido do tipo do evento. Isso torna a ordem de chegada
 * irrelevante — um "atualizado" que chegue antes do "realizado" grava o mesmo
 * resultado.
 *
 * A rota é `[[...evento]]` (catch-all opcional) porque o portal permite compor
 * a URL como `Root` + caminho, e não está documentado se o sufixo do evento
 * entra ou não. Aceitar com e sem sufixo evita depender dessa interpretação.
 *
 * ⚠️ Sem histórico na API, cada webhook perdido é dado perdido — por isso falha
 * NOSSA devolve 500, para que a retentativa deles seja a segunda chance.
 */

export const maxDuration = 60;

function tokenConfere(recebido: string | null, esperado: string | null): boolean {
  // Sem token cadastrado do nosso lado, aceitamos: o lojista pode ter ligado o
  // webhook antes de configurar o "Token Externo". A tela cobra a configuração.
  if (!esperado) return true;
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * O Anota AI não documenta ONDE o "Token Externo" viaja. Procuramos nos lugares
 * plausíveis em vez de apostar num só e rejeitar chamada legítima.
 */
function extrairToken(req: Request, body: unknown): string | null {
  const h = req.headers;
  const cabecalho =
    h.get('x-token-externo') ?? h.get('x-external-token') ?? h.get('x-token') ??
    h.get('token') ?? h.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  if (cabecalho) return cabecalho.trim();
  const b = body as Record<string, unknown> | null;
  const noCorpo = b?.token ?? b?.externalToken ?? b?.token_externo;
  return typeof noCorpo === 'string' ? noCorpo.trim() : null;
}

function extrairId(body: unknown): string {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return '';
  const direto = b._id ?? b.id ?? b.orderId ?? b.order_id;
  if (typeof direto === 'string' || typeof direto === 'number') return String(direto).trim();
  const info = b.info as Record<string, unknown> | undefined;
  const dentro = info?._id ?? info?.id;
  return typeof dentro === 'string' || typeof dentro === 'number' ? String(dentro).trim() : '';
}

function pedidoCompleto(body: unknown): AnotaAiOrder | null {
  const b = body as Record<string, unknown> | null;
  if (!b) return null;
  const info = (b.info ?? b) as AnotaAiOrder;
  // Só vale como "completo" se trouxer o que a lista NÃO traz.
  return info && (info.total != null || info.customer) ? info : null;
}

async function receber(req: Request, clientId: string) {
  const pool = makeServerPool();
  try {
    await ensureAnotaAiSchema(pool);
    const lojas = await listarLojas(pool, clientId);
    if (lojas.length === 0) {
      return Response.json({ ok: false, erro: 'cliente_sem_loja_anotaai' }, { status: 404 });
    }
    const loja = lojas[0];

    const body = await req.json().catch(() => null);
    if (!tokenConfere(extrairToken(req, body), loja.webhook_token)) {
      return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    }

    const orderId = extrairId(body);
    // 200 num payload sem id: devolver erro gastaria retentativa por algo que
    // nunca vai melhorar.
    if (!orderId) return Response.json({ ok: false, erro: 'sem_id_de_pedido' });

    const completo = pedidoCompleto(body);
    if (completo) {
      await upsertPedido(pool, clientId, loja.store_id, { ...completo, _id: orderId }, 'webhook');
      return Response.json({ ok: true, via: 'payload' });
    }

    const detalhe = await getPedido(loja.integration_token, orderId);
    if (!detalhe) return Response.json({ ok: false, erro: 'pedido_nao_encontrado' });
    await upsertPedido(pool, clientId, loja.store_id, detalhe, 'webhook');
    return Response.json({ ok: true, via: 'consulta' });
  } catch (err) {
    console.error('[anotaai webhook]', err);
    return Response.json({ ok: false, erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  return receber(req, clientId);
}

/** O portal permite escolher PUT em vez de POST para cada evento. */
export async function PUT(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  return receber(req, clientId);
}
