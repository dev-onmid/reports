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

/**
 * Cliente sem NENHUMA meta não é caso do Radar — ele sai da tela em vez de
 * ocupar uma linha inteira de traços. Não é "esconder problema": a tela oferece
 * um atalho para ver justamente esses, senão um cliente ficaria meses sem meta
 * e ninguém perceberia.
 */
export function temAlgumaMeta(m: {
  metaTarget: number; metaLeads: number; metaCpl: number; metaCac: number;
  /** Meta de alcance (redes sociais) — sozinha já mantém o cliente na tela. */
  metaAlcance?: number;
  // Aceita o funil como lista OU como objeto por etapa (é assim que a tela guarda).
  metaFunil?: number[] | Record<string, number>;
}): boolean {
  if (m.metaTarget > 0 || m.metaLeads > 0 || m.metaCpl > 0 || m.metaCac > 0) return true;
  if ((m.metaAlcance ?? 0) > 0) return true;
  const funil = m.metaFunil ?? [];
  return (Array.isArray(funil) ? funil : Object.values(funil)).some((v) => v > 0);
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

// ── Conta de anúncio compartilhada ───────────────────────────────────────────
//
// ⚠️ Dois clientes podem estar ligados à MESMA conta de anúncio (ex.: duas
// unidades da mesma rede). A rota de métricas é por cliente, então cada um
// devolve o gasto/leads da conta inteira — e somar as linhas contava a mesma
// conta duas vezes nos cards do topo (PicoLocos Guanabara + Prochet: 196 leads
// e R$ 1.394,53 cada, somados em dobro).
//
// A rota não devolve de qual conta veio cada número, então o total é
// deduplicado pela ASSINATURA por plataforma (gasto + leads idênticos, com gasto
// > 0): mesma conta no mesmo período dá exatamente o mesmo par; contas
// diferentes empatarem ao centavo e no lead é improvável. Os vínculos de conta
// (quando conhecidos) só servem para apontar o compartilhamento na linha —
// sobreposição PARCIAL (A = conta 1; B = contas 1+2) é detectada no selo mas não
// dá para descontar do total sem o número por conta.

export type FonteRadar = {
  id: string;
  nome: string;
  meta: { gasto: number; leads: number } | null;
  google: { gasto: number; leads: number } | null;
  /** Gasto/leads que não vieram da API (fallback de demo) — somam sempre. */
  extraGasto: number;
  extraLeads: number;
  /** Chaves `plataforma:conta` vinculadas ao cliente, quando conhecidas. */
  contas: string[];
};

export function chaveConta(platform: string, accountId: string): string {
  const id = platform === 'google_ads'
    ? accountId.replace(/\D/g, '')
    : accountId.replace(/^act_/, '');
  return `${platform}:${id}`;
}

function assinatura(plataforma: string, v: { gasto: number; leads: number } | null): string | null {
  if (!v || !(v.gasto > 0)) return null;
  return `${plataforma}|${v.gasto.toFixed(2)}|${v.leads}`;
}

export function totaisSemDuplicar(fontes: FonteRadar[]): {
  investimento: number;
  leads: number;
  /** Quantas contas apareciam em mais de um cliente e entraram uma vez só. */
  contasCompartilhadas: number;
} {
  const vistas = new Map<string, number>();
  let investimento = 0;
  let leads = 0;
  for (const f of fontes) {
    investimento += f.extraGasto;
    leads += f.extraLeads;
    for (const [plat, v] of [['meta', f.meta], ['google', f.google]] as const) {
      if (!v) continue;
      const sig = assinatura(plat, v);
      if (sig) {
        const n = vistas.get(sig) ?? 0;
        vistas.set(sig, n + 1);
        if (n > 0) continue; // mesma conta já somada
      }
      investimento += v.gasto;
      leads += v.leads;
    }
  }
  let contasCompartilhadas = 0;
  for (const n of vistas.values()) if (n > 1) contasCompartilhadas += 1;
  return { investimento, leads, contasCompartilhadas };
}

/** Para cada cliente, os NOMES dos outros clientes com quem divide conta. */
export function compartilhamentoDeConta(fontes: FonteRadar[]): Record<string, string[]> {
  const porChave = new Map<string, Set<string>>();
  const add = (chave: string, id: string) => {
    const s = porChave.get(chave) ?? new Set<string>();
    s.add(id);
    porChave.set(chave, s);
  };
  for (const f of fontes) {
    for (const c of f.contas) add(`conta|${c}`, f.id);
    for (const [plat, v] of [['meta', f.meta], ['google', f.google]] as const) {
      const sig = assinatura(plat, v);
      if (sig) add(`sig|${sig}`, f.id);
    }
  }
  const nomes = new Map(fontes.map((f) => [f.id, f.nome]));
  const out: Record<string, Set<string>> = {};
  for (const ids of porChave.values()) {
    if (ids.size < 2) continue;
    for (const id of ids) {
      out[id] ??= new Set();
      for (const outro of ids) if (outro !== id) out[id].add(nomes.get(outro) ?? outro);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([id, s]) => [id, [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))]));
}

/** Mediana simples; `null` para lista vazia. */
export function mediana(valores: number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
