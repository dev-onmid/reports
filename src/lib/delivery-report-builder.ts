import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { randomUUID } from 'crypto';
import { brl } from './report-runner';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientBase = {
  ativos: number;
  inativos: number;
  potenciais: number;
  com_1_pedido: number;
  com_mais_de_1: number;
  total_pedidos_base: number;
};

type InativoFaixa = { faixa: string; quantidade: number };
type Bairro = { bairro: string; pedidos: number; faturamento: number };

type MetaAds = {
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  campanhas: Array<{
    nome: string;
    tipo: string;
    metricas: { investimento: number; impressoes: number; alcance: number; cliques: number };
  }>;
};

type StructuredData = {
  cliente: { nome: string; segmento: string };
  periodo: { atual: string; anterior: string };
  contexto_agencia: string;
  base_clientes: ClientBase;
  inativos_por_faixa: InativoFaixa[];
  por_regiao: Bairro[];
  meta_ads: MetaAds | null;
};

// ── DB Fetchers ───────────────────────────────────────────────────────────────

async function fetchClientBase(clientId: string, from: string, to: string): Promise<ClientBase> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `WITH per_numero AS (
         SELECT
           numero,
           SUM(CASE WHEN fechou = true OR COALESCE(NULLIF(valor_rs,0),0) > 0 THEN 1 ELSE 0 END) AS total_pedidos,
           MAX(COALESCE(data, lead_date, created_at::date)) AS ultima_data
         FROM public.crm_leads
         WHERE client_id = $1
           AND numero IS NOT NULL AND numero != '' AND numero NOT LIKE '%-%'
         GROUP BY numero
       )
       SELECT
         COUNT(*) FILTER (WHERE total_pedidos > 0 AND ultima_data BETWEEN $2 AND $3)          AS ativos,
         COUNT(*) FILTER (WHERE total_pedidos > 0 AND NOT (ultima_data BETWEEN $2 AND $3))    AS inativos,
         COUNT(*) FILTER (WHERE total_pedidos = 0)                                             AS potenciais,
         COUNT(*) FILTER (WHERE total_pedidos = 1)                                             AS com_1_pedido,
         COUNT(*) FILTER (WHERE total_pedidos > 1)                                             AS com_mais_de_1,
         COALESCE(SUM(total_pedidos), 0)                                                       AS total_pedidos_base
       FROM per_numero`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] }));

    const r = rows[0] ?? {};
    return {
      ativos:            parseInt(String(r.ativos            ?? 0), 10),
      inativos:          parseInt(String(r.inativos          ?? 0), 10),
      potenciais:        parseInt(String(r.potenciais        ?? 0), 10),
      com_1_pedido:      parseInt(String(r.com_1_pedido      ?? 0), 10),
      com_mais_de_1:     parseInt(String(r.com_mais_de_1     ?? 0), 10),
      total_pedidos_base:parseInt(String(r.total_pedidos_base?? 0), 10),
    };
  } finally {
    await pool.end();
  }
}

async function fetchInativosFaixas(clientId: string, referenceDate: string): Promise<InativoFaixa[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `WITH ultima_compra AS (
         SELECT numero, MAX(COALESCE(data, lead_date, created_at::date)) AS ult
         FROM public.crm_leads
         WHERE client_id = $1
           AND (fechou = true OR COALESCE(NULLIF(valor_rs,0),0) > 0)
           AND numero IS NOT NULL AND numero != ''
         GROUP BY numero
       )
       SELECT
         CASE
           WHEN dias BETWEEN 30  AND 59  THEN '30-59'
           WHEN dias BETWEEN 60  AND 89  THEN '60-89'
           WHEN dias BETWEEN 90  AND 179 THEN '90-179'
           WHEN dias BETWEEN 180 AND 364 THEN '180-364'
           WHEN dias >= 365              THEN '365+'
         END AS faixa,
         COUNT(*) AS quantidade
       FROM (
         SELECT ($2::date - ult)::int AS dias FROM ultima_compra WHERE ult < $2::date
       ) t
       WHERE dias >= 30
       GROUP BY 1
       ORDER BY MIN(dias)`,
      [clientId, referenceDate],
    ).catch(() => ({ rows: [] }));

    const ORDER = ['30-59', '60-89', '90-179', '180-364', '365+'];
    return ORDER
      .map(faixa => {
        const row = rows.find((r: { faixa: string }) => r.faixa === faixa);
        return row ? { faixa, quantidade: parseInt(String(row.quantidade), 10) } : null;
      })
      .filter((x): x is InativoFaixa => x !== null && x.quantidade > 0);
  } finally {
    await pool.end();
  }
}

