import type { makeServerPool } from '@/lib/server-db';
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
): Promise<{ pedidos: PedidoDelivery[]; fontes: FonteDelivery[] }> {
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
              'anotaai' AS provedor
         FROM public.anotaai_orders WHERE client_id = $1`,
      [clientId],
    ).catch(() => ({ rows: [] as PedidoDelivery[] })),
  ]);

  const pedidos = [...cw.rows, ...aa.rows];

  const fonte = (p: ProvedorDelivery, rows: PedidoDelivery[]): FonteDelivery => {
    let desde: string | null = null;
    for (const r of rows) {
      const iso = r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at);
      if (!desde || iso < desde) desde = iso;
    }
    return { provedor: p, conectado: rows.length > 0, pedidos: rows.length, desde };
  };

  return {
    pedidos,
    fontes: [fonte('cardapioweb', cw.rows), fonte('anotaai', aa.rows)],
  };
}
