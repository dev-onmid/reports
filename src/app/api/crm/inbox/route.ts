import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

const ZAPI_BASE = 'https://api.z-api.io/instances';

function normalizePhone(raw: unknown) {
  return String(raw ?? '').replace(/\D/g, '');
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
    const headers = { 'Content-Type': 'application/json', apikey };
    const body = JSON.stringify({ page: 1, offset: limit });
    const endpoints = [
      `${base}/chat/findChats/${instance.instance_id}`,
      `${base}/chat/findContacts/${instance.instance_id}`,
      `${base}/contact/findContacts/${instance.instance_id}`,
    ];
    for (const url of endpoints) {
      const res = await fetch(url, { method: 'POST', headers, body }).catch(() => null);
      if (!res?.ok) continue;
      const records = extractRecords(await res.json().catch(() => null));
      if (records.length > 0) return records;
    }
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
    const { rows: columnRows } = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'crm_leads'
         AND column_name IN ('profile_picture_url', 'picture_url', 'avatar_url')`,
    );
    const avatarColumn = ['profile_picture_url', 'picture_url', 'avatar_url']
      .find(column => columnRows.some(row => row.column_name === column));
    const avatarSelect = avatarColumn ? `l.${avatarColumn}` : `NULL::text`;

    const { rows } = await pool.query(
       `SELECT
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
         m.text        AS last_message,
         m.direction   AS last_direction,
         m.created_at  AS last_message_at,
         COUNT(m2.id)  AS unread_count
       FROM public.crm_leads l
       LEFT JOIN LATERAL (
         -- Busca última mensagem de qualquer lead com o mesmo número do cliente
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
       LEFT JOIN public.crm_messages m2
         ON m2.lead_id IN (
           SELECT id FROM public.crm_leads l3
           WHERE l3.client_id = l.client_id AND l3.numero = l.numero AND l3.numero IS NOT NULL
           UNION SELECT l.id
         )
         AND m2.direction = 'in'
         AND m2.created_at > COALESCE(l.updated_at, l.created_at - interval '1 day')
       WHERE l.client_id = $1
         -- Filtros anti-grupo: exclui JIDs de grupo normalizados (muito longos ou muito curtos)
         -- Números válidos brasileiros com código do país: 12-13 dígitos
         -- Sem código do país (legado): 10-11 dígitos. Faixa segura: 10-15.
         AND (
           l.numero IS NULL
           OR (
             l.numero ~ '^[0-9]{10,15}$'
             AND l.numero NOT LIKE '%--%'
           )
         )
       GROUP BY l.id, m.text, m.direction, m.created_at
       ORDER BY COALESCE(m.created_at, l.created_at) DESC
       LIMIT 200`,
      [clientId],
    );
    return Response.json(rows);
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
      ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
    `);

    const contacts = chats
      .filter(chat => chat.isGroup !== true)
      .map(chat => {
        const remoteJid = String(chat.remoteJid ?? chat.id ?? (chat.key as Record<string, unknown> | undefined)?.remoteJid ?? '');
        const phone = normalizePhone(chat.phone ?? remoteJid);
        const name = String(chat.name ?? chat.pushName ?? chat.pushname ?? chat.phone ?? phone);
        const profilePictureUrl = typeof chat.profilePicUrl === 'string'
          ? chat.profilePicUrl
          : typeof chat.profilePictureUrl === 'string'
            ? chat.profilePictureUrl
            : typeof chat.profile_picture_url === 'string'
              ? chat.profile_picture_url
              : typeof chat.picture === 'string'
                ? chat.picture
                : null;
        return { phone, name, profilePictureUrl, remoteJid };
      })
      .filter(contact => {
        if (String(contact.remoteJid).endsWith('@g.us') || String(contact.remoteJid).endsWith('@broadcast')) return false;
        if (!/^[0-9]{10,15}$/.test(contact.phone)) return false;
        if (!search) return true;
        return (searchDigits.length > 0 && contact.phone.includes(searchDigits))
          || contact.name.toLowerCase().includes(search);
      });

    let imported = 0;
    for (const contact of contacts) {
      const updated = await pool.query(
        `UPDATE public.crm_leads
         SET nome = COALESCE(NULLIF($3, ''), nome),
             profile_picture_url = COALESCE($4, profile_picture_url),
             updated_at = NOW()
         WHERE client_id = $1 AND numero = $2
         RETURNING id`,
        [clientId, contact.phone, contact.name, contact.profilePictureUrl],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await pool.query(
          `INSERT INTO public.crm_leads
            (client_id, nome, numero, canal, origin, data, status, profile_picture_url)
           VALUES ($1, $2, $3, 'Whatsapp', 'organic', CURRENT_DATE, 'Em Atendimento', $4)`,
          [clientId, contact.name, contact.phone, contact.profilePictureUrl],
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
