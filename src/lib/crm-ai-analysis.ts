import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { queueFollowupIfExists } from '@/lib/followup-send';

const MODEL = 'claude-haiku-4-5-20251001';

type Temperature = 'quente' | 'morno' | 'frio';

type AiResult = {
  status?: string;
  status_confianca?: number;
  status_deve_mudar?: boolean;
  temperatura?: Temperature;
  temperatura_confianca?: number;
  temperatura_deve_mudar?: boolean;
  motivo?: string;
};

type ConversationSignals = {
  outboundAfterLastInbound: number;
  lastDirection: 'in' | 'out' | null;
  lastInboundAt: string | null;
  firstOutboundAfterLastInboundAt: string | null;
};

const DEFAULT_CRITERIA: Record<Temperature, string> = {
  quente: 'Lead perguntou sobre preço, pediu proposta, demonstrou urgência, disse que quer comprar, perguntou sobre prazo de entrega, pediu para falar com vendedor, comparou com concorrente ativamente',
  morno: 'Lead está respondendo, fazendo perguntas gerais sobre o produto/serviço, pediu mais informações, demonstra interesse mas sem urgência, está avaliando opções',
  frio: 'Lead sumiu por mais de 48h, respondeu com monossílabos, disse que vai pensar, pediu para entrar em contato depois, disse que não tem interesse no momento, apenas perguntou algo pontual sem continuar',
};

const STATUS_MAP: Record<string, string> = {
  novo: 'Novo',
  em_atendimento: 'Em Atendimento',
  atendimento: 'Em Atendimento',
  agendado: 'Agendado',
  reagendado: 'Reagendado',
  proposta: 'Proposta',
  negociacao: 'Negociação',
  negociação: 'Negociação',
  fechado: 'Fechado',
  comprou: 'Comprou',
  paciente: 'Paciente',
  nao_retorna: 'Não Retorna',
  não_retorna: 'Não Retorna',
  distante: 'Distante',
  sem_interesse: 'Sem Interesse',
  desqualificado: 'Desqualificado',
  perdido: 'Perdido',
};

export async function ensureCrmAiSchema(pool: Pool) {
  await pool.query(`
    ALTER TABLE public.crm_leads
      ADD COLUMN IF NOT EXISTS temperatura TEXT,
      ADD COLUMN IF NOT EXISTS temperatura_atualizada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ia_ultimo_analise TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS ia_confianca_ultimo INTEGER,
      ADD COLUMN IF NOT EXISTS time_interno BOOLEAN NOT NULL DEFAULT false;

    CREATE TABLE IF NOT EXISTS public.crm_temperatura_criterios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      temperatura TEXT NOT NULL CHECK (temperatura IN ('quente', 'morno', 'frio')),
      criterios TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_temp_criterios_unique
      ON public.crm_temperatura_criterios (COALESCE(client_id, '__global__'), temperatura);

    CREATE TABLE IF NOT EXISTS public.crm_ia_historico (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
      client_id TEXT,
      status_anterior TEXT,
      status_novo TEXT,
      temperatura_anterior TEXT,
      temperatura_nova TEXT,
      confianca INTEGER,
      motivo_ia TEXT,
      mensagens_analisadas INTEGER,
      modelo_usado TEXT,
      erro TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.ia_uso_mensal (
      client_id TEXT NOT NULL,
      mes_ano TEXT NOT NULL,
      chamadas_ia INTEGER NOT NULL DEFAULT 0,
      tokens_usados INTEGER NOT NULL DEFAULT 0,
      custo_estimado_usd NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, mes_ano)
    );

    CREATE TABLE IF NOT EXISTS public.crm_status_historico (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
      client_id TEXT,
      status_anterior TEXT,
      status_novo TEXT,
      motivo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.crm_ia_avisos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      tipo TEXT NOT NULL,
      mensagem TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.client_tracking_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL UNIQUE,
      pixel_id TEXT NOT NULL DEFAULT '',
      meta_token TEXT NOT NULL DEFAULT '',
      gatilho_compra TEXT NOT NULL DEFAULT 'compra aprovada',
      eventos_ativos JSONB NOT NULL DEFAULT '{"lead":true,"purchase":true}',
      whatsapp_provider TEXT NOT NULL DEFAULT 'zapi',
      ia_limite_chamadas_dia INTEGER NOT NULL DEFAULT 500,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE public.client_tracking_config
      ADD COLUMN IF NOT EXISTS ia_limite_chamadas_dia INTEGER NOT NULL DEFAULT 500;
  `);

  for (const [temperatura, criterios] of Object.entries(DEFAULT_CRITERIA)) {
    await pool.query(
      `INSERT INTO public.crm_temperatura_criterios (client_id, temperatura, criterios)
       SELECT NULL, $1, $2
       WHERE NOT EXISTS (
         SELECT 1 FROM public.crm_temperatura_criterios
         WHERE client_id IS NULL AND temperatura = $1
       )`,
      [temperatura, criterios],
    ).catch(() => null);
  }
}