async function fetchBairros(clientId: string, from: string, to: string): Promise<Bairro[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         bairro,
         COUNT(*)                                         AS pedidos,
         COALESCE(SUM(COALESCE(NULLIF(valor_rs,0),0)), 0) AS faturamento
       FROM public.crm_leads
       WHERE client_id = $1
         AND bairro IS NOT NULL AND bairro != ''
         AND COALESCE(data, lead_date, created_at::date) BETWEEN $2 AND $3
       GROUP BY bairro
       ORDER BY pedidos DESC
       LIMIT 10`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] }));

    return rows.map((r: { bairro: string; pedidos: string; faturamento: string }) => ({
      bairro:      r.bairro,
      pedidos:     parseInt(r.pedidos, 10),
      faturamento: parseFloat(r.faturamento),
    }));
  } finally {
    await pool.end();
  }
}

async function fetchMetaAds(
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string,
  to: string,
): Promise<MetaAds | null> {
  if (!connectionId || !accountIds.length) return null;

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }
  if (!conn) return null;

  const token = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });

  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalCliques = 0;
  const campaigns: Array<{
    nome: string; tipo: string;
    metricas: { investimento: number; impressoes: number; alcance: number; cliques: number };
  }> = [];

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

    // Account totals
    const urlAcc = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAcc.searchParams.set('fields', 'spend,impressions,reach,clicks');
    urlAcc.searchParams.set('time_range', timeRange);
    urlAcc.searchParams.set('level', 'account');
    urlAcc.searchParams.set('access_token', token);
    const resAcc = await fetch(urlAcc.toString()).catch(() => null);
    if (resAcc?.ok) {
      const j = await resAcc.json() as { data?: Record<string, string>[] };
      for (const row of j.data ?? []) {
        totalSpend       += parseFloat(row.spend       ?? '0');
        totalImpressions += parseInt(row.impressions   ?? '0', 10);
        totalReach       += parseInt(row.reach         ?? '0', 10);
        totalCliques     += parseInt(row.clicks        ?? '0', 10);
      }
    }

    // Campaign level
    const urlCamp = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlCamp.searchParams.set('fields', 'campaign_name,objective,spend,impressions,reach,clicks');
    urlCamp.searchParams.set('time_range', timeRange);
    urlCamp.searchParams.set('level', 'campaign');
    urlCamp.searchParams.set('limit', '5');
    urlCamp.searchParams.set('access_token', token);
    const resCamp = await fetch(urlCamp.toString()).catch(() => null);
    if (!resCamp?.ok) return;
    const j = await resCamp.json() as { data?: Record<string, string>[] };
    for (const row of j.data ?? []) {
      campaigns.push({
        nome: String(row.campaign_name ?? 'Sem nome'),
        tipo: String(row.objective     ?? ''),
        metricas: {
          investimento: parseFloat(row.spend       ?? '0'),
          impressoes:   parseInt(row.impressions   ?? '0', 10),
          alcance:      parseInt(row.reach         ?? '0', 10),
          cliques:      parseInt(row.clicks        ?? '0', 10),
        },
      });
    }
  }));

  if (totalSpend === 0 && campaigns.length === 0) return null;

  return {
    investimento: totalSpend,
    impressoes:   totalImpressions,
    alcance:      totalReach,
    cliques:      totalCliques,
    campanhas:    campaigns.slice(0, 3),
  };
}

// ── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um analista sênior de marketing especializado em delivery e alimentação no Brasil. Você escreve para o dono do restaurante — não para marqueteiros.

MISSÃO: transformar dados de pedidos, clientes e campanhas em um diagnóstico claro e um plano de ação que o dono consiga executar amanhã.

BENCHMARKS (use para qualificar o desempenho):
• Ticket médio saudável: R$40–70 • Taxa de recompra mensal: 35–50% dos ativos • Frequência ideal: 2–3 pedidos/mês por ativo
• Base inativa costuma ser 5–15× maior que a ativa — é oportunidade, não fracasso • Sex/Sáb/Dom = 55–70% do volume
• ROAS Meta Ads: <3× ineficiente | 4–6× saudável | >7× escalar • Custo por pedido: R$8–20 dependendo do ticket

REGRAS SEM EXCEÇÃO:
1. Nunca invente dados. Campo ausente = slide omitido.
2. Todo slide termina com insight ou recomendação em linguagem de dono de negócio.
3. Quedas não são escondidas: 1 frase de contexto + 1 ação concreta.
4. Variações sempre com % e valor absoluto: "-1,8% (de R$134.535 para R$132.143)"
5. Proibido: "excelente resultado", "é importante destacar", "N/A", seção vazia.
6. Tom direto, português BR. "Clientes que pararam de comprar", não "churn".

━━ ESTRUTURA DOS 9 SLIDES (ordem fixa — pule slides sem dados) ━━

SLIDE 1 — CAPA (sempre presente)
• Título: "Relatório de Performance — [nome do cliente]"
• Subtítulo: o que o relatório cobre (adapte ao que tem dado)
• Período analisado e período de comparação
• 3–4 KPIs chave em cards: o que mais importa pro negócio desse cliente

SLIDE 2 — VISÃO GERAL DO MÊS (só se houver dados de faturamento/pedidos na planilha)
• Linha atual: Faturamento | Pedidos | Ticket médio
• Linha anterior: mesmos campos (com badge azul para período anterior)
• Linha comparativo: variação % com seta verde/vermelha
• Card "Leitura principal": 2 frases sobre o que os números significam e o foco do próximo mês

SLIDE 3 — COMPORTAMENTO POR DIA DA SEMANA (só se houver dados por dia na planilha)
• Barras CSS horizontais para os 7 dias: barras verdes para os 2 mais fortes, cinza para os demais
• Card "Leitura estratégica": quais dias concentram força
• Card "Oportunidade": bullets com ações para os dias fracos

SLIDE 4 — REGIÕES COM MAIOR VOLUME (só se por_regiao tiver dados)
• Tabela com ranking de bairros (pedidos + faturamento)
• Card "Fortalecer onde existe demanda": top 3 com estratégia
• Card "Estimular onde há potencial": bairros fracos + oportunidade
• Card "Insight para remarketing": como usar segmentação geográfica

SLIDE 5 — BASE DE CLIENTES (só se base_clientes tiver dados)
• 3 KPIs: Clientes ativos | Clientes inativos | Clientes em potencial
• Barra dividida mostrando proporção dos 3 grupos
• Cards "Dentro da ativa": com 1 pedido | com mais de 1 (com badge de oportunidade)
• Insight: qual grupo representa maior alavancagem

SLIDE 6 — INATIVOS E POTENCIAIS (só se inativos_por_faixa tiver dados)
• KPI destaque: clientes em potencial (nunca compraram)
• Barras CSS por faixa de dias (30-59 / 60-89 / 90-179 / 180-364 / 365+), destacar faixa prioritária
• 3 cards de abordagem sugerida com mensagem WhatsApp de exemplo
• Conclusão: por qual faixa começar e por quê

SLIDE 7 — PRODUTOS CAMPEÕES (só se houver dados de produtos na planilha)
• Ranking horizontal de top produtos (barras CSS verdes)
• 3 cards de combos sugeridos para aumentar ticket
• Insight: produto protagonista vs. produto que eleva ticket

SLIDE 8 — TRÁFEGO PAGO (só se meta_ads tiver dados)
• 4 KPIs: Investimento | Impressões | Alcance | Cliques
• Para cada campanha (máx 3): card com métricas + insight estratégico em 2–3 linhas
• Recomendação geral de estrutura

SLIDE 9 — DIAGNÓSTICO E PLANO DE AÇÃO (sempre presente, sempre o último)
• Coluna 1 "O que foi feito": resumo dos criativos / iniciativas do mês
• Coluna 2 "O que compõe o resultado": ícones das 3–4 forças identificadas
• Coluna 3 "Plano para o próximo mês": lista numerada de 4–7 ações concretas
• Coluna 4 "Prioridades": bullets específicos de execução
• Card de conclusão estratégica: 1 frase forte que resume o que o próximo mês deve ser

━━ DESIGN SYSTEM — SIGA EXATAMENTE ━━

DIMENSÃO: 1440×810px por slide
CORES:
  Verde primário:     #00C853
  Verde claro (bg):   #E8F5E9
  Texto principal:    #111111 (peso 700-800 em títulos)
  Texto secundário:   #555555
  Fundo slide:        #FFFFFF
  Fundo card:         #FAFAFA
  Borda card:         #F0F0F0
  Positivo bg:        #E8F5E9  | texto: #00C853
  Negativo bg:        #FFEBEE  | texto: #FF5252
  Período anterior:   bg #E3F2FD | texto: #1565C0
  Container externo:  #F4F4F4
FONTES:
  Números KPI grandes e nome ONMID: font-family:var(--font-bebas),sans-serif
  Todo o resto: font-family:var(--font-inter),sans-serif
RADIUS: cards 12px | badges 6px | barras 4px | ícones-círculo 50%
SOMBRA: 0 2px 8px rgba(0,0,0,0.05) em cards

━━ PADRÕES HTML OBRIGATÓRIOS ━━

WRAPPER DO DOCUMENTO:
<div style="background:#F4F4F4;padding:28px;font-family:var(--font-inter),sans-serif">[slides]</div>

SLIDE GENÉRICO (adapte conteúdo; mude fundo da capa para #111111):
<div style="width:1440px;min-height:810px;background:#FFFFFF;margin:0 auto 20px;border-radius:0;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <!-- HEADER BAR (obrigatório em todo slide) -->
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F0F0F0;flex-shrink:0">
    <span style="font-family:var(--font-bebas),sans-serif;font-size:22px;color:#00C853;letter-spacing:0.06em">ONMID</span>
    <span style="font-size:12px;color:#AAAAAA;font-family:var(--font-inter),sans-serif;font-weight:500">NN/09</span>
  </div>
  <!-- CONTEÚDO -->
  <div style="flex:1;padding:36px 48px 40px">[conteúdo]</div>
</div>

TÍTULO DE SEÇÃO (dentro do conteúdo):
<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:24px">
  <div style="width:4px;min-height:38px;background:#00C853;border-radius:2px;flex-shrink:0;margin-top:2px"></div>
  <div>
    <h2 style="font-family:var(--font-inter),sans-serif;font-size:28px;font-weight:800;color:#111111;margin:0;line-height:1.1">TÍTULO</h2>
    <p style="font-size:14px;color:#555555;margin:4px 0 0;font-family:var(--font-inter),sans-serif">subtítulo</p>
  </div>
</div>

CARD DE KPI (use em grid de 3–4 colunas):
<div style="background:#FAFAFA;border:1px solid #F0F0F0;border-radius:12px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
    <div style="width:34px;height:34px;background:#E8F5E9;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00C853" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">[path]</svg>
    </div>
    <span style="font-size:11px;font-weight:700;color:#777777;text-transform:uppercase;letter-spacing:0.08em;font-family:var(--font-inter),sans-serif">LABEL</span>
  </div>
  <div style="font-family:var(--font-bebas),sans-serif;font-size:42px;color:#111111;line-height:1;margin-bottom:6px">VALOR</div>
  <div style="font-size:12px;color:#555555;line-height:1.5;font-family:var(--font-inter),sans-serif">contexto business</div>
</div>

BADGE POSITIVO: <span style="background:#E8F5E9;color:#00C853;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;font-family:var(--font-inter),sans-serif">↑ +23% (de 254 para 312)</span>
BADGE NEGATIVO: <span style="background:#FFEBEE;color:#FF5252;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;font-family:var(--font-inter),sans-serif">↓ -12% (de 312 para 275)</span>
BADGE ANTERIOR: <span style="background:#E3F2FD;color:#1565C0;font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px;font-family:var(--font-inter),sans-serif">mai/25: R$134.535</span>

BARRA CSS HORIZONTAL (charts de dias / produtos / inativos):
<div style="margin-bottom:10px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <span style="font-size:13px;font-weight:600;color:#111111;font-family:var(--font-inter),sans-serif">Label</span>
    <span style="font-size:13px;font-weight:700;color:#111111;font-family:var(--font-inter),sans-serif">150</span>
  </div>
  <div style="height:8px;background:#F0F0F0;border-radius:4px;overflow:hidden">
    <div style="height:100%;background:#00C853;border-radius:4px;width:75%"></div>
  </div>
</div>
<!-- Barra cinza (dias fracos): troque background:#00C853 por background:#D0D0D0 -->

BARRA DIVIDIDA (proporção 3 grupos da base):
<div style="height:14px;border-radius:7px;overflow:hidden;display:flex;margin:16px 0">
  <div style="background:#00C853;width:X%"></div>
  <div style="background:#FF5252;width:Y%"></div>
  <div style="background:#1565C0;width:Z%"></div>
</div>
<!-- X = ativos/total*100, Y = inativos/total*100, Z = potenciais/total*100 -->

TABELA DE BAIRROS:
<table style="width:100%;border-collapse:collapse;font-family:var(--font-inter),sans-serif;font-size:13px">
  <thead><tr style="background:#111111;color:#FFFFFF">
    <th style="padding:10px 16px;text-align:left;font-weight:600;border-radius:6px 0 0 0">Bairro</th>
    <th style="padding:10px 16px;text-align:right;font-weight:600">Pedidos</th>
    <th style="padding:10px 16px;text-align:right;font-weight:600;border-radius:0 6px 0 0">Faturamento</th>
  </tr></thead>
  <tbody>[linhas com border-bottom:1px solid #F5F5F5]</tbody>
</table>

CARD DE INSIGHT (leitura estratégica / oportunidade):
<div style="background:#F0FAF3;border:1px solid #C8E6C9;border-radius:12px;padding:18px 20px">
  <div style="font-size:11px;font-weight:700;color:#00C853;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;font-family:var(--font-inter),sans-serif">LEITURA ESTRATÉGICA</div>
  <p style="font-size:14px;color:#111111;line-height:1.6;margin:0;font-family:var(--font-inter),sans-serif">texto do insight</p>
</div>

CARD DE RECOMENDAÇÃO (slide 9):
<div style="background:#FFFFFF;border:1px solid #F0F0F0;border-radius:12px;padding:18px 20px;border-left:4px solid #00C853;margin-bottom:10px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
  <div style="font-size:11px;font-weight:700;color:#AAAAAA;text-transform:uppercase;letter-spacing:0.08em;font-family:var(--font-inter),sans-serif">O QUE FAZER</div>
  <div style="font-size:14px;font-weight:600;color:#111111;margin-top:5px;font-family:var(--font-inter),sans-serif">ação específica</div>
  <div style="font-size:13px;color:#555555;margin-top:6px;font-family:var(--font-inter),sans-serif"><span style="font-weight:600;color:#111111">Por que:</span> dado concreto do relatório</div>
  <div style="font-size:13px;color:#00C853;font-weight:600;margin-top:4px;font-family:var(--font-inter),sans-serif">Resultado esperado: efeito mensurável</div>
</div>

PRÓXIMO PASSO NUMERADO:
<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #F5F5F5">
  <div style="width:30px;height:30px;background:#00C853;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <span style="font-size:15px;font-weight:800;color:#FFFFFF;font-family:var(--font-inter),sans-serif">1</span>
  </div>
  <div>
    <div style="font-size:14px;font-weight:700;color:#111111;font-family:var(--font-inter),sans-serif">AÇÃO</div>
    <div style="font-size:12px;color:#555555;margin-top:2px;font-family:var(--font-inter),sans-serif">detalhe concreto</div>
  </div>
</div>

CARD DE CAMPANHA META:
<div style="background:#FAFAFA;border:1px solid #F0F0F0;border-radius:12px;padding:18px 20px;margin-bottom:12px">
  <div style="font-size:14px;font-weight:700;color:#111111;margin-bottom:8px;font-family:var(--font-inter),sans-serif">Nome da campanha</div>
  <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px">
    <span style="font-size:12px;color:#555555;font-family:var(--font-inter),sans-serif"><strong style="color:#111111">R$XXX</strong> investido</span>
    <span style="font-size:12px;color:#555555;font-family:var(--font-inter),sans-serif"><strong style="color:#111111">XX.XXX</strong> alcance</span>
    <span style="font-size:12px;color:#555555;font-family:var(--font-inter),sans-serif"><strong style="color:#111111">XXX</strong> cliques</span>
  </div>
  <p style="font-size:13px;color:#555555;line-height:1.5;margin:0;font-family:var(--font-inter),sans-serif">insight estratégico em 2–3 linhas</p>
</div>

SAÍDA: retorne APENAS o HTML. Sem markdown, sem blocos de código, sem texto antes ou depois.
O HTML começa com <div style="background:#F4F4F4 e termina com </div>`;

// ── User Prompt ───────────────────────────────────────────────────────────────

function buildUserPrompt(data: StructuredData, csvContent: string): string {
  return [
    '## DADOS ESTRUTURADOS DO SISTEMA (já calculados — use diretamente)',
    '```json',
    JSON.stringify(data, null, 2),
    '```',
    '',
    '## PLANILHA DE PEDIDOS',
    'Extraia daqui: visao_geral (faturamento, pedidos, ticket), por_dia (dia → pedidos/vendas), produtos (ranking de vendas).',
    'Compare faturamento/pedidos do período atual com período anterior SE houver dois meses de dados.',
    '',
    csvContent.slice(0, 50000),
  ].join('\n');
}

// ── Public Builder ────────────────────────────────────────────────────────────

export async function buildDeliveryReport(opts: {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  csvContent: string;
  agencyContext?: string;
  connectionId?: string | null;
  accountIds?: string[];
}): Promise<{ html: string }> {
  const { clientId, clientName, from, to, csvContent, agencyContext = '', connectionId, accountIds = [] } = opts;

  const fromDate = new Date(from + 'T12:00:00');
  const prevDate = new Date(fromDate);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodLabel    = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  const prevPeriodLabel= `${MONTHS[prevDate.getMonth()]}/${prevDate.getFullYear()}`;

  const [base_clientes, inativos_por_faixa, por_regiao, meta_ads] = await Promise.all([
    fetchClientBase(clientId, from, to),
    fetchInativosFaixas(clientId, to),
    fetchBairros(clientId, from, to),
    fetchMetaAds(connectionId, accountIds, from, to),
  ]);

  const structuredData: StructuredData = {
    cliente:          { nome: clientName, segmento: 'Delivery / Restaurante' },
    periodo:          { atual: periodLabel, anterior: prevPeriodLabel },
    contexto_agencia: agencyContext,
    base_clientes,
    inativos_por_faixa,
    por_regiao,
    meta_ads,
  };

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 8192,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildUserPrompt(structuredData, csvContent) }],
  });

  const raw  = message.content[0].type === 'text' ? message.content[0].text : '';
  const html = raw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  return { html };
}

// ── Save to DB ────────────────────────────────────────────────────────────────

export async function saveDeliveryReport(opts: {
  clientId: string;
  clientName: string;
  from: string;
  to: string;
  data: { html: string };
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
      [clientId, clientName, from, to, 'onmid-narrative-delivery', JSON.stringify(data), token],
    );
    return { token, reportId: rows[0].id as string };
  } finally {
    await pool.end();
  }
}

// keep brl in scope for possible future use
void brl;
