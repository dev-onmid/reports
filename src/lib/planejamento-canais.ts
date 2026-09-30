/**
 * Divisão do INVESTIMENTO por canal, no planejamento do cliente.
 *
 * Nasceu de duas queixas do Matheus, nesta ordem:
 *
 * 1. O planejamento tinha UM CPL para a conta inteira, e "o canal varia muito —
 *    fica uma meta injusta". Google custa naturalmente mais que Meta; cobrar os
 *    dois pelo mesmo número premia um e pune o outro sem ninguém ter errado.
 *
 * 2. A primeira versão inverteu a direção da conta e ele recusou: "eu colocava o
 *    valor de investimento TOTAL, o CPL do lead e ia escolhendo quantos % seria
 *    destinado para cada canal, SEM MEXER no valor de investimento".
 *
 * Por isso a verba é a ÂNCORA, não um resultado: o gestor digita o total, e as
 * fatias só repartem esse mesmo dinheiro. Mexer em % nunca muda o total.
 */

export type CanalId = 'meta' | 'google' | 'tiktok';

export const CANAIS: ReadonlyArray<{ id: CanalId; nome: string; cor: string }> = [
  // Cores dos tokens documentados do DS. Verde (#55F52F) fica de fora de
  // propósito — é a cor de CTA/resultado, não de rótulo de canal.
  { id: 'meta',   nome: 'Meta',   cor: '#0B84FF' },
  { id: 'google', nome: 'Google', cor: '#FF6B35' },
  { id: 'tiktok', nome: 'TikTok', cor: '#7B2CFF' },
];

export function nomeDoCanal(id: CanalId): string {
  return CANAIS.find(c => c.id === id)?.nome ?? id;
}
export function corDoCanal(id: CanalId): string {
  return CANAIS.find(c => c.id === id)?.cor ?? '#94A3B8';
}

/** O que o gestor configura: a fatia da verba (%) e o CPL daquele canal. */
export type CanalPlano = { id: CanalId; share: number; cpl: number };

// ── Travas ────────────────────────────────────────────────────────────────────

/**
 * Reparte `alvo` entre os pesos, em INTEIROS que somam exatamente `alvo`
 * (maior resto — método de Hamilton). Arredondar cada um por conta própria
 * deixaria a soma em 99 ou 101 e a trava de 100% seria mentira.
 */
function repartir(pesos: number[], alvo: number): number[] {
  const n = pesos.length;
  if (n === 0) return [];
  const total = Math.max(0, Math.round(alvo));
  const soma = pesos.reduce((s, p) => s + Math.max(0, p), 0);
  const brutos = soma > 0
    ? pesos.map(p => (Math.max(0, p) * total) / soma)
    : pesos.map(() => total / n);
  const inteiros = brutos.map(v => Math.floor(v));
  let resto = total - inteiros.reduce((s, v) => s + v, 0);
  const ordem = brutos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; resto > 0 && k < ordem.length; k++, resto--) inteiros[ordem[k].i] += 1;
  return inteiros;
}

/** Devolve a lista com as fatias somando exatamente 100%, preservando a proporção. */
export function reequilibrar(canais: CanalPlano[]): CanalPlano[] {
  if (canais.length === 0) return [];
  const fatias = repartir(canais.map(c => c.share), 100);
  return canais.map((c, i) => ({ ...c, share: fatias[i] }));
}

/**
 * Sobe/desce a fatia de um canal e TIRA (ou devolve) a diferença dos outros,
 * proporcionalmente ao que cada um já tinha. É a trava que o Matheus descreveu:
 * "se eu colocasse 60% num canal, eu só podia por 40% no outro".
 */
export function ajustarShare(canais: CanalPlano[], id: CanalId, novoShare: number): CanalPlano[] {
  if (!canais.some(c => c.id === id)) return canais;
  const bruto = Number(novoShare);
  const alvo = Math.max(0, Math.min(100, Number.isFinite(bruto) ? Math.round(bruto) : 0));
  const outros = canais.filter(c => c.id !== id);
  // ⚠️ Canal sozinho leva 100%: não é escolha dele, é o que sobra da trava.
  if (outros.length === 0) return canais.map(c => ({ ...c, share: 100 }));
  const fatias = repartir(outros.map(c => c.share), 100 - alvo);
  let k = 0;
  return canais.map(c => (c.id === id ? { ...c, share: alvo } : { ...c, share: fatias[k++] }));
}

export function ajustarCpl(canais: CanalPlano[], id: CanalId, novoCpl: number): CanalPlano[] {
  const v = Number(novoCpl);
  const cpl = Number.isFinite(v) ? Math.max(0, v) : 0;
  return canais.map(c => (c.id === id ? { ...c, cpl } : c));
}

