import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parsePhoneList } from '@/lib/phone-formatter';

async function ensureColumns(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_from TEXT;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_until TEXT;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ;
    ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS messages JSONB;
  `);
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const { rows } = await pool.query(
      `SELECT c.*, cl.name AS client_name
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        ORDER BY c.created_at DESC`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    clientId: string;
    name: string;
    message: string;
    messages?: string[];
    imageUrls?: string[];
    numbers: string;
    startsAt: string;
    endsAt?: string;
    intervalMin: number;
    intervalMax: number;
    activeFrom?: string;
    activeUntil?: string;
  };

  const { clientId, name, message, messages, imageUrls, numbers, startsAt, endsAt, intervalMin, intervalMax, activeFrom, activeUntil } = body;
  const imageUrl = imageUrls && imageUrls.length > 0 ? JSON.stringify(imageUrls) : null;
  const messagesJson = messages && messages.length > 1 ? JSON.stringify(messages) : null;

  if (!clientId || !name || !message || !numbers || !startsAt) {
    return Response.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  if (endsAt) {
    const endsAtDate = new Date(endsAt);
    const startsAtDate2 = new Date(startsAt);
    if (endsAtDate <= startsAtDate2) {
      return Response.json({ error: 'Horário de término deve ser depois do início.' }, { status: 400 });
    }
  }

  const parsed = parsePhoneList(numbers);
  if (parsed.length === 0) {
    return Response.json({ error: 'Nenhum número válido encontrado.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureColumns(pool);
    const startsAtDate = new Date(startsAt);
    const initialStatus = startsAtDate <= new Date() ? 'running' : 'pending';

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.zapi_campaigns
         (client_id, name, message, image_url, status, starts_at, ends_at, interval_min, interval_max, total, active_from, active_until, messages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [clientId, name, message, imageUrl || null, initialStatus, startsAt, endsAt || null, intervalMin, intervalMax, parsed.length, activeFrom || null, activeUntil || null, messagesJson],
    );

    for (let i = 0; i < parsed.length; i++) {
      await pool.query(
        `INSERT INTO public.zapi_numbers (campaign_id, phone, name, position) VALUES ($1,$2,$3,$4)`,
        [campaign.id, parsed[i].phone, parsed[i].name || null, i],
      );
    }

    return Response.json(campaign, { status: 201 });
  } finally {
    await pool.end();
  }
}
