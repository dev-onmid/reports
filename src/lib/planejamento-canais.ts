/**
 * Divisão do planejamento por CANAL.
 *
 * Nasceu de uma queixa concreta do Matheus: o planejamento tinha UM CPL para a
 * conta inteira, e "o canal varia muito — fica uma meta injusta". Google custa
 * naturalmente mais que Meta; cobrar os dois pelo mesmo número premia um e pune
 * o outro sem que ninguém tenha errado.
 *
 * Mantém a direção da tela (meta → funil → leads necessários) e só acrescenta
 * a pergunta "de onde vêm esses leads": cada canal leva uma fatia dos leads e
 * tem o SEU CPL. O investimento de cada um sai disso, e o CPL geral deixa de
 * ser digitado para ser derivado.
 */

export type CanalId = 'meta' | 'google' | 'tiktok';

export const CANAIS: ReadonlyArray<{ id: CanalId; nome: string }> = [
  { id: 'meta',   nome: 'Meta' },
  { id: 'google', nome: 'Google' },
  { id: 'tiktok', nome: 'TikTok' },
];

/** O que o gestor digita: fatia dos leads (em %) e o CPL daquele canal. */
export type CanalPlano = { id: CanalId; share: number; cpl: number };

export type LinhaCanal = {
  id: CanalId;
  nome: string;
  share: number;
  cpl: number;
  leads: number;
  investimento: number;
  vendas: number;
  /** Investimento ÷ vendas do canal. `null` sem venda — nunca 0 nem Infinity. */
  cac: number | null;
  /** Quanto do faturamento planejado o canal consome. `null` sem meta. */
  pctFaturamento: number | null;
};

export type PlanoCanais = {
  linhas: LinhaCanal[];
  somaShare: number;
  leadsAlocados: number;
  /** Leads que sobraram sem canal quando a soma não fecha 100%. */
  leadsSemCanal: number;
  investimentoTotal: number;
  /** Média PONDERADA. `null` quando não há lead alocado. */
  cplGeral: number | null;
  /** O plano está inteiro? Falso enquanto a soma não fecha 100%. */
  completo: boolean;
};

const arred = (n: number) => Math.round(n * 100) / 100;

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
  return out;
}

/**
 * ⚠️ NÃO normaliza as fatias para somar 100%.
 *
 * Se o gestor colocou 70% e 20%, os 10% que faltam viram `leadsSemCanal` e o
 * investimento sai VISIVELMENTE incompleto. Normalizar em silêncio (77,8% /
 * 22,2%) mudaria os números que ele digitou e faria a conta "fechar" mentindo —
 * mesma razão pela qual o donut de canais mostra `semAtribuicao` em vez de
 * diluir a sobra nas fatias conhecidas.
 */
export function calcularPlanoCanais(
  canais: CanalPlano[],
  totalLeads: number,
  totalVendas: number,
  metaFaturamento: number,
): PlanoCanais {
  const lista = canais.filter(c => c.share > 0);
  const somaShare = arred(lista.reduce((s, c) => s + c.share, 0));

  const linhas: LinhaCanal[] = lista.map(c => {
    const fatia = c.share / 100;
    const leads = totalLeads * fatia;
    // ⚠️ Vendas proporcionais à fatia de leads: o modelo supõe a MESMA taxa de
    // conversão do funil para todos os canais. A tela diz isso em texto — supor
    // calado seria vender uma precisão que o dado não tem.
    const vendas = totalVendas * fatia;
    const investimento = leads * c.cpl;
    return {
      id: c.id,
      nome: CANAIS.find(x => x.id === c.id)?.nome ?? c.id,
      share: c.share,
      cpl: c.cpl,
      leads,
      investimento,
      vendas,
      cac: vendas > 0 ? investimento / vendas : null,
      pctFaturamento: metaFaturamento > 0 ? investimento / metaFaturamento : null,
    };
  });

  const leadsAlocados = linhas.reduce((s, l) => s + l.leads, 0);
  const investimentoTotal = linhas.reduce((s, l) => s + l.investimento, 0);

  return {
    linhas,
    somaShare,
    leadsAlocados,
    leadsSemCanal: Math.max(0, totalLeads - leadsAlocados),
    investimentoTotal,
    // ⚠️ Média PONDERADA, nunca a média simples dos CPLs: com 90% em Meta a R$20
    // e 10% em Google a R$60, a simples daria R$40 e a verdadeira é R$24.
    cplGeral: leadsAlocados > 0 ? investimentoTotal / leadsAlocados : null,
    completo: Math.abs(somaShare - 100) < 0.01,
  };
}
