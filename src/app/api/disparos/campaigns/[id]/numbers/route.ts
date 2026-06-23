import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.unrestricted) {
      const { rows: [owned] } = await pool.query(
        `SELECT 1 FROM public.zapi_campaigns c JOIN public.zapi_clients cl ON cl.id = c.client_id
          WHERE c.id = $1 AND cl.owner_id = $2`,
        [id, scope.userId],
      );
      if (!owned) return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });
    }
    const { rows } = await pool.query(
      `SELECT phone, name, status, error_msg, sent_at
         FROM public.zapi_numbers
        WHERE campaign_id = $1
        ORDER BY position ASC`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
