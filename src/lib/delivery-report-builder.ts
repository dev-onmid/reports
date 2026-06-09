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

=== REGRAS DE INSIGHT AUTOMÁTICO ===
Aplique as regras abaixo ao gerar os textos de insight:
- Faturamento caiu mas ticket médio subiu → queda vem de volume/pedidos, não de valor médio
- Pedidos E ticket médio caíram → revisar oferta, campanha de volume urgente
- Ticket médio subiu → sugerir combos e produtos complementares
- Inativos = maioria da base → priorizar reativação acima de tudo
- Clientes com 1 pedido relevantes → priorizar segunda compra antes que virem inativos
- Sexta e sábado fortes → reforçar campanhas de fim de semana
- Terça e quarta fracos → criar campanhas específicas de meio de semana
- Poucos bairros concentram pedidos → remarketing geográfico segmentado
- ROAS positivo → sugerir escala controlada
- Frequência alta → renovação de criativos urgente
- Custo por compra baixo → aumentar orçamento gradualmente
- Custo por conversa alto → testar nova oferta ou público

=== REGRAS DE OMISSÃO ===
Use arrays VAZIOS [] quando não houver dados (não zeros, não placeholders).
- weeklyBehavior.ordersByDay: [] se não houver dados por dia da semana
- geoRegions.regions: [] se não houver dados por bairro/região
- customerBase: use 0 para todos os números se não houver segmentação de clientes
- inactives.ranges: [] se não houver dados de inatividade; potentialCount: 0 se não houver potenciais
- topProducts.ranking: [] se não houver dados de produtos
- paidTraffic: null se não houver dados de Meta Ads
- campaignActionPlan: null se não houver base de clientes ou produtos para montar as campanhas

Retorne o JSON com exatamente esta estrutura TypeScript:

{
  clientName: string,
  templateSlug: "onmid-delivery",
  cover: {
    subtitle: string,
    periodLabel: string,
    prevPeriodLabel: string,     // "" se não houver mês anterior
    objective: string
  },
  monthlyOverview: {
    current: { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    previous: { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    mainInsight: string
  },
  weeklyBehavior: {
    ordersByDay: Array<{ day: string, value: number, highlight: boolean }>,
    deliveriesByDay: Array<{ day: string, value: number, highlight: boolean }>,
    strategicReading: string,
    opportunities: string[]
  },
  geoRegions: {
    regions: Array<{ rank: number, name: string, orders: number, revenue: number }>,
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
    baseInsight: string,
    segmentInsight: string
  },
  inactives: {
    ranges: Array<{ label: string, count: number, priority: boolean }>,
    potentialCount: number,
    approachSuggestions: string[],
    entryProducts: string[],
    cta: string
  },
  topProducts: {
    ranking: Array<{ rank: number, name: string, orders: number }>,
    combos: Array<{ title: string, description: string }>,
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
    creatives: Array<{ name: string, roas: number }>,
    revenueForces: string[],          // 4 frases curtas: ex "Clientes recorrentes", "Produtos campeões"
    revenueForceDetails: string[],    // 4 parágrafos explicando cada força (1-2 frases cada)
    assetsForNextMonth: string[],     // 6-8 itens: "X clientes ativos", "Y clientes inativos", "Produtos campeões", etc.
    actionPlan: string[],             // 6-8 ações em ordem de prioridade
    priorities: string[],             // 6-8 prioridades objetivas
    conclusion: string,
    nextMonth: string    // APENAS o nome do mês seguinte, ex: "Junho/2025" — NÃO coloque texto estratégico aqui
  },
  campaignActionPlan: {
    campaigns: Array<{
      name: string,        // ex: "Campanha 1 — Recompra para ativos"
      objective: string,
      audience: string,
      message: string,     // mensagem sugerida para WhatsApp (1-2 frases)
      product: string      // produto ou oferta recomendada
    }>,
    customerJourney: string[],   // 5 etapas: ["Descoberta", "Primeira compra", "Recompra", "Reativação leve", "Reativação forte"]
    guidelines: string[]          // 4 diretrizes estratégicas (frases curtas)
  } | null
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
    max_tokens: 16000,
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
