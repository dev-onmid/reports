import { makeServerPool } from '@/lib/server-db';
import { ensureCrmAiSchema } from '@/lib/crm-ai-analysis';

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureCrmAiSchema(pool);
    const { rows } = await pool.query(
      `SELECT
          u.client_id,
          COALESCE(c.name, u.client_id) AS client_name,
          u.mes_ano,
          u.chamadas_ia,
          u.tokens_usados,
          u.custo_estimado_usd::float AS custo_estimado_usd,
          COALESCE(cfg.ia_limite_chamadas_dia, 500)::int AS ia_limite_chamadas_dia,
          COALESCE(today.total, 0)::int AS chamadas_hoje
         FROM public.ia_uso_mensal u
         LEFT JOIN public.clients c ON c.id::text = u.client_id
         LEFT JOIN public.client_tracking_config cfg ON cfg.client_id = u.client_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS total
             FROM public.crm_ia_historico h
            WHERE h.client_id = u.client_id
              AND h.erro IS NULL
              AND h.created_at >= CURRENT_DATE
         ) today ON true
        ORDER BY u.mes_ano DESC, chamadas_ia DESC
        LIMIT 100`,
    );
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
