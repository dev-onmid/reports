import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolvePortalToken } from '@/lib/crm-portal';

// ── Portal do cliente: visão geral + leads (read-only) ───────────────────────
// Tudo filtrado pelo client_id resolvido do token. Sem escrita, sem observações
// internas, sem leads time_interno. Ver src/lib/crm-portal.ts.

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10) || 30, 1), 365);

  const pool = makeServerPool();
  try {
    const ctx = await resolvePortalToken(pool, token);
    if (!ctx) return Response.json({ error: 'Link inválido ou revogado' }, { status: 404 });

    const [stages, leads, kpis] = await Promise.all([
      // Etapas do funil principal (primeiro funil do cliente)
      pool.query<{ label: string; color: string; position: number }>(
        `SELECT s.label, s.color, s.position
           FROM public.crm_stages s
           JOIN public.crm_funnels f ON f.id = s.funnel_id
          WHERE f.client_id = $1
            AND f.id = (SELECT id FROM public.crm_funnels WHERE client_id = $1 ORDER BY created_at ASC LIMIT 1)
          ORDER BY s.position ASC, s.created_at ASC`,
        [ctx.clientId],
      ).catch(() => ({ rows: [] as Array<{ label: string; color: string; position: number }> })),
      // Leads do período (sem observação interna; telefone vai — o lead é do cliente)
      pool.query(
        `SELECT id, nome, numero, status, origin, canal,
                campaign_name, adset_name, ad_name,
                utm_campaign, keyword, placement,
                regiao_uf, regiao_cidade,
                fechou, valor_rs,
                whatsapp_last_message_at, whatsapp_last_direction,
                created_at
           FROM public.crm_leads
          WHERE client_id = $1
            AND created_at > NOW() - ($2 || ' days')::interval
            AND time_interno IS NOT TRUE
          ORDER BY COALESCE(whatsapp_last_message_at, updated_at, created_at) DESC
          LIMIT 300`,
        [ctx.clientId, String(days)],
      ),
      pool.query<{ total: number; fechados: number; valor: number; com_origem: number }>(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE fechou = TRUE)::int AS fechados,
                COALESCE(SUM(valor_rs) FILTER (WHERE fechou = TRUE), 0)::float AS valor,
                COUNT(*) FILTER (
                  WHERE NULLIF(campaign_name, '') IS NOT NULL
                     OR NULLIF(utm_source, '') IS NOT NULL
                     OR NULLIF(ctwa_clid, '') IS NOT NULL
                )::int AS com_origem
           FROM public.crm_leads
          WHERE client_id = $1
            AND created_at > NOW() - ($2 || ' days')::interval
            AND time_interno IS NOT TRUE`,
        [ctx.clientId, String(days)],
      ),
    ]);

    const k = kpis.rows[0] ?? { total: 0, fechados: 0, valor: 0, com_origem: 0 };

    // Contagem por etapa (status é texto — mesmo agrupamento do Kanban interno)
    const porEtapa = new Map<string, number>();
    for (const l of leads.rows as Array<{ status: string | null }>) {
      const s = l.status ?? 'Em Atendimento';
      porEtapa.set(s, (porEtapa.get(s) ?? 0) + 1);
    }

    return Response.json({
      clientName: ctx.clientName,
      days,
      kpis: {
        total: Number(k.total),
        fechados: Number(k.fechados),
        valor: Number(k.valor),
        comOrigem: Number(k.com_origem),
      },
      funil: stages.rows.map(s => ({
        label: s.label,
        color: s.color,
        count: porEtapa.get(s.label) ?? 0,
      })),
      leads: leads.rows,
    });
  } catch (err) {
    console.error('[portal GET]', err);
    return Response.json({ error: 'Erro ao carregar' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
