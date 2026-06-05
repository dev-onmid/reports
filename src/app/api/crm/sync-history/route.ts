import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureSchema(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS lead_id UUID`).catch(() => null);
  await pool.query(`ALTER TABLE public.crm_messages ALTER COLUMN contact_id DROP NOT NULL`).catch(() => null);
  await pool.query(`ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS external_id TEXT`).catch(() => null);
  await pool.query(`ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto'`).catch(() => null);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_lead_external_idx
      ON public.crm_messages (lead_id, external_id)
      WHERE external_id IS NOT NULL AND lead_id IS NOT NULL;
  `).catch(() => null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(msg: Record<string, any>): string {
  const m = msg.message ?? msg;
  if (typeof m === 'string') return m;
  if (m.conversation)                       return m.conversation;
  if (m.extendedTextMessage?.text)          return m.extendedTextMessage.text;
  if (m.imageMessage?.caption)              return `[Imagem] ${m.imageMessage.caption}`;
  if (m.imageMessage)                       return '[Imagem]';
  if (m.audioMessage)                       return '[Áudio]';
  if (m.videoMessage?.caption)              return `[Vídeo] ${m.videoMessage.caption}`;
  if (m.videoMessage)                       return '[Vídeo]';
  if (m.documentMessage?.fileName)          return `[Doc] ${m.documentMessage.fileName}`;
  if (m.documentMessage)                    return '[Documento]';
  if (m.stickerMessage)                     return '[Sticker]';
  if (m.locationMessage)                    return `[Localização] ${m.locationMessage.degreesLatitude ?? ''}, ${m.locationMessage.degreesLongitude ?? ''}`;
  if (m.reactionMessage?.text)              return `[Reação] ${m.reactionMessage.text}`;
  // plain text fallbacks
  if (typeof msg.body === 'string' && msg.body) return msg.body;
  if (typeof msg.text === 'string' && msg.text)  return msg.text;
  const first = Object.values(m).find(v => v && typeof v === 'string');
  return typeof first === 'string' ? first : '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRecords(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray((obj.messages as Record<string, unknown>)?.records))
      return (obj.messages as Record<string, unknown[]>).records as Record<string, unknown>[];
    if (Array.isArray(obj.messages))  return obj.messages  as Record<string, unknown>[];
    if (Array.isArray(obj.data))      return obj.data      as Record<string, unknown>[];
    if (Array.isArray(obj.records))   return obj.records   as Record<string, unknown>[];
    if (Array.isArray(obj.chats))     return obj.chats     as Record<string, unknown>[];
  }
  return [];
}

// ── Evolution API: fetch last N messages for a remoteJid ──────────────────────
async function fetchEvolutionMessages(
  base: string, apikey: string, instanceName: string, remoteJid: string, limit: number,
) {
  const headers = { 'Content-Type': 'application/json', apikey };
  const endpoints = [
    `${base}/chat/findMessages/${instanceName}`,
    `${base}/message/findMessages/${instanceName}`,
    `${base}/messages/findMessages/${instanceName}`,
  ];

  // Use nested key format only — flat where.remoteJid is broken in this Evolution version
  // Also try remoteJidAlt for LID-mode instances where real phone is stored there
  const bodies = [
    { where: { key: { remoteJid } },          page: 1, offset: limit },
    { where: { key: { remoteJidAlt: remoteJid } }, page: 1, offset: limit },
    { where: { key: { remoteJid } },          skip: 0, take: limit },
    { where: { key: { remoteJidAlt: remoteJid } }, skip: 0, take: limit },
    { where: { key: { remoteJid } } },
  ];

  for (const url of endpoints) {
    for (const bodyObj of bodies) {
      try {
        const res = await fetch(url, {
          method: 'POST', headers, body: JSON.stringify(bodyObj),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const raw = await res.json().catch(() => null);
        const records = extractRecords(raw);
        if (records.length > 0) return records;
      } catch { continue; }
    }
    // Also try GET (some versions)
    try {
      const res = await fetch(`${url}?remoteJid=${encodeURIComponent(remoteJid)}&limit=${limit}`, {
        method: 'GET', headers, signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const raw = await res.json().catch(() => null);
        const records = extractRecords(raw);
        if (records.length > 0) return records;
      }
    } catch { continue; }
  }
  return [];
}

// ── Z-API: fetch last N messages for a phone number ───────────────────────────
async function fetchZapiMessages(instanceId: string, token: string, phone: string, limit: number) {
  // Normalize: Z-API expects number without country code in some endpoints
  const endpoints = [
    `https://api.z-api.io/instances/${instanceId}/token/${token}/chat-messages/${phone}?page=1&pageSize=${limit}`,
    `https://api.z-api.io/instances/${instanceId}/token/${token}/messages/${phone}?page=1&pageSize=${limit}`,
    `https://api.z-api.io/instances/${instanceId}/token/${token}/last-messages?phone=${phone}&count=${limit}`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const raw = await res.json().catch(() => null);
      const records = extractRecords(raw);
      if (records.length > 0) return records;
    } catch { continue; }
  }
  return [];
}

