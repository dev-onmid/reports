import { makeServerPool } from '@/lib/server-db';
import { internalHeaders } from '@/lib/session';
import { consultarCrmDoPeriodo, type CrmDoPeriodo } from '@/lib/crm-metricas';
import { CORES_ETAPA, type ContagemFunil, type FunilPorStage } from '@/lib/funil-etapas';
import type { Ga4Consolidado } from '@/lib/ga4-landing';
import type { FunilPlanilha } from '@/lib/funil-planilha';

/**
 * Dados de CRM do relatório de performance — lidos das MESMAS fontes da
 * dashboard, para o cliente nunca ver um número no relatório e outro na tela.
 *
 *  - faturamento/vendas/leads: `consultarCrmDoPeriodo` (a query do card da dashboard);
 *  - funil: `/api/crm/summary` (a rota do Funil de Performance);
 *  - canais: `/api/crm/por-canal` (a rota dos donuts de canal).
 *
 * ⚠️ Funil e canais vêm por HTTP interno, e não por uma cópia das queries: as
 * duas rotas carregam regra demais (lei de contagem, escada do Kanban, fusão de
 * canais por cliente) e uma segunda implementação divergiria na primeira
 * mudança — foi exatamente o que aconteceu com o faturamento.
 *
 * Tudo best-effort: fonte que falha vira `null` e a página correspondente some.
 */

export type FunilDoRelatorio = {
  funil: ContagemFunil;
  /** Etapas reais do Kanban do cliente, ou null → cai no funil semântico. */
  funilStages: FunilPorStage | null;
  /**
   * Funil contado DIRETO da planilha do cliente (Romanza, 2026-10-07) — na
   * dashboard ele VENCE o Kanban e o semântico; aqui também, senão o relatório
   * mostra 5 degraus genéricos e a tela mostra os da planilha, para o mesmo mês.
   */
  funilPlanilha: FunilPlanilha | null;
  /** Vendas fechadas na janela por quando o lead começou (Lei 5). */
  vendasCohort: { periodo: number; anteriores: number; semData: number } | null;
};

export type CanalReceita = { label: string; receita: number; vendas: number; ticket: number | null };
export type CanalLeads = { label: string; leads: number };
export type CanaisDoRelatorio = {
  origens: CanalReceita[];
  total: number;
  semAtribuicao: number;
  leads: CanalLeads[];
  leadsTotal: number;
};

export type CrmDoRelatorio = {
  atual: CrmDoPeriodo | null;
  anterior: CrmDoPeriodo | null;
  funil: FunilDoRelatorio | null;
  canais: CanaisDoRelatorio | null;
  /** Meta MENSAL de faturamento cadastrada no planejamento (client_goals). */
  metaFaturamento: number | null;
};

function appOrigin(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://reports.onmid.app').replace(/\/+$/, '');
}

