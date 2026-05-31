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

const DEFAULT_CRITERIA: Record<Temperature, string> = {
  quente: 'Lead perguntou sobre preço, pediu proposta, demonstrou urgência, disse que quer comprar, perguntou sobre prazo de entrega, pediu para falar com vendedor, comparou com concorrente ativamente',
  morno: 'Lead está respondendo, fazendo perguntas gerais sobre o produto/serviço, pediu mais informações, demonstra interesse mas sem urgência, está avaliando opções',
  frio: 'Lead sumiu por mais de 48h, respondeu com monossílabos, disse que vai pensar, pediu para entrar em contato depois, disse que não tem interesse no momento, apenas perguntou algo pontual sem continuar',
};

const STATUS_MAP: Record<string, string> = {
  novo: 'Novo',
  em_atendimento: 'Em Atendimento',
  proposta: 'Proposta',
  negociacao: 'Negociação',
  fechado: 'Fechado',
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

function normalizeStatus(status: string | undefined | null) {
  if (!status) return null;
  return STATUS_MAP[status] ?? status;
}

function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function estimateCostUsd(tokens: number) {
  return tokens * 0.0000008;
}

async function loadCriteria(pool: Pool, clientId: string): Promise<Record<Temperature, string>> {
  const { rows } = await pool.query(
    `SELECT temperatura, criterios
      FROM public.crm_temperatura_criterios
      WHERE client_id = $1 OR client_id IS NULL
      ORDER BY client_id NULLS FIRST`,
    [clientId],
  );
  const criteria = { ...DEFAULT_CRITERIA };
  for (const row of rows) {
    if (row.temperatura === 'quente' || row.temperatura === 'morno' || row.temperatura === 'frio') {
      criteria[row.temperatura] = row.criterios;
    }
  }
  return criteria;
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
      `SELECT id, client_id, status, temperatura, ia_ultimo_analise, time_interno
         FROM public.crm_leads
        WHERE id = $1`,
      [leadId],
    );
    if (!lead) return;
    if (lead.time_interno === true) return;

    if (lead.ia_ultimo_analise) {
      const last = new Date(lead.ia_ultimo_analise).getTime();
      if (Number.isFinite(last) && Date.now() - last < 5 * 60_000) return;
    }

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
    const history = orderedMessages
      .map(row => `${row.direction === 'out' ? 'Atendente' : 'Cliente'}: ${row.text}`)
      .join('\n');

    const prompt = `Você é um analista de vendas especialista. Analise essa conversa de WhatsApp e retorne APENAS um JSON válido, sem nenhum texto adicional antes ou depois.

Conversa (mais recente por último):
${history}

Status atual do lead: ${lead.status ?? 'não definido'}
Temperatura atual: ${lead.temperatura ?? 'não definida'}

Status disponíveis: novo, em_atendimento, proposta, negociacao, fechado, perdido

Critérios de temperatura:
- QUENTE: ${criteria.quente}
- MORNO: ${criteria.morno}
- FRIO: ${criteria.frio}

Retorne exatamente este JSON:
{
  "status": "em_atendimento",
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

    const nextStatus = normalizeStatus(parsed.status);
    const statusConfidence = Number(parsed.status_confianca ?? 0);
    const tempConfidence = Number(parsed.temperatura_confianca ?? 0);
    const nextTemp = parsed.temperatura;
    const confidence = Math.max(statusConfidence, tempConfidence);

    let appliedStatus = lead.status as string | null;
    let appliedTemp = lead.temperatura as string | null;

    if (parsed.status_deve_mudar === true && statusConfidence >= 70 && nextStatus && nextStatus !== lead.status) {
      await pool.query(
        `UPDATE public.crm_leads SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nextStatus, leadId],
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
          WHERE id = $2`,
        [nextTemp, leadId],
      );
      appliedTemp = nextTemp;
    }

    await pool.query(
      `UPDATE public.crm_leads
          SET ia_ultimo_analise = NOW(),
              ia_confianca_ultimo = $1
        WHERE id = $2`,
      [Math.round(confidence), leadId],
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
