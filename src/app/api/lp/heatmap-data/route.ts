import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLpAnalyticsSchema, TRACKING_KEY_REGEX } from '@/lib/lp-analytics';

// ── Radar de LP: dados agregados pro overlay de mapa de calor ────────────────
// Consumido pelo tag.js em "modo mapa" (?onmid_hm=1) DIRETO do domínio da LP —
// por isso o CORS aberto (GET simples, sem preflight; 2º endpoint do repo com
// Access-Control-Allow-Origin:*, junto com o image-proxy).
//
// Os cliques saem AGREGADOS em bins (xp 2 casas ≈ 1% da largura, yp 3 casas ≈
// 0,1% da altura) — nunca sessões individuais. Key inválida → 200 vazio (mesma
// filosofia sem-oracle do collect; a key já é pública no HTML da LP).

export const dynamic = 'force-dynamic';

const DEVICES = new Set(['mobile', 'tablet', 'desktop']);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

const EMPTY = {
  total: 0,
  funnel: { reach25: 0, reach50: 0, reach75: 0, reach100: 0 },
  points: [] as [number, number, number][],
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const key = sp.get('k') ?? '';
  const days = Math.min(Math.max(parseInt(sp.get('days') ?? '30', 10) || 30, 1), 90);
  const deviceRaw = sp.get('device') ?? 'all';
  const device = DEVICES.has(deviceRaw) ? deviceRaw : null;

  if (!TRACKING_KEY_REGEX.test(key)) {
    return new Response(JSON.stringify(EMPTY), { headers: HEADERS });
  }

  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    const { rows: [lp] } = await pool.query(
      `SELECT id FROM public.client_landing_pages WHERE tracking_key = $1 AND active`,
      [key],
    );
    if (!lp) return new Response(JSON.stringify(EMPTY), { headers: HEADERS });

    const where = `s.lp_id = $1 AND s.created_at > NOW() - ($2 || ' days')::interval
                   ${device ? 'AND s.device = $3' : ''}`;
    const qp: unknown[] = device ? [lp.id, String(days), device] : [lp.id, String(days)];

    const [totais, pontos] = await Promise.all([
      pool.query<{ total: number; reach_25: number; reach_50: number; reach_75: number; reach_100: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 25)::int  AS reach_25,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 50)::int  AS reach_50,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 75)::int  AS reach_75,
                COUNT(*) FILTER (WHERE s.max_scroll_pct >= 100)::int AS reach_100
           FROM public.lp_sessions s WHERE ${where}`,
        qp,
      ),
      pool.query<{ xb: number; yb: number; n: number }>(
        `SELECT ROUND((c->>'xp')::numeric, 2)::float AS xb,
                ROUND((c->>'yp')::numeric, 3)::float AS yb,
                COUNT(*)::int AS n
           FROM public.lp_sessions s
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.clicks, '[]'::jsonb)) c
          WHERE ${where}
          GROUP BY 1, 2 ORDER BY n DESC LIMIT 4000`,
        qp,
      ),
    ]);

    const t = totais.rows[0] ?? { total: 0, reach_25: 0, reach_50: 0, reach_75: 0, reach_100: 0 };
    return new Response(JSON.stringify({
      total: Number(t.total),
      funnel: {
        reach25: Number(t.reach_25),
        reach50: Number(t.reach_50),
        reach75: Number(t.reach_75),
        reach100: Number(t.reach_100),
      },
      // [xp, yp, contagem] compacto — payload pequeno mesmo com milhares de bins
      points: pontos.rows.map(r => [Number(r.xb), Number(r.yb), Number(r.n)] as [number, number, number]),
    }), { headers: HEADERS });
  } catch (err) {
    console.error('[lp heatmap-data]', err);
    return new Response(JSON.stringify(EMPTY), { headers: HEADERS });
  } finally {
    await pool.end();
  }
}
