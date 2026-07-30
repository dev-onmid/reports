import type { Pool } from 'pg';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';

// Biblioteca de Criativos — agrega os leads do CRM por anúncio/criativo.
// Fonte: crm_leads com atribuição (source_id = ID do anúncio na Meta, vindo do
// CTWA; ad_name/creative_name resolvidos via Marketing API). Vendas/receita
// vêm de fechou/valor_rs; etapas do funil de status. Gasto/CPL/thumbnail são
// enriquecidos à parte (rota enrich, best-effort via Graph API).

export type CreativeStat = {
  client_id: string;
  client_name: string | null;
  segment: string | null;
  ad_key: string;
  source_id: string | null;
  ad_name: string | null;
  creative_name: string | null;
  campaign_name: string | null;
  adset_name: string | null;
  source_url: string | null;
  leads: number;
  /** Leads que RESPONDERAM no WhatsApp depois do primeiro atendimento (conversa real) */
  conversas: number;
  /** Leads marcados como compareceu — resultado à prova de funil (boolean, não rótulo de etapa) */
  comparecimentos: number;
  vendas: number;
  receita: number;
  ig_leads: number;
  fb_leads: number;
  por_status: Record<string, number>;
  first_lead_at: string | null;
  last_lead_at: string | null;
};

/**
 * Janela da agregação: ou `days` (janela corrida terminando agora — formato legado,
 * usado pelo cache do enrich) ou `from`/`to` explícitos em ISO `YYYY-MM-DD`, que é o
 * único jeito de expressar mês-calendário ("mês passado"). `from`/`to` vence quando
 * os dois vêm preenchidos.
 */
export type CreativeWindow = { days: number; from?: string | null; to?: string | null };

/**
 * Monta a cláusula de janela + o array de params compartilhado pelas duas queries.
 * Exportada para poder ser testada sem banco.
 */
export function buildCreativeWindow(
  opts: CreativeWindow & { clientId?: string | null },
): { windowFilter: string; clientFilter: string; params: unknown[] } {
  const { days, clientId } = opts;
  const range = parseIsoDateRange(opts.from, opts.to);

  const params: unknown[] = [];
  let windowFilter: string;
  if (range) {
    // `to` é inclusivo: o dia inteiro entra (< to + 1 dia).
    // ⚠️ As bordas são ancoradas em BRT de propósito: created_at é timestamptz e a
    // sessão do Postgres roda em UTC, então um `::date` cru cortaria o dia às 21h BRT
    // e empurraria os leads do fim da noite para o dia (e o mês) seguinte.
    params.push(range.from, range.to);
    windowFilter =
      `l.created_at >= ($1::timestamp AT TIME ZONE 'America/Sao_Paulo')` +
      ` AND l.created_at < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`;
  } else {
    params.push(days);
    windowFilter = `l.created_at >= NOW() - ($1 || ' days')::interval`;
  }

  let clientFilter = '';
  if (clientId) {
    params.push(clientId);
    clientFilter = `AND l.client_id = $${params.length}`;
  }

  return { windowFilter, clientFilter, params };
}

