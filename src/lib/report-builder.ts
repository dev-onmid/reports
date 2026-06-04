import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { RESULT_ACTIONS, NEW_CONTACT_ACTIONS, PURCHASE_ACTIONS, sumActions, brl } from './report-runner';
import type { OmniReportData, MonthPoint, ReportPage } from '@/components/onmid-performance-template/types';

// ── Persist ───────────────────────────────────────────────────────────────────

export async function saveOmniReport(opts: {
  clientId: string;
  clientName: string;
  periodFrom: string;
  periodTo: string;
  reportData: OmniReportData;
  generatedBy: string;
  configId?: string;
}): Promise<{ id: string; public_token: string }> {
  const pool = makeServerPool();
  try {
    await pool.query(`
      ALTER TABLE public.diagnostic_reports
        ADD COLUMN IF NOT EXISTS public_token TEXT DEFAULT encode(gen_random_bytes(16), 'hex'),
        ADD COLUMN IF NOT EXISTS template_slug TEXT,
        ADD COLUMN IF NOT EXISTS config_id UUID,
        ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ
    `);
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports
         (client_id, client_name, title, period_from, period_to, report_data, generated_by, config_id, template_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, public_token`,
      [
        opts.clientId,
        opts.clientName,
        `Relatório de Performance — ${opts.clientName}`,
        opts.periodFrom,
        opts.periodTo,
        JSON.stringify(opts.reportData),
        opts.generatedBy,
        opts.configId ?? null,
        'onmid-clean-performance',
      ],
    );
    return { id: rows[0].id as string, public_token: rows[0].public_token as string };
  } finally {
    await pool.end();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(a: number, b: number): string {
  if (b === 0) return '—';
  const v = ((a - b) / b) * 100;
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

function fmtMonth(isoDate: string): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}`;
}

function movingAvg(data: MonthPoint[], window = 3): MonthPoint[] {
  return data.map((d, i) => {
    if (i < window - 1) return { label: d.label, value: 0 };
    const slice = data.slice(i - window + 1, i + 1);
    const avg = Math.round(slice.reduce((s, p) => s + p.value, 0) / window);
    return { label: d.label, value: avg };
  });
}

// ── Monthly Meta Ads fetch ────────────────────────────────────────────────────

type MonthlyMeta = {
  month: string;      // "2025-06"
  label: string;      // "Jun/25"
  spend: number;
  impressions: number;
  reach: number;
  results: number;
  newContacts: number;
  purchases: number;
};

async function fetchMonthlyMeta(connectionId: string, accountIds: string[], from: string, to: string): Promise<MonthlyMeta[]> {
  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
    if (!conn) {
      const { rows: leg } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, NULL AS token_expiry FROM public.meta_integration WHERE id='global' AND status='connected' LIMIT 1`,
      );
      conn = leg[0] ?? null;
    }
  } finally {
    await pool.end();
  }
  if (!conn) return [];

  const token = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });
  const monthly = new Map<string, MonthlyMeta>();

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const url = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    url.searchParams.set('level', 'account');
    url.searchParams.set('fields', 'spend,impressions,reach,actions');
    url.searchParams.set('time_range', timeRange);
    url.searchParams.set('time_increment', 'monthly');
    url.searchParams.set('access_token', token);

    const res = await fetch(url.toString()).catch(() => null);
    if (!res?.ok) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data = [] } = await res.json() as { data?: any[] };
    for (const row of data) {
      const key = String(row.date_start ?? '').slice(0, 7); // "2025-06"
      if (!key) continue;
      const prev = monthly.get(key) ?? { month: key, label: fmtMonth(row.date_start), spend: 0, impressions: 0, reach: 0, results: 0, newContacts: 0, purchases: 0 };
      const acts = (row.actions ?? []) as { action_type: string; value: string }[];
      monthly.set(key, {
        ...prev,
        spend: prev.spend + parseFloat(row.spend || '0'),
        impressions: prev.impressions + parseInt(row.impressions || '0', 10),
        reach: prev.reach + parseInt(row.reach || '0', 10),
        results: prev.results + sumActions(acts, RESULT_ACTIONS),
        newContacts: prev.newContacts + sumActions(acts, NEW_CONTACT_ACTIONS),
        purchases: prev.purchases + sumActions(acts, PURCHASE_ACTIONS),
      });
    }
  }));

  return Array.from(monthly.values()).sort((a, b) => a.month.localeCompare(b.month));
}

// ── Monthly CRM fetch ─────────────────────────────────────────────────────────

type MonthlyCrm = {
  month: string;        // "2025-06"
  label: string;        // "Jun/25"
  registros: number;    // total leads/registrations
  novosClientes: number;// first-time buyers (pedidos = 1)
  fechados: number;     // leads com fechou=true
  faturamento: number;
};

async function fetchMonthlyCrm(clientId: string, from: string, to: string): Promise<MonthlyCrm[]> {
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
    ).catch(() => ({ rows: [] as Array<{ month: string; registros: string; fechados: string; faturamento: string }> }));

    return rows.map(r => ({
      month: r.month,
      label: fmtMonth(r.month + '-01'),
      registros: parseInt(r.registros, 10) || 0,
      novosClientes: parseInt(r.fechados, 10) || 0, // proxy: closed leads = new customers
      fechados: parseInt(r.fechados, 10) || 0,
      faturamento: parseFloat(r.faturamento) || 0,
    }));
  } finally {
    await pool.end();
  }
}

// ── Claude orchestrator ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é um estrategista sênior da ONMID e diretor de apresentação visual.
Sua função é transformar dados de marketing e vendas em relatórios visuais, estratégicos e consultivos.

REGRAS OBRIGATÓRIAS:
- Não invente dados. Use apenas os números fornecidos.
- Textos curtos. Máximo 2-3 frases por insight.
- Nunca escreva textos longos de relatório tradicional.
- Sempre que mostrar métrica, inclua interpretação estratégica.
- Use tom consultivo e direto.
- Todos os textos em português do Brasil.

Retorne APENAS JSON válido, sem markdown.`;

const USER_PROMPT_TPL = (clientName: string, data: object, manualNotes: string) => `
Cliente: ${clientName}
${manualNotes ? `Observações do analista: ${manualNotes}` : ''}

DADOS DISPONÍVEIS:
${JSON.stringify(data, null, 2)}

Gere o conteúdo das páginas do relatório. Retorne JSON com esta estrutura exata:
{
  "executiveSummary": {
    "mainStatement": "frase principal que define o período (máx 2 linhas)",
    "cards": [
      { "number": "01", "title": "Aquisição", "description": "..." },
      { "number": "02", "title": "Conversão", "description": "..." },
      { "number": "03", "title": "Performance de Mídia", "description": "..." }
    ],
    "readout": "frase de conclusão (máx 2 linhas)"
  },
  "growthInsight": "comentário curto sobre o crescimento de cadastros (1 frase)",
  "explanationCards": [
    { "title": "Novo cliente", "description": "...", "highlight": "..." },
    { "title": "Valor da base", "description": "...", "highlight": "..." },
    { "title": "Leitura correta", "description": "...", "highlight": null }
  ],
  "comparisonReadout": "leitura principal comparando os dois últimos meses (1-2 frases)",
  "comparisonInsight": "frase de destaque final em verde (máx 1 linha)",
  "reachContext": "parágrafo curto explicando impressões e alcance (2-3 frases)",
  "reachHighlightDesc": "continuação após o número de alcance (ex: 'pessoas alcançadas, foi o melhor resultado...')",
  "includePages": ["cover", "executive_summary", "growth_chart", "new_customers", "explanation_cards", "comparison_table", "cost_per_customer", "reach_impressions"]
}

Inclua apenas as páginas que fazem sentido com os dados disponíveis. Se não houver dados de mídia, remova reach_impressions e cost_per_customer da lista.`;

// ── Build ─────────────────────────────────────────────────────────────────────

export async function buildOmniReport(input: {
  clientId: string;
  clientName: string;
  connectionId?: string | null;
  accountIds?: string[];
  periodFrom: string;   // "2025-06-01"
  periodTo: string;     // "2026-04-30"
  manualNotes?: string;
  apiKey: string;
}): Promise<OmniReportData> {
  const { clientId, clientName, connectionId, accountIds, periodFrom, periodTo, manualNotes, apiKey } = input;

  // 1. Fetch monthly data
  const [monthlyMeta, monthlyCrm] = await Promise.all([
    connectionId && accountIds?.length
      ? fetchMonthlyMeta(connectionId, accountIds, periodFrom, periodTo)
      : Promise.resolve([] as MonthlyMeta[]),
    fetchMonthlyCrm(clientId, periodFrom, periodTo),
  ]);

  const hasMeta = monthlyMeta.length > 0;

  // 2. Derive chart data series
  const registrosData: MonthPoint[] = monthlyCrm.map(m => ({ label: m.label, value: m.registros }));
  const novosClientesData: MonthPoint[] = monthlyCrm.map(m => ({ label: m.label, value: m.novosClientes }));
  const impressionsData: MonthPoint[] = hasMeta ? monthlyMeta.map(m => ({ label: m.label, value: m.impressions })) : [];
  const reachData: MonthPoint[]        = hasMeta ? monthlyMeta.map(m => ({ label: m.label, value: m.reach })) : [];

  const costPerCustomerData: MonthPoint[] = hasMeta
    ? monthlyMeta.map((m, i) => {
        const nc = monthlyCrm[i]?.novosClientes ?? 0;
        return { label: m.label, value: nc > 0 ? Math.round(m.spend / nc) : 0 };
      })
    : [];

  // Moving average for growth chart
  const avgData = movingAvg(registrosData, 3);

  // Last two months comparison
  const last = monthlyCrm[monthlyCrm.length - 1];
  const prev = monthlyCrm[monthlyCrm.length - 2];

  // Growth
  const currRegistros = last?.registros ?? 0;
  const prevRegistros = prev?.registros ?? 0;
  const growthPct = pct(currRegistros, prevRegistros);

  // Peak month (reach)
  const peakReach = reachData.reduce((best, m) => m.value > best.value ? m : best, { label: '', value: 0 });

  // Summary for Claude
  const summary = {
    periodo: `${periodFrom} a ${periodTo}`,
    totalRegistros: monthlyCrm.reduce((s, m) => s + m.registros, 0),
    totalNovosClientes: monthlyCrm.reduce((s, m) => s + m.novosClientes, 0),
    ultMesLabel: last?.label,
    ultMesRegistros: last?.registros,
    prevMesLabel: prev?.label,
    prevMesRegistros: prev?.registros,
    crescimento: growthPct,
    hasMeta,
    metaTotalSpend: hasMeta ? monthlyMeta.reduce((s, m) => s + m.spend, 0).toFixed(2) : null,
    metaTotalImpressoes: hasMeta ? monthlyMeta.reduce((s, m) => s + m.impressions, 0) : null,
    metaTotalAlcance: hasMeta ? monthlyMeta.reduce((s, m) => s + m.reach, 0) : null,
    metaTotalPurchases: hasMeta ? monthlyMeta.reduce((s, m) => s + m.purchases, 0) : null,
    peakReachMes: peakReach.label,
    peakReachValor: peakReach.value,
  };

  // 3. Call Claude
  type AiOutput = {
    executiveSummary: {
      mainStatement: string;
      cards: { number: string; title: string; description: string }[];
      readout: string;
    };
    growthInsight: string;
    explanationCards: { title: string; description: string; highlight?: string | null }[];
    comparisonReadout: string;
    comparisonInsight: string;
    reachContext: string;
    reachHighlightDesc: string;
    includePages: string[];
  };

  let ai: AiOutput = {
    executiveSummary: {
      mainStatement: `${clientName} manteve crescimento consistente no período, com destaque para ${last?.label ?? 'o último mês'} que registrou ${currRegistros} cadastros.`,
      cards: [
        { number: '01', title: 'Aquisição', description: `${monthlyCrm.reduce((s, m) => s + m.registros, 0)} cadastros no período com tendência de crescimento.` },
        { number: '02', title: 'Conversão', description: `${monthlyCrm.reduce((s, m) => s + m.novosClientes, 0)} novos clientes realizaram o primeiro pedido.` },
        { number: '03', title: 'Performance de Mídia', description: hasMeta ? 'Campanhas gerando alcance, impressões e compras atribuídas.' : 'Dados de mídia não disponíveis neste período.' },
      ],
      readout: 'evolução consistente nos três principais frentes: aquisição, conversão e performance de mídia.',
    },
    growthInsight: `${last?.label} teve forte evolução na entrada de pessoas na base.`,
    explanationCards: [
      { title: 'Novo cliente', description: 'Consideramos como novo cliente todo cadastro com Qtd. de pedidos = 1. Isso indica o primeiro pedido registrado.', highlight: 'Qtd. de pedidos = 1.' },
      { title: 'Valor da base', description: 'Como não temos faturamento mensal por pedido, usamos o valor acumulado gerado por cliente.', highlight: 'Valor acumulado gerado por cliente.' },
      { title: 'Leitura correta', description: 'Não estamos analisando apenas venda imediata. Estamos analisando quantos clientes entraram, compraram, voltaram e quanto valor geraram.', highlight: null },
    ],
    comparisonReadout: `${last?.label} teve mais cadastros, mais novos clientes e menor custo por novo cliente que ${prev?.label}.`,
    comparisonInsight: 'O investimento cresceu pouco, mas os resultados cresceram mais.',
    reachContext: hasMeta
      ? 'O tráfego pago manteve o cliente presente para o público. As campanhas geraram volume constante de exposição da marca ao longo dos meses.'
      : '',
    reachHighlightDesc: `pessoas alcançadas, foi o melhor resultado do período.`,
    includePages: ['cover', 'executive_summary', 'growth_chart', 'new_customers', 'explanation_cards', 'comparison_table',
      ...(hasMeta ? ['cost_per_customer', 'reach_impressions'] : [])],
  };

  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: USER_PROMPT_TPL(clientName, summary, manualNotes ?? '') }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: { type: string; text: string }[] };
        const text = data.content?.find(c => c.type === 'text')?.text ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) ai = { ...ai, ...JSON.parse(match[0]) as AiOutput };
      }
    } catch { /* use fallback */ }
  }

  // 4. Build ranking
  const novosRanking = [...novosClientesData]
    .map((d, i) => ({ ...d, i }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((d, pos) => ({ position: pos + 1, label: d.label, value: d.value }));

  const costRanking = costPerCustomerData
    .filter(d => d.value > 0)
    .map((d, i) => ({ ...d, i }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 3)
    .map((d, pos) => ({ position: pos + 1, label: d.label, value: `R$ ${d.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }));

  // 5. Comparison table rows
  const comparisonRows = [
    { icon: '👤', label: 'Cadastros', value1: String(prev?.registros ?? 0), value2: String(last?.registros ?? 0), variation: pct(last?.registros ?? 0, prev?.registros ?? 0), positive: (last?.registros ?? 0) >= (prev?.registros ?? 0) },
    { icon: '🛒', label: 'Novos clientes', value1: String(prev?.novosClientes ?? 0), value2: String(last?.novosClientes ?? 0), variation: pct(last?.novosClientes ?? 0, prev?.novosClientes ?? 0), positive: (last?.novosClientes ?? 0) >= (prev?.novosClientes ?? 0) },
    ...(hasMeta ? (() => {
      const lMeta = monthlyMeta[monthlyMeta.length - 1];
      const pMeta = monthlyMeta[monthlyMeta.length - 2];
      const lCost = (last?.novosClientes ?? 0) > 0 && lMeta ? lMeta.spend / (last?.novosClientes ?? 1) : 0;
      const pCost = (prev?.novosClientes ?? 0) > 0 && pMeta ? pMeta.spend / (prev?.novosClientes ?? 1) : 0;
      return [
        { icon: '💲', label: 'Investimento Meta Ads', value1: pMeta ? brl(pMeta.spend) : '—', value2: lMeta ? brl(lMeta.spend) : '—', variation: pMeta && lMeta ? pct(lMeta.spend, pMeta.spend) : '—', positive: lMeta && pMeta ? lMeta.spend >= pMeta.spend : true },
        { icon: '🏷', label: 'Custo por novo cliente', value1: pCost > 0 ? brl(pCost) : '—', value2: lCost > 0 ? brl(lCost) : '—', variation: pCost > 0 && lCost > 0 ? pct(lCost, pCost) : '—', positive: lCost <= pCost },
        { icon: '🛒', label: 'Compras atribuídas Meta', value1: String(pMeta?.purchases ?? 0), value2: String(lMeta?.purchases ?? 0), variation: pMeta && lMeta ? pct(lMeta.purchases, pMeta.purchases) : '—', positive: (lMeta?.purchases ?? 0) >= (pMeta?.purchases ?? 0) },
      ];
    })() : []),
  ];

  // 6. Cost-per-customer table rows
  const costTableRows = monthlyMeta.map((m, i) => {
    const nc = monthlyCrm[i]?.novosClientes ?? 0;
    const cost = nc > 0 ? m.spend / nc : 0;
    return {
      period: m.label,
      investment: brl(m.spend),
      newCustomers: nc,
      costPerCustomer: cost > 0 ? brl(cost) : '—',
      costNum: cost,
    };
  });

  // 7. Assemble pages
  const pageSet = new Set(ai.includePages);
  const pages: ReportPage[] = [];

  if (pageSet.has('cover')) {
    pages.push({
      type: 'cover',
      title: 'Relatório de\nPerformance',
      titleHighlight: 'Performance',
      subtitle: 'Performance de Base, Aquisição e Tráfego Pago',
      clientName,
      period: `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`,
      sources: ['Base de Clientes', ...(hasMeta ? ['Relatórios Meta Ads'] : [])].join(' + '),
      objective: 'Analisar a evolução da base de clientes, aquisição de novos compradores' + (hasMeta ? ', eficiência do tráfego pago e desempenho das campanhas de mídia.' : '.'),
    });
  }

  if (pageSet.has('executive_summary')) {
    pages.push({ type: 'executive_summary', ...ai.executiveSummary });
  }

  if (pageSet.has('growth_chart') && registrosData.length > 0) {
    pages.push({
      type: 'growth_chart',
      title: 'Crescimento da base',
      titleHighlight: 'base',
      subtitle: 'Cadastros por mês',
      chartData: registrosData,
      movingAvgData: avgData,
      insight: {
        prevLabel: prev?.label ?? '',
        prevValue: prevRegistros,
        currLabel: last?.label ?? '',
        currValue: currRegistros,
        growthPct,
        comment: ai.growthInsight,
      },
    });
  }

  if (pageSet.has('new_customers') && novosClientesData.length > 0) {
    pages.push({ type: 'new_customers', chartData: novosClientesData, ranking: novosRanking });
  }

  if (pageSet.has('explanation_cards')) {
    pages.push({
      type: 'explanation_cards',
      title: 'Como lemos os\ndados',
      titleHighlight: 'dados',
      cards: ai.explanationCards.map((c, i) => ({ number: i + 1, ...c, highlight: c.highlight ?? undefined })),
    });
  }

  if (pageSet.has('comparison_table') && prev && last) {
    pages.push({
      type: 'comparison_table',
      month1: prev.label,
      month2: last.label,
      rows: comparisonRows,
      readout: ai.comparisonReadout,
      insight: ai.comparisonInsight,
    });
  }

  if (pageSet.has('cost_per_customer') && hasMeta && costTableRows.length > 0) {
    pages.push({
      type: 'cost_per_customer',
      clientName,
      barData: costPerCustomerData,
      lineData: novosClientesData,
      tableRows: costTableRows,
      ranking: costRanking,
    });
  }

  if (pageSet.has('reach_impressions') && hasMeta && impressionsData.length > 0) {
    pages.push({
      type: 'reach_impressions',
      context: ai.reachContext,
      clientName,
      impressionsData,
      reachData,
      highlightLabel: `${peakReach.label} foi o mês mais forte em alcance.`,
      highlightValue: peakReach.value,
      highlightDesc: ai.reachHighlightDesc,
    });
  }

  return {
    clientName,
    period: `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`,
    templateSlug: 'onmid-clean-performance',
    pages,
  };
}
