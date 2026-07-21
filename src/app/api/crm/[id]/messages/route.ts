import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientInstance, sendFollowupMessage } from '@/lib/followup-send';
import { analisarConversa } from '@/lib/crm-ai-analysis';
import { ensureCrmMessagesSchema, ensureDefaultFunnel } from '@/lib/crm-conversation-sync';

// Ensures crm_messages has all columns the code expects.
// The original migration only had: id, contact_id, client_id(?), direction, text, created_at.
// We add the columns used by all chat routes.
async function migrateCrmMessages(pool: ReturnType<typeof makeServerPool>) {
  await ensureCrmMessagesSchema(pool);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Busca incremental: ?after=<ISO> retorna só mensagens mais novas — o poll de
  // 3s do chat deixa de rebaixar a conversa inteira (até 500 linhas) a cada tick.
  const afterRaw = req.nextUrl.searchParams.get('after');
  const after = afterRaw && !Number.isNaN(new Date(afterRaw).getTime()) ? afterRaw : null;
  const pool = makeServerPool();
  try {
    await migrateCrmMessages(pool);

    const BASE_WITH_CONTACTS = `
      WITH target AS (
        SELECT id, client_id, numero
          FROM public.crm_leads
         WHERE id = $1
         LIMIT 1
      ),
      lead_matches AS (
        SELECT l2.id
          FROM public.crm_leads l2
          JOIN target t ON t.client_id = l2.client_id
         WHERE l2.id = t.id
            OR (
              NULLIF(regexp_replace(COALESCE(l2.numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
      ),
      contact_matches AS (
        SELECT c.id
          FROM public.crm_contacts c
          JOIN target t ON t.client_id = c.client_id
         WHERE NULLIF(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g'), '') =
               NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '')
           AND NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '') IS NOT NULL
      )`;
    const BASE_WITHOUT_CONTACTS = `
      WITH target AS (
        SELECT id, client_id, numero
          FROM public.crm_leads
         WHERE id = $1
         LIMIT 1
      ),
      lead_matches AS (
        SELECT l2.id
          FROM public.crm_leads l2
          JOIN target t ON t.client_id = l2.client_id
         WHERE l2.id = t.id
            OR (
              NULLIF(regexp_replace(COALESCE(l2.numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE(t.numero, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
      )`;
    const AFTER_CLAUSE = after ? `AND m.created_at > $2::timestamptz` : '';
    const WHERE_WITH_CONTACTS = `
      WHERE (m.lead_id IN (SELECT id FROM lead_matches)
         OR m.contact_id IN (SELECT id FROM contact_matches))
        ${AFTER_CLAUSE}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 500`;
    const WHERE_WITHOUT_CONTACTS = `
      WHERE m.lead_id IN (SELECT id FROM lead_matches)
        ${AFTER_CLAUSE}
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 500`;
    const queryParams = after ? [id, after] : [id];

    // Try with tipo column first; fall back to 'texto' literal if column missing
    let rows: unknown[] = [];
    try {
      const result = await pool.query(
        `${BASE_WITH_CONTACTS}
         SELECT m.id, m.direction, m.text, COALESCE(m.tipo, 'texto') AS tipo, m.created_at,
                m.whatsapp_status, m.whatsapp_error, m.reply_to_text
         FROM public.crm_messages m ${WHERE_WITH_CONTACTS}`,
        queryParams,
      );
      rows = result.rows;
    } catch (withContactsErr) {
      const result = await pool.query(
        `${BASE_WITHOUT_CONTACTS}
         SELECT m.id, m.direction, m.text, 'texto' AS tipo, m.created_at,
                m.whatsapp_status, m.whatsapp_error
         FROM public.crm_messages m ${WHERE_WITHOUT_CONTACTS}`,
        queryParams,
      ).catch(async () => {
        if (withContactsErr) throw withContactsErr;
        throw new Error('Falha ao carregar mensagens');
      });
      rows = result.rows;
    }

    // Conversa na tela = lida. Este GET só é chamado com a conversa aberta (load
    // inicial + poll de 5s), então marcar aqui zera o contador de não-lidas do
    // inbox — que antes era o total histórico de mensagens e nunca zerava.
    await pool.query(
      `UPDATE public.crm_leads SET chat_read_at = NOW() WHERE id = $1`,
      [id],
    ).catch(() => null);

    return Response.json({ messages: rows });
  } catch (err) {
    console.error('[messages GET]', err);
    return Response.json({ messages: [], error: String(err) });
  } finally {
    await pool.end();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as {
    text?: string;
    tipo?: string;            // 'texto'|'imagem'|'audio'|'video'|'documento'|'localizacao'
    url?: string;             // for media
    lat?: number;             // for location
    lng?: number;
    location_name?: string;
    caption?: string;
    direction?: string;
  };

  const tipo = body.tipo ?? 'texto';
  const direction = body.direction ?? 'out';

  // Build display text for DB
  let dbText: string;
  if (tipo === 'localizacao') {
    dbText = `📍 Localização: ${body.location_name ?? ''} (${body.lat ?? 0}, ${body.lng ?? 0})`;
  } else if (tipo !== 'texto') {
    dbText = body.url?.trim() ?? '';
  } else {
    dbText = body.text?.trim() ?? '';
  }

  if (!dbText) return Response.json({ error: 'content required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows: [lead] } = await pool.query(
      `SELECT client_id, numero, whatsapp_lid, nome, status, origin, canal, time_interno FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!lead) return Response.json({ error: 'lead not found' }, { status: 404 });
    await ensureDefaultFunnel(pool, lead.client_id);
    const { rows: [canonical] } = await pool.query<{ id: string }>(
      `SELECT id
         FROM public.crm_leads
        WHERE client_id = $1
          AND (
            id = $2::uuid
            OR (
              NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
          )
        ORDER BY
          CASE WHEN funnel_id IS NOT NULL THEN 0 ELSE 1 END,
          COALESCE(updated_at, created_at) DESC,
          created_at DESC
        LIMIT 1`,
      [lead.client_id, id, lead.numero ?? null],
    );
    const targetLeadId = canonical?.id ?? id;

    await migrateCrmMessages(pool);

    // Send via WhatsApp when outbound and lead has a phone number
    let waSent = false;
    let waError: string | undefined;
    let waExternalId: string | undefined;
    let whatsappStatus: string | null = direction === 'out' ? 'pending' : null;

    if (direction === 'out') {
      if (lead.numero) {
        const instance = await getClientInstance(pool, lead.client_id);
        if (instance) {
          if (tipo === 'localizacao') {
            waSent = await sendLocation(instance, lead.numero, body.lat ?? 0, body.lng ?? 0, body.location_name ?? '');
            if (!waSent) waError = 'Falha ao enviar localização pelo WhatsApp';
          } else {
            const result = await sendFollowupMessage({
              instance,
              phone: lead.numero,
              tipo,
              conteudo: tipo === 'texto' ? dbText : (body.url ?? ''),
              vars: {
                nome: lead.nome ?? lead.numero,
                telefone: lead.numero,
                status: lead.status ?? '',
                campanha: lead.origin ?? lead.canal ?? '',
                caption: body.caption ?? '',
                whatsapp_lid: lead.whatsapp_lid ?? '',
              },
            });
            waSent = result.ok;
            waError = result.error;
            waExternalId = result.externalId;
          }
        } else {
          waError = 'Nenhuma instância WhatsApp ativa para este cliente';
        }
      } else {
        waError = 'Lead sem telefone para envio';
      }
      whatsappStatus = waSent ? 'sent' : 'failed';
    }

    const { rows: [msg] } = await pool.query(
      `INSERT INTO public.crm_messages
        (lead_id, client_id, direction, text, tipo, external_id, whatsapp_status, whatsapp_error)
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, NULLIF($8, ''))
       RETURNING id, direction, text, tipo, created_at, whatsapp_status, whatsapp_error`,
      [targetLeadId, lead.client_id, direction, dbText, tipo, waExternalId ?? '', whatsappStatus, waError ?? ''],
    );
    await pool.query(
      `UPDATE public.crm_leads
          SET updated_at = NOW(),
              whatsapp_last_message_text = $4,
              whatsapp_last_direction = $5,
              whatsapp_last_message_at = NOW()
        WHERE client_id = $1
          AND (
            id = $2::uuid
            OR (
              NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
          )`,
      [lead.client_id, id, lead.numero ?? null, dbText, direction],
    );
    if (lead.time_interno !== true) {
      await analisarConversa(pool, targetLeadId).catch(err => console.error('[messages analisarConversa]', err));
    }

    return Response.json({ ...msg, wa_sent: waSent, wa_error: waError ?? null }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[messages POST]', msg);
    return Response.json({ error: msg, wa_sent: false }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const { rows: [lead] } = await pool.query(
      `SELECT client_id, numero FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!lead) return Response.json({ error: 'lead not found' }, { status: 404 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.crm_messages
       WHERE lead_id = $1
          OR lead_id IN (
            SELECT l2.id FROM public.crm_leads l2
            WHERE l2.client_id = $2
              AND l2.numero IS NOT NULL
              AND l2.numero = $3
          )`,
      [id, lead.client_id, lead.numero ?? null],
    );
    return Response.json({ deleted: rowCount ?? 0 });
  } finally {
    await pool.end();
  }
}

async function sendLocation(
  instance: { instanceId: string; token: string; provider: 'zapi' | 'evolution' },
  phone: string,
  lat: number,
  lng: number,
  name: string,
): Promise<boolean> {
  try {
    if (instance.provider === 'evolution') {
      const base = process.env.EVOLUTION_API_URL;
      const apikey = process.env.EVOLUTION_API_KEY;
      if (!base || !apikey) return false;
      const res = await fetch(`${base}/message/sendLocation/${instance.instanceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey },
        body: JSON.stringify({
          number: phone,
          locationMessage: { lat, lng, name },
        }),
      });
      return res.ok;
    }
    // Z-API
    const res = await fetch(
      `https://api.z-api.io/instances/${instance.instanceId}/token/${instance.token}/send-location`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, lat, lng, name }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
