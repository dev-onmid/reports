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

/** Rótulos legíveis para os canais que chegam em vocabulário de máquina. */
const ROTULO: Record<string, string> = {
  meta: 'Meta Ads',
  google: 'Google Ads',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  organic: 'Orgânico / Direto',
  organico: 'Orgânico / Direto',
};

/**
 * O CANAL do faturamento, em ordem de força da evidência.
 *
 * ⚠️ NÃO usa `origin`. Levantamento em produção: `origin` guarda de onde o lead
 * foi IMPORTADO ('Agendor', 'Datalytics') ou o default 'organic' — nunca o
 * canal. Quem guarda o canal de verdade é **`canal`**: 'Indicação', 'TV',
 * 'Fachada/Passou em Frente', 'Facebook - WhatsApp'… (vem da coluna de origem
 * do próprio export do CRM do cliente). Agrupar por `origin` respondia "por
 * qual porta o dado entrou no sistema", não "o que trouxe a venda".
 *
 * Os click ids vêm ANTES do texto: são prova direta de anúncio, enquanto
 * `canal` é o que alguém digitou.
 */
const CANAL_SQL = `CASE
  WHEN NULLIF(ctwa_clid, '') IS NOT NULL OR NULLIF(fbclid, '') IS NOT NULL THEN 'Meta Ads'
  WHEN NULLIF(gclid, '') IS NOT NULL OR NULLIF(wbraid, '') IS NOT NULL
    OR NULLIF(gbraid, '') IS NOT NULL THEN 'Google Ads'
  WHEN NULLIF(btrim(canal), '') IS NOT NULL
   AND lower(btrim(canal)) NOT IN ('agendor', 'datalytics', 'planilha', 'importacao', 'crm')
    THEN btrim(canal)
  -- Leads do Agendor: a ingestão grava canal='agendor' e joga a origem real
  -- ("Origem no Agendor: Google") só dentro da observação. Enquanto ela não
  -- gravar isso em coluna própria, é daqui que o canal sai.
  WHEN observacao LIKE '%Origem no Agendor: %'
    THEN btrim(substring(observacao from 'Origem no Agendor: ([^·]+)'))
  WHEN NULLIF(btrim(utm_source), '') IS NOT NULL THEN btrim(utm_source)
  ELSE NULL
END`;

/**
 * Funde variações do mesmo canal ('Google' e 'Google ', 'Facebook' e
 * 'facebook') mantendo o rótulo da variante que mais faturou — sem isso o mesmo
 * canal aparece duas vezes no gráfico e nenhuma fatia bate com a realidade.
 */
function normalizar(rows: LinhaBruta[], semRotulo: string): FaturamentoPorOrigem[] {
  const porChave = new Map<string, FaturamentoPorOrigem>();
  for (const r of rows) {
    const cru = r.label?.trim();
    const label = cru ? (ROTULO[cru.toLowerCase()] ?? cru) : semRotulo;
    const chave = label.toLowerCase();
    const receita = Number(r.receita) || 0;
    const vendas = Number(r.vendas) || 0;
    const atual = porChave.get(chave);
    if (atual) {
      // Rótulo de quem mais faturou vence, para não trocar 'Google' por 'Google '.
      if (receita > atual.receita) atual.label = label;
      atual.receita += receita;
      atual.vendas += vendas;
    } else {
      porChave.set(chave, { label, receita, vendas, ticket: null });
    }
  }
  return [...porChave.values()]
    .map((o) => ({ ...o, ticket: o.vendas > 0 ? o.receita / o.vendas : null }))
    .sort((a, b) => b.receita - a.receita);
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
        `SELECT ${CANAL_SQL} AS label,
                COALESCE(SUM(${VALOR}), 0)::float AS receita,
                COUNT(*) FILTER (WHERE ${VALOR} > 0 OR fechou = TRUE)::int AS vendas
           ${BASE}
          GROUP BY 1
         HAVING COALESCE(SUM(${VALOR}), 0) > 0
          ORDER BY receita DESC
          LIMIT 12`,
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
                COALESCE(SUM(${VALOR}) FILTER (WHERE ${CANAL_SQL} IS NULL), 0)::float AS sem_atribuicao
           ${BASE}`,
        params,
      ),
    ]);

    return Response.json({
      ok: true,
      // "Sem origem" entra na lista de propósito: esconder faz a soma das
      // barras não fechar com o total e parecer que falta dinheiro.
      origens: normalizar(origens.rows, 'Canal não informado'),
      campanhas: normalizar(campanhas.rows, 'Sem campanha'),
      total: Number(totalRows.rows[0]?.total ?? 0),
      /**
       * ⚠️ Receita cujo CANAL não dá para saber — nem click id, nem `canal`
       * preenchido, nem origem no Agendor, nem utm. É a fatia que o gestor
       * precisa enxergar como lacuna de cadastro, não como "orgânico".
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
