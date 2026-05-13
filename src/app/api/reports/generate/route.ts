import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { google } from 'googleapis';
import type { ReportData, MonthlyData, OverallMetrics, PlatformMetrics, ReportManifest, SlideSpec } from '@/components/report-slides/types';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

const META_LEAD_ACTIONS = [
  'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.lead', 'onsite_conversion.lead', 'onsite_web_lead',
  'onsite_conversion.messaging_conversation_started_7d', 'total_messaging_connection',
  'messaging_conversation_started_7d',
];

function fmt(d: Date) { return d.toISOString().split('T')[0]; }

function monthLabel(isoMonth: string): string {
  const [year, month] = isoMonth.split('-');
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${names[parseInt(month, 10) - 1]} ${year}`;
}

function periodLabel(from: string, to: string): string {
  const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const [fy, fm] = from.split('-');
  const [, tm] = to.split('-');
  const tyMatch = to.match(/^(\d{4})/);
  const ty = tyMatch?.[1] ?? fy;
  if (fm === tm && fy === ty) return `${names[parseInt(fm,10)-1]} de ${fy}`;
  return `${names[parseInt(fm,10)-1]} a ${names[parseInt(tm,10)-1]} de ${ty}`;
}

async function getFreshGoogleToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }) {
  if (conn.token_expiry && new Date(conn.token_expiry).getTime() > Date.now() + 5 * 60 * 1000) {
    return conn.access_token;
  }
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token!;
}

async function gadsSearch(customerId: string, query: string, token: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(`https://googleads.googleapis.com/v20/customers/${customerId}/googleAds:search`, {
    method: 'POST', headers, body: JSON.stringify({ query }),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

// ─── Fetch Meta monthly data ──────────────────────────────────────────────────

async function fetchMetaMonthly(
  connectionId: string,
  accountIds: string[],
  from: string,
  to: string,
): Promise<{ monthly: Record<string, { spend: number; impressions: number; clicks: number; leads: number }>; total: PlatformMetrics }> {
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
        `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = leg[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return { monthly: {}, total: { name: 'Meta Ads', investment: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 } };

  const token = await getFreshMetaToken(conn);
  const monthly: Record<string, { spend: number; impressions: number; clicks: number; leads: number }> = {};

  await Promise.allSettled(
    accountIds.map(async (accountId) => {
      const acctNode = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
      const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
      url.searchParams.set('level', 'account');
      url.searchParams.set('time_increment', 'monthly');
      url.searchParams.set('fields', 'spend,impressions,clicks,actions,date_start');
      url.searchParams.set('time_range', JSON.stringify({ since: from, until: to }));
      url.searchParams.set('access_token', token);

      const res = await fetch(url.toString());
      if (!res.ok) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data = [] } = await res.json() as { data?: any[] };

      for (const row of data) {
        const key = String(row.date_start ?? '').slice(0, 7); // YYYY-MM
        if (!key) continue;
        const spend = parseFloat(row.spend || '0');
        const impressions = parseInt(row.impressions || '0', 10);
        const clicks = parseInt(row.clicks || '0', 10);
        const leads = ((row.actions ?? []) as { action_type: string; value: string }[])
          .filter(a => META_LEAD_ACTIONS.includes(a.action_type))
          .reduce((s, a) => s + parseInt(a.value || '0', 10), 0);
        const prev = monthly[key] ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
        monthly[key] = { spend: prev.spend + spend, impressions: prev.impressions + impressions, clicks: prev.clicks + clicks, leads: prev.leads + leads };
      }
    }),
  );

  const totalSpend = Object.values(monthly).reduce((s, m) => s + m.spend, 0);
  const totalImpr = Object.values(monthly).reduce((s, m) => s + m.impressions, 0);
  const totalClicks = Object.values(monthly).reduce((s, m) => s + m.clicks, 0);
  const totalLeads = Object.values(monthly).reduce((s, m) => s + m.leads, 0);

  return {
    monthly: Object.fromEntries(Object.entries(monthly).map(([k, v]) => [k, { spend: v.spend, impressions: v.impressions, clicks: v.clicks, leads: v.leads }])),
    total: {
      name: 'Meta Ads',
      investment: totalSpend,
      impressions: totalImpr,
      clicks: totalClicks,
      leads: totalLeads,
      cpl: totalLeads > 0 ? totalSpend / totalLeads : 0,
    },
  };
}

// ─── Fetch Google monthly data ────────────────────────────────────────────────

async function fetchGoogleMonthly(
  connectionId: string,
  accountId: string,
  from: string,
  to: string,
): Promise<{ monthly: Record<string, { spend: number; impressions: number; clicks: number; leads: number }>; total: PlatformMetrics }> {
  const pool = makeServerPool();
  let conn: { access_token: string; refresh_token: string; token_expiry: string | null } | null = null;
  let loginCustomerId: string | undefined;

  try {
    const { rows } = await pool.query(`SELECT * FROM public.google_connections WHERE id = $1`, [connectionId]);
    conn = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!conn) return { monthly: {}, total: { name: 'Google Ads', investment: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 } };

  const token = await getFreshGoogleToken(conn);

  // Try to find MCC parent
  const listRes = await fetch('https://googleads.googleapis.com/v20/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN },
  }).catch(() => null);
  if (listRes?.ok) {
    const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
    for (const rn of resourceNames) {
      const cid = rn.replace('customers/', '');
      const check = await gadsSearch(cid, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', token);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = (check?.results?.[0] as any)?.customer;
      if (c?.manager) {
        const sub = await gadsSearch(cid, `SELECT customer_client.id FROM customer_client WHERE customer_client.id = ${accountId} AND customer_client.level = 1`, token, cid);
        if (sub?.results?.length) { loginCustomerId = cid; break; }
      }
    }
  }

  const data = await gadsSearch(
    accountId,
    `SELECT segments.month, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
     FROM campaign
     WHERE segments.date BETWEEN '${from}' AND '${to}'
       AND campaign.status IN ('ENABLED','PAUSED')
       AND metrics.cost_micros > 0`,
    token,
    loginCustomerId,
  );

  const monthly: Record<string, { spend: number; impressions: number; clicks: number; leads: number }> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data?.results ?? []) as any[]) {
    const key = String(row.segments?.month ?? '').slice(0, 7);
    if (!key) continue;
    const spend = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    const impressions = Number(row.metrics?.impressions ?? 0);
    const clicks = Number(row.metrics?.clicks ?? 0);
    const leads = Number(row.metrics?.conversions ?? 0);
    const prev = monthly[key] ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 };
    monthly[key] = { spend: prev.spend + spend, impressions: prev.impressions + impressions, clicks: prev.clicks + clicks, leads: prev.leads + leads };
  }

  const totalSpend = Object.values(monthly).reduce((s, m) => s + m.spend, 0);
  const totalImpr = Object.values(monthly).reduce((s, m) => s + m.impressions, 0);
  const totalClicks = Object.values(monthly).reduce((s, m) => s + m.clicks, 0);
  const totalLeads = Object.values(monthly).reduce((s, m) => s + m.leads, 0);

  return {
    monthly,
    total: { name: 'Google Ads', investment: totalSpend, impressions: totalImpr, clicks: totalClicks, leads: totalLeads, cpl: totalLeads > 0 ? totalSpend / totalLeads : 0 },
  };
}

// ─── Fetch CRM monthly data ───────────────────────────────────────────────────

async function fetchCRMMonthly(clientId: string, from: string, to: string) {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(DATE_TRUNC('month', lead_date), 'YYYY-MM') AS month,
         COUNT(*) AS leads,
         COUNT(*) FILTER (WHERE status_category IN ('meeting_scheduled','meeting_done','won')) AS meetings_scheduled,
         COUNT(*) FILTER (WHERE status_category IN ('meeting_done','won')) AS meetings_done,
         COUNT(*) FILTER (WHERE status_category = 'won') AS wins,
         COALESCE(SUM(revenue) FILTER (WHERE status_category = 'won'), 0) AS revenue
       FROM public.crm_leads
       WHERE client_id = $1
         AND lead_date BETWEEN $2 AND $3
         AND lead_date IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
      [clientId, from, to],
    );
    return rows;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01' || code === '42703') return [];
    throw e;
  } finally {
    await pool.end();
  }
}

// ─── Build AI manifest (slides) ──────────────────────────────────────────────

function brl(n: number) {
  return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function num(n: number) {
  return n.toLocaleString('pt-BR');
}
function pct(a: number, b: number) {
  if (!b) return null;
  return `${((a / b) * 100).toFixed(1).replace('.', ',')}%`;
}

async function buildManifest(
  clientName: string,
  period: string,
  overall: OverallMetrics,
  monthly: MonthlyData[],
  metaTotal: PlatformMetrics,
  googleTotal: PlatformMetrics,
  hasMeta: boolean,
  hasGoogle: boolean,
  hasCrm: boolean,
  theme: string,
  primaryLogo: string | undefined,
  clientLogo: string | undefined,
  apiKey: string,
): Promise<ReportManifest> {

  const summary = {
    cliente: clientName,
    periodo: period,
    geral: {
      investimento: brl(overall.investment),
      investimento_num: overall.investment,
      impressoes: num(overall.impressions),
      cliques: num(overall.clicks),
      leads: overall.leads,
      cpl: brl(overall.cpl),
      reunioes_agendadas: overall.meetingsScheduled,
      reunioes_realizadas: overall.meetingsDone,
      fechamentos: overall.wins,
      faturamento: brl(overall.revenue),
      faturamento_num: overall.revenue,
      roi: `${overall.roi.toFixed(2).replace('.', ',')}x`,
      taxa_lead_reuniao: pct(overall.meetingsScheduled, overall.leads),
      taxa_reuniao_fechamento: pct(overall.wins, overall.meetingsDone),
    },
    evolucao_mensal: monthly.map(m => ({
      mes: m.month,
      investimento_num: m.investment,
      investimento: brl(m.investment),
      leads: m.leads,
      reunioes: m.meetingsScheduled,
      fechamentos: m.wins,
      faturamento_num: m.revenue,
      faturamento: brl(m.revenue),
    })),
    meta_ads: hasMeta ? {
      investimento: brl(metaTotal.investment),
      investimento_num: metaTotal.investment,
      impressoes: num(metaTotal.impressions),
      cliques: num(metaTotal.clicks),
      leads: metaTotal.leads,
      cpl: brl(metaTotal.cpl),
      share: pct(metaTotal.investment, overall.investment),
    } : null,
    google_ads: hasGoogle ? {
      investimento: brl(googleTotal.investment),
      investimento_num: googleTotal.investment,
      impressoes: num(googleTotal.impressions),
      cliques: num(googleTotal.clicks),
      leads: googleTotal.leads,
      cpl: brl(googleTotal.cpl),
      share: pct(googleTotal.investment, overall.investment),
    } : null,
    crm_disponivel: hasCrm,
  };

  const prompt = `Você é um especialista sênior em marketing digital. Analise os dados abaixo e crie um relatório de performance profissional em slides.

DADOS:
${JSON.stringify(summary, null, 2)}

TIPOS DE SLIDES DISPONÍVEIS — use os mais relevantes conforme os dados:

1. cover (OBRIGATÓRIO, sempre primeiro):
{"type":"cover","clientName":"string","period":"string","headline":"string","tagline":"string opcional — frase de destaque do período"}

2. kpis (cards de métricas — máx. 4 por slide, use múltiplos slides se necessário):
{"type":"kpis","title":"string","subtitle":"string opcional","metrics":[{"label":"string","value":"string formatado","sub":"string opcional ex: vs mês anterior","accent":boolean}],"insight":"string — análise 1-2 frases"}

3. bar-chart (gráfico de barras — ótimo para evolução mensal; use _num como value):
{"type":"bar-chart","title":"string","subtitle":"string opcional","data":[{"label":"string","value":number}],"valuePrefix":"string ex: R$ ","valueSuffix":"string ex: leads","insight":"string"}

4. funnel (funil de conversão — use APENAS se crm_disponivel e leads > 0):
{"type":"funnel","title":"string","stages":[{"label":"string","value":number,"rate":"string ex: 100% ou 37%"}],"insight":"string"}

5. channels (comparação de canais — use se tiver 2 canais com dados):
{"type":"channels","title":"string","channels":[{"name":"string","color":"string hex opcional","metrics":[{"label":"string","value":"string","accent":boolean}],"insight":"string opcional"}]}

6. insight (slide de análise textual — para destaques importantes):
{"type":"insight","headline":"string — frase de impacto curta","body":"string — parágrafo analítico","supporting":[{"label":"string","value":"string","accent":boolean}]}

7. recommendations (OBRIGATÓRIO, sempre último):
{"type":"recommendations","title":"string","items":[{"title":"string","description":"string — 1-2 frases"}]}

REGRAS:
- Total de slides: entre 8 e 20
- Omita completamente slides para dados que sejam nulos ou todos zero
- Se meta_ads for null → sem slides de Meta Ads
- Se google_ads for null → sem slides de Google Ads
- Se crm_disponivel for false → sem funil de CRM
- Nos campos "value" de bar-chart.data → use o campo _num (número puro), não a string formatada
- Nos cards de kpis, MetricCard.value → string formatada (ex: "R$ 45.200" ou "1.254")
- Texto em português brasileiro, tom profissional e direto
- Seja analítico: aponte tendências, gargalos e oportunidades reais

Retorne APENAS o array JSON, sem markdown, sem texto adicional:`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude error ${res.status}`);
    const raw = await res.json() as { content: Array<{ text: string }> };
    const text = (raw.content[0]?.text ?? '[]').replace(/```json\n?|\n?```/g, '').trim();
    const slides = JSON.parse(text) as SlideSpec[];
    return { slides, theme, primaryLogo, clientLogo };
  } catch {
    // Minimal fallback manifest
    const slides: SlideSpec[] = [
      { type: 'cover', clientName, period, headline: 'Diagnóstico de Performance', tagline: `Relatório gerado automaticamente` },
      {
        type: 'kpis',
        title: 'Resultado Geral',
        metrics: [
          { label: 'Investimento Total', value: brl(overall.investment) },
          { label: 'Leads', value: num(overall.leads) },
          { label: 'CPL Médio', value: brl(overall.cpl) },
          { label: 'ROI', value: `${overall.roi.toFixed(2).replace('.', ',')}x`, accent: overall.roi >= 1 },
        ],
        insight: `No período ${period}, foram gerados ${num(overall.leads)} leads com CPL de ${brl(overall.cpl)}.`,
      },
      {
        type: 'recommendations',
        title: 'Próximos Passos',
        items: [
          { title: 'Otimizar CPL', description: 'Revisar criativos e segmentações com maior custo por lead.' },
          { title: 'Processo comercial', description: 'Analisar taxa de conversão em cada etapa do funil.' },
          { title: 'Mix de canais', description: 'Avaliar distribuição de investimento entre canais.' },
          { title: 'Testes A/B', description: 'Implementar testes sistemáticos de criativos e landing pages.' },
        ],
      },
    ];
    return { slides, theme, primaryLogo, clientLogo };
  }
}

