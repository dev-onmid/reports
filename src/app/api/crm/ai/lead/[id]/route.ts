import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);
    const { rows: [lead] } = await pool.query(
      `SELECT temperatura, temperatura_atualizada_em, ia_ultimo_analise,
              ia_confianca_ultimo, time_interno
         FROM public.crm_leads
        WHERE id = $1`,
      [id],
    );
    const { rows: [last] } = await pool.query(
      `SELECT motivo_ia, confianca, created_at
         FROM public.crm_ia_historico
        WHERE lead_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [id],
    );
    return Response.json({ lead: lead ?? null, last: last ?? null });
  } finally {
    await pool.end();
  }
}
