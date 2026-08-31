// Ordenação e filtro da tabela do Radar.
//
// ⚠️ A regra central é: métrica SEM meta cadastrada não é "abaixo da meta" —
// é desconhecida. Ela sai do julgamento (fica só como número de performance),
// nunca é pintada de vermelho e nunca entra no filtro de "não está batendo".
// Chamar de falha o que ninguém mediu faria o Radar mentir justamente onde ele
// deveria ficar calado. Mesma regra do `metricas-food`.

export type SituacaoMeta = 'ok' | 'abaixo' | 'critico' | 'sem_meta';

/** Faixas idênticas às da legenda da tela (≥75 / 30–74 / <30). */
export function situacaoDaMeta(pct: number | null): SituacaoMeta {
  if (pct === null || !Number.isFinite(pct)) return 'sem_meta';
  if (pct >= 75) return 'ok';
  if (pct >= 30) return 'abaixo';
  return 'critico';
}

export type FiltroSituacao = 'todas' | SituacaoMeta;

/** "abaixo" é guarda-chuva: quem está crítico também não está batendo a meta. */
export function casaSituacao(pct: number | null, filtro: FiltroSituacao): boolean {
  if (filtro === 'todas') return true;
  const s = situacaoDaMeta(pct);
  if (filtro === 'abaixo') return s === 'abaixo' || s === 'critico';
  return s === filtro;
}

export type MetricaRadar = 'resultado' | 'leads' | 'cpl' | 'cac' | 'fechamentos';

export const METRICAS: { id: MetricaRadar; label: string }[] = [
  { id: 'resultado',   label: 'Resultado' },
  { id: 'leads',       label: 'Leads' },
  { id: 'cpl',         label: 'CPL' },
  { id: 'cac',         label: 'CAC' },
  { id: 'fechamentos', label: 'Fechamentos' },
];

export type ColunaRadar =
  | 'cliente' | 'meta' | 'resultado' | 'pct' | 'leads'
  | 'cpl' | 'cac' | 'fechamentos' | 'investimento';

export type DirecaoOrdem = 'asc' | 'desc';

/** Só o que ordenar e filtrar precisam saber sobre a linha. */
export type LinhaRadar = {
  nome: string;
  categoria: string;
  metaTarget: number;
  resultado: number;   pctResult: number | null;
  leads: number;       pctLeads: number | null;
  cpl: number;         pctCpl: number | null;
  cac: number;         pctCac: number | null;
  fechamentos: number; pctFechamentos: number | null;
  investimento: number;
};

export function pctDaMetrica(l: LinhaRadar, m: MetricaRadar): number | null {
  switch (m) {
    case 'resultado':   return l.pctResult;
    case 'leads':       return l.pctLeads;
    case 'cpl':         return l.pctCpl;
    case 'cac':         return l.pctCac;
    case 'fechamentos': return l.pctFechamentos;
  }
}

/**
 * Valor de ordenação. `null` = "não dá para comparar" (sem meta, ou métrica que
 * a conta não produz) e vai SEMPRE para o fim, nas duas direções — senão pedir
 * "menor CPL" encheria o topo de quem não tem CPL nenhum.
 */
function valorDaColuna(l: LinhaRadar, c: ColunaRadar): number | string | null {
  switch (c) {
    case 'cliente':      return l.nome.toLocaleLowerCase('pt-BR');
    case 'meta':         return l.metaTarget > 0 ? l.metaTarget : null;
    case 'resultado':    return l.resultado > 0 ? l.resultado : null;
    case 'pct':          return l.pctResult;
    case 'leads':        return l.leads > 0 ? l.leads : null;
    case 'cpl':          return l.cpl > 0 ? l.cpl : null;
    case 'cac':          return l.cac > 0 ? l.cac : null;
    case 'fechamentos':  return l.fechamentos > 0 ? l.fechamentos : null;
    case 'investimento': return l.investimento > 0 ? l.investimento : null;
  }
}

export function ordenarLinhas<T extends LinhaRadar>(
  linhas: T[], coluna: ColunaRadar | null, direcao: DirecaoOrdem,
): T[] {
  if (!coluna) return linhas;
  const sinal = direcao === 'asc' ? 1 : -1;
  // Cópia: nunca ordenar no lugar a lista derivada do estado do React.
  return [...linhas].sort((a, b) => {
    const va = valorDaColuna(a, coluna);
    const vb = valorDaColuna(b, coluna);
    if (va === null && vb === null) return a.nome.localeCompare(b.nome, 'pt-BR');
    if (va === null) return 1;   // vazio no fim, independente da direção
    if (vb === null) return -1;
    if (typeof va === 'string' || typeof vb === 'string') {
      return sinal * String(va).localeCompare(String(vb), 'pt-BR');
    }
    if (va === vb) return a.nome.localeCompare(b.nome, 'pt-BR'); // desempate estável
    return sinal * (va - vb);
  });
}

export function filtrarLinhas<T extends LinhaRadar>(
  linhas: T[],
  { categoria, metrica, situacao }: {
    categoria: string;            // '' = todas
    metrica: MetricaRadar;
    situacao: FiltroSituacao;
  },
): T[] {
  return linhas.filter((l) => {
    if (categoria && l.categoria !== categoria) return false;
    if (situacao !== 'todas' && !casaSituacao(pctDaMetrica(l, metrica), situacao)) return false;
    return true;
  });
}

/** Categorias presentes, em ordem alfabética; vazio não vira opção. */
export function categoriasDisponiveis(linhas: LinhaRadar[]): string[] {
  return [...new Set(linhas.map((l) => l.categoria).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Clique no cabeçalho: desc → asc → sem ordenação. */
export function proximaOrdem(
  atual: { coluna: ColunaRadar | null; direcao: DirecaoOrdem },
  clicada: ColunaRadar,
  padrao: DirecaoOrdem = 'desc',
): { coluna: ColunaRadar | null; direcao: DirecaoOrdem } {
  if (atual.coluna !== clicada) return { coluna: clicada, direcao: padrao };
  if (atual.direcao === padrao) return { coluna: clicada, direcao: padrao === 'desc' ? 'asc' : 'desc' };
  return { coluna: null, direcao: padrao };
}
