import type { makeServerPool } from '@/lib/server-db';
import { origemIntegravel } from '@/lib/anotaai-import';
import type { PedidoComDesconto } from '@/lib/cardapioweb-recorrencia';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Leitura unificada dos pedidos de delivery, venham de onde vierem.
 *
 * As tabelas são separadas de propósito — o `order_id` do Anota AI é um
 * ObjectId (string) e o do Cardápio Web é numérico, então uma tabela única
 * exigiria forçar um tipo comum e conviver com a ambiguidade.
 *
 * Esta camada é a costura que evita o preço dessa escolha: ela devolve os dois
 * no MESMO shape, e daí para frente tudo (funil, cupons, período, comparativo)
 * roda nas funções puras já testadas. Sem isso, cada integração acabaria com a
 * própria cópia da leitura e elas divergiriam com o tempo.
 *
 * Regra: para somar uma plataforma nova, basta acrescentar uma consulta aqui.
 * Nada além deste arquivo precisa saber que existe mais de uma origem.
 */

export type ProvedorDelivery = 'cardapioweb' | 'anotaai';

export type PedidoDelivery = PedidoComDesconto & {
  provedor: ProvedorDelivery;
  order_id: string;
  /** Só no Anota AI — o Cardápio Web não expõe "como nos conheceu". */
  como_conheceu?: string | null;
};

/**
 * O que ficou de fora por origem. Vai pra tela de propósito: um total que
 * exclui parte da base sem dizer parece o faturamento inteiro da loja.
 */
export type OrigemExcluida = {
  pedidos: number;
  receita: number;
  /** As origens descartadas mais frequentes, pra conferir se o corte faz sentido. */
  origens: { origem: string; pedidos: number }[];
};

export type FonteDelivery = {
  provedor: ProvedorDelivery;
  conectado: boolean;
  pedidos: number;
  /** Desde quando existem dados. Decisivo no Anota AI, que não tem histórico. */
  desde: string | null;
};

/**
 * Lê os pedidos de todas as plataformas conectadas ao cliente.
 *
 * Cada consulta é isolada: uma tabela que ainda não existe (integração nunca
 * usada) não pode derrubar a leitura da outra.
 */
export async function lerPedidosDelivery(
  pool: Pool, clientId: string,
): Promise<{ pedidos: PedidoDelivery[]; fontes: FonteDelivery[]; origemExcluida: OrigemExcluida }> {
  const [cw, aa] = await Promise.all([
    pool.query<PedidoDelivery>(
      `SELECT order_id::text, customer_id, customer_name, customer_phone,
              total::float8 AS total, status, sales_channel, created_at, discounts,
              'cardapioweb' AS provedor
         FROM public.cardapioweb_orders WHERE client_id = $1`,
      [clientId],
    ).catch(() => ({ rows: [] as PedidoDelivery[] })),
    pool.query<PedidoDelivery>(
      // `customer_id` não existe no Anota AI: a identidade do cliente é o
      // telefone. NULL aqui faz o agrupador cair no telefone, que é o que
      // também casa com o CRM.
      `SELECT order_id, NULL::text AS customer_id, customer_name, customer_phone,
              total::float8 AS total, status, sales_channel, created_at, discounts,
              como_conheceu, 'anotaai' AS provedor
         FROM public.anotaai_orders WHERE client_id = $1`,
      [clientId],
    ).catch(() => ({ rows: [] as PedidoDelivery[] })),
  ]);

  // Corte da allowlist de origem acontece AQUI, na leitura — não na gravação.
  // O pedido de origem não-atribuível (panfleto, indicação, rádio) continua no
  // banco, mas fica fora de todo número do painel. Fazer o corte na importação
  // exigiria reimportar tudo se a lista mudasse, e impediria dizer quanto ficou
  // de fora.
  //
  // ⚠️ Só se aplica ao Anota AI: o Cardápio Web não tem esse campo, e descartar
  // os pedidos dele por ausência de origem zeraria a integração inteira.
  const foraDaAllowlist = aa.rows.filter(r => !origemIntegravel(r.como_conheceu));
  const anotaFiltrados = aa.rows.filter(r => origemIntegravel(r.como_conheceu));

  const pedidos = [...cw.rows, ...anotaFiltrados];

  const fonte = (p: ProvedorDelivery, rows: PedidoDelivery[]): FonteDelivery => {
    let desde: string | null = null;
    for (const r of rows) {
      const iso = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
      if (!desde || iso < desde) desde = iso;
    }
    return { provedor: p, conectado: rows.length > 0, pedidos: rows.length, desde };
  };

  const porOrigem = new Map<string, number>();
  let receitaFora = 0;
  for (const r of foraDaAllowlist) {
    if (r.status === 'canceled') continue;
    const k = String(r.como_conheceu ?? '').trim() || '(sem origem declarada)';
    porOrigem.set(k, (porOrigem.get(k) ?? 0) + 1);
    receitaFora += Number(r.total) || 0;
  }

  return {
    pedidos,
    // A contagem da fonte usa `anotaFiltrados`, não `aa.rows`: dizer "1.200
    // pedidos do Anota AI" e mostrar 800 no painel seria contradição na mesma
    // tela.
    fontes: [fonte('cardapioweb', cw.rows), fonte('anotaai', anotaFiltrados)],
    origemExcluida: {
      pedidos: foraDaAllowlist.length,
      receita: receitaFora,
      origens: [...porOrigem.entries()]
        .map(([origem, pedidos]) => ({ origem, pedidos }))
        .sort((a, b) => b.pedidos - a.pedidos)
        .slice(0, 8),
    },
  };
}
