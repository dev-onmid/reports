import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmDisparoSchema, getConnectedClientInstance } from '@/lib/crm-disparo';
import { resolveAudience, type AudienceFilter } from '../audience/route';

const REASON_MESSAGE: Record<string, string> = {
  no_instance: 'Nenhuma instância de WhatsApp cadastrada para este cliente.',
  disconnected: 'A instância de WhatsApp deste cliente está desconectada. Conecte antes de disparar.',
  unknown: 'Não foi possível confirmar a conexão da instância de WhatsApp. Tente novamente em instantes.',
};

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    await ensureCrmDisparoSchema(pool);
    const { rows } = await pool.query(
      `SELECT * FROM public.crm_disparo_campaigns WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as AudienceFilter & {
    name: string;
    message: string;
    messages?: string[];
    imageUrls?: string[];
    startsAt: string;
    endsAt?: string;
    intervalMin: number;
    intervalMax: number;
    activeFrom?: string;
    activeUntil?: string;
  };

  const {
    clientId, name, message, messages, imageUrls, startsAt, endsAt,
    intervalMin, intervalMax, activeFrom, activeUntil,
    funnelId, stageLabels, tagIds, origin, temperatura, manualNumbers,
  } = body;

  if (!clientId || !name?.trim() || !message?.trim() || !startsAt) {
    return Response.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureCrmDisparoSchema(pool);

    // Lock: only the instance registered AND currently connected for this
    // client may be used. Never accept an instance id from the request.
    const resolved = await getConnectedClientInstance(pool, clientId);
    if (!resolved.instance) {
      return Response.json({ error: REASON_MESSAGE[resolved.reason] }, { status: 409 });
    }

    const audienceFilter: AudienceFilter = { clientId, funnelId, stageLabels, tagIds, origin, temperatura, manualNumbers };
    const audience = await resolveAudience(pool, audienceFilter);
    if (audience.length === 0) {
      return Response.json({ error: 'Nenhum lead encontrado para os filtros selecionados.' }, { status: 400 });
    }

    const imageUrl = imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
    const messagesJson = messages && messages.length > 1 ? JSON.stringify(messages) : null;
    const startsAtDate = new Date(startsAt);
    const initialStatus = startsAtDate <= new Date() ? 'running' : 'pending';

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.crm_disparo_campaigns
         (client_id, name, message, messages, image_url, audience_filter, status,
          starts_at, ends_at, interval_min, interval_max, active_from, active_until, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        clientId, name.trim(), message.trim(), messagesJson, imageUrl, JSON.stringify(audienceFilter),
        initialStatus, startsAt, endsAt || null, intervalMin, intervalMax,
        activeFrom || null, activeUntil || null, audience.length,
      ],
    );

    for (const lead of audience) {
      await pool.query(
        `INSERT INTO public.crm_disparo_leads (campaign_id, lead_id, phone, name, position)
         VALUES ($1,$2,$3,$4,$5)`,
        [campaign.id, lead.leadId, lead.phone, lead.nome, lead.position],
      );
    }

    return Response.json(campaign, { status: 201 });
  } finally {
    await pool.end();
  }
}
