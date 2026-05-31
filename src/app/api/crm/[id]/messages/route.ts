import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getClientInstance, sendFollowupMessage } from '@/lib/followup-send';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    // Garante que a coluna tipo existe (pode não existir em instalações antigas)
    await pool.query(
      `ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto'`
    ).catch(() => null);

    // Busca por lead_id direto E por qualquer outro lead do mesmo cliente
    // com o mesmo número — resolve o mismatch entre lead do webhook e lead do CRM.
    const { rows } = await pool.query(
      `SELECT m.id, m.direction, m.text,
              COALESCE(m.tipo, 'texto') AS tipo,
              m.created_at
       FROM public.crm_messages m
       WHERE m.lead_id = $1
          OR m.lead_id IN (
            SELECT l2.id FROM public.crm_leads l2
            WHERE l2.client_id = (SELECT client_id FROM public.crm_leads WHERE id = $1 LIMIT 1)
              AND l2.numero    = (SELECT numero    FROM public.crm_leads WHERE id = $1 LIMIT 1)
              AND l2.numero IS NOT NULL
          )
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 500`,
      [id],
    );
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
      `SELECT client_id, numero, nome, status, origin, canal FROM public.crm_leads WHERE id = $1`,
      [id],
    );
    if (!lead) return Response.json({ error: 'lead not found' }, { status: 404 });

    // Ensure crm_messages has `tipo` column
    await pool.query(`
      ALTER TABLE public.crm_messages ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'texto'
    `).catch(() => null);

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
      [id, lead.client_id, direction, dbText, tipo],
    );
    await pool.query(`UPDATE public.crm_leads SET updated_at = NOW() WHERE id = $1`, [id]);

    return Response.json({ ...msg, wa_sent: waSent, wa_error: waError ?? null }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[messages POST]', msg);
    return Response.json({ error: msg, wa_sent: false }, { status: 500 });
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
