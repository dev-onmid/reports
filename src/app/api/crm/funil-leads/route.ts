import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { canalSql, rotularCanal } from '@/lib/canal-lead';
import {
  construirMapaEtapas,
  etapaDoLead,
  leadNaEtapa,
  ROTULOS_ETAPA,
  diaISO,
  type EtapaDeStage,
  type EtapaFunil,
  type LeadParaFunil,
} from '@/lib/funil-etapas';

/**
 * Leads por etapa do Funil de Performance — o que abre ao clicar num degrau do card.
 *
 * ⚠️ Esta rota é a IRMÃ de /api/crm/summary e precisa continuar sendo: mesma
 * janela de datas (inclusive "lead sem data fica DENTRO"), mesmo SELECT de
 * sinais e mesma classificação (`etapaDoLead`). Se qualquer um dos três
 * divergir, o modal mostra um total diferente do número que foi clicado —
 * exatamente o tipo de inconsistência que a lib funil-etapas existe pra matar.
 *
 * ⚠️ Também de propósito: NÃO filtra `time_interno`. O summary não filtra, então
 * filtrar aqui faria a lista encolher em relação ao card.
 *
 * GET ?etapa=agendamento&clientIds=a,b&from=&to=&modo=alcancou|atual&limit=200
 */

const ETAPAS_VALIDAS: EtapaFunil[] = [
  'contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento', 'perdido',
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const etapa = sp.get('etapa') as EtapaFunil | null;
  const modo = sp.get('modo') === 'atual' ? 'atual' : 'alcancou';
  const from = sp.get('from');
  const to = sp.get('to');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);
  const clientIds = (sp.get('clientIds') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!etapa || !ETAPAS_VALIDAS.includes(etapa)) {
    return Response.json({ error: 'etapa inválida' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    // Garante as colunas de tipo/fechamento (idempotente). O summary também as
    // cria, mas esta rota pode ser chamada sem ele ter rodado antes.
    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS registro_tipo TEXT DEFAULT 'hibrido',
        ADD COLUMN IF NOT EXISTS data_fechamento DATE
    `).catch(() => {});

    const params: unknown[] = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      // Mesma regra do summary: venda janela por data de fechamento, lead/hibrido
      // por cadastro; lead sem data fica DENTRO.
      dateFilter = `AND (COALESCE(l.data_fechamento, l.lead_date, l.data) IS NULL OR (COALESCE(l.data_fechamento, l.lead_date, l.data) >= $1 AND COALESCE(l.data_fechamento, l.lead_date, l.data) <= $2))`;
    }
    let clientFilter = '';
    if (clientIds.length) {
      params.push(clientIds);
      clientFilter = `AND l.client_id = ANY($${params.length})`;
    }

    const { rows } = await pool.query(
      `SELECT l.id,
              l.client_id,
              c.name AS client_name,
              l.nome,
              l.numero,
              l.status,
              l.funnel_id,
              l.agendou,
              l.data_agendada,
              l.compareceu,
              (l.fechou OR COALESCE(NULLIF(l.revenue, 0), l.valor_rs, 0) > 0) AS fechou,
              COALESCE(NULLIF(l.revenue, 0), l.valor_rs, 0) AS valor_rs,
              COALESCE(l.lead_date, l.data, l.created_at::date) AS data_lead,
              -- Canal derivado pela MESMA expressão do donut de canais: dois
              -- SQLs parecidos divergiriam, e o gestor veria um canal no
              -- gráfico e outro na lista do mesmo lead.
              ${canalSql('l')} AS canal
         FROM public.crm_leads l
         LEFT JOIN public.clients c ON c.id = l.client_id
        -- Registro de VENDA é ledger de faturamento, não lead: fica fora da
        -- listagem por etapa (senão apareceria como "contato" fantasma e o modal
        -- divergiria do card, que também o exclui).
        WHERE COALESCE(l.registro_tipo, 'hibrido') <> 'venda' ${dateFilter} ${clientFilter}
        ORDER BY COALESCE(l.lead_date, l.data, l.created_at::date) DESC NULLS LAST`,
      params,
    );

    // Mapa de etapas POR CLIENTE — o mesmo status pode significar coisas
    // diferentes em funis diferentes, então não dá pra ter um mapa global.
    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    try {
      const { rows: stageRows } = await pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil FROM public.crm_stages`,
      );
      for (const s of stageRows) {
        const cid = String(s.client_id);
        if (!stagesPorCliente.has(cid)) stagesPorCliente.set(cid, []);
        stagesPorCliente.get(cid)!.push({
          funnelId: String(s.funnel_id),
          label: String(s.label ?? ''),
          etapa: (s.etapa_funil ?? null) as EtapaFunil | null,
        });
      }
    } catch {
      // sem crm_stages → auto-classificação pelo texto do status (igual ao summary)
    }

    const mapaPorCliente = new Map<string, ReturnType<typeof construirMapaEtapas>>();
    const mapaDe = (clientId: string) => {
      let m = mapaPorCliente.get(clientId);
      if (!m) {
        m = construirMapaEtapas(stagesPorCliente.get(clientId) ?? []);
        mapaPorCliente.set(clientId, m);
      }
      return m;
    };

    const selecionados: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const clientId = String(row.client_id);
      const lead: LeadParaFunil = {
        status: row.status ?? null,
        funnelId: row.funnel_id ? String(row.funnel_id) : null,
        agendou: row.agendou === true,
        dataAgendada: row.data_agendada ? String(row.data_agendada) : null,
        // Mesma régua do card: sem a data do lead, a listagem descartaria menos
        // agendamentos impossíveis que a contagem e os dois divergiriam.
        dataLead: row.data_lead ? String(row.data_lead) : null,
        compareceu: row.compareceu === true,
        fechou: row.fechou === true,
        receita: Number(row.valor_rs) || 0,
      };
      const posto = etapaDoLead(lead, mapaDe(clientId));
      if (!leadNaEtapa(posto, etapa, modo)) continue;

      selecionados.push({
        id: String(row.id),
        clientId,
        clientName: row.client_name ?? null,
        nome: row.nome ?? null,
        numero: row.numero ?? null,
        status: row.status ?? null,
        /** Etapa semântica que o lead ALCANÇOU (pode ser mais avançada que a clicada). */
        etapaAtual: etapaRotuloDoPosto(posto.posto),
        perdido: posto.perdido,
        valor: Number(row.valor_rs) || 0,
        data: row.data_lead ? String(row.data_lead).split('T')[0] : null,
        /** Canal de origem — `null` quando o CRM não registrou de onde veio. */
        canal: rotularCanal(row.canal as string | null),
        /** Data da consulta marcada, para a lista mostrar quem ainda vai vir. */
        dataAgendada: diaISO(row.data_agendada ? String(row.data_agendada) : null),
      });
    }

    return Response.json({
      etapa,
      modo,
      /** Total que casou o filtro — o modal usa pra dizer "mostrando N de M". */
      total: selecionados.length,
      leads: selecionados.slice(0, limit),
    });
  } catch (err) {
    console.error('[crm funil-leads]', err);
    return Response.json({ etapa, modo, total: 0, leads: [], error: String(err) }, { status: 200 });
  } finally {
    await pool.end();
  }
}

function etapaRotuloDoPosto(posto: number): string {
  const escada: EtapaFunil[] = ['contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento'];
  return ROTULOS_ETAPA[escada[Math.max(0, Math.min(posto, 4))]];
}
