import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    await pool.query(`
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_result JSONB;
      ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS sheets_analyzed_at TIMESTAMPTZ;
    `);
    const { rows } = await pool.query(`
      SELECT id, sheets_result, sheets_analyzed_at
        FROM public.clients
       WHERE sheets_result IS NOT NULL
    `);
    return Response.json(rows.map(r => ({
      clientId: r.id,
      total: (r.sheets_result as { total?: number })?.total ?? 0,
      analyzedAt: r.sheets_analyzed_at,
    })));
  } finally {
    await pool.end();
  }
}
