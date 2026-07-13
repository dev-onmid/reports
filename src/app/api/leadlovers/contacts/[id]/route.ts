import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const body = await req.json() as Partial<{
      nome: string; email: string; telefone: string; empresa: string;
    }>;

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;

    if (body.nome !== undefined)     { sets.push(`nome = $${idx++}`);     vals.push(body.nome || null); }
    if (body.email !== undefined)    { sets.push(`email = $${idx++}`);    vals.push(body.email || null); }
    if (body.telefone !== undefined) { sets.push(`telefone = $${idx++}`); vals.push(body.telefone || null); }
    if (body.empresa !== undefined)  { sets.push(`empresa = $${idx++}`);  vals.push(body.empresa || null); }

    if (sets.length === 0) return Response.json({ error: 'Nada para atualizar' }, { status: 400 });

    vals.push(id, scope.unrestricted, scope.userId);
    const { rows: [contact] } = await pool.query(
      `UPDATE public.leadlovers_contacts SET ${sets.join(', ')}
        WHERE id = $${idx} AND ($${idx + 1}::boolean OR owner_id = $${idx + 2})
       RETURNING *`,
      vals,
    );
    if (!contact) return Response.json({ error: 'Contato não encontrado' }, { status: 404 });
    return Response.json(contact);
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.leadlovers_contacts
        WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!rowCount) return Response.json({ error: 'Contato não encontrado' }, { status: 404 });
    return Response.json({ deleted: true });
  } finally {
    await pool.end();
  }
}
