import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// Ensure external_id column exists to prevent duplicate imports
async function ensureExternalId(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS external_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_external_id_idx
      ON public.crm_messages (lead_id, external_id)
      WHERE external_id IS NOT NULL;
  `).catch(() => null); // ignore if already exists
}

type EvolutionMessage = {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    imageMessage?: { caption?: string; url?: string };
    audioMessage?: { url?: string };
    videoMessage?: { caption?: string; url?: string };
    documentMessage?: { caption?: string; url?: string; fileName?: string };
  };
  messageTimestamp?: number;
  pushName?: string;
};

function extractText(msg: EvolutionMessage): string {
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.url) return m.imageMessage.caption ? `[Imagem] ${m.imageMessage.caption}` : '[Imagem]';
  if (m.audioMessage?.url) return '[Áudio]';
  if (m.videoMessage?.url) return m.videoMessage.caption ? `[Vídeo] ${m.videoMessage.caption}` : '[Vídeo]';
  if (m.documentMessage?.url) return `[Documento] ${m.documentMessage.fileName ?? ''}`.trim();
  return '';
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
    await ensureExternalId(pool);

    // Get lead phone
    const { rows: [lead] } = await pool.query(
      `SELECT numero FROM public.crm_leads WHERE id = $1 AND client_id = $2`,
      [leadId, clientId],
    );
    if (!lead?.numero) {
      return Response.json({ error: 'lead not found or has no phone' }, { status: 404 });
    }

    // Get Evolution API instance (only Evolution supports message history)
    const { rows: [inst] } = await pool.query(
      `SELECT instance_id, token, provider FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true AND provider = 'evolution'
       ORDER BY created_at ASC LIMIT 1`,
      [clientId],
    );

    if (!inst) {
      // Try Z-API fallback (no history support — explain)
      const { rows: [zapiInst] } = await pool.query(
        `SELECT instance_id FROM public.client_zapi_instances
         WHERE client_id = $1 AND ativo = true LIMIT 1`,
        [clientId],
      );
      if (zapiInst) {
        return Response.json({
          ok: false,
          error: 'Z-API não suporta importação de histórico. Use uma instância Evolution API para sincronizar mensagens antigas.',
        }, { status: 422 });
      }
      return Response.json({ error: 'Nenhuma instância ativa encontrada' }, { status: 404 });
    }

    const base = process.env.EVOLUTION_API_URL;
    const apikey = process.env.EVOLUTION_API_KEY;
    if (!base || !apikey) {
      return Response.json({ error: 'Evolution API não configurada (verifique as env vars)' }, { status: 500 });
    }

    // Build WhatsApp JID
    const phone = lead.numero.replace(/\D/g, '');
    const remoteJid = `${phone}@s.whatsapp.net`;

    // Fetch message history from Evolution API — paginate up to 5 pages × 50 msgs
    let imported = 0;
    let skipped = 0;

    for (let page = 1; page <= 5; page++) {
      const res = await fetch(`${base}/chat/findMessages/${inst.instance_id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey },
        body: JSON.stringify({
          where: { key: { remoteJid } },
          page,
          offset: 50,
        }),
      });

      if (!res.ok) break;

      const data = await res.json().catch(() => null) as
        | { messages?: { records?: EvolutionMessage[] } }
        | EvolutionMessage[]
        | null;

      // Evolution API returns different shapes depending on version
      let records: EvolutionMessage[] = [];
      if (Array.isArray(data)) {
        records = data;
      } else if (data && 'messages' in data && Array.isArray(data.messages?.records)) {
        records = data.messages.records;
      }

      if (records.length === 0) break;

      for (const msg of records) {
        const externalId = msg.key?.id;
        const text = extractText(msg);
        if (!text || !externalId) continue;

        const direction = msg.key?.fromMe ? 'out' : 'in';
        const ts = msg.messageTimestamp
          ? new Date(msg.messageTimestamp * 1000).toISOString()
          : new Date().toISOString();

        try {
          await pool.query(
            `INSERT INTO public.crm_messages
               (lead_id, client_id, direction, text, external_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (lead_id, external_id) DO NOTHING`,
            [leadId, clientId, direction, text, externalId, ts],
          );
          imported++;
        } catch {
          skipped++;
        }
      }

      // If fewer than 50 records, no more pages
      if (records.length < 50) break;
    }

    // Update lead updated_at
    if (imported > 0) {
      await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [leadId]);
    }

    return Response.json({ ok: true, imported, skipped });
  } finally {
    await pool.end();
  }
}
