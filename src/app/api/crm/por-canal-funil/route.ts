// ── GET /api/crm/por-canal-funil?clientIds=&from=&to= ─────────────────────────
// Funil do CRM POR CANAL do lead, para a tabela "Funil por canal" da dashboard
// (pedido do Matheus, 2026-09-24: "o funil simulando exatamente o que eu fazia
// na planilha" — a planilha tinha, por canal, Leads · Agenda · Comp · Fecham ·
// %Conv). A tela cruza com o investimento de Meta/Google para CPL e CAC.
//
// ⚠️ É IRMÃ do /api/crm/summary e do /api/crm/por-regiao e precisa continuar
// sendo: mesmo SELECT de sinais, mesma régua de data ("lead sem data fica
// DENTRO"), mesma LEI de contagem, mesmo contarFunil com as etapas do Kanban do
// cliente. Se divergirem, a soma dos canais não fecha com o funil principal na
// mesma tela.
//
// O canal vem de `canalSql()` (lib compartilhada com o donut de canais e a lista
// de leads do funil — os três PRECISAM concordar). Lead sem canal entra numa
// linha própria "Canal não informado" em vez de sumir: assim a soma da tabela
// bate com o funil, e o gestor vê o tamanho da lacuna de cadastro.

import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { contarFunil, somarFunis, type ContagemFunil, type EtapaDeStage, type EtapaFunil, type LeadParaFunil } from '@/lib/funil-etapas';
import { canalSql, rotularCanal } from '@/lib/canal-lead';
import { leadContaSql } from '@/lib/lead-contagem';

export type LinhaCanal = {
  canal: string;
  /** Linha da lacuna ("Canal não informado") — não é um canal. */
  semCanal: boolean;
  leads: number;
  /** Quem respondeu/interagiu (posto 1 do funil — "Engajados" na dashboard). */
  engajados: number;
  agendamentos: number;
  comparecimentos: number;
  fechamentos: number;
  receita: number;
};

export type FunilPorCanalResposta = {
  ok: boolean;
  canais: LinhaCanal[];
  total: number;
};

const VAZIO: FunilPorCanalResposta = { ok: false, canais: [], total: 0 };
const SEM_CANAL = 'Canal não informado';

function linha(canal: string, semCanal: boolean, f: ContagemFunil): LinhaCanal {
  return {
    canal, semCanal,
    leads: f.contatos, engajados: f.qualificados, agendamentos: f.agendamentos,
    comparecimentos: f.comparecimentos, fechamentos: f.fechamentos, receita: f.receita,
  };
}

export async function GET(req: NextRequest) {
  const clientIds = (req.nextUrl.searchParams.get('clientIds') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (clientIds.length === 0) return Response.json(VAZIO);

  const pool = makeServerPool();
  try {
    const params: unknown[] = [clientIds];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      // Idêntico ao summary (venda pela data de fechamento, lead pelo cadastro, sem data fica dentro).
      dateFilter = `AND (COALESCE(data_fechamento, lead_date, data) IS NULL OR (COALESCE(data_fechamento, lead_date, data) >= $2 AND COALESCE(data_fechamento, lead_date, data) <= $3))`;
    }

    const { rows } = await pool.query(
      `SELECT client_id,
              status,
              funnel_id,
              agendou,
              data_agendada,
              COALESCE(lead_date, data) AS data_lead,
              compareceu,
              COALESCE(registro_tipo, 'hibrido') AS registro_tipo,
              (fechou OR COALESCE(NULLIF(revenue, 0), valor_rs, 0) > 0) AS fechou,
              COALESCE(NULLIF(revenue, 0), valor_rs, 0) AS valor_rs,
              ${canalSql()} AS canal
         FROM public.crm_leads
        -- A LEI (lead-contagem.ts): irmã do summary, mesma contagem.
        WHERE client_id = ANY($1) AND ${leadContaSql()} ${dateFilter}`,
      params,
    );

    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    try {
      const { rows: stageRows } = await pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil, situacao FROM public.crm_stages WHERE client_id = ANY($1)`,
        [clientIds],
      );
      for (const s of stageRows) {
        const cid = String(s.client_id);
        if (!stagesPorCliente.has(cid)) stagesPorCliente.set(cid, []);
        stagesPorCliente.get(cid)!.push({ funnelId: String(s.funnel_id), label: String(s.label ?? ''), etapa: (s.etapa_funil ?? null) as EtapaFunil | null, situacao: (s.situacao ?? null) as EtapaDeStage['situacao'] });
      }
    } catch {
      // sem crm_stages → auto-classificação pelo texto do status
    }

    // Grupo → leads POR CLIENTE (o contarFunil precisa das etapas do cliente
    // dono do lead; somar depois é o que o summary também faz com somarFunis).
    type Grupo = Map<string, LeadParaFunil[]>; // clientId → leads
    // ⚠️ Chave do canal em minúsculas: 'Google' e 'google', 'Facebook' e
    // 'Facebook ' são o MESMO canal (mesma fusão do donut em por-canal). O
    // rótulo exibido é a grafia mais frequente.
    const porCanal = new Map<string, { grafias: Map<string, number>; porCliente: Grupo }>();
    let total = 0;

    for (const row of rows) {
      const cid = String(row.client_id);
      const lead: LeadParaFunil = {
        status: row.status ?? null,
        funnelId: row.funnel_id ? String(row.funnel_id) : null,
        agendou: row.agendou === true,
        dataAgendada: row.data_agendada ? String(row.data_agendada) : null,
        dataLead: row.data_lead ? String(row.data_lead) : null,
        compareceu: row.compareceu === true,
        fechou: row.fechou === true,
        receita: Number(row.valor_rs) || 0,
        tipo: (row.registro_tipo as 'lead' | 'venda' | 'hibrido') ?? 'hibrido',
      };
      total++;
      const rotulo = rotularCanal(row.canal as string | null) ?? SEM_CANAL;
      const k = rotulo.toLowerCase();
      const g = porCanal.get(k) ?? { grafias: new Map(), porCliente: new Map() };
      g.grafias.set(rotulo, (g.grafias.get(rotulo) ?? 0) + 1);
      if (!g.porCliente.has(cid)) g.porCliente.set(cid, []);
      g.porCliente.get(cid)!.push(lead);
      porCanal.set(k, g);
    }

    const somar = (grupo: Grupo): ContagemFunil =>
      somarFunis([...grupo].map(([cid, leads]) => contarFunil(leads, stagesPorCliente.get(cid) ?? [])));
    const maisFrequente = (m: Map<string, number>): string => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? SEM_CANAL;

    const canais = [...porCanal.entries()]
      .map(([k, g]) => linha(maisFrequente(g.grafias), k === SEM_CANAL.toLowerCase(), somar(g.porCliente)))
      .sort((a, b) => b.leads - a.leads);

    return Response.json({ ok: true, canais, total } satisfies FunilPorCanalResposta);
  } catch (err) {
    console.error('[crm por-canal-funil]', err);
    return Response.json(VAZIO);
  } finally {
    await pool.end();
  }
}
