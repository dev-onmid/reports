/**
 * SULTS — schema, conexão por cliente e cliente HTTP.
 *
 * A fila de envio (`sults_envios`) é um OUTBOX, não um hook nas rotas de
 * ingestão. O worker é quem varre `crm_leads` e enfileira. Três motivos:
 *
 *  1. Nenhuma linha das rotas que já recebem lead (webhook do WhatsApp,
 *     meta-leadgen, webhooks/[token]) precisa mudar — são caminho de produção
 *     de vários clientes e uma indisponibilidade do SULTS não pode derrubar a
 *     recepção de ninguém.
 *  2. Cobre TODAS as fontes de uma vez, inclusive as que vierem depois.
 *  3. Se o worker ficar fora do ar, a varredura seguinte pega o atrasado — o
 *     lead não se perde porque já está gravado no nosso banco.
 *
 * ⚠️ A defesa central é a UNIQUE (client_id, lead_id): a API do SULTS não tem
 * chave de idempotência e NÃO publica DELETE de negócio. Um POST repetido cria
 * um segundo negócio no CRM do cliente que só sai na mão, um a um. Mesma
 * lição da unique de `post_alvo` (publicações, 2026-08-26).
 */

import type { Pool } from 'pg';

export const SULTS_API = 'https://api.sults.com.br/api/v1';

let schemaOk: Promise<void> | null = null;

export function ensureSultsSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sults_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL UNIQUE,
          api_token TEXT,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          conta_nome TEXT,
          responsavel_id INT,
          etapa_id INT,
          origem_id INT,
          campanha_id INT,
          mapa_origem JSONB,
          filtro_canais JSONB,
          -- ⚠️ Corte de história. Ligar a integração NÃO pode despejar a base
          -- inteira de leads no CRM do cliente: são centenas de negócios que
          -- ninguém consegue apagar pela API. Nasce em NOW() de propósito.
          desde TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultima_varredura_em TIMESTAMPTZ,
          ultimo_erro TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.sults_envios (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          lead_id UUID NOT NULL,
          status TEXT NOT NULL DEFAULT 'pendente',
          negocio_id BIGINT,
          tentativas INT NOT NULL DEFAULT 0,
          proximo_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultimo_erro TEXT,
          enviado_em TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // A trava que impede o negócio duplicado no CRM do cliente.
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS sults_envios_lead_uk
          ON public.sults_envios (client_id, lead_id)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS sults_envios_fila_idx
          ON public.sults_envios (status, proximo_em)
          WHERE status IN ('pendente', 'erro')
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

export type ConexaoSults = {
  id: string;
  client_id: string;
  api_token: string | null;
  enabled: boolean;
  conta_nome: string | null;
  responsavel_id: number | null;
  etapa_id: number | null;
  origem_id: number | null;
  campanha_id: number | null;
  mapa_origem: Record<string, number> | null;
  filtro_canais: string[] | null;
  desde: string;
  ultima_varredura_em: string | null;
  ultimo_erro: string | null;
  // Colunas da VOLTA (SULTS → reports), acrescentadas por `ensureSultsSyncSchema`.
  // Opcionais no tipo porque a conexão pode ser lida antes daquele ensure rodar.
  funil_id?: number | null;
  sync_ativo?: boolean;
  sync_pagina?: number;
  ultima_volta_em?: string | null;
  ultimo_erro_volta?: string | null;
};

/** Conexões prontas para enviar: ligadas, com token e com os dois IDs obrigatórios. */
export async function listarConexoesSultsAtivas(pool: Pool): Promise<ConexaoSults[]> {
  await ensureSultsSchema(pool);
  const { rows } = await pool.query<ConexaoSults>(
    `SELECT * FROM public.sults_connections
      WHERE enabled
        AND COALESCE(api_token, '') <> ''
        AND responsavel_id IS NOT NULL
        AND etapa_id IS NOT NULL
      ORDER BY created_at`,
  );
  return rows;
}

export async function conexaoSults(pool: Pool, clientId: string): Promise<ConexaoSults | null> {
  await ensureSultsSchema(pool);
  const { rows: [row] } = await pool.query<ConexaoSults>(
    `SELECT * FROM public.sults_connections WHERE client_id = $1`, [clientId],
  );
  return row ?? null;
}

export class SultsError extends Error {
  status: number;
  /** 4xx (menos 429) não adianta repetir: é o payload ou o cadastro que está errado. */
  permanente: boolean;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
    this.permanente = status >= 400 && status < 500 && status !== 429 && status !== 408;
  }
}

