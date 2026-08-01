import { makeServerPool } from '@/lib/server-db';
import {
  ensureAnotaAiSchema, listarLojas, getPedido, upsertPedido, type AnotaAiOrder,
} from '@/lib/anotaai';

/**
 * Webhook do Anota AI (novos pedidos e cancelamentos), cadastrado pelo lojista
 * no Portal de Integração.
 *
 * ⚠️ Aqui o webhook NÃO é um luxo de tempo real como no Cardápio Web. Como a
 * API não tem consulta histórica, o pedido só existe no dia — então cada
 * caminho de entrada perdido é dado perdido para sempre. Webhook e polling são
 * redundantes de propósito, e o `ON CONFLICT` garante que a redundância não
 * duplique nada.
 *
 * Responde 200 rápido: processar dentro do handler arriscaria o timeout do
 * lado deles e retentativas que não temos como reprocessar depois.
 */

export const maxDuration = 60;

/** O payload pode trazer o pedido inteiro ou só o id — aceitamos os dois. */
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

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;

  const pool = makeServerPool();
  try {
    await ensureAnotaAiSchema(pool);
    const lojas = await listarLojas(pool, clientId);
    if (lojas.length === 0) {
      return Response.json({ ok: false, erro: 'cliente_sem_loja_anotaai' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const orderId = extrairId(body);
    if (!orderId) return Response.json({ ok: false, erro: 'sem_id_de_pedido' });

    const loja = lojas[0];
    const completo = pedidoCompleto(body);

    if (completo) {
      // Payload já trouxe tudo — evita uma chamada de volta à API deles.
      await upsertPedido(pool, clientId, loja.store_id, { ...completo, _id: orderId }, 'webhook');
      return Response.json({ ok: true, via: 'payload' });
    }

    const detalhe = await getPedido(loja.integration_token, orderId);
    if (!detalhe) return Response.json({ ok: false, erro: 'pedido_nao_encontrado' });
    await upsertPedido(pool, clientId, loja.store_id, detalhe, 'webhook');
    return Response.json({ ok: true, via: 'consulta' });
  } catch (err) {
    // 500 de propósito em falha NOSSA: aqui a retentativa deles é a única
    // chance de não perder o pedido, já que não dá pra buscar depois.
    console.error('[anotaai webhook]', err);
    return Response.json({ ok: false, erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
