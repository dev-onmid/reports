import type { NextRequest } from 'next/server';
import { statusFechouSql } from '@/lib/importacao-origem';
import { parseRecorte, filtroRegiaoSql } from '@/lib/regiao-recorte';
import { leadContaSql } from '@/lib/lead-contagem';
import { makeServerPool } from '@/lib/server-db';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';

/**
 * Vendas e faturamento por ANÚNCIO — criativo, conjunto e campanha que
 * trouxeram o lead que comprou.
 *
 * ⚠️ Régua de data e expressão de valor são as MESMAS de
 * `/api/clients/[id]/metrics` (receita pelo mês do GANHO, sem data fica
 * dentro). Divergir faria o "atribuído" desta caixa passar do card de
 * Faturamento na mesma tela.
 *
 * ⚠️ VENDA É PESSOA, não linha: a mesma compra aparece como lead fechado E como
 * linha do ledger (que aponta `origem_lead_id` para ele), e entrada + parcela
 * são duas linhas. Contar linha dobraria as vendas do anúncio. A chave do
 * comprador é `COALESCE(origem_lead_id, id)`; a RECEITA soma todas as linhas
 * (o lead fechado da planilha de leads tem valor zerado, então não duplica).
 *
 * LEADS usam a régua de CRIAÇÃO — é o denominador da taxa de conversão do
 * anúncio, e um lead de junho que comprou em julho é lead de junho.
 */

export const dynamic = 'force-dynamic';

export type Plataforma = 'meta' | 'google' | 'outro';

export type VendaPorCriativo = {
  chave: string;
  /** id do anúncio no Meta — é o que dá para buscar o preview. */
  adId: string | null;
  nome: string;
  campanha: string | null;
  conjunto: string | null;
  plataforma: Plataforma;
  vendas: number;
  receita: number;
  leads: number;
};
export type VendaPorConjunto = {
  chave: string; nome: string; campanha: string | null; plataforma: Plataforma;
  vendas: number; receita: number; leads: number;
};
export type VendaPorCampanha = {
  chave: string; nome: string; plataforma: Plataforma;
  vendas: number; receita: number; leads: number;
};
export type VendasPorAnuncio = {
  ok: boolean;
  /** Faturamento do período inteiro (mesmo número do card de Faturamento). */
  receitaTotal: number;
  /** Parte do faturamento cujo lead tem campanha/anúncio identificado. */
  receitaAtribuida: number;
  vendasAtribuidas: number;
  criativos: VendaPorCriativo[];
  conjuntos: VendaPorConjunto[];
  campanhas: VendaPorCampanha[];
};

const VAZIO: VendasPorAnuncio = {
  ok: false, receitaTotal: 0, receitaAtribuida: 0, vendasAtribuidas: 0,
  criativos: [], conjuntos: [], campanhas: [],
};

const t = (v: string | null | undefined) => (v ?? '').trim();
const k = (v: string | null | undefined) => t(v).toLowerCase();

/** Google pelo click id; Meta pelo id do anúncio/CTWA/fbclid. */
const PLATAFORMA_SQL = `CASE
  WHEN NULLIF(gclid, '') IS NOT NULL OR NULLIF(wbraid, '') IS NOT NULL OR NULLIF(gbraid, '') IS NOT NULL
       OR lower(COALESCE(origin, '')) = 'google' THEN 'google'
  WHEN NULLIF(source_id, '') IS NOT NULL OR NULLIF(ctwa_clid, '') IS NOT NULL OR NULLIF(fbclid, '') IS NOT NULL
       OR lower(COALESCE(origin, '')) IN ('meta', 'facebook', 'instagram') THEN 'meta'
  ELSE 'outro' END`;

const CAMPANHA_SQL = `COALESCE(NULLIF(btrim(campaign_name), ''), NULLIF(btrim(utm_campaign), ''))`;
const ANUNCIO_SQL = `COALESCE(NULLIF(btrim(ad_name), ''), NULLIF(btrim(creative_name), ''))`;
const TEM_ATRIBUICAO = `(${CAMPANHA_SQL} IS NOT NULL OR ${ANUNCIO_SQL} IS NOT NULL OR NULLIF(source_id, '') IS NOT NULL)`;