/**
 * Chamada à API do SULTS com o token DO CLIENTE.
 *
 * ⚠️ O header é `Authorization` com o token CRU — sem `Bearer`, sem `Token`
 * (a doc mostra `"Authorization": "<token_de_acesso>"`). Prefixar derruba em
 * 401 e parece token inválido.
 *
 * ⚠️ Token v2 não vale em endpoint v1, e Expansão é v1. Se o cliente entregar
 * o token gerado pela tela de integração com o Make e ele for v2, a resposta é
 * 401 aqui — pedir o token v1 ao suporte do SULTS.
 */
export async function sultsFetch<T>(apiToken: string, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: apiToken,
        'Content-Type': 'application/json;charset=UTF-8',
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    // Timeout/DNS/conexão: transitório por definição — 0 mantém `permanente` false.
    throw new SultsError(0, `SULTS inacessível: ${(err as Error).message}`);
  }
  const texto = await res.text().catch(() => '');
  if (!res.ok) throw new SultsError(res.status, `SULTS ${res.status}: ${texto.slice(0, 300)}`);
  try { return JSON.parse(texto) as T; } catch { return null as T; }
}

/**
 * Valida o token com a chamada mais barata que existe: listagem de negócios
 * com `limit=1`. Não há endpoint de "quem sou eu" na API de Expansão.
 */
export async function validarTokenSults(
  apiToken: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    await sultsFetch(apiToken, `${SULTS_API}/expansao/negocio?start=0&limit=1`);
    return { ok: true };
  } catch (err) {
    const e = err as SultsError;
    return {
      ok: false,
      erro: e.status === 401 || e.status === 403
        ? 'Token recusado pelo SULTS. Confirme que é um token v1 (o v2 não vale nos endpoints de Expansão).'
        : e.message,
    };
  }
}

export type NegocioCriado = { id: number };

/** POST /expansao/negocio. Devolve o id do negócio criado — a chave de cruzamento. */
export async function criarNegocioSults(apiToken: string, payload: unknown): Promise<number | null> {
  const r = await sultsFetch<NegocioCriado>(apiToken, `${SULTS_API}/expansao/negocio`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const id = Number(r?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Baixa uma amostra de negócios para deduzir o catálogo (funis, etapas,
 * responsáveis, origens, campanhas).
 *
 * ⚠️ Páginas ESPALHADAS, não as primeiras N. A listagem vem em ordem de id, ou
 * seja, cronológica: ler só o começo mostra o funil como ele era quando a conta
 * nasceu. Medido no CondoStore — as 100 primeiras linhas escondiam a maior
 * origem da conta ("Landing Page (Google)", 164 negócios) e metade das etapas.
 */
export async function amostrarNegociosSults(
  apiToken: string, opts: { paginas?: number; funilId?: number | null; budgetMs?: number } = {},
): Promise<unknown[]> {
  // ⚠️ 30 páginas, não 6. Medido na conta do CondoStore: a amostra de 6 páginas
  // achava 5 origens e 14 etapas, enquanto a base COMPLETA tem 9 e 62 — quatro
  // origens reais ficavam fora do menu, e quem configurasse não teria como
  // saber que faltavam. O funil inteiro (27 páginas, 2.644 negócios) leva 11,7s,
  // então ler quase tudo cabe no orçamento de quem está olhando a tela.
  const alvo = Math.max(1, Math.min(opts.paginas ?? 30, 30));
  const fim = Date.now() + (opts.budgetMs ?? 25_000);
  const base = (p: number) => {
    const q = new URLSearchParams({ start: String(p), limit: '100' });
    if (opts.funilId) q.set('funil', String(opts.funilId));
    return `${SULTS_API}/expansao/negocio?${q}`;
  };

  const primeira = await sultsFetch<{ data?: unknown[]; totalPage?: number }>(apiToken, base(0));
  const total = Number.isFinite(primeira?.totalPage) ? Number(primeira?.totalPage) : 1;
  const out = [...(primeira?.data ?? [])];
  if (total <= 1) return out;

  // Espalha uniformemente pelo intervalo, sempre incluindo a última página
  // (onde moram os negócios mais recentes — e as etapas criadas por último).
  const restantes = Math.min(alvo, total) - 1;
  const passos = new Set<number>();
  for (let i = 1; i <= restantes; i++) {
    passos.add(Math.min(total - 1, Math.round((i * (total - 1)) / restantes)));
  }
  // Conta grande estoura o orçamento antes de acabar: melhor um catálogo
  // parcial e a tela abrindo do que a rota morrendo no timeout.
  for (const p of [...passos].sort((a, b) => a - b)) {
    if (Date.now() >= fim) break;
    const r = await sultsFetch<{ data?: unknown[] }>(apiToken, base(p)).catch(() => null);
    if (r?.data) out.push(...r.data);
  }
  return out;
}
