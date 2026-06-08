import Anthropic from '@anthropic-ai/sdk';
import type { DeliveryReportData } from '@/components/delivery-template/types';
import { makeServerPool } from '@/lib/server-db';
import { randomUUID } from 'crypto';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Meta Ads fetcher (reuses the same connection pattern as report-builder.ts) ─
async function fetchMetaData(clientId: string, from: string, to: string) {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT access_token, ad_account_id FROM meta_connections WHERE client_id = $1 LIMIT 1`,
      [clientId],
    );
    if (!rows[0]) return null;

    const { access_token, ad_account_id } = rows[0];
    const fields = 'campaign_name,spend,impressions,reach,clicks,actions';
    const url = `https://graph.facebook.com/v19.0/act_${ad_account_id}/insights?fields=${fields}&time_range={"since":"${from}","until":"${to}"}&level=campaign&limit=50&access_token=${access_token}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return (json.data ?? []) as Record<string, string>[];
  } catch {
    return null;
  } finally {
    await pool.end();
  }
}

// ── Claude prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
Você é um especialista em análise de dados de restaurantes/delivery e marketing digital.
Receberá:
1. Dados exportados do cardápio digital (CSV/texto — pedidos, produtos, clientes, regiões, etc.)
2. Dados de campanhas de Meta Ads (JSON — gastos, impressões, cliques, ROAS, etc.)
3. Período e nome do cliente

Sua tarefa: extrair, interpretar e estruturar TODOS os dados em um JSON TypeScript exato.

REGRAS CRÍTICAS:
- Retorne APENAS JSON válido. Sem markdown, sem blocos de código, sem explicações.
- Todos os valores numéricos devem ser números (não strings).
- Textos de insight: objetivos, data-driven, tom de consultoria sênior, 2-4 frases.
- paidTraffic: null se não houver dados de Meta Ads.
- Se o CSV estiver em outro formato (XML, JSON, etc.), extraia da mesma forma.
- Gere no mínimo 6 itens em actionPlan e 6 itens em priorities.

REGRAS DE EXTRAÇÃO DE PRODUTOS:
- Procure colunas como: "produto", "item", "name", "description", "quantidade", "qtd", "qty",
  "pedidos", "orders", "vendas", "sales", "total_vendido", "count" em qualquer case.
- O campo "orders" de cada produto = quantidade de vezes que aquele produto foi pedido/vendido.
- Se o CSV tiver linhas de pedido (1 linha = 1 item de pedido), agrupe por produto e some.
- Se o CSV tiver totais por produto, use diretamente.
- NUNCA deixe orders = 0 se o produto aparecer no CSV. Se não encontrar a quantidade, estime
  pela proporção em relação ao total de pedidos do mês.

REGRAS DE EXTRAÇÃO DE BASE DE CLIENTES:
- Procure colunas: "cliente", "customer", "telefone", "phone", "status", "ativo", "inativo",
  "última compra", "last_order", "recency", "frequência", "frequency".
- active = clientes com pedido nos últimos 30 dias (ou marcados como "ativo").
- inactive = clientes sem pedido entre 31-120 dias (ou marcados como "inativo").
- potential = contatos sem nenhum pedido registrado (ou marcados como "potencial").
- Se o CSV não tiver dados de clientes, use 0 e explique no baseInsight.

REGRAS ROAS (META ADS):
- ROAS de um criativo = receita atribuída / investimento.
- Se não houver coluna de receita, calcule pelo número de conversões estimadas × ticket médio.
- Se não houver dados de ROAS no CSV/Meta, use 0.00 para criativos.
`.trim();

function buildUserPrompt(
  clientName: string,
  periodLabel: string,
  prevPeriodLabel: string,
  from: string,
  to: string,
  csvContent: string,
  metaJson: string,
): string {
  return `
CLIENTE: ${clientName}
PERÍODO ATUAL: ${periodLabel} (${from} a ${to})
PERÍODO COMPARATIVO: ${prevPeriodLabel}

=== DADOS DO CARDÁPIO DIGITAL (CSV/Exportação) ===
${csvContent.slice(0, 30000)}

=== DADOS META ADS ===
${metaJson}

Retorne o JSON com exatamente esta estrutura TypeScript:

