import type { NextRequest } from 'next/server';
import { statusFechouSql } from '@/lib/importacao-origem';
import { leadContaSql, rastroPagoSql } from '@/lib/lead-contagem';
import { makeServerPool } from '@/lib/server-db';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';
import {
  construirMapaEtapas, etapaDoLead,
  type EtapaDeStage, type EtapaFunil, type LeadParaFunil, type MapaEtapas,
} from '@/lib/funil-etapas';

/**
 * Funil do CRIATIVO — o que acontece com os leads de cada anúncio até o
 * faturamento (Leads → Engajados → Agendamentos → Comparecimentos → Vendas → R$).
 *
 * ⚠️ A etapa de cada lead sai de `etapaDoLead`, a MESMA régua do Funil de
 * Performance e do modal de leads por etapa. Uma classificação própria aqui
 * faria a soma dos criativos não bater com o funil da mesma tela.
 *
 * Duas réguas de data, como em `/api/crm/vendas-por-anuncio` (e pelo mesmo
 * motivo): o FUNIL conta os leads criados no período; VENDAS e FATURAMENTO
 * contam pelo mês do ganho, para somar igual ao card de Faturamento. Venda é
 * PESSOA (`COALESCE(origem_lead_id, id)`), não linha do ledger.
 */

export const dynamic = 'force-dynamic';

export type FunilDoCriativo = {
  chave: string;
  /** id do anúncio no Meta (busca o preview); null quando o rastreio só trouxe o nome. */
  adId: string | null;
  nome: string;
  campanha: string | null;
  plataforma: 'meta' | 'google' | 'outro';
  leads: number;
  engajados: number;
  agendamentos: number;
  comparecimentos: number;
  vendas: number;
  receita: number;
};

const t = (v: unknown) => String(v ?? '').trim();
const PLATAFORMA_SQL = `CASE
  WHEN NULLIF(l.gclid, '') IS NOT NULL OR NULLIF(l.wbraid, '') IS NOT NULL OR NULLIF(l.gbraid, '') IS NOT NULL
       OR lower(COALESCE(l.origin, '')) = 'google' THEN 'google'
  WHEN NULLIF(l.source_id, '') IS NOT NULL OR NULLIF(l.ctwa_clid, '') IS NOT NULL OR NULLIF(l.fbclid, '') IS NOT NULL
       OR lower(COALESCE(l.origin, '')) IN ('meta', 'facebook', 'instagram') THEN 'meta'
  ELSE 'outro' END`;
