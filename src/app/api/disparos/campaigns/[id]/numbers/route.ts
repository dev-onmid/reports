import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT phone, name, status, error_msg, sent_at
         FROM public.zapi_numbers
        WHERE campaign_id = $1
        ORDER BY position ASC`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
