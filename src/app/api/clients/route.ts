import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

async function ensureGestorColumn(pool: ReturnType<typeof makeServerPool>) {
  await pool.query('ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gestor_id TEXT').catch(() => {});
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    name: r.name,
    segment: r.segment,
    status: r.status,
    gestor_id: r.gestor_id ?? null,
    gestor_name: r.gestor_name ?? null,
  };
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureGestorColumn(pool);
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.segment, c.status, c.gestor_id, u.name as gestor_name
      FROM public.clients c
      LEFT JOIN public.users u ON c.gestor_id = u.id
      ORDER BY c.name ASC
    `);
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { id: string; name: string; segment: string; status: string; gestor_id?: string };
  const pool = makeServerPool();
  try {
    await ensureGestorColumn(pool);
    const { rows } = await pool.query(
      `INSERT INTO public.clients (id, name, segment, status, gestor_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = $2, segment = $3, status = $4, gestor_id = $5
       RETURNING id, name, segment, status, gestor_id`,
      [body.id, body.name, body.segment, body.status, body.gestor_id ?? null]
    );
    const row = rows[0];
    // Fetch gestor name
    let gestor_name = null;
    if (row.gestor_id) {
      const { rows: u } = await pool.query('SELECT name FROM public.users WHERE id = $1', [row.gestor_id]);
      gestor_name = u[0]?.name ?? null;
    }
    return Response.json(rowToJson({ ...row, gestor_name }), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  const body = await req.json() as Partial<{ name: string; segment: string; status: string; gestor_id: string | null }>;
  const pool = makeServerPool();
  try {
    await ensureGestorColumn(pool);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.name      !== undefined) { sets.push(`name = $${idx++}`);      vals.push(body.name); }
    if (body.segment   !== undefined) { sets.push(`segment = $${idx++}`);   vals.push(body.segment); }
    if (body.status    !== undefined) { sets.push(`status = $${idx++}`);    vals.push(body.status); }
    if (body.gestor_id !== undefined) { sets.push(`gestor_id = $${idx++}`); vals.push(body.gestor_id); }
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
