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

  // Build a clean targeting object.
  // We keep the original geo_locations intact (including location_types etc.)
  // and only override the sub-fields the user edited.
  // Top-level computed fields from Meta's GET response are excluded.
  const WRITABLE_TOP_LEVEL = new Set([
    'age_min', 'age_max', 'genders',
    'geo_locations', 'flexible_spec', 'exclusions',
    'custom_audiences', 'excluded_custom_audiences',
    'targeting_optimization', 'publisher_platforms',
    'facebook_positions', 'instagram_positions',
    'audience_network_positions', 'device_platforms',
    'user_os', 'user_device',
  ]);

  // Start from original targeting, keep only writable fields
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalTargeting = targeting as Record<string, any>;
  const cleanTargeting: Record<string, unknown> = {};
  for (const key of Object.keys(originalTargeting)) {
    if (WRITABLE_TOP_LEVEL.has(key)) cleanTargeting[key] = originalTargeting[key];
  }

  // Apply edited values
  if (targeting.age_min != null) cleanTargeting.age_min = targeting.age_min;
  if (targeting.age_max != null) cleanTargeting.age_max = targeting.age_max;

  // genders: [] means all — omit the field
  if (!targeting.genders || targeting.genders.length === 0) {
    delete cleanTargeting.genders;
  } else {
    cleanTargeting.genders = targeting.genders;
  }

  // geo_locations: keep original structure, only replace countries/cities/regions
  if (targeting.geo_locations) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origGeo: Record<string, any> = { ...(originalTargeting.geo_locations ?? {}) };
    const countries = targeting.geo_locations.countries ?? [];
    const cities = (targeting.geo_locations.cities ?? []).filter(c => c.key);
    const regions = (targeting.geo_locations.regions ?? []).filter(r => r.key);
    if (countries.length > 0) origGeo.countries = countries;
    else delete origGeo.countries;
    if (cities.length > 0) origGeo.cities = cities.map(c => ({ key: c.key }));
    else delete origGeo.cities;
    if (regions.length > 0) origGeo.regions = regions.map(r => ({ key: r.key }));
    else delete origGeo.regions;
    // Remove empty arrays that Meta rejects
    for (const k of Object.keys(origGeo)) {
      if (Array.isArray(origGeo[k]) && origGeo[k].length === 0) delete origGeo[k];
    }
    cleanTargeting.geo_locations = origGeo;
  }

  // flexible_spec: only send id+name pairs
  if (targeting.flexible_spec && targeting.flexible_spec.length > 0) {
    const specs = targeting.flexible_spec.map(spec => {
      const s: Record<string, unknown> = {};
      if (spec.interests?.length) s.interests = spec.interests.map(i => ({ id: i.id, name: i.name }));
      if (spec.behaviors?.length) s.behaviors = spec.behaviors.map(b => ({ id: b.id, name: b.name }));
      return s;
    }).filter(s => Object.keys(s).length > 0);
    if (specs.length > 0) cleanTargeting.flexible_spec = specs;
    else delete cleanTargeting.flexible_spec;
  }

  const payload: Record<string, unknown> = { targeting: cleanTargeting, access_token: token };
  if (daily_budget != null) payload.daily_budget = Math.round(daily_budget * 100);

  const res = await fetch(`https://graph.facebook.com/v21.0/${adsetId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string; error_user_msg?: string; error_data?: unknown } };
    const msg = err.error?.error_user_msg ?? err.error?.message ?? `Meta API HTTP ${res.status}`;
    return Response.json({ error: msg, detail: err.error }, { status: res.status });
  }

  return Response.json({ ok: true });
}
