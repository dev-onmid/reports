import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: regraId } = await params;
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, ordem, tipo, conteudo, delay_minutos,
              timer_sem_resposta_horas, acao_sem_resposta, status_destino, created_at
         FROM public.crm_followup_mensagens
        WHERE regra_id = $1
        ORDER BY ordem ASC`,
      [regraId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: regraId } = await params;
  const body = await req.json().catch(() => ({})) as {
    tipo?: string;
    conteudo?: string;
    delay_minutos?: number;
    timer_sem_resposta_horas?: number;
    acao_sem_resposta?: string;
    status_destino?: string;
  };

  const pool = makeServerPool();
  try {
    // Get next ordem
    const { rows: [{ max_ordem }] } = await pool.query(
      `SELECT COALESCE(MAX(ordem), 0)::int AS max_ordem FROM public.crm_followup_mensagens WHERE regra_id = $1`,
      [regraId],
    );

    const { rows: [msg] } = await pool.query(
      `INSERT INTO public.crm_followup_mensagens
         (regra_id, ordem, tipo, conteudo, delay_minutos, timer_sem_resposta_horas, acao_sem_resposta, status_destino)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, ordem, tipo, conteudo, delay_minutos, timer_sem_resposta_horas, acao_sem_resposta, status_destino`,
      [
        regraId,
        (max_ordem as number) + 1,
        body.tipo ?? 'texto',
        body.conteudo ?? '',
        body.delay_minutos ?? 0,
        body.timer_sem_resposta_horas ?? 24,
        body.acao_sem_resposta ?? 'mover_status',
        body.status_destino ?? null,
      ],
    );
    return Response.json(msg, { status: 201 });
  } finally {
    await pool.end();
  }
}
