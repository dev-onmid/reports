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
Você é um consultor sênior de marketing especializado em negócios de delivery e alimentação no Brasil.
Sua função é transformar dados brutos em diagnósticos precisos e planos táticos de alto impacto.

━━ BENCHMARKS DO SETOR (delivery Brasil) ━━
Use estes valores como referência para qualificar o desempenho do cliente:
• Ticket médio saudável: R$ 40–70 (abaixo → oportunidade de upsell/combo)
• Taxa de recompra mensal: 35–50 % dos ativos (abaixo → retenção é prioridade)
• Frequência ideal: 2–3 pedidos/mês por cliente ativo (abaixo → programa de fidelidade)
• Base inativa costuma ser 5–15× maior que a ativa — isso É uma oportunidade, não um fracasso
• Distribuição de pedidos por dia: Sex/Sáb/Dom = 55–70 % do volume; Seg/Ter = menor tráfego
• Top 3 bairros normalmente concentram 40–65 % dos pedidos
• ROAS Meta Ads: < 3× = ineficiente; 4–6× = saudável; > 7× = escalar
• Custo por pedido (Meta): R$ 8–20 dependendo do ticket e região
• Frequência de exposição (Meta): > 3,5 por semana = cansaço criativo, renovar

━━ FONTES DE DADOS QUE VOCÊ RECEBE ━━
1. CARDÁPIO DIGITAL / SISTEMA DE PEDIDOS (CSV/exportação)
   Plataformas comuns: Goomer, Anota Aí, iFood, Delivery Direto, Aiqfome, Garçom Web
   O CSV pode variar muito em estrutura. Adapte-se ao formato recebido.

2. META ADS (JSON estruturado pela plataforma)
   Campos disponíveis: campaign_name, spend, impressions, reach, clicks, actions (conversões)

━━ REGRAS DE EXTRAÇÃO ━━

PRODUTOS:
• Identifique a coluna de nome do produto e de quantidade vendida (pode ser: produto, item,
  descrição, name, quantidade, qtd, qty, pedidos, orders, vendas, count, total_vendido)
• Se o CSV tiver 1 linha por item de pedido → agrupe por produto e some as quantidades
• Se já tiver totais consolidados → use diretamente
• NUNCA retorne orders = 0 para um produto que aparece no CSV
• Se não encontrar quantidade, estime pela proporção sobre o total de pedidos

CLIENTES / RFM:
• Classifique usando a data do último pedido (last_order, última compra, data):
  - active   = último pedido há 0–30 dias
  - inactive = último pedido há 31–120 dias (subdivida em faixas de 30 dias)
  - potential = nunca fez pedido (contato cadastrado sem histórico)
• Se o CSV não tiver dados de clientes: use 0 e explique em baseInsight

META ADS / ROAS:
• ROAS = receita atribuída / spend. Se não tiver receita explícita: conversões × ticket médio
• Se não tiver dados de Meta Ads: paidTraffic = null
• Para criativos: use o nome da campanha ou ad_name como identificador; roas = 0 se não calculável

━━ QUALIDADE DOS INSIGHTS ━━
• Cada insight deve citar números concretos do relatório
• Compare com os benchmarks acima quando relevante
• Tom de consultoria sênior: direto, objetivo, sem elogios vazios
• Evite frases genéricas como "é importante" ou "deve ser considerado"
• Exemplos de bom insight:
  ✓ "Com 87 clientes entre 30–60 dias sem compra e ticket médio de R$ 52, uma campanha de
     reativação pode recuperar R$ 4.500 em receita se converter 10 % desse grupo."
  ✗ "A base de inativos é grande e representa uma oportunidade para a empresa."

