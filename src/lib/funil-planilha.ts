/**
 * Funil calculado DIRETO da planilha do cliente, com as regras da própria
 * planilha.
 *
 * Pedido do Matheus (07/10/2026), com o print do resumo "FUNIL ATUAL" da
 * Romanza: "por que a dashboard não mostra os mesmos números da planilha?
 * Preciso que esses sejam os padrões de funil da Romanza".
 *
 * ⚠️ Por que não sai do CRM: na importação, linha da planilha cujo telefone já
 * existe como conversa de WhatsApp é FUNDIDA nela (é a régua única de
 * identidade) — em setembro só 133 das 253 linhas guardam a linha original. E
 * os degraus da Romanza não são etapas de Kanban: "Contatos Feitos" é ✅ em
 * 1º/2º/3º contato, "Aprovações" é soma de três status. Recontar a partir do
 * CRM nunca bateria; contar a planilha com as fórmulas dela bate por
 * construção (verificado: 253/213/26/13/13/12 em setembro).
 *
 * Funil POR CLIENTE, nunca global — mesmo desenho do `FUSOES_CANAL`.
 */

export type RegraPlanilha =
  /** Toda linha que conta como lead. */
  | { tipo: 'todas' }
  /** A coluna de status é um destes valores (comparação sem caixa/acento). */
  | { tipo: 'status'; valores: string[] }
  /** Alguma destas colunas tem a marca (ex.: ✅). */
  | { tipo: 'marcado'; colunas: string[]; marca: string };

export type EtapaPlanilha = { rotulo: string; cor: string; regra: RegraPlanilha };
/** Contagem paralela exibida como chip sob um degrau (ex.: Restrições). */
export type DesvioPlanilha = { rotulo: string; apos: number; tom: 'ruim' | 'neutro' | 'bom'; regra: RegraPlanilha };

export type ConfigFunilPlanilha = {
  /** Candidatas à coluna de data, na ordem (o cabeçalho muda entre anos). */
  colunasData: string[];
  colunaStatus: string;
  /** Linha só conta se esta coluna estiver preenchida (a planilha conta COUNTA dela). */
  colunaObrigatoria: string;
  etapas: EtapaPlanilha[];
  desvios: DesvioPlanilha[];
};

const ROMANZA = 'client-1778639756911';

/**
 * As fórmulas da aba "FUNIL ATUAL" da Romanza (lidas em 07/10/2026), traduzidas:
 *  Leads = COUNTA(CANAL)-1 · Contatos Feitos = ✅ em 1º, 2º ou 3º contato ·
 *  Restrições = STATUS "Restrição" · Aprovações = Agendado + Cadastrou + Aprovado ·
 *  Agendamentos = Agendado + Cadastrou · Comparecimentos = Agendado + Cadastrou
 *  (é a fórmula do mês corrente; a coluna "Compareceu" está vazia em todas as abas) ·
 *  Cadastros = Cadastrou.
 * ⚠️ "Perda" ficou de fora: a fórmula dela aponta para uma coluna sem
 * cabeçalho e sempre dá 0 na própria planilha.
 */
export const FUNIS_PLANILHA: Record<string, ConfigFunilPlanilha> = {
  [ROMANZA]: {
    colunasData: ['DATA', 'DATA ENTRADA'],
    colunaStatus: 'STATUS',
    colunaObrigatoria: 'CANAL',
    etapas: [
      { rotulo: 'Leads', cor: '#7dd3fc', regra: { tipo: 'todas' } },
      { rotulo: 'Contatos Feitos', cor: '#0ea5e9', regra: { tipo: 'marcado', colunas: ['1º CONTATO', '2º CONTATO', '3º CONTATO'], marca: '✅' } },
      { rotulo: 'Aprovações', cor: '#6366f1', regra: { tipo: 'status', valores: ['Agendado', 'Cadastrou', 'Aprovado'] } },
      { rotulo: 'Agendamentos', cor: '#8b5cf6', regra: { tipo: 'status', valores: ['Agendado', 'Cadastrou'] } },
      { rotulo: 'Comparecimentos', cor: '#f59e0b', regra: { tipo: 'status', valores: ['Agendado', 'Cadastrou'] } },
      { rotulo: 'Cadastros', cor: '#10b981', regra: { tipo: 'status', valores: ['Cadastrou'] } },
    ],
    desvios: [
      { rotulo: 'restrições', apos: 1, tom: 'ruim', regra: { tipo: 'status', valores: ['Restrição'] } },
    ],
  },
};

export function configFunilPlanilha(clientId: string): ConfigFunilPlanilha | null {
  return FUNIS_PLANILHA[clientId] ?? null;
}

