import { makeServerPool } from '@/lib/server-db';
import type { SaleEntry } from '@/app/api/clients/[id]/sheets/route';

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
    return Response.json(rows.map(r => {
      const result = r.sheets_result as { sales?: SaleEntry[]; total?: number } | null;
      return {
        clientId: r.id,
        sales: result?.sales ?? [],
        total: result?.total ?? 0,
        analyzedAt: r.sheets_analyzed_at,
      };
    }));
  } finally {
    await pool.end();
  }
}
