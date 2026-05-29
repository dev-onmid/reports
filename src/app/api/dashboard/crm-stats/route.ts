import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT
         status,
         COUNT(*)::int            AS count,
         SUM(COALESCE(valor_rs, 0))::float AS valor,
         COUNT(*) FILTER (WHERE fechou = true)::int AS fechados
       FROM public.crm_leads
       WHERE client_id = $1
       GROUP BY status
       ORDER BY COUNT(*) DESC`,
      [clientId],
    );

    const total = rows.reduce((s, r) => s + r.count, 0);
    const ganhos = rows.reduce((s, r) => s + r.fechados, 0);
    const faturamento = rows
      .filter(r => r.fechados > 0)
      .reduce((s, r) => s + r.valor, 0);

    const LOST_STATUSES = ['Sem Interesse', 'Desqualificado', 'Não Retorna'];
    const perdidos = rows
      .filter(r => LOST_STATUSES.includes(r.status ?? ''))
      .reduce((s, r) => s + r.count, 0);

    const ativos = total - perdidos - ganhos;

    return Response.json({
      total,
      ativos: Math.max(0, ativos),
      ganhos,
      perdidos,
      faturamento,
      byStatus: rows.map(r => ({
        status: r.status ?? 'Sem status',
        count: r.count,
        valor: r.valor,
        pct: total > 0 ? Math.round((r.count / total) * 100) : 0,
      })),
    });
  } finally {
    await pool.end();
  }
}
