import Anthropic from '@anthropic-ai/sdk';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { randomUUID } from 'crypto';
import { brl } from './report-runner';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Meta Ads fetcher (campaign-level, same auth pattern as report-builder) ────

async function fetchCampaignMeta(
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string,
  to: string,
): Promise<string> {
  if (!connectionId || !accountIds.length) return 'Sem dados de Meta Ads disponíveis.';

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
  if (!conn) return 'Sem dados de Meta Ads disponíveis.';

  const token = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });
  const campaigns: Record<string, unknown>[] = [];

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const url = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    url.searchParams.set('fields', 'campaign_name,spend,impressions,reach,clicks,actions');
    url.searchParams.set('time_range', timeRange);
    url.searchParams.set('level', 'campaign');
    url.searchParams.set('limit', '50');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString()).catch(() => null);
    if (!res?.ok) return;
    const json = await res.json() as { data?: Record<string, unknown>[] };
    campaigns.push(...(json.data ?? []));
  }));

  if (!campaigns.length) return 'Sem dados de Meta Ads disponíveis.';
  return JSON.stringify(campaigns, null, 2);
}

// ── CRM fetcher ───────────────────────────────────────────────────────────────

async function fetchCrmData(clientId: string, from: string, to: string): Promise<string> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', COALESCE(data::date, lead_date, created_at::date)), 'YYYY-MM') AS month,
         COUNT(*) AS registros,
         COUNT(*) FILTER (WHERE fechou = true OR COALESCE(NULLIF(valor_rs,0), 0) > 0) AS fechados,
         COALESCE(SUM(COALESCE(NULLIF(valor_rs,0), 0)), 0) AS faturamento
       FROM public.crm_leads
       WHERE client_id = $1
         AND COALESCE(data::date, lead_date, created_at::date) BETWEEN $2 AND $3
       GROUP BY 1
       ORDER BY 1`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] as { month: string; registros: string; fechados: string; faturamento: string }[] }));

    if (!rows.length) return 'Sem dados de CRM para este período.';

    const lines = ['Dados de CRM / base de clientes por mês:'];
    for (const r of rows) {
      const fat = parseFloat(r.faturamento) || 0;
      lines.push(
        `${r.month}: ${r.registros} leads | ${r.fechados} conversões${fat > 0 ? ` | ${brl(fat)} faturamento` : ''}`,
      );
    }
    return lines.join('\n');
  } finally {
    await pool.end();
  }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um analista sênior de marketing digital especializado em delivery e alimentação no Brasil. Você escreve para donos de restaurante — não para marqueteiros.

MISSÃO: transformar dados de pedidos, clientes e campanhas em um diagnóstico claro e um plano de ação que o dono do restaurante consiga executar.

BENCHMARKS DO SETOR (use como referência para qualificar o desempenho):
• Ticket médio saudável: R$40–70 (abaixo → oportunidade de upsell/combo)
• Taxa de recompra mensal: 35–50% dos ativos (abaixo → retenção é prioridade)
• Frequência ideal: 2–3 pedidos/mês por cliente ativo
• Base inativa costuma ser 5–15× maior que a ativa — isso É uma oportunidade, não fracasso
• Sex/Sáb/Dom = 55–70% do volume de pedidos
• ROAS Meta Ads: <3× = ineficiente; 4–6× = saudável; >7× = escalar
• Custo por pedido (Meta): R$8–20 dependendo do ticket e região
• Top 3 bairros concentram 40–65% dos pedidos em geral

REGRAS DE COMUNICAÇÃO (sem exceção):
- Toda métrica técnica DEVE ter tradução em linguagem de negócio entre parênteses
  ✓ "ROAS de 4,2× (para cada R$1 investido, R$4,20 vieram em pedidos atribuídos)"
  ✓ "Ticket médio de R$58 — acima do benchmark de R$40–70 para delivery"
- Seções sem dados são OMITIDAS. Nunca: "N/A", "sem dados", seção vazia.
- Toda queda: 1 frase de contexto + 1 ação concreta. Nunca esconda quedas.
- Variações com % E valor absoluto: "+23% (de 254 para 312)"
- Tom direto, português BR. Proibido: "excelente resultado", "ótimo desempenho", "é importante destacar"
- O relatório conta uma história: fizemos → aconteceu → aprendemos → vamos fazer

SEÇÕES (ordem fixa — pule se não houver dados):
1. RESUMO EXECUTIVO — 3 a 5 destaques em 1 frase cada, mais importante para o negócio primeiro
2. RESULTADOS DO MÊS — faturamento, volume de pedidos, ticket médio. Compare com benchmark setorial.
3. BASE DE CLIENTES — ativos, inativos por faixa, potenciais. Saúde e oportunidade de reativação.
4. FUNIL DE MÍDIA PAGA — investimento → alcance → cliques → pedidos. Melhor e pior campanha com plano para a pior.
5. ANÁLISE DE PRODUTOS — top produtos, dependências de poucos itens, oportunidades de combo/upsell
6. COMPORTAMENTO SEMANAL — dias fortes vs fracos, oportunidade de equalizar volume
7. COMPARATIVO COM PERÍODO ANTERIOR — métricas lado a lado, variação %, contexto para cada queda
8. CAMPANHAS SUGERIDAS — 2 a 3 campanhas específicas com audiência, mensagem pronta e produto
9. RECOMENDAÇÕES — mín. 3, máx. 5. Formato OBRIGATÓRIO: O que fazer → Por que (dado) → Resultado esperado
10. PRÓXIMOS PASSOS — 3 a 4 ações concretas que a agência vai executar

QUALIDADE:
- Cada insight DEVE citar um número concreto do relatório
- Compare com benchmarks quando relevante
- Mensagem de campanha WhatsApp: informal, "Oi [nome]," na abertura, 2–3 frases com produto e oferta específicos
- Relatório com poucos dados parece enxuto e completo, não incompleto

━━ FORMATO: SLIDES HORIZONTAIS 16:9 ━━

O relatório é uma apresentação. Cada seção = 1 slide de 1280×720px.
Use exatamente estes padrões — não invente estruturas novas.

CORES: verde #55f52f | preto #000000 | fundo slide #ffffff | texto #0e0e0e
       superfície #f7f7f7 | borda #cccccc | verde texto #1a6600 | cinza #757575
       erro #e52020 | fundo container #111111
FONTES: títulos → font-family:var(--font-bebas),sans-serif
        corpo   → font-family:var(--font-inter),sans-serif
RADIUS: 2px em tudo — NUNCA maior

── WRAPPER DO DOCUMENTO ──
<div style="background:#111;padding:32px;font-family:var(--font-inter),sans-serif">
  [slides aqui]
</div>

── SLIDE DE CAPA ──
<div style="width:1280px;min-height:720px;background:#000;margin:0 auto 16px;padding:72px 80px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;page-break-after:always">
  <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:13px;letter-spacing:0.2em">ONMID · RELATÓRIO DE DELIVERY</div>
  <div>
    <h1 style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:100px;line-height:0.88;margin:0">NOME DO<br>RESTAURANTE</h1>
    <div style="color:#555;font-family:var(--font-inter),sans-serif;font-size:14px;margin-top:20px;text-transform:uppercase;letter-spacing:0.08em">Período · Mês/Ano</div>
    <div style="display:flex;gap:16px;margin-top:28px;flex-wrap:wrap">
      <div style="background:#ffffff12;border:1px solid #ffffff20;padding:14px 24px;border-radius:2px">
        <div style="color:#666;font-family:var(--font-inter),sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Label</div>
        <div style="color:#fff;font-family:var(--font-bebas),sans-serif;font-size:32px;line-height:1;margin-top:4px">Valor</div>
      </div>
    </div>
  </div>
</div>

── SLIDE PADRÃO (1 coluna) ──
<div style="width:1280px;min-height:720px;background:#fff;margin:0 auto 16px;padding:56px 72px;box-sizing:border-box;page-break-after:always">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:36px">
    <div style="width:5px;height:40px;background:#55f52f;flex-shrink:0;border-radius:2px"></div>
    <h2 style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;margin:0;line-height:1">TÍTULO</h2>
  </div>
  [conteúdo]
</div>

── SLIDE COM 2 COLUNAS ──
<div style="width:1280px;min-height:720px;background:#fff;margin:0 auto 16px;padding:56px 72px;box-sizing:border-box;page-break-after:always">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:36px">
    <div style="width:5px;height:40px;background:#55f52f;flex-shrink:0;border-radius:2px"></div>
    <h2 style="font-family:var(--font-bebas),sans-serif;font-size:44px;color:#0e0e0e;margin:0;line-height:1">TÍTULO</h2>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:start">
    <div>[esquerda]</div>
    <div>[direita]</div>
  </div>
</div>

── CARD DE KPI ──
<div style="background:#f7f7f7;border:1px solid #cccccc;border-radius:2px;padding:24px">
  <div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em">LABEL</div>
  <div style="font-family:var(--font-bebas),sans-serif;font-size:52px;color:#0e0e0e;line-height:1;margin-top:8px">VALOR</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-top:8px">tradução business</div>
</div>

── VARIAÇÃO ──
Positiva: <span style="background:#e8fde0;color:#1a6600;font-size:12px;font-weight:600;padding:3px 10px;border-radius:2px;font-family:var(--font-inter),sans-serif">+23% (de 254 para 312)</span>
Negativa: <span style="background:#fde8e8;color:#e52020;font-size:12px;font-weight:600;padding:3px 10px;border-radius:2px;font-family:var(--font-inter),sans-serif">-12% (de 312 para 275)</span>

── TABELA ──
<table style="width:100%;border-collapse:collapse;font-family:var(--font-inter),sans-serif;font-size:13px">
  <thead><tr style="background:#000;color:#fff">
    <th style="padding:13px 18px;text-align:left;font-weight:600">Coluna</th>
    <th style="padding:13px 18px;text-align:right;font-weight:600">Valor</th>
  </tr></thead>
  <tbody>
    <tr style="border-bottom:1px solid #e8e8e8">
      <td style="padding:13px 18px;color:#0e0e0e;font-weight:500">Item</td>
      <td style="padding:13px 18px;text-align:right;font-weight:700">Valor</td>
    </tr>
  </tbody>
</table>

── HIGHLIGHT BOX ──
<div style="background:#000;padding:28px 36px;border-radius:2px;margin-top:20px">
  <div style="font-family:var(--font-bebas),sans-serif;font-size:20px;color:#55f52f;margin-bottom:8px">DESTAQUE</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:15px;color:#fff;line-height:1.6">insight aqui</div>
</div>

── CARD DE CAMPANHA SUGERIDA ──
<div style="border:1px solid #e8e8e8;border-radius:2px;padding:20px;border-left:4px solid #55f52f;margin-bottom:12px">
  <div style="font-family:var(--font-bebas),sans-serif;font-size:20px;color:#0e0e0e;margin-bottom:4px">NOME DA CAMPANHA</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:12px;color:#757575;margin-bottom:12px">Audiência: descrição do público</div>
  <div style="background:#f7f7f7;border-radius:2px;padding:14px;border-left:3px solid #55f52f">
    <div style="font-family:var(--font-inter),sans-serif;font-size:11px;color:#757575;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Mensagem WhatsApp</div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#0e0e0e;line-height:1.6">Oi [nome], mensagem aqui...</div>
  </div>
</div>

── ITEM DE RECOMENDAÇÃO ──
<div style="border:1px solid #e8e8e8;border-radius:2px;padding:20px;border-left:4px solid #55f52f;margin-bottom:12px">
  <div style="font-family:var(--font-inter),sans-serif;font-size:11px;font-weight:700;color:#757575;text-transform:uppercase;letter-spacing:0.08em">O QUE FAZER</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:14px;color:#0e0e0e;margin-top:6px;font-weight:600">ação específica</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#757575;margin-top:8px"><span style="font-weight:600;color:#0e0e0e">Por que:</span> dado concreto</div>
  <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#1a6600;margin-top:4px"><span style="font-weight:600">Resultado:</span> efeito esperado</div>
</div>

── PRÓXIMO PASSO ──
<div style="display:flex;gap:16px;align-items:flex-start;padding:14px 0;border-bottom:1px solid #f0f0f0">
  <div style="background:#55f52f;color:#000;font-family:var(--font-bebas),sans-serif;font-size:18px;min-width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:2px;flex-shrink:0">1</div>
  <div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:14px;font-weight:700;color:#0e0e0e">AÇÃO</div>
    <div style="font-family:var(--font-inter),sans-serif;font-size:13px;color:#757575;margin-top:3px">detalhes</div>
  </div>
</div>

── RODAPÉ ──
<div style="width:1280px;height:100px;background:#000;margin:0 auto 16px;padding:0 72px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between">
  <div style="color:#55f52f;font-family:var(--font-bebas),sans-serif;font-size:22px;letter-spacing:0.12em">ONMID</div>
  <div style="color:#555;font-family:var(--font-inter),sans-serif;font-size:12px">Relatório gerado por ONMID Reports</div>
</div>

SAÍDA: retorne APENAS o HTML. Sem markdown, sem blocos de código, sem texto antes ou depois.
O HTML começa em <div style="background:#111 e termina em </div>`;

