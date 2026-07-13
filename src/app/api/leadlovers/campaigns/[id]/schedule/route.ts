import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

// Tabela dia-a-dia do cronograma: agrupa os contatos já agendados (next_send_at
// setado pelo /activate) por data local (America/Sao_Paulo), pra UI mostrar
// "50 contatos no dia 14/07, 40 já enviados, 10 pendentes" e permitir disparo manual.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const scope = await getCallerScope(req, pool);
    if (!scope.userId) return Response.json({ error: 'Não autorizado' }, { status: 401 });

    const { rows: [campaign] } = await pool.query(
      `SELECT id FROM public.leadlovers_campaigns WHERE id = $1 AND ($2::boolean OR owner_id = $3)`,
      [id, scope.unrestricted, scope.userId],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });

    const { rows } = await pool.query(
      `SELECT
         TO_CHAR(next_send_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pendente')::int AS pendente,
         COUNT(*) FILTER (WHERE status = 'enviado')::int  AS enviado,
         COUNT(*) FILTER (WHERE status = 'erro')::int     AS erro
       FROM public.leadlovers_contacts
       WHERE campaign_id = $1 AND next_send_at IS NOT NULL
       GROUP BY 1
       ORDER BY 1`,
      [id],
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
