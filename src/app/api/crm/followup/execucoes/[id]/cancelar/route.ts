import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [exec] } = await pool.query(
      `UPDATE public.crm_followup_execucoes
         SET status = 'cancelado'
       WHERE id = $1 AND status IN ('aguardando_envio', 'aguardando_resposta')
       RETURNING id, status`,
      [id],
    );
    if (!exec) return Response.json({ error: 'execução não encontrada ou já encerrada' }, { status: 404 });
    return Response.json({ ok: true, id: exec.id });
  } finally {
    await pool.end();
  }
}
