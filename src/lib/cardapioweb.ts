import type { makeServerPool } from '@/lib/server-db';

type Pool = ReturnType<typeof makeServerPool>;

/**
 * Núcleo da integração com o Cardápio Web (cardápio digital / delivery).
 *
 * Modelo de autenticação: **API Key legada** (`X-API-KEY`), que o próprio
 * lojista gera em Configurações → Integrações → API. O modelo OAuth exige app
 * publicado na CW App Store ("Para publicar na CW App Store, migre para OAuth"),
 * o que depende de aprovação deles — fica para depois. As chamadas de leitura
 * que usamos (loja, histórico, detalhe, clientes) NÃO exigem `X-PARTNER-KEY`;
 * essa só é necessária para catálogo, métodos de pagamento e criar pedido.
 *
 * ⚠️ Esta integração é SOMENTE LEITURA de propósito. O token do lojista, nas
 * palavras da própria doc, "concede acesso amplo" — com ele daria para cancelar
 * pedido e editar o cardápio do cliente. Nenhuma função aqui escreve.
 */

const API_BASE_PROD = 'https://integracao.cardapioweb.com';
const API_BASE_SANDBOX = 'https://integracao.sandbox.cardapioweb.com';

/** Vercel Hobby mata a rota em 10s; abortamos antes para devolver erro legível. */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Limites POR ESTABELECIMENTO, conforme a doc:
 *  - histórico de pedidos e consultar loja: 5 req/min
 *  - demais endpoints (inclui detalhe do pedido): 300 req/3min ≈ 100/min
 * O gargalo real da importação é 1 detalhe por pedido → ~100 pedidos/minuto.
 */
export const RATE = {
  historicoPorMinuto: 5,
  detalhePor3Min: 300,
  /** Folga: ficamos abaixo do teto para não competir com o PDV do lojista. */
  detalhePorMinutoSeguro: 80,
} as const;

