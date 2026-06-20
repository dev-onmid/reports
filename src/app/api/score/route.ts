import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { google as googleapis } from 'googleapis';
import { getFreshMetaToken } from '@/lib/meta-token';
import { resolveMetaPeriod, resolveGaqlPeriod, applyMetaDateToUrl } from '@/lib/period-utils';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_scores (
      client_id   TEXT        PRIMARY KEY,
      score       INTEGER     NOT NULL DEFAULT 0,
      grade       TEXT        NOT NULL DEFAULT 'C',
      details     JSONB       NOT NULL DEFAULT '{}',
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function calcGrade(score: number): string {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function scoreMoM(current: number, previous: number, maxPts: number, lowerIsBetter = false): number {
  if (previous === 0 || current === 0) return Math.round(maxPts * 0.6); // neutral
  const delta = (current - previous) / previous;
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const change = lowerIsBetter ? -delta : delta;
  if (change >= 0.10) return maxPts;
  if (change >= 0)    return Math.round(maxPts * 0.85);
  if (change >= -0.20) return Math.round(maxPts * 0.55);
  if (change >= -0.40) return Math.round(maxPts * 0.25);
  return Math.round(maxPts * 0.05);
  void improved;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ── Meta data fetcher ─────────────────────────────────────────────────────────

type CampaignRow = { spend: number; leads: number; clicks: number; impressions: number; frequency: number };

type MetaData = {
  campaigns: CampaignRow[];
  adAges: number[];
  formats: string[];        // 'VIDEO' | 'IMAGE' | 'CAROUSEL'
  weeklySpends: number[];   // one entry per week in the month
  budgetPaused: number;     // count of campaigns paused due to budget
};

const META_LEAD_ACTIONS = [
  'lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead',
  'messaging_conversation_started_7d', 'onsite_web_lead',
];

async function fetchMetaData(
  pool: ReturnType<typeof makeServerPool>,
  clientId: string,
  period: 'this_month' | 'last_month',
): Promise<MetaData> {
  const metaPeriod = resolveMetaPeriod(period);
  const { rows: links } = await pool.query(
    `SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta_ads'`,
    [clientId]
  );
  if (links.length === 0) return { campaigns: [], adAges: [], formats: [], weeklySpends: [], budgetPaused: 0 };

  const connectionIds = [...new Set(links.map((l: { connection_id: string }) => l.connection_id).filter(Boolean))];
  const campaigns: CampaignRow[] = [];
  const adAges: number[] = [];
  const formats: string[] = [];
  const weeklySpends: number[] = [];
  let budgetPaused = 0;

  await Promise.allSettled(connectionIds.map(async (connId) => {
    const { rows: conns } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1', [connId]);
    if (!conns[0]) return;
    const token = await getFreshMetaToken(conns[0]);
    const accountLinks = links.filter((l: { connection_id: string; account_id: string }) => l.connection_id === connId);

    await Promise.allSettled(accountLinks.map(async (link: { account_id: string }) => {
      const acctNode = link.account_id.startsWith('act_') ? link.account_id : `act_${link.account_id}`;

      // ── 1. Campaign-level insights with frequency ──────────────────────────
      const insUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
      insUrl.searchParams.set('level', 'campaign');
      insUrl.searchParams.set('fields', 'spend,impressions,clicks,actions,frequency');
      applyMetaDateToUrl(insUrl, metaPeriod);
      insUrl.searchParams.set('limit', '50');
      insUrl.searchParams.set('access_token', token);

      const insRes = await fetch(insUrl.toString());
      if (insRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = await insRes.json() as { data?: any[] };
        for (const row of d.data ?? []) {
          const leads = ((row.actions ?? []) as { action_type: string; value: string }[])
            .filter(a => META_LEAD_ACTIONS.includes(a.action_type))
            .reduce((s: number, a: { value: string }) => s + parseInt(a.value || '0', 10), 0);
          campaigns.push({
            spend: parseFloat(row.spend || '0'),
            leads,
            clicks: parseInt(row.clicks || '0', 10),
            impressions: parseInt(row.impressions || '0', 10),
            frequency: parseFloat(row.frequency || '0'),
          });
        }
      }

      // ── 2. Weekly consistency (time_increment=7) ───────────────────────────
      if (period === 'this_month') {
        const weekUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
        weekUrl.searchParams.set('level', 'account');
        weekUrl.searchParams.set('fields', 'spend');
        weekUrl.searchParams.set('time_increment', '7');
        applyMetaDateToUrl(weekUrl, metaPeriod);
        weekUrl.searchParams.set('access_token', token);

        const weekRes = await fetch(weekUrl.toString());
        if (weekRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const wd = await weekRes.json() as { data?: any[] };
          for (const row of wd.data ?? []) weeklySpends.push(parseFloat(row.spend || '0'));
        }

        // ── 3. Active ads: age + format + budget pauses ────────────────────
        const adsUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/ads`);
        adsUrl.searchParams.set('fields', 'id,effective_status,created_time,creative{object_type,video_id}');
        adsUrl.searchParams.set('effective_status', JSON.stringify(['ACTIVE']));
        adsUrl.searchParams.set('limit', '100');
        adsUrl.searchParams.set('access_token', token);

        const adsRes = await fetch(adsUrl.toString());
        if (adsRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const adsData = await adsRes.json() as { data?: any[] };
          const now = Date.now();
          for (const ad of adsData.data ?? []) {
            if (ad.created_time) {
              adAges.push((now - new Date(ad.created_time as string).getTime()) / (1000 * 60 * 60 * 24));
            }
            const creative = ad.creative ?? {};
            if (creative.video_id) formats.push('VIDEO');
            else if (creative.object_type === 'LINK') formats.push('IMAGE');
            else if (creative.object_type === 'IMAGE') formats.push('IMAGE');
            else formats.push('CAROUSEL');
          }
        }

        // ── 4. Campaign delivery status — detect budget pauses ─────────────
        const campUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/campaigns`);
        campUrl.searchParams.set('fields', 'id,delivery_info');
        campUrl.searchParams.set('limit', '100');
        campUrl.searchParams.set('access_token', token);

        const campRes = await fetch(campUrl.toString());
        if (campRes.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const campData = await campRes.json() as { data?: any[] };
          for (const c of campData.data ?? []) {
            const status = String(c.delivery_info?.status ?? '').toLowerCase();
            if (status.includes('budget') || status.includes('billing') || status.includes('payment')) {
              budgetPaused++;
            }
          }
        }
      }
    }));
  }));

  return { campaigns, adAges, formats, weeklySpends, budgetPaused };
}

// ── Google data fetcher ───────────────────────────────────────────────────────

type GoogleRow = { spend: number; leads: number; clicks: number; impressions: number };

async function fetchGoogleData(
  pool: ReturnType<typeof makeServerPool>,
  clientId: string,
  period: 'this_month' | 'last_month',
): Promise<GoogleRow[]> {
  const gaqlPeriod = resolveGaqlPeriod(period);
  const { rows: links } = await pool.query(
    `SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'google_ads'`,
    [clientId]
  );
  if (links.length === 0) return [];
  const { rows: conns } = await pool.query(`SELECT * FROM public.google_connections WHERE status = 'connected'`);
  if (conns.length === 0) return [];

  const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  const campaigns: GoogleRow[] = [];

  await Promise.allSettled(conns.map(async (conn) => {
    const oauth2 = new googleapis.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: conn.refresh_token });
    let accessToken = conn.access_token;
    try {
      if (!conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 5 * 60 * 1000) {
        const { credentials } = await oauth2.refreshAccessToken();
        accessToken = credentials.access_token ?? accessToken;
      }
    } catch { /* use existing */ }

    await Promise.allSettled(links.map(async (link: { account_id: string }) => {
      const accountId = link.account_id.replace(/\D/g, '');
      const res = await fetch(`https://googleads.googleapis.com/v24/customers/${accountId}/googleAds:search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `SELECT metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions
                  FROM campaign WHERE ${gaqlPeriod} AND campaign.status IN ('ENABLED','PAUSED') AND metrics.cost_micros > 0`,
        }),
      });
      if (!res.ok) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as { results?: any[] };
      for (const row of data.results ?? []) {
        const m = row.metrics ?? {};
        campaigns.push({
          spend: Number(m.costMicros ?? 0) / 1_000_000,
          leads: Number(m.conversions ?? 0),
          clicks: Number(m.clicks ?? 0),
          impressions: Number(m.impressions ?? 0),
        });
      }
    }));
  }));
  return campaigns;
}

// ── System data (CRM + reports) ───────────────────────────────────────────────

async function fetchSystemData(pool: ReturnType<typeof makeServerPool>, clientId: string, clientName: string) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [crmRes, reportsRes] = await Promise.allSettled([
    pool.query(
      `SELECT status FROM public.crm_leads WHERE client_id = $1 AND created_at >= $2`,
      [clientId, monthStart]
    ),
    pool.query(
      `SELECT COUNT(*) as cnt FROM public.agent_report_files
       WHERE client_name ILIKE $1 AND created_at >= $2`,
      [clientName, monthStart]
    ),
  ]);

  const crmLeads = crmRes.status === 'fulfilled' ? crmRes.value.rows : [];
  const totalLeads = crmLeads.length;
  const advancedLeads = crmLeads.filter((l: { status: string }) => {
    const s = String(l.status ?? '').toLowerCase();
    return s.includes('meeting') || s.includes('won') || s.includes('reuniao') || s.includes('fechamento');
  }).length;
  const crmConversionRate = totalLeads > 0 ? advancedLeads / totalLeads : null;
  const reportsCount = reportsRes.status === 'fulfilled' ? parseInt(reportsRes.value.rows[0]?.cnt ?? '0') : 0;

  return { crmConversionRate, totalLeads, advancedLeads, reportsCount };
}

// ── Main score calculator ─────────────────────────────────────────────────────

async function calcClientScore(pool: ReturnType<typeof makeServerPool>, clientId: string, clientName: string) {
  const [metaCurr, metaPrev, googleCurr, googlePrev, system] = await Promise.all([
    fetchMetaData(pool, clientId, 'this_month'),
    fetchMetaData(pool, clientId, 'last_month'),
    fetchGoogleData(pool, clientId, 'this_month'),
    fetchGoogleData(pool, clientId, 'last_month'),
    fetchSystemData(pool, clientId, clientName),
  ]);

  type AnyRow = { spend: number; leads: number; clicks: number; impressions: number };
  function sum(arr: AnyRow[], field: keyof AnyRow) { return arr.reduce((s, c) => s + c[field], 0); }

  const currSpend  = sum([...metaCurr.campaigns, ...googleCurr], 'spend');
  const currLeads  = sum([...metaCurr.campaigns, ...googleCurr], 'leads');
  const currClicks = sum([...metaCurr.campaigns, ...googleCurr], 'clicks');
  const currImpr   = sum([...metaCurr.campaigns, ...googleCurr], 'impressions');

  const prevSpend  = sum([...metaPrev.campaigns, ...googlePrev], 'spend');
  const prevLeads  = sum([...metaPrev.campaigns, ...googlePrev], 'leads');
  const prevClicks = sum([...metaPrev.campaigns, ...googlePrev], 'clicks');
  const prevImpr   = sum([...metaPrev.campaigns, ...googlePrev], 'impressions');

  const currCpl = currLeads > 0 ? currSpend / currLeads : 0;
  const prevCpl = prevLeads > 0 ? prevSpend / prevLeads : 0;
  const currCtr = currImpr  > 0 ? currClicks / currImpr * 100 : 0;
  const prevCtr = prevImpr  > 0 ? prevClicks / prevImpr * 100 : 0;
  const currConvRate = currClicks > 0 ? currLeads / currClicks * 100 : 0;
  const prevConvRate = prevClicks > 0 ? prevLeads / prevClicks * 100 : 0;

  // ── 1. CPL (20 pts) ─ lower is better ────────────────────────────────────
  const cplScore = scoreMoM(currCpl, prevCpl, 20, true);

  // ── 2. Volume de leads (15 pts) ───────────────────────────────────────────
  const leadScore = scoreMoM(currLeads, prevLeads, 15, false);

  // ── 3. CTR trend (10 pts) ─────────────────────────────────────────────────
  const ctrScore = scoreMoM(currCtr, prevCtr, 10, false);

  // ── 4. Frequência dos anúncios (10 pts) ── Meta only ──────────────────────
  let freqScore = 7; // neutral if no data
  const allFreqs = metaCurr.campaigns.map(c => c.frequency).filter(f => f > 0);
  if (allFreqs.length > 0) {
    const avgFreq = allFreqs.reduce((s, f) => s + f, 0) / allFreqs.length;
    if (avgFreq <= 2.0)  freqScore = 10;
    else if (avgFreq <= 3.0) freqScore = 8;
    else if (avgFreq <= 4.0) freqScore = 5;
    else if (avgFreq <= 5.5) freqScore = 2;
    else freqScore = 0;
  }

  // ── 5. Quantidade de criativos ativos (8 pts) ─────────────────────────────
  let creativeCountScore = 4; // neutral
  const activeAds = metaCurr.adAges.length;
  if (activeAds >= 6)  creativeCountScore = 8;
  else if (activeAds >= 4) creativeCountScore = 6;
  else if (activeAds >= 2) creativeCountScore = 4;
  else if (activeAds === 1) creativeCountScore = 2;
  else if (activeAds === 0 && metaCurr.campaigns.length > 0) creativeCountScore = 0;

  // ── 6. Idade dos criativos (8 pts) ────────────────────────────────────────
  let ageScore = 5; // neutral if no data
  if (metaCurr.adAges.length > 0) {
    const avgAge   = metaCurr.adAges.reduce((s, a) => s + a, 0) / metaCurr.adAges.length;
    const stale    = metaCurr.adAges.filter(a => a > 45).length;
    const staleRatio = stale / metaCurr.adAges.length;
    if (avgAge < 20 && staleRatio === 0)   ageScore = 8;
    else if (avgAge < 30 && staleRatio < 0.2) ageScore = 6;
    else if (avgAge < 45 && staleRatio < 0.4) ageScore = 4;
    else if (staleRatio < 0.6)             ageScore = 2;
    else ageScore = 0;
  }

  // ── 7. Diversidade de formatos (7 pts) ────────────────────────────────────
  let formatScore = 4; // neutral
  const uniqueFormats = new Set(metaCurr.formats).size;
  if (uniqueFormats >= 3)     formatScore = 7;
  else if (uniqueFormats === 2) formatScore = 5;
  else if (uniqueFormats === 1) formatScore = 2;
  else if (metaCurr.campaigns.length > 0) formatScore = 0;

  // ── 8. Consistência semanal do gasto (7 pts) ─────────────────────────────
  let consistencyScore = 4; // neutral
  if (metaCurr.weeklySpends.length >= 2) {
    const cv = coefficientOfVariation(metaCurr.weeklySpends);
    if (cv <= 0.15)      consistencyScore = 7;
    else if (cv <= 0.30) consistencyScore = 5;
    else if (cv <= 0.50) consistencyScore = 3;
    else                 consistencyScore = 1;
  }

  // ── 9. Campanhas pausadas por saldo (5 pts — penalidade) ─────────────────
  let budgetScore = 5; // full points = no pauses
  if (metaCurr.budgetPaused > 0) {
    budgetScore = metaCurr.budgetPaused === 1 ? 3 : metaCurr.budgetPaused <= 3 ? 1 : 0;
  }

  // ── 10. Conversão lead → reunião CRM (5 pts) ─────────────────────────────
  let crmScore = 3; // neutral if no CRM data
  if (system.crmConversionRate !== null) {
    const r = system.crmConversionRate;
    if (r >= 0.30)      crmScore = 5;
    else if (r >= 0.20) crmScore = 4;
    else if (r >= 0.10) crmScore = 3;
    else if (r >= 0.05) crmScore = 2;
    else crmScore = 1;
  }

  // ── 11. Relatórios entregues no mês (5 pts) ──────────────────────────────
  let reportScore = 0;
  if (system.reportsCount >= 3)     reportScore = 5;
  else if (system.reportsCount >= 2) reportScore = 4;
  else if (system.reportsCount === 1) reportScore = 2;

  // ── Total ─────────────────────────────────────────────────────────────────
  const score = Math.min(100,
    cplScore + leadScore + ctrScore + freqScore +
    creativeCountScore + ageScore + formatScore +
    consistencyScore + budgetScore + crmScore + reportScore
  );
  const grade = calcGrade(score);

  const avgAge  = metaCurr.adAges.length > 0 ? Math.round(metaCurr.adAges.reduce((s, a) => s + a, 0) / metaCurr.adAges.length) : 0;
  const avgFreq = metaCurr.campaigns.length > 0 ? Math.round((metaCurr.campaigns.reduce((s, c) => s + c.frequency, 0) / metaCurr.campaigns.length) * 10) / 10 : 0;
  const cv      = metaCurr.weeklySpends.length >= 2 ? Math.round(coefficientOfVariation(metaCurr.weeklySpends) * 100) : null;

  const details = {
    cpl:            { score: cplScore,           max: 20, current: Math.round(currCpl * 100) / 100, previous: Math.round(prevCpl * 100) / 100 },
    leads:          { score: leadScore,          max: 15, current: currLeads, previous: prevLeads },
    ctr:            { score: ctrScore,           max: 10, current: Math.round(currCtr * 100) / 100, previous: Math.round(prevCtr * 100) / 100 },
    frequency:      { score: freqScore,          max: 10, avg: avgFreq, count: allFreqs.length },
    creativeCount:  { score: creativeCountScore, max: 8,  count: activeAds },
    creativeAge:    { score: ageScore,           max: 8,  avgAge, stale: metaCurr.adAges.filter(a => a > 45).length },
    formatDiversity:{ score: formatScore,        max: 7,  formats: [...new Set(metaCurr.formats)], unique: uniqueFormats },
    consistency:    { score: consistencyScore,   max: 7,  cv, weeklySpends: metaCurr.weeklySpends },
    budgetPaused:   { score: budgetScore,        max: 5,  count: metaCurr.budgetPaused },
    crmConversion:  { score: crmScore,           max: 5,  rate: system.crmConversionRate !== null ? Math.round(system.crmConversionRate * 1000) / 10 : null, total: system.totalLeads, advanced: system.advancedLeads },
    reports:        { score: reportScore,        max: 5,  count: system.reportsCount },
    spend:          { current: Math.round(currSpend * 100) / 100, previous: Math.round(prevSpend * 100) / 100 },
    convRate:       { current: Math.round(currConvRate * 100) / 100, previous: Math.round(prevConvRate * 100) / 100 },
  };

  return { score, grade, details };
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const clientId   = req.nextUrl.searchParams.get('clientId');
  const recalc     = req.nextUrl.searchParams.get('recalc') === 'true';

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    if (clientId) {
      if (!recalc) {
        const { rows } = await pool.query('SELECT * FROM public.client_scores WHERE client_id = $1', [clientId]);
        if (rows[0]) return Response.json(rows[0]);
      }
      const { rows: clientRows } = await pool.query('SELECT name FROM public.clients WHERE id = $1', [clientId]);
      const clientName = clientRows[0]?.name ?? '';
      const result = await calcClientScore(pool, clientId, clientName);
      await pool.query(
        `INSERT INTO public.client_scores (client_id, score, grade, details, calculated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (client_id) DO UPDATE SET score=$2, grade=$3, details=$4, calculated_at=NOW()`,
        [clientId, result.score, result.grade, JSON.stringify(result.details)]
      );
      return Response.json({ client_id: clientId, ...result, calculated_at: new Date().toISOString() });
    }

    // All clients — return cached scores + client info
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.segment, c.gestor_id, u.name as gestor_name,
             s.score, s.grade, s.details, s.calculated_at
      FROM public.clients c
      LEFT JOIN public.client_scores s ON s.client_id = c.id
      LEFT JOIN public.users u ON c.gestor_id = u.id
      WHERE c.status = 'Ativo'
      ORDER BY s.score DESC NULLS LAST, c.name ASC
    `);
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
