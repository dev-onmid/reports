import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    date: r.date,
    destination: r.destination,
    amount: Number(r.amount),
    channel: r.channel,
    status: r.status,
    extra: r.extra ?? false,
  };
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await pool.query('ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS extra BOOLEAN DEFAULT FALSE');
    const { rows } = await pool.query('SELECT * FROM public.payments ORDER BY date ASC');
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    id: string; clientId: string; clientName: string; date: string;
    destination: string; amount: number; channel: string; status: string; extra?: boolean;
  };
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.payments (id, client_id, client_name, date, destination, amount, channel, status, extra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [body.id, body.clientId, body.clientName, body.date, body.destination, body.amount, body.channel, body.status, body.extra ?? false]
    );
    return Response.json(rowToJson(rows[0] ?? body), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as Partial<{
    status: string; date: string; extra: boolean;
    channel: string; amount: number; clientId: string; clientName: string; destination: string;
  }>;
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  if (body.status      !== undefined) { sets.push(`status = $${i++}`);      vals.push(body.status); }
  if (body.date        !== undefined) { sets.push(`date = $${i++}`);         vals.push(body.date); }
  if (body.extra       !== undefined) { sets.push(`extra = $${i++}`);        vals.push(body.extra); }
  if (body.channel     !== undefined) { sets.push(`channel = $${i++}`);      vals.push(body.channel); }
  if (body.amount      !== undefined) { sets.push(`amount = $${i++}`);       vals.push(body.amount); }
  if (body.clientId    !== undefined) { sets.push(`client_id = $${i++}`);    vals.push(body.clientId); }
  if (body.clientName  !== undefined) { sets.push(`client_name = $${i++}`);  vals.push(body.clientName); }
  if (body.destination !== undefined) { sets.push(`destination = $${i++}`);  vals.push(body.destination); }
  if (sets.length === 0) return new Response(null, { status: 204 });
  vals.push(id);
  const pool = makeServerPool();
  try {
    await pool.query(`UPDATE public.payments SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.payments WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