// ─── Ensure reports table ─────────────────────────────────────────────────────

async function ensureReportsTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.diagnostic_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      client_name TEXT,
      title TEXT,
      period_from DATE,
      period_to DATE,
      report_data JSONB,
      generated_by TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ─── Main POST handler ────────────────────────────────────────────────────────

async function resolveClientLinks(clientId: string) {
  const pool = makeServerPool();
  try {
    const [links, legacyLinks, legacyIntegration] = await Promise.all([
      pool.query('SELECT platform, connection_id, account_id FROM public.client_account_links WHERE client_id = $1', [clientId])
        .then(r => r.rows as { platform: string; connection_id: string; account_id: string }[])
        .catch(() => [] as { platform: string; connection_id: string; account_id: string }[]),
      pool.query('SELECT account_ids FROM public.meta_ads_connections WHERE client_id = $1', [clientId])
        .then(r => r.rows as { account_ids: string[] }[])
        .catch(() => [] as { account_ids: string[] }[]),
      pool.query("SELECT access_token FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1")
        .then(r => r.rows as { access_token: string }[])
        .catch(() => [] as { access_token: string }[]),
    ]);

    const hasMeta = links.some(l => l.platform === 'meta_ads');
    if (!hasMeta && legacyIntegration[0]) {
      for (const ll of legacyLinks) {
        for (const accountId of ll.account_ids ?? []) {
          links.push({ platform: 'meta_ads', connection_id: 'legacy-meta-global', account_id: accountId });
        }
      }
    }
    return links;
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

  const body = await req.json() as {
    clientId: string;
    clientName: string;
    dateFrom: string;
    dateTo: string;
    generatedBy?: string;
    theme?: string;
    primaryLogo?: string;
    clientLogo?: string;
  };

  const { clientId, clientName, dateFrom, dateTo } = body;
  if (!clientId || !dateFrom || !dateTo) {
    return Response.json({ error: 'clientId, dateFrom e dateTo são obrigatórios.' }, { status: 400 });
  }

  // Auto-discover connections from client_account_links
  const resolvedLinks = await resolveClientLinks(clientId);
  const metaLinks = resolvedLinks.filter(l => l.platform === 'meta_ads');
  const gadsLinks = resolvedLinks.filter(l => l.platform === 'google_ads');
  const metaConnectionId = metaLinks[0]?.connection_id;
  const metaAccountIds = metaLinks.map(l => l.account_id);
  const googleConnectionId = gadsLinks[0]?.connection_id;
  const googleAccountId = gadsLinks[0]?.account_id;

  // Fetch data in parallel
  type MonthlyBucket = { spend: number; impressions: number; clicks: number; leads: number };
  type PlatformResult = { monthly: Record<string, MonthlyBucket>; total: PlatformMetrics };

  const [metaResult, googleResult, crmRows] = await Promise.all([
    metaConnectionId && metaAccountIds.length
      ? fetchMetaMonthly(metaConnectionId, metaAccountIds, dateFrom, dateTo)
      : Promise.resolve<PlatformResult>({ monthly: {}, total: { name: 'Meta Ads', investment: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 } }),
    googleConnectionId && googleAccountId
      ? fetchGoogleMonthly(googleConnectionId, googleAccountId, dateFrom, dateTo)
      : Promise.resolve<PlatformResult>({ monthly: {}, total: { name: 'Google Ads', investment: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 } }),
    fetchCRMMonthly(clientId, dateFrom, dateTo),
  ] as const);

  // Build month list from the period
  const months: string[] = [];
  const cursor = new Date(dateFrom + 'T00:00:00Z');
  const end = new Date(dateTo + 'T00:00:00Z');
  while (cursor <= end) {
    months.push(fmt(cursor).slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Build monthly data combining all sources
  const crmByMonth = Object.fromEntries(
    crmRows.map((r) => [r.month as string, r]),
  );

  const empty: MonthlyBucket = { spend: 0, impressions: 0, clicks: 0, leads: 0 };
  const monthly: MonthlyData[] = months.map((monthKey) => {
    const crm = crmByMonth[monthKey];
    const metaM = (metaResult.monthly as Record<string, MonthlyBucket>)[monthKey] ?? empty;
    const googleM = (googleResult.monthly as Record<string, MonthlyBucket>)[monthKey] ?? empty;
    const label = monthLabel(monthKey);
    const [yearStr, monthStr] = monthKey.split('-');

    return {
      month: label.split(' ')[0],
      year: parseInt(yearStr, 10),
      investment: metaM.spend + googleM.spend,
      impressions: metaM.impressions + googleM.impressions,
      clicks: metaM.clicks + googleM.clicks,
      leads: crm ? parseInt(crm.leads, 10) : 0,
      meetingsScheduled: crm ? parseInt(crm.meetings_scheduled, 10) : 0,
      meetingsDone: crm ? parseInt(crm.meetings_done, 10) : 0,
      wins: crm ? parseInt(crm.wins, 10) : 0,
      revenue: crm ? parseFloat(crm.revenue) : 0,
    };
    void monthStr;
  });

  const totalInvestment = monthly.reduce((s, m) => s + m.investment, 0);
  const totalImpressions = monthly.reduce((s, m) => s + m.impressions, 0);
  const totalClicks = monthly.reduce((s, m) => s + m.clicks, 0);
  const totalLeads = monthly.reduce((s, m) => s + m.leads, 0);
  const totalMeetSched = monthly.reduce((s, m) => s + m.meetingsScheduled, 0);
  const totalMeetDone = monthly.reduce((s, m) => s + m.meetingsDone, 0);
  const totalWins = monthly.reduce((s, m) => s + m.wins, 0);
  const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0);

  const overall: OverallMetrics = {
    investment: totalInvestment,
    impressions: totalImpressions,
    clicks: totalClicks,
    leads: totalLeads,
    cpl: totalLeads > 0 ? totalInvestment / totalLeads : 0,
    meetingsScheduled: totalMeetSched,
    meetingsDone: totalMeetDone,
    wins: totalWins,
    revenue: totalRevenue,
    roi: totalInvestment > 0 ? totalRevenue / totalInvestment : 0,
  };

  const sources = ['CRM', ...(metaConnectionId ? ['Meta Ads'] : []), ...(googleConnectionId ? ['Google Ads'] : [])];
  const period = periodLabel(dateFrom, dateTo);
  const hasCrm = crmRows.length > 0;

  const manifest = await buildManifest(
    clientName,
    period,
    overall,
    monthly,
    metaResult.total as PlatformMetrics,
    googleResult.total as PlatformMetrics,
    !!(metaConnectionId && metaAccountIds.length),
    !!(googleConnectionId && googleAccountId),
    hasCrm,
    body.theme ?? '#1A0A2E',
    body.primaryLogo,
    body.clientLogo,
    apiKey,
  );

  const reportData: ReportData = {
    id: '',
    clientId,
    clientName,
    periodLabel: period,
    periodFrom: dateFrom,
    periodTo: dateTo,
    sources,
    monthly,
    overall,
    meta: metaResult.total as PlatformMetrics,
    google: googleResult.total as PlatformMetrics,
    ai: {} as never,
    createdAt: new Date().toISOString(),
    manifest,
  };

  const pool = makeServerPool();
  try {
    await ensureReportsTable(pool);
    const { rows: [saved] } = await pool.query(
      `INSERT INTO public.diagnostic_reports (client_id, client_name, title, period_from, period_to, report_data, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [clientId, clientName, `Diagnóstico de Performance — ${clientName} — ${period}`, dateFrom, dateTo, JSON.stringify({ ...reportData }), body.generatedBy ?? 'manual'],
    );
    reportData.id = saved.id;
    reportData.createdAt = saved.created_at;

    return Response.json({ id: saved.id });
  } finally {
    await pool.end();
  }
}
