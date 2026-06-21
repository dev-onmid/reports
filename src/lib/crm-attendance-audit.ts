import Anthropic from '@anthropic-ai/sdk';
import type { Pool } from 'pg';
import { ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { logAiUsage } from '@/lib/ai-usage-logger';

const MODEL = 'claude-sonnet-4-6';

// Statuses that signal the lead actually advanced — used both to flag "good examples"
// candidates and to compute progression rate per source/canal.
const PROGRESSED_STATUSES = ['Agendado', 'Reagendado', 'Proposta', 'Negociação', 'Fechado', 'Comprou'];

export type AttendanceAudit = {
  nota_geral: number;
  classificacao: 'Excelente' | 'Bom' | 'Atenção' | 'Crítico' | 'Grave';
  resumo_semana: string;
  notas_criterios: {
    velocidade_sla: number;
    qualidade_conversa: number;
    conducao_comercial: number;
    followup_recuperacao: number;
    organizacao_crm: number;
  };
  principais_problemas: string[];
  oportunidades_perdidas: Array<{
    lead_id: string;
    canal: string;
    o_que_queria: string;
    onde_falhou: string;
    acao_deveria: string;
    gravidade: 'baixa' | 'média' | 'alta';
  }>;
  bons_exemplos: Array<{
    lead_id: string;
    o_que_foi_bem: string;
    motivo_referencia: string;
  }>;
  analise_atendentes: Array<{
    atendente: string;
    tempo_medio_resposta: string;
    taxa_sem_resposta: string;
    qualidade_media: string;
    pontos_fortes: string;
    pontos_melhoria: string;
  }>;
  analise_fontes: Array<{
    fonte: string;
    quantidade_leads: number;
    qualidade_atendimento: string;
    taxa_avanco: string;
    principais_gargalos: string;
  }>;
  plano_acao: {
    urgentes: string[];
    melhorias_processo: string[];
    treinamento_time: string[];
    ajustes_script: string[];
    ajustes_crm_automacoes: string[];
  };
  recomendacao_final: string;
};

type LeadRow = {
  id: string;
  nome: string | null;
  numero: string | null;
  canal: string | null;
  status: string | null;
  created_at: string;
  data_agendada: string | null;
  compareceu: boolean | null;
  fechou: boolean | null;
  valor_rs: string | number | null;
  observacao: string | null;
  last_inbound_at: string | null;
  last_direction: 'in' | 'out' | null;
  outbound_after_last_inbound: number;
  message_count: number;
};

async function ensureAuditSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.crm_atendimento_auditorias (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT NOT NULL,
      period_from DATE NOT NULL,
      period_to   DATE NOT NULL,
      nota_geral  INTEGER NOT NULL,
      classificacao TEXT NOT NULL,
      resultado   JSONB NOT NULL,
      leads_analisados INTEGER NOT NULL DEFAULT 0,
      modelo_usado TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS crm_atendimento_auditorias_client_idx
      ON public.crm_atendimento_auditorias(client_id, created_at DESC);
  `);
}

function classify(score: number): AttendanceAudit['classificacao'] {
  if (score >= 85) return 'Excelente';
  if (score >= 70) return 'Bom';
  if (score >= 55) return 'Atenção';
  if (score >= 40) return 'Crítico';
  return 'Grave';
}

// Picks a representative sample instead of every conversation in the period, to keep
// the audit's cost/latency bounded even for clients with hundreds of leads/week. Each
// canal (source) gets its own slice so "análise por fonte" always has real coverage,
// and within each canal we prioritize the conversations most likely to be informative:
// leads waiting on a reply, leads that progressed (candidate "bons exemplos"), and a
// few others for baseline variety.
function pickSample(leads: LeadRow[], perCanalCap: number, totalCap: number): LeadRow[] {
  const byCanal = new Map<string, LeadRow[]>();
  for (const lead of leads) {
    const key = lead.canal?.trim() || 'Não informado';
    if (!byCanal.has(key)) byCanal.set(key, []);
    byCanal.get(key)!.push(lead);
  }

  const waitingFor = (lead: LeadRow) =>
    lead.last_direction === 'out' && lead.outbound_after_last_inbound > 0 ? lead.outbound_after_last_inbound : 0;

  const sample: LeadRow[] = [];
  for (const group of byCanal.values()) {
    const sorted = [...group].sort((a, b) => {
      const aProgressed = PROGRESSED_STATUSES.includes(a.status ?? '') ? 1 : 0;
      const bProgressed = PROGRESSED_STATUSES.includes(b.status ?? '') ? 1 : 0;
      return (waitingFor(b) - waitingFor(a)) || (bProgressed - aProgressed) || (b.message_count - a.message_count);
    });
    sample.push(...sorted.slice(0, perCanalCap));
  }

  return sample.slice(0, totalCap);
}

async function fetchLeadsForPeriod(pool: Pool, clientId: string, from: string, to: string): Promise<LeadRow[]> {
  const { rows } = await pool.query<LeadRow>(
    `WITH last_inbound AS (
       SELECT lead_id, MAX(created_at) AS at
         FROM public.crm_messages
        GROUP BY lead_id
     )
     SELECT
       l.id, l.nome, l.numero, l.canal, l.status, l.created_at,
       l.data_agendada, l.compareceu, l.fechou, l.valor_rs, l.observacao,
       li.at AS last_inbound_at,
       (SELECT direction FROM public.crm_messages m WHERE m.lead_id = l.id ORDER BY created_at DESC, id DESC LIMIT 1) AS last_direction,
       COALESCE((
         SELECT COUNT(*)::int FROM public.crm_messages m
          WHERE m.lead_id = l.id AND m.direction = 'out' AND (li.at IS NULL OR m.created_at > li.at)
       ), 0) AS outbound_after_last_inbound,
       COALESCE((SELECT COUNT(*)::int FROM public.crm_messages m WHERE m.lead_id = l.id), 0) AS message_count
     FROM public.crm_leads l
     LEFT JOIN last_inbound li ON li.lead_id = l.id
     WHERE l.client_id = $1
       AND COALESCE(l.created_at::date, l.data) BETWEEN $2 AND $3
       AND l.time_interno IS NOT TRUE
     ORDER BY l.created_at DESC`,
    [clientId, from, to],
  );
  return rows;
}

async function fetchMessagesFor(pool: Pool, leadIds: string[]): Promise<Map<string, Array<{ direction: string; text: string; created_at: string }>>> {
  const map = new Map<string, Array<{ direction: string; text: string; created_at: string }>>();
  if (!leadIds.length) return map;
  const { rows } = await pool.query<{ lead_id: string; direction: string; text: string; created_at: string }>(
    `SELECT lead_id, direction, text, created_at
       FROM public.crm_messages
      WHERE lead_id = ANY($1::uuid[])
      ORDER BY lead_id, created_at ASC`,
    [leadIds],
  );
  for (const row of rows) {
    if (!map.has(row.lead_id)) map.set(row.lead_id, []);
    map.get(row.lead_id)!.push({ direction: row.direction, text: row.text, created_at: row.created_at });
  }
  return map;
}

function formatLeadBlock(lead: LeadRow, messages: Array<{ direction: string; text: string; created_at: string }>): string {
  const valor = lead.valor_rs ? `R$ ${Number(lead.valor_rs).toFixed(2)}` : 'não informado';
  const historico = messages.length
    ? messages
        .slice(-20)
        .map(m => `  [${new Date(m.created_at).toLocaleString('pt-BR')}] ${m.direction === 'out' ? 'Atendente' : 'Cliente'}: ${m.text}`)
        .join('\n')
    : '  (sem mensagens registradas)';

  return `--- LEAD ${lead.id} ---
Nome: ${lead.nome || 'não informado'}
Canal de origem: ${lead.canal || 'não informado'}
Data de entrada: ${new Date(lead.created_at).toLocaleString('pt-BR')}
Responsável pelo atendimento: não informado (não rastreado no CRM)
Etapa atual no funil / status: ${lead.status || 'não informado'}
Agendamento: ${lead.data_agendada ? new Date(lead.data_agendada).toLocaleDateString('pt-BR') : 'não informado'}
Compareceu: ${lead.compareceu === null ? 'não informado' : lead.compareceu ? 'sim' : 'não'}
Venda/fechamento: ${lead.fechou === null ? 'não informado' : lead.fechou ? `sim (${valor})` : 'não'}
Observações/tags: ${lead.observacao || 'não informado'}
Motivo de perda: não informado (não rastreado no CRM)
Mensagens:
${historico}`;
}

const RUBRIC_PROMPT = `Você é uma IA especialista em auditoria de atendimento comercial via WhatsApp, CRM, vendas consultivas e conversão de leads em agendamento, proposta, comparecimento e venda.

Seu objetivo é avaliar a qualidade do atendimento do cliente durante o período analisado, identificando se a empresa está aproveitando bem os leads recebidos ou se está desperdiçando oportunidades por demora, falta de condução, ausência de follow-up, atendimento frio, falta de diagnóstico ou má organização no CRM.

IMPORTANTE:
- Não invente dados que não estejam disponíveis.
- Quando uma informação não existir, marque como "não informado".
- Diferencie resposta automática/bot de resposta humana quando conseguir identificar pelo conteúdo da mensagem.
- Não exponha dados sensíveis desnecessários. Ao citar exemplos, resuma ou anonimize.
- Avalie o atendimento com foco em conversão real, não apenas quantidade de mensagens.
- O campo "responsável pelo atendimento" e "motivo de perda" não são rastreados neste CRM hoje — sempre que for usá-los, marque como "não informado" e NÃO invente nomes de atendentes. A seção "análise por atendente" deve vir vazia ou conter um único item explicando essa limitação.

CRITÉRIOS DE AVALIAÇÃO — NOTA TOTAL 100:

1. VELOCIDADE E SLA — 25 pontos
Avalie tempo médio da primeira resposta, quantidade de leads sem resposta, conversas em que o cliente ficou aguardando retorno, maior tempo de espera, se houve retomada dentro de tempo aceitável.
22-25: respostas rápidas, poucos ou nenhum lead parado. 16-21: atendimento razoável, com alguns atrasos. 8-15: muitos atrasos ou leads importantes aguardando. 0-7: atendimento crítico, muitos leads sem resposta ou abandonados.

2. QUALIDADE DA CONVERSA — 30 pontos
Avalie tom humano/acolhedor/profissional, personalização usando contexto do lead, clareza, diagnóstico antes de vender, perguntas inteligentes para entender dor/desejo/urgência/necessidade, se evita respostas secas ou genéricas.
26-30: conversa consultiva, humana e bem conduzida. 20-25: boa conversa, com oportunidades de melhoria. 10-19: atendimento genérico, pouco diagnóstico ou pouca personalização. 0-9: atendimento frio, confuso, robótico ou sem investigação.

3. CONDUÇÃO COMERCIAL — 30 pontos
Avalie se gerou valor antes de falar preço, se explicou diferenciais/benefícios/segurança, se conduziu para próximo passo claro, se tentou agendar/enviar proposta/negociar/avançar o lead, se tratou objeções (preço, medo, tempo, "vou pensar", comparação), se não encerrou com frases fracas como "qualquer coisa estou à disposição".
26-30: condução forte, com CTA claro e avanço comercial. 20-25: boa condução, mas perdeu algumas chances. 10-19: respondeu mas não conduziu bem para venda/agendamento. 0-9: atendimento passivo, sem tentativa real de conversão.

4. FOLLOW-UP E RECUPERAÇÃO — 10 pontos
Avalie se houve follow-up quando o lead parou de responder, retomada após proposta, lembrete de agendamento, tentativa de reagendar faltosos, se o follow-up foi contextualizado ou apenas automático.
9-10: follow-up consistente e inteligente. 6-8: follow-up existe mas pode melhorar. 3-5: poucas retomadas. 0-2: praticamente não há follow-up.

5. ORGANIZAÇÃO NO CRM — 5 pontos
Avalie etapa correta do funil, responsável definido, status atualizado, motivo de perda registrado, próxima ação/tarefa registrada.
5: CRM bem organizado. 3-4: organização parcial. 1-2: muitos dados faltando. 0: CRM desorganizado ou sem informações úteis.

TAREFAS DA ANÁLISE:
1. Calcule a nota geral do atendimento no período, de 0 a 100, e classifique como Excelente (85-100), Bom (70-84), Atenção (55-69), Crítico (40-54) ou Grave (0-39).
2. Gere as notas por critério (os 5 acima).
3. Identifique os principais gargalos: demora na resposta, leads sem resposta, falta de diagnóstico, atendimento genérico, falta de CTA, falta de follow-up, objeções mal tratadas, propostas sem retomada, agendamentos sem confirmação, CRM desorganizado.
4. Identifique oportunidades perdidas: conversas com sinal de interesse que não avançaram. Para cada: ID do lead, canal de origem, o que o lead queria, onde o atendimento falhou, qual ação deveria ter sido tomada, gravidade (baixa/média/alta).
5. Identifique bons exemplos: conversas bem conduzidas. Para cada: ID do lead, o que foi bem conduzido, por que deve ser referência.
6. Análise por atendente: SEMPRE "não informado" pois este CRM não rastreia responsável por mensagem hoje (ver nota acima).
7. Análise por fonte/canal: quando houver dados de origem, compare quantidade de leads, qualidade do atendimento, taxa de avanço e principais gargalos por fonte.
8. Plano de ação para a próxima semana, dividido em: ações urgentes, melhorias de processo, treinamento do time, ajustes de script, ajustes no CRM/automações.

TOM DA ANÁLISE: seja direto, profissional e consultivo. Não seja genérico. Aponte claramente onde o cliente está perdendo dinheiro. Sempre que possível, transforme o problema em ação prática.`;

function buildPrompt(periodLabel: string, leadBlocks: string[], totalLeadsNoPeriodo: number, amostraSize: number): string {
  return `${RUBRIC_PROMPT}

PERÍODO ANALISADO: ${periodLabel}
TOTAL DE LEADS NO PERÍODO: ${totalLeadsNoPeriodo}
AMOSTRA ANALISADA NESTA AUDITORIA: ${amostraSize} conversas (amostra representativa por canal de origem, priorizando leads sem resposta e leads que avançaram no funil)

DADOS DE ENTRADA (uma conversa por bloco):
${leadBlocks.join('\n\n')}

Retorne APENAS um JSON válido (sem markdown, sem texto antes ou depois), exatamente neste formato:
{
  "nota_geral": 72,
  "classificacao": "Bom",
  "resumo_semana": "string com o resumo executivo do período",
  "notas_criterios": {
    "velocidade_sla": 18,
    "qualidade_conversa": 22,
    "conducao_comercial": 20,
    "followup_recuperacao": 7,
    "organizacao_crm": 4
  },
  "principais_problemas": ["string", "string"],
  "oportunidades_perdidas": [
    { "lead_id": "uuid do lead", "canal": "string", "o_que_queria": "string", "onde_falhou": "string", "acao_deveria": "string", "gravidade": "baixa" }
  ],
  "bons_exemplos": [
    { "lead_id": "uuid do lead", "o_que_foi_bem": "string", "motivo_referencia": "string" }
  ],
  "analise_atendentes": [
    { "atendente": "não informado", "tempo_medio_resposta": "não informado", "taxa_sem_resposta": "não informado", "qualidade_media": "não informado", "pontos_fortes": "não informado", "pontos_melhoria": "Adicionar rastreamento de responsável por conversa no CRM para permitir essa análise" }
  ],
  "analise_fontes": [
    { "fonte": "string", "quantidade_leads": 0, "qualidade_atendimento": "string", "taxa_avanco": "string", "principais_gargalos": "string" }
  ],
  "plano_acao": {
    "urgentes": ["string"],
    "melhorias_processo": ["string"],
    "treinamento_time": ["string"],
    "ajustes_script": ["string"],
    "ajustes_crm_automacoes": ["string"]
  },
  "recomendacao_final": "string"
}`;
}

function extractJson(text: string): AttendanceAudit {
  const clean = text.trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Resposta da IA não contém JSON válido');
  return JSON.parse(clean.slice(start, end + 1)) as AttendanceAudit;
}

export async function runAttendanceAudit(pool: Pool, clientId: string, from: string, to: string): Promise<AttendanceAudit> {
  await ensureCrmMessagesSchema(pool);
  await ensureAuditSchema(pool);

  const leads = await fetchLeadsForPeriod(pool, clientId, from, to);
  if (!leads.length) {
    throw new Error('Não há leads no período selecionado para auditar.');
  }

  const sample = pickSample(leads, 4, 40);
  const messagesByLead = await fetchMessagesFor(pool, sample.map(l => l.id));
  const leadBlocks = sample.map(lead => formatLeadBlock(lead, messagesByLead.get(lead.id) ?? []));

  const periodLabel = `${new Date(from + 'T12:00:00').toLocaleDateString('pt-BR')} a ${new Date(to + 'T12:00:00').toLocaleDateString('pt-BR')}`;
  const prompt = buildPrompt(periodLabel, leadBlocks, leads.length, sample.length);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');

  const anthropic = new Anthropic({ apiKey });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content.map(block => block.type === 'text' ? block.text : '').join('').trim();
  const result = extractJson(text);
  result.classificacao = classify(result.nota_geral);

  void logAiUsage({ source: 'crm_attendance_audit', model: MODEL, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

  await pool.query(
    `INSERT INTO public.crm_atendimento_auditorias
       (client_id, period_from, period_to, nota_geral, classificacao, resultado, leads_analisados, modelo_usado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [clientId, from, to, result.nota_geral, result.classificacao, JSON.stringify(result), sample.length, MODEL],
  );

  return result;
}

export async function fetchLatestAudit(pool: Pool, clientId: string): Promise<{ result: AttendanceAudit; periodFrom: string; periodTo: string; createdAt: string } | null> {
  await ensureAuditSchema(pool);
  const { rows } = await pool.query<{ resultado: AttendanceAudit; period_from: string; period_to: string; created_at: string }>(
    `SELECT resultado, period_from, period_to, created_at
       FROM public.crm_atendimento_auditorias
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [clientId],
  );
  if (!rows[0]) return null;
  return { result: rows[0].resultado, periodFrom: rows[0].period_from, periodTo: rows[0].period_to, createdAt: rows[0].created_at };
}
