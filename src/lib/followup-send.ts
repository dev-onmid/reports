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
    const res = await fetch(`${base}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: phone, options: { delay: 1200 }, textMessage: { text } }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
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

export async function queueFollowupIfExists(
  pool: Pool,
  leadId: string,
  clientId: string,
  newStatus: string,
): Promise<void> {
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
    `SELECT id, delay_minutos, timer_sem_resposta_horas FROM public.crm_followup_mensagens
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

  // Schedule the send
  const delay = Number(msg.delay_minutos ?? 0);
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
  await pool.query(
    `UPDATE public.crm_followup_execucoes
     SET status = 'respondido', respondido_em = NOW()
     WHERE lead_id = $1 AND status IN ('aguardando_envio', 'aguardando_resposta')`,
    [leadId],
  );
}
