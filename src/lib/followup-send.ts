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
  whatsapp_lid?: string;
  [key: string]: string | undefined;
};

export type SendMessageResult = { ok: boolean; error?: string; externalId?: string; target?: string };

// ── Instance resolver ────────────────────────────────────────────────────────

export async function getClientInstance(pool: Pool, clientId: string): Promise<WaInstance | null> {
  // Prefer the Evolution instance when a client has both providers active —
  // Evolution is the live/primary instance; Z-API rows are legacy. All CRM paths
  // (inbox list, history, send) must agree on the same instance.
  const { rows: [inst] } = await pool.query(
    `SELECT instance_id, token, provider FROM public.client_zapi_instances
     WHERE client_id = $1 AND ativo = true
     ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
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
}): Promise<SendMessageResult> {
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
): Promise<SendMessageResult> {
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
): Promise<SendMessageResult> {
  const base = process.env.EVOLUTION_API_URL;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!base || !apikey) return { ok: false, error: 'Evolution API not configured' };

  const instanceName = instance.instanceId;
  const headers = { 'Content-Type': 'application/json', apikey };

  if (tipo === 'texto') {
    const text = interpolate(conteudo, vars);
    const targets = buildEvolutionTargets(phone, vars.whatsapp_lid);
    const errors: string[] = [];

    for (const target of targets) {
      // Try v2 format first (more common in recent Evolution API versions)
      const v2 = await postEvolutionMessage(`${base}/message/sendText/${instanceName}`, headers, {
        number: target,
        options: { delay: 1200, presence: 'composing' },
        textMessage: { text },
      });
      if (v2.ok) return { ...v2, target };
      errors.push(`${target}: ${v2.error ?? 'erro v2'}`);

      // Fallback: simpler format used by some versions
      const v1 = await postEvolutionMessage(`${base}/message/sendText/${instanceName}`, headers, { number: target, text });
      if (v1.ok) return { ...v1, target };
      errors.push(`${target}: ${v1.error ?? 'erro v1'}`);
    }

    return { ok: false, error: `Evolution sendText failed: ${errors.at(-1) ?? 'unknown error'}` };
  }

  const targets = buildEvolutionTargets(phone, vars.whatsapp_lid);
  const errors: string[] = [];

  // Evolution API expects either a plain http URL or raw base64 (no data: prefix).
  // Canvas uploads arrive as data URLs — strip the prefix before sending.
  function resolveMediaPayload(raw: string, mediatype: string) {
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.+)$/s);
    if (dataUrlMatch) {
      const mime = dataUrlMatch[1];
      const b64  = dataUrlMatch[2];
      const ext  = mime.split('/')[1] ?? 'bin';
      return { media: b64, mimetype: mime, fileName: `media.${ext}` };
    }
    // Plain URL — send both field names to cover Evolution API v1/v2 variants
    return { media: raw, mediaUrl: raw };
  }

  for (const target of targets) {
    // Voice notes (PTT) have their own endpoint — sendMedia with mediatype
    // "audio" doesn't render as a playable waveform bubble in WhatsApp.
    const result = tipo === 'audio'
      ? await postEvolutionMessage(`${base}/message/sendWhatsAppAudio/${instanceName}`, headers, {
          number: target,
          options: { delay: 1200, encoding: true },
          audio: conteudo,
        })
      : await postEvolutionMessage(`${base}/message/sendMedia/${instanceName}`, headers, {
          number: target,
          options: { delay: 1200 },
          mediatype: tipo === 'imagem' ? 'image' : tipo === 'video' ? 'video' : 'document',
          ...resolveMediaPayload(conteudo, tipo),
          caption: interpolate(vars.caption ?? '', vars),
        });
    if (result.ok) return { ...result, target };
    errors.push(`${target}: ${result.error ?? 'erro'}`);
  }

  return { ok: false, error: `Evolution sendMedia failed: ${errors.at(-1) ?? 'unknown error'}` };
}

function buildEvolutionTargets(phone: string, lid?: string): string[] {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  const lidDigits = String(lid ?? '').replace(/\D/g, '');
  const targets: string[] = [];

  if (raw.includes('@')) targets.push(raw);
  if (lidDigits) targets.push(`${lidDigits}@lid`);
  if (digits.length > 13 && !digits.startsWith('55')) targets.push(`${digits}@lid`);
  if (digits) targets.push(digits);
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) targets.push(`55${digits}`);

  return Array.from(new Set(targets.filter(Boolean)));
}

async function postEvolutionMessage(
  url: string,
  headers: { 'Content-Type': string; apikey: string },
  body: Record<string, unknown>,
): Promise<SendMessageResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* keep raw text */ }
  if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}` };
  return { ok: true, externalId: extractEvolutionMessageId(data) };
}

function extractEvolutionMessageId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const obj = data as Record<string, unknown>;
  const dataObj = asRecord(obj.data);
  const messageObj = asRecord(obj.message);
  const responseObj = asRecord(obj.response);
  const dataMessageObj = asRecord(dataObj?.message);
  const candidates = [
    asRecord(obj.key)?.id,
    asRecord(dataObj?.key)?.id,
    asRecord(messageObj?.key)?.id,
    asRecord(responseObj?.key)?.id,
    asRecord(dataMessageObj?.key)?.id,
    dataObj?.messageId,
    dataObj?.message_id,
    dataObj?.id,
    responseObj?.messageId,
    responseObj?.message_id,
    responseObj?.id,
    obj.messageId,
    obj.message_id,
    obj.id,
  ];
  for (const candidate of candidates) {
    const id = String(candidate ?? '').trim();
    if (id) return id;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
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
