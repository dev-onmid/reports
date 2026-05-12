import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import type { AdSetTargeting } from '@/app/api/meta/campaigns/[id]/adsets/route';

type UpdateBody = {
  connectionId: string;
  targeting: AdSetTargeting;
  daily_budget?: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: adsetId } = await params;
  const body = await req.json() as UpdateBody;
  const { connectionId, targeting, daily_budget } = body;

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      conn = rows[0] ?? null;
    }
    if (!conn) {
      const { rows } = await pool.query(
        `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
      );
      conn = rows[0] ?? null;
    }
  } finally {
    await pool.end();
  }

  if (!conn) return Response.json({ error: 'Conexão Meta não encontrada.' }, { status: 404 });

  const token = await getFreshMetaToken(conn);

  // Build a clean targeting object with only writable fields.
  // Sending computed/read-only fields from the GET response causes "Invalid parameter".
  const cleanTargeting: Record<string, unknown> = {};

  if (targeting.age_min != null) cleanTargeting.age_min = targeting.age_min;
  if (targeting.age_max != null) cleanTargeting.age_max = targeting.age_max;

  // genders: [] means all — omit the field, Meta treats missing as all
  if (targeting.genders && targeting.genders.length > 0) {
    cleanTargeting.genders = targeting.genders;
  }

  // geo_locations: only include non-empty sub-arrays
  if (targeting.geo_locations) {
    const geo: Record<string, unknown> = {};
    const countries = targeting.geo_locations.countries ?? [];
    const cities = (targeting.geo_locations.cities ?? []).filter(c => c.key);
    const regions = (targeting.geo_locations.regions ?? []).filter(r => r.key);
    if (countries.length > 0) geo.countries = countries;
    if (cities.length > 0) geo.cities = cities.map(c => ({ key: c.key }));
    if (regions.length > 0) geo.regions = regions.map(r => ({ key: r.key }));
    if (Object.keys(geo).length > 0) cleanTargeting.geo_locations = geo;
  }

  // flexible_spec: only send interests/behaviors with valid id+name pairs
  if (targeting.flexible_spec && targeting.flexible_spec.length > 0) {
    const specs = targeting.flexible_spec.map(spec => {
      const s: Record<string, unknown> = {};
      if (spec.interests?.length) s.interests = spec.interests.map(i => ({ id: i.id, name: i.name }));
      if (spec.behaviors?.length) s.behaviors = spec.behaviors.map(b => ({ id: b.id, name: b.name }));
      return s;
    }).filter(s => Object.keys(s).length > 0);
    if (specs.length > 0) cleanTargeting.flexible_spec = specs;
  }

  const payload: Record<string, unknown> = { targeting: cleanTargeting, access_token: token };
  if (daily_budget != null) payload.daily_budget = Math.round(daily_budget * 100);

  const res = await fetch(`https://graph.facebook.com/v21.0/${adsetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    return Response.json({ error: err.error?.message ?? `Meta API HTTP ${res.status}` }, { status: res.status });
  }

  return Response.json({ ok: true });
}
