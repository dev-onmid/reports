import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureCardapioWebSchema, listActiveConnections, listOrderHistory, getOrderDetail,
  upsertOrder, RATE, CardapioWebError, type CardapioWebConnection,
} from '@/lib/cardapioweb';

/**
 * Sincronismo do Cardápio Web: drena a fila do webhook e avança a importação
 * histórica de 6 meses.
 *
 * ⚠️ Cadência: este cron deve ser chamado pela CRONTAB DA VPS, não pelo GitHub
 * Actions — o CLAUDE.md registra que os workflows deste repositório são
 * throttleados para ~1 execução a cada 1,5-3h, o que deixaria pedidos parados
 * na fila por horas.
 *
 * Rate limit é POR ESTABELECIMENTO: 5 req/min no histórico, ~100/min nos
 * detalhes. O gargalo real é 1 detalhe por pedido, então a importação de uma
 * loja com ~3.000 pedidos leva ~30 minutos distribuídos entre execuções — daí
 * o cursor retomável em vez de tentar tudo numa tacada.
 */

export const maxDuration = 300;

/** Orçamento por execução, com folga para a rota responder antes do teto. */
const ORCAMENTO_MS = 240_000;
/** Teto de detalhes por execução: fica abaixo dos 300/3min por estabelecimento. */
/**
 * Uma página do histórico tem 100 pedidos. Com teto de 60, cada página exigia
 * DUAS execuções (60 + 40), metade da velocidade — e deixava a página parada no
 * meio do caminho. 110 fecha a página numa passada.
 *
 * Continua dentro do limite: 100 detalhes + 1 histórico por execução, a cada 2
 * minutos, dá ~150 requisições por 3 minutos, contra o teto de 300/3min.
 */
const DETALHES_POR_LOJA = 110;
const JANELA_HISTORICO_MESES = 6;

/**
 * Janela da varredura contínua, em dias.
 *
 * ⚠️ Esta varredura existe porque o desenho anterior desligava a busca assim
 * que o histórico terminava (`if (conn.historico_concluido) return`), deixando
 * o webhook como ÚNICA porta de entrada. Como nenhum webhook chegou a ser
 * cadastrado no painel das lojas, os pedidos pararam em silêncio: Istambul em
 * 09/08 e Tokiomaki em 31/07, com o cron reportando "sincronizado, sem erro" a
 * cada hora — porque, do ponto de vista dele, não havia nada a fazer.
 *
 * 3 dias cobre com folga a cadência de 1x/hora e ainda recupera uma parada de
 * fim de semana. O webhook continua sendo o caminho de tempo real; esta
 * varredura é a rede embaixo dele, igual à reconciliação do Agendor.
 */
const RECONCILIACAO_DIAS = 3;
/** Teto de páginas por execução: cada página é 1 das 5 req/min do histórico. */
const RECONCILIACAO_PAGINAS = 2;

