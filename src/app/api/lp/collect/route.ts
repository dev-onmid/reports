import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLpAnalyticsSchema, TRACKING_KEY_REGEX, type LpClick } from '@/lib/lp-analytics';

// ── Ingestão pública do Radar de LP ──────────────────────────────────────────
// Recebe snapshots de sessão do tag.js via navigator.sendBeacon. O body chega
// como text/plain (string JSON) — requisição "simple" do CORS, ZERO preflight
// OPTIONS (o repo não tem nenhum handler OPTIONS e continua assim).
//
// TODA saída é 204, inclusive key inválida/JSON quebrado/payload grande: o
// sendBeacon ignora a resposta e um 204 uniforme não vira oracle de keys.

export const dynamic = 'force-dynamic';

const SID_REGEX = /^[a-z0-9]{8,32}$/i;
const DEVICES = new Set(['mobile', 'tablet', 'desktop']);
const MAX_BODY = 32_768;
const MAX_CLICKS = 50;

const noContent = () => new Response(null, { status: 204 });

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? Math.round(v) : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function str(v: unknown, maxLen: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, maxLen) : null;
}

// Reconstrói cada clique campo a campo — nada do payload cru vai pro JSONB.
function sanitizeClicks(raw: unknown): LpClick[] {
  if (!Array.isArray(raw)) return [];
  const out: LpClick[] = [];
  for (const item of raw.slice(0, MAX_CLICKS)) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const x = clampInt(c.x, 0, 100_000);
    const y = clampInt(c.y, 0, 1_000_000);
    if (x === null || y === null) continue;
    const xp = typeof c.xp === 'number' && Number.isFinite(c.xp) ? Math.min(Math.max(c.xp, 0), 1) : 0;
    const yp = typeof c.yp === 'number' && Number.isFinite(c.yp) ? Math.min(Math.max(c.yp, 0), 1) : 0;
    out.push({
      x, y,
      xp: Math.round(xp * 10_000) / 10_000,
      yp: Math.round(yp * 10_000) / 10_000,
      el: str(c.el, 80) ?? 'unknown',
      txt: str(c.txt, 40) ?? '',
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (!raw || raw.length > MAX_BODY) return noContent();
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return noContent();
  }

  const key = typeof body.k === 'string' ? body.k : '';
  const sid = typeof body.sid === 'string' ? body.sid : '';
  if (!TRACKING_KEY_REGEX.test(key) || !SID_REGEX.test(sid)) return noContent();

  const pool = makeServerPool();
  try {
    await ensureLpAnalyticsSchema(pool);
    const { rows: [lp] } = await pool.query(
      `SELECT id FROM public.client_landing_pages WHERE tracking_key = $1 AND active`,
      [key],
    );
    if (!lp) {
      await pool.end().catch(() => null);
      return noContent();
    }

    const device = typeof body.d === 'string' && DEVICES.has(body.d) ? body.d : null;
    const clicks = sanitizeClicks(body.clicks);

    // Upsert fire-and-forget (padrão /r/[slug]): não bloqueia a resposta.
    // GREATEST protege contra beacons fora de ordem (flush de 20s chegando
    // depois do pagehide); clicks substitui porque o snapshot é acumulado —
    // o mais novo é superconjunto do anterior.
    pool.query(
      `INSERT INTO public.lp_sessions
         (lp_id, session_key, device, viewport_w, viewport_h, doc_height,
          url_path, utm_source, utm_medium, utm_campaign, referrer,
          max_scroll_pct, duration_ms, clicks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (lp_id, session_key) DO UPDATE SET
         max_scroll_pct = GREATEST(lp_sessions.max_scroll_pct, EXCLUDED.max_scroll_pct),
         duration_ms    = GREATEST(lp_sessions.duration_ms, EXCLUDED.duration_ms),
         doc_height     = COALESCE(EXCLUDED.doc_height, lp_sessions.doc_height),
         clicks         = EXCLUDED.clicks`,
      [
        lp.id as string,
        sid.toLowerCase(),
        device,
        clampInt(body.vw, 0, 50_000),
        clampInt(body.vh, 0, 50_000),
        clampInt(body.dh, 0, 1_000_000),
        str(body.p, 300),
        str(body.us, 120),
        str(body.um, 120),
        str(body.uc, 120),
        str(body.r, 300),
        clampInt(body.sp, 0, 100) ?? 0,
        clampInt(body.ms, 0, 14_400_000) ?? 0,
        JSON.stringify(clicks),
      ],
    ).catch(() => null).finally(() => pool.end().catch(() => null));

    return noContent();
  } catch {
    await pool.end().catch(() => null);
    return noContent();
  }
}
