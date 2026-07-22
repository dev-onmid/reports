import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLpAnalyticsSchema } from '@/lib/lp-analytics';

// ── Radar de LP: agregados de comportamento de uma LP ────────────────────────
// Funil de scroll (25/50/75/100), top elementos clicados (expande o clicks
// JSONB), device, campanha/origem e série diária — padrão /api/tracking/leads.

export const dynamic = 'force-dynamic';

type CountRow = { label: string | null; count: number };

function normalizeCounts(rows: CountRow[], emptyLabel: string): { label: string; count: number }[] {
  return rows.map(r => ({ label: r.label?.trim() ? r.label : emptyLabel, count: Number(r.count) }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lpId: string }> },
) {
  const { id: clientId, lpId } = await params;
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30, 1), 90);

  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);

    const { rows: [lp] } = await pool.query(
      `SELECT id FROM public.client_landing_pages WHERE id = $1 AND client_id = $2`,
      [lpId, clientId],
    );
    if (!lp) return Response.json({ error: 'LP não encontrada' }, { status: 404 });

    const where = `s.lp_id = $1 AND s.created_at > NOW() - ($2 || ' days')::interval`;
    const qp = [lpId, String(days)];

    const [totais, topCliques, porDevice, porCampanha, porOrigem, porDia] = await Promise.all([
      pool.query<{
        total: number; avg_duration_ms: number | null; avg_scroll_pct: number | null;
        reach_25: number; reach_50: number; reach_75: number; reach_100: number;
      }>(
        `SELECT COUNT(*)::int AS total,
                ROUND(AVG(s.duration_ms))::int AS avg_duration_ms,
                ROUND(AVG(s.max_scroll_pct))::int AS avg_scroll_pct,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 25)::int  AS reach_25,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 50)::int  AS reach_50,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 75)::int  AS reach_75,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 100)::int AS reach_100
           FROM public.lp_sessions s WHERE ${where}`,
        qp,
      ),
      pool.query<{ el: string; txt: string; clicks: number; sessions: number }>(
        `SELECT c->>'el' AS el, c->>'txt' AS txt,
                COUNT(*)::int AS clicks, COUNT(DISTINCT s.id)::int AS sessions
           FROM public.lp_sessions s
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.clicks, '[]'::jsonb)) c
          WHERE ${where}
          GROUP BY 1, 2 ORDER BY clicks DESC LIMIT 15`,
        qp,
      ),
      pool.query<CountRow>(
        `SELECT s.device AS label, COUNT(*)::int AS count FROM public.lp_sessions s
          WHERE ${where} GROUP BY s.device ORDER BY count DESC`,
        qp,
      ),
      pool.query<CountRow>(
        `SELECT NULLIF(s.utm_campaign, '') AS label, COUNT(*)::int AS count
           FROM public.lp_sessions s WHERE ${where}
          GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        qp,
      ),
      pool.query<CountRow>(
        `SELECT NULLIF(s.utm_source, '') AS label, COUNT(*)::int AS count
           FROM public.lp_sessions s WHERE ${where}
          GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        qp,
      ),
      pool.query<{ day: string; count: number }>(
        `SELECT date_trunc('day', s.created_at)::date AS day, COUNT(*)::int AS count
           FROM public.lp_sessions s WHERE ${where}
          GROUP BY 1 ORDER BY 1`,
        qp,
      ),
    ]);

    const t = totais.rows[0] ?? {
      total: 0, avg_duration_ms: null, avg_scroll_pct: null,
      reach_25: 0, reach_50: 0, reach_75: 0, reach_100: 0,
    };
    return Response.json({
      total: Number(t.total),
      avgDurationMs: t.avg_duration_ms === null ? null : Number(t.avg_duration_ms),
      avgScrollPct: t.avg_scroll_pct === null ? null : Number(t.avg_scroll_pct),
      scrollFunnel: {
        reach25: Number(t.reach_25),
        reach50: Number(t.reach_50),
        reach75: Number(t.reach_75),
        reach100: Number(t.reach_100),
      },
      topClicks: topCliques.rows.map(r => ({
        el: r.el, txt: r.txt, clicks: Number(r.clicks), sessions: Number(r.sessions),
      })),
      porDevice: normalizeCounts(porDevice.rows, '(desconhecido)'),
      porCampanha: normalizeCounts(porCampanha.rows, '(sem campanha)'),
      porOrigem: normalizeCounts(porOrigem.rows, '(direto)'),
      porDia: porDia.rows.map(r => ({ day: r.day, count: Number(r.count) })),
    });
  } catch (err) {
    console.error('[landing-pages stats]', err);
    return Response.json({ error: 'Erro ao carregar stats' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