type Linha = {
  comprador: string | null;
  source_id: string | null;
  anuncio: string | null;
  conjunto: string | null;
  campanha: string | null;
  plataforma: Plataforma;
  receita: number;
  leads: number;
};

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const range = parseIsoDateRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));
  if (clientIds.length === 0 || !range) return Response.json(VAZIO);

  const pool = makeServerPool();
  try {
    const VALOR = `COALESCE(NULLIF(revenue, 0), valor_rs, 0)`;
    const VENDEU = `(${VALOR} > 0 OR fechou = TRUE OR ${statusFechouSql()})`;
    const JANELA_GANHO = `(COALESCE(fechado_em, lead_date, data) IS NULL
                           OR COALESCE(fechado_em, lead_date, data) BETWEEN $2 AND $3)`;
    const JANELA_LEAD = `(COALESCE(lead_date, data) IS NULL
                          OR COALESCE(lead_date, data) BETWEEN $2 AND $3)`;
    const regiao = filtroRegiaoSql(parseRecorte(req.nextUrl.searchParams.get('regiao')), 4);
    const params = [clientIds, range.from, range.to, ...regiao.params];
    const BASE = `FROM public.crm_leads WHERE client_id = ANY($1) AND ${leadContaSql()}${regiao.sql}`;
    const DIMS = `NULLIF(btrim(source_id), '') AS source_id, ${ANUNCIO_SQL} AS anuncio,
                  NULLIF(btrim(adset_name), '') AS conjunto, ${CAMPANHA_SQL} AS campanha,
                  ${PLATAFORMA_SQL} AS plataforma`;

    const [vendas, leads, total] = await Promise.all([
      // Uma linha por (comprador × anúncio): a contagem de vendas distintas por
      // nível é feita aqui embaixo com Sets.
      pool.query<Linha>(
        `SELECT COALESCE(origem_lead_id::text, id::text) AS comprador, ${DIMS},
                COALESCE(SUM(${VALOR}), 0)::float AS receita, 0 AS leads
           ${BASE} AND ${JANELA_GANHO} AND ${VENDEU} AND ${TEM_ATRIBUICAO}
          GROUP BY 1, 2, 3, 4, 5, 6`,
        params,
      ),
      pool.query<Linha>(
        `SELECT NULL AS comprador, ${DIMS}, 0 AS receita, COUNT(*)::int AS leads
           ${BASE} AND ${JANELA_LEAD} AND ${TEM_ATRIBUICAO}
            AND COALESCE(registro_tipo, 'hibrido') <> 'venda'
          GROUP BY 2, 3, 4, 5, 6`,
        params,
      ),
      pool.query<{ receita: number }>(
        `SELECT COALESCE(SUM(${VALOR}), 0)::float AS receita ${BASE} AND ${JANELA_GANHO}`,
        params,
      ),
    ]);

    type Acc = { base: Omit<VendaPorCriativo, 'vendas' | 'receita' | 'leads'>; compradores: Set<string>; receita: number; leads: number };
    const cri = new Map<string, Acc>();
    const con = new Map<string, Acc>();
    const cam = new Map<string, Acc>();
    const compradoresAtrib = new Set<string>();
    let receitaAtribuida = 0;

    const somar = (mapa: Map<string, Acc>, chave: string, base: Acc['base'], l: Linha) => {
      let a = mapa.get(chave);
      if (!a) { a = { base, compradores: new Set(), receita: 0, leads: 0 }; mapa.set(chave, a); }
      // Plataforma: Google vence "outro", Meta vence "outro" — o nome sozinho não diz.
      if (a.base.plataforma === 'outro' && l.plataforma !== 'outro') a.base.plataforma = l.plataforma;
      if (l.comprador) a.compradores.add(l.comprador);
      a.receita += Number(l.receita) || 0;
      a.leads += Number(l.leads) || 0;
    };

    for (const l of [...vendas.rows, ...leads.rows]) {
      if (l.comprador) {
        compradoresAtrib.add(l.comprador);
        receitaAtribuida += Number(l.receita) || 0;
      }
      const campanha = t(l.campanha) || null;
      const conjunto = t(l.conjunto) || null;
      if (l.source_id || l.anuncio) {
        const chave = l.source_id ?? `nm:${k(l.anuncio)}`;
        somar(cri, chave, {
          chave, adId: l.source_id && /^\d{6,}$/.test(l.source_id) ? l.source_id : null,
          nome: t(l.anuncio) || 'Anúncio sem nome', campanha, conjunto, plataforma: l.plataforma,
        }, l);
      }
      if (conjunto) {
        const chave = `${k(campanha)}|${k(conjunto)}`;
        somar(con, chave, { chave, adId: null, nome: conjunto, campanha, conjunto, plataforma: l.plataforma }, l);
      }
      if (campanha) {
        const chave = k(campanha);
        somar(cam, chave, { chave, adId: null, nome: campanha, campanha, conjunto: null, plataforma: l.plataforma }, l);
      }
    }

    // Só entra no ranking quem VENDEU; ordenado por faturamento (desempate: vendas).
    const ranking = (m: Map<string, Acc>, n: number) => [...m.values()]
      .filter((a) => a.receita > 0 || a.compradores.size > 0)
      .map((a) => ({ ...a.base, vendas: a.compradores.size, receita: a.receita, leads: a.leads }))
      .sort((a, b) => b.receita - a.receita || b.vendas - a.vendas)
      .slice(0, n);

    const body: VendasPorAnuncio = {
      ok: true,
      receitaTotal: Number(total.rows[0]?.receita ?? 0),
      receitaAtribuida,
      vendasAtribuidas: compradoresAtrib.size,
      criativos: ranking(cri, 24),
      conjuntos: ranking(con, 30).map((r) => ({
        chave: r.chave, nome: r.nome, campanha: r.campanha, plataforma: r.plataforma,
        vendas: r.vendas, receita: r.receita, leads: r.leads,
      })),
      campanhas: ranking(cam, 30).map((r) => ({
        chave: r.chave, nome: r.nome, plataforma: r.plataforma,
        vendas: r.vendas, receita: r.receita, leads: r.leads,
      })),
    };
    return Response.json(body);
  } catch (err) {
    console.error('[vendas-por-anuncio]', err);
    return Response.json(VAZIO);
  } finally {
    await pool.end();
  }
}
