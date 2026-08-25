/**
 * Integração Agendor — lado do servidor.
 *
 * Diferença estrutural pro Datalytics: aqui temos DOIS tokens por cliente.
 *  - `api_token`: o token do Agendor DO CLIENTE (ele pega em Menu →
 *    Integrações no Agendor). É com ele que consultamos a API e criamos as
 *    assinaturas de webhook — sem ele a integração não existe.
 *  - `token` (receptor): gerado por nós, vai na URL que o webhook do Agendor
 *    chama de volta. É a credencial de ENTRADA, mesma classe do Datalytics.
 *
 * As assinaturas de webhook são criadas POR API na conexão — o cliente não
 * configura nada no painel do Agendor (vantagem real sobre o Datalytics, onde
 * o cadastro das integrações é manual, uma por etapa).
 */

import type { Pool } from 'pg';

export const AGENDOR_API = 'https://api.agendor.com.br/v3';
const AGENDOR_SUBS = 'https://api.agendor.com.br/integrations/subscriptions';

/**
 * Eventos assinados. Deliberadamente SÓ negócio: pessoa criada sem negócio
 * não é lead de funil (decisão espelhada do público "só quem tem pedido" da
 * Fidelidade) — e on_person_updated dispararia a cada edição de cadastro.
 */
export const EVENTOS_ASSINADOS = [
  'on_deal_created',
  'on_deal_stage_updated',
  'on_deal_won',
  'on_deal_lost',
] as const;

let schemaOk: Promise<void> | null = null;