/** Comparável: sem acento, sem caixa, sem espaço sobrando. */
export function normalizarCelula(v: unknown): string {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function indiceDaColuna(cabecalho: unknown[], nome: string): number {
  const alvo = normalizarCelula(nome);
  return cabecalho.findIndex(h => normalizarCelula(h) === alvo);
}

/** Data de uma célula: número de série do Excel, Date ou texto dd/mm/aaaa. */
export function dataDaCelula(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Math.round((v - 25569) * 86_400_000));
  }
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export type ContagemAba = {
  /** 'AAAA-MM-DD' -> contagem por etapa (mesma ordem de `etapas`). */
  porDia: Map<string, number[]>;
  /** 'AAAA-MM-DD' -> contagem por desvio. */
  desviosPorDia: Map<string, number[]>;
  linhas: number;
  /** Colunas que a regra pediu e a aba não tem — a etapa conta 0 nela. */
  colunasAusentes: string[];
};

/**
 * Conta UMA aba de mês. A linha cai no DIA da sua data quando ela é do mês da
 * aba; senão, no dia 1 do mês da aba — a planilha soma por ABA, então o total
 * do mês tem de fechar com ela mesmo quando uma data foi digitada errada.
 */
export function contarAbaPlanilha(
  linhas: unknown[][], cfg: ConfigFunilPlanilha, periodo: { ano: number; mes: number },
): ContagemAba | null {
  // O cabeçalho nem sempre é a 1ª linha (a aba OUT 2026 tem uma coluna em branco
  // antes): procura nas primeiras linhas a que tem a coluna obrigatória.
  let iCab = -1;
  for (let i = 0; i < Math.min(linhas.length, 6); i++) {
    if (indiceDaColuna(linhas[i] ?? [], cfg.colunaObrigatoria) >= 0) { iCab = i; break; }
  }
  if (iCab < 0) return null;
  const cab = linhas[iCab];
  const iObrig = indiceDaColuna(cab, cfg.colunaObrigatoria);
  const iStatus = indiceDaColuna(cab, cfg.colunaStatus);
  const iData = cfg.colunasData.map(c => indiceDaColuna(cab, c)).find(i => i >= 0) ?? -1;
  const ausentes = new Set<string>();
  if (iStatus < 0) ausentes.add(cfg.colunaStatus);

  const avaliador = (regra: RegraPlanilha): ((l: unknown[]) => boolean) => {
    if (regra.tipo === 'todas') return () => true;
    if (regra.tipo === 'status') {
      const ok = new Set(regra.valores.map(normalizarCelula));
      return l => iStatus >= 0 && ok.has(normalizarCelula(l[iStatus]));
    }
    const idx = regra.colunas.map(c => indiceDaColuna(cab, c));
    regra.colunas.forEach((c, k) => { if (idx[k] < 0) ausentes.add(c); });
    const marca = normalizarCelula(regra.marca);
    return l => idx.some(i => i >= 0 && normalizarCelula(l[i]) === marca);
  };
  const etapas = cfg.etapas.map(e => avaliador(e.regra));
  const desvios = cfg.desvios.map(d => avaliador(d.regra));

  const mm = String(periodo.mes + 1).padStart(2, '0');
  const dia1 = `${periodo.ano}-${mm}-01`;
  const porDia = new Map<string, number[]>();
  const desviosPorDia = new Map<string, number[]>();
  let total = 0;
  for (const l of linhas.slice(iCab + 1)) {
    if (!l || normalizarCelula(l[iObrig]) === '') continue;
    total++;
    const d = iData >= 0 ? dataDaCelula(l[iData]) : null;
    const iso = d ? d.toISOString().slice(0, 10) : null;
    const dia = iso && iso.startsWith(`${periodo.ano}-${mm}`) ? iso : dia1;
    const c = porDia.get(dia) ?? cfg.etapas.map(() => 0);
    etapas.forEach((f, k) => { if (f(l)) c[k]++; });
    porDia.set(dia, c);
    const dv = desviosPorDia.get(dia) ?? cfg.desvios.map(() => 0);
    desvios.forEach((f, k) => { if (f(l)) dv[k]++; });
    desviosPorDia.set(dia, dv);
  }
  return { porDia, desviosPorDia, linhas: total, colunasAusentes: [...ausentes] };
}

/** O funil que a dashboard desenha, já somado no período. */
export type FunilPlanilha = {
  degraus: Array<{ rotulo: string; cor: string; valor: number }>;
  desvios: Array<{ rotulo: string; apos: number; tom: 'ruim' | 'neutro' | 'bom'; valor: number }>;
};

export function montarFunilPlanilha(cfg: ConfigFunilPlanilha, somasEtapa: number[], somasDesvio: number[]): FunilPlanilha {
  return {
    degraus: cfg.etapas.map((e, i) => ({ rotulo: e.rotulo, cor: e.cor, valor: somasEtapa[i] ?? 0 })),
    desvios: cfg.desvios.map((d, i) => ({ rotulo: d.rotulo, apos: d.apos, tom: d.tom, valor: somasDesvio[i] ?? 0 })),
  };
}