export async function aggregateCreatives(
  pool: Pool,
  opts: CreativeWindow & { clientId?: string | null },
): Promise<CreativeStat[]> {
  const { windowFilter, clientFilter, params } = buildCreativeWindow(opts);

  // Chave do criativo: ID do anúncio quando existe (agrupamento exato), senão o
  // nome do anúncio (leads antigos/manuais sem source_id).
  const keyExpr = `COALESCE(NULLIF(l.source_id, ''), 'nm:' || LOWER(COALESCE(NULLIF(l.ad_name, ''), NULLIF(l.creative_name, ''))))`;

  // `conversas` = métrica de FUNIL: o lead respondeu no WhatsApp DEPOIS do
  // primeiro atendimento (mensagem 'in' após a primeira 'out') — conversa real,
  // não só o clique inicial do anúncio. É o primeiro degrau do feedback da ponta.
  const { rows } = await pool.query(
    `WITH leads_base AS (
        SELECT l.*, ${keyExpr} AS ad_key
          FROM public.crm_leads l
         WHERE (NULLIF(l.source_id, '') IS NOT NULL OR NULLIF(l.ad_name, '') IS NOT NULL OR NULLIF(l.creative_name, '') IS NOT NULL)
           AND ${windowFilter}
           ${clientFilter}
      ),
      resp AS (
        SELECT lb.id AS lead_id,
               EXISTS (
                 SELECT 1 FROM public.crm_messages mi
                  WHERE mi.lead_id = lb.id AND mi.direction = 'in'
                    AND mi.created_at > (
                      SELECT MIN(mo.created_at) FROM public.crm_messages mo
                       WHERE mo.lead_id = lb.id AND mo.direction = 'out')
               ) AS respondeu
          FROM leads_base lb
      )
      SELECT
        l.client_id,
        MAX(c.name)     AS client_name,
        MAX(c.segment)  AS segment,
        l.ad_key,
        MAX(NULLIF(l.source_id, ''))      AS source_id,
        MAX(NULLIF(l.ad_name, ''))        AS ad_name,
        MAX(NULLIF(l.creative_name, ''))  AS creative_name,
        MAX(NULLIF(l.campaign_name, ''))  AS campaign_name,
        MAX(NULLIF(l.adset_name, ''))     AS adset_name,
        MAX(NULLIF(l.source_url, ''))     AS source_url,
        COUNT(*)::int                                     AS leads,
        COUNT(*) FILTER (WHERE r.respondeu)::int          AS conversas,
        COUNT(*) FILTER (WHERE l.compareceu = TRUE)::int  AS comparecimentos,
        COUNT(*) FILTER (WHERE l.fechou = TRUE)::int      AS vendas,
        COALESCE(SUM(l.valor_rs) FILTER (WHERE l.fechou = TRUE), 0)::float AS receita,
        COUNT(*) FILTER (WHERE l.origin = 'instagram')::int AS ig_leads,
        COUNT(*) FILTER (WHERE l.origin = 'meta')::int      AS fb_leads,
        MIN(l.created_at) AS first_lead_at,
        MAX(l.created_at) AS last_lead_at
      FROM leads_base l
      LEFT JOIN resp r ON r.lead_id = l.id
      LEFT JOIN public.clients c ON c.id = l.client_id
     GROUP BY l.client_id, l.ad_key
     -- ⚠️ O corte é por LEADS. Quem ranqueia por outro eixo (venda, receita, etapa)
     -- ordena no cliente, sobre estes 500 — então, na visão global da carteira, um
     -- criativo com poucos leads mas muitas vendas/agendamentos pode ficar de fora.
     ORDER BY COUNT(*) DESC
     LIMIT 500`,
    params,
  );

  // Breakdown por etapa do funil (status), na mesma janela
  const { rows: statusRows } = await pool.query(
    `SELECT l.client_id, ${keyExpr} AS ad_key, COALESCE(NULLIF(l.status, ''), 'Sem etapa') AS status, COUNT(*)::int AS total
       FROM public.crm_leads l
      WHERE (NULLIF(l.source_id, '') IS NOT NULL OR NULLIF(l.ad_name, '') IS NOT NULL OR NULLIF(l.creative_name, '') IS NOT NULL)
        AND ${windowFilter}
        ${clientFilter}
      GROUP BY l.client_id, ${keyExpr}, COALESCE(NULLIF(l.status, ''), 'Sem etapa')`,
    params,
  );
  const statusMap = new Map<string, Record<string, number>>();
  for (const s of statusRows) {
    const k = `${s.client_id}|${s.ad_key}`;
    const entry = statusMap.get(k) ?? {};
    entry[String(s.status)] = Number(s.total);
    statusMap.set(k, entry);
  }

  return rows.map(r => ({
    client_id: String(r.client_id),
    client_name: r.client_name ?? null,
    segment: r.segment ?? null,
    ad_key: String(r.ad_key),
    source_id: r.source_id ?? null,
    ad_name: r.ad_name ?? null,
    creative_name: r.creative_name ?? null,
    campaign_name: r.campaign_name ?? null,
    adset_name: r.adset_name ?? null,
    source_url: r.source_url ?? null,
    leads: Number(r.leads),
    conversas: Number(r.conversas ?? 0),
    comparecimentos: Number(r.comparecimentos ?? 0),
    vendas: Number(r.vendas),
    receita: Number(r.receita),
    ig_leads: Number(r.ig_leads),
    fb_leads: Number(r.fb_leads),
    por_status: statusMap.get(`${r.client_id}|${r.ad_key}`) ?? {},
    first_lead_at: r.first_lead_at ? new Date(r.first_lead_at).toISOString() : null,
    last_lead_at: r.last_lead_at ? new Date(r.last_lead_at).toISOString() : null,
  }));
}
