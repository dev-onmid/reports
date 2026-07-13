import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rowCount } = await pool.query(
      `DELETE FROM public.leadlovers_connections
        WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!rowCount) return Response.json({ error: 'Não encontrada' }, { status: 404 });
    return Response.json({ deleted: true });
  } finally {
    await pool.end();
  }
}
