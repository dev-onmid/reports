import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return { id: r.id, name: r.name, segment: r.segment, status: r.status };
}

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query("SELECT * FROM public.clients ORDER BY name ASC");
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { id: string; name: string; segment: string; status: string };
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.clients (id, name, segment, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = $2, segment = $3, status = $4
       RETURNING *`,
      [body.id, body.name, body.segment, body.status]
    );
    return Response.json(rowToJson(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as Partial<{ name: string; segment: string; status: string }>;
  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.name    !== undefined) { sets.push(`name = $${idx++}`);    vals.push(body.name); }
    if (body.segment !== undefined) { sets.push(`segment = $${idx++}`); vals.push(body.segment); }
    if (body.status  !== undefined) { sets.push(`status = $${idx++}`);  vals.push(body.status); }
    if (sets.length === 0) return Response.json({ error: 'Nothing to update' }, { status: 400 });
    vals.push(id);
    await pool.query(`UPDATE public.clients SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
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
    await pool.query('DELETE FROM public.clients WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
