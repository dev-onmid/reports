import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

function makePool() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    user: process.env.POSTGRES_USER,
    password: process.env.SUPABASE_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

function mapToMetaPeriod(p: string): string {
  const map: Record<string, string> = {
    last_7d: 'last_7_days', last_30d: 'last_30_days',
    last_month: 'last_month', this_month: 'this_month',
  };
  return map[p] ?? 'last_30_days';
}

const LEAD_ACTIONS = [
  'lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped',
  'onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection',
];

function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

function accountMatches(a: string, b: string) {
  return normalizeMetaAccountId(a) === normalizeMetaAccountId(b);
}

export type TopCreative = {
  adId: string;
  adName: string;
  accountId: string;
  accountName: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  headline?: string;
  body?: string;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpl: number;
};

export async function GET(request: NextRequest) {
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const sortBy = request.nextUrl.searchParams.get('sortBy') ?? 'spend';
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get('limit') ?? '20'), 50);
  const metaPeriod = mapToMetaPeriod(period);
  const requestedClientIds = (request.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const shouldFilterByClient = requestedClientIds.length > 0;

  const pool = makePool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let links: any[] = [];
  try {
    const [connectionsResult, linksResult] = await Promise.all([
      pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'"),
      shouldFilterByClient
        ? pool.query(
          `SELECT client_id, connection_id, account_id
           FROM public.client_account_links
           WHERE platform = 'meta_ads'
             AND client_id = ANY($1::text[])`,
          [requestedClientIds],
        )
        : Promise.resolve({ rows: [] }),
    ]);
    conns = connectionsResult.rows;
    links = linksResult.rows;
  } finally {
    await pool.end();
  }

  const allowedByConnection = new Map<string, string[]>();
  for (const link of links) {
    if (!link.connection_id || !link.account_id) continue;
    const list = allowedByConnection.get(link.connection_id) ?? [];
    list.push(link.account_id);
    allowedByConnection.set(link.connection_id, list);
  }

  if (shouldFilterByClient && allowedByConnection.size === 0) {
    return Response.json([]);
  }

  const allCreatives: TopCreative[] = [];

  await Promise.allSettled(
    conns.map(async (conn) => {
      const token = conn.access_token as string;
      const allowedAccounts = shouldFilterByClient ? allowedByConnection.get(conn.id) ?? [] : [];
      if (shouldFilterByClient && allowedAccounts.length === 0) return;

      // Get all ad accounts accessible by this connection
      const acctRes = await fetch(
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name&limit=50&access_token=${token}`
      );
      if (!acctRes.ok) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acctData = await acctRes.json() as { data?: any[] };
      const accounts: Array<{ id: string; name: string }> = shouldFilterByClient
        ? (acctData.data ?? []).filter((account) => allowedAccounts.some((id) => accountMatches(id, account.id)))
        : acctData.data ?? [];

      await Promise.allSettled(
        accounts.map(async (account) => {
          // Fetch top ads insights sorted by spend
          const insightsUrl = new URL(`https://graph.facebook.com/v21.0/${account.id}/insights`);
          insightsUrl.searchParams.set('level', 'ad');
          insightsUrl.searchParams.set('fields', 'ad_id,ad_name,spend,impressions,clicks,actions');
          insightsUrl.searchParams.set('date_preset', metaPeriod);
          insightsUrl.searchParams.set('sort', 'spend_descending');
          insightsUrl.searchParams.set('limit', String(limit));
          insightsUrl.searchParams.set('access_token', token);

          const insightsRes = await fetch(insightsUrl.toString());
          if (!insightsRes.ok) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const insightsData = await insightsRes.json() as { data?: any[] };
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const adsInsights: any[] = insightsData.data ?? [];
          if (adsInsights.length === 0) return;

          // Batch-fetch creative details
          const adIds = adsInsights.map(a => a.ad_id as string).filter(Boolean);
          const batchRes = await fetch(
            `https://graph.facebook.com/v21.0/?ids=${adIds.join(',')}&fields=name,creative{body,title,image_url,thumbnail_url}&access_token=${token}`
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const batchData: Record<string, any> = batchRes.ok ? await batchRes.json() : {};

          for (const insight of adsInsights) {
            const adData = batchData[insight.ad_id] ?? {};
            const creative = adData.creative ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const leads = ((insight.actions ?? []) as { action_type: string; value: string }[])
              .filter(a => LEAD_ACTIONS.includes(a.action_type))
              .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0);
            const spend = parseFloat(insight.spend || '0');
            const clicks = parseInt(insight.clicks || '0', 10);
            const impressions = parseInt(insight.impressions || '0', 10);

            allCreatives.push({
              adId: insight.ad_id,
              adName: insight.ad_name ?? adData.name ?? `Ad ${insight.ad_id}`,
              accountId: account.id,
              accountName: account.name,
              imageUrl: creative.image_url ?? undefined,
              thumbnailUrl: creative.thumbnail_url ?? undefined,
              headline: creative.title ?? undefined,
              body: creative.body ?? undefined,
              spend,
              impressions,
              clicks,
              leads,
              ctr: impressions > 0 ? clicks / impressions * 100 : 0,
              cpl: leads > 0 ? spend / leads : 0,
            });
          }
        })
      );
    })
  );

  // Sort client-side for flexibility
  allCreatives.sort((a, b) => {
    const av = a[sortBy as keyof TopCreative] as number ?? 0;
    const bv = b[sortBy as keyof TopCreative] as number ?? 0;
    if (sortBy === 'cpl') return av - bv; // lower is better
    return bv - av;
  });

  return Response.json(allCreatives.slice(0, limit));
}
