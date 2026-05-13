import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { google } from 'googleapis';
import type { ReportData, MonthlyData, OverallMetrics, PlatformMetrics, AiNarrative } from '@/components/report-slides/types';

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

// ─── Build AI narrative ───────────────────────────────────────────────────────

async function buildNarrative(
  clientName: string,
  period: string,
  overall: OverallMetrics,
  monthly: MonthlyData[],
  meta: PlatformMetrics,
  google: PlatformMetrics,
  apiKey: string,
): Promise<AiNarrative> {
  const prompt = `Você é um especialista em marketing digital analisando resultados para um relatório de diagnóstico de performance. Analise os dados abaixo e gere textos analíticos em português para um relatório profissional.

CLIENTE: ${clientName}
PERÍODO: ${period}

=== RESULTADO GERAL ===
Investimento: R$ ${overall.investment.toFixed(2)}
Impressões: ${overall.impressions}
Cliques: ${overall.clicks}
Leads (CRM): ${overall.leads}
CPL médio: R$ ${overall.cpl.toFixed(2)}
Reuniões agendadas: ${overall.meetingsScheduled}
Reuniões realizadas: ${overall.meetingsDone}
Ganhos: ${overall.wins}
Faturamento: R$ ${overall.revenue.toFixed(2)}
ROI: ${overall.roi.toFixed(2)}x

=== EVOLUÇÃO MENSAL ===
${monthly.map(m => `${m.month}: Investimento R$${m.investment.toFixed(2)}, Leads ${m.leads}, Reuniões ${m.meetingsScheduled}, Ganhos ${m.wins}, Faturamento R$${m.revenue.toFixed(2)}`).join('\n')}

=== META ADS ===
Investimento: R$ ${meta.investment.toFixed(2)} | Leads: ${meta.leads} | CPL: R$ ${meta.cpl.toFixed(2)}

=== GOOGLE ADS ===
Investimento: R$ ${google.investment.toFixed(2)} | Leads: ${google.leads} | CPL: R$ ${google.cpl.toFixed(2)}

Gere APENAS JSON (sem markdown) com estes campos (máximo 2-3 frases por campo, tom profissional):
{
  "overallHighlight": "insight principal sobre a operação no período",
  "funnelBottleneck": "onde está o maior gargalo no funil",
  "monthlyInsight": "análise da evolução mensal, qual mês se destacou e por quê",
  "visibilityConversionInsight": "análise da relação entre entrega de mídia e conversão comercial",
  "metaInsight": "análise do Meta Ads no período",
  "googleInsight": "análise do Google Ads no período",
  "recommendations": ["recomendação 1", "recomendação 2", "recomendação 3", "recomendação 4"]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2048, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('Claude error');
    const data = await res.json() as { content: Array<{ text: string }> };
    const text = data.content[0]?.text ?? '{}';
    return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) as AiNarrative;
  } catch {
    return {
      overallHighlight: `A operação no período ${period} apresentou ROI de ${overall.roi.toFixed(2)}x com ${overall.leads} leads gerados.`,
      funnelBottleneck: `O maior gargalo está na conversão de lead para reunião agendada (${overall.leads} leads → ${overall.meetingsScheduled} reuniões).`,
      monthlyInsight: 'A análise mensal revela variações significativas entre os meses do período.',
      visibilityConversionInsight: 'O aumento de impressões nem sempre se traduz em aumento proporcional de vendas.',
      metaInsight: `Meta Ads gerou ${meta.leads} leads com CPL de R$ ${meta.cpl.toFixed(2)}.`,
      googleInsight: `Google Ads gerou ${google.leads} leads com CPL de R$ ${google.cpl.toFixed(2)}.`,
      recommendations: [
        'Focar em qualidade de lead ao invés de volume.',
        'Revisar processo comercial na etapa de agendamento.',
        'Testar novos criativos nos canais com maior CPL.',
        'Aumentar investimento nos meses e campanhas de maior eficiência.',
      ],
    };
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

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY não configurada.' }, { status: 500 });

  const body = await req.json() as {
    clientId: string;
    clientName: string;
    dateFrom: string;
    dateTo: string;
    metaConnectionId?: string;
    metaAccountIds?: string[];
    googleConnectionId?: string;
    googleAccountId?: string;
  };

  const { clientId, clientName, dateFrom, dateTo } = body;
  if (!clientId || !dateFrom || !dateTo) {
    return Response.json({ error: 'clientId, dateFrom e dateTo são obrigatórios.' }, { status: 400 });
  }

  // Fetch data in parallel
  type MonthlyBucket = { spend: number; impressions: number; clicks: number; leads: number };
  type PlatformResult = { monthly: Record<string, MonthlyBucket>; total: PlatformMetrics };

  const [metaResult, googleResult, crmRows] = await Promise.all([
    body.metaConnectionId && body.metaAccountIds?.length
      ? fetchMetaMonthly(body.metaConnectionId, body.metaAccountIds, dateFrom, dateTo)
      : Promise.resolve<PlatformResult>({ monthly: {}, total: { name: 'Meta Ads', investment: 0, impressions: 0, clicks: 0, leads: 0, cpl: 0 } }),
    body.googleConnectionId && body.googleAccountId
      ? fetchGoogleMonthly(body.googleConnectionId, body.googleAccountId, dateFrom, dateTo)
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

  const sources = ['CRM', ...(body.metaConnectionId ? ['Meta Ads'] : []), ...(body.googleConnectionId ? ['Google Ads'] : [])];
  const period = periodLabel(dateFrom, dateTo);

  const ai = await buildNarrative(clientName, period, overall, monthly, metaResult.total as PlatformMetrics, googleResult.total as PlatformMetrics, apiKey);

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
    ai,
    createdAt: new Date().toISOString(),
  };

  const pool = makeServerPool();
  try {
    await ensureReportsTable(pool);
    const { rows: [saved] } = await pool.query(
      `INSERT INTO public.diagnostic_reports (client_id, client_name, title, period_from, period_to, report_data, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'manual')
       RETURNING id, created_at`,
      [clientId, clientName, `Diagnóstico de Performance — ${clientName} — ${period}`, dateFrom, dateTo, JSON.stringify({ ...reportData })],
    );
    reportData.id = saved.id;
    reportData.createdAt = saved.created_at;

    return Response.json({ id: saved.id });
  } finally {
    await pool.end();
  }
}
