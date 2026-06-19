import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchMonthlyMeta, fetchGoogleAdsTotals } from '@/lib/report-builder';

// Stages that only happen after a meeting actually took place — there's no
// explicit "Reunião Realizada" stage in this CRM, so reaching one of these
// (or being marked GANHO) is used as a proxy for "meeting held".
const POST_MEETING_STAGES = ['lead quente', 'lead morno', 'lead frio', 'perca qualificada'];

function normalize(value: string | null): string {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeChannel(raw: string | null): string {
  const n = normalize(raw);
  if (n === 'indicacao') return 'Instagram';
  return raw?.trim() || 'Não informado';
}

function classifyChannelBucket(channel: string): 'meta' | 'google' | 'outro' {
  const n = normalize(channel);
  if (n.includes('google')) return 'google';
  if (n.includes('face') || n.includes('insta') || n.includes('meta')) return 'meta';
  return 'outro';
}

type LeadRow = {
  city: string | null;
  channel: string | null;
  stage: string | null;
  status_category: string | null;
  fechou: boolean | null;
  revenue: number | null;
  lead_date: string | null;
  updated_at_external: string | null;
};

type Bucket = {
  leads: number;
  reuniaoAgendada: number;
  reuniaoRealizada: number;
  venda: number;
  faturado: number;
};

function emptyBucket(): Bucket {
  return { leads: 0, reuniaoAgendada: 0, reuniaoRealizada: 0, venda: 0, faturado: 0 };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (!clientId || !from || !to) {
    return Response.json({ error: 'clientId, from e to são obrigatórios' }, { status: 400 });
  }

  const pool = makeServerPool();
  let rows: LeadRow[] = [];
  let metaConnectionId: string | null = null;
  let metaAccountIds: string[] = [];
  let googleConnectionId: string | null = null;
  let googleAccountIds: string[] = [];

  try {
    const { rows: leadRows } = await pool.query<LeadRow>(
      `SELECT
         COALESCE(bairro, city)        AS city,
         COALESCE(canal, source)       AS channel,
         stage,
         status_category,
         fechou,
         COALESCE(valor_rs, revenue)   AS revenue,
         COALESCE(data, lead_date)::text          AS lead_date,
         updated_at_external::text               AS updated_at_external
       FROM public.crm_leads
       WHERE client_id = $1`,
      [clientId],
    );
    rows = leadRows;

    const { rows: links } = await pool.query(
      `SELECT platform, connection_id, account_id FROM public.client_account_links WHERE client_id = $1`,
      [clientId],
    );
    const metaLinks = links.filter((l: { platform: string }) => l.platform === 'meta_ads' || l.platform === 'meta');
    metaConnectionId = (metaLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
    metaAccountIds = metaLinks.map((l: { account_id: string }) => l.account_id);
    const googleLinks = links.filter((l: { platform: string }) => l.platform === 'google_ads' || l.platform === 'google');
    googleConnectionId = (googleLinks[0] as { connection_id: string } | undefined)?.connection_id ?? null;
    googleAccountIds = googleLinks.map((l: { account_id: string }) => l.account_id);
  } finally {
    await pool.end();
  }

  const [monthlyMeta, googleTotals] = await Promise.all([
    metaConnectionId && metaAccountIds.length ? fetchMonthlyMeta(metaConnectionId, metaAccountIds, from, to) : Promise.resolve([]),
    googleConnectionId && googleAccountIds.length ? fetchGoogleAdsTotals(googleConnectionId, googleAccountIds, from, to) : Promise.resolve({ spend: 0, impressions: 0, clicks: 0, conversions: 0 }),
  ]);
  const metaSpend = monthlyMeta.reduce((sum, m) => sum + m.spend, 0);
  const googleSpend = googleTotals.spend;

  const inPeriod = (date: string | null) => Boolean(date && date >= from && date <= to);

  const overall = emptyBucket();
  const cityMap = new Map<string, Bucket>();
  const cityChannelMap = new Map<string, Bucket>();
  const channelLeadCount = { meta: 0, google: 0 };

  for (const row of rows) {
    const city = row.city?.trim() || 'Não informado';
    const channel = normalizeChannel(row.channel);
    const stage = normalize(row.stage);
    const isGanho = row.status_category === 'won' || row.fechou === true;
    const reachedMeeting = stage === 'reuniao agendada' || POST_MEETING_STAGES.includes(stage) || isGanho;
    const heldMeeting = POST_MEETING_STAGES.includes(stage) || isGanho;

    // Leads counted by creation date; funnel-stage events (meeting/won) only have
    // an "updated at" timestamp on this CRM, so they're counted by that instead.
    const isLeadInPeriod = inPeriod(row.lead_date);
    const isEventInPeriod = inPeriod(row.updated_at_external);

    const bucket = cityMap.get(city) ?? emptyBucket();
    const ccKey = `${city}␟${channel}`;
    const ccBucket = cityChannelMap.get(ccKey) ?? emptyBucket();

    if (isLeadInPeriod) {
      overall.leads++; bucket.leads++; ccBucket.leads++;
      const cb = classifyChannelBucket(channel);
      if (cb === 'meta') channelLeadCount.meta++;
      if (cb === 'google') channelLeadCount.google++;
    }
    if (isEventInPeriod) {
      if (reachedMeeting) { overall.reuniaoAgendada++; bucket.reuniaoAgendada++; ccBucket.reuniaoAgendada++; }
      if (heldMeeting)    { overall.reuniaoRealizada++; bucket.reuniaoRealizada++; ccBucket.reuniaoRealizada++; }
      if (isGanho) {
        overall.venda++; bucket.venda++; ccBucket.venda++;
        overall.faturado += row.revenue ?? 0; bucket.faturado += row.revenue ?? 0; ccBucket.faturado += row.revenue ?? 0;
      }
    }

    cityMap.set(city, bucket);
    cityChannelMap.set(ccKey, ccBucket);
  }

  const cplMeta   = channelLeadCount.meta   > 0 ? metaSpend   / channelLeadCount.meta   : 0;
  const cplGoogle = channelLeadCount.google > 0 ? googleSpend / channelLeadCount.google : 0;

  function costFor(channel: string, leads: number): number {
    const bucket = classifyChannelBucket(channel);
    const cpl = bucket === 'meta' ? cplMeta : bucket === 'google' ? cplGoogle : 0;
    return cpl * leads;
  }

  const citySummary = Array.from(cityMap.entries())
    .map(([city, b]) => {
      const custo = Array.from(cityChannelMap.entries())
        .filter(([key]) => key.startsWith(`${city}␟`))
        .reduce((sum, [key, cb]) => sum + costFor(key.split('␟')[1], cb.leads), 0);
      return { city, ...b, custoEstimado: custo, cpa: b.venda > 0 ? custo / b.venda : null };
    })
    .sort((a, b) => b.leads - a.leads);

  const byCityChannel = Array.from(cityChannelMap.entries()).map(([key, b]) => {
    const [city, channel] = key.split('␟');
    const custo = costFor(channel, b.leads);
    return { city, channel, ...b, custoEstimado: custo, cpa: b.venda > 0 ? custo / b.venda : null, custoPorReuniao: b.reuniaoAgendada > 0 ? custo / b.reuniaoAgendada : null };
  }).sort((a, b) => b.leads - a.leads);

  return Response.json({
    overall,
    citySummary,
    byCityChannel,
    cplPerChannelBucket: { meta: cplMeta, google: cplGoogle },
    spend: { meta: metaSpend, google: googleSpend },
  });
}
