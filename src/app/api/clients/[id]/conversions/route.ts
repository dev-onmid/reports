import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureConversionSchema, getConversionConfig, upsertConversionConfig } from '@/lib/conversions';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureConversionSchema(pool);
    const cfg = await getConversionConfig(pool, id);
    return Response.json(cfg ?? {});
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const pool = makeServerPool();
  try {
    const allowed = [
      'meta_pixel_id', 'meta_access_token', 'meta_test_event_code', 'meta_ativo',
      'google_customer_id', 'google_conversion_label_lead', 'google_conversion_label_contact',
      'google_conversion_label_purchase', 'google_api_secret', 'google_measurement_id', 'google_ativo',
    ];
    const data = Object.fromEntries(
      Object.entries(body).filter(([k]) => allowed.includes(k)),
    );
    await upsertConversionConfig(pool, id, data);
    const cfg = await getConversionConfig(pool, id);
    return Response.json(cfg);
  } finally {
    await pool.end();
  }
}