export function apiBase(sandbox = false): string {
  return sandbox ? API_BASE_SANDBOX : API_BASE_PROD;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

let schemaEnsured = false;

/**
 * DDL inline memoizada — padrão do projeto (não há runner de .sql).
 */
export async function ensureCardapioWebSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    // Um cliente da ONMID = uma loja do Cardápio Web (client_id é a PK), mesmo
    // formato de `clickup_client_links`. Token em texto puro no banco, como as
    // demais tabelas de credencial — nunca devolvido ao browser (ver maskToken).
    `CREATE TABLE IF NOT EXISTS public.cardapioweb_connections (
       client_id          TEXT PRIMARY KEY,
       api_token          TEXT NOT NULL,
       merchant_id        TEXT,
       merchant_name      TEXT,
       webhook_token      TEXT,
       sandbox            BOOLEAN NOT NULL DEFAULT false,
       janela_dias        INT NOT NULL DEFAULT 30,
       inatividade_dias   INT NOT NULL DEFAULT 60,
       historico_cursor   TIMESTAMPTZ,
       historico_pagina   INT NOT NULL DEFAULT 1,
       historico_concluido BOOLEAN NOT NULL DEFAULT false,
       ultima_sync_em     TIMESTAMPTZ,
       ultimo_erro        TEXT,
       active             BOOLEAN NOT NULL DEFAULT true,
       created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    // A unique (client_id, order_id) é a idempotência REAL da ingestão: o mesmo
    // pedido chega pelo webhook E pelo histórico, e não pode virar duas linhas
    // (dobraria a receita e a contagem de recorrência).
    `CREATE TABLE IF NOT EXISTS public.cardapioweb_orders (
       client_id      TEXT NOT NULL,
       order_id       BIGINT NOT NULL,
       customer_id    TEXT,
       customer_name  TEXT,
       customer_phone TEXT,
       total          NUMERIC NOT NULL DEFAULT 0,
       status         TEXT NOT NULL,
       sales_channel  TEXT,
       order_type     TEXT,
       created_at     TIMESTAMPTZ NOT NULL,
       sincronizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (client_id, order_id)
     )`,
    `CREATE INDEX IF NOT EXISTS cardapioweb_orders_cliente_data_idx
       ON public.cardapioweb_orders (client_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS cardapioweb_orders_fone_idx
       ON public.cardapioweb_orders (client_id, customer_phone)`,
    // Fila do webhook. O evento entra cru e é enriquecido depois, porque o
    // payload NÃO traz cliente nem valor — só `order_id`.
    `CREATE TABLE IF NOT EXISTS public.cardapioweb_events (
       event_id     TEXT PRIMARY KEY,
       client_id    TEXT NOT NULL,
       order_id     BIGINT,
       event_type   TEXT,
       order_status TEXT,
       recebido_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       processado_em TIMESTAMPTZ,
       tentativas   INT NOT NULL DEFAULT 0,
       erro         TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS cardapioweb_events_pendentes_idx
       ON public.cardapioweb_events (processado_em, recebido_em)
       WHERE processado_em IS NULL`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch((err) => console.error('[cardapioweb schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CardapioWebConnection = {
  client_id: string;
  api_token: string;
  merchant_id: string | null;
  merchant_name: string | null;
  webhook_token: string | null;
  sandbox: boolean;
  janela_dias: number;
  inatividade_dias: number;
  historico_cursor: string | null;
  historico_pagina: number;
  historico_concluido: boolean;
  ultima_sync_em: string | null;
  ultimo_erro: string | null;
  active: boolean;
};

export type CwMerchant = {
  id: number;
  name: string;
  slug?: string;
  status?: string;
  whatsapp?: string | null;
};

/** O que o histórico devolve — repare que NÃO há cliente nem total aqui. */
export type CwLiteOrder = {
  id: number;
  status: string;
  order_type?: string;
  order_timing?: string;
  sales_channel?: string;
  created_at: string;
  updated_at?: string;
};

export type CwOrderDetail = {
  id: number;
  display_id?: number;
  status: string;
  total?: number;
  sales_channel?: string;
  order_type?: string;
  created_at: string;
  customer?: { id?: number; name?: string; phone?: string; ddi?: string } | null;
};

export class CardapioWebError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CardapioWebError';
    this.status = status;
  }
}

/** O token nunca chega inteiro ao browser — só o suficiente pra reconhecer qual é. */
export function maskToken(token: string | null | undefined): string {
  if (!token) return '';
  if (token.length <= 12) return '••••••••';
  return `${token.slice(0, 6)}${'•'.repeat(10)}${token.slice(-4)}`;
}

// ─── Cliente HTTP ─────────────────────────────────────────────────────────────

export async function cwFetch<T>(
  conn: Pick<CardapioWebConnection, 'api_token' | 'sandbox'>,
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase(conn.sandbox)}${path}`, {
      ...rest,
      signal: controller.signal,
      headers: { 'X-API-KEY': conn.api_token, Accept: 'application/json', ...(headers ?? {}) },
    });

    const texto = await res.text();
    if (!res.ok) {
      // 429 é esperado (rate limit por estabelecimento) e o chamador precisa
      // distinguir para recuar em vez de marcar o evento como falha definitiva.
      let msg = texto.slice(0, 300);
      try {
        const j = JSON.parse(texto) as { message?: string; error?: string };
        msg = j.message ?? j.error ?? msg;
      } catch { /* corpo não-JSON: usa o texto cru */ }
      throw new CardapioWebError(msg || `HTTP ${res.status}`, res.status);
    }
    return (texto ? JSON.parse(texto) : null) as T;
  } catch (err) {
    if (err instanceof CardapioWebError) throw err;
    if ((err as Error)?.name === 'AbortError') {
      throw new CardapioWebError(`Tempo esgotado (${timeoutMs}ms) ao falar com o Cardápio Web.`, 504);
    }
    throw new CardapioWebError((err as Error)?.message ?? 'Falha de rede', 0);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

/** Também serve de teste de credencial: token inválido responde 401 aqui. */
export async function getMerchant(conn: Pick<CardapioWebConnection, 'api_token' | 'sandbox'>): Promise<CwMerchant> {
  return cwFetch<CwMerchant>(conn, '/api/partner/v1/merchant');
}

export type HistoricoPagina = {
  orders: CwLiteOrder[];
  pagination?: { current_page?: number; total_pages?: number; total_orders?: number };
};

/**
 * Histórico. `start_date`/`end_date` são OBRIGATÓRIOS e a doc limita o intervalo
 * a 6 meses (e 3 anos retroativo). Rate limit próprio: 5 req/min.
 */
export async function listOrderHistory(
  conn: Pick<CardapioWebConnection, 'api_token' | 'sandbox'>,
  opts: { startDate: string; endDate: string; page?: number; perPage?: number },
): Promise<HistoricoPagina> {
  const qs = new URLSearchParams({
    start_date: opts.startDate,
    end_date: opts.endDate,
    page: String(opts.page ?? 1),
    per_page: String(Math.min(opts.perPage ?? 100, 100)),
  });
  const raw = await cwFetch<HistoricoPagina | CwLiteOrder[]>(conn, `/api/partner/v1/orders/history?${qs}`);
  // Defensivo: a doc descreve `{ orders, pagination }`, mas array cru na raiz é
  // um formato comum o bastante para não valer quebrar a importação por isso.
  return Array.isArray(raw) ? { orders: raw } : raw;
}

/** Único lugar que devolve cliente e valor — o webhook não traz nenhum dos dois. */
export async function getOrderDetail(
  conn: Pick<CardapioWebConnection, 'api_token' | 'sandbox'>,
  orderId: number | string,
): Promise<CwOrderDetail> {
  return cwFetch<CwOrderDetail>(conn, `/api/partner/v1/orders/${orderId}`);
}

// ─── Conexão ──────────────────────────────────────────────────────────────────

const CONN_COLS = `client_id, api_token, merchant_id, merchant_name, webhook_token, sandbox,
                   janela_dias, inatividade_dias, historico_cursor, historico_pagina,
                   historico_concluido, ultima_sync_em, ultimo_erro, active`;

export async function getConnection(pool: Pool, clientId: string): Promise<CardapioWebConnection | null> {
  await ensureCardapioWebSchema(pool);
  const { rows } = await pool.query<CardapioWebConnection>(
    `SELECT ${CONN_COLS} FROM public.cardapioweb_connections WHERE client_id = $1 LIMIT 1`,
    [clientId],
  );
  return rows[0] ?? null;
}

export async function listActiveConnections(pool: Pool): Promise<CardapioWebConnection[]> {
  await ensureCardapioWebSchema(pool);
  const { rows } = await pool.query<CardapioWebConnection>(
    `SELECT ${CONN_COLS} FROM public.cardapioweb_connections WHERE active = true ORDER BY client_id`,
  );
  return rows;
}

export { CONN_COLS };

/**
 * Grava um pedido já enriquecido. Idempotente: o mesmo pedido chegando pelo
 * webhook e pelo histórico atualiza a linha em vez de duplicar.
 *
 * O status é atualizado de propósito — `ORDER_STATUS_UPDATED` existe justamente
 * porque um pedido pode ser cancelado depois de criado, e cancelado sai da
 * conta de recorrência.
 */
export async function upsertOrder(pool: Pool, clientId: string, d: CwOrderDetail): Promise<void> {
  await pool.query(
    `INSERT INTO public.cardapioweb_orders
       (client_id, order_id, customer_id, customer_name, customer_phone, total,
        status, sales_channel, order_type, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (client_id, order_id) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, cardapioweb_orders.customer_id),
       customer_name = COALESCE(EXCLUDED.customer_name, cardapioweb_orders.customer_name),
       customer_phone = COALESCE(EXCLUDED.customer_phone, cardapioweb_orders.customer_phone),
       total = EXCLUDED.total,
       status = EXCLUDED.status,
       sales_channel = COALESCE(EXCLUDED.sales_channel, cardapioweb_orders.sales_channel),
       order_type = COALESCE(EXCLUDED.order_type, cardapioweb_orders.order_type),
       sincronizado_em = NOW()`,
    [
      clientId,
      Number(d.id),
      d.customer?.id != null ? String(d.customer.id) : null,
      d.customer?.name?.trim() || null,
      // O DDI vem separado do telefone; juntamos porque a normalização do
      // casamento com o CRM sabe descartar o 55.
      d.customer?.phone ? `${d.customer.ddi ?? ''}${d.customer.phone}` : null,
      Number(d.total ?? 0),
      d.status,
      d.sales_channel ?? null,
      d.order_type ?? null,
      d.created_at,
    ],
  );
}
