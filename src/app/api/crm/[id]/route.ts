import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { queueFollowupIfExists } from '@/lib/followup-send';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await req.json() as Record<string, unknown>;
  const pool = makeServerPool();
  try {
    // Read current status to detect changes
    const { rows: [current] } = await pool.query(
      `SELECT status, client_id FROM public.crm_leads WHERE id = $1`,
      [id],
    );

    const { rows: [lead] } = await pool.query(
      `UPDATE public.crm_leads SET
        mes=$1, data=$2, link_criativo=$3, nome=$4, numero=$5, canal=$6, emoji=$7,
        dia1=$8, dia2=$9, dia3=$10, dia4=$11, status=$12, data_agendada=$13,
        video_dra=$14, compareceu=$15, observacao=$16, orcamento=$17,
        fechou=$18, valor_rs=$19, pagamento=$20, analise_credito=$21,
        data_nasc=$22, bairro=$23, motivacoes=$24, dores=$25,
        updated_at=NOW()
       WHERE id=$26 RETURNING *`,
      [
        f.mes??null, f.data||null, f.link_criativo??null,
        f.nome??null, f.numero??null, f.canal??null, f.emoji??null,
        f.dia1??false, f.dia2??false, f.dia3??false, f.dia4??false,
        f.status??'Em Atendimento', f.data_agendada||null,
        f.video_dra??false, f.compareceu??false, f.observacao??null,
        f.orcamento||null, f.fechou??false, f.valor_rs||null,
        f.pagamento??null, f.analise_credito??false,
        f.data_nasc||null, f.bairro??null, f.motivacoes??null, f.dores??null,
        id,
      ]
    );
    if (!lead) return Response.json({ error: 'Not found' }, { status: 404 });

    // Queue follow-up if status changed
    const newStatus = (f.status ?? 'Em Atendimento') as string;
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
