import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const clientId = sp.get('clientId') || null;
  const from = sp.get('from') || null;
  const to = sp.get('to') || null;

  const pool = makeServerPool();
  // $1=clientId $2=from $3=to — all nullable; query handles nulls via IS NULL checks
  const params = [clientId, from, to];

  try {
    const [dailyRes, linksRes, sourcesRes, mediumsRes, campaignsRes] = await Promise.all([
      pool.query(
        `SELECT DATE(lrc.created_at) AS day, COUNT(*)::int AS clicks
           FROM public.link_redirect_clicks lrc
           JOIN public.link_redirects lr ON lr.id = lrc.redirect_id
          WHERE ($1::text IS NULL OR lr.client_id = $1)
            AND ($2::date IS NULL OR lrc.created_at >= $2::date)
            AND ($3::date IS NULL OR lrc.created_at <  $3::date + interval '1 day')
          GROUP BY DATE(lrc.created_at)
          ORDER BY day ASC`,
        params,
      ),
      pool.query(
        `SELECT lr.id, lr.name, lr.slug,
                COUNT(lrc.id)::int AS clicks
           FROM public.link_redirects lr
           LEFT JOIN public.link_redirect_clicks lrc
             ON lrc.redirect_id = lr.id
            AND ($2::date IS NULL OR lrc.created_at >= $2::date)
            AND ($3::date IS NULL OR lrc.created_at <  $3::date + interval '1 day')
          WHERE ($1::text IS NULL OR lr.client_id = $1)
          GROUP BY lr.id
          ORDER BY clicks DESC
          LIMIT 10`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(lrc.utm_source,''), '(direto)') AS label,
                COUNT(*)::int AS clicks
           FROM public.link_redirect_clicks lrc
           JOIN public.link_redirects lr ON lr.id = lrc.redirect_id
          WHERE ($1::text IS NULL OR lr.client_id = $1)
            AND ($2::date IS NULL OR lrc.created_at >= $2::date)
            AND ($3::date IS NULL OR lrc.created_at <  $3::date + interval '1 day')
          GROUP BY lrc.utm_source
          ORDER BY clicks DESC LIMIT 8`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(lrc.utm_medium,''), '(nenhum)') AS label,
                COUNT(*)::int AS clicks
           FROM public.link_redirect_clicks lrc
           JOIN public.link_redirects lr ON lr.id = lrc.redirect_id
          WHERE ($1::text IS NULL OR lr.client_id = $1)
            AND ($2::date IS NULL OR lrc.created_at >= $2::date)
            AND ($3::date IS NULL OR lrc.created_at <  $3::date + interval '1 day')
          GROUP BY lrc.utm_medium
          ORDER BY clicks DESC LIMIT 8`,
        params,
      ),
      pool.query(
        `SELECT COALESCE(NULLIF(lrc.utm_campaign,''), '(sem campanha)') AS label,
                COUNT(*)::int AS clicks
           FROM public.link_redirect_clicks lrc
           JOIN public.link_redirects lr ON lr.id = lrc.redirect_id
          WHERE ($1::text IS NULL OR lr.client_id = $1)
            AND ($2::date IS NULL OR lrc.created_at >= $2::date)
            AND ($3::date IS NULL OR lrc.created_at <  $3::date + interval '1 day')
          GROUP BY lrc.utm_campaign
          ORDER BY clicks DESC LIMIT 8`,
        params,
      ),
    ]);

    const totalClicks = dailyRes.rows.reduce((s: number, r: { clicks: number }) => s + r.clicks, 0);
    const activeLinks = linksRes.rows.filter((r: { clicks: number }) => r.clicks > 0).length;

    return Response.json({
      totalClicks,
      activeLinks,
      clicksPerDay: dailyRes.rows,
      topLinks: linksRes.rows,
      topSources: sourcesRes.rows,
      topMediums: mediumsRes.rows,
      topCampaigns: campaignsRes.rows,
    });
  } catch {
    return Response.json({
      totalClicks: 0, activeLinks: 0,
      clicksPerDay: [], topLinks: [], topSources: [], topMediums: [], topCampaigns: [],
    });
  } finally {
    await pool.end();
  }
}
