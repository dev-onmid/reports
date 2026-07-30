// Camada de UI da Biblioteca de Criativos — tipos e helpers PUROS, sem JSX e sem
// `pg`, para poder ser importada tanto no client (card do Início, componente da
// biblioteca) quanto em teste sem banco. Mesmo padrão de `src/lib/optimizer-ui.ts`.
//
// Aqui vive a única definição dos EIXOS DE RANKING de criativo. Dois grupos:
//
//  1. Eixos à prova de funil — `leads`, `conversas`, `comparecimentos`, `vendas`,
//     `receita`. Vêm de contagens e booleans (`compareceu`, `fechou`), então
//     significam a MESMA coisa em qualquer cliente e podem ser comparados na
//     carteira inteira.
//
//  2. Eixos de etapa (`etapa:<label>`) — `crm_leads.status` é texto livre por
//     cliente (`crm_stages.label`). Os rótulos são oferecidos EXATAMENTE como
//     aparecem no dado e NÃO são fundidos entre clientes: "Agendado" e
//     "Agendamento" seguem separados, porque unificar seria adivinhar. No funil
//     padrão (DEFAULT_CRM_STAGES) isso já entrega "Agendado"/"Reagendado".

/** Subconjunto de `CreativeStat` de que os helpers precisam — mantém o módulo desacoplado. */
export type CreativeRankable = {
  leads: number;
  conversas?: number;
  comparecimentos?: number;
  vendas: number;
  receita: number;
  por_status: Record<string, number>;
};

export type AxisFormat = 'int' | 'currency';

export type RankAxis = {
  key: string;
  label: string;
  format: AxisFormat;
  /** Campo de `CreativeRankable` lido por `rankValue` (ausente nos eixos de etapa). */
  field?: keyof CreativeRankable;
};

/** Rótulo que o SQL usa para lead sem etapa — não serve como eixo de ranking. */
export const SEM_ETAPA = 'Sem etapa';

export const STAGE_AXIS_PREFIX = 'etapa:';

export const RANK_AXES: RankAxis[] = [
  { key: 'leads', label: 'Leads', format: 'int', field: 'leads' },
  { key: 'conversas', label: 'Conversas', format: 'int', field: 'conversas' },
  { key: 'comparecimentos', label: 'Compareceram', format: 'int', field: 'comparecimentos' },
  { key: 'vendas', label: 'Vendas', format: 'int', field: 'vendas' },
  { key: 'receita', label: 'Receita', format: 'currency', field: 'receita' },
];

export function isStageAxis(axisKey: string): boolean {
  return axisKey.startsWith(STAGE_AXIS_PREFIX);
}

export function stageLabelOf(axisKey: string): string {
  return isStageAxis(axisKey) ? axisKey.slice(STAGE_AXIS_PREFIX.length) : '';
}

export function stageAxisKey(stageLabel: string): string {
  return `${STAGE_AXIS_PREFIX}${stageLabel}`;
}

/**
 * Etapas presentes no dado, ordenadas pelo total de leads (mais relevante primeiro).
 * `Sem etapa` fica de fora: ranquear criativo por "quantos leads NÃO têm etapa" não
 * é um resultado, e na visão global ela costuma ser grande o bastante para roubar
 * uma vaga útil da lista.
 */
export function stageAxesFrom(
  rows: CreativeRankable[],
  opts: { limit?: number } = {},
): string[] {
  const { limit = 8 } = opts;
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [stage, count] of Object.entries(row.por_status ?? {})) {
      if (stage === SEM_ETAPA) continue;
      totals.set(stage, (totals.get(stage) ?? 0) + count);
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([stage]) => stage);
}

/** Valor do criativo no eixo — 0 quando o eixo não se aplica. */
export function rankValue(row: CreativeRankable, axisKey: string): number {
  if (isStageAxis(axisKey)) return row.por_status?.[stageLabelOf(axisKey)] ?? 0;
  const axis = RANK_AXES.find((a) => a.key === axisKey);
  if (!axis?.field) return 0;
  return Number(row[axis.field] ?? 0);
}

/**
 * Ordena por um eixo, decrescente, com os MESMOS desempates que a Biblioteca de
 * Criativos já usava (leads como desempate geral; vendas desempatando receita).
 * Não muta a entrada.
 */
export function sortByAxis<T extends CreativeRankable>(rows: T[], axisKey: string): T[] {
  const sorted = [...rows];
  if (axisKey === 'receita') {
    sorted.sort((a, b) => b.receita - a.receita || b.vendas - a.vendas);
  } else if (axisKey === 'leads') {
    sorted.sort((a, b) => b.leads - a.leads);
  } else {
    sorted.sort((a, b) => rankValue(b, axisKey) - rankValue(a, axisKey) || b.leads - a.leads);
  }
  return sorted;
}

/**
 * Eixos que fazem sentido oferecer para ESTE conjunto: os à prova de funil que têm
 * algum valor > 0, mais as etapas presentes. `leads` fica sempre (é o padrão e o
 * eixo do corte de 500 no SQL). Assim `comparecimentos` — campo de fluxo de clínica,
 * vazio na maioria dos clientes — só aparece onde realmente é preenchido.
 */
export function availableAxes(rows: CreativeRankable[]): RankAxis[] {
  const safe = RANK_AXES.filter(
    (axis) => axis.key === 'leads' || rows.some((row) => rankValue(row, axis.key) > 0),
  );
  const stages = stageAxesFrom(rows).map<RankAxis>((stage) => ({
    key: stageAxisKey(stage),
    label: stage,
    format: 'int',
  }));
  return [...safe, ...stages];
}

export function axisLabel(axisKey: string, rows?: CreativeRankable[]): string {
  if (isStageAxis(axisKey)) return stageLabelOf(axisKey);
  const found = (rows ? availableAxes(rows) : RANK_AXES).find((a) => a.key === axisKey);
  return found?.label ?? axisKey;
}

export function formatAxisValue(axisKey: string, value: number): string {
  const axis = RANK_AXES.find((a) => a.key === axisKey);
  if (axis?.format === 'currency') {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: value >= 100 ? 0 : 2,
    });
  }
  return value.toLocaleString('pt-BR');
}
