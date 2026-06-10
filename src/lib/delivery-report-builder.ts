import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { randomUUID } from 'crypto';
import { brl } from './report-runner';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Types ─────────────────────────────────────────────────────────────────────

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
  por_regiao: Bairro[];   // do banco (crm_leads.bairro) — pode estar vazio
  meta_ads: MetaAds | null; // da API do Meta
};

// ── DB Fetchers ───────────────────────────────────────────────────────────────

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
    const metaSignal = AbortSignal.timeout(12000);
    const resAcc = await fetch(urlAcc.toString(), { signal: metaSignal }).catch(() => null);
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
    const resCamp = await fetch(urlCamp.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
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

const SYSTEM_PROMPT = `Você é um analista sênior de marketing especializado em delivery. Escreve para o dono do restaurante.

BENCHMARKS: ticket médio R$40–70 | recompra mensal 35–50% dos ativos | Sex/Sáb/Dom = 55–70% do volume | ROAS <3× ruim, 4–6× bom, >7× escalar

REGRAS:
1. Dados ausentes na planilha = slide omitido. Nunca invente.
2. Todo slide termina com insight em linguagem de negócio (não de marqueteiro).
3. Quedas: 1 contexto + 1 ação. Variações sempre: "+23% (de 254 para 312)".
4. Proibido: "excelente resultado", "N/A", seções vazias.

FONTES DE DADOS:
- JSON (meta_ads, por_regiao): dados do sistema — use direto.
- PLANILHA CSV: extraia daqui tudo mais: faturamento, pedidos, ticket, por_dia, base_clientes (ativos/inativos/potenciais), produtos. A planilha Goomer/Anota Aí inclui esses resumos.

SLIDES (pule sem dados):
1-CAPA: sempre. Título, período, 3–4 KPIs mais importantes do negócio.
2-VISÃO GERAL: faturamento|pedidos|ticket atual vs anterior. Card leitura.
3-DIAS DA SEMANA: barras CSS (verde=top 2, cinza=demais). Card estratégia + oportunidade.
4-REGIÕES: só se por_regiao tiver dados. Tabela bairros + 3 cards insight.
5-BASE DE CLIENTES: só se houver ativos/inativos/potenciais na planilha. 3 KPIs + barra dividida + insight.
6-INATIVOS: só se houver faixas (30-59/60-89/90-179/180-364/365+). Barras + 3 mensagens WhatsApp exemplo.
7-PRODUTOS: só se houver ranking. Barras top produtos + 3 combos sugeridos.
8-META ADS: só se meta_ads no JSON. 4 KPIs + cards por campanha.
9-DIAGNÓSTICO: sempre, sempre último. 4 colunas: feito|resultados|plano próximo mês|prioridades. Card conclusão 1 frase.

DESIGN (1440×810px por slide):
Cores: verde #00C853 | verde-bg #E8F5E9 | texto #111111 | secundário #555555 | fundo slide #FFFFFF | card #FAFAFA | borda #F0F0F0 | positivo bg #E8F5E9 txt #00C853 | negativo bg #FFEBEE txt #FF5252 | anterior bg #E3F2FD txt #1565C0
Fontes: KPI grandes e "ONMID" → var(--font-bebas),sans-serif | resto → var(--font-inter),sans-serif
Radius: cards 12px | badges 6px | barras 4px. Sombra cards: 0 2px 8px rgba(0,0,0,0.05)

ESTRUTURA OBRIGATÓRIA DE CADA SLIDE:
<div style="width:1440px;min-height:810px;background:#FFFFFF;margin:0 auto 20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #F0F0F0;flex-shrink:0">
    <span style="font-family:var(--font-bebas),sans-serif;font-size:22px;color:#00C853">ONMID</span>
    <span style="font-size:12px;color:#AAAAAA">NN/09</span>
  </div>
  <div style="flex:1;padding:32px 48px 36px">[conteúdo]</div>
</div>

TÍTULO DE SEÇÃO: <div style="display:flex;gap:12px;margin-bottom:20px"><div style="width:4px;background:#00C853;border-radius:2px;flex-shrink:0"></div><div><h2 style="font-family:var(--font-inter),sans-serif;font-size:26px;font-weight:800;color:#111111;margin:0">TÍTULO</h2><p style="font-size:13px;color:#555555;margin:3px 0 0">subtítulo</p></div></div>

KPI CARD (grid 3-4 col): <div style="background:#FAFAFA;border:1px solid #F0F0F0;border-radius:12px;padding:20px"><div style="width:32px;height:32px;background:#E8F5E9;border-radius:50%;margin-bottom:10px"></div><div style="font-size:10px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:0.08em">LABEL</div><div style="font-family:var(--font-bebas),sans-serif;font-size:40px;color:#111111;line-height:1;margin:6px 0">VALOR</div><div style="font-size:12px;color:#555555">contexto</div></div>

BADGE+: <span style="background:#E8F5E9;color:#00C853;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px">↑ +23% (de 254 para 312)</span>
BADGE-: <span style="background:#FFEBEE;color:#FF5252;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px">↓ -12% (de 312 para 275)</span>
BADGE ANT: <span style="background:#E3F2FD;color:#1565C0;font-size:12px;font-weight:600;padding:3px 10px;border-radius:6px">mai/25: R$134.535</span>

BARRA CSS: <div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;color:#111111;margin-bottom:3px"><span>Label</span><span>150</span></div><div style="height:8px;background:#F0F0F0;border-radius:4px"><div style="height:100%;background:#00C853;border-radius:4px;width:75%"></div></div></div>
(dias fracos: background:#D0D0D0 na barra interna)

BARRA DIVIDIDA BASE: <div style="height:12px;border-radius:6px;overflow:hidden;display:flex;margin:12px 0"><div style="background:#00C853;width:X%"></div><div style="background:#FF5252;width:Y%"></div><div style="background:#1565C0;width:Z%"></div></div>

TABELA BAIRROS: <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#111111;color:#FFF"><th style="padding:9px 14px;text-align:left">Bairro</th><th style="padding:9px 14px;text-align:right">Pedidos</th><th style="padding:9px 14px;text-align:right">Faturamento</th></tr></thead><tbody>[tr com border-bottom:1px solid #F5F5F5]</tbody></table>

INSIGHT BOX: <div style="background:#F0FAF3;border:1px solid #C8E6C9;border-radius:12px;padding:16px 18px"><div style="font-size:10px;font-weight:700;color:#00C853;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">LEITURA</div><p style="font-size:14px;color:#111111;line-height:1.6;margin:0">insight</p></div>

REC CARD: <div style="border:1px solid #F0F0F0;border-radius:12px;padding:16px 18px;border-left:4px solid #00C853;margin-bottom:8px"><div style="font-size:10px;font-weight:700;color:#AAAAAA;text-transform:uppercase">O QUE FAZER</div><div style="font-size:14px;font-weight:600;color:#111111;margin-top:4px">ação</div><div style="font-size:12px;color:#555555;margin-top:4px"><strong style="color:#111111">Por que:</strong> dado</div><div style="font-size:12px;color:#00C853;font-weight:600;margin-top:3px">Resultado: efeito</div></div>

PRÓX PASSO: <div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #F5F5F5"><div style="width:28px;height:28px;background:#00C853;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:14px;font-weight:800;color:#FFF">1</span></div><div><div style="font-size:13px;font-weight:700;color:#111111">AÇÃO</div><div style="font-size:12px;color:#555555;margin-top:1px">detalhe</div></div></div>

CAPA (fundo escuro): use background:#111111 no slide e background:rgba(255,255,255,0.08) nos cards de KPI, cor #FFF nos textos, #00C853 no subtítulo de agência.

WRAPPER: <div style="background:#F4F4F4;padding:28px">[slides]</div>

SAÍDA: APENAS HTML. Sem markdown, sem texto extra. Começa com <div style="background:#F4F4F4 e termina com </div>.`;

// ── User Prompt ───────────────────────────────────────────────────────────────

function buildUserPrompt(data: StructuredData, csvContent: string): string {
  const metaSection = data.meta_ads
    ? `meta_ads: ${JSON.stringify(data.meta_ads)}`
    : 'meta_ads: null (sem dados de tráfego pago)';

  const regiaoSection = data.por_regiao.length
    ? `por_regiao: ${JSON.stringify(data.por_regiao)}`
    : 'por_regiao: [] (sem dados de bairro no sistema — procure na planilha)';

  return [
    `CLIENTE: ${data.cliente.nome} | SEGMENTO: ${data.cliente.segmento}`,
    `PERÍODO ATUAL: ${data.periodo.atual} | PERÍODO ANTERIOR: ${data.periodo.anterior}`,
    data.contexto_agencia ? `CONTEXTO DA AGÊNCIA: ${data.contexto_agencia}` : '',
    '',
    '=== DADOS DO SISTEMA (use diretamente) ===',
    metaSection,
    regiaoSection,
    '',
    '=== PLANILHA DE PEDIDOS (extraia: faturamento, pedidos, ticket, por_dia, base_clientes, inativos, produtos) ===',
    csvContent.slice(0, 50000),
  ].filter(Boolean).join('\n');
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
  const periodLabel     = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  const prevPeriodLabel = `${MONTHS[prevDate.getMonth()]}/${prevDate.getFullYear()}`;

  const [por_regiao, meta_ads] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaAds(connectionId, accountIds, from, to),
  ]);

  console.log(`[delivery] ${clientName} | Meta: ${meta_ads ? `R$${meta_ads.investimento}` : 'null'} | Bairros: ${por_regiao.length} | CSV: ${csvContent.length} chars`);

  const structuredData: StructuredData = {
    cliente:          { nome: clientName, segmento: 'Delivery / Restaurante' },
    periodo:          { atual: periodLabel, anterior: prevPeriodLabel },
    contexto_agencia: agencyContext,
    por_regiao,
    meta_ads,
  };

  const message = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 12000,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: buildUserPrompt(structuredData, csvContent) }],
  });

  const raw  = message.content[0].type === 'text' ? message.content[0].text : '';
  const html = raw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  console.log(`[delivery] HTML gerado: ${html.length} chars | stop_reason: ${message.stop_reason}`);

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
