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

const SYSTEM_PROMPT = `Você é um estrategista sênior da ONMID especializado em relatórios de performance de marketing.
Sua função é transformar dados brutos em narrativas estratégicas, consultivas e premium — no padrão dos relatórios ONMID.

IDENTIDADE DO RELATÓRIO:
- Visual clean, moderno e corporativo (fundo branco, verde ONMID, tipografia forte)
- Hierarquia executiva: o cliente precisa entender o que aconteceu, por que importa e o que fazer
- Tom consultivo, direto e estratégico — nunca técnico demais, nunca genérico
- Cada página tem uma função na narrativa: dado → interpretação → leitura estratégica → oportunidade → próximo passo

REGRAS ABSOLUTAS:
- Nunca invente dados. Use apenas os números fornecidos.
- Nunca escreva textos longos. Máximo 2-3 frases por bloco.
- Nunca use linguagem de relatório tradicional ("conforme observado", "nota-se que").
- Sempre interprete o número — não apenas repita ele.
- Quando os dados forem insuficientes, diga isso de forma estratégica, sem alarme.
- Todos os textos em português do Brasil.
- Tom: como um estrategista experiente falando diretamente com o dono do negócio.

ESTRUTURA DE CADA INSIGHT:
1. O que aconteceu (dado)
2. O que isso significa (interpretação)
3. O que indica sobre o negócio (leitura estratégica)
4. Qual a oportunidade ou risco
5. O que fazer (próximo passo, quando relevante)

QUANDO OS DADOS FOREM BAIXOS OU INSUFICIENTES:
- Não dramatize. Informe de forma objetiva.
- Ex: "Com volume reduzido no período, os dados apontam uma fase de estruturação. Os próximos meses serão determinantes para estabelecer padrões de crescimento."
- Nunca escreva "dados insuficientes" diretamente no texto do cliente.

Retorne APENAS JSON válido, sem markdown, sem explicações fora do JSON.`;

