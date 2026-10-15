import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { contarFunil, type ContagemFunil, type EtapaDeStage, type LeadParaFunil } from '@/lib/funil-etapas';
import { leadContaSql, rastroPagoSql, ENSURE_COLUNAS_CONTAGEM } from '@/lib/lead-contagem';

/**
 * Funil de UM cliente no período (2026-10-10) — para a tela de resultados do
 * gestor do cliente. Mesma régua do `/api/crm/summary` (a LEI de
 * lead-contagem.ts + `contarFunil`), só que preso a um `clientId`: o summary
 * devolve a carteira inteira e por isso não pode ser aberto a usuário de
 * cliente.
 */
export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query(ENSURE_COLUNAS_CONTAGEM).catch(() => null);
    const params: string[] = [clientId];
    let janela = '';
    if (from && to && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(from, to);
      janela = `AND (COALESCE(data_fechamento, lead_date, data) IS NULL OR COALESCE(data_fechamento, lead_date, data) BETWEEN $2 AND $3)`;
    }
    const { rows } = await pool.query(
      `SELECT status, funnel_id, agendou, data_agendada, COALESCE(lead_date, data) AS data_lead,
              compareceu, engajou, COALESCE(registro_tipo, 'hibrido') AS registro_tipo,
              (fechou OR COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0) AS fechou,
              COALESCE(NULLIF(revenue, 0), valor_rs, 0) AS valor_rs,
              ${rastroPagoSql()} AS rastreado
         FROM public.crm_leads
        WHERE client_id = $1 AND ${leadContaSql()} ${janela}`,
      params,
    );
    const leads: LeadParaFunil[] = rows.map(r => ({
      status: r.status ?? null,
      funnelId: r.funnel_id ? String(r.funnel_id) : null,
      agendou: r.agendou === true,
      dataAgendada: r.data_agendada ? String(r.data_agendada) : null,
      dataLead: r.data_lead ? String(r.data_lead) : null,
      compareceu: r.compareceu === true,
      engajou: r.engajou === true,
      fechou: r.fechou === true,
      receita: Number(r.valor_rs) || 0,
      rastreado: r.rastreado === true,
      tipo: (r.registro_tipo as 'lead' | 'venda' | 'hibrido') ?? 'hibrido',
    }));
    const stages: EtapaDeStage[] = await pool.query(
      `SELECT s.funnel_id, s.label, s.etapa_funil, s.situacao
         FROM public.crm_stages s JOIN public.crm_funnels f ON f.id = s.funnel_id
        WHERE f.client_id = $1`,
      [clientId],
    ).then(r => r.rows.map(s => ({
      funnelId: String(s.funnel_id), label: String(s.label ?? ''),
      etapa: (s.etapa_funil ?? null) as EtapaDeStage['etapa'], situacao: (s.situacao ?? null) as EtapaDeStage['situacao'],
    }))).catch(() => []);
    const funil: ContagemFunil = contarFunil(leads, stages);
    return Response.json({ funil });
  } catch (err) {
    console.error('[crm funil]', err);
    return Response.json({ error: 'Não foi possível calcular o funil.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