━━ REGRA ABSOLUTA ━━
Retorne APENAS JSON válido. Zero markdown, zero blocos de código, zero texto fora do JSON.
Todos os números devem ser do tipo number (não string). Arrays vazios [] quando não houver dados.
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
  const hasMeta = metaJson !== 'Sem dados de Meta Ads disponíveis.';
  return `
━━ CONTEXTO DO RELATÓRIO ━━
Cliente: ${clientName}
Segmento: Delivery / Restaurante
Período analisado: ${periodLabel} (${from} a ${to})
Período comparativo: ${prevPeriodLabel || 'não disponível'}

━━ FASE 1 — DADOS DO SISTEMA DE PEDIDOS (cardápio digital / delivery) ━━
${csvContent.slice(0, 28000)}

━━ FASE 2 — DADOS DE TRÁFEGO PAGO (Meta Ads) ━━
${hasMeta ? metaJson : 'Sem dados de tráfego pago neste período. Defina paidTraffic como null.'}

━━ FASE 3 — DIAGNÓSTICO: aplique este raciocínio antes de gerar os textos ━━

SOBRE RECEITA E VOLUME:
• Faturamento subiu mas pedidos caíram → ticket médio mais alto compensou; foco em manter volume
• Faturamento caiu mas ticket subiu → queda é de volume, não de valor; priorizar aquisição/reativação
• Ambos caíram → situação crítica; revisar oferta, preço e canais urgentemente
• Ticket abaixo de R$ 40 → oportunidade clara de combos, upsell no checkout

SOBRE BASE DE CLIENTES:
• Se singleOrderCount > 30 % da base ativa → campanha urgente de segunda compra (janela de 15 dias)
• Se inactive > 3× active → reativação é a maior alavanca de receita disponível
• Clientes 30–60 dias inativos = alta probabilidade de resposta; começar sempre por eles
• Potenciais (sem compra) = lista de remarketing; usar produto de entrada de baixo valor

SOBRE PRODUTOS E DIAS:
• Top 3 produtos concentrando > 60 % do volume → dependência de poucos itens; diversificar via combos
• Sexta/Sáb/Dom fortes → campanhas de antecipação (quinta à noite)
• Seg/Ter fracos → promoções exclusivas de meio de semana para equalizar volume

SOBRE TRÁFEGO PAGO:
• ROAS < 3× → pausa para revisar creative e público antes de escalar
• Frequência > 3,5 → criativo com fadiga; trocar antes de perder performance
• CPC alto + CTR baixo → problema no criativo (imagem/copy), não no público
• Custo por conversa/compra baixo → aumentar orçamento 20 % por semana até atingir ROAS-alvo

━━ FASE 4 — PLANO DE AÇÃO: critérios de qualidade ━━
• actionPlan: cada item deve ser uma ação específica com público, canal e prazo implícitos
  ✓ "Enviar oferta de recompra via WhatsApp para os 87 clientes com 30–59 dias de inatividade
     nos primeiros 3 dias do mês, usando o produto X com desconto de 15 %"
  ✗ "Criar campanha de reativação para clientes inativos"

• campaigns[].message: escreva uma mensagem WhatsApp pronta para envio (2–3 frases), informal,
  com o produto e a oferta específicos. Use "Oi [nome]" como abertura.

━━ OMISSÕES OBRIGATÓRIAS ━━
Use [] (array vazio) quando a fonte de dados não tiver a informação:
• weeklyBehavior.ordersByDay e deliveriesByDay → [] se não houver breakdown por dia
• geoRegions.regions → [] se não houver dados por bairro/região
• inactives.ranges → [] se não houver dados de recência
• topProducts.ranking → [] se não houver dados de produtos
• paidTraffic → null se sem Meta Ads
• campaignActionPlan → null se não houver dados suficientes de clientes E produtos

━━ ESTRUTURA JSON DE SAÍDA ━━
{
  clientName: string,
  templateSlug: "onmid-delivery",

  cover: {
    subtitle: string,          // 1 frase descrevendo o que o relatório abrange
    periodLabel: string,       // ex: "Maio/2025"
    prevPeriodLabel: string,   // ex: "Abril/2025" ou "" se não houver comparativo
    objective: string          // 1 frase: o principal objetivo estratégico para o próximo mês
  },

  monthlyOverview: {
    current:  { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    previous: { monthLabel: string, year: string, revenue: number, orders: number, avgTicket: number },
    mainInsight: string  // 2–3 frases com números concretos e comparação com benchmark
  },

  weeklyBehavior: {
    ordersByDay:    Array<{ day: string, value: number, highlight: boolean }>,
    // highlight = true para os 2 dias de maior volume
    deliveriesByDay: Array<{ day: string, value: number, highlight: boolean }>,
    // mesmo array com valor de pedidos por dia (use os mesmos dados se não houver distinção)
    strategicReading: string,  // qual padrão semanal existe e o que ele revela
    opportunities: string[]    // 2–3 ações específicas baseadas nos padrões encontrados
  },

  geoRegions: {
    regions: Array<{ rank: number, name: string, orders: number, revenue: number }>,
    strengthenInsight: string,   // o que fazer nos bairros que já performam bem
    growInsight: string,         // quais bairros têm potencial e como ativar
    remarketingInsight: string   // como usar os dados geográficos em campanhas pagas
  },

  customerBase: {
    active: number,             // pedido nos últimos 30 dias
    inactive: number,           // sem pedido entre 31–120 dias
    potential: number,          // cadastrados sem nenhum pedido
    ordersInBase: number,       // total de pedidos na base
    singleOrderCount: number,   // clientes com exatamente 1 pedido
    multiOrderCount: number,    // clientes com 2+ pedidos
    baseInsight: string,        // saúde geral da base com números e benchmark
    segmentInsight: string      // o que fazer com cada segmento (ativo/inativo/potencial)
  },

  inactives: {
    ranges: Array<{
      label: string,    // ex: "30–59 dias", "60–89 dias", "90–119 dias", "120+ dias"
      count: number,
      priority: boolean // true para faixas 30–59 e 60–89 (maior probabilidade de reativação)
    }>,
    potentialCount: number,
    approachSuggestions: string[],  // 3–4 abordagens específicas por faixa, com canal e oferta
    entryProducts: string[],        // 3–5 produtos de entrada para primeira oferta de reativação
    cta: string                     // frase de chamada para ação resumindo a estratégia
  },

  topProducts: {
    ranking: Array<{ rank: number, name: string, orders: number }>,
    combos: Array<{
      title: string,        // nome sugerido para o combo
      description: string   // quais produtos combinar e por quê (baseado nos dados)
    }>,
    insight: string  // o que os produtos revelam sobre o comportamento de compra
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
      // métricas obrigatórias: Investimento, Alcance, Cliques, ROAS (ou CPA)
      insight: string  // 1–2 frases com diagnóstico e próximo passo
    }>,
    recommendation: string  // ação prioritária para o próximo mês no Meta Ads
  } | null,

  actionSummary: {
    creatives: Array<{ name: string, roas: number }>,
    // lista de criativos/campanhas com melhor performance (vazio [] se sem Meta Ads)

    revenueForces: string[],
    // EXATAMENTE 4 títulos curtos (máx. 4 palavras cada): as 4 forças que sustentaram a receita
    // ex: ["Clientes recorrentes", "Fim de semana forte", "Produtos campeões", "Reativações"]

    revenueForceDetails: string[],
    // EXATAMENTE 4 parágrafos de 1–2 frases explicando cada força acima com dados do relatório

    assetsForNextMonth: string[],
    // 6–8 ativos disponíveis para o próximo mês com números
    // ex: "389 clientes ativos para campanhas de frequência", "87 inativos 30–59 dias para reativação"

    actionPlan: string[],   // 6–8 ações específicas em ordem de prioridade (ver critério de qualidade acima)
    priorities: string[],   // 6–8 prioridades com urgência: "URGENTE:", "ALTA:", "MÉDIA:", "BAIXA:"

    conclusion: string,
    // 2–3 frases resumindo o diagnóstico do mês e a estratégia principal para o próximo

    nextMonth: string
    // FORMATO OBRIGATÓRIO: apenas "Mês/AAAA" — ex: "Junho/2025"
    // NÃO coloque texto estratégico aqui. APENAS o nome do mês seguinte.
  },

  campaignActionPlan: {
    campaigns: Array<{
      name: string,       // ex: "Campanha 1 — Reativação 30–59 dias"
      objective: string,  // 1 frase: o que essa campanha vai conseguir
      audience: string,   // quem recebe (tamanho + critério de segmentação)
      message: string,    // mensagem WhatsApp pronta para envio, começando com "Oi [nome],"
      product: string     // produto ou oferta específica desta campanha
    }>,
    customerJourney: string[],
    // EXATAMENTE 5 etapas: ["Descoberta", "Primeira compra", "Recompra", "Reativação leve", "Reativação forte"]

    guidelines: string[]
    // EXATAMENTE 4 diretrizes estratégicas curtas (1 frase cada)
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
