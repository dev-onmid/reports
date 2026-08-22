import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';

/**
 * Faturamento por ORIGEM (canal) e por CAMPANHA — de onde vem o dinheiro.
 *
 * ⚠️ A régua de data é a MESMA de `/api/clients/[id]/metrics`: receita conta
 * pelo mês do GANHO (`COALESCE(fechado_em, lead_date, data)`), e lead sem data
 * fica DENTRO da janela. Divergir disso faria a soma das origens não bater com
 * o card de Faturamento na mesma tela — exatamente o tipo de número que faz o
 * painel perder a confiança do gestor.
 *
 * ⚠️ E o valor só existe no negócio GANHO: a ingestão do Agendor grava
 * `valor_rs` apenas no ganho (caso Incorpast), então somar a coluna não mistura
 * pipeline aberto com faturamento.
 *
 * `time_interno` NÃO é filtrado, também por consistência com a rota de métricas.
 */

export const dynamic = 'force-dynamic';

type LinhaBruta = { label: string | null; receita: number; vendas: number };
export type FaturamentoPorOrigem = {
  label: string;
  receita: number;
  vendas: number;
  /** Receita ÷ vendas. `null` sem venda — nunca R$ 0,00. */
  ticket: number | null;
};

/** Rótulos legíveis das origens gravadas pela atribuição. */
const ROTULO: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  organic: 'Orgânico / Direto',
  organico: 'Orgânico / Direto',
  indicacao: 'Indicação',
};

function normalizar(rows: LinhaBruta[], semRotulo: string): FaturamentoPorOrigem[] {
  return rows.map((r) => {
    const cru = r.label?.trim();
    const receita = Number(r.receita) || 0;
    const vendas = Number(r.vendas) || 0;
    return {
      label: cru ? (ROTULO[cru.toLowerCase()] ?? cru) : semRotulo,
      receita,
      vendas,
      ticket: vendas > 0 ? receita / vendas : null,
    };
  });
}

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const range = parseIsoDateRange(
    req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'),
  );
  if (clientIds.length === 0 || !range) {
    return Response.json({ ok: false, origens: [], campanhas: [], total: 0, semAtribuicao: 0 });
  }

  const pool = makeServerPool();
  try {
    // Mesma expressão de receita da rota de métricas, palavra por palavra.
    const VALOR = `COALESCE(NULLIF(revenue, 0), valor_rs, 0)`;
    const JANELA = `(COALESCE(fechado_em, lead_date, data) IS NULL
                     OR COALESCE(fechado_em, lead_date, data) BETWEEN $2 AND $3)`;
    const BASE = `FROM public.crm_leads
                  WHERE client_id = ANY($1) AND ${JANELA}`;
    const params = [clientIds, range.from, range.to];

    const [origens, campanhas, totalRows] = await Promise.all([
      pool.query<LinhaBruta>(
        `SELECT origin AS label,
                COALESCE(SUM(${VALOR}), 0)::float AS receita,
                COUNT(*) FILTER (WHERE ${VALOR} > 0 OR fechou = TRUE)::int AS vendas
           ${BASE}
          GROUP BY origin
         HAVING COALESCE(SUM(${VALOR}), 0) > 0
          ORDER BY receita DESC
          LIMIT 10`,
        params,
      ),
      pool.query<LinhaBruta>(
        `SELECT COALESCE(NULLIF(campaign_name, ''), NULLIF(utm_campaign, '')) AS label,
                COALESCE(SUM(${VALOR}), 0)::float AS receita,
                COUNT(*) FILTER (WHERE ${VALOR} > 0 OR fechou = TRUE)::int AS vendas
           ${BASE}
          GROUP BY 1
         HAVING COALESCE(SUM(${VALOR}), 0) > 0
          ORDER BY receita DESC
          LIMIT 10`,
        params,
      ),
      pool.query<{ total: number; sem_atribuicao: number }>(
        `SELECT COALESCE(SUM(${VALOR}), 0)::float AS total,
                COALESCE(SUM(${VALOR}) FILTER (WHERE
                  NULLIF(campaign_name, '') IS NULL
                  AND NULLIF(utm_campaign, '') IS NULL
                  AND NULLIF(ctwa_clid, '') IS NULL
                  AND NULLIF(gclid, '') IS NULL
                ), 0)::float AS sem_atribuicao
           ${BASE}`,
        params,
      ),
    ]);

    return Response.json({
      ok: true,
      // "Sem origem" entra na lista de propósito: esconder faz a soma das
      // barras não fechar com o total e parecer que falta dinheiro.
      origens: normalizar(origens.rows, 'Sem origem identificada'),
      campanhas: normalizar(campanhas.rows, 'Sem campanha'),
      total: Number(totalRows.rows[0]?.total ?? 0),
      /**
       * ⚠️ Receita SEM nenhum identificador de campanha (nem campaign_name, nem
       * utm, nem ctwa_clid, nem gclid).
       *
       * Levantamento em produção: hoje isso é quase TODO o faturamento — o valor
       * chega pelo Agendor/planilha, que não carrega a campanha, enquanto quem
       * carrega atribuição são os leads de WhatsApp/anúncio, que raramente têm
       * valor gravado. Sem expor isso, o painel mostraria "100% Orgânico" e o
       * gestor leria como conclusão de marketing em vez de lacuna de rastreio.
       */
      semAtribuicao: Number(totalRows.rows[0]?.sem_atribuicao ?? 0),
    });
  } catch (err) {
    // Degrada para vazio: o painel some, o resto do dashboard continua de pé.
    console.error('[faturamento-origem]', err);
    return Response.json({ ok: false, origens: [], campanhas: [], total: 0, semAtribuicao: 0 });
  } finally {
    await pool.end();
  }
}
