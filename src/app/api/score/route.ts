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

async function calcClientScore(pool: ReturnType<typeof makeServerPool>, clientId: string) {
  const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
  const META_LEAD_ACTIONS = ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','messaging_conversation_started_7d'];

  type CampaignMetrics = { spend: number; leads: number; clicks: number; impressions: number };
  type PeriodData = { campaigns: CampaignMetrics[]; adAges: number[] };

  async function fetchMetaData(period: 'this_month' | 'last_month'): Promise<PeriodData> {
    const metaPeriod = resolveMetaPeriod(period);
    const { rows: links } = await pool.query(
      `SELECT connection_id, account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'meta_ads'`,
      [clientId]
    );
    if (links.length === 0) return { campaigns: [], adAges: [] };

    const connectionIds = [...new Set(links.map((l: { connection_id: string }) => l.connection_id).filter(Boolean))];
    const campaigns: CampaignMetrics[] = [];
    const adAges: number[] = [];

    await Promise.allSettled(connectionIds.map(async (connId) => {
      const { rows: conns } = await pool.query('SELECT * FROM public.meta_connections WHERE id = $1', [connId]);
      if (!conns[0]) return;
      const token = await getFreshMetaToken(conns[0]);
      const accountLinks = links.filter((l: { connection_id: string; account_id: string }) => l.connection_id === connId);

      await Promise.allSettled(accountLinks.map(async (link: { account_id: string }) => {
        const acctNode = link.account_id.startsWith('act_') ? link.account_id : `act_${link.account_id}`;

        // Insights
        const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/insights`);
        url.searchParams.set('level', 'account');
        url.searchParams.set('fields', 'spend,impressions,clicks,actions');
        applyMetaDateToUrl(url, metaPeriod);
        url.searchParams.set('access_token', token);
        const res = await fetch(url.toString());
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = await res.json() as { data?: any[] };
          for (const row of d.data ?? []) {
            const leads = ((row.actions ?? []) as { action_type: string; value: string }[])
              .filter(a => META_LEAD_ACTIONS.includes(a.action_type))
              .reduce((s: number, a: { value: string }) => s + parseInt(a.value || '0', 10), 0);
            campaigns.push({
              spend: parseFloat(row.spend || '0'),
              leads,
              clicks: parseInt(row.clicks || '0', 10),
              impressions: parseInt(row.impressions || '0', 10),
            });
          }
        }

        // Active ads creation time (for creative health)
        if (period === 'this_month') {
          const adsUrl = new URL(`https://graph.facebook.com/v21.0/${acctNode}/ads`);
          adsUrl.searchParams.set('fields', 'created_time,effective_status');
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
            }
          }
        }
      }));
    }));

    return { campaigns, adAges };
  }

  async function fetchGoogleData(period: 'this_month' | 'last_month'): Promise<CampaignMetrics[]> {
    const gaqlPeriod = resolveGaqlPeriod(period);
    const { rows: links } = await pool.query(
      `SELECT account_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'google_ads'`,
      [clientId]
    );
    if (links.length === 0) return [];
    const { rows: conns } = await pool.query(`SELECT * FROM public.google_connections WHERE status = 'connected'`);
    if (conns.length === 0) return [];

    const campaigns: CampaignMetrics[] = [];
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
        const res = await fetch(`https://googleads.googleapis.com/v20/customers/${accountId}/googleAds:search`, {
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

  const [metaCurr, metaPrev, googleCurr, googlePrev] = await Promise.all([
    fetchMetaData('this_month'),
    fetchMetaData('last_month'),
    fetchGoogleData('this_month'),
    fetchGoogleData('last_month'),
  ]);

  function sum(arr: CampaignMetrics[], field: keyof CampaignMetrics) {
    return arr.reduce((s, c) => s + c[field], 0);
  }

  const currSpend = sum([...metaCurr.campaigns, ...googleCurr], 'spend');
  const currLeads = sum([...metaCurr.campaigns, ...googleCurr], 'leads');
  const currClicks = sum([...metaCurr.campaigns, ...googleCurr], 'clicks');
  const currImpressions = sum([...metaCurr.campaigns, ...googleCurr], 'impressions');

  const prevSpend = sum([...metaPrev.campaigns, ...googlePrev], 'spend');
  const prevLeads = sum([...metaPrev.campaigns, ...googlePrev], 'leads');
  const prevClicks = sum([...metaPrev.campaigns, ...googlePrev], 'clicks');
  const prevImpressions = sum([...metaPrev.campaigns, ...googlePrev], 'impressions');

  const currCpl = currLeads > 0 ? currSpend / currLeads : 0;
  const prevCpl = prevLeads > 0 ? prevSpend / prevLeads : 0;
  const currCtr = currImpressions > 0 ? currClicks / currImpressions * 100 : 0;
  const prevCtr = prevImpressions > 0 ? prevClicks / prevImpressions * 100 : 0;

  // Scoring
  let cplScore = 25; // neutral if no previous data
  if (prevCpl > 0 && currCpl > 0) {
    const delta = (currCpl - prevCpl) / prevCpl; // negative = improved
    if (delta <= -0.1) cplScore = 35;
    else if (delta <= 0) cplScore = 30;
    else if (delta <= 0.2) cplScore = 20;
    else if (delta <= 0.5) cplScore = 10;
    else cplScore = 0;
  } else if (currLeads > 0) { cplScore = 25; }

  let leadScore = 15;
  if (prevLeads > 0 && currLeads > 0) {
    const delta = (currLeads - prevLeads) / prevLeads;
    if (delta >= 0.1) leadScore = 25;
    else if (delta >= -0.1) leadScore = 20;
    else if (delta >= -0.3) leadScore = 10;
    else leadScore = 0;
  } else if (currLeads > 0) { leadScore = 15; }

  let ctrScore = 10;
  if (prevCtr > 0 && currCtr > 0) {
    const delta = (currCtr - prevCtr) / prevCtr;
    if (delta >= 0.05) ctrScore = 20;
    else if (delta >= -0.05) ctrScore = 15;
    else if (delta >= -0.2) ctrScore = 8;
    else ctrScore = 3;
  } else if (currCtr > 0) { ctrScore = 12; }

  // Creative health (only Meta)
  let creativeScore = 15; // neutral if no data
  const adAges = metaCurr.adAges;
  if (adAges.length > 0) {
    const avgAge = adAges.reduce((s, a) => s + a, 0) / adAges.length;
    const staleCount = adAges.filter(a => a > 45).length;
    const staleRatio = staleCount / adAges.length;
    if (avgAge < 20 && staleRatio < 0.1) creativeScore = 20;
    else if (avgAge < 35 && staleRatio < 0.3) creativeScore = 15;
    else if (avgAge < 45 || staleRatio < 0.5) creativeScore = 10;
    else creativeScore = 5;
  }

  const score = Math.min(100, cplScore + leadScore + ctrScore + creativeScore);
  const grade = calcGrade(score);

  const details = {
    cpl: { score: cplScore, current: Math.round(currCpl * 100) / 100, previous: Math.round(prevCpl * 100) / 100 },
    leads: { score: leadScore, current: currLeads, previous: prevLeads },
    ctr: { score: ctrScore, current: Math.round(currCtr * 100) / 100, previous: Math.round(prevCtr * 100) / 100 },
    creative: { score: creativeScore, count: adAges.length, avgAge: adAges.length > 0 ? Math.round(adAges.reduce((s, a) => s + a, 0) / adAges.length) : 0, stale: adAges.filter(a => a > 45).length },
    spend: { current: Math.round(currSpend * 100) / 100, previous: Math.round(prevSpend * 100) / 100 },
  };

  return { score, grade, details };
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const recalc = req.nextUrl.searchParams.get('recalc') === 'true';

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    if (clientId) {
      // Single client score
      if (!recalc) {
        const { rows } = await pool.query('SELECT * FROM public.client_scores WHERE client_id = $1', [clientId]);
        if (rows[0]) return Response.json(rows[0]);
      }
      const result = await calcClientScore(pool, clientId);
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
