import type { Pool } from 'pg';
import { sendText as zapiSendText, sendImage as zapiSendImage } from '@/lib/zapi';

// ── Types ────────────────────────────────────────────────────────────────────

export type WaInstance = {
  instanceId: string;
  token: string;
  provider: 'zapi' | 'evolution';
};

export type FollowupVars = {
  nome?: string;
  telefone?: string;
  status?: string;
  campanha?: string;
  [key: string]: string | undefined;
};

// ── Instance resolver ────────────────────────────────────────────────────────

export async function getClientInstance(pool: Pool, clientId: string): Promise<WaInstance | null> {
  const { rows: [inst] } = await pool.query(
    `SELECT instance_id, token, provider FROM public.client_zapi_instances
     WHERE client_id = $1 AND ativo = true
     ORDER BY created_at ASC LIMIT 1`,
    [clientId],
  );
  if (!inst) return null;
  return {
    instanceId: inst.instance_id,
    token: inst.token,
    provider: inst.provider === 'evolution' ? 'evolution' : 'zapi',
  };
}

// ── Template interpolation ────────────────────────────────────────────────────

export function interpolate(template: string, vars: FollowupVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Send dispatcher ──────────────────────────────────────────────────────────

export async function sendFollowupMessage({
  instance,
  phone,
  tipo,
  conteudo,
  vars,
}: {
  instance: WaInstance;
  phone: string;
  tipo: string;       // 'texto' | 'imagem' | 'audio' | 'video' | 'documento'
  conteudo: string;   // text content or media URL
  vars: FollowupVars;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    if (instance.provider === 'evolution') {
      return sendViaEvolution(instance, phone, tipo, conteudo, vars);
    }
    return sendViaZapi(instance, phone, tipo, conteudo, vars);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function sendViaZapi(
  instance: WaInstance,
  phone: string,
  tipo: string,
  conteudo: string,
  vars: FollowupVars,
): Promise<{ ok: boolean; error?: string }> {
  const client = { instanceId: instance.instanceId, token: instance.token };

  if (tipo === 'imagem') {
    const caption = vars.caption ? interpolate(vars.caption, vars) : '';
    return zapiSendImage(client, phone, conteudo, caption);
  }

  // texto, audio, video, documento — fall back to text for now
  const text = interpolate(conteudo, vars);
  return zapiSendText(client, phone, text);
}

async function sendViaEvolution(
  instance: WaInstance,
  phone: string,
  tipo: string,
  conteudo: string,
  vars: FollowupVars,
): Promise<{ ok: boolean; error?: string }> {
  const base = process.env.EVOLUTION_API_URL;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!base || !apikey) return { ok: false, error: 'Evolution API not configured' };

  const instanceName = instance.instanceId;
  const headers = { 'Content-Type': 'application/json', apikey };

  if (tipo === 'texto') {
    const text = interpolate(conteudo, vars);

    // Try v2 format first (more common in recent Evolution API versions)
    const v2Res = await fetch(`${base}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        number: phone,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text },
      }),
    });
    if (v2Res.ok) return { ok: true };

    // Fallback: simpler format used by some versions
    const v1Res = await fetch(`${base}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: phone, text }),
    });
    if (v1Res.ok) return { ok: true };

    // Both failed — return the last error body
    const errText = await v1Res.text().catch(() => 'unknown error');
    return { ok: false, error: `Evolution sendText failed: ${errText}` };
  }

  const mediatype =
    tipo === 'imagem' ? 'image'
    : tipo === 'audio' ? 'audio'
    : tipo === 'video' ? 'video'
    : 'document';

  const res = await fetch(`${base}/message/sendMedia/${instanceName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      number: phone,
      options: { delay: 1200 },
      mediaMessage: {
        mediatype,
        media: conteudo,
        caption: tipo !== 'audio' ? interpolate(vars.caption ?? '', vars) : undefined,
        ptt: tipo === 'audio',
      },
    }),
  });
  if (!res.ok) return { ok: false, error: await res.text() };
  return { ok: true };
}

// ── Queue follow-up on status change ─────────────────────────────────────────
// When delay_minutos = 0, sends immediately (no cron dependency).
// When delay_minutos > 0, saves as 'aguardando_envio' for the worker to pick up.

export async function queueFollowupIfExists(
  pool: Pool,
  leadId: string,
  clientId: string,
  newStatus: string,
): Promise<void> {
  const { rows: [guard] } = await pool.query(
    `SELECT time_interno FROM public.crm_leads WHERE id = $1`,
    [leadId],
  ).catch(() => ({ rows: [] as Array<{ time_interno?: boolean }> }));
  if (guard?.time_interno === true) return;

  // Find active rule for this status
  const { rows: [regra] } = await pool.query(
    `SELECT id FROM public.crm_followup_regras
     WHERE client_id = $1 AND status_gatilho = $2 AND ativo = true
     ORDER BY created_at ASC LIMIT 1`,
    [clientId, newStatus],
  );
  if (!regra) return;

  // Get first message (ordem = 1)
  const { rows: [msg] } = await pool.query(
    `SELECT id, delay_minutos, timer_sem_resposta_horas, tipo, conteudo
     FROM public.crm_followup_mensagens
     WHERE regra_id = $1 ORDER BY ordem ASC LIMIT 1`,
    [regra.id],
  );
  if (!msg) return;

  // Cancel any pending executions for this lead
  await pool.query(
    `UPDATE public.crm_followup_execucoes
     SET status = 'cancelado'
     WHERE lead_id = $1 AND status IN ('aguardando_envio', 'aguardando_resposta')`,
    [leadId],
  );

  const delay = Number(msg.delay_minutos ?? 0);

  if (delay === 0) {
    // Send immediately — no cron needed
    const { rows: [lead] } = await pool.query(
      `SELECT numero, nome, status, origin, canal, time_interno FROM public.crm_leads WHERE id = $1`,
      [leadId],
    );
    if (lead?.time_interno === true) return;
    if (lead?.numero) {
      const instance = await getClientInstance(pool, clientId);
      if (instance) {
        const vars: FollowupVars = {
          nome:     lead.nome ?? lead.numero,
          telefone: lead.numero,
          status:   newStatus,
          campanha: lead.origin ?? lead.canal ?? '',
        };
        // Support multi-part messages (partes field)
        const partes: { tipo: string; conteudo: string }[] =
          Array.isArray(msg.partes) && msg.partes.length > 0
            ? msg.partes
            : [{ tipo: msg.tipo, conteudo: msg.conteudo }];
        let lastResult: { ok: boolean; error?: string } = { ok: false, error: 'no parts' };
        for (const parte of partes) {
          lastResult = await sendFollowupMessage({ instance, phone: lead.numero, tipo: parte.tipo, conteudo: parte.conteudo, vars });
        }
        const result = lastResult;
        const timerHoras = Number(msg.timer_sem_resposta_horas ?? 24);
        const expiraEm = new Date(Date.now() + timerHoras * 3_600_000).toISOString();
        await pool.query(
          `INSERT INTO public.crm_followup_execucoes
             (lead_id, client_id, regra_id, mensagem_id, status, scheduled_at, enviado_em, expira_em)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6)`,
          [leadId, clientId, regra.id, msg.id, result.ok ? 'aguardando_resposta' : 'aguardando_envio', expiraEm],
        );
        // Save outbound message
        if (result.ok) {
          const msgText = msg.tipo === 'texto' ? interpolate(msg.conteudo, vars) : `[${msg.tipo}] ${msg.conteudo}`;
          await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text) VALUES ($1, $2, 'out', $3)`,
            [leadId, clientId, msgText],
          ).catch(() => null);
        }
        return;
      }
    }
  }

  // Delayed send — worker will pick it up
  const scheduledAt = new Date(Date.now() + delay * 60_000).toISOString();
  await pool.query(
    `INSERT INTO public.crm_followup_execucoes
       (lead_id, client_id, regra_id, mensagem_id, status, scheduled_at)
     VALUES ($1, $2, $3, $4, 'aguardando_envio', $5)`,
    [leadId, clientId, regra.id, msg.id, scheduledAt],
  );
}

// ── Mark executions responded when lead sends a message ──────────────────────

export async function markLeadResponded(pool: Pool, leadId: string): Promise<void> {
  const { rows: [lead] } = await pool.query(
    `SELECT time_interno FROM public.crm_leads WHERE id = $1`,
    [leadId],
  ).catch(() => ({ rows: [] as Array<{ time_interno?: boolean }> }));
  if (lead?.time_interno === true) return;

  await pool.query(
    `UPDATE public.crm_followup_execucoes
     SET status = 'respondido', respondido_em = NOW()
     WHERE lead_id = $1 AND status IN ('aguardando_envio', 'aguardando_resposta')`,
    [leadId],
  );
}