// ── Normalize a raw record to a common shape ──────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRecord(msg: Record<string, any>): {
  externalId: string | null; text: string; direction: 'in' | 'out'; ts: string;
} | null {
  const key = msg.key as Record<string, unknown> | undefined;
  const externalId = (key?.id ?? msg.id ?? msg.messageId ?? msg.external_id ?? null) as string | null;
  const text = extractText(msg);
  if (!text) return null;

  const fromMe = key?.fromMe ?? msg.fromMe ?? msg.from_me ?? false;
  const direction: 'in' | 'out' = fromMe ? 'out' : 'in';

  const rawTs = msg.messageTimestamp ?? msg.timestamp ?? msg.date ?? msg.created_at ?? msg.createdAt;
  let ts = new Date().toISOString();
  if (rawTs) {
    const num = Number(rawTs);
    if (Number.isFinite(num) && num > 0) {
      ts = new Date(num < 10_000_000_000 ? num * 1000 : num).toISOString();
    } else if (typeof rawTs === 'string') {
      const parsed = new Date(rawTs);
      if (!isNaN(parsed.getTime())) ts = parsed.toISOString();
    }
  }
  return { externalId, text, direction, ts };
}

export async function POST(req: NextRequest) {
  const { leadId, clientId } = await req.json().catch(() => ({})) as {
    leadId?: string;
    clientId?: string;
  };

  if (!leadId || !clientId) {
    return Response.json({ error: 'leadId and clientId required' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);

    const { rows: [lead] } = await pool.query(
      `SELECT numero, whatsapp_lid FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    ).catch(async () => {
      // whatsapp_lid column may not exist yet
      return pool.query(`SELECT numero, NULL::text AS whatsapp_lid FROM public.crm_leads WHERE id = $1 AND client_id = $2`, [leadId, clientId]);
    });
    if (!lead?.numero) {
      return Response.json({ error: 'Lead não encontrado ou sem número' }, { status: 404 });
    }

    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, token, provider FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [clientId],
    );
    if (!inst) {
      return Response.json({ error: 'Nenhuma instância WhatsApp ativa.' }, { status: 404 });
    }

    const phone = lead.numero.replace(/\D/g, '');
    const LIMIT = 50;

    let rawRecords: Record<string, unknown>[] = [];

    if (inst.provider === 'evolution') {
      const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
      const apikey = process.env.EVOLUTION_API_KEY ?? '';
      if (!base || !apikey) {
        return Response.json({ error: 'EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados.' }, { status: 500 });
      }
      // Build list of JIDs to try (phone in both @s.whatsapp.net and @lid, plus stored LID)
      const lid = (lead.whatsapp_lid as string | null)?.replace(/\D/g, '') ?? null;
      const jidFormats = [
        `${phone}@s.whatsapp.net`,
        `${phone}@lid`,
        ...(lid && lid !== phone ? [`${lid}@lid`, `${lid}@s.whatsapp.net`] : []),
        `${phone}@c.us`,
      ];
      for (const remoteJid of jidFormats) {
        rawRecords = await fetchEvolutionMessages(base, apikey, inst.instance_id, remoteJid, LIMIT);
        if (rawRecords.length > 0) break;
      }
    } else {
      // Z-API
      rawRecords = await fetchZapiMessages(inst.instance_id, inst.token, phone, LIMIT);
    }

    if (rawRecords.length === 0) {
      return Response.json({ ok: true, imported: 0, skipped: 0, provider: inst.provider });
    }

    let imported = 0;
    let skipped  = 0;

    for (const raw of rawRecords) {
      const norm = normalizeRecord(raw as Record<string, unknown>);
      if (!norm) { skipped++; continue; }

      try {
        if (norm.externalId) {
          const result = await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, external_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (lead_id, external_id) DO NOTHING
             RETURNING id`,
            [leadId, clientId, norm.direction, norm.text, norm.externalId, norm.ts],
          );
          if ((result.rowCount ?? 0) > 0) imported++; else skipped++;
        } else {
          // No external_id — insert without dedup (skip if exact duplicate by text+ts)
          const result = await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, created_at)
             SELECT $1, $2, $3, $4, $5
             WHERE NOT EXISTS (
               SELECT 1 FROM public.crm_messages
               WHERE lead_id=$1 AND text=$4 AND created_at=$5
             )
             RETURNING id`,
            [leadId, clientId, norm.direction, norm.text, norm.ts],
          );
          if ((result.rowCount ?? 0) > 0) imported++; else skipped++;
        }
      } catch { skipped++; }
    }

    if (imported > 0) {
      await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [leadId]);
    }

    return Response.json({ ok: true, imported, skipped, provider: inst.provider });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-history]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
