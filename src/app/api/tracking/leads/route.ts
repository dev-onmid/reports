import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureLeadTrackingSchema } from '@/lib/lead-tracking';
import { parseIsoDateRange } from '@/lib/optimizer-period-range';

// ── Leads rastreados (visão rica) ─────────────────────────────────────────────
// Lê a atribuição REAL de crm_leads (origem, campanha/conjunto/anúncio, keyword,
// posicionamento, região, click ids) — substitui a leitura da tabela legada
// whatsapp_leads (que só tinha Source ID) nas telas de rastreamento.

export const dynamic = 'force-dynamic';

type CountRow = { label: string | null; count: number };

function normalizeCounts(rows: CountRow[], emptyLabel: string): { label: string; count: number }[] {
  return rows.map(r => ({ label: r.label?.trim() ? r.label : emptyLabel, count: Number(r.count) }));
}

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10) || 200, 1), 500);
  // `days` = janela corrida legada. `from`/`to` (ISO) expressam janela explícita e são
  // o único jeito de pedir mês-calendário; ganham do `days` quando ambos são válidos.
  const range = parseIsoDateRange(req.nextUrl.searchParams.get('from'), req.nextUrl.searchParams.get('to'));

  const pool = makeServerPool();
  try {
    await ensureLeadTrackingSchema(pool);

    // Uma cláusula de janela só, compartilhada pelas 7 queries abaixo via ${where}.
    const params: unknown[] = [];
    let windowClause: string;
    if (range) {
      // `to` inclusivo. Bordas ancoradas em BRT de propósito: created_at é timestamptz e
      // a sessão do Postgres roda em UTC — um `::date` cru cortaria o dia às 21h BRT.
      params.push(range.from, range.to);
      windowClause =
        `l.created_at >= ($1::timestamp AT TIME ZONE 'America/Sao_Paulo')` +
        ` AND l.created_at < (($2::timestamp + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`;
    } else {
      params.push(String(days));
      windowClause = `l.created_at > NOW() - ($1 || ' days')::interval`;
    }
    let clientClause = '';
    if (clientId) {
      params.push(clientId);
      clientClause = `AND l.client_id = $${params.length}`;
    }

    const where = `${windowClause}
                   AND l.time_interno IS NOT TRUE
                   ${clientClause}`;

    const [leads, porOrigem, porCampanha, porRegiao, porKeyword, porPlacement, totais] = await Promise.all([
      pool.query(
        `SELECT l.id, l.client_id, c.name AS client_name, l.nome, l.numero, l.email,
                l.origin, l.canal, l.status,
                l.campaign_name, l.adset_name, l.ad_name, l.creative_name,
                l.utm_source, l.utm_medium, l.utm_campaign, l.utm_content, l.utm_term,
                l.keyword, l.matchtype, l.device, l.network, l.placement,
                (l.ctwa_clid IS NOT NULL AND l.ctwa_clid <> '') AS has_ctwa,
                (l.gclid IS NOT NULL AND l.gclid <> '') OR (l.wbraid IS NOT NULL AND l.wbraid <> '') AS has_gclid,
                l.click_code, l.ddd, l.regiao_uf, l.regiao_cidade, l.regiao_fonte,
                l.first_origin_at, l.created_at
           FROM public.crm_leads l
           LEFT JOIN public.clients c ON c.id = l.client_id
          WHERE ${where}
          ORDER BY l.created_at DESC
          LIMIT ${limit}`,
        params,
      ),
      pool.query<CountRow>(
        `SELECT l.origin AS label, COUNT(*)::int AS count FROM public.crm_leads l
          WHERE ${where} GROUP BY l.origin ORDER BY count DESC LIMIT 8`,
        params,
      ),
      pool.query<CountRow>(
        `SELECT COALESCE(NULLIF(l.campaign_name, ''), NULLIF(l.utm_campaign, '')) AS label,
                COUNT(*)::int AS count
           FROM public.crm_leads l
          WHERE ${where}
            AND (NULLIF(l.campaign_name, '') IS NOT NULL OR NULLIF(l.utm_campaign, '') IS NOT NULL)
          GROUP BY 1 ORDER BY count DESC LIMIT 8`,
        params,
      ),
      pool.query<CountRow>(
        `SELECT l.regiao_uf AS label, COUNT(*)::int AS count FROM public.crm_leads l
          WHERE ${where} AND NULLIF(l.regiao_uf, '') IS NOT NULL
          GROUP BY l.regiao_uf ORDER BY count DESC LIMIT 10`,
        params,
      ),
      pool.query<CountRow>(
        `SELECT l.keyword AS label, COUNT(*)::int AS count FROM public.crm_leads l
          WHERE ${where} AND NULLIF(l.keyword, '') IS NOT NULL
          GROUP BY l.keyword ORDER BY count DESC LIMIT 8`,
        params,
      ),
      pool.query<CountRow>(
        `SELECT l.placement AS label, COUNT(*)::int AS count FROM public.crm_leads l
          WHERE ${where} AND NULLIF(l.placement, '') IS NOT NULL
          GROUP BY l.placement ORDER BY count DESC LIMIT 8`,
        params,
      ),
      pool.query<{ total: number; com_atribuicao: number; com_regiao: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (
                  WHERE NULLIF(l.ctwa_clid, '') IS NOT NULL
                     OR NULLIF(l.gclid, '') IS NOT NULL
                     OR NULLIF(l.utm_source, '') IS NOT NULL
                     OR NULLIF(l.campaign_name, '') IS NOT NULL
                     OR NULLIF(l.click_code, '') IS NOT NULL
                )::int AS com_atribuicao,
                COUNT(*) FILTER (WHERE NULLIF(l.regiao_uf, '') IS NOT NULL)::int AS com_regiao
           FROM public.crm_leads l
          WHERE ${where}`,
        params,
      ),
    ]);

    const t = totais.rows[0] ?? { total: 0, com_atribuicao: 0, com_regiao: 0 };
    return Response.json({
      leads: leads.rows,
      // Janela REALMENTE usada — a tela rotula o período com isso em vez de assumir
      // que o from/to enviado foi aceito.
      window: { days: range ? null : days, from: range?.from ?? null, to: range?.to ?? null },
      summary: {
        total: Number(t.total),
        comAtribuicao: Number(t.com_atribuicao),
        comRegiao: Number(t.com_regiao),
        porOrigem: normalizeCounts(porOrigem.rows, '(desconhecida)'),
        porCampanha: normalizeCounts(porCampanha.rows, '(sem campanha)'),
        porRegiao: normalizeCounts(porRegiao.rows, '(sem região)'),
        porKeyword: normalizeCounts(porKeyword.rows, '(sem keyword)'),
        porPlacement: normalizeCounts(porPlacement.rows, '(sem posicionamento)'),
      },
    });
  } catch (err) {
    console.error('[tracking/leads]', err);
    return Response.json({ error: 'Erro ao carregar leads rastreados' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