const ANUNCIO_SQL = `COALESCE(NULLIF(btrim(l.ad_name), ''), NULLIF(btrim(l.creative_name), ''))`;
const TEM_ANUNCIO = `(NULLIF(btrim(l.source_id), '') IS NOT NULL OR ${ANUNCIO_SQL} IS NOT NULL)`;
const CHAVE_SQL = `COALESCE(NULLIF(btrim(l.source_id), ''), 'nm:' || lower(${ANUNCIO_SQL}))`;

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const range = parseIsoDateRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));
  if (clientIds.length === 0 || !range) return Response.json({ ok: false, criativos: [] });

  const pool = makeServerPool();
  try {
    const params = [clientIds, range.from, range.to];
    const VALOR = `COALESCE(NULLIF(l.revenue, 0), l.valor_rs, 0)`;
    const [leadsRes, vendasRes, stagesRes] = await Promise.all([
      pool.query(
        `SELECT l.client_id, ${CHAVE_SQL} AS chave, NULLIF(btrim(l.source_id), '') AS source_id,
                ${ANUNCIO_SQL} AS anuncio, NULLIF(btrim(l.campaign_name), '') AS campanha,
                ${PLATAFORMA_SQL} AS plataforma,
                l.status, l.funnel_id, l.agendou, l.data_agendada, l.compareceu, l.engajou,
                (l.fechou OR ${VALOR} > 0 OR ${statusFechouSql('l')}) AS fechou, ${VALOR} AS valor,
                ${rastroPagoSql('l')} AS rastreado,
                COALESCE(l.lead_date, l.data, l.created_at::date) AS data_lead
           FROM public.crm_leads l
          WHERE l.client_id = ANY($1) AND ${leadContaSql('l')} AND ${TEM_ANUNCIO}
            AND COALESCE(l.registro_tipo, 'hibrido') <> 'venda'
            AND (COALESCE(l.lead_date, l.data) IS NULL OR COALESCE(l.lead_date, l.data) BETWEEN $2 AND $3)`,
        params,
      ),
      pool.query(
        `SELECT ${CHAVE_SQL} AS chave, NULLIF(btrim(l.source_id), '') AS source_id,
                ${ANUNCIO_SQL} AS anuncio, NULLIF(btrim(l.campaign_name), '') AS campanha,
                ${PLATAFORMA_SQL} AS plataforma,
                COUNT(DISTINCT COALESCE(l.origem_lead_id::text, l.id::text))::int AS vendas,
                COALESCE(SUM(${VALOR}), 0)::float AS receita
           FROM public.crm_leads l
          WHERE l.client_id = ANY($1) AND ${leadContaSql('l')} AND ${TEM_ANUNCIO}
            AND (${VALOR} > 0 OR l.fechou = TRUE OR ${statusFechouSql('l')})
            AND (COALESCE(l.fechado_em, l.lead_date, l.data) IS NULL
                 OR COALESCE(l.fechado_em, l.lead_date, l.data) BETWEEN $2 AND $3)
          GROUP BY 1, 2, 3, 4, 5`,
        params,
      ),
      pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil, situacao FROM public.crm_stages WHERE client_id = ANY($1)`,
        [clientIds],
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
    ]);

    // Mapa de etapas POR CLIENTE — o mesmo status significa coisas diferentes em funis diferentes.
    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    for (const s of stagesRes.rows) {
      const cid = t(s.client_id);
      const lista = stagesPorCliente.get(cid) ?? [];
      lista.push({
        funnelId: t(s.funnel_id), label: t(s.label),
        etapa: (s.etapa_funil ?? null) as EtapaFunil | null,
        situacao: (s.situacao ?? null) as EtapaDeStage['situacao'],
      });
      stagesPorCliente.set(cid, lista);
    }
    const mapas = new Map<string, MapaEtapas>();
    const mapaDe = (cid: string) => {
      let m = mapas.get(cid);
      if (!m) { m = construirMapaEtapas(stagesPorCliente.get(cid) ?? []); mapas.set(cid, m); }
      return m;
    };

    const porChave = new Map<string, FunilDoCriativo>();
    const garantir = (r: Record<string, unknown>): FunilDoCriativo => {
      const chave = t(r.chave);
      let c = porChave.get(chave);
      if (!c) {
        const sid = t(r.source_id);
        c = {
          chave, adId: /^\d{6,}$/.test(sid) ? sid : null,
          nome: t(r.anuncio) || 'Anúncio sem nome',
          campanha: t(r.campanha) || null,
          plataforma: (t(r.plataforma) || 'outro') as FunilDoCriativo['plataforma'],
          leads: 0, engajados: 0, agendamentos: 0, comparecimentos: 0, vendas: 0, receita: 0,
        };
        porChave.set(chave, c);
      }
      // Nome/campanha que faltaram na 1ª linha chegam nas seguintes.
      if (c.nome === 'Anúncio sem nome' && t(r.anuncio)) c.nome = t(r.anuncio);
      if (!c.campanha && t(r.campanha)) c.campanha = t(r.campanha);
      if (c.plataforma === 'outro' && t(r.plataforma) !== 'outro') c.plataforma = t(r.plataforma) as FunilDoCriativo['plataforma'];
      return c;
    };

    for (const r of leadsRes.rows) {
      const lead: LeadParaFunil = {
        status: r.status ?? null,
        funnelId: r.funnel_id ? String(r.funnel_id) : null,
        agendou: r.agendou === true,
        dataAgendada: r.data_agendada ? String(r.data_agendada) : null,
        dataLead: r.data_lead ? String(r.data_lead) : null,
        compareceu: r.compareceu === true,
        engajou: r.engajou === true,
        fechou: r.fechou === true,
        receita: Number(r.valor) || 0,
        rastreado: r.rastreado === true,
      };
      const posto = etapaDoLead(lead, mapaDe(t(r.client_id)));
      if (posto.naoLead) continue;
      const c = garantir(r);
      c.leads += 1;
      if (posto.posto >= 1) c.engajados += 1;
      if (posto.posto >= 2) c.agendamentos += 1;
      if (posto.posto >= 3) c.comparecimentos += 1;
    }
    for (const r of vendasRes.rows) {
      const c = garantir(r);
      c.vendas += Number(r.vendas) || 0;
      c.receita += Number(r.receita) || 0;
    }

    return Response.json({ ok: true, criativos: [...porChave.values()] });
  } catch (err) {
    console.error('[funil-criativos]', err);
    return Response.json({ ok: false, criativos: [] });
  } finally {
    await pool.end();
  }
}