export function ensureAgendorSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.agendor_connections (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL UNIQUE,
          token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
          api_token TEXT,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          account_name TEXT,
          subscriptions JSONB,
          backfill_pagina INT NOT NULL DEFAULT 1,
          backfill_concluido BOOLEAN NOT NULL DEFAULT FALSE,
          ultima_sync_em TIMESTAMPTZ,
          last_received_at TIMESTAMPTZ,
          ultimo_erro TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        ALTER TABLE public.agendor_connections
          ADD COLUMN IF NOT EXISTS filtro_funis JSONB,
          ADD COLUMN IF NOT EXISTS filtro_origens JSONB
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.agendor_log (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT,
          raw JSONB NOT NULL,
          resultado TEXT NOT NULL,
          detalhe TEXT,
          lead_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_agendor_log_client
          ON public.agendor_log (client_id, created_at DESC)
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

export type ConexaoAgendor = {
  id: string;
  client_id: string;
  token: string;
  api_token: string | null;
  enabled: boolean;
  account_name: string | null;
  subscriptions: unknown;
  backfill_pagina: number;
  backfill_concluido: boolean;
  ultima_sync_em: string | null;
  last_received_at: string | null;
  ultimo_erro: string | null;
  filtro_funis: unknown;
  filtro_origens: unknown;
};

const CONN_COLS = `id, client_id, token, api_token, enabled, account_name, subscriptions,
  backfill_pagina, backfill_concluido, ultima_sync_em, last_received_at, ultimo_erro,
  filtro_funis, filtro_origens`;

export async function garantirConexaoAgendor(pool: Pool, clientId: string): Promise<ConexaoAgendor> {
  await ensureAgendorSchema(pool);
  const { rows } = await pool.query<ConexaoAgendor>(
    `INSERT INTO public.agendor_connections (client_id)
     VALUES ($1)
     ON CONFLICT (client_id) DO UPDATE SET client_id = EXCLUDED.client_id
     RETURNING ${CONN_COLS}`,
    [clientId],
  );
  return rows[0];
}

export async function conexaoAgendorPorToken(pool: Pool, token: string): Promise<ConexaoAgendor | null> {
  await ensureAgendorSchema(pool);
  const { rows } = await pool.query<ConexaoAgendor>(
    `SELECT ${CONN_COLS} FROM public.agendor_connections WHERE token = $1 LIMIT 1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function listarConexoesAgendorAtivas(pool: Pool): Promise<ConexaoAgendor[]> {
  await ensureAgendorSchema(pool);
  const { rows } = await pool.query<ConexaoAgendor>(
    `SELECT ${CONN_COLS} FROM public.agendor_connections
      WHERE enabled = TRUE AND api_token IS NOT NULL`,
  );
  return rows;
}

// ---------------------------------------------------------------- API do Agendor

export class AgendorError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

/**
 * Chamada à API do Agendor com o token DO CLIENTE. Timeout curto: a recepção
 * de webhook usa isto pra buscar o telefone da pessoa, e não pode pendurar a
 * resposta ao Agendor (política de retry deles é desconhecida).
 */
/**
 * Campos personalizados do Agendor só voltam com `withCustomFields=true`.
 *
 * ⚠️ Sem o parâmetro a chave `customFields` nem aparece no payload — provado na
 * conta da Cinfel: `/deals/44049085` volta sem nada, e a MESMA URL com o
 * parâmetro volta `{origem_do_lead: {id: 70870, value: "Google/Site"}}`.
 * Era por isso que a origem "não existia" para nós: a Cinfel usa um campo
 * PERSONALIZADO chamado "Origem do lead", não o `leadOrigin` padrão.
 *
 * Vale também na LISTAGEM (medido: 100 negócios por requisição, 23 com campos
 * preenchidos), então ler isso custa ZERO requisição a mais — só o parâmetro.
 *
 * ⚠️ É inofensivo para quem não usa campo personalizado: medido em 6 negócios
 * de Londrigifts e Incorpast, o payload volta idêntico, sem `customFields`.
 * Por isso entra aqui, no cliente HTTP, e não em cada chamador.
 */
function comCamposPersonalizados(url: string): string {
  if (!/\/deals(\/|\?|$)/.test(url) || url.includes('withCustomFields')) return url;
  return url + (url.includes('?') ? '&' : '?') + 'withCustomFields=true';
}

export async function agendorFetch<T>(apiToken: string, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(comCamposPersonalizados(url), {
    ...init,
    headers: {
      Authorization: `Token ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await res.text().catch(() => '');
  if (!res.ok) throw new AgendorError(res.status, `Agendor ${res.status}: ${texto.slice(0, 300)}`);
  try { return JSON.parse(texto) as T; } catch { return null as T; }
}

/** Valida o token do cliente e devolve o nome da conta ("logado como…"). */
export async function validarTokenAgendor(apiToken: string): Promise<{ ok: true; nome: string | null } | { ok: false; erro: string }> {
  try {
    const r = await agendorFetch<{ data?: { name?: string; account?: { name?: string } } }>(
      apiToken, `${AGENDOR_API}/users/me`);
    return { ok: true, nome: r?.data?.account?.name ?? r?.data?.name ?? null };
  } catch (err) {
    const e = err as AgendorError;
    return { ok: false, erro: e.status === 401 ? 'Token recusado pelo Agendor (confira em Menu → Integrações).' : e.message };
  }
}

/**
 * Cria as assinaturas de webhook apontando pro nosso receptor. Idempotência
 * manual: lista as existentes e só cria as que faltam PARA A MESMA URL — o
 * Agendor aceita assinaturas duplicadas, e cada duplicata viraria entrega em
 * dobro (lead processado 2x).
 */
export async function garantirAssinaturasAgendor(
  apiToken: string,
  targetUrl: string,
): Promise<{ criadas: string[]; existentes: string[]; erros: string[] }> {
  type Sub = { id?: number; event?: string; target_url?: string };
  let atuais: Sub[] = [];
  try {
    const r = await agendorFetch<{ data?: Sub[] } | Sub[]>(apiToken, AGENDOR_SUBS);
    atuais = Array.isArray(r) ? r : (r?.data ?? []);
  } catch { /* lista indisponível → tenta criar; duplicata é o custo raro */ }

  // Casa por PREFIXO: as assinaturas levam a mesma rota com query string
  // diferente por evento (ver urlDoEvento abaixo), e as antigas eram a URL crua.
  const jaTem = new Set(
    atuais.filter(s => (s.target_url ?? '').startsWith(targetUrl)).map(s => String(s.event ?? '')),
  );
  const criadas: string[] = [];
  const erros: string[] = [];
  // ⚠️ O Agendor exige target_url ÚNICA por assinatura (validação de unicidade
  // do lado deles → 422 genérico em HTML). Descoberto ao vivo em 2026-08-21:
  // o 1º evento com a URL crua passava e os outros 3 eram rejeitados. A saída é
  // a MESMA rota com uma query string distinta por evento — o receptor ignora.
  const urlDoEvento = (ev: string) => `${targetUrl}?ev=${ev.replace('on_deal_', '')}`;
  for (const evento of EVENTOS_ASSINADOS) {
    if (jaTem.has(evento)) continue;
    try {
      await agendorFetch(apiToken, AGENDOR_SUBS, {
        method: 'POST',
        body: JSON.stringify({ target_url: urlDoEvento(evento), event: evento }),
      });
      criadas.push(evento);
    } catch (err) {
      erros.push(`${evento}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return { criadas, existentes: [...jaTem], erros };
}

/** Funis e origens de lead disponíveis na conta do Agendor (pro seletor da UI). */
export async function listarOpcoesAgendor(apiToken: string): Promise<{
  funis: Array<{ id: string; nome: string }>;
  origens: Array<{ id: string; nome: string }>;
}> {
  type Item = { id?: number | string; name?: string };
  const pegar = async (path: string): Promise<Array<{ id: string; nome: string }>> => {
    try {
      const r = await agendorFetch<{ data?: Item[] }>(apiToken, `${AGENDOR_API}${path}`);
      return (r?.data ?? [])
        .filter(x => x.id !== undefined && x.name)
        .map(x => ({ id: String(x.id), nome: String(x.name) }));
    } catch { return []; }
  };
  const [funis, origens] = await Promise.all([pegar('/funnels'), pegar('/lead_origins')]);
  return { funis, origens };
}

// ---------------------------------------------------------------- log cru

export type ResultadoLogAgendor =
  | 'criado' | 'atualizado' | 'sem_telefone' | 'token_invalido' | 'desativado'
  | 'erro' | 'ignorado' | 'backfill' | 'teste_get' | 'filtrado';

export async function registrarLogAgendor(pool: Pool, d: {
  clientId: string | null;
  raw: unknown;
  resultado: ResultadoLogAgendor;
  detalhe?: string | null;
  leadId?: string | null;
}): Promise<void> {
  try {
    await ensureAgendorSchema(pool);
    await pool.query(
      `INSERT INTO public.agendor_log (client_id, raw, resultado, detalhe, lead_id)
       VALUES ($1, $2::jsonb, $3, $4, $5)`,
      [d.clientId, JSON.stringify(d.raw ?? null), d.resultado, d.detalhe ?? null, d.leadId ?? null],
    );
    if (d.clientId) {
      await pool.query(
        `DELETE FROM public.agendor_log
          WHERE client_id = $1
            AND id NOT IN (
              SELECT id FROM public.agendor_log
               WHERE client_id = $1 ORDER BY created_at DESC LIMIT 200
            )`,
        [d.clientId],
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[agendor] falha ao logar', err);
  }
}

export type LogAgendor = {
  id: string; resultado: string; detalhe: string | null;
  lead_id: string | null; raw: unknown; created_at: string;
};

export async function listarLogsAgendor(pool: Pool, clientId: string, limit = 20): Promise<LogAgendor[]> {
  await ensureAgendorSchema(pool);
  const { rows } = await pool.query<LogAgendor>(
    `SELECT id, resultado, detalhe, lead_id, raw, created_at
       FROM public.agendor_log
      WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [clientId, limit],
  );
  return rows;
}