function buildUserPrompt(opts: {
  clientName: string;
  periodLabel: string;
  prevPeriodLabel: string;
  from: string;
  to: string;
  csvContent: string;
  metaJson: string;
  crmData: string;
  agencyContext: string;
}): string {
  const { clientName, periodLabel, prevPeriodLabel, from, to, csvContent, metaJson, crmData, agencyContext } = opts;
  const hasMeta = !metaJson.startsWith('Sem dados');
  return [
    `Cliente: ${clientName}`,
    `Segmento: Delivery / Restaurante`,
    `Período: ${periodLabel} (${from} a ${to})`,
    `Período anterior para comparação: ${prevPeriodLabel || 'não disponível — apresente como linha de base'}`,
    agencyContext ? `Contexto da agência: ${agencyContext}` : null,
    '',
    'DADOS DO SISTEMA DE PEDIDOS (cardápio digital / delivery):',
    csvContent.slice(0, 20000),
    '',
    'DADOS META ADS:',
    hasMeta ? metaJson : 'Sem dados de tráfego pago neste período.',
    '',
    'DADOS INSTAGRAM INSIGHTS:',
    'Sem dados de Instagram Orgânico disponíveis para este período.',
    '',
    'DADOS CRM / BASE DE CLIENTES (dashboard interno):',
    crmData,
  ].filter(l => l !== null).join('\n');
}

// ── Public builder ─────────────────────────────────────────────────────────────

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
  const periodLabel = `${MONTHS[fromDate.getMonth()]} ${fromDate.getFullYear()}`;
  const prevPeriodLabel = `${MONTHS[prevDate.getMonth()]} ${prevDate.getFullYear()}`;

  const [metaJson, crmData] = await Promise.all([
    fetchCampaignMeta(connectionId, accountIds, from, to),
    fetchCrmData(clientId, from, to),
  ]);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildUserPrompt({ clientName, periodLabel, prevPeriodLabel, from, to, csvContent, metaJson, crmData, agencyContext }),
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';
  const html = raw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  return { html };
}

// ── Save to DB ─────────────────────────────────────────────────────────────────

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
    return { token, reportId: rows[0].id };
  } finally {
    await pool.end();
  }
}