function autorizado(req: NextRequest): boolean {
  const esperados = [
    process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET,
  ].filter((v): v is string => Boolean(v));
  if (esperados.length === 0) return false;
  const q = req.nextUrl.searchParams.get('secret');
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return esperados.some(s => s === q || s === bearer);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Resultado = {
  client_id: string;
  eventos_processados: number;
  historico_importados: number;
  historico_concluido: boolean;
  /** Pedidos novos achados pela varredura da janela recente. */
  recentes_importados?: number;
  recentes_vistos?: number;
  descontos_recapturados?: number;
  /** Quantos pedidos existem DE FATO no banco para esta loja. */
  pedidos_no_banco?: number;
  pagina_atual?: number;
  erro?: string;
};

/**
 * Enriquecimento: o evento só tem `order_id`, então cada um custa uma chamada
 * a `/orders/{id}` — é lá que vivem cliente e valor.
 */
async function drenarEventos(
  pool: ReturnType<typeof makeServerPool>, conn: CardapioWebConnection, limite: number,
): Promise<number> {
  const { rows } = await pool.query<{ event_id: string; order_id: string }>(
    `SELECT event_id, order_id FROM public.cardapioweb_events
      WHERE client_id = $1 AND processado_em IS NULL AND tentativas < 5
      ORDER BY recebido_em ASC LIMIT $2`,
    [conn.client_id, limite],
  );

  let feitos = 0;
  for (const ev of rows) {
    try {
      const detalhe = await getOrderDetail(conn, ev.order_id);
      await upsertOrder(pool, conn.client_id, detalhe);
      await pool.query(
        `UPDATE public.cardapioweb_events SET processado_em = NOW(), erro = NULL WHERE event_id = $1`,
        [ev.event_id],
      );
      feitos++;
    } catch (err) {
      const e = err as CardapioWebError;
      // 429 não conta como tentativa falha: o evento é válido, só chegamos cedo
      // demais. Contar gastaria as 5 chances por culpa do rate limit.
      if (e.status === 429) break;
      await pool.query(
        `UPDATE public.cardapioweb_events
            SET tentativas = tentativas + 1, erro = $2 WHERE event_id = $1`,
        [ev.event_id, e.message?.slice(0, 300) ?? 'erro'],
      );
    }
  }
  return feitos;
}

/**
 * Recaptura pedidos gravados antes da coluna `discounts` existir.
 *
 * `discounts IS NULL` significa "detalhe nunca lido com este campo" — diferente
 * de `'[]'`, que é "lido e sem desconto nenhum". Sem essa distinção seria
 * preciso refazer TODAS as chamadas de detalhe já pagas, em vez de só as que
 * faltam.
 *
 * Roda depois da fila e do histórico: dado novo vale mais que enriquecer antigo.
 */
async function recapturarDescontos(
  pool: ReturnType<typeof makeServerPool>, conn: CardapioWebConnection, limite: number,
): Promise<number> {
  if (limite <= 0) return 0;
  const { rows } = await pool.query<{ order_id: string }>(
    `SELECT order_id FROM public.cardapioweb_orders
      WHERE client_id = $1 AND discounts IS NULL
      ORDER BY created_at DESC LIMIT $2`,
    [conn.client_id, limite],
  );

  let feitos = 0;
  for (const r of rows) {
    try {
      const detalhe = await getOrderDetail(conn, r.order_id);
      await upsertOrder(pool, conn.client_id, detalhe);
      feitos++;
    } catch (err) {
      if ((err as CardapioWebError).status === 429) break;
      // Pedido que não volta mais (apagado na origem) ficaria em loop eterno na
      // fila de recaptura: marca como lido-sem-desconto pra sair dela.
      await pool.query(
        `UPDATE public.cardapioweb_orders SET discounts = '[]'::jsonb
          WHERE client_id = $1 AND order_id = $2`,
        [conn.client_id, r.order_id],
      ).catch(() => {});
    }
  }
  return feitos;
}

/**
 * Importação histórica com cursor. Uma página de 100 pedidos "lite" por vez,
 * cada pedido exigindo um detalhe — por isso a página é a unidade de avanço.
 */
async function avancarHistorico(
  pool: ReturnType<typeof makeServerPool>, conn: CardapioWebConnection, orcamentoDetalhes: number,
): Promise<{ importados: number; concluido: boolean }> {
  if (conn.historico_concluido) return { importados: 0, concluido: true };

  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setMonth(inicio.getMonth() - JANELA_HISTORICO_MESES);

  const pagina = await listOrderHistory(conn, {
    startDate: inicio.toISOString(),
    endDate: fim.toISOString(),
    page: conn.historico_pagina,
    perPage: 100,
  });

  const lista = pagina.orders ?? [];
  if (lista.length === 0) {
    await pool.query(
      `UPDATE public.cardapioweb_connections
          SET historico_concluido = true, ultima_sync_em = NOW() WHERE client_id = $1`,
      [conn.client_id],
    );
    return { importados: 0, concluido: true };
  }

  // Só busca detalhe do que ainda não temos — reexecução não gasta rate limit
  // refazendo trabalho já feito.
  const ids = lista.map(o => Number(o.id)).filter(Number.isFinite);
  const { rows: existentes } = await pool.query<{ order_id: string }>(
    `SELECT order_id FROM public.cardapioweb_orders WHERE client_id = $1 AND order_id = ANY($2::bigint[])`,
    [conn.client_id, ids],
  );
  const jaTemos = new Set(existentes.map(r => String(r.order_id)));
  const faltando = ids.filter(id => !jaTemos.has(String(id))).slice(0, orcamentoDetalhes);

  let importados = 0;
  let bateuLimite = false;
  for (const id of faltando) {
    try {
      const detalhe = await getOrderDetail(conn, id);
      await upsertOrder(pool, conn.client_id, detalhe);
      importados++;
    } catch (err) {
      if ((err as CardapioWebError).status === 429) { bateuLimite = true; break; }
      // Pedido individual com problema não trava a importação inteira.
    }
  }

  // Só avança a página quando TODOS os pedidos dela foram resolvidos. Avançar
  // com pendência deixaria buracos que ninguém reprocessaria.
  const resolveuTudo = !bateuLimite && faltando.length === ids.filter(id => !jaTemos.has(String(id))).length;
  const totalPaginas = pagina.pagination?.total_pages ?? null;
  const proxima = conn.historico_pagina + 1;
  const acabou = resolveuTudo && totalPaginas != null && proxima > totalPaginas;

  if (resolveuTudo) {
    await pool.query(
      `UPDATE public.cardapioweb_connections
          SET historico_pagina = $2, historico_concluido = $3,
              historico_cursor = NOW(), ultima_sync_em = NOW()
        WHERE client_id = $1`,
      [conn.client_id, acabou ? conn.historico_pagina : proxima, acabou],
    );
  }

  return { importados, concluido: acabou };
}

/**
 * Varredura contínua da janela recente — a rede de segurança do webhook.
 *
 * Roda SEMPRE, inclusive (e principalmente) depois do histórico concluído.
 * Idempotente por construção: só busca detalhe de pedido que ainda não existe
 * no banco, então repetir a passada não gasta rate limit nem duplica nada.
 */
async function reconciliarRecentes(
  pool: ReturnType<typeof makeServerPool>, conn: CardapioWebConnection, orcamentoDetalhes: number,
): Promise<{ importados: number; vistos: number }> {
  if (orcamentoDetalhes <= 0) return { importados: 0, vistos: 0 };

  const fim = new Date();
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - RECONCILIACAO_DIAS);

  let importados = 0;
  let vistos = 0;

  for (let pagina = 1; pagina <= RECONCILIACAO_PAGINAS; pagina++) {
    if (orcamentoDetalhes - importados <= 0) break;
    // Ritmo do histórico: 5 req/min por loja. Espaça a 2ª página.
    if (pagina > 1) await sleep(Math.ceil(60_000 / RATE.historicoPorMinuto));

    let lote;
    try {
      lote = await listOrderHistory(conn, {
        startDate: inicio.toISOString(),
        endDate: fim.toISOString(),
        page: pagina,
        perPage: 100,
      });
    } catch (err) {
      if ((err as CardapioWebError).status === 429) break;
      throw err;
    }

    const lista = lote.orders ?? [];
    vistos += lista.length;
    if (lista.length === 0) break;

    const ids = lista.map(o => Number(o.id)).filter(Number.isFinite);
    const { rows: existentes } = await pool.query<{ order_id: string }>(
      `SELECT order_id FROM public.cardapioweb_orders WHERE client_id = $1 AND order_id = ANY($2::bigint[])`,
      [conn.client_id, ids],
    );
    const jaTemos = new Set(existentes.map(r => String(r.order_id)));
    const faltando = ids.filter(id => !jaTemos.has(String(id)));

    for (const id of faltando) {
      if (importados >= orcamentoDetalhes) break;
      try {
        const detalhe = await getOrderDetail(conn, id);
        await upsertOrder(pool, conn.client_id, detalhe);
        importados++;
      } catch (err) {
        if ((err as CardapioWebError).status === 429) return { importados, vistos };
        // Pedido individual com problema não trava a varredura.
      }
    }

    // Página incompleta = fim da janela, não há o que paginar.
    if (lista.length < 100) break;
  }

  return { importados, vistos };
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'Não autorizado.' }, { status: 401 });

  const inicio = Date.now();
  const pool = makeServerPool();
  const resultados: Resultado[] = [];

  try {
    await ensureCardapioWebSchema(pool);
    const conexoes = await listActiveConnections(pool);
    const soCliente = req.nextUrl.searchParams.get('clientId');
    const alvo = soCliente ? conexoes.filter(c => c.client_id === soCliente) : conexoes;

    for (const conn of alvo) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      const r: Resultado = {
        client_id: conn.client_id, eventos_processados: 0,
        historico_importados: 0, historico_concluido: conn.historico_concluido,
      };
      try {
        // Fila primeiro: pedido de HOJE vale mais que histórico de 5 meses atrás.
        r.eventos_processados = await drenarEventos(pool, conn, DETALHES_POR_LOJA);

        let restante = DETALHES_POR_LOJA - r.eventos_processados;

        // ⚠️ ANTES do histórico: pedido dos últimos dias vale mais que página
        // de 5 meses atrás, e é esta varredura que mantém a loja viva depois
        // que o histórico termina.
        if (restante > 0 && Date.now() - inicio < ORCAMENTO_MS) {
          const rec = await reconciliarRecentes(pool, conn, restante);
          r.recentes_importados = rec.importados;
          r.recentes_vistos = rec.vistos;
          restante -= rec.importados;
        }

        if (restante > 0 && Date.now() - inicio < ORCAMENTO_MS) {
          const h = await avancarHistorico(pool, conn, restante);
          r.historico_importados = h.importados;
          r.historico_concluido = h.concluido;
          restante -= h.importados;
        }

        // Enriquecer o antigo so com a sobra do orcamento — pedido de hoje e o
        // avanco do historico vem antes.
        if (restante > 0 && Date.now() - inicio < ORCAMENTO_MS) {
          r.descontos_recapturados = await recapturarDescontos(pool, conn, restante);
        }
        // Carimba a sincronização SEMPRE que a execução chegou até aqui, e não
        // só quando uma página fecha. Antes, uma passada que importava 60 de
        // 100 pedidos deixava `ultima_sync_em` nulo — e a tela dizia "última
        // sync —", como se nada estivesse acontecendo, no exato momento em que
        // estava importando.
        await pool.query(
          `UPDATE public.cardapioweb_connections
              SET ultima_sync_em = NOW(), ultimo_erro = NULL WHERE client_id = $1`,
          [conn.client_id],
        ).catch(() => {});

        // Conferência: quantos pedidos EXISTEM no banco, não quantos o loop
        // acha que gravou. Sem isso não dá pra distinguir "não gravou" de
        // "gravou e a tela não lê" — foi exatamente a dúvida que apareceu na
        // primeira importação real.
        const cont = await pool.query<{ n: string; pag: number }>(
          `SELECT (SELECT COUNT(*) FROM public.cardapioweb_orders WHERE client_id = $1)::text AS n,
                  (SELECT historico_pagina FROM public.cardapioweb_connections WHERE client_id = $1) AS pag`,
          [conn.client_id],
        ).catch(() => null);
        if (cont?.rows[0]) {
          r.pedidos_no_banco = Number(cont.rows[0].n);
          r.pagina_atual = cont.rows[0].pag;
        }
      } catch (err) {
        r.erro = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE public.cardapioweb_connections SET ultimo_erro = $2, ultima_sync_em = NOW() WHERE client_id = $1`,
          [conn.client_id, r.erro.slice(0, 300)],
        ).catch(() => {});
      }
      resultados.push(r);

      // Respiro entre lojas. O limite é por estabelecimento, mas a pausa evita
      // rajada contra a API deles quando há muitas lojas conectadas.
      if (alvo.length > 1) await sleep(1_000);
    }

    return Response.json({
      ok: true,
      lojas: resultados.length,
      tookMs: Date.now() - inicio,
      limites: RATE,
      resultados,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Falha no sincronismo.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}