function extractJson(text: string): AiResult {
  const clean = text.trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) return {};
  return JSON.parse(clean.slice(start, end + 1)) as AiResult;
}

function normalizeStatusText(status: string) {
  return status
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
}

function normalizeStatus(status: string | undefined | null, statusOptions: string[]) {
  if (!status) return null;
  const direct = statusOptions.find(option => option === status);
  if (direct) return direct;

  const normalized = normalizeStatusText(status);
  const mapped = STATUS_MAP[normalized] ?? STATUS_MAP[status] ?? status;
  return statusOptions.find(option => normalizeStatusText(option) === normalizeStatusText(mapped)) ?? mapped;
}

function findStatus(statusOptions: string[], wanted: string) {
  const wantedKey = normalizeStatusText(wanted);
  return statusOptions.find(option => normalizeStatusText(option) === wantedKey) ?? null;
}

function statusMatches(status: string | null | undefined, names: string[]) {
  if (!status) return false;
  const normalized = normalizeStatusText(status);
  return names.some(name => normalizeStatusText(name) === normalized);
}

function daysSince(iso: string | null) {
  if (!iso) return Infinity;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Infinity;
  return (Date.now() - time) / 86_400_000;
}

function leadIdentityValues(lead: { id: string; client_id: string; numero?: string | null }) {
  return [String(lead.client_id), String(lead.id), lead.numero ?? null];
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function estimateCostUsd(tokens: number) {
  return tokens * 0.0000008;
}

function isTemperature(value: unknown): value is Temperature {
  return value === 'quente' || value === 'morno' || value === 'frio';
}

async function loadCriteria(pool: Pool, clientId: string): Promise<Record<Temperature, string>> {
  const { rows } = await pool.query<{ temperatura: string; criterios: string }>(
    `SELECT temperatura, criterios
      FROM public.crm_temperatura_criterios
      WHERE client_id = $1 OR client_id IS NULL
      ORDER BY client_id NULLS FIRST`,
    [clientId],
  );
  const criteria = { ...DEFAULT_CRITERIA };
  for (const row of rows) {
    if (isTemperature(row.temperatura)) {
      criteria[row.temperatura] = row.criterios;
    }
  }
  return criteria;
}

async function loadStatusOptions(pool: Pool, lead: { client_id: string; funnel_id?: string | null; status?: string | null }) {
  const params: string[] = [String(lead.client_id)];
  const funnelFilter = lead.funnel_id ? 'AND funnel_id = $2::uuid' : '';
  if (lead.funnel_id) params.push(String(lead.funnel_id));

  const { rows } = await pool.query<{ label: string }>(
    `SELECT label
       FROM public.crm_stages
      WHERE client_id = $1 ${funnelFilter}
      ORDER BY position ASC, created_at ASC`,
    params,
  ).catch(() => ({ rows: [] as Array<{ label: string }> }));

  const labels = rows.map(row => row.label).filter(Boolean);
  const fallback = ['Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Comprou', 'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado'];
  const current = lead.status ? [lead.status] : [];
  return Array.from(new Set([...labels, ...current, ...fallback]));
}

async function loadConversationSignals(pool: Pool, leadId: string): Promise<ConversationSignals> {
  const { rows: [stats] } = await pool.query<{
    outbound_after_last_inbound: number;
    last_direction: 'in' | 'out' | null;
    last_inbound_at: string | null;
    first_outbound_after_last_inbound_at: string | null;
  }>(
    `WITH last_inbound AS (
       SELECT MAX(created_at) AS at
         FROM public.crm_messages
        WHERE lead_id = $1 AND direction = 'in'
     ),
     last_message AS (
       SELECT direction
         FROM public.crm_messages
        WHERE lead_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1
     )
     SELECT
       COUNT(*) FILTER (
         WHERE m.direction = 'out'
           AND (li.at IS NULL OR m.created_at > li.at)
       )::int AS outbound_after_last_inbound,
       MAX(li.at) AS last_inbound_at,
       MIN(m.created_at) FILTER (
         WHERE m.direction = 'out'
           AND (li.at IS NULL OR m.created_at > li.at)
       ) AS first_outbound_after_last_inbound_at,
       (SELECT direction FROM last_message) AS last_direction
      FROM public.crm_messages m
      CROSS JOIN last_inbound li
      WHERE m.lead_id = $1`,
    [leadId],
  ).catch(() => ({
    rows: [] as Array<{
      outbound_after_last_inbound: number;
      last_direction: 'in' | 'out' | null;
      last_inbound_at: string | null;
      first_outbound_after_last_inbound_at: string | null;
    }>,
  }));

  return {
    outboundAfterLastInbound: Number(stats?.outbound_after_last_inbound ?? 0),
    lastDirection: stats?.last_direction ?? null,
    lastInboundAt: stats?.last_inbound_at ?? null,
    firstOutboundAfterLastInboundAt: stats?.first_outbound_after_last_inbound_at ?? null,
  };
}

async function registerAiError(pool: Pool, leadId: string, clientId: string, error: unknown) {
  await pool.query(
    `INSERT INTO public.crm_ia_historico
      (lead_id, client_id, motivo_ia, modelo_usado, erro, mensagens_analisadas)
     VALUES ($1, $2, $3, $4, $5, 0)`,
    [leadId, clientId, 'Falha silenciosa na análise automática', MODEL, String(error)],
  ).catch(() => null);
}

export async function analisarConversa(pool: Pool, leadId: string): Promise<void> {
  try {
    await ensureCrmAiSchema(pool);

    const { rows: [lead] } = await pool.query(
      `SELECT id, client_id, funnel_id, status, temperatura, ia_ultimo_analise, time_interno, numero
         FROM public.crm_leads
        WHERE id = $1`,
      [leadId],
    );
    if (!lead) return;
    if (lead.time_interno === true) return;

    const clientId = String(lead.client_id);
    const { rows: [config] } = await pool.query(
      `SELECT COALESCE(ia_limite_chamadas_dia, 500)::int AS limite
         FROM public.client_tracking_config
        WHERE client_id = $1`,
      [clientId],
    );
    const dailyLimit = Number(config?.limite ?? 500);
    const { rows: [usageToday] } = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM public.crm_ia_historico
        WHERE client_id = $1
          AND erro IS NULL
          AND created_at >= CURRENT_DATE`,
      [clientId],
    );
    if (Number(usageToday?.total ?? 0) >= dailyLimit) {
      await pool.query(
        `INSERT INTO public.crm_ia_avisos (client_id, tipo, mensagem)
         VALUES ($1, 'limite_diario', $2)`,
        [clientId, `Cliente ultrapassou o limite diário de ${dailyLimit} chamadas de IA.`],
      ).catch(() => null);
    }

    const { rows: messages } = await pool.query(
      `SELECT direction, text
         FROM public.crm_messages
        WHERE lead_id = $1
        ORDER BY created_at DESC
        LIMIT 15`,
      [leadId],
    );
    const orderedMessages = messages.reverse();
    if (orderedMessages.length === 0) return;

    const criteria = await loadCriteria(pool, clientId);
    const statusOptions = await loadStatusOptions(pool, lead);
    const signals = await loadConversationSignals(pool, leadId);
    const history = orderedMessages
      .map(row => `${row.direction === 'out' ? 'Atendente' : 'Cliente'}: ${row.text}`)
      .join('\n');

    const prompt = `Você é um analista de vendas especialista. Analise essa conversa de WhatsApp e retorne APENAS um JSON válido, sem nenhum texto adicional antes ou depois.

Conversa (mais recente por último):
${history}

Status atual do lead: ${lead.status ?? 'não definido'}
Temperatura atual: ${lead.temperatura ?? 'não definida'}
Tentativas de contato enviadas sem resposta do cliente desde a última resposta: ${signals.outboundAfterLastInbound}
Dias desde a última resposta do cliente: ${daysSince(signals.lastInboundAt) === Infinity ? 'sem resposta registrada' : daysSince(signals.lastInboundAt).toFixed(1)}
Dias desde a primeira tentativa sem resposta: ${daysSince(signals.firstOutboundAfterLastInboundAt) === Infinity ? 'sem tentativa registrada' : daysSince(signals.firstOutboundAfterLastInboundAt).toFixed(1)}
Última mensagem foi de: ${signals.lastDirection === 'out' ? 'Atendente' : signals.lastDirection === 'in' ? 'Cliente' : 'Ninguém'}

Status disponíveis do funil deste cliente. Use exatamente um destes rótulos no campo "status":
${statusOptions.map(status => `- ${status}`).join('\n')}

Regras importantes de status:
- Seja objetivo e conclusivo. Não mude status por intenção vaga, especulação ou frase ambígua.
- Dê mais peso às mensagens recentes. Uma nova confirmação de agendamento depois de uma compra deve mover para "Agendado" se houver data/horário ou confirmação objetiva.
- "Quero agendar", "tenho interesse em agendar" ou "pode marcar" ainda NÃO é agendamento confirmado se não houver data/horário combinado ou confirmação objetiva.
- Use "Agendado" somente quando houver data e/ou horário definido e o cliente confirmar ou aceitar explicitamente aquele agendamento.
- Se cliente pediu novo horário após um agendamento, use "Reagendado" quando existir.
- Se cliente comprou, pagou ou confirmou fechamento, use "Fechado" ou "Comprou", dando preferência ao rótulo existente no funil.
- "Fechado", "Comprou" e "Paciente" não são status congelados. Se um lead que já comprou iniciar novo atendimento, pedir novo orçamento ou combinar novo agendamento, mude para o status adequado da nova conversa.
- Não mova leads em "Agendado" ou "Reagendado" para "Não Retorna" só por falta de resposta no chat.
- Use "Não Retorna" somente quando houver pelo menos 4 tentativas de contato enviadas pelo atendente sem resposta posterior do cliente E isso já durar pelo menos 2 dias.
- Se não houver mudança clara de etapa, mantenha o status atual e retorne status_deve_mudar=false.

Critérios de temperatura:
- QUENTE: ${criteria.quente}
- MORNO: ${criteria.morno}
- FRIO: ${criteria.frio}

Retorne exatamente este JSON:
{
  "status": "${lead.status ?? statusOptions[0] ?? 'Em Atendimento'}",
  "status_confianca": 85,
  "status_deve_mudar": true,
  "temperatura": "quente",
  "temperatura_confianca": 90,
  "temperatura_deve_mudar": true,
  "motivo": "Lead perguntou sobre preço e prazo, demonstra intenção de compra clara"
}`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
      .trim();
    const parsed = extractJson(text);

    const noReturnStatus = findStatus(statusOptions, 'Não Retorna');
    const aiStatus = normalizeStatus(parsed.status, statusOptions);
    const protectedNoReturn = statusMatches(lead.status, ['Agendado', 'Reagendado']);
    const noReturnQualifies = Boolean(
      signals.lastDirection === 'out'
      && signals.outboundAfterLastInbound >= 4
      && noReturnStatus
      && !protectedNoReturn
      && daysSince(signals.firstOutboundAfterLastInboundAt) >= 2
    );
    const nextStatus = noReturnQualifies ? noReturnStatus : aiStatus;
    const statusConfidence = Number(parsed.status_confianca ?? 0);
    const tempConfidence = Number(parsed.temperatura_confianca ?? 0);
    const nextTemp = parsed.temperatura;

    let appliedStatus = lead.status as string | null;
    let appliedTemp = lead.temperatura as string | null;

    const shouldMoveStatus = noReturnQualifies || (
      parsed.status_deve_mudar === true
      && (nextStatus !== noReturnStatus || noReturnQualifies)
    );
    const effectiveStatusConfidence = noReturnQualifies ? Math.max(statusConfidence, 90) : statusConfidence;
    const confidence = Math.max(effectiveStatusConfidence, tempConfidence);

    if (shouldMoveStatus && effectiveStatusConfidence >= 70 && nextStatus && nextStatus !== lead.status) {
      await pool.query(
        `UPDATE public.crm_leads
            SET status = $1, updated_at = NOW()
          WHERE client_id = $2
            AND (
              id = $3::uuid
              OR (
                NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
                NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '')
                AND NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '') IS NOT NULL
              )
            )`,
        [nextStatus, ...leadIdentityValues(lead)],
      );
      await pool.query(
        `INSERT INTO public.crm_status_historico (lead_id, client_id, status_anterior, status_novo, motivo)
         VALUES ($1, $2, $3, $4, 'ia_conversa')`,
        [leadId, clientId, lead.status ?? null, nextStatus],
      ).catch(() => null);
      await queueFollowupIfExists(pool, leadId, clientId, nextStatus).catch(() => null);
      appliedStatus = nextStatus;
    }

    if (
      parsed.temperatura_deve_mudar === true
      && tempConfidence >= 70
      && (nextTemp === 'quente' || nextTemp === 'morno' || nextTemp === 'frio')
    ) {
      await pool.query(
        `UPDATE public.crm_leads
            SET temperatura = $1, temperatura_atualizada_em = NOW()
          WHERE client_id = $2
            AND (
              id = $3::uuid
              OR (
                NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
                NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '')
                AND NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '') IS NOT NULL
              )
            )`,
        [nextTemp, ...leadIdentityValues(lead)],
      );
      appliedTemp = nextTemp;
    }

    await pool.query(
      `UPDATE public.crm_leads
          SET ia_ultimo_analise = NOW(),
              ia_confianca_ultimo = $1
        WHERE client_id = $2
          AND (
            id = $3::uuid
            OR (
              NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE($4::text, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
          )`,
      [Math.round(confidence), ...leadIdentityValues(lead)],
    );

    await pool.query(
      `INSERT INTO public.crm_ia_historico
        (lead_id, client_id, status_anterior, status_novo, temperatura_anterior, temperatura_nova,
         confianca, motivo_ia, mensagens_analisadas, modelo_usado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        leadId,
        clientId,
        lead.status ?? null,
        appliedStatus,
        lead.temperatura ?? null,
        appliedTemp,
        Math.round(confidence),
        parsed.motivo ?? '',
        orderedMessages.length,
        MODEL,
      ],
    );

    const tokens = Number(response.usage.input_tokens ?? 0) + Number(response.usage.output_tokens ?? 0);
    await pool.query(
      `INSERT INTO public.ia_uso_mensal (client_id, mes_ano, chamadas_ia, tokens_usados, custo_estimado_usd)
       VALUES ($1, $2, 1, $3, $4)
       ON CONFLICT (client_id, mes_ano) DO UPDATE SET
         chamadas_ia = ia_uso_mensal.chamadas_ia + 1,
         tokens_usados = ia_uso_mensal.tokens_usados + EXCLUDED.tokens_usados,
         custo_estimado_usd = ia_uso_mensal.custo_estimado_usd + EXCLUDED.custo_estimado_usd`,
      [clientId, monthKey(), tokens, estimateCostUsd(tokens)],
    );
  } catch (err) {
    const clientId = await pool.query(
      `SELECT client_id FROM public.crm_leads WHERE id = $1`,
      [leadId],
    ).then(res => String(res.rows[0]?.client_id ?? '')).catch(() => '');
    if (clientId) await registerAiError(pool, leadId, clientId, err);
    console.error('[analisarConversa]', err);
  }
}
