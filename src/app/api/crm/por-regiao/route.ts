// ── GET /api/crm/por-regiao?clientIds=&from=&to= ──────────────────────────────
// Funil do CRM POR REGIÃO do lead (cidade e UF), para a tabela "Desempenho por
// região" da dashboard (pedido do Matheus, 2026-09-23): leads, reuniões
// agendadas/realizadas, vendas e receita de cada região — a tela cruza com o
// investimento das campanhas daquela região (pelo nome, ver regiao-recorte.ts).
//
// ⚠️ É IRMÃ do /api/crm/summary e precisa continuar sendo: mesmo SELECT de
// sinais, mesma régua de data ("lead sem data fica DENTRO"), mesmo contarFunil
// com as etapas do Kanban do cliente. Se divergirem, a soma das regiões não
// fecha com o funil principal na mesma tela.
//
// Região do lead = regiao_uf / regiao_cidade (DDD do telefone ou cidade do
// formulário). Lead sem região não entra em linha nenhuma — a tela mostra
// quantos ficaram de fora, em vez de inventar uma "região" pra eles.

import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { contarFunil, type ContagemFunil, type EtapaDeStage, type EtapaFunil, type LeadParaFunil } from '@/lib/funil-etapas';
import { normalizarNome } from '@/lib/regiao-recorte';
import { leadContaSql, rastroPagoSql } from '@/lib/lead-contagem';

export type LinhaRegiao = {
  /** Cidade ("Curitiba") ou UF ("PR"). */
  regiao: string;
  /** UF da cidade (linha de cidade) — para casar com campanha por UF. */
  uf: string | null;
  leads: number;
  agendamentos: number;
  comparecimentos: number;
  fechamentos: number;
  receita: number;
};

export type PorRegiaoResposta = {
  ok: boolean;
  cidades: LinhaRegiao[];
  ufs: LinhaRegiao[];
  /** Leads da janela SEM região nenhuma (não aparecem em linha alguma). */
  semRegiao: number;
  total: number;
};

const VAZIO: PorRegiaoResposta = { ok: false, cidades: [], ufs: [], semRegiao: 0, total: 0 };

function linha(regiao: string, uf: string | null, f: ContagemFunil): LinhaRegiao {
  return { regiao, uf, leads: f.contatos, agendamentos: f.agendamentos, comparecimentos: f.comparecimentos, fechamentos: f.fechamentos, receita: f.receita };
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
              ${rastroPagoSql()} AS rastreado,
              UPPER(NULLIF(TRIM(regiao_uf), '')) AS uf,
              NULLIF(TRIM(regiao_cidade), '') AS cidade
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
    // ⚠️ Chave da cidade SEM acento e SEM caixa: a base tem "Curitiba" (296),
    // "curitiba" (2) e "Goiania"/"Goiânia" — agrupar pela grafia crua espalha a
    // mesma cidade em linhas separadas (medido em produção). O rótulo exibido é
    // a grafia mais frequente; a UF, a mais frequente entre as não-nulas.
    const porCidade = new Map<string, { grafias: Map<string, number>; ufs: Map<string, number>; porCliente: Grupo }>();
    const porUf = new Map<string, Grupo>();
    let semRegiao = 0;
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
        rastreado: row.rastreado === true,
        tipo: (row.registro_tipo as 'lead' | 'venda' | 'hibrido') ?? 'hibrido',
      };
      total++;
      const uf: string | null = row.uf ?? null;
      const cidade: string | null = row.cidade ?? null;
      if (!uf && !cidade) { semRegiao++; continue; }
      if (cidade) {
        const k = normalizarNome(cidade);
        const g = porCidade.get(k) ?? { grafias: new Map(), ufs: new Map(), porCliente: new Map() };
        g.grafias.set(cidade, (g.grafias.get(cidade) ?? 0) + 1);
        if (uf) g.ufs.set(uf, (g.ufs.get(uf) ?? 0) + 1);
        if (!g.porCliente.has(cid)) g.porCliente.set(cid, []);
        g.porCliente.get(cid)!.push(lead);
        porCidade.set(k, g);
      }
      if (uf) {
        const g = porUf.get(uf) ?? new Map();
        if (!g.has(cid)) g.set(cid, []);
        g.get(cid)!.push(lead);
        porUf.set(uf, g);
      }
    }

    const somar = (grupo: Grupo): ContagemFunil => {
      const acc = { contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0, receita: 0 };
      for (const [cid, leads] of grupo) {
        const f = contarFunil(leads, stagesPorCliente.get(cid) ?? []);
        acc.contatos += f.contatos; acc.qualificados += f.qualificados; acc.agendamentos += f.agendamentos;
        acc.comparecimentos += f.comparecimentos; acc.fechamentos += f.fechamentos; acc.receita += f.receita;
      }
      return acc as ContagemFunil;
    };

    const maisFrequente = (m: Map<string, number>): string | null => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cidades = [...porCidade.values()].map(g => linha(maisFrequente(g.grafias) ?? '', maisFrequente(g.ufs), somar(g.porCliente))).sort((a, b) => b.leads - a.leads);
    const ufs = [...porUf.entries()].map(([u, g]) => linha(u, u, somar(g))).sort((a, b) => b.leads - a.leads);

    return Response.json({ ok: true, cidades, ufs, semRegiao, total } satisfies PorRegiaoResposta);
  } catch (err) {
    console.error('[crm por-regiao]', err);
    return Response.json(VAZIO);
  } finally {
    await pool.end();
  }
}
