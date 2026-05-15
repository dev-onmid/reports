import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    // verify token exists
    const { rows: [cfg] } = await pool.query(
      `SELECT verify_token FROM public.meta_webhook_config WHERE id = 'global'`
    ).catch(() => ({ rows: [null] }));

    // last event + counts
    const { rows: [stats] } = await pool.query(`
      SELECT
        MAX(triggered_at) AS last_event_at,
        COUNT(*) FILTER (WHERE triggered_at >= NOW() - INTERVAL '24 hours') AS events_today,
        COUNT(*) FILTER (WHERE triggered_at >= NOW() - INTERVAL '7 days')  AS events_week,
        COUNT(*) FILTER (WHERE status = 'error' AND triggered_at >= NOW() - INTERVAL '24 hours') AS errors_today
      FROM public.meta_automation_logs
    `).catch(() => ({ rows: [null] }));

    const { rows: [last] } = await pool.query(`
      SELECT platform, event_type, status, triggered_at
      FROM public.meta_automation_logs
      ORDER BY triggered_at DESC
      LIMIT 1
    `).catch(() => ({ rows: [null] }));

    return Response.json({
      configured: !!cfg?.verify_token,
      last_event_at: last?.triggered_at ?? null,
      last_platform: last?.platform ?? null,
      last_event_type: last?.event_type ?? null,
      last_status: last?.status ?? null,
      events_today: Number(stats?.events_today ?? 0),
      events_week: Number(stats?.events_week ?? 0),
      errors_today: Number(stats?.errors_today ?? 0),
    });
  } finally {
    await pool.end();
  }
}
