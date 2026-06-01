import { makeServerPool } from '@/lib/server-db';
import type { NextRequest } from 'next/server';

// Consolidated admin view — all clients' leads
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') ?? null;
  const days = parseInt(searchParams.get('days') ?? '30', 10);
  const since = new Date();
  since.setDate(since.getDate() - days);

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT wl.id, wl.telefone, wl.ctwa_clid, wl.source_id, wl.campanha,
              wl.pixel_id, wl.evento_lead_enviado, wl.evento_compra_enviado,
              wl.valor_compra, wl.created_at, wl.client_id,
              c.name AS client_name
       FROM public.whatsapp_leads wl
       LEFT JOIN public.clients c ON c.id = wl.client_id
       WHERE ($1::text IS NULL OR wl.client_id = $1)
         AND wl.created_at >= $2
       ORDER BY wl.created_at DESC
       LIMIT 500`,
      [clientId, since.toISOString()],
    );
    return Response.json(rows);
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
