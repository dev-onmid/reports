import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const pool = makeServerPool();

  try {
    const allowed = ['enabled', 'reply_message', 'dm_message', 'keyword', 'trigger_type', 'action', 'account_name'];
    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals: any[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (key in body) {
        sets.push(`${key} = $${idx++}`);
        vals.push(body[key]);
      }
    }
    if (!sets.length) return Response.json({ error: 'Nada para atualizar' }, { status: 400 });

    vals.push(id);
    const { rows: [row] } = await pool.query(
      `UPDATE public.meta_automations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
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
    await pool.query(`DELETE FROM public.meta_automations WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
