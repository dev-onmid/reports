import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { google as googleapis } from 'googleapis';
import { getFreshMetaToken } from '@/lib/meta-token';
import { getCached, setCached, cachedJson } from '@/lib/api-cache';

async function ensureTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_activity_log (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   TEXT        NOT NULL,
      platform    TEXT        NOT NULL DEFAULT 'system',
      event_type  TEXT        NOT NULL,
      description TEXT        NOT NULL,
      actor_name  TEXT,
      actor_source TEXT       NOT NULL DEFAULT 'system',
      campaign_id   TEXT,
      campaign_name TEXT,
      old_value   TEXT,
      new_value   TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '30');
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceUnix = Math.floor(since.getTime() / 1000);

  const cacheKey = `activity:${clientId}:${days}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  try {
    await ensureTable(pool);

    // System logs
    const { rows: systemLogs } = await pool.query(
      `SELECT id::text, platform, event_type, description, actor_name, actor_source,
              campaign_id, campaign_name, old_value, new_value, created_at
       FROM public.client_activity_log
       WHERE client_id = $1 AND created_at >= $2
       ORDER BY created_at DESC LIMIT 100`,
      [clientId, since]
    );

    // Get account links
    const { rows: metaLinks } = await pool.query(
      `SELECT account_id, connection_id FROM public.client_account_links
       WHERE client_id = $1 AND platform = 'meta_ads'`,
      [clientId]
    );
    const { rows: googleLinks } = await pool.query(
      `SELECT account_id FROM public.client_account_links
       WHERE client_id = $1 AND platform = 'google_ads'`,
      [clientId]
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLogs: any[] = [...systemLogs];

    // Meta activity history
    if (metaLinks.length > 0) {
      try {
        const { rows: metaConns } = await pool.query(
          `SELECT * FROM public.meta_connections WHERE id = $1`,
          [metaLinks[0].connection_id]
        );
        if (!metaConns[0]) {
          // try global
          const { rows: g } = await pool.query(`SELECT * FROM public.meta_integration WHERE id = 'global' AND status = 'connected'`).catch(() => ({ rows: [] }));
          if (g[0]) metaConns.push({ ...g[0], id: 'global' });
        }
        if (metaConns[0]) {
          const token = await getFreshMetaToken(metaConns[0]);
          await Promise.allSettled(metaLinks.map(async (link) => {
            const acctNode = link.account_id.startsWith('act_') ? link.account_id : `act_${link.account_id}`;
            const url = new URL(`https://graph.facebook.com/v21.0/${acctNode}/activities`);
            url.searchParams.set('fields', 'actor_name,event_type,object_id,object_name,object_type,translated_event_type,date_time_in_timezone');
            url.searchParams.set('since', String(sinceUnix));
            url.searchParams.set('limit', '50');
            url.searchParams.set('access_token', token);
            const res = await fetch(url.toString());
            if (!res.ok) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await res.json() as { data?: any[] };
            for (const item of data.data ?? []) {
              allLogs.push({
                id: `meta-${item.object_id ?? ''}-${item.date_time_in_timezone ?? ''}`,
                platform: 'meta',
                event_type: item.event_type ?? 'change',
                description: item.translated_event_type ?? item.event_type ?? 'Alteração',
                actor_name: item.actor_name ?? 'Usuário Meta',
                actor_source: 'meta',
                campaign_name: item.object_type === 'CAMPAIGN' ? item.object_name : undefined,
                created_at: item.date_time_in_timezone,
              });
            }
          }));
        }
      } catch { /* ignore meta errors */ }
    }

    // Google change events
    if (googleLinks.length > 0) {
      try {
        const { rows: googleConns } = await pool.query(`SELECT * FROM public.google_connections WHERE status = 'connected'`);
        const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '';
        const sinceDate = since.toISOString().replace('T', ' ').slice(0, 19);

        await Promise.allSettled(googleConns.map(async (conn) => {
          const oauth2 = new googleapis.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
          oauth2.setCredentials({ refresh_token: conn.refresh_token });
          let accessToken = conn.access_token;
          try {
            if (!conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 5 * 60 * 1000) {
              const { credentials } = await oauth2.refreshAccessToken();
              accessToken = credentials.access_token ?? accessToken;
            }
          } catch { /* use existing */ }

          await Promise.allSettled(googleLinks.map(async (link) => {
            const accountId = link.account_id.replace(/\D/g, '');
            const res = await fetch(`https://googleads.googleapis.com/v20/customers/${accountId}/googleAds:search`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': DEV_TOKEN, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: `SELECT change_event.change_date_time, change_event.change_resource_type,
                               change_event.user_email, change_event.resource_change_operation,
                               change_event.new_resource, change_event.old_resource
                        FROM change_event
                        WHERE change_event.change_date_time >= '${sinceDate}'
                          AND change_event.change_resource_type IN ('CAMPAIGN','AD_GROUP','AD','AD_GROUP_AD')
                        ORDER BY change_event.change_date_time DESC LIMIT 50`,
              }),
            });
            if (!res.ok) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const data = await res.json() as { results?: any[] };
            for (const row of data.results ?? []) {
              const ev = row.changeEvent ?? {};
              const type = ev.changeResourceType ?? 'RESOURCE';
              const op = ev.resourceChangeOperation ?? 'UPDATE';
              const opLabel: Record<string, string> = { CREATE: 'criou', UPDATE: 'alterou', REMOVE: 'removeu', ENABLE: 'ativou', PAUSE: 'pausou' };
              allLogs.push({
                id: `google-${ev.changeDateTime ?? ''}-${Math.random()}`,
                platform: 'google',
                event_type: `${op}_${type}`.toLowerCase(),
                description: `${opLabel[op] ?? op} ${type.toLowerCase().replace('_', ' ')}`,
                actor_name: ev.userEmail ?? 'Usuário Google',
                actor_source: 'google',
                created_at: ev.changeDateTime,
              });
            }
          }));
        }));
      } catch { /* ignore google errors */ }
    }

    // Sort all by created_at desc
    allLogs.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    const result = allLogs.slice(0, 200);
    setCached(cacheKey, result);
    return cachedJson(result, false);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const body = await req.json() as {
    platform?: string; event_type: string; description: string;
    actor_name?: string; actor_source?: string;
    campaign_id?: string; campaign_name?: string;
    old_value?: string; new_value?: string;
  };
  const pool = makeServerPool();
  try {
    await ensureTable(pool);
    await pool.query(
      `INSERT INTO public.client_activity_log
       (client_id, platform, event_type, description, actor_name, actor_source, campaign_id, campaign_name, old_value, new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [clientId, body.platform ?? 'system', body.event_type, body.description,
       body.actor_name ?? null, body.actor_source ?? 'system',
       body.campaign_id ?? null, body.campaign_name ?? null,
       body.old_value ?? null, body.new_value ?? null]
    );
    return new Response(null, { status: 201 });
  } finally {
    await pool.end();
  }
}
