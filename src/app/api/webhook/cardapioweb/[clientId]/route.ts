import { timingSafeEqual } from 'node:crypto';
import { makeServerPool } from '@/lib/server-db';
import { ensureCardapioWebSchema, getConnection } from '@/lib/cardapioweb';

/**
 * Receptor de webhook do Cardápio Web (`ORDER_CREATED`, `ORDER_STATUS_UPDATED`).
 *
 * ⚠️ Este handler NÃO busca o pedido nem fala com a API. Ele grava o evento cru
 * e responde 200 imediatamente, porque a doc é explícita: após 15 retentativas
 * sem `HTTP 200 OK` o Cardápio Web "descarta a notificação e PAUSA o webhook".
 * Um handler lento não perderia um pedido — mataria o canal em silêncio até
 * alguém reativar no portal do lojista.
 *
 * O enriquecimento (buscar cliente e valor em `/orders/{id}`) fica no
 * sync-cron, que drena a fila respeitando o rate limit.
 *
 * O payload traz apenas: event_id, event_type, merchant_id, order_id,
 * order_status, created_at. Não há cliente nem total aqui.
 */

function tokenConfere(recebido: string | null, esperado: string | null): boolean {
  if (!esperado) return true; // conexão sem token configurado: não exigimos
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;

  const pool = makeServerPool();
  try {
    const conn = await getConnection(pool, clientId);
    if (!conn || !conn.active) {
      // 404 (e não 200) de propósito: conexão inexistente deve ser barulhenta
      // no painel do lojista, senão ninguém descobre o webhook órfão.
      return Response.json({ ok: false, erro: 'conexao_nao_encontrada' }, { status: 404 });
    }

    if (!tokenConfere(req.headers.get('x-webhook-token'), conn.webhook_token)) {
      return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as {
      event_id?: string; event_type?: string; order_id?: number | string;
      order_status?: string; merchant_id?: number | string;
    } | null;

    const eventId = String(body?.event_id ?? '').trim();
    const orderId = body?.order_id != null ? Number(body.order_id) : null;
    if (!eventId || !Number.isFinite(orderId)) {
      // 200 mesmo assim: devolver erro aqui gastaria uma das 15 retentativas
      // por um payload que nunca vai melhorar.
      return Response.json({ ok: false, erro: 'payload_incompleto' });
    }

    await ensureCardapioWebSchema(pool);
    // `event_id` é PK — a própria doc pede dedupe por ele, e a Cardápio Web
    // reenvia o mesmo evento em retentativa.
    await pool.query(
      `INSERT INTO public.cardapioweb_events (event_id, client_id, order_id, event_type, order_status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, clientId, orderId, body?.event_type ?? null, body?.order_status ?? null],
    );

    return Response.json({ ok: true });
  } catch (err) {
    // Falha nossa (banco fora, por exemplo) devolve 500 DE PROPÓSITO: aí a
    // retentativa do Cardápio Web é justamente o que queremos, para não perder
    // o pedido enquanto o problema é resolvido.
    console.error('[cardapioweb webhook]', err);
    return Response.json({ ok: false, erro: 'falha_interna' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