async function fetchInterno<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${appOrigin()}${path}`, { headers: internalHeaders(), cache: 'no-store' });
    if (!r.ok) {
      console.error('[report-crm-dados]', path.split('?')[0], r.status);
      return null;
    }
    return await r.json() as T;
  } catch (e) {
    console.error('[report-crm-dados]', path.split('?')[0], e);
    return null;
  }
}

type LinhaSummary = {
  clientId: string;
  funil: ContagemFunil;
  funilStages: FunilPorStage | null;
  funilPlanilha?: FunilPlanilha | null;
  vendasCohort?: { periodo: number; anteriores: number; semData: number } | null;
};

type RespostaPorCanal = {
  ok: boolean;
  origens: CanalReceita[];
  total: number;
  semAtribuicao: number;
  leads: CanalLeads[];
  leadsTotal: number;
};

export async function fetchCrmDoRelatorio(
  clientId: string,
  from: string,
  to: string,
  anterior: { from: string; to: string } | null,
): Promise<CrmDoRelatorio> {
  const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const pool = makeServerPool();
  try {
    const [atual, ant, summary, canais, metaRows] = await Promise.all([
      consultarCrmDoPeriodo(pool, clientId, from, to),
      anterior ? consultarCrmDoPeriodo(pool, clientId, anterior.from, anterior.to) : Promise.resolve(null),
      fetchInterno<LinhaSummary[]>(`/api/crm/summary?${q}`),
      fetchInterno<RespostaPorCanal>(`/api/crm/por-canal?clientIds=${encodeURIComponent(clientId)}&${q}`),
      pool.query(
        `SELECT target FROM public.client_goals WHERE client_id = $1 AND type = 'revenue' LIMIT 1`,
        [clientId],
      ).then(r => r.rows, () => [] as Array<{ target: unknown }>),
    ]);

    const linha = Array.isArray(summary) ? summary.find(s => s.clientId === clientId) : undefined;
    const meta = Number(metaRows[0]?.target ?? 0);
    return {
      atual,
      anterior: ant,
      funil: linha ? { funil: linha.funil, funilStages: linha.funilStages ?? null, funilPlanilha: linha.funilPlanilha ?? null, vendasCohort: linha.vendasCohort ?? null } : null,
      canais: canais && canais.ok
        ? { origens: canais.origens ?? [], total: Number(canais.total) || 0, semAtribuicao: Number(canais.semAtribuicao) || 0, leads: canais.leads ?? [], leadsTotal: Number(canais.leadsTotal) || 0 }
        : null,
      metaFaturamento: meta > 0 ? meta : null,
    };
  } finally {
    await pool.end();
  }
}

/**
 * Site / landing pages (GA4) do período — pela MESMA rota do painel "Landing page"
 * da dashboard (`/api/clients/[id]/ga4`), que soma as propriedades vinculadas ao
 * cliente. `null` = sem propriedade vinculada, sem conta conectada ou token vencido:
 * as páginas de site simplesmente não entram.
 */
export async function fetchSiteDoRelatorio(clientId: string, from: string, to: string): Promise<Ga4Consolidado | null> {
  const r = await fetchInterno<{ ga4: Ga4Consolidado | null }>(
    `/api/clients/${encodeURIComponent(clientId)}/ga4?period=custom&dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`,
  );
  return r?.ga4 ?? null;
}

/** O período é exatamente UM mês-calendário cheio? Só aí a meta mensal se aplica. */
export function ehMesCheio(from: string, to: string): boolean {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !ty || fy !== ty || fm !== tm || fd !== 1) return false;
  return td === new Date(Date.UTC(ty, tm, 0)).getUTCDate();
}

/**
 * Degraus do funil como a DASHBOARD os mostra: etapas reais do Kanban quando o
 * cliente tem (topo "Leads" e 2º "Engajados" com rótulo fixo — decisão de
 * 2026-09-24), senão o funil semântico de 5 degraus.
 */
export function degrausDoFunil(f: FunilDoRelatorio): Array<{ label: string; cor: string; valor: number }> {
  // Mesma precedência da dashboard: planilha do cliente > Kanban > semântico.
  if (f.funilPlanilha && f.funilPlanilha.degraus.length > 0) {
    return f.funilPlanilha.degraus.map(d => ({ label: d.rotulo, cor: d.cor, valor: d.valor }));
  }
  if (f.funilStages && f.funilStages.degraus.length > 0) {
    return f.funilStages.degraus.map(d => ({
      label: d.etapa === 'contato' ? 'Leads' : d.etapa === 'qualificado' ? 'Engajados' : d.label,
      cor: d.color,
      valor: d.alcancaram,
    }));
  }
  return [
    { label: 'Leads', cor: CORES_ETAPA.contato, valor: f.funil.contatos },
    { label: 'Engajados', cor: CORES_ETAPA.qualificado, valor: f.funil.qualificados },
    { label: 'Agendamentos', cor: CORES_ETAPA.agendamento, valor: f.funil.agendamentos },
    { label: 'Comparecimentos', cor: CORES_ETAPA.comparecimento, valor: f.funil.comparecimentos },
    { label: 'Fechamentos', cor: CORES_ETAPA.fechamento, valor: f.funil.fechamentos },
  ];
}
