import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

function makePool() {
  return new Pool({
    host: 'aws-1-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    label: r.label ?? '',
    status: r.status ?? 'connected',
    appId: r.app_id ?? '',
    accessToken: r.access_token ?? '',
    userId: r.user_id ?? '',
    userName: r.user_name ?? '',
    userPicture: r.user_picture ?? null,
    connectedAt: r.connected_at ?? new Date().toISOString(),
  };
}

export async function GET() {
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.meta_connections ORDER BY connected_at DESC'
    );
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    label: string; status: string; appId: string;
    accessToken: string; userId: string; userName: string; userPicture?: string;
  };
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.meta_connections (label, status, app_id, access_token, user_id, user_name, user_picture)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [body.label, body.status, body.appId, body.accessToken, body.userId, body.userName, body.userPicture ?? null]
    );
    return Response.json(rowToJson(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const pool = makePool();
  try {
    await pool.query('DELETE FROM public.meta_connections WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
