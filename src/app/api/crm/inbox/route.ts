import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  ensureDefaultFunnel,
  upsertLeadFromConversation,
} from '@/lib/crm-conversation-sync';

const ZAPI_BASE = 'https://api.z-api.io/instances';

function normalizePhone(raw: unknown) {
  return String(raw ?? '').replace(/\D/g, '');
}

function getNested(obj: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractProfilePictureUrl(chat: Record<string, unknown>): string | null {
  const candidates = [
    chat.profilePicUrl,
    chat.profilePictureUrl,
    chat.profile_picture_url,
    chat.picture,
    chat.pictureUrl,
    chat.photo,
    chat.image,
    chat.avatar,
    chat.imgUrl,
    getNested(chat, ['contact', 'profilePicUrl']),
    getNested(chat, ['contact', 'profilePictureUrl']),
    getNested(chat, ['contact', 'picture']),
    getNested(chat, ['contact', 'photo']),
    getNested(chat, ['profilePicture', 'url']),
    getNested(chat, ['picture', 'url']),
  ];
  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value;
  }
  return null;
}

function parseProviderTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') return parseProviderTimestamp(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function extractLastMessageAt(chat: Record<string, unknown>): string | null {
  const candidates = [
    chat.lastMessageAt,
    chat.last_message_at,
    chat.lastMessageTime,
    chat.lastMessageTimestamp,
    chat.t,
    chat.timestamp,
    chat.messageTimestamp,
    getNested(chat, ['lastMessage', 'timestamp']),
    getNested(chat, ['lastMessage', 'messageTimestamp']),
    getNested(chat, ['lastMessage', 'momment']),
    getNested(chat, ['lastMessage', 'createdAt']),
    getNested(chat, ['lastMessage', 'created_at']),
  ];
  for (const candidate of candidates) {
    const parsed = parseProviderTimestamp(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractLastMessageText(chat: Record<string, unknown>): string | null {
  const last = chat.lastMessage;
  const lastObj = last && typeof last === 'object' ? last as Record<string, unknown> : null;
  const candidates = [
    chat.lastMessageText,
    chat.last_message,
    chat.body,
    chat.text,
    lastObj?.message,
    lastObj?.body,
    lastObj?.text,
    getNested(chat, ['lastMessage', 'text', 'message']),
    getNested(chat, ['lastMessage', 'message', 'conversation']),
    getNested(chat, ['lastMessage', 'message', 'extendedTextMessage', 'text']),
  ];
  const found = candidates.find(value => typeof value === 'string' && value.trim().length > 0);
  return typeof found === 'string' ? found.trim() : null;
}

function extractLastDirection(chat: Record<string, unknown>): 'in' | 'out' | null {
  const fromMe = chat.fromMe ?? getNested(chat, ['lastMessage', 'fromMe']) ?? getNested(chat, ['lastMessage', 'key', 'fromMe']);
  if (fromMe === true) return 'out';
  if (fromMe === false) return 'in';
  return null;
}

function extractRecords(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.chats)) return obj.chats as Array<Record<string, unknown>>;
    if (Array.isArray(obj.contacts)) return obj.contacts as Array<Record<string, unknown>>;
    if (Array.isArray(obj.value)) return obj.value as Array<Record<string, unknown>>;
    if (Array.isArray(obj.data)) return obj.data as Array<Record<string, unknown>>;
    if (Array.isArray(obj.records)) return obj.records as Array<Record<string, unknown>>;
    if (Array.isArray((obj.chats as Record<string, unknown>)?.records)) {
      return (obj.chats as Record<string, unknown>).records as Array<Record<string, unknown>>;
    }
  }
  return [];
}

