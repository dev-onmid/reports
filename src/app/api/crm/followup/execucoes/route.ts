import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const leadId   = searchParams.get('leadId');

  if (!clientId && !leadId) {
    return Response.json({ error: 'clientId or leadId required' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const conditions: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (clientId) { conditions.push(`e.client_id = $${n++}`); vals.push(clientId); }
    if (leadId)   { conditions.push(`e.lead_id = $${n++}`);   vals.push(leadId); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
          e.id, e.lead_id, e.client_id, e.regra_id, e.mensagem_id,
          e.status, e.scheduled_at, e.enviado_em, e.expira_em,
          e.respondido_em, e.created_at,
          r.nome AS regra_nome,
          m.tipo AS msg_tipo, m.conteudo AS msg_conteudo, m.ordem AS msg_ordem,
          l.nome AS lead_nome, l.numero AS lead_numero
        FROM public.crm_followup_execucoes e
        JOIN public.crm_followup_regras r ON r.id = e.regra_id
        JOIN public.crm_followup_mensagens m ON m.id = e.mensagem_id
        JOIN public.crm_leads l ON l.id = e.lead_id
        ${where}
        ORDER BY e.created_at DESC
        LIMIT 200`,
      vals,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
