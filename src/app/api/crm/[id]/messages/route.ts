import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientInstance, sendFollowupMessage } from '@/lib/followup-send';
import { analisarConversa } from '@/lib/crm-ai-analysis';

// Ensures crm_messages has all columns the code expects.
// The original migration only had: id, contact_id, client_id(?), direction, text, created_at.
// We add the columns used by all chat routes.
async function migrateCrmMessages(pool: ReturnType<typeof makeServerPool>) {
  const stmts = [
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS lead_id UUID`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS client_id TEXT`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto'`,
    `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS external_id TEXT`,
    `ALTER TABLE public.crm_messages ALTER COLUMN contact_id DROP NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_crm_messages_lead ON public.crm_messages (lead_id, created_at DESC) WHERE lead_id IS NOT NULL`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(() => null);
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await migrateCrmMessages(pool);

    const BASE_WHERE = `
      WHERE m.lead_id = $1
         OR m.lead_id IN (
           SELECT l2.id FROM public.crm_leads l2
           WHERE l2.client_id = (SELECT client_id FROM public.crm_leads WHERE id = $1 LIMIT 1)
             AND l2.numero    = (SELECT numero    FROM public.crm_leads WHERE id = $1 LIMIT 1)
             AND l2.numero IS NOT NULL
         )
      ORDER BY m.created_at ASC, m.id ASC
      LIMIT 500`;

    // Try with tipo column first; fall back to 'texto' literal if column missing
    let rows: unknown[] = [];
    try {
      const result = await pool.query(
        `SELECT m.id, m.direction, m.text, COALESCE(m.tipo, 'texto') AS tipo, m.created_at
         FROM public.crm_messages m ${BASE_WHERE}`,
        [id],
      );
      rows = result.rows;
    } catch {
      const result = await pool.query(
        `SELECT m.id, m.direction, m.text, 'texto' AS tipo, m.created_at
         FROM public.crm_messages m ${BASE_WHERE}`,
        [id],
      );
      rows = result.rows;
    }

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
      `SELECT client_id, numero, nome, status, origin, canal, time_interno FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!lead) return Response.json({ error: 'lead not found' }, { status: 404 });
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

    if (direction === 'out' && lead.numero) {
      const instance = await getClientInstance(pool, lead.client_id);
      if (instance) {
        if (tipo === 'localizacao') {
          waSent = await sendLocation(instance, lead.numero, body.lat ?? 0, body.lng ?? 0, body.location_name ?? '');
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
            },
          });
          waSent = result.ok;
          waError = result.error;
        }
      }
    }

    const { rows: [msg] } = await pool.query(
      `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, direction, text, tipo, created_at`,
      [targetLeadId, lead.client_id, direction, dbText, tipo],
    );
    await pool.query(
      `UPDATE public.crm_leads
          SET updated_at = NOW()
        WHERE client_id = $1
          AND (
            id = $2::uuid
            OR (
              NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') =
              NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '')
              AND NULLIF(regexp_replace(COALESCE($3::text, ''), '\\D', '', 'g'), '') IS NOT NULL
            )
          )`,
      [lead.client_id, id, lead.numero ?? null],
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
