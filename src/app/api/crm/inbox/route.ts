import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    // Ensure columns exist — swallow errors (already created in POST or on first run)
    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
        ADD COLUMN IF NOT EXISTS whatsapp_last_message_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS whatsapp_last_message_text TEXT,
        ADD COLUMN IF NOT EXISTS whatsapp_last_direction TEXT;
    `).catch(() => null);

    // Detect avatar column available in this install
    const { rows: columnRows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'crm_leads'
         AND column_name IN ('profile_picture_url', 'picture_url', 'avatar_url')`,
    ).catch(() => ({ rows: [] as Array<{ column_name: string }> }));

    const avatarColumn = ['profile_picture_url', 'picture_url', 'avatar_url']
      .find(column => columnRows.some((row: { column_name: string }) => row.column_name === column));
    const avatarSelect = avatarColumn ? `l.${avatarColumn}` : `NULL::text`;

    // Check which optional columns exist to avoid query errors on older schemas
    const { rows: optCols } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'crm_leads'
         AND column_name IN ('whatsapp_last_message_at','whatsapp_last_message_text','whatsapp_last_direction')`,
    ).catch(() => ({ rows: [] as Array<{ column_name: string }> }));
    const hasWaAt   = optCols.some((r: { column_name: string }) => r.column_name === 'whatsapp_last_message_at');
    const hasWaText = optCols.some((r: { column_name: string }) => r.column_name === 'whatsapp_last_message_text');
    const hasWaDir  = optCols.some((r: { column_name: string }) => r.column_name === 'whatsapp_last_direction');

    const waAtExpr   = hasWaAt   ? 'l.whatsapp_last_message_at'   : 'NULL::timestamptz';
    const waTextExpr = hasWaText ? 'l.whatsapp_last_message_text'  : 'NULL::text';
    const waDirExpr  = hasWaDir  ? 'l.whatsapp_last_direction'     : 'NULL::text';

    const { rows } = await pool.query(
       `WITH canonical_leads AS (
         SELECT *
         FROM (
           SELECT
             l.*,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(NULLIF(regexp_replace(COALESCE(l.numero, ''), '\\D', '', 'g'), ''), l.id::text)
               ORDER BY
                 CASE WHEN l.funnel_id IS NOT NULL THEN 0 ELSE 1 END,
                 COALESCE(l.updated_at, l.created_at) DESC,
                 l.created_at DESC
             ) AS rn
           FROM public.crm_leads l
           WHERE l.client_id = $1
             AND (
               l.numero IS NULL
               OR (
                 l.numero ~ '^[0-9]{8,15}$'
                 AND l.numero NOT LIKE '%--%'
               )
             )
         ) ranked
         WHERE rn = 1
       )
       SELECT
         l.id,
         l.nome,
         l.numero,
         l.canal,
         l.origin,
         l.status,
         l.fechou,
         l.valor_rs,
         ${avatarSelect} AS avatar_url,
         l.created_at,
         l.updated_at,
         COALESCE(m.text, ${waTextExpr}) AS last_message,
         COALESCE(m.direction, ${waDirExpr}) AS last_direction,
         COALESCE(m.created_at, ${waAtExpr}) AS last_message_at,
         COALESCE(unread.total, 0) AS unread_count
       FROM canonical_leads l
       LEFT JOIN LATERAL (
         SELECT text, direction, created_at
         FROM public.crm_messages
         WHERE lead_id IN (
           SELECT id FROM public.crm_leads l2
           WHERE l2.client_id = l.client_id
             AND l2.numero    = l.numero
             AND l2.numero IS NOT NULL
           UNION SELECT l.id
         )
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total
         FROM public.crm_messages m2
         WHERE m2.lead_id IN (
           SELECT id FROM public.crm_leads l3
           WHERE l3.client_id = l.client_id AND l3.numero = l.numero AND l3.numero IS NOT NULL
           UNION SELECT l.id
         )
           AND m2.direction = 'in'
           AND m2.created_at > COALESCE(l.updated_at, l.created_at - interval '1 day')
       ) unread ON true
       ORDER BY COALESCE(m.created_at, ${waAtExpr}, l.created_at) DESC
       LIMIT 200`,
      [clientId],
    );
    return Response.json(rows);
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
    const { rows: [instance] } = await pool.query(
      `SELECT instance_id, token, provider
       FROM public.client_zapi_instances
       WHERE client_id = $1 AND ativo = true
       ORDER BY created_at ASC
       LIMIT 1`,
      [clientId],
    );
    if (!instance) {
      return Response.json({ error: 'Nenhuma instância ativa encontrada para este cliente.' }, { status: 404 });
    }
    const chats = await fetchProviderChats(instance, limit);

    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS profile_picture_url TEXT,
        ADD COLUMN IF NOT EXISTS whatsapp_last_message_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS whatsapp_last_message_text TEXT,
        ADD COLUMN IF NOT EXISTS whatsapp_last_direction TEXT;
    `);

    const mapped = chats
      .filter(chat => chat.isGroup !== true)
      .map(chat => {
        const remoteJid = String(
          chat.remoteJid
          ?? chat.id
          ?? (chat.key as Record<string, unknown> | undefined)?.remoteJid
          ?? '',
        );
        // Extract phone: prefer explicit field, fallback to remoteJid (strip @s.whatsapp.net etc.)
        const rawPhone = chat.phone ?? chat.phoneNumber ?? remoteJid.split('@')[0] ?? remoteJid;
        const phone = normalizePhone(rawPhone);
        const name = String(chat.name ?? chat.pushName ?? chat.pushname ?? chat.verifiedName ?? chat.phone ?? phone);
        const profilePictureUrl = typeof chat.profilePicUrl === 'string'
          ? chat.profilePicUrl
          : typeof chat.profilePictureUrl === 'string'
            ? chat.profilePictureUrl
            : typeof chat.profile_picture_url === 'string'
              ? chat.profile_picture_url
              : typeof chat.picture === 'string'
                ? chat.picture
                : null;
        return {
          phone,
          name,
          profilePictureUrl,
          remoteJid,
          lastMessageAt: extractLastMessageAt(chat),
          lastMessageText: extractLastMessageText(chat),
          lastDirection: extractLastDirection(chat),
        };
      });

    // Relaxed phone filter: 8–15 digits (covers short local numbers & international)
    const contacts = mapped.filter(contact => {
      const jid = String(contact.remoteJid);
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.includes('newsletter')) return false;
      if (!/^[0-9]{8,15}$/.test(contact.phone)) return false;
      if (!search) return true;
      return (searchDigits.length > 0 && contact.phone.includes(searchDigits))
        || contact.name.toLowerCase().includes(search);
    });

    console.log(`[inbox] fetched=${chats.length} mapped=${mapped.length} contacts=${contacts.length}`);

    let imported = 0;
    for (const contact of contacts) {
      const updated = await pool.query(
        `UPDATE public.crm_leads
         SET nome = COALESCE(NULLIF($3, ''), nome),
             profile_picture_url = COALESCE($4, profile_picture_url),
             whatsapp_last_message_at = COALESCE($5::timestamptz, whatsapp_last_message_at),
             whatsapp_last_message_text = COALESCE($6, whatsapp_last_message_text),
             whatsapp_last_direction = COALESCE($7, whatsapp_last_direction),
             updated_at = NOW()
         WHERE client_id = $1 AND numero = $2
         RETURNING id`,
        [
          clientId,
          contact.phone,
          contact.name,
          contact.profilePictureUrl,
          contact.lastMessageAt,
          contact.lastMessageText,
          contact.lastDirection,
        ],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO public.crm_leads
            (client_id, nome, numero, canal, origin, data, status, profile_picture_url,
             whatsapp_last_message_at, whatsapp_last_message_text, whatsapp_last_direction)
           VALUES ($1, $2, $3, 'Whatsapp', 'organic', CURRENT_DATE, 'Em Atendimento', $4, $5::timestamptz, $6, $7)`,
          [
            clientId,
            contact.name,
            contact.phone,
            contact.profilePictureUrl,
            contact.lastMessageAt,
            contact.lastMessageText,
            contact.lastDirection,
          ],
        );
      }
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
