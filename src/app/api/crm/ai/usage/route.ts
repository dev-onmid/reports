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
          COALESCE(cfg.ia_ativa, FALSE) AS ia_ativa,
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
        LIMIT 2000`,
    );
    // ⚠️ Todo cliente ATIVO entra no MÊS CORRENTE mesmo com zero uso — a IA é
    // opt-in (default OFF) e a tabela era montada só de ia_uso_mensal, então
    // cliente que nunca usou não aparecia e era IMPOSSÍVEL ligá-lo pela tela
    // (auditoria 2026-08-22). Meses passados seguem só com quem usou.
    const mesAtual = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    const jaNoMes = new Set(rows.filter(r => r.mes_ano === mesAtual).map(r => r.client_id));
    const { rows: ativos } = await pool.query(
      `SELECT c.id::text AS client_id, c.name AS client_name,
              COALESCE(cfg.ia_limite_chamadas_dia, 500)::int AS ia_limite_chamadas_dia,
              COALESCE(cfg.ia_ativa, FALSE) AS ia_ativa
         FROM public.clients c
         LEFT JOIN public.client_tracking_config cfg ON cfg.client_id = c.id::text
        WHERE COALESCE(c.status, 'Ativo') = 'Ativo'
        ORDER BY c.name`,
    );
    for (const a of ativos) {
      if (jaNoMes.has(a.client_id)) continue;
      rows.push({
        client_id: a.client_id, client_name: a.client_name, mes_ano: mesAtual,
        chamadas_ia: 0, tokens_usados: 0, custo_estimado_usd: 0,
        ia_limite_chamadas_dia: a.ia_limite_chamadas_dia, ia_ativa: a.ia_ativa,
        chamadas_hoje: 0,
      });
    }
    return Response.json(rows);
  } finally {
    await pool.end();
  }
}
