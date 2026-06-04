import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureConversionSchema } from '@/lib/conversions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const plataforma = url.searchParams.get('plataforma') ?? null;
  const days = Number(url.searchParams.get('days') ?? 30);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

  const pool = makeServerPool();
  try {
    await ensureConversionSchema(pool);
    const filters: string[] = [
      `client_id = $1`,
      `enviado_em >= NOW() - INTERVAL '${days} days'`,
    ];
    const values: unknown[] = [id];
    if (plataforma) {
      filters.push(`plataforma = $${values.length + 1}`);
      values.push(plataforma);
    }

    const { rows } = await pool.query(
      `SELECT id, lead_id, plataforma, event_name, event_id, telefone_hash,
              valor, status_resposta, resposta_body, enviado_em, sucesso
         FROM public.conversion_log
        WHERE ${filters.join(' AND ')}
        ORDER BY enviado_em DESC
        LIMIT ${limit}`,
      values,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
