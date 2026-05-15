import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as { enabled?: boolean; name?: string; description?: string };
  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals: any[] = [];
    let idx = 1;
    if (body.enabled !== undefined) { sets.push(`enabled = $${idx++}`); vals.push(body.enabled); }
    if (body.name)        { sets.push(`name = $${idx++}`);        vals.push(body.name); }
    if (body.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(body.description); }
    if (sets.length === 0) return Response.json({ error: 'Nada para atualizar' }, { status: 400 });

    vals.push(id);
    const { rows: [row] } = await pool.query(
      `UPDATE public.webhook_configs SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals,
    );
    if (!row) return Response.json({ error: 'Não encontrado' }, { status: 404 });
    return Response.json(row);
  } finally {
    await pool.end();
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    await pool.query(`DELETE FROM public.webhook_configs WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
