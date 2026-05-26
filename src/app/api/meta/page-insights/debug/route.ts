import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').filter(Boolean);

  const pool = makeServerPool();
  const log: Record<string, unknown>[] = [];

  try {
    // 1. Check meta_connections
    const { rows: allConns } = await pool.query(
      `SELECT id, label, status, user_name, connected_at,
              LEFT(access_token, 20) AS token_preview,
              token_expiry
         FROM public.meta_connections
        ORDER BY connected_at DESC`,
    );
    log.push({ step: '1_meta_connections', count: allConns.length, rows: allConns });

    // 2. Check client_account_links for these clients
    if (clientIds.length > 0) {
      const { rows: links } = await pool.query(
        `SELECT cal.client_id, cal.platform, cal.connection_id, cal.account_id, c.name
           FROM public.client_account_links cal
           JOIN public.clients c ON c.id = cal.client_id
          WHERE cal.client_id = ANY($1)`,
        [clientIds],
      );
      log.push({ step: '2_client_account_links', count: links.length, rows: links });
    }

    // 3. Test token + /me/accounts on each connection
    for (const conn of allConns) {
      if (conn.status !== 'connected') continue;
      try {
        const { rows: [fullConn] } = await pool.query(
          `SELECT * FROM public.meta_connections WHERE id = $1`, [conn.id],
        );
        const token = await getFreshMetaToken(fullConn);

        const accountsRes = await fetch(
          `https://graph.facebook.com/v21.0/me/accounts` +
          `?fields=id,name,instagram_business_account{id,username}` +
          `&limit=10&access_token=${token}`,
        );
        const accountsData = await accountsRes.json();

        // 4. Check permissions on the token
        const permsRes = await fetch(
          `https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`,
        );
        const permsData = await permsRes.json();

        log.push({
          step: `3_connection_${conn.id}`,
          connection_label: conn.label,
          user_name: conn.user_name,
          accounts_ok: accountsRes.ok,
          accounts_count: (accountsData.data ?? []).length,
          accounts_pages: (accountsData.data ?? []).map((p: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }) => ({
            fb_page_id: p.id,
            fb_page_name: p.name,
            ig_account: p.instagram_business_account ?? null,
          })),
          permissions: (permsData.data ?? [])
            .filter((p: { status: string }) => p.status === 'granted')
            .map((p: { permission: string }) => p.permission),
          permissions_missing: ['pages_read_engagement', 'instagram_basic', 'instagram_manage_insights', 'read_insights']
            .filter(needed => !(permsData.data ?? []).some((p: { permission: string; status: string }) => p.permission === needed && p.status === 'granted')),
        });

        // 5. Test each FB metric individually to find which are valid in v21.0
        const firstPage = accountsData.data?.[0];
        if (firstPage) {
          const pageTokenRes = await fetch(
            `https://graph.facebook.com/v21.0/${firstPage.id}?fields=access_token&access_token=${token}`,
          );
          const pageTokenData = await pageTokenRes.json() as { access_token?: string };
          const pageToken = pageTokenData.access_token ?? token;

          // Use recent date range (last 3 days)
          const until = Math.floor(Date.now() / 1000);
          const since = until - 3 * 86400;

          const fbMetrics = [
            'page_fan_adds', 'page_fan_adds_unique',
            'page_impressions', 'page_impressions_unique',
            'page_post_engagements', 'page_engaged_users',
            'page_views_total', 'page_daily_scheduled_published_posts',
          ];
          const fbResults: Record<string, unknown> = {};
          await Promise.all(fbMetrics.map(async (metric) => {
            const r = await fetch(
              `https://graph.facebook.com/v21.0/${firstPage.id}/insights` +
              `?metric=${metric}&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
            );
            const d = await r.json() as { data?: { values: { value: number }[] }[]; error?: { message: string } };
            fbResults[metric] = r.ok ? `OK — ${d.data?.[0]?.values?.slice(-1)[0]?.value ?? 0}` : `ERR: ${d.error?.message}`;
          }));
          log.push({ step: `4_fb_metrics_test_${firstPage.id}`, page_name: firstPage.name, results: fbResults });

          // 6. Test each IG metric individually
          const igAcc = firstPage.instagram_business_account ?? accountsData.data?.find((p: { instagram_business_account?: { id: string } }) => p.instagram_business_account)?.instagram_business_account;
          if (igAcc?.id) {
            const igMetricsDay = ['profile_views', 'website_clicks'];
            const igMetricsRange = ['reach', 'impressions', 'accounts_engaged', 'total_interactions'];
            const igResults: Record<string, unknown> = {};
            await Promise.all([
              ...igMetricsDay.map(async (metric) => {
                const r = await fetch(
                  `https://graph.facebook.com/v21.0/${igAcc.id}/insights` +
                  `?metric=${metric}&period=day&since=${since}&until=${until}&access_token=${pageToken}`,
                );
                const d = await r.json() as { data?: { values?: { value: number }[]; total_value?: { value: number } }[]; error?: { message: string } };
                const val = d.data?.[0]?.total_value?.value ?? d.data?.[0]?.values?.slice(-1)[0]?.value ?? 0;
                igResults[`${metric}(day)`] = r.ok ? `OK — ${val}` : `ERR: ${d.error?.message}`;
              }),
              ...igMetricsRange.map(async (metric) => {
                const r = await fetch(
                  `https://graph.facebook.com/v21.0/${igAcc.id}/insights` +
                  `?metric=${metric}&period=total_over_range&since=${since}&until=${until}&access_token=${pageToken}`,
                );
                const d = await r.json() as { data?: { values?: { value: number }[]; total_value?: { value: number } }[]; error?: { message: string } };
                const val = d.data?.[0]?.total_value?.value ?? d.data?.[0]?.values?.slice(-1)[0]?.value ?? 0;
                igResults[`${metric}(range)`] = r.ok ? `OK — ${val}` : `ERR: ${d.error?.message}`;
              }),
            ]);
            log.push({ step: `5_ig_metrics_test_${igAcc.id}`, ig_username: igAcc.username, results: igResults });
          }
        }
      } catch (e) {
        log.push({ step: `3_connection_${conn.id}_error`, error: String(e) });
      }
    }

    return Response.json({ ok: true, log }, { status: 200 });
  } finally {
    await pool.end();
  }
}
