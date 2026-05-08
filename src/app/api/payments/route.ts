import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

function makePool() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    user: process.env.POSTGRES_USER,
    password: process.env.SUPABASE_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

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
  };
}

export async function GET() {
  const pool = makePool();
  try {
    const { rows } = await pool.query('SELECT * FROM public.payments ORDER BY date ASC');
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    id: string; clientId: string; clientName: string; date: string;
    destination: string; amount: number; channel: string; status: string;
  };
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.payments (id, client_id, client_name, date, destination, amount, channel, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [body.id, body.clientId, body.clientName, body.date, body.destination, body.amount, body.channel, body.status]
    );
    return Response.json(rowToJson(rows[0] ?? body), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as { status?: string };
  const pool = makePool();
  try {
    await pool.query('UPDATE public.payments SET status = $1 WHERE id = $2', [body.status, id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const pool = makePool();
  try {
    await pool.query('DELETE FROM public.payments WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
