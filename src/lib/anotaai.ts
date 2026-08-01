import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Integração com o Anota AI (cardápio digital / delivery).
 *
 * ⚠️ DIFERENÇA CRÍTICA para o Cardápio Web: **não existe consulta histórica**.
 * `GET /ping/list` devolve apenas "os pedidos do dia", sem nenhum parâmetro de
 * data. Consequências que moldam todo o desenho:
 *
 *  1. Não há backfill possível pela API — o funil nasce vazio e só se preenche
 *     daí em diante (retroativo só por planilha).
 *  2. **Um dia sem coletar é um dia perdido para sempre.** Não dá para voltar.
 *     Por isso a ingestão é redundante de propósito: webhook + polling.
 *  3. O pedido MUDA durante o dia (`check` 0→1→2→3) e o valor pode mudar junto,
 *     então capturar uma vez não basta: reconsultamos até o pedido ficar final.
 *
 * Autenticação: header `Authorization` com o token CRU (sem "Bearer"), obtido
 * pelo lojista no Portal de Integração. Já existe em `client_anota_ai_stores`.
 */

const API_BASE = 'https://api-parceiros.anota.ai/partnerauth';
const DEFAULT_TIMEOUT_MS = 8_000;

/** `check` do Anota AI. Documentado em "Sobre a API". */
export const CHECK = {
  AGENDADO_ACEITO: -2,
  EM_ANALISE: 0,
  EM_PRODUCAO: 1,
  PRONTO: 2,
  FINALIZADO: 3,
  CANCELADO: 4,
  NEGADO: 5,
  SOLICITACAO_CANCELAMENTO: 6,
} as const;

/**
 * Traduz o `check` numérico para o mesmo vocabulário de status do Cardápio Web,
 * para que as funções puras de funil e cupom sirvam aos dois sem adaptação.
 *
 * Cancelado e negado viram `canceled` — é o único valor que a lógica de
 * recorrência trata de forma especial (não conta como compra). "Solicitação de
 * cancelamento" ainda NÃO é cancelamento: o pedido pode seguir válido, e
 * descartá-lo aqui subtrairia receita que existe.
 */
export function statusDoCheck(check: number | null | undefined): string {
  if (check === CHECK.CANCELADO || check === CHECK.NEGADO) return 'canceled';
  if (check === CHECK.FINALIZADO) return 'closed';
  return 'confirmed';
}

