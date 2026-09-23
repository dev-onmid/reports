/**
 * A LEI de quais leads a dashboard conta (decisão do Matheus, 2026-09-23).
 *
 * Todo lead tem uma PORTA de entrada, conhecida na importação:
 *   planilha     — importação de planilha (leads ou faturamento)
 *   crm_externo  — SULTS, Agendor, Datalytics, webhook com id de negócio
 *   formulario   — Formulário Meta, landing page, webhook de formulário
 *   chat         — conversa que nasceu no inbox do WhatsApp (Evolution)
 *   manual       — cadastrado à mão no CRM
 *
 * Regra de contagem:
 *   planilha / crm_externo / formulario → contam SEMPRE (já filtrados na entrada:
 *     o relatório da clínica e o CRM externo só trazem o que passa pelo filtro deles)
 *   chat → conta SÓ com rastro de tráfego pago (CTWA, código do link /r/, gclid,
 *     fbclid, UTM de campanha). Conversa sem rastro não é mérito nosso.
 *   manual → não conta.
 * Tudo unido por telefone (régua única de identidade): quem está na planilha E
 * no chat é um lead só — e a porta "validada" vence a do chat.
 *
 * ⚠️ A coluna `porta` é gravada na entrada, mas a leitura NÃO depende dela:
 * `portaSql` deduz a porta pelos marcadores que cada porta já escreve (raw/
 * upload_id, external_id/origin, instance_id). Assim a lei vale para todo
 * lead que já existia antes da coluna e para qualquer porta esquecida.
 *
 * Onde vale: dashboard (summary, metrics/CRM, por-canal, por-regiao,
 * funil-leads). Kanban, CRM, Radar e relatórios continuam vendo todos.
 */

export const PORTAS_VALIDADAS = ['planilha', 'crm_externo', 'formulario'] as const;
export type Porta = 'planilha' | 'crm_externo' | 'formulario' | 'chat' | 'manual';

const col = (alias: string, c: string) => (alias ? `${alias}.${c}` : c);

/** Expressão SQL da porta do lead: a coluna quando gravada, senão deduzida dos marcadores. */
export function portaSql(alias = ''): string {
  const c = (n: string) => col(alias, n);
  return `COALESCE(NULLIF(${c('porta')}, ''), CASE
    WHEN ${c('raw')} IS NOT NULL OR ${c('upload_id')} IS NOT NULL THEN 'planilha'
    WHEN NULLIF(${c('external_id')}, '') IS NOT NULL
      OR lower(${c('origin')}) IN ('sults', 'agendor', 'datalytics') THEN 'crm_externo'
    WHEN lower(${c('canal')}) = 'formulário meta' OR lower(${c('canal')}) = 'formulario meta'
      OR lower(${c('origin')}) IN ('site', 'lp', 'leadgen', 'landing')
      OR ${c('canal')} ILIKE 'landing page%' OR ${c('canal')} ILIKE 'lp |%' THEN 'formulario'
    WHEN NULLIF(${c('instance_id')}, '') IS NOT NULL OR ${c('whatsapp_last_message_at')} IS NOT NULL THEN 'chat'
    ELSE 'manual' END)`;
}

/** Lead do chat com prova de tráfego pago.
 *  ⚠️ Null-safe de propósito: `NULL IN (...)` é NULL, e `NOT (... OR NULL)` vira NULL —
 *  o contador de "conversas fora" (que usa NOT) zerava para todo lead sem UTM. */
export function rastroPagoSql(alias = ''): string {
  const c = (n: string) => col(alias, n);
  return `(NULLIF(${c('ctwa_clid')}, '') IS NOT NULL
    OR NULLIF(${c('click_code')}, '') IS NOT NULL
    OR NULLIF(${c('source_id')}, '') IS NOT NULL
    OR NULLIF(${c('gclid')}, '') IS NOT NULL OR NULLIF(${c('fbclid')}, '') IS NOT NULL
    OR NULLIF(${c('wbraid')}, '') IS NOT NULL OR NULLIF(${c('gbraid')}, '') IS NOT NULL
    OR NULLIF(${c('campaign_name')}, '') IS NOT NULL
    OR COALESCE(lower(${c('utm_medium')}) IN ('cpc', 'paid', 'paid_social', 'ppc'), FALSE)
    OR COALESCE(lower(${c('utm_source')}) IN ('fb', 'ig', 'facebook', 'instagram', 'google', 'meta'), FALSE))`;
}

/** Predicado: o lead CONTA na dashboard. */
export function leadContaSql(alias = ''): string {
  const p = portaSql(alias);
  return `((${p}) IN ('planilha', 'crm_externo', 'formulario') OR ((${p}) = 'chat' AND ${rastroPagoSql(alias)}))`;
}

/** Predicado: porta validada (planilha/CRM externo/formulário) — decide se o topo do funil é o CRM (Lei 1) ou as plataformas (Lei 3). */
export function portaValidadaSql(alias = ''): string {
  return `((${portaSql(alias)}) IN ('planilha', 'crm_externo', 'formulario'))`;
}

/** Colunas que `portaSql`/`rastroPagoSql` leem — garantidas por este ALTER (idempotente). */
export const ENSURE_COLUNAS_CONTAGEM = `
  ALTER TABLE public.crm_leads
    ADD COLUMN IF NOT EXISTS porta TEXT,
    ADD COLUMN IF NOT EXISTS raw JSONB,
    ADD COLUMN IF NOT EXISTS upload_id UUID,
    ADD COLUMN IF NOT EXISTS external_id TEXT,
    ADD COLUMN IF NOT EXISTS origin TEXT,
    ADD COLUMN IF NOT EXISTS canal TEXT,
    ADD COLUMN IF NOT EXISTS instance_id TEXT,
    ADD COLUMN IF NOT EXISTS whatsapp_last_message_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ctwa_clid TEXT,
    ADD COLUMN IF NOT EXISTS click_code TEXT,
    ADD COLUMN IF NOT EXISTS source_id TEXT,
    ADD COLUMN IF NOT EXISTS gclid TEXT,
    ADD COLUMN IF NOT EXISTS fbclid TEXT,
    ADD COLUMN IF NOT EXISTS wbraid TEXT,
    ADD COLUMN IF NOT EXISTS gbraid TEXT,
    ADD COLUMN IF NOT EXISTS campaign_name TEXT,
    ADD COLUMN IF NOT EXISTS utm_medium TEXT,
    ADD COLUMN IF NOT EXISTS utm_source TEXT
`;
