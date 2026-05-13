import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, client_id, client_name, title, period_from, period_to, generated_by, created_at
         FROM public.diagnostic_reports
         ${clientId ? 'WHERE client_id = $1' : ''}
         ORDER BY created_at DESC
         LIMIT 50`,
      clientId ? [clientId] : [],
    );
    return Response.json(rows);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === '42P01') return Response.json([]);
    throw e;
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'id obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.diagnostic_reports WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
