import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmMessagesSchema, ensureDefaultFunnel } from '@/lib/crm-conversation-sync';

async function ensureSchema(pool: ReturnType<typeof makeServerPool>) {
  await ensureCrmMessagesSchema(pool);
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

  // CRITICAL: only the nested `where.key.remoteJid` format actually filters by contact.
  // The flat `where.remoteJid` format is broken in this Evolution version — it ignores
  // the filter and returns the last N messages across ALL chats, which would pollute the
  // lead with another conversation's history. Verified live: nested → 7 correct records,
  // flat → 50 unrelated records. Keep ONLY the nested-key variants (remoteJid + the
  // remoteJidAlt used by LID-mode instances where the real phone lives in remoteJidAlt).
  const bodies = [
    { where: { key: { remoteJid } },               page: 1, offset: limit },
    { where: { key: { remoteJidAlt: remoteJid } }, page: 1, offset: limit },
    { where: { key: { remoteJid } },               skip: 0, take: limit },
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
  }
  return [];
}

// ── Evolution LID mode: resolve a phone → the conversation's real remoteJid ────
// New Evolution instances address chats by an opaque LID (e.g. "159816320323777@lid")
// instead of "<phone>@s.whatsapp.net". Messages are stored under that LID, so a
// findMessages by phone returns 0. The real phone is exposed inside each chat at
// `lastMessage.key.remoteJidAlt`. We scan findChats to map phone → remoteJid (LID).
async function resolveEvolutionRemoteJid(
  base: string, apikey: string, instanceName: string, phone: string,
): Promise<string | null> {
  const headers = { 'Content-Type': 'application/json', apikey };
  const want = phone.replace(/\D/g, '');
  if (!want) return null;

  let chats: Record<string, unknown>[] = [];
  for (const body of [{}, { where: {} }] as const) {
    try {
      const res = await fetch(`${base}/chat/findChats/${instanceName}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      const arr = Array.isArray(j)
        ? j
        : ((j as Record<string, unknown> | null)?.records ?? (j as Record<string, unknown> | null)?.chats ?? []);
      if (Array.isArray(arr) && arr.length) { chats = arr as Record<string, unknown>[]; break; }
    } catch { continue; }
  }

  for (const c of chats) {
    const rj = String(c.remoteJid ?? c.id ?? '');
    if (!rj || rj.endsWith('@g.us') || rj.includes('broadcast') || rj.includes('newsletter')) continue;
    // real phone lives in lastMessage.key.remoteJidAlt (LID mode) or top-level remoteJidAlt
    const lastMsg = c.lastMessage as Record<string, unknown> | undefined;
    const lastKey = lastMsg?.key as Record<string, unknown> | undefined;
    const alt = String(lastKey?.remoteJidAlt ?? c.remoteJidAlt ?? '');
    const altDigits = alt.replace(/\D/g, '');
    const rjDigits  = rj.split('@')[0].replace(/\D/g, '');
    if (altDigits === want || rjDigits === want) return rj;
  }
  return null;
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
    await ensureDefaultFunnel(pool, clientId);
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

    // Try ALL active instances of this client (Evolution first) until one actually has
    // this conversation. This removes the dependency on guessing the "right" instance:
    // in a multi-instance setup a chat can live on instance A while another path picked B.
    // These are still only the client's OWN instances — never another client's.
    const { rows: instances } = await pool.query<{ instance_id: string; token: string; provider: string }>(
      `SELECT instance_id, token, provider FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC`,
      [clientId],
    );
    if (instances.length === 0) {
      return Response.json({ error: 'Nenhuma instância WhatsApp ativa.' }, { status: 404 });
    }

    const phone = lead.numero.replace(/\D/g, '');
    const lid = (lead.whatsapp_lid as string | null)?.replace(/\D/g, '') ?? null;
    const LIMIT = 50;

    const evoBase = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
    const evoKey  = process.env.EVOLUTION_API_KEY ?? '';
    const jidFormats = [
      `${phone}@s.whatsapp.net`,
      `${phone}@lid`,
      ...(lid && lid !== phone ? [`${lid}@lid`, `${lid}@s.whatsapp.net`] : []),
      `${phone}@c.us`,
    ];

    let rawRecords: Record<string, unknown>[] = [];
    let usedProvider: string | null = null;
    let usedJid: string | null = null;
    const tried: Array<{ instance: string; provider: string; records: number; via?: string }> = [];

    for (const ist of instances) {
      let recs: Record<string, unknown>[] = [];
      let jidUsed: string | null = null;
      let via = 'phone';
      if (ist.provider === 'evolution') {
        if (evoBase && evoKey) {
          for (const remoteJid of jidFormats) {
            recs = await fetchEvolutionMessages(evoBase, evoKey, ist.instance_id, remoteJid, LIMIT);
            if (recs.length > 0) { jidUsed = remoteJid; break; }
          }
          // LID mode: phone-based lookup failed → resolve the real remoteJid (LID) via findChats
          if (recs.length === 0) {
            const resolved = await resolveEvolutionRemoteJid(evoBase, evoKey, ist.instance_id, phone);
            if (resolved) {
              recs = await fetchEvolutionMessages(evoBase, evoKey, ist.instance_id, resolved, LIMIT);
              if (recs.length > 0) { jidUsed = resolved; via = 'lid'; }
            }
          }
        }
      } else {
        recs = await fetchZapiMessages(ist.instance_id, ist.token, phone, LIMIT);
      }
      tried.push({ instance: ist.instance_id, provider: ist.provider, records: recs.length, via });
      if (recs.length > 0) {
        rawRecords = recs;
        usedProvider = ist.provider;
        usedJid = jidUsed;
        break;
      }
    }

    // Persist the resolved LID so future syncs are instant and the webhook can match it.
    if (usedJid && usedJid.endsWith('@lid')) {
      const lidDigits = usedJid.split('@')[0].replace(/\D/g, '');
      if (lidDigits && lidDigits !== phone) {
        await pool.query(
          `UPDATE public.crm_leads SET whatsapp_lid = COALESCE(whatsapp_lid, $2) WHERE id = $1`,
          [leadId, lidDigits],
        ).catch(() => null);
      }
    }

    if (rawRecords.length === 0) {
      return Response.json({ ok: true, imported: 0, skipped: 0, tried });
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
             ON CONFLICT DO NOTHING
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
      const { rows: [last] } = await pool.query<{
        text: string;
        direction: string;
        created_at: string;
      }>(
        `SELECT text, direction, created_at
           FROM public.crm_messages
          WHERE lead_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [leadId],
      );
      await pool.query(
        `UPDATE public.crm_leads
            SET updated_at = NOW(),
                whatsapp_last_message_text = COALESCE($2, whatsapp_last_message_text),
                whatsapp_last_direction = COALESCE($3, whatsapp_last_direction),
                whatsapp_last_message_at = COALESCE($4::timestamptz, whatsapp_last_message_at)
          WHERE id = $1`,
        [leadId, last?.text ?? null, last?.direction ?? null, last?.created_at ?? null],
      );
    }

    return Response.json({ ok: true, imported, skipped, provider: usedProvider, tried });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[sync-history]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
