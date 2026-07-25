import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientMetaAdsToken } from '@/lib/meta-ad-resolver';

// POST /api/creative-library/enrich  { days, items: [{ clientId, adIds: [] }] }
// Enriquecimento best-effort dos criativos via Graph API: gasto (insights level=ad
// no período) + thumbnail do criativo. Cache 4h por (ad_id, days) — a mesma
// biblioteca é aberta várias vezes ao dia sem custo extra de API.

export const maxDuration = 60;

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

type EnrichEntry = { spend: number | null; thumbnail_url: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ensureCacheSchema(pool: any) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_ad_enrich_cache (
      ad_id TEXT NOT NULL,
      days INT NOT NULL,
      spend NUMERIC,
      thumbnail_url TEXT,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (ad_id, days)
    )
  `);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    days?: number;
    items?: Array<{ clientId: string; adIds: string[] }>;
  };
  const days = Math.min(Math.max(Number(body.days ?? 30), 1), 180);
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  if (items.length === 0) return Response.json({ ok: true, enrich: {} });

  const started = Date.now();
  const pool = makeServerPool();
  const enrich: Record<string, EnrichEntry> = {};

  try {
    await ensureCacheSchema(pool);

    const allIds = items.flatMap(i => (i.adIds ?? []).filter(id => /^\d{5,25}$/.test(String(id))));
    if (allIds.length === 0) return Response.json({ ok: true, enrich: {} });

    // 1) Cache primeiro
    const { rows: cached } = await pool.query<{ ad_id: string; spend: string | null; thumbnail_url: string | null; fetched_at: string }>(
      `SELECT ad_id, spend, thumbnail_url, fetched_at FROM public.meta_ad_enrich_cache
        WHERE days = $1 AND ad_id = ANY($2::text[])`,
      [days, allIds],
    );
    const fresh = new Set<string>();
    for (const c of cached) {
      const isFresh = Date.now() - new Date(c.fetched_at).getTime() < CACHE_TTL_MS;
      enrich[c.ad_id] = { spend: c.spend !== null ? Number(c.spend) : null, thumbnail_url: c.thumbnail_url };
      if (isFresh) fresh.add(c.ad_id);
    }

    const since = fmtDate(new Date(Date.now() - days * 86_400_000));
    const until = fmtDate(new Date());

    // 2) Busca na Graph o que falta (por cliente, lotes de 40 ids)
    for (const item of items) {
      if (Date.now() - started > 45_000) break;
      const pending = (item.adIds ?? [])
        .filter(id => /^\d{5,25}$/.test(String(id)) && !fresh.has(String(id)));
      if (pending.length === 0) continue;

      const token = await getClientMetaAdsToken(pool, item.clientId).catch(() => null);
      if (!token) continue;

      for (let i = 0; i < pending.length && Date.now() - started < 45_000; i += 40) {
        const batch = pending.slice(i, i + 40);
        const url = new URL('https://graph.facebook.com/v21.0/');
        url.searchParams.set('ids', batch.join(','));
        url.searchParams.set(
          'fields',
          `creative{thumbnail_url},insights.time_range({'since':'${since}','until':'${until}'}){spend}`,
        );
        url.searchParams.set('access_token', token);
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) }).catch(() => null);
        if (!res?.ok) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json = await res.json().catch(() => null) as Record<string, any> | null;
        if (!json) continue;

        for (const adId of batch) {
          const node = json[adId];
          if (!node) continue;
          const spendRaw = node.insights?.data?.[0]?.spend;
          const entry: EnrichEntry = {
            spend: spendRaw !== undefined && spendRaw !== null ? Number(spendRaw) : null,
            thumbnail_url: node.creative?.thumbnail_url ?? enrich[adId]?.thumbnail_url ?? null,
          };
          enrich[adId] = entry;
          await pool.query(
            `INSERT INTO public.meta_ad_enrich_cache (ad_id, days, spend, thumbnail_url, fetched_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (ad_id, days) DO UPDATE SET
               spend = EXCLUDED.spend,
               thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, meta_ad_enrich_cache.thumbnail_url),
               fetched_at = NOW()`,
            [adId, days, entry.spend, entry.thumbnail_url],
          ).catch(() => null);
        }
      }
    }

    return Response.json({ ok: true, enrich });
  } catch (err) {
    console.error('[creative-library enrich]', err);
    return Response.json({ ok: true, enrich }, { status: 200 });
  } finally {
    await pool.end();
  }
}
