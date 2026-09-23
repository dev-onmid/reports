import type { NextRequest } from 'next/server';
import { parseRecorte, filtroRegiaoSql } from '@/lib/regiao-recorte';
import { makeServerPool } from '@/lib/server-db';
import { canalSql, rotularCanal } from '@/lib/canal-lead';
import {
  construirMapaEtapas,
  construirLadder,
  indiceStageDoLead,
  etapaDoLead,
  leadNaEtapa,
  ROTULOS_ETAPA,
  diaISO,
  type EtapaDeStage,
  type EtapaFunil,
  type LadderKanban,
  type LeadParaFunil,
  type StageKanban,
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

  // Modo ETAPA REAL do Kanban: a dashboard manda `stageIndex` quando o funil está
  // personalizado pelo CRM (um cliente só). Recomputa a MESMA escada do summary
  // para o total bater com o degrau clicado.
  const stageIndexRaw = sp.get('stageIndex');
  const stageMode = stageIndexRaw !== null;
  const stageIndex = stageMode ? parseInt(stageIndexRaw, 10) : -1;

  if (stageMode) {
    if (!Number.isInteger(stageIndex) || stageIndex < 0 || clientIds.length !== 1) {
      return Response.json({ error: 'stageIndex exige exatamente um cliente' }, { status: 400 });
    }
  } else if (!etapa || !ETAPAS_VALIDAS.includes(etapa)) {
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
    // Recorte por região: o modal precisa listar EXATAMENTE o que o degrau
    // clicado contou — mesmo filtro do summary.
    const regiao = filtroRegiaoSql(parseRecorte(req.nextUrl.searchParams.get('regiao')), params.length + 1, 'l');
    params.push(...regiao.params);

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
        WHERE COALESCE(l.registro_tipo, 'hibrido') <> 'venda' ${dateFilter} ${clientFilter}${regiao.sql}
        ORDER BY COALESCE(l.lead_date, l.data, l.created_at::date) DESC NULLS LAST`,
      params,
    );

    // Mapa de etapas POR CLIENTE — o mesmo status pode significar coisas
    // diferentes em funis diferentes, então não dá pra ter um mapa global.
    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    const kanbanPorCliente = new Map<string, StageKanban[]>();
    try {
      const { rows: stageRows } = await pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil, position FROM public.crm_stages`,
      );
      for (const s of stageRows) {
        const cid = String(s.client_id);
        const funnelId = String(s.funnel_id);
        const label = String(s.label ?? '');
        const etapa = (s.etapa_funil ?? null) as EtapaFunil | null;
        if (!stagesPorCliente.has(cid)) stagesPorCliente.set(cid, []);
        stagesPorCliente.get(cid)!.push({ funnelId, label, etapa });
        if (!kanbanPorCliente.has(cid)) kanbanPorCliente.set(cid, []);
        kanbanPorCliente.get(cid)!.push({ funnelId, label, etapa, position: Number(s.position) || 0 });
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

    // Modo etapa real: escada do único cliente, montada com os MESMOS leads que
    // acabaram de vir (para o funil dominante casar com o do summary).
    let ladder: LadderKanban | null = null;
    if (stageMode) {
      const soloId = clientIds[0];
      const leadsDoSolo: LeadParaFunil[] = rows
        .filter(r => String(r.client_id) === soloId)
        .map(r => ({
          status: r.status ?? null,
          funnelId: r.funnel_id ? String(r.funnel_id) : null,
          agendou: r.agendou === true,
          dataAgendada: r.data_agendada ? String(r.data_agendada) : null,
          dataLead: r.data_lead ? String(r.data_lead) : null,
          compareceu: r.compareceu === true,
          fechou: r.fechou === true,
          receita: Number(r.valor_rs) || 0,
        }));
      ladder = construirLadder(kanbanPorCliente.get(soloId) ?? [], leadsDoSolo);
    }

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
      let etapaAtual: string;
      let perdidoLead: boolean;
      if (stageMode && ladder) {
        const s = indiceStageDoLead(lead, ladder);
        // alcancou = chegou nesta etapa ou além; atual = parado exatamente nela.
        const bate = modo === 'atual' ? s.idx === stageIndex : s.idx >= stageIndex;
        if (!bate) continue;
        etapaAtual = ladder.degraus[s.idx]?.label ?? '';
        perdidoLead = s.perdido;
      } else {
        const posto = etapaDoLead(lead, mapaDe(clientId));
        if (!leadNaEtapa(posto, etapa as EtapaFunil, modo)) continue;
        etapaAtual = etapaRotuloDoPosto(posto.posto);
        perdidoLead = posto.perdido;
      }

      selecionados.push({
        id: String(row.id),
        clientId,
        clientName: row.client_name ?? null,
        nome: row.nome ?? null,
        numero: row.numero ?? null,
        status: row.status ?? null,
        /** Etapa (real do Kanban no stageMode, senão semântica) que o lead ALCANÇOU. */
        etapaAtual,
        perdido: perdidoLead,
        valor: Number(row.valor_rs) || 0,
        data: row.data_lead ? String(row.data_lead).split('T')[0] : null,
        /** Canal de origem — `null` quando o CRM não registrou de onde veio. */
        canal: rotularCanal(row.canal as string | null),
        /** Data da consulta marcada, para a lista mostrar quem ainda vai vir. */
        dataAgendada: diaISO(row.data_agendada ? String(row.data_agendada) : null),
      });
    }

    return Response.json({
      etapa: stageMode ? null : etapa,
      stageIndex: stageMode ? stageIndex : null,
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
