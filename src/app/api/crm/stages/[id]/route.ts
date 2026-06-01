import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { label, color, position } = await req.json().catch(() => ({})) as {
    label?: string; color?: string; position?: number;
  };

  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (label !== undefined) { sets.push(`label = $${n++}`); vals.push(label.trim()); }
    if (color !== undefined) { sets.push(`color = $${n++}`); vals.push(color); }
    if (position !== undefined) { sets.push(`position = $${n++}`); vals.push(position); }
    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });

    vals.push(id);
    const { rows: [stage] } = await pool.query(
      `UPDATE public.crm_stages SET ${sets.join(', ')} WHERE id = $${n} RETURNING id, label, color, position`,
      vals,
    );
    if (!stage) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(stage);
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
    await pool.query(`DELETE FROM public.crm_stages WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
