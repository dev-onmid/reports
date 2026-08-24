import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';
import { CANAL_SQL, ROTULO_CANAL } from '@/lib/canal-lead';

/**
 * Faturamento e LEADS por CANAL — de onde vem o dinheiro e de onde vem o lead.
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
 * ⚠️ São DUAS réguas de data, e é de propósito (mesma decisão da rota de
 * métricas, caso Incorpast): FATURAMENTO conta pelo mês do GANHO e LEAD conta
 * pelo mês em que foi CRIADO. Um negócio criado em junho e fechado em julho é
 * lead de junho e faturamento de julho. Usar uma régua só faria um dos dois
 * cards não bater com o total ao lado.
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

export type LeadsPorCanal = { label: string; leads: number };

/**
 * Funde variações do mesmo canal ('Google' e 'Google ', 'Facebook' e
 * 'facebook') mantendo o rótulo da variante que mais faturou — sem isso o mesmo
 * canal aparece duas vezes no gráfico e nenhuma fatia bate com a realidade.
 */
function normalizar(rows: LinhaBruta[], semRotulo: string): FaturamentoPorOrigem[] {
  const porChave = new Map<string, FaturamentoPorOrigem>();
  for (const r of rows) {
    const cru = r.label?.trim();
    const label = cru ? (ROTULO_CANAL[cru.toLowerCase()] ?? cru) : semRotulo;
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

/** Mesma fusão de variantes do `normalizar`, contando leads em vez de receita. */
function normalizarLeads(rows: Array<{ label: string | null; leads: number }>): LeadsPorCanal[] {
  const porChave = new Map<string, LeadsPorCanal>();
  for (const r of rows) {
    const cru = r.label?.trim();
    const label = cru ? (ROTULO_CANAL[cru.toLowerCase()] ?? cru) : 'Canal não informado';
    const chave = label.toLowerCase();
    const leads = Number(r.leads) || 0;
    const atual = porChave.get(chave);
    if (atual) {
      if (leads > atual.leads) atual.label = label;
      atual.leads += leads;
    } else {
      porChave.set(chave, { label, leads });
    }
  }
  return [...porChave.values()].filter((l) => l.leads > 0).sort((a, b) => b.leads - a.leads);
}

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const range = parseIsoDateRange(
    req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'),
  );
  if (clientIds.length === 0 || !range) {
    return Response.json({ ok: false, origens: [], campanhas: [], total: 0, semAtribuicao: 0, leads: [], leadsTotal: 0, leadsSemCanal: 0 });
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

    // ⚠️ Régua PRÓPRIA dos leads: data de criação, não a do ganho.
    const JANELA_LEAD = `(COALESCE(lead_date, data) IS NULL
                          OR COALESCE(lead_date, data) BETWEEN $2 AND $3)`;
    const BASE_LEAD = `FROM public.crm_leads
                       WHERE client_id = ANY($1) AND ${JANELA_LEAD}`;

    const [origens, campanhas, totalRows, leadsRows, leadsTotalRows] = await Promise.all([
      pool.query<LinhaBruta>(
        `SELECT ${CANAL_SQL} AS label,
                COALESCE(SUM(${VALOR}), 0)::float AS receita,
                COUNT(*) FILTER (WHERE ${VALOR} > 0 OR fechou = TRUE)::int AS vendas
           ${BASE}
          GROUP BY 1
         HAVING COALESCE(SUM(${VALOR}), 0) > 0
          ORDER BY receita DESC
          LIMIT 40`,
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
      pool.query<{ label: string | null; leads: number }>(
        `SELECT ${CANAL_SQL} AS label, COUNT(*)::int AS leads
           ${BASE_LEAD}
          GROUP BY 1
          ORDER BY leads DESC
          LIMIT 40`,
        params,
      ),
      pool.query<{ total: number; sem_canal: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE ${CANAL_SQL} IS NULL)::int AS sem_canal
           ${BASE_LEAD}`,
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
      // Leads pela régua de CRIAÇÃO — ver a nota das duas réguas no topo.
      leads: normalizarLeads(leadsRows.rows),
      leadsTotal: Number(leadsTotalRows.rows[0]?.total ?? 0),
      leadsSemCanal: Number(leadsTotalRows.rows[0]?.sem_canal ?? 0),
    });
  } catch (err) {
    // Degrada para vazio: o painel some, o resto do dashboard continua de pé.
    console.error('[faturamento-origem]', err);
    return Response.json({ ok: false, origens: [], campanhas: [], total: 0, semAtribuicao: 0, leads: [], leadsTotal: 0, leadsSemCanal: 0 });
  } finally {
    await pool.end();
  }
}
