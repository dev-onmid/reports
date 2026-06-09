import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any, includePassword = false) {
  return {
    id: r.id, name: r.name, email: r.email, role: r.role, status: r.status,
    ...(includePassword ? { password: r.password } : {}),
  };
}

export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  // Include password only for the dedicated login auth check (login=1)
  const forLogin = req.nextUrl.searchParams.get('login') === '1';
  try {
    const { rows } = await pool.query('SELECT * FROM public.users ORDER BY name ASC');
    return Response.json(rows.map(r => rowToJson(r, forLogin)));
  } catch {
    return Response.json([], { status: 200 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { id: string; name: string; email: string; password: string; role: string; status: string };
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.users (id, name, email, password, role, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name=$2, email=$3, password=$4, role=$5, status=$6
       RETURNING *`,
      [body.id, body.name, body.email, body.password, body.role, body.status]
    );
    return Response.json(rowToJson(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.users WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
