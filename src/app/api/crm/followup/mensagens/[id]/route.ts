import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    ordem?: number;
    tipo?: string;
    conteudo?: string;
    partes?: { tipo: string; conteudo: string }[] | null;
    delay_minutos?: number;
    timer_sem_resposta_horas?: number;
    acao_sem_resposta?: string;
    status_destino?: string | null;
  };

  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (body.ordem !== undefined)                    { sets.push(`ordem = $${n++}`);                    vals.push(body.ordem); }
    if (body.tipo !== undefined)                     { sets.push(`tipo = $${n++}`);                     vals.push(body.tipo); }
    if (body.conteudo !== undefined)                 { sets.push(`conteudo = $${n++}`);                 vals.push(body.conteudo); }
    if ('partes' in body)                            { sets.push(`partes = $${n++}`);                   vals.push(body.partes ? JSON.stringify(body.partes) : null); }
    if (body.delay_minutos !== undefined)            { sets.push(`delay_minutos = $${n++}`);            vals.push(body.delay_minutos); }
    if (body.timer_sem_resposta_horas !== undefined) { sets.push(`timer_sem_resposta_horas = $${n++}`); vals.push(body.timer_sem_resposta_horas); }
    if (body.acao_sem_resposta !== undefined)        { sets.push(`acao_sem_resposta = $${n++}`);        vals.push(body.acao_sem_resposta); }
    if ('status_destino' in body)                   { sets.push(`status_destino = $${n++}`);           vals.push(body.status_destino ?? null); }

    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });
    vals.push(id);

    const { rows: [msg] } = await pool.query(
      `UPDATE public.crm_followup_mensagens SET ${sets.join(', ')} WHERE id = $${n}
       RETURNING id, ordem, tipo, conteudo, partes, delay_minutos, timer_sem_resposta_horas, acao_sem_resposta, status_destino`,
      vals,
    );
    if (!msg) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(msg);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    // Reorder siblings after deletion
    const { rows: [msg] } = await pool.query(
      `DELETE FROM public.crm_followup_mensagens WHERE id = $1 RETURNING regra_id, ordem`,
      [id],
    );
    if (msg) {
      await pool.query(
        `UPDATE public.crm_followup_mensagens
           SET ordem = ordem - 1
         WHERE regra_id = $1 AND ordem > $2`,
        [msg.regra_id, msg.ordem],
      );
    }
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
