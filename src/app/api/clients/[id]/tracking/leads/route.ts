import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, telefone, ctwa_clid, source_id, campanha,
              pixel_id, evento_lead_enviado, evento_compra_enviado,
              valor_compra, created_at
       FROM public.whatsapp_leads
       WHERE client_id = $1 AND created_at >= $2
       ORDER BY created_at DESC
       LIMIT 500`,
      [id, since.toISOString()],
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
