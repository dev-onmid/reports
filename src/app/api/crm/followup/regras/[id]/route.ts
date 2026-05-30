import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { nome, status_gatilho, ativo } = await req.json().catch(() => ({})) as {
    nome?: string; status_gatilho?: string; ativo?: boolean;
  };

  const pool = makeServerPool();
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    if (nome !== undefined)           { sets.push(`nome = $${n++}`);           vals.push(nome.trim()); }
    if (status_gatilho !== undefined) { sets.push(`status_gatilho = $${n++}`); vals.push(status_gatilho.trim()); }
    if (ativo !== undefined)          { sets.push(`ativo = $${n++}`);          vals.push(ativo); }
    if (sets.length === 0) return Response.json({ error: 'nothing to update' }, { status: 400 });

    vals.push(id);
    const { rows: [regra] } = await pool.query(
      `UPDATE public.crm_followup_regras SET ${sets.join(', ')} WHERE id = $${n} RETURNING *`,
      vals,
    );
    if (!regra) return Response.json({ error: 'not found' }, { status: 404 });
    return Response.json(regra);
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
    await pool.query(`DELETE FROM public.crm_followup_regras WHERE id = $1`, [id]);
    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
