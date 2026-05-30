import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientInstance, sendFollowupMessage, interpolate } from '@/lib/followup-send';
import type { FollowupVars } from '@/lib/followup-send';

// Manual trigger — processes pending/expired follow-ups for a specific client.
// No cron secret needed since it's scoped to clientId (user-initiated).
export async function POST(req: NextRequest) {
  const { clientId } = await req.json().catch(() => ({})) as { clientId?: string };
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  let sent = 0;
  let expired = 0;

  try {
    // ── 1. Send pending (scheduled_at <= now) ────────────────────────────────
    const { rows: pending } = await pool.query(`
      SELECT
        e.id, e.lead_id, e.client_id, e.regra_id, e.mensagem_id,
        m.tipo, m.conteudo, m.timer_sem_resposta_horas,
        l.numero, l.nome AS lead_nome, l.status AS lead_status, l.canal, l.origin
      FROM public.crm_followup_execucoes e
      JOIN public.crm_followup_mensagens m ON m.id = e.mensagem_id
      JOIN public.crm_leads l ON l.id = e.lead_id
      WHERE e.status = 'aguardando_envio'
        AND e.scheduled_at <= NOW()
        AND e.client_id = $1
      ORDER BY e.scheduled_at ASC
      LIMIT 20
    `, [clientId]);

    for (const exec of pending) {
      if (!exec.numero) continue;
      const instance = await getClientInstance(pool, exec.client_id);
      if (!instance) continue;

      const vars: FollowupVars = {
        nome: exec.lead_nome ?? exec.numero, telefone: exec.numero,
        status: exec.lead_status ?? '', campanha: exec.origin ?? exec.canal ?? '',
      };
      const result = await sendFollowupMessage({ instance, phone: exec.numero, tipo: exec.tipo, conteudo: exec.conteudo, vars });
      if (result.ok) {
        const expiraEm = new Date(Date.now() + Number(exec.timer_sem_resposta_horas) * 3_600_000).toISOString();
        await pool.query(
          `UPDATE public.crm_followup_execucoes SET status='aguardando_resposta', enviado_em=NOW(), expira_em=$1 WHERE id=$2`,
          [expiraEm, exec.id],
        );
        const msgText = exec.tipo === 'texto' ? interpolate(exec.conteudo, vars) : `[${exec.tipo}] ${exec.conteudo}`;
        await pool.query(
          `INSERT INTO public.crm_messages (lead_id, client_id, direction, text) VALUES ($1,$2,'out',$3)`,
          [exec.lead_id, exec.client_id, msgText],
        ).catch(() => null);
        sent++;
      }
    }

    // ── 2. Process expired ────────────────────────────────────────────────────
    const { rows: expiredExecs } = await pool.query(`
      SELECT e.id, e.lead_id, e.client_id, e.regra_id, e.mensagem_id,
             m.acao_sem_resposta, m.status_destino, m.ordem AS msg_ordem
      FROM public.crm_followup_execucoes e
      JOIN public.crm_followup_mensagens m ON m.id = e.mensagem_id
      WHERE e.status = 'aguardando_resposta' AND e.expira_em <= NOW() AND e.client_id = $1
      LIMIT 20
    `, [clientId]);

    for (const exec of expiredExecs) {
      await pool.query(`UPDATE public.crm_followup_execucoes SET status='expirado' WHERE id=$1`, [exec.id]);

      if (exec.acao_sem_resposta === 'mover_status' && exec.status_destino) {
        await pool.query(`UPDATE public.crm_leads SET status=$1, updated_at=NOW() WHERE id=$2`, [exec.status_destino, exec.lead_id]);
        const { rows: [nr] } = await pool.query(
          `SELECT id FROM public.crm_followup_regras WHERE client_id=$1 AND status_gatilho=$2 AND ativo=true LIMIT 1`,
          [exec.client_id, exec.status_destino],
        );
        if (nr) {
          const { rows: [nm] } = await pool.query(
            `SELECT id, delay_minutos FROM public.crm_followup_mensagens WHERE regra_id=$1 ORDER BY ordem ASC LIMIT 1`, [nr.id],
          );
          if (nm) {
            const scheduledAt = new Date(Date.now() + Number(nm.delay_minutos) * 60_000).toISOString();
            await pool.query(
              `INSERT INTO public.crm_followup_execucoes (lead_id,client_id,regra_id,mensagem_id,status,scheduled_at) VALUES($1,$2,$3,$4,'aguardando_envio',$5)`,
              [exec.lead_id, exec.client_id, nr.id, nm.id, scheduledAt],
            );
          }
        }
      } else if (exec.acao_sem_resposta === 'proxima_mensagem') {
        const { rows: [nm] } = await pool.query(
          `SELECT id, delay_minutos FROM public.crm_followup_mensagens WHERE regra_id=$1 AND ordem=$2 LIMIT 1`,
          [exec.regra_id, (exec.msg_ordem as number) + 1],
        );
        if (nm) {
          const scheduledAt = new Date(Date.now() + Number(nm.delay_minutos) * 60_000).toISOString();
          await pool.query(
            `INSERT INTO public.crm_followup_execucoes (lead_id,client_id,regra_id,mensagem_id,status,scheduled_at) VALUES($1,$2,$3,$4,'aguardando_envio',$5)`,
            [exec.lead_id, exec.client_id, exec.regra_id, nm.id, scheduledAt],
          );
        }
      }
      expired++;
    }

    return Response.json({ ok: true, sent, expired });
  } finally {
    await pool.end();
  }
}
