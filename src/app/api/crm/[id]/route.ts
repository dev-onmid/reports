import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { queueFollowupIfExists } from '@/lib/followup-send';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await req.json() as Record<string, unknown>;
  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);
    // Read current status to detect changes
    const { rows: [current] } = await pool.query(
      `SELECT * FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!current) return Response.json({ error: 'Not found' }, { status: 404 });

    const next = { ...current, ...f };

    const { rows: [lead] } = await pool.query(
      `UPDATE public.crm_leads SET
        mes=$1, data=$2, link_criativo=$3, nome=$4, numero=$5, canal=$6, emoji=$7,
        dia1=$8, dia2=$9, dia3=$10, dia4=$11, status=$12, data_agendada=$13,
        video_dra=$14, compareceu=$15, observacao=$16, orcamento=$17,
        fechou=$18, valor_rs=$19, pagamento=$20, analise_credito=$21,
        data_nasc=$22, bairro=$23, motivacoes=$24, dores=$25,
        temperatura=$26, time_interno=$27,
        updated_at=NOW()
       WHERE id=$28 RETURNING *`,
      [
        next.mes??null, next.data||null, next.link_criativo??null,
        next.nome??null, next.numero??null, next.canal??null, next.emoji??null,
        next.dia1??false, next.dia2??false, next.dia3??false, next.dia4??false,
        next.status??'Em Atendimento', next.data_agendada||null,
        next.video_dra??false, next.compareceu??false, next.observacao??null,
        next.orcamento||null, next.fechou??false, next.valor_rs||null,
        next.pagamento??null, next.analise_credito??false,
        next.data_nasc||null, next.bairro??null, next.motivacoes??null, next.dores??null,
        next.temperatura ?? null, next.time_interno === true,
        id,
      ]
    );
    if (!lead) return Response.json({ error: 'Not found' }, { status: 404 });

    // Queue follow-up if status changed
    const newStatus = (next.status ?? 'Em Atendimento') as string;
    if (current && lead.client_id && current.status !== newStatus) {
      await queueFollowupIfExists(pool, id, lead.client_id, newStatus).catch(() => null);
    }

    return Response.json(lead);
  } finally {
    await pool.end();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.crm_leads WHERE id = $1`, [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
