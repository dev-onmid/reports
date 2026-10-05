import type { Pool } from 'pg';
import { leadContaSql } from '@/lib/lead-contagem';

/**
 * Faturamento, vendas e leads do CRM num período — a conta que o card de
 * Faturamento/Leads da DASHBOARD mostra.
 *
 * Mora numa lib porque dois lugares precisam do MESMO número: a rota
 * `/api/clients/[id]/metrics` (dashboard) e o relatório de performance. Enquanto
 * cada um tinha a sua query, o relatório da Cinfel de setembro saiu com
 * R$ 37.511,76 e a dashboard com R$ 44.732,93 para o mesmo mês — o relatório
 * contava a venda pelo mês de CRIAÇÃO do lead e ignorava a lei de contagem.
 *
 * ⚠️ Duas janelas de data de propósito (caso Incorpast):
 *  - LEADS contam pelo mês em que o lead foi CRIADO (topo do funil);
 *  - RECEITA/VENDAS contam pelo mês do GANHO (`fechado_em`, gravado pela
 *    ingestão do CRM externo). Lead sem `fechado_em` cai na data do lead.
 * "Data NULL fica dentro" vale nas duas.
 *
 * ⚠️ `regiao` é o recorte opcional de `filtroRegiaoSql(recorte, 4)` — o `$4` é
 * fixo porque `$1..$3` são cliente e janela.
 */
export type CrmDoPeriodo = { revenue: number; sales: number; leads: number; ticket: number };

export const CRM_PERIODO_SQL = `SELECT
    COALESCE(SUM(COALESCE(NULLIF(revenue, 0), valor_rs, 0)) FILTER (WHERE
      COALESCE(fechado_em, lead_date, data) IS NULL
      OR COALESCE(fechado_em, lead_date, data) BETWEEN $2 AND $3
    ), 0)::float AS revenue,
    COUNT(*) FILTER (WHERE
      (COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0 OR fechou = TRUE)
      AND (
        COALESCE(fechado_em, lead_date, data) IS NULL
        OR COALESCE(fechado_em, lead_date, data) BETWEEN $2 AND $3
      )
    )::int AS sales,
    COUNT(*) FILTER (WHERE
      COALESCE(lead_date, data) IS NULL
      OR COALESCE(lead_date, data) BETWEEN $2 AND $3
    )::int AS leads
   FROM public.crm_leads
  -- A LEI (lead-contagem.ts): só lead que conta na dashboard.
  WHERE client_id = $1 AND ${leadContaSql()}`;

export function crmDoPeriodoDaLinha(row: Record<string, unknown> | undefined): CrmDoPeriodo | null {
  if (!row) return null;
  const revenue = Number(row.revenue ?? 0);
  const sales = Number(row.sales ?? 0);
  return { revenue, sales, leads: Number(row.leads ?? 0), ticket: sales > 0 ? revenue / sales : 0 };
}

/** Nunca lança: sem banco/coluna devolve `null`, e quem chama degrada. */
export async function consultarCrmDoPeriodo(
  pool: Pool,
  clientId: string,
  from: string,
  to: string,
  regiao: { sql: string; params: unknown[] } = { sql: '', params: [] },
): Promise<CrmDoPeriodo | null> {
  try {
    const { rows } = await pool.query(`${CRM_PERIODO_SQL}${regiao.sql}`, [clientId, from, to, ...regiao.params]);
    return crmDoPeriodoDaLinha(rows[0]);
  } catch (e) {
    console.error('[crm-metricas]', e);
    return null;
  }
}
