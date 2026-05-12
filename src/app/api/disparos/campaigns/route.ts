import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parsePhoneList } from '@/lib/phone-formatter';
import { startCampaign } from '@/lib/campaign-queue';

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

  const parsed = parsePhoneList(numbers);
  if (parsed.length === 0) {
    return Response.json({ error: 'Nenhum número válido encontrado.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows: [campaign] } = await pool.query(
      `INSERT INTO public.zapi_campaigns
         (client_id, name, message, image_url, starts_at, ends_at, interval_min, interval_max, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [clientId, name, message, imageUrl || null, startsAt, endsAt || null, intervalMin, intervalMax, parsed.length],
    );

    // Bulk insert numbers
    const values = parsed
      .map((p, i) => `('${campaign.id}', '${p.phone}', ${p.name ? `'${p.name.replace(/'/g, "''")}'` : 'NULL'}, ${i})`)
      .join(',');
    await pool.query(
      `INSERT INTO public.zapi_numbers (campaign_id, phone, name, position) VALUES ${values}`,
    );

    // Schedule start
    const startsAtDate = new Date(startsAt);
    const now = new Date();
    const delay = startsAtDate.getTime() - now.getTime();

    if (delay <= 0) {
      startCampaign(campaign.id);
    } else {
      setTimeout(() => startCampaign(campaign.id), delay);
    }

    return Response.json(campaign, { status: 201 });
  } finally {
    await pool.end();
  }
}