export function adicionarCanal(canais: CanalPlano[], id: CanalId, cplPadrao: number): CanalPlano[] {
  if (canais.some(c => c.id === id) || !CANAIS.some(c => c.id === id)) return canais;
  const v = Number(cplPadrao);
  const cpl = Number.isFinite(v) ? Math.max(0, v) : 0;
  // ⚠️ O primeiro canal nasce com 100% (é o único, a trava obriga); os seguintes
  // nascem em 0 para não desmontar uma divisão que o gestor já ajustou — ele
  // sobe a fatia e a trava tira dos outros.
  return [...canais, { id, share: canais.length === 0 ? 100 : 0, cpl }];
}

export function removerCanal(canais: CanalPlano[], id: CanalId): CanalPlano[] {
  const restantes = canais.filter(c => c.id !== id);
  if (restantes.length === canais.length) return canais;
  return reequilibrar(restantes);
}

/**
 * Lê o que veio do banco/localStorage. Sempre devolve fatias somando 100% —
 * inclusive quando a origem é uma versão anterior que permitia somar 90%.
 */
export function normalizarCanais(bruto: unknown): CanalPlano[] {
  if (!Array.isArray(bruto)) return [];
  const vistos = new Set<string>();
  const out: CanalPlano[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? '') as CanalId;
    if (!CANAIS.some(c => c.id === id) || vistos.has(id)) continue;
    vistos.add(id);
    const share = Number(o.share);
    const cpl = Number(o.cpl);
    out.push({
      id,
      share: Number.isFinite(share) ? Math.max(0, Math.min(100, share)) : 0,
      cpl: Number.isFinite(cpl) ? Math.max(0, cpl) : 0,
    });
  }
  return reequilibrar(out);
}

// ── Conta ─────────────────────────────────────────────────────────────────────

export type LinhaCanal = {
  id: CanalId;
  nome: string;
  cor: string;
  share: number;
  cpl: number;
  investimento: number;
  /** `null` quando o CPL é 0 — dividir por zero não é "infinitos leads". */
  leads: number | null;
  vendas: number | null;
  /** Investimento ÷ vendas do canal. `null` sem venda — nunca 0 nem Infinity. */
  cac: number | null;
  /** Quanto do faturamento planejado o canal consome. `null` sem meta. */
  pctFaturamento: number | null;
};

export type PlanoCanais = {
  linhas: LinhaCanal[];
  investimentoTotal: number;
  /** Quantos leads essa verba compra, somando os canais. */
  leadsComprados: number;
  /** Quantos leads o funil exige para bater a meta. */
  leadsNecessarios: number;
  faltamLeads: number;
  sobramLeads: number;
  /** leadsComprados ÷ leadsNecessarios. `null` quando o funil não pede lead nenhum. */
  cobertura: number | null;
  /** Média PONDERADA pela verba. `null` quando a verba não compra lead nenhum. */
  cplGeral: number | null;
  /** Verba que fecharia a conta no CPL geral atual. `null` sem CPL geral. */
  investimentoNecessario: number | null;
  /** Algum canal com fatia da verba e CPL zerado — a cobertura está subestimada. */
  semCpl: boolean;
};

export function calcularPlanoCanais(
  canais: CanalPlano[],
  investimentoTotal: number,
  leadsNecessarios: number,
  vendasNecessarias: number,
  metaFaturamento: number,
): PlanoCanais {
  const verba = Number.isFinite(investimentoTotal) ? Math.max(0, investimentoTotal) : 0;
  const necessarios = Number.isFinite(leadsNecessarios) ? Math.max(0, leadsNecessarios) : 0;
  // ⚠️ Mesma taxa de conversão do funil para todos os canais. A tela diz isso em
  // texto — supor calado venderia uma precisão que o dado não tem.
  const taxa = necessarios > 0 ? vendasNecessarias / necessarios : 0;

  const linhas: LinhaCanal[] = canais.map(c => {
    const investimento = (verba * c.share) / 100;
    const leads = c.cpl > 0 ? investimento / c.cpl : null;
    const vendas = leads === null ? null : leads * taxa;
    return {
      id: c.id,
      nome: nomeDoCanal(c.id),
      cor: corDoCanal(c.id),
      share: c.share,
      cpl: c.cpl,
      investimento,
      leads,
      vendas,
      cac: vendas !== null && vendas > 0 ? investimento / vendas : null,
      pctFaturamento: metaFaturamento > 0 ? investimento / metaFaturamento : null,
    };
  });

  const leadsComprados = linhas.reduce((s, l) => s + (l.leads ?? 0), 0);
  const cplGeral = leadsComprados > 0 ? verba / leadsComprados : null;

  return {
    linhas,
    investimentoTotal: verba,
    leadsComprados,
    leadsNecessarios: necessarios,
    faltamLeads: Math.max(0, necessarios - leadsComprados),
    sobramLeads: Math.max(0, leadsComprados - necessarios),
    cobertura: necessarios > 0 ? leadsComprados / necessarios : null,
    cplGeral,
    investimentoNecessario: cplGeral === null ? null : necessarios * cplGeral,
    semCpl: linhas.some(l => l.share > 0 && l.cpl <= 0),
  };
}