const USER_PROMPT_TPL = (clientName: string, data: object, manualNotes: string) => `
Cliente: ${clientName}
${manualNotes ? `Contexto do analista: ${manualNotes}` : ''}

DADOS DO PERÍODO:
${JSON.stringify(data, null, 2)}

Analise os dados e gere o conteúdo completo do relatório ONMID para ${clientName}.
Interprete os números — nunca os repita sem significado. Máximo 2-3 frases por bloco. Tom direto, consultivo, linguagem do dono do negócio.

Retorne APENAS o JSON abaixo. Não inclua markdown nem texto fora do JSON.

{
  "executiveSummary": {
    "mainStatement": "Frase forte que define o que o período representou para ${clientName}.",
    "cards": [
      { "number": "01", "title": "Aquisição", "description": "O que aconteceu com a entrada de clientes. Interprete." },
      { "number": "02", "title": "Conversão", "description": "Como cadastros viraram clientes. Qual padrão identificado." },
      { "number": "03", "title": "Performance de Mídia", "description": "O que as campanhas entregaram. Se hasMeta=false, fale do crescimento orgânico." }
    ],
    "readout": "Frase de conclusão que amarra os três pontos. O que o período representa."
  },
  "growthInsight": "Uma frase sobre o crescimento da base no último mês.",
  "explanationCards": [
    { "title": "Novo cliente", "description": "Como identificamos um novo cliente neste relatório.", "highlight": "Critério em verde" },
    { "title": "Valor da base", "description": "Como medimos o valor da base de clientes.", "highlight": "Métrica principal" },
    { "title": "Leitura correta", "description": "O que estamos analisando além da venda imediata.", "highlight": null }
  ],
  "comparisonReadout": "Leitura do comparativo entre os dois últimos meses.",
  "comparisonInsight": "Frase de destaque final do comparativo. Máximo 1 linha.",
  "reachContext": "2-3 frases sobre o papel das impressões e alcance para este negócio.",
  "reachHighlightDesc": "Continuação após o número do pico de alcance.",
  "diagnosis": {
    "mainStatement": "Diagnóstico central do período para ${clientName}. O que os dados revelam sobre o negócio.",
    "items": [
      { "icon": "chart", "title": "O que está funcionando", "description": "...", "accent": "positive" },
      { "icon": "filter", "title": "Principal gargalo", "description": "...", "accent": "negative" },
      { "icon": "arrow", "title": "Maior oportunidade", "description": "...", "accent": "opportunity" },
      { "icon": "refresh", "title": "O que ajustar", "description": "...", "accent": "neutral" },
      { "icon": "megaphone", "title": "Canal ou frente prioritária", "description": "...", "accent": "opportunity" },
      { "icon": "target", "title": "Próxima prioridade", "description": "...", "accent": "positive" }
    ]
  },
  "insights": [
    { "number": 1, "title": "Título do insight 1", "body": "Descrição com interpretação estratégica.", "evidence": "Base: dado concreto" },
    { "number": 2, "title": "Título do insight 2", "body": "...", "evidence": "..." },
    { "number": 3, "title": "Título do insight 3", "body": "...", "evidence": "..." },
    { "number": 4, "title": "Título do insight 4", "body": "...", "evidence": null },
    { "number": 5, "title": "Título do insight 5", "body": "...", "evidence": null }
  ],
  "recommendations": {
    "groups": [
      { "category": "Aquisição", "icon": "person", "items": ["Ação 1", "Ação 2", "Ação 3"] },
      { "category": "Conversão", "icon": "filter", "items": ["Ação 1", "Ação 2", "Ação 3"] },
      { "category": "Recompra", "icon": "refresh", "items": ["Ação 1", "Ação 2", "Ação 3"] },
      { "category": "Mídia Paga", "icon": "megaphone", "items": ["Ação 1", "Ação 2", "Ação 3"] }
    ],
    "highlight": "Recomendação principal. Uma frase clara sobre o que fazer primeiro."
  },
  "actionPlan": {
    "mainFocus": "Foco estratégico principal para o próximo mês.",
    "actions": [
      { "priority": 1, "what": "O que fazer", "metric": "Métrica para acompanhar", "urgency": "alta" },
      { "priority": 2, "what": "...", "metric": "...", "urgency": "alta" },
      { "priority": 3, "what": "...", "metric": "...", "urgency": "média" },
      { "priority": 4, "what": "...", "metric": "...", "urgency": "média" },
      { "priority": 5, "what": "...", "metric": "...", "urgency": "baixa" }
    ]
  },
  "conclusion": {
    "summary": "Resumo do desempenho geral do período.",
    "mainLearning": "Principal aprendizado estratégico deste relatório.",
    "biggestOpportunity": "Maior oportunidade identificada para ${clientName}.",
    "nextFocus": "Próximo foco estratégico recomendado."
  },
  "includePages": ["cover", "executive_summary", "growth_chart", "new_customers", "explanation_cards", "comparison_table", "cost_per_customer", "reach_impressions", "diagnosis", "insights_page", "recommendations", "action_plan", "conclusion"]
}

REGRAS DE SELEÇÃO DE PÁGINAS:
- Se hasMeta=false: remova "reach_impressions", "cost_per_customer"
- Se totalRegistros < 3: use apenas "cover", "executive_summary", "explanation_cards", "diagnosis", "insights_page", "recommendations", "action_plan", "conclusion"
- "diagnosis", "insights_page", "recommendations", "action_plan", "conclusion" SEMPRE devem estar incluídos
- Nunca inclua página de gráfico sem dados reais`;

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
  type DiagnosisItem = { icon: string; title: string; description: string; accent: 'positive' | 'negative' | 'opportunity' | 'neutral' };
  type AiOutput = {
    executiveSummary: { mainStatement: string; cards: { number: string; title: string; description: string }[]; readout: string };
    growthInsight: string;
    explanationCards: { title: string; description: string; highlight?: string | null }[];
    comparisonReadout: string;
    comparisonInsight: string;
    reachContext: string;
    reachHighlightDesc: string;
    diagnosis: { mainStatement: string; items: DiagnosisItem[] };
    insights: { number: number; title: string; body: string; evidence?: string | null }[];
    recommendations: { groups: { category: string; icon: string; items: string[] }[]; highlight: string };
    actionPlan: { mainFocus: string; actions: { priority: number; what: string; metric: string; urgency: 'alta' | 'média' | 'baixa' }[] };
    conclusion: { summary: string; mainLearning: string; biggestOpportunity: string; nextFocus: string };
    includePages: string[];
  };

  const totalRegistros = monthlyCrm.reduce((s, m) => s + m.registros, 0);
  const nextMonthLabel = (() => {
    if (!last?.label) return 'próximo mês';
    const [m, y] = last.label.split('/');
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const idx = months.indexOf(m);
    const nextIdx = (idx + 1) % 12;
    const nextYear = nextIdx === 0 ? String(parseInt(y) + 1) : y;
    return `${months[nextIdx]}/${nextYear}`;
  })();

  const AI_DEFAULTS: AiOutput = {
    executiveSummary: {
      mainStatement: `${clientName} encerrou o período com ${totalRegistros} registros na base. Os dados apontam o estágio atual e as oportunidades de crescimento.`,
      cards: [
        { number: '01', title: 'Aquisição', description: `${totalRegistros} registros no período. A análise mensal revela o ritmo de entrada na base.` },
        { number: '02', title: 'Conversão', description: `${monthlyCrm.reduce((s, m) => s + m.novosClientes, 0)} novos clientes realizaram o primeiro pedido.` },
        { number: '03', title: 'Performance de Mídia', description: hasMeta ? 'As campanhas geraram visibilidade e compras atribuídas ao longo do período.' : 'Crescimento baseado em canais orgânicos e relacionamento.' },
      ],
      readout: 'Os dados revelam o comportamento da base, padrões de aquisição e os pontos de atenção para os próximos meses.',
    },
    growthInsight: `${last?.label ?? 'O último mês'} registrou ${currRegistros} entradas — ${growthPct !== '—' ? `variação de ${growthPct} em relação ao mês anterior` : 'base de referência inicial'}.`,
    explanationCards: [
      { title: 'Novo cliente', description: 'Identificamos como novo cliente todo cadastro que gerou o primeiro pedido registrado.', highlight: 'Primeiro pedido = novo cliente' },
      { title: 'Valor da base', description: 'Usamos o valor acumulado gerado por cliente para medir o potencial financeiro da base.', highlight: 'Valor acumulado por cliente' },
      { title: 'Leitura correta', description: 'Analisamos além da venda imediata: quantos entraram, compraram, voltaram e quanto valor essa base já gerou.', highlight: null },
    ],
    comparisonReadout: prev && last
      ? `${last.label} registrou ${last.registros} cadastros e ${last.novosClientes} novos clientes frente a ${prev.registros} e ${prev.novosClientes} em ${prev.label}.`
      : 'Dados insuficientes para comparativo entre meses.',
    comparisonInsight: growthPct !== '—' ? `A base variou ${growthPct} — tendência que define o ritmo do próximo mês.` : 'Período inicial: referência para meses seguintes.',
    reachContext: hasMeta ? 'O tráfego pago garantiu presença constante da marca. Impressões e alcance representam o volume de exposição ao longo dos meses.' : '',
    reachHighlightDesc: 'pessoas alcançadas no período — o melhor resultado em visibilidade de marca.',
    diagnosis: {
      mainStatement: `${clientName} apresenta dados que indicam o estágio atual do negócio. A análise revela oportunidades claras de aquisição e conversão.`,
      items: [
        { icon: 'chart', title: 'O que está funcionando', description: totalRegistros > 0 ? 'A base tem crescimento identificável. Há entrada de novos clientes no período.' : 'Estrutura de rastreamento operacional e pronta para escalar.', accent: 'positive' },
        { icon: 'filter', title: 'Principal gargalo', description: totalRegistros < 5 ? 'Volume de dados ainda baixo para padrões definitivos. Meses seguintes são determinantes.' : 'Converter mais cadastros em clientes recorrentes é o desafio central.', accent: 'negative' },
        { icon: 'arrow', title: 'Maior oportunidade', description: hasMeta ? 'Escalar o investimento nos meses com melhor CAC pode multiplicar o resultado sem proporcionalmente aumentar custo.' : 'Ativar mídia paga com base no histórico de cadastros pode acelerar a aquisição.', accent: 'opportunity' },
        { icon: 'refresh', title: 'O que ajustar', description: 'Acompanhar a taxa de recompra e identificar clientes de uma única compra para campanhas de reativação.', accent: 'neutral' },
        { icon: 'megaphone', title: 'Canal prioritário', description: hasMeta ? 'Meta Ads segue como principal canal de aquisição — foco em criativo e segmentação.' : 'Estruturar a primeira campanha paga com base no perfil dos clientes já adquiridos.', accent: 'opportunity' },
        { icon: 'target', title: 'Próxima prioridade', description: `Em ${nextMonthLabel}: manter ou superar o volume do último mês e monitorar a taxa de conversão de cadastro para pedido.`, accent: 'positive' },
      ],
    },
    insights: [
      { number: 1, title: 'Ritmo de aquisição', body: totalRegistros > 0 ? `${totalRegistros} cadastros no período mostram o ritmo de entrada. O objetivo é manter crescimento mês a mês.` : 'Período inicial de coleta de dados. Os próximos meses definirão o padrão de crescimento.', evidence: `Base: ${totalRegistros} registros no período` },
      { number: 2, title: 'Conversão da base', body: `${monthlyCrm.reduce((s, m) => s + m.novosClientes, 0)} clientes realizaram o primeiro pedido — essa taxa define o potencial da base.`, evidence: null },
      { number: 3, title: 'Tendência recente', body: growthPct !== '—' ? `Variação de ${growthPct} no último mês indica ${growthPct.startsWith('+') ? 'aceleração' : 'queda'} que merece atenção.` : 'Com um único mês disponível, os próximos meses definirão a tendência.', evidence: last ? `${last.label}: ${last.registros} cadastros` : null },
      ...(hasMeta ? [
        { number: 4, title: 'Eficiência de mídia', body: 'O investimento em Meta Ads gerou visibilidade consistente. A relação entre spend e novos clientes define o CAC do período.', evidence: null },
        { number: 5, title: 'Oportunidade de escala', body: 'Meses com menor CAC mostram o momento ideal para aumentar investimento. Replicar essas condições é o caminho.', evidence: null },
      ] : [
        { number: 4, title: 'Potencial orgânico', body: 'Sem mídia paga ativa, o crescimento reflete o potencial orgânico da marca. Ativar tráfego pago pode multiplicar esse resultado.', evidence: null },
      ]),
    ],
    recommendations: {
      groups: [
        { category: 'Aquisição', icon: 'person', items: ['Manter ou aumentar investimento nos meses com melhor CAC', 'Testar novos públicos com base no perfil dos clientes atuais', 'Criar campanha específica para o produto ou serviço âncora'] },
        { category: 'Conversão', icon: 'filter', items: ['Reduzir o tempo entre cadastro e primeira compra', 'Ativar sequência de nutrição para novos cadastros', 'Testar oferta de entrada para converter leads mais rápido'] },
        { category: 'Recompra', icon: 'refresh', items: ['Identificar clientes com apenas uma compra e criar campanha de reativação', 'Monitorar intervalo médio entre compras para antecipar recompra', 'Criar programa de fidelidade ou benefício para cliente recorrente'] },
        { category: 'Mídia Paga', icon: 'megaphone', items: hasMeta ? ['Pausar criativos com CPC elevado e CTR baixo', 'Aumentar orçamento nos grupos de anúncio com melhor CAC', 'Testar formato de vídeo curto para produtos de maior conversão'] : ['Criar primeira campanha com orçamento de teste (R$500–1000/mês)', 'Segmentar para lookalike da base atual de clientes', 'Medir CPL e CAC desde a primeira semana para calibrar o investimento'] },
      ],
      highlight: `A maior oportunidade de ${clientName} nos próximos 30 dias está na conversão de quem já está na base mas ainda não recomprou.`,
    },
    actionPlan: {
      mainFocus: `Consolidar o crescimento em ${nextMonthLabel} e aumentar a taxa de conversão da base existente.`,
      actions: [
        { priority: 1, what: 'Revisar e pausar campanhas com CAC acima da média', metric: 'CAC médio do período', urgency: 'alta' },
        { priority: 2, what: 'Criar lista de clientes sem recompra nos últimos 60 dias e acionar via WhatsApp', metric: 'Taxa de reativação', urgency: 'alta' },
        { priority: 3, what: 'Produzir 2 novos criativos baseados nos produtos mais vendidos', metric: 'CTR e CPC dos novos criativos', urgency: 'média' },
        { priority: 4, what: 'Configurar automação de pós-compra para incentivar avaliação e indicação', metric: 'NPS e novos cadastros por indicação', urgency: 'média' },
        { priority: 5, what: 'Revisar o funil de cadastro e identificar onde há maior abandono', metric: 'Taxa de conversão cadastro → pedido', urgency: 'baixa' },
      ],
    },
    conclusion: {
      summary: `${clientName} encerrou o período com ${totalRegistros} cadastros registrados${hasMeta ? ' e presença ativa de mídia' : ''}. Os dados revelam o estágio atual e os caminhos de crescimento.`,
      mainLearning: 'O volume de dados disponível define o padrão base. Os próximos meses serão determinantes para consolidar tendências e ajustar estratégias.',
      biggestOpportunity: hasMeta ? 'Escalar o investimento nos meses com melhor relação entre spend e novos clientes pode reduzir o CAC e acelerar a base.' : 'Ativar tráfego pago com base no perfil dos clientes já adquiridos é o próximo passo de maior impacto.',
      nextFocus: `Em ${nextMonthLabel}: manter a entrada de novos cadastros, reativar quem não recomprou e monitorar a eficiência de cada canal.`,
    },
    includePages: [
      'cover', 'executive_summary',
      ...(totalRegistros >= 3 ? ['growth_chart', 'new_customers'] : []),
      'explanation_cards',
      ...(prev && last ? ['comparison_table'] : []),
      ...(hasMeta ? ['cost_per_customer', 'reach_impressions'] : []),
      'diagnosis', 'insights_page', 'recommendations', 'action_plan', 'conclusion',
    ],
  };

  let ai: AiOutput = AI_DEFAULTS;

  if (apiKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: USER_PROMPT_TPL(clientName, summary, manualNotes ?? '') }],
        }),
      });
      if (res.ok) {
        const data = await res.json() as { content?: { type: string; text: string }[] };
        const text = data.content?.find(c => c.type === 'text')?.text ?? '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as Partial<AiOutput>;
          ai = { ...AI_DEFAULTS, ...parsed };
        }
      }
    } catch { /* use defaults */ }
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
    // Build real summary metrics for the cover — only include what has data
    const coverMetrics: { label: string; value: string; accent: 'green' | 'blue' | 'dark' }[] = [];
    const totalCadastros = monthlyCrm.reduce((s, m) => s + m.registros, 0);
    if (totalCadastros > 0) {
      coverMetrics.push({ label: 'Cadastros', value: String(totalCadastros), accent: 'green' });
      if (growthPct !== '—') {
        coverMetrics.push({ label: 'Crescimento', value: growthPct, accent: 'blue' });
      }
    }
    if (hasMeta) {
      const totalSpend = monthlyMeta.reduce((s, m) => s + m.spend, 0);
      const totalNc = monthlyCrm.reduce((s, m) => s + m.novosClientes, 0);
      const avgCac = totalNc > 0 ? Math.round(totalSpend / totalNc) : 0;
      coverMetrics.push({ label: 'Investimento', value: brl(totalSpend), accent: 'dark' });
      if (avgCac > 0) coverMetrics.push({ label: 'CAC médio', value: brl(avgCac), accent: 'green' });
    }

    pages.push({
      type: 'cover',
      title: 'Relatório de\nPerformance',
      titleHighlight: 'Performance',
      subtitle: 'Performance de Base, Aquisição e Tráfego Pago',
      clientName,
      period: `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`,
      sources: ['Base de Clientes', ...(hasMeta ? ['Relatórios Meta Ads'] : [])].join(' + '),
      objective: 'Analisar a evolução da base de clientes, aquisição de novos compradores' + (hasMeta ? ', eficiência do tráfego pago e desempenho das campanhas de mídia.' : '.'),
      summaryMetrics: coverMetrics.length > 0 ? coverMetrics : undefined,
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

  // ── New pages (always present) ──────────────────────────────────────────────

  if (pageSet.has('diagnosis')) {
    pages.push({ type: 'diagnosis', ...ai.diagnosis });
  }

  if (pageSet.has('insights_page') && ai.insights.length > 0) {
    pages.push({ type: 'insights_page', insights: ai.insights.map(ins => ({ ...ins, evidence: ins.evidence ?? undefined })) });
  }

  if (pageSet.has('recommendations')) {
    pages.push({ type: 'recommendations', ...ai.recommendations });
  }

  if (pageSet.has('action_plan')) {
    pages.push({
      type: 'action_plan',
      month: nextMonthLabel,
      mainFocus: ai.actionPlan.mainFocus,
      actions: ai.actionPlan.actions,
    });
  }

  if (pageSet.has('conclusion')) {
    pages.push({ type: 'conclusion', ...ai.conclusion });
  }

  return {
    clientName,
    period: `${fmtMonth(periodFrom)} a ${fmtMonth(periodTo)}`,
    templateSlug: 'onmid-clean-performance',
    pages,
  };
}
