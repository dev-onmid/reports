import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientInstance, sendFollowupMessage, interpolate } from '@/lib/followup-send';
import type { FollowupVars } from '@/lib/followup-send';

// Chamado pelo cron do GitHub Actions (.github/workflows/crm-followup-worker.yml)
// a cada 5 min. Aceita o CRON_SECRET global OU o CRM_CRON_SECRET dedicado —
// o CRON_SECRET da Vercel é "Sensitive" (write-only, ninguém consegue ler o
// valor de volta), então este worker novo usa um secret próprio conhecido,
// sem precisar rotacionar o global (o que quebraria os outros 6 crons).
export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  const expected = [process.env.CRON_SECRET, process.env.CRM_CRON_SECRET].filter(Boolean);
  if (!secret || !expected.includes(secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  const deadline = Date.now() + 25_000; // 25s budget (Vercel limit is 30s for hobby)
  let sent = 0;
  let expired = 0;

  try {
    // ── 1. Send pending messages whose scheduled_at has arrived ──────────────
    const { rows: pending } = await pool.query(`
      SELECT
        e.id, e.lead_id, e.client_id, e.regra_id, e.mensagem_id,
        m.tipo, m.conteudo, m.timer_sem_resposta_horas, m.delay_minutos,
        l.numero, l.nome AS lead_nome, l.status AS lead_status, l.canal,
        l.origin, l.time_interno
      FROM public.crm_followup_execucoes e
      JOIN public.crm_followup_mensagens m ON m.id = e.mensagem_id
      JOIN public.crm_leads l ON l.id = e.lead_id
      WHERE e.status = 'aguardando_envio' AND e.scheduled_at <= NOW()
      ORDER BY e.scheduled_at ASC
      LIMIT 20
    `);

    for (const exec of pending) {
      if (Date.now() > deadline) break;
      if (exec.time_interno === true) {
        await pool.query(
          `UPDATE public.crm_followup_execucoes SET status = 'cancelado' WHERE id = $1`,
          [exec.id],
        );
        continue;
      }
      if (!exec.numero) {
        await pool.query(
          `UPDATE public.crm_followup_execucoes SET status = 'cancelado' WHERE id = $1`,
          [exec.id],
        );
        continue;
      }

      const instance = await getClientInstance(pool, exec.client_id);
      if (!instance) {
        await pool.query(
          `UPDATE public.crm_followup_execucoes SET status = 'cancelado' WHERE id = $1`,
          [exec.id],
        );
        continue;
      }

      const vars: FollowupVars = {
        nome:     exec.lead_nome ?? exec.numero,
        telefone: exec.numero,
        status:   exec.lead_status ?? '',
        campanha: exec.origin ?? exec.canal ?? '',
      };

      const result = await sendFollowupMessage({
        instance,
        phone: exec.numero,
        tipo: exec.tipo,
        conteudo: exec.conteudo,
        vars,
      });

      if (result.ok) {
        const timerHoras = Number(exec.timer_sem_resposta_horas ?? 24);
        const expiraEm = new Date(Date.now() + timerHoras * 3_600_000).toISOString();
        await pool.query(
          `UPDATE public.crm_followup_execucoes
             SET status = 'aguardando_resposta', enviado_em = NOW(), expira_em = $1
           WHERE id = $2`,
          [expiraEm, exec.id],
        );
        // Save outbound message to crm_messages
        const msgText = exec.tipo === 'texto' ? interpolate(exec.conteudo, vars) : `[${exec.tipo}] ${exec.conteudo}`;
        await pool.query(
          `INSERT INTO public.crm_messages (lead_id, client_id, direction, text)
           VALUES ($1, $2, 'out', $3)`,
          [exec.lead_id, exec.client_id, msgText],
        ).catch(() => null); // non-fatal
        sent++;
      } else {
        // Retry: keep as aguardando_envio, will be retried next run
        console.error('[followup worker] send failed:', result.error);
      }
    }

    // ── 2. Handle expired executions ─────────────────────────────────────────
    const { rows: expiredExecs } = await pool.query(`
      SELECT
        e.id, e.lead_id, e.client_id, e.regra_id, e.mensagem_id,
        m.acao_sem_resposta, m.status_destino, m.ordem AS msg_ordem,
        m.timer_sem_resposta_horas
      FROM public.crm_followup_execucoes e
      JOIN public.crm_followup_mensagens m ON m.id = e.mensagem_id
      JOIN public.crm_leads l ON l.id = e.lead_id
      WHERE e.status = 'aguardando_resposta' AND e.expira_em <= NOW()
        AND COALESCE(l.time_interno, false) = false
      ORDER BY e.expira_em ASC
      LIMIT 20
    `);

    for (const exec of expiredExecs) {
      if (Date.now() > deadline) break;

      // Mark as expired
      await pool.query(
        `UPDATE public.crm_followup_execucoes SET status = 'expirado' WHERE id = $1`,
        [exec.id],
      );

      if (exec.acao_sem_resposta === 'mover_status' && exec.status_destino) {
        // Move lead to next status (this will trigger a new follow-up if a rule exists for that status)
        await pool.query(
          `UPDATE public.crm_leads SET status = $1, updated_at = NOW() WHERE id = $2`,
          [exec.status_destino, exec.lead_id],
        );
        // Trigger follow-up for the new status
        const { rows: [newRegra] } = await pool.query(
          `SELECT id FROM public.crm_followup_regras
           WHERE client_id = $1 AND status_gatilho = $2 AND ativo = true
           ORDER BY created_at ASC LIMIT 1`,
          [exec.client_id, exec.status_destino],
        );
        if (newRegra) {
          const { rows: [nextMsg] } = await pool.query(
            `SELECT id, delay_minutos FROM public.crm_followup_mensagens
             WHERE regra_id = $1 ORDER BY ordem ASC LIMIT 1`,
            [newRegra.id],
          );
          if (nextMsg) {
            const delay = Number(nextMsg.delay_minutos ?? 0);
            const scheduledAt = new Date(Date.now() + delay * 60_000).toISOString();
            await pool.query(
              `INSERT INTO public.crm_followup_execucoes
                 (lead_id, client_id, regra_id, mensagem_id, status, scheduled_at)
               VALUES ($1, $2, $3, $4, 'aguardando_envio', $5)`,
              [exec.lead_id, exec.client_id, newRegra.id, nextMsg.id, scheduledAt],
            );
          }
        }

      } else if (exec.acao_sem_resposta === 'proxima_mensagem') {
        // Send next message in sequence
        const { rows: [nextMsg] } = await pool.query(
          `SELECT id, delay_minutos FROM public.crm_followup_mensagens
           WHERE regra_id = $1 AND ordem = $2
           ORDER BY ordem ASC LIMIT 1`,
          [exec.regra_id, (exec.msg_ordem as number) + 1],
        );
        if (nextMsg) {
          const delay = Number(nextMsg.delay_minutos ?? 0);
          const scheduledAt = new Date(Date.now() + delay * 60_000).toISOString();
          await pool.query(
            `INSERT INTO public.crm_followup_execucoes
               (lead_id, client_id, regra_id, mensagem_id, status, scheduled_at)
             VALUES ($1, $2, $3, $4, 'aguardando_envio', $5)`,
            [exec.lead_id, exec.client_id, exec.regra_id, nextMsg.id, scheduledAt],
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
