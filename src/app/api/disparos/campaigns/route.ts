import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parsePhoneList } from '@/lib/phone-formatter';

export async function GET() {
  const pool = makeServerPool();
  try {
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
    imageUrl?: string;
    numbers: string;
    startsAt: string;
    endsAt?: string;
    intervalMin: number;
    intervalMax: number;
  };

  const { clientId, name, message, imageUrl, numbers, startsAt, endsAt, intervalMin, intervalMax } = body;

  if (!clientId || !name || !message || !numbers || !startsAt) {
    return Response.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
  }

  if (endsAt) {
    const endsAtDate = new Date(endsAt);
    const startsAtDate2 = new Date(startsAt);
    if (endsAtDate <= new Date()) {
      return Response.json({ error: 'Horário de término já passou. Deixe em branco ou escolha um horário futuro.' }, { status: 400 });
    }
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
    // Determine initial status: if start time is now or past, set running immediately
    const startsAtDate = new Date(startsAt);
    const initialStatus = startsAtDate <= new Date() ? 'running' : 'pending';

    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.zapi_campaigns
         (client_id, name, message, image_url, status, starts_at, ends_at, interval_min, interval_max, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [clientId, name, message, imageUrl || null, initialStatus, startsAt, endsAt || null, intervalMin, intervalMax, parsed.length],
    );

    // Bulk insert numbers using parameterized query
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
