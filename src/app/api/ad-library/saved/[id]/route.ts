import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.saved_ads WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