async function fetchProviderChats(instance: {
  instance_id: string;
  token: string;
  provider: string;
}, limit: number): Promise<Array<Record<string, unknown>>> {
  if (instance.provider === 'evolution') {
    const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
    const apikey = process.env.EVOLUTION_API_KEY ?? '';
    if (!base || !apikey) throw new Error('EVOLUTION_API_URL ou EVOLUTION_API_KEY não configurados.');
    const h = { 'Content-Type': 'application/json', apikey };

    // Try multiple endpoint + body combinations across Evolution API versions
    type Attempt = { url: string; method: string; body?: string };
    const attempts: Attempt[] = [
      // GET without body (Evolution v1 / some builds)
      { url: `${base}/chat/findChats/${instance.instance_id}`,       method: 'GET' },
      { url: `${base}/chat/findContacts/${instance.instance_id}`,    method: 'GET' },
      // POST with where clause (Evolution v2)
      { url: `${base}/chat/findChats/${instance.instance_id}`,       method: 'POST', body: JSON.stringify({ where: {}, skip: 0, take: limit }) },
      { url: `${base}/chat/findChats/${instance.instance_id}`,       method: 'POST', body: JSON.stringify({ where: {} }) },
      // POST with page/offset (legacy)
      { url: `${base}/chat/findChats/${instance.instance_id}`,       method: 'POST', body: JSON.stringify({ page: 1, offset: limit }) },
      // Contacts variants
      { url: `${base}/chat/findContacts/${instance.instance_id}`,    method: 'POST', body: JSON.stringify({ where: {} }) },
      { url: `${base}/contact/findContacts/${instance.instance_id}`, method: 'POST', body: JSON.stringify({ where: {} }) },
      { url: `${base}/contact/findContacts/${instance.instance_id}`, method: 'GET' },
    ];

    for (const { url, method, body } of attempts) {
      const opts: RequestInit = { method, headers: h };
      if (body) opts.body = body;
      const res = await fetch(url, opts).catch(() => null);
      if (!res?.ok) continue;
      const json = await res.json().catch(() => null);
      const records = extractRecords(json);
      if (records.length > 0) {
        console.log(`[inbox] Evolution: ${records.length} chats via ${method} ${url}`);
        return records;
      }
    }
    console.warn('[inbox] Evolution: all endpoints returned 0 records');
    return [];
  }

  const res = await fetch(
    `${ZAPI_BASE}/${instance.instance_id}/token/${instance.token}/chats?conversationLimit=${limit}`,
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Z-API error ${res.status}: ${text}`);
  }
  const raw = await res.json() as unknown;
  return extractRecords(raw);
}

function extractProfilePictureFromResponse(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const candidates = [
    obj.profilePictureUrl,
    obj.profilePicUrl,
    obj.picture,
    obj.pictureUrl,
    obj.url,
    obj.link,
    obj.photo,
    obj.avatar,
    getNested(obj, ['data', 'profilePictureUrl']),
    getNested(obj, ['data', 'profilePicUrl']),
    getNested(obj, ['data', 'picture']),
    getNested(obj, ['data', 'url']),
  ];
  for (const candidate of candidates) {
    const value = asNonEmptyString(candidate);
    if (value) return value;
  }
  return null;
}

async function fetchProviderProfilePicture(instance: {
  instance_id: string;
  token: string;
  provider: string;
}, phone: string, remoteJid: string): Promise<string | null> {
  if (instance.provider === 'evolution') {
    const base = (process.env.EVOLUTION_API_URL ?? '').replace(/\/$/, '');
    const apikey = process.env.EVOLUTION_API_KEY ?? '';
    if (!base || !apikey) return null;
    const headers = { 'Content-Type': 'application/json', apikey };
    const number = remoteJid || `${phone}@s.whatsapp.net`;
    const attempts: RequestInit[] = [
      { method: 'POST', headers, body: JSON.stringify({ number }) },
      { method: 'POST', headers, body: JSON.stringify({ number: phone }) },
      { method: 'POST', headers, body: JSON.stringify({ remoteJid: number }) },
    ];

    for (const opts of attempts) {
      try {
        const res = await fetch(`${base}/chat/fetchProfilePictureUrl/${instance.instance_id}`, {
          ...opts,
          signal: AbortSignal.timeout(4_000),
        });
        if (!res.ok) continue;
        const url = extractProfilePictureFromResponse(await res.json().catch(() => null));
        if (url) return url;
      } catch { continue; }
    }
    return null;
  }

  try {
    const res = await fetch(
      `${ZAPI_BASE}/${instance.instance_id}/token/${instance.token}/profile-picture?phone=${encodeURIComponent(phone)}`,
      {
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!res.ok) return null;
    return extractProfilePictureFromResponse(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureDefaultFunnel(pool, clientId);

    // Step 1: fetch leads. Ordenação por ATIVIDADE DE MENSAGEM (não updated_at
    // cru): em cliente com 200+ leads, a janela do LIMIT precisa priorizar quem
    // conversou por último — senão mensagem nova de lead "antigo" cai fora da
    // janela e o inbox parece congelado.
    type LeadRow = {
      id: string; nome: string | null; numero: string | null; canal: string | null;
      origin: string | null; status: string | null; fechou: boolean;
      valor_rs: string | null; created_at: string; updated_at: string | null;
    };
    let leads: LeadRow[] = [];
    try {
      const { rows } = await pool.query<LeadRow>(
        `SELECT id, nome, numero, canal, origin, status, fechou, valor_rs, created_at, updated_at
         FROM public.crm_leads
         WHERE client_id = $1
           AND (numero IS NULL OR (numero ~ '^[0-9]{8,15}$' AND numero NOT LIKE '%--%'))
         ORDER BY GREATEST(
           COALESCE(whatsapp_last_message_at, 'epoch'::timestamptz),
           COALESCE(updated_at, 'epoch'::timestamptz),
           COALESCE(created_at, 'epoch'::timestamptz)
         ) DESC
         LIMIT 200`,
        [clientId],
      );
      leads = rows;
    } catch {
      // Instalação sem whatsapp_last_message_at — ordenação antiga
      const { rows } = await pool.query<LeadRow>(
        `SELECT id, nome, numero, canal, origin, status, fechou, valor_rs, created_at, updated_at
         FROM public.crm_leads
         WHERE client_id = $1
           AND (numero IS NULL OR (numero ~ '^[0-9]{8,15}$' AND numero NOT LIKE '%--%'))
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 200`,
        [clientId],
      );
      leads = rows;
    }

    if (leads.length === 0) return Response.json([]);

    // Step 2: deduplicate by normalized phone (keep most-recently-updated)
    const seen = new Set<string>();
    const unique = leads.filter(l => {
      const key = l.numero ? l.numero.replace(/\D/g, '') || l.id : l.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Step 3: enrich with last message (best-effort, skip on error)
    const ids = unique.map(l => l.id);
    let lastMsgs: Record<string, { text: string; direction: string; created_at: string; tipo?: string | null; whatsapp_status?: string | null }> = {};
    let unreadCounts: Record<string, number> = {};
    let avatarMap: Record<string, string | null> = {};

    try {
      // Last message per lead (tipo alimenta a prévia estilo WhatsApp: 📷 Foto, 🎤 Áudio…;
      // whatsapp_status pinta o ✓✓ da prévia quando a última é sua)
      const { rows: msgs } = await pool.query<{
        lead_id: string; text: string; direction: string; created_at: string; tipo: string | null; whatsapp_status: string | null;
      }>(
        `SELECT DISTINCT ON (lead_id) lead_id, text, direction, created_at, COALESCE(tipo, 'texto') AS tipo, whatsapp_status
         FROM public.crm_messages
         WHERE lead_id = ANY($1::uuid[])
         ORDER BY lead_id, created_at DESC`,
        [ids],
      );
      lastMsgs = Object.fromEntries(msgs.map(m => [m.lead_id, m]));
    } catch {
      // Coluna tipo pode não existir em instalação antiga — cai pro básico
      try {
        const { rows: msgs } = await pool.query<{
          lead_id: string; text: string; direction: string; created_at: string;
        }>(
          `SELECT DISTINCT ON (lead_id) lead_id, text, direction, created_at
           FROM public.crm_messages
           WHERE lead_id = ANY($1::uuid[])
           ORDER BY lead_id, created_at DESC`,
          [ids],
        );
        lastMsgs = Object.fromEntries(msgs.map(m => [m.lead_id, m]));
      } catch { /* not critical */ }
    }

    try {
      // Não-lidas de verdade: só mensagens recebidas DEPOIS da última vez que a
      // conversa foi aberta (crm_leads.chat_read_at, setado no GET de mensagens).
      // Antes era COUNT(*) histórico de todas as 'in' — badge que nunca zerava.
      const { rows: unreads } = await pool.query<{ lead_id: string; total: number }>(
        `SELECT m.lead_id, COUNT(*)::int AS total
         FROM public.crm_messages m
         JOIN public.crm_leads l ON l.id = m.lead_id
         WHERE m.lead_id = ANY($1::uuid[])
           AND m.direction = 'in'
           AND m.created_at > COALESCE(l.chat_read_at, '-infinity'::timestamptz)
         GROUP BY m.lead_id`,
        [ids],
      );
      unreadCounts = Object.fromEntries(unreads.map(u => [u.lead_id, u.total]));
    } catch { /* not critical */ }

    try {
      // Avatar URLs. ensureDefaultFunnel() creates profile_picture_url through the CRM schema helper.
      const { rows: avs } = await pool.query<{ id: string; avatar_url: string | null }>(
        `SELECT id, profile_picture_url AS avatar_url
         FROM public.crm_leads
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      avatarMap = Object.fromEntries(avs.map(a => [a.id, a.avatar_url]));
    } catch { /* not critical */ }

    // Step 4: also enrich with whatsapp_last_* fields if columns exist
    let waMap: Record<string, { text: string | null; dir: string | null; at: string | null }> = {};
    try {
      const { rows: wa } = await pool.query<{
        id: string; t: string | null; d: string | null; a: string | null;
      }>(
        `SELECT id,
           whatsapp_last_message_text  AS t,
           whatsapp_last_direction     AS d,
           whatsapp_last_message_at    AS a
         FROM public.crm_leads
         WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      waMap = Object.fromEntries(wa.map(w => [w.id, { text: w.t, dir: w.d, at: w.a }]));
    } catch { /* columns may not exist */ }

    // Step 5: assemble result
    const result = unique.map(l => {
      const msg  = lastMsgs[l.id];
      const wa   = waMap[l.id];
      return {
        id:              l.id,
        nome:            l.nome,
        numero:          l.numero,
        canal:           l.canal,
        origin:          l.origin,
        status:          l.status,
        fechou:          l.fechou,
        avatar_url:      avatarMap[l.id] ?? null,
        created_at:      l.created_at,
        last_message:    msg?.text    ?? wa?.text ?? null,
        last_direction:  msg?.direction ?? wa?.dir ?? null,
        last_tipo:       msg?.tipo ?? null,
        last_status:     msg?.whatsapp_status ?? null,
        last_message_at: msg?.created_at ?? wa?.at ?? l.updated_at ?? l.created_at,
        unread_count:    unreadCounts[l.id] ?? 0,
      };
    });

    // Sort by last_message_at desc
    result.sort((a, b) =>
      new Date(b.last_message_at ?? b.created_at).getTime() -
      new Date(a.last_message_at ?? a.created_at).getTime(),
    );

    return Response.json(result);
  } catch (err) {
    console.error('[inbox GET]', err);
    return Response.json([], { status: 200 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    search?: string;
    limit?: number;
  };
  const search = (body.search ?? '').trim().toLowerCase();
  const searchDigits = search.replace(/\D/g, '');
  const limit = Math.min(Math.max(Number(body.limit ?? 300), 50), 500);

  const pool = makeServerPool();
  try {
    await ensureDefaultFunnel(pool, clientId);

    // Prefer the Evolution instance when both providers are active (Evolution is the
    // live/primary; Z-API rows are legacy). Must match getClientInstance + sync-history.
    const { rows: [instance] } = await pool.query(
      `SELECT instance_id, token, provider
       FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY CASE WHEN provider = 'evolution' THEN 0 ELSE 1 END, created_at ASC
       LIMIT 1`,
      [clientId],
    );
    if (!instance) {
      return Response.json({ error: 'Nenhuma instância ativa encontrada para este cliente.' }, { status: 404 });
    }
    const chats = await fetchProviderChats(instance, limit);

    const mapped = chats
      .filter(chat => chat.isGroup !== true)
      .map(chat => {
        const remoteJid = String(
          chat.remoteJid
          ?? chat.id
          ?? (chat.key as Record<string, unknown> | undefined)?.remoteJid
          ?? '',
        );
        const isLid = remoteJid.endsWith('@lid');

        // In LID mode (Evolution API new addressing), the real phone is in remoteJidAlt
        // Fall back to extracting from remoteJid itself for @s.whatsapp.net chats
        const remoteJidAlt = String(
          chat.remoteJidAlt
          ?? (chat.key as Record<string, unknown> | undefined)?.remoteJidAlt
          ?? '',
        );
        let rawPhone: string;
        if (isLid) {
          // ⚠️ NUNCA usar os dígitos do LID como telefone: sem remoteJidAlt o chat
          // fica só com o lid (o webhook corrige o número quando a mensagem real
          // chegar). Antes, o LID virava "numero" e SOBRESCREVIA telefones reais.
          rawPhone = remoteJidAlt ? remoteJidAlt.split('@')[0] : '';
        } else {
          rawPhone = String(chat.phone ?? chat.phoneNumber ?? remoteJid.split('@')[0] ?? '');
        }
        const phone = normalizePhone(rawPhone);
        // Keep LID for use in message history queries
        const lid = isLid ? remoteJid.split('@')[0] : null;
        const name = String(chat.name ?? chat.pushName ?? chat.pushname ?? chat.verifiedName ?? chat.phone ?? phone);
        const profilePictureUrl = extractProfilePictureUrl(chat);
        return {
          phone,
          lid,
          name,
          profilePictureUrl,
          remoteJid,
          lastMessageAt: extractLastMessageAt(chat),
          lastMessageText: extractLastMessageText(chat),
          lastDirection: extractLastDirection(chat),
        };
      });

    // Relaxed phone filter: 8–15 digits (covers short local numbers & international).
    // Chats @lid sem telefone resolvido entram só com o lid — o upsert aceita
    // (phone OU lid) e o webhook preenche o número real depois.
    const contacts = mapped.filter(contact => {
      const jid = String(contact.remoteJid);
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('newsletter')) return false;
      if (!/^[0-9]{8,15}$/.test(contact.phone) && !contact.lid) return false;
      if (!search) return true;
      return (searchDigits.length > 0 && contact.phone.includes(searchDigits))
        || contact.name.toLowerCase().includes(search);
    });

    console.log(`[inbox] fetched=${chats.length} mapped=${mapped.length} contacts=${contacts.length}`);

    const profileLookups = new Map<string, string | null>();
    const lookupTargets = contacts
      .filter(contact => !contact.profilePictureUrl)
      .slice(0, 12);
    await Promise.all(lookupTargets.map(async contact => {
      const key = contact.remoteJid || contact.phone;
      if (profileLookups.has(key)) return;
      profileLookups.set(
        key,
        await fetchProviderProfilePicture(instance, contact.phone, contact.remoteJid),
      );
    }));

    let imported = 0;
    for (const contact of contacts) {
      const profilePictureUrl =
        contact.profilePictureUrl
        ?? profileLookups.get(contact.remoteJid || contact.phone)
        ?? null;
      await upsertLeadFromConversation(pool, {
        clientId,
        phone: contact.phone,
        lid: contact.lid,
        name: contact.name,
        profilePictureUrl,
        lastMessageAt: contact.lastMessageAt,
        lastMessageText: contact.lastMessageText,
        lastDirection: contact.lastDirection,
      });
      imported += 1;
    }

    return Response.json({
      ok: true,
      imported,
      fetched: chats.length,
      matched: contacts.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[crm inbox import]', msg);
    return Response.json({ error: msg }, { status: 500 });
  } finally {
    await pool.end();
  }
}
