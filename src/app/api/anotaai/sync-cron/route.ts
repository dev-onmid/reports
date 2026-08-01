import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureAnotaAiSchema, listarLojas, listarPedidosDoDia, getPedido, upsertPedido,
  ehFinal, AnotaAiError, type AnotaAiStore,
} from '@/lib/anotaai';

/**
 * Coleta do Anota AI.
 *
 * ⚠️ A API **não tem consulta histórica**: `/ping/list` devolve só os pedidos do
 * dia. Isso significa que um dia sem coletar é um dia **perdido para sempre** —
 * não existe "buscar depois". Por isso:
 *
 *  - a cadência é curta (a doc sugere polling a cada 30s; rodamos a cada 2min
 *    pela crontab, e o webhook cobre o tempo real);
 *  - pedidos NÃO-FINAIS são relidos a cada passada, porque `check`, `total` e
 *    descontos mudam ao longo do dia (0 em análise → 3 finalizado);
 *  - falha de uma loja nunca interrompe as outras.
 *
 * ⚠️ Cadência pela CRONTAB DA VPS, não pelo GitHub Actions: o CLAUDE.md registra
 * throttle de 1,5-3h nos workflows deste repositório, o que aqui não seria
 * atraso — seria perda de dado.
 */

export const maxDuration = 300;

const ORCAMENTO_MS = 240_000;
/** Detalhes por loja por execução. A doc não publica limite; ficamos modestos. */
const DETALHES_POR_LOJA = 80;
const PAGINAS_MAX = 5; // 100 por página — 500 pedidos/dia por loja cobre com folga

function autorizado(req: NextRequest): boolean {
  const esperados = [
    process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET,
  ].filter((v): v is string => Boolean(v));
  if (esperados.length === 0) return false;
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return esperados.some(s => s === q || s === bearer);
}

type Resultado = {
  client_id: string;
  loja: string;
  novos: number;
  atualizados: number;
  pedidos_no_banco?: number;
  erro?: string;
};

async function coletarLoja(
  pool: ReturnType<typeof makeServerPool>, loja: AnotaAiStore, orcamento: number,
): Promise<{ novos: number; atualizados: number }> {
  // 1) Lista do dia (id + status), paginada.
  const doDia: { id: string; check: number | null }[] = [];
  for (let pagina = 1; pagina <= PAGINAS_MAX; pagina++) {
    const docs = await listarPedidosDoDia(loja.integration_token, pagina);
    if (docs.length === 0) break;
    for (const d of docs) {
      const id = String(d._id ?? d.id ?? '').trim();
      if (id) doDia.push({ id, check: typeof d.check === 'number' ? d.check : null });
    }
    if (docs.length < 100) break;
  }

  // 2) O que já temos, com o status gravado — para reler só o que mudou.
  const ids = doDia.map(d => d.id);
  const conhecidos = new Map<string, { check: number | null; final: boolean }>();
  if (ids.length) {
    const { rows } = await pool.query<{ order_id: string; check_code: number | null; final: boolean }>(
      `SELECT order_id, check_code, final FROM public.anotaai_orders
        WHERE client_id = $1 AND order_id = ANY($2::text[])`,
      [loja.client_id, ids],
    );
    for (const r of rows) conhecidos.set(r.order_id, { check: r.check_code, final: r.final });
  }

  // 3) Busca detalhe de quem é novo OU cujo status mudou. Pedido já final é
  //    pulado: ele não muda mais, e reler gastaria chamada à toa.
  const aBuscar = doDia.filter(d => {
    const c = conhecidos.get(d.id);
    if (!c) return true;
    if (c.final) return false;
    return c.check !== d.check;
  }).slice(0, orcamento);

  let novos = 0, atualizados = 0;
  for (const alvo of aBuscar) {
    try {
      const detalhe = await getPedido(loja.integration_token, alvo.id);
      if (!detalhe) continue;
      await upsertPedido(pool, loja.client_id, loja.store_id, detalhe, 'api');
      if (conhecidos.has(alvo.id)) atualizados++; else novos++;
    } catch (err) {
      if ((err as AnotaAiError).status === 429) break;
      // Pedido individual com problema não trava a loja.
    }
  }

  // 4) Rede de segurança: pedido que ficou não-final e sumiu da lista do dia
  //    (virou "ontem") nunca mais apareceria. Relê uma última vez os que
  //    seguem abertos, para não congelar num status intermediário.
  const restante = orcamento - aBuscar.length;
  if (restante > 0) {
    const { rows: presos } = await pool.query<{ order_id: string }>(
      `SELECT order_id FROM public.anotaai_orders
        WHERE client_id = $1 AND final = false
          AND created_at > NOW() - INTERVAL '3 days'
        ORDER BY created_at DESC LIMIT $2`,
      [loja.client_id, Math.min(restante, 20)],
    );
    for (const p of presos) {
      if (doDia.some(d => d.id === p.order_id)) continue; // já tratado acima
      try {
        const detalhe = await getPedido(loja.integration_token, p.order_id);
        if (detalhe) {
          await upsertPedido(pool, loja.client_id, loja.store_id, detalhe, 'api');
          if (ehFinal(detalhe.check)) atualizados++;
        }
      } catch { /* segue */ }
    }
  }

  return { novos, atualizados };
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  const inicio = Date.now();
  const pool = makeServerPool();
  const resultados: Resultado[] = [];

  try {
    await ensureAnotaAiSchema(pool);
    const soCliente = req.nextUrl.searchParams.get('clientId');
    const lojas = (await listarLojas(pool, soCliente ?? undefined)).filter(l => l.integration_token);

    for (const loja of lojas) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const r: Resultado = { client_id: loja.client_id, loja: loja.store_name, novos: 0, atualizados: 0 };
      try {
        const c = await coletarLoja(pool, loja, DETALHES_POR_LOJA);
        r.novos = c.novos;
        r.atualizados = c.atualizados;

        // `coletando_desde` é gravado na primeira coleta e nunca mais mexido —
        // é o que a tela usa pra dizer honestamente a partir de quando existem
        // dados, já que não há histórico anterior a este marco.
        await pool.query(
          `INSERT INTO public.anotaai_sync (store_row_id, client_id, ultima_sync_em, pedidos_vistos, ultimo_erro)
           VALUES ($1,$2,NOW(),$3,NULL)
           ON CONFLICT (store_row_id) DO UPDATE SET
             ultima_sync_em = NOW(),
             pedidos_vistos = public.anotaai_sync.pedidos_vistos + $3,
             ultimo_erro = NULL`,
          [loja.id, loja.client_id, c.novos],
        ).catch(() => {});
      } catch (err) {
        r.erro = err instanceof Error ? err.message : String(err);
        await pool.query(
          `INSERT INTO public.anotaai_sync (store_row_id, client_id, ultima_sync_em, ultimo_erro)
           VALUES ($1,$2,NOW(),$3)
           ON CONFLICT (store_row_id) DO UPDATE SET ultima_sync_em = NOW(), ultimo_erro = $3`,
          [loja.id, loja.client_id, r.erro.slice(0, 300)],
        ).catch(() => {});
      }

      const cont = await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM public.anotaai_orders WHERE client_id = $1`,
        [loja.client_id],
      ).catch(() => null);
      if (cont?.rows[0]) r.pedidos_no_banco = Number(cont.rows[0].n);

      resultados.push(r);
    }

    return Response.json({ ok: true, lojas: resultados.length, tookMs: Date.now() - inicio, resultados });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha na coleta.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}
