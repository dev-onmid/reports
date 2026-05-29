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
      `SELECT id, direction, text, created_at
       FROM public.crm_messages
       WHERE lead_id = $1
       ORDER BY created_at ASC
       LIMIT 200`,
      [id],
    );
    return Response.json({ messages: rows });
  } finally {
    await pool.end();
  }
}
