import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  contarFunil,
  type ContagemFunil,
  type EtapaDeStage,
  type EtapaFunil,
  type LeadParaFunil,
} from '@/lib/funil-etapas';

/**
 * Funil de Performance por cliente — contagens CUMULATIVAS por etapa semântica.
 *
 * A tradução status→etapa deixou de ser a lista hardcoded de rótulos padrão
 * (que zerava Agendamentos/Comparecimentos pra qualquer cliente com etapas
 * próprias) e passou a vir do mapeamento do PRÓPRIO cliente: cada `crm_stages`
 * carrega `etapa_funil`, com auto-classificação por regex como default.
 * Toda a lógica vive em src/lib/funil-etapas.ts — esta rota é só I/O.
 *
 * Shape: Array<{ clientId, leads, funil: ContagemFunil, total }>.
 * `leads` = base inteira (topo do funil); `total` = receita dos fechados
 * (nome mantido do shape antigo). Consumidores: dashboard e /resultados.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const pool = makeServerPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.crm_leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE public.crm_leads
        ADD COLUMN IF NOT EXISTS data DATE,
        ADD COLUMN IF NOT EXISTS lead_date DATE,
        ADD COLUMN IF NOT EXISTS data_agendada DATE,
        ADD COLUMN IF NOT EXISTS status TEXT,
        ADD COLUMN IF NOT EXISTS funnel_id UUID,
        ADD COLUMN IF NOT EXISTS agendou BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS compareceu BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS fechou BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS valor_rs NUMERIC,
        ADD COLUMN IF NOT EXISTS revenue NUMERIC DEFAULT 0,
        ADD COLUMN IF NOT EXISTS registro_tipo TEXT DEFAULT 'hibrido',
        ADD COLUMN IF NOT EXISTS data_fechamento DATE
    `);

    const params: (string | null)[] = [];
    let dateFilter = '';
    if (from && to) {
      params.push(from, to);
      // Data de referência POR REGISTRO: venda janela por data de fechamento
      // (data_fechamento), lead/hibrido por data de cadastro (lead_date/data).
      // Como data_fechamento é NULL em tudo que já existe, o comportamento
      // antigo é preservado — só o ledger de vendas passa a filtrar pelo
      // fechamento, que é o que o Matheus pediu ("venda = período de fechamento").
      // Lead sem data fica DENTRO: planilhas chegam sem a coluna preenchida e
      // sumir com eles esvaziaria o funil de quem mais precisa dele.
      dateFilter = `AND (COALESCE(data_fechamento, lead_date, data) IS NULL OR (COALESCE(data_fechamento, lead_date, data) >= $1 AND COALESCE(data_fechamento, lead_date, data) <= $2))`;
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
              COALESCE(NULLIF(revenue, 0), valor_rs, 0) AS valor_rs
         FROM public.crm_leads
        WHERE TRUE ${dateFilter}`,
      params
    );

    // Mapeamento etapa→semântica de todos os clientes numa query só (tabela
    // pequena). Instalação sem a tabela/coluna degrada pra lista vazia — o
    // contarFunil então classifica pelo texto do status, que já cobre o
    // vocabulário de planilha.
    const stagesPorCliente = new Map<string, EtapaDeStage[]>();
    try {
      const { rows: stageRows } = await pool.query(
        `SELECT client_id, funnel_id, label, etapa_funil FROM public.crm_stages`
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
      // sem crm_stages (ou sem a coluna etapa_funil ainda) → auto-classificação pura
    }

    const leadsPorCliente = new Map<string, LeadParaFunil[]>();
    for (const row of rows) {
      const cid = String(row.client_id);
      if (!leadsPorCliente.has(cid)) leadsPorCliente.set(cid, []);
      leadsPorCliente.get(cid)!.push({
        status: row.status ?? null,
        funnelId: row.funnel_id ? String(row.funnel_id) : null,
        agendou: row.agendou === true,
        dataAgendada: row.data_agendada ? String(row.data_agendada) : null,
        // Agendamento anterior ao próprio lead é mês digitado errado — a lib
        // descarta. Sem esta coluna a checagem não teria com o que comparar.
        dataLead: row.data_lead ? String(row.data_lead) : null,
        compareceu: row.compareceu === true,
        fechou: row.fechou === true,
        receita: Number(row.valor_rs) || 0,
        tipo: (row.registro_tipo as 'lead' | 'venda' | 'hibrido') ?? 'hibrido',
      });
    }

    return Response.json(
      [...leadsPorCliente.entries()].map(([clientId, leads]) => {
        const funil: ContagemFunil = contarFunil(leads, stagesPorCliente.get(clientId) ?? []);
        return {
          clientId,
          /** Base inteira do cliente — topo do funil quando a fonte é CRM. */
          leads: funil.contatos,
          funil,
          /** Receita dos fechados (nome herdado do shape antigo). */
          total: funil.receita,
        };
      })
    );
  } catch (err) {
    // [] mantém os consumidores de pé, mas o silêncio total escondia falha de
    // banco como "funil zerado" — agora ao menos fica no log.
    console.error('[crm summary]', err);
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