/** Pedido final não muda mais — sai da fila de reconsulta. */
export function ehFinal(check: number | null | undefined): boolean {
  return check === CHECK.FINALIZADO || check === CHECK.CANCELADO || check === CHECK.NEGADO;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

let schemaEnsured = false;

/**
 * Tabela PRÓPRIA, separada da do Cardápio Web.
 *
 * O `_id` do Anota AI é um ObjectId (string) e o do Cardápio Web é numérico —
 * numa tabela única seria preciso forçar um tipo comum e conviver com a
 * ambiguidade. Separadas, cada uma guarda o que de fato recebe; quem une é a
 * camada de leitura, que devolve o mesmo shape para as funções puras.
 */
export async function ensureAnotaAiSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS public.anotaai_orders (
       client_id      TEXT NOT NULL,
       order_id       TEXT NOT NULL,
       store_id       TEXT,
       customer_name  TEXT,
       customer_phone TEXT,
       total          NUMERIC NOT NULL DEFAULT 0,
       check_code     INT,
       status         TEXT NOT NULL,
       sales_channel  TEXT,
       ifood_id       TEXT,
       discounts      JSONB,
       created_at     TIMESTAMPTZ NOT NULL,
       final          BOOLEAN NOT NULL DEFAULT false,
       origem         TEXT NOT NULL DEFAULT 'api',
       sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (client_id, order_id)
     )`,
    `CREATE INDEX IF NOT EXISTS anotaai_orders_cliente_data_idx
       ON public.anotaai_orders (client_id, created_at DESC)`,
    // Fila de reconsulta: pedido não-final precisa ser relido até fechar.
    `CREATE INDEX IF NOT EXISTS anotaai_orders_pendentes_idx
       ON public.anotaai_orders (client_id, final) WHERE final = false`,
    // Estado da coleta por loja. `coletando_desde` é o que a tela usa para
    // dizer honestamente a partir de quando os números existem.
    `CREATE TABLE IF NOT EXISTS public.anotaai_sync (
       store_row_id   TEXT PRIMARY KEY,
       client_id      TEXT NOT NULL,
       coletando_desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       ultima_sync_em TIMESTAMPTZ,
       ultimo_erro    TEXT,
       pedidos_vistos INT NOT NULL DEFAULT 0
     )`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(err => console.error('[anotaai schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AnotaAiStore = {
  id: string;
  client_id: string;
  store_name: string;
  store_id: string;
  ifood_store_id: string | null;
  integration_token: string;
  active: boolean;
};

export type AnotaAiLiteOrder = { _id?: string; id?: string; check?: number; salesChannel?: string; updatedAt?: string };

export type AnotaAiDiscount = {
  kind?: string; category?: string; total?: number;
  coupon_code?: string | null; coupon_name?: string | null;
  code?: string | null; name?: string | null; value?: number;
};

export type AnotaAiOrder = {
  _id?: string; id?: string;
  check?: number;
  total?: number;
  createdAt?: string;
  salesChannel?: string;
  ifood_id?: string;
  customer?: { name?: string; phone?: string; cellphone?: string; contact?: string } | null;
  discounts?: AnotaAiDiscount[] | null;
};

export class AnotaAiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnotaAiError';
    this.status = status;
  }
}

/** Reconhece o valor mascarado voltando da tela, para não gravá-lo por cima. */
export function tokenEhMascara(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.includes('•');
}

export function maskToken(t: string | null | undefined): string {
  if (!t) return '';
  if (t.length <= 12) return '••••••••';
  return `${t.slice(0, 6)}${'•'.repeat(10)}${t.slice(-4)}`;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function anotaFetch<T>(token: string, path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: controller.signal,
      // O token vai CRU, sem "Bearer" — é o que a doc especifica.
      headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const texto = await res.text();
    if (!res.ok) {
      let msg = texto.slice(0, 300);
      try {
        const j = JSON.parse(texto) as { message?: string; error?: string };
        msg = j.message ?? j.error ?? msg;
      } catch { /* corpo não-JSON */ }
      throw new AnotaAiError(msg || `HTTP ${res.status}`, res.status);
    }
    return (texto ? JSON.parse(texto) : null) as T;
  } catch (err) {
    if (err instanceof AnotaAiError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new AnotaAiError(`Tempo esgotado (${timeoutMs}ms) ao falar com o Anota AI.`, 504);
    }
    throw new AnotaAiError((err as Error)?.message ?? 'Falha de rede', 0);
  } finally {
    clearTimeout(timer);
  }
}

export type ListaPedidos = {
  success?: boolean;
  info?: { docs?: AnotaAiLiteOrder[]; count?: number; limit?: number; currentpage?: number };
};

/**
 * Lista os pedidos DO DIA. Não há filtro de data — é a limitação central da API.
 *
 * `excludeIfood=0` de propósito: o padrão da API é 1 (esconde iFood), mas
 * separar marketplace de cardápio próprio é justamente uma das leituras que o
 * painel oferece — esconder na origem impediria isso.
 */
export async function listarPedidosDoDia(token: string, pagina = 1): Promise<AnotaAiLiteOrder[]> {
  const r = await anotaFetch<ListaPedidos>(token, `/ping/list?excludeIfood=0&currentpage=${pagina}`);
  return r?.info?.docs ?? [];
}

/** Só aqui existem cliente, valor e descontos — a lista traz apenas id e status. */
export async function getPedido(token: string, orderId: string): Promise<AnotaAiOrder | null> {
  const r = await anotaFetch<{ success?: boolean; info?: AnotaAiOrder }>(token, `/ping/get/${encodeURIComponent(orderId)}`);
  return r?.info ?? null;
}

/** Teste de credencial: token inválido responde 401/403 aqui. */
export async function testarToken(token: string): Promise<{ ok: true; pedidosHoje: number } | { ok: false; erro: string; status: number }> {
  try {
    const docs = await listarPedidosDoDia(token, 1);
    return { ok: true, pedidosHoje: docs.length };
  } catch (err) {
    const e = err as AnotaAiError;
    return { ok: false, erro: e.message, status: e.status };
  }
}

// ─── Persistência ─────────────────────────────────────────────────────────────

export async function listarLojas(pool: Pool, clientId?: string): Promise<AnotaAiStore[]> {
  await ensureAnotaAiSchema(pool);
  const { rows } = await pool.query<AnotaAiStore>(
    `SELECT id::text, client_id, store_name, store_id, ifood_store_id, integration_token, active
       FROM public.client_anota_ai_stores
      WHERE active = true ${clientId ? 'AND client_id = $1' : ''}
      ORDER BY client_id, store_name`,
    clientId ? [clientId] : [],
  ).catch(() => ({ rows: [] as AnotaAiStore[] }));
  return rows;
}

/** Telefone pode vir em campos diferentes conforme a origem do pedido. */
function foneDoPedido(o: AnotaAiOrder): string | null {
  const c = o.customer;
  return (c?.phone || c?.cellphone || c?.contact || '').trim() || null;
}

/** O código do cupom também varia de nome entre payloads. */
export function normalizarDescontos(ds: AnotaAiDiscount[] | null | undefined) {
  if (!Array.isArray(ds)) return [];
  return ds.map(d => ({
    kind: d.kind,
    category: d.category ?? 'coupon',
    coupon_code: d.coupon_code ?? d.code ?? null,
    coupon_name: d.coupon_name ?? d.name ?? null,
    total: Number(d.total ?? d.value ?? 0) || 0,
  }));
}

/**
 * Grava o pedido. Idempotente por `(client_id, order_id)`.
 *
 * O UPDATE é intencional e não opcional: diferente do Cardápio Web, aqui o
 * mesmo pedido é lido várias vezes ao longo do dia, e `check`, `total` e
 * descontos mudam entre as leituras.
 */
export async function upsertPedido(
  pool: Pool, clientId: string, storeId: string | null, o: AnotaAiOrder, origem = 'api',
): Promise<void> {
  const orderId = String(o._id ?? o.id ?? '').trim();
  if (!orderId) return;
  const check = typeof o.check === 'number' ? o.check : null;

  await pool.query(
    `INSERT INTO public.anotaai_orders
       (client_id, order_id, store_id, customer_name, customer_phone, total,
        check_code, status, sales_channel, ifood_id, discounts, created_at, final, origem)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (client_id, order_id) DO UPDATE SET
       customer_name = COALESCE(EXCLUDED.customer_name, anotaai_orders.customer_name),
       customer_phone = COALESCE(EXCLUDED.customer_phone, anotaai_orders.customer_phone),
       total = EXCLUDED.total,
       check_code = EXCLUDED.check_code,
       status = EXCLUDED.status,
       sales_channel = COALESCE(EXCLUDED.sales_channel, anotaai_orders.sales_channel),
       ifood_id = COALESCE(EXCLUDED.ifood_id, anotaai_orders.ifood_id),
       discounts = EXCLUDED.discounts,
       final = EXCLUDED.final,
       sincronizado_em = NOW()`,
    [
      clientId, orderId, storeId,
      o.customer?.name?.trim() || null,
      foneDoPedido(o),
      Number(o.total ?? 0) || 0,
      check,
      statusDoCheck(check),
      // iFood chega pelo Anota AI com id próprio; marcar o canal permite separar
      // marketplace de cardápio do lojista no painel.
      o.salesChannel ?? (o.ifood_id ? 'ifood' : null),
      o.ifood_id ?? null,
      JSON.stringify(normalizarDescontos(o.discounts)),
      o.createdAt ?? new Date().toISOString(),
      ehFinal(check),
      origem,
    ],
  );
}
