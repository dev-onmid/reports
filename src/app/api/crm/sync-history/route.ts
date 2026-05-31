import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureExternalId(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS external_id TEXT;
  `).catch(() => null);
  // Separate index creation — may fail if duplicates exist, that's OK
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_lead_external_idx
      ON public.crm_messages (lead_id, external_id)
      WHERE external_id IS NOT NULL;
  `).catch(() => null);
}

// ── Extract text from an Evolution API message object ─────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(msg: Record<string, any>): string {
  const m = msg.message ?? {};
  if (m.conversation)                          return m.conversation;
  if (m.extendedTextMessage?.text)             return m.extendedTextMessage.text;
  if (m.imageMessage?.caption)                 return `[Imagem] ${m.imageMessage.caption}`;
  if (m.imageMessage)                          return '[Imagem]';
  if (m.audioMessage)                          return '[Áudio]';
  if (m.videoMessage?.caption)                 return `[Vídeo] ${m.videoMessage.caption}`;
  if (m.videoMessage)                          return '[Vídeo]';
  if (m.documentMessage?.fileName)             return `[Doc] ${m.documentMessage.fileName}`;
  if (m.documentMessage)                       return '[Documento]';
  if (m.stickerMessage)                        return '[Sticker]';
  if (m.locationMessage)                       return `[Localização] ${m.locationMessage.degreesLatitude ?? ''}, ${m.locationMessage.degreesLongitude ?? ''}`;
  if (m.reactionMessage?.text)                 return `[Reação] ${m.reactionMessage.text}`;
  // fallback: serialize non-empty first value
  const first = Object.values(m).find(v => v && typeof v === 'string');
  return typeof first === 'string' ? first : '';
}

// ── Normalize raw array from any Evolution API version ────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRecords(raw: unknown): Record<string, any>[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    // v2: { messages: { records: [...] } }
    if (Array.isArray((obj.messages as Record<string, unknown>)?.records))
      return (obj.messages as Record<string, unknown[]>).records as Record<string, unknown>[];
    // { messages: [...] }
    if (Array.isArray(obj.messages)) return obj.messages as Record<string, unknown>[];
    // { data: [...] }
    if (Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
    // { records: [...] }
    if (Array.isArray(obj.records)) return obj.records as Record<string, unknown>[];
  }
  return [];
}

export async function POST(req: NextRequest) {
  const { leadId, clientId, debug } = await req.json().catch(() => ({})) as {
    leadId?: string;
    clientId?: string;
    debug?: boolean;
  };

  if (!leadId || !clientId) {
    return Response.json({ error: 'leadId and clientId required' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureExternalId(pool);

    const { rows: [lead] } = await pool.query(
      `SELECT numero FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    );
    if (!lead?.numero) {
      return Response.json({ error: 'Lead não encontrado ou sem número' }, { status: 404 });
    }

    // Evolution API only — Z-API has no history endpoint
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
    if (inst.provider !== 'evolution') {
      return Response.json({
        error: 'A sincronização de histórico requer Evolution API. Z-API não expõe endpoint de histórico.',
      }, { status: 422 });
    }

    const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
    const apikey = process.env.EVOLUTION_API_KEY ?? '';
    if (!base || !apikey) {
      return Response.json({ error: 'EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados.' }, { status: 500 });
    }

    const phone = lead.numero.replace(/\D/g, '');
    const remoteJid = `${phone}@s.whatsapp.net`;
    const instanceName = inst.instance_id;
    const headers = { 'Content-Type': 'application/json', apikey };

    let imported = 0;
    let skipped  = 0;
    const debugInfo: unknown[] = [];

    // Try up to 10 pages (500 msgs). Evolution returns newest-first,
    // so page 1 = most recent — ideal for our use case.
    for (let page = 1; page <= 10; page++) {
      const body = JSON.stringify({ where: { key: { remoteJid } }, page, offset: 50 });

      // Try both known endpoint paths across Evolution API versions
      const endpoints = [
        `${base}/chat/findMessages/${instanceName}`,
        `${base}/message/findMessages/${instanceName}`,
        `${base}/messages/findMessages/${instanceName}`,
      ];

      let records: Record<string, unknown>[] = [];
      let lastRaw: unknown = null;

      for (const url of endpoints) {
        try {
          const res = await fetch(url, { method: 'POST', headers, body });
          if (!res.ok) continue;
          const raw = await res.json().catch(() => null);
          lastRaw = raw;
          const extracted = extractRecords(raw);
          if (extracted.length > 0) { records = extracted; break; }
        } catch { continue; }
      }

      if (debug && page === 1) debugInfo.push({ remoteJid, raw: lastRaw });

      if (records.length === 0) break;

      for (const msg of records) {
        const externalId = (msg.key as Record<string, string> | undefined)?.id;
        const text = extractText(msg as Record<string, unknown>);
        if (!text || !externalId) continue;

        const direction = (msg.key as Record<string, unknown>)?.fromMe ? 'out' : 'in';
        const ts = msg.messageTimestamp
          ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString();

        try {
          const result = await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, external_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (lead_id, external_id) DO NOTHING
             RETURNING id`,
            [leadId, clientId, direction, text, externalId, ts],
          );
          if (result.rowCount && result.rowCount > 0) imported++;
          else skipped++;
        } catch { skipped++; }
      }

      if (records.length < 50) break; // last page
    }

    if (imported > 0) {
      await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [leadId]);
    }

    return Response.json({
      ok: true,
      imported,
      skipped,
      ...(debug ? { debug: debugInfo } : {}),
    });
  } finally {
    await pool.end();
  }
}