{
  clientName: string,
  templateSlug: "onmid-delivery",
  cover: {
    subtitle: string,           // ex: "Análise de resultado e oportunidades de crescimento"
    periodLabel: string,        // ex: "Abril 2025"
    prevPeriodLabel: string,    // ex: "Março 2025"
    objective: string           // 1-2 frases sobre o objetivo do relatório
  },
  monthlyOverview: {
    current: { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    previous: { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    mainInsight: string         // leitura principal comparando os dois meses (2-3 frases)
  },
  weeklyBehavior: {
    ordersByDay: Array<{ day: string, value: number, highlight: boolean }>,   // 7 dias da semana
    deliveriesByDay: Array<{ day: string, value: number, highlight: boolean }>,
    strategicReading: string,   // análise dos picos e vales (2 frases)
    opportunities: string[]     // 3 ações para potencializar dias fracos
  },
  geoRegions: {
    regions: Array<{ rank: number, name: string, orders: number, revenue: number }>,  // top 8
    strengthenInsight: string,
    growInsight: string,
    remarketingInsight: string
  },
  customerBase: {
    active: number,
    inactive: number,
    potential: number,
    ordersInBase: number,
    singleOrderCount: number,
    multiOrderCount: number,
    baseInsight: string,        // 1-2 frases
    segmentInsight: string      // 1-2 frases
  },
  inactives: {
    ranges: Array<{ label: string, count: number, priority: boolean }>,  // ex: "30-60 dias", "61-90 dias", "91-120 dias", "+120 dias"
    potentialCount: number,
    approachSuggestions: string[],  // 3 abordagens de reativação
    entryProducts: string[],        // 2-4 produtos para porta de entrada
    cta: string                     // chamada para ação no WhatsApp
  },
  topProducts: {
    ranking: Array<{ rank: number, name: string, orders: number }>,  // top 6
    combos: Array<{ title: string, description: string }>,           // 4-5 combos/upsell sugeridos
    insight: string
  },
  paidTraffic: {
    investment: number,
    impressions: number,
    reach: number,
    clicks: number,
    campaignNames: string[],
    topCampaigns: Array<{
      name: string,
      description: string,
      metrics: Array<{ label: string, value: string }>,
      insight: string
    }>,
    recommendation: string
  } | null,
  actionSummary: {
    creatives: Array<{ name: string, roas: number }>,  // 3-4 criativos se Meta disponível
    revenueForces: string[],  // 4 forças que compõem o faturamento (frases curtas)
    actionPlan: string[],     // 5-6 ações táticas para o próximo mês
    priorities: string[],     // 5-6 prioridades ordenadas por impacto
    conclusion: string,       // 1-2 frases de síntese executiva
    nextMonth: string         // nome do próximo mês (ex: "Maio")
  }
}
`.trim();
}

// ── Public builder ─────────────────────────────────────────────────────────────
export async function buildDeliveryReport(opts: {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  csvContent: string;
}): Promise<DeliveryReportData> {
  const { clientId, clientName, from, to, csvContent } = opts;

  // Month labels
  const fromDate = new Date(from + 'T12:00:00');
  const prevDate = new Date(fromDate);
  prevDate.setMonth(prevDate.getMonth() - 1);

  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodLabel = `${MONTHS[fromDate.getMonth()]} ${fromDate.getFullYear()}`;
  const prevPeriodLabel = `${MONTHS[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

  // Meta data
  const metaRows = await fetchMetaData(clientId, from, to);
  const metaJson = metaRows ? JSON.stringify(metaRows, null, 2) : 'Sem dados de Meta Ads disponíveis.';

  // Claude call
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(clientName, periodLabel, prevPeriodLabel, from, to, csvContent, metaJson),
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  // Strip any accidental markdown fences
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  const reportData: DeliveryReportData = JSON.parse(jsonText);
  return reportData;
}

// ── Save to DB ─────────────────────────────────────────────────────────────────
export async function saveDeliveryReport(opts: {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  data: DeliveryReportData;
}): Promise<{ token: string; reportId: string }> {
  const { clientId, clientName, from, to, data } = opts;
  const token = randomUUID();

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports
         (client_id, client_name, period_from, period_to, template_slug, report_data, public_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [clientId, clientName, from, to, 'onmid-delivery', JSON.stringify(data), token],
    );
    return { token, reportId: rows[0].id };
  } finally {
    await pool.end();
  }
}
