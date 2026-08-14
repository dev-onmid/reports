/**
 * Rotina semanal de saneamento de TERMOS DE PESQUISA do Google Ads.
 *
 * Fluxo: lê os termos reais de 30 dias → pré-filtra sem IA (barato) → a IA
 * classifica o resto → as decisões passam por travas DURAS aqui → aplica na
 * conta e grava no Histórico do cliente.
 *
 * Modo de operação escolhido pelo Matheus: APLICA SOZINHA (negativas e keywords
 * novas). Por isso as travas deste arquivo não são cosméticas — são o que separa
 * "rotina útil" de "IA gastando o orçamento do cliente". Tudo aqui é PURO
 * (client-safe, sem pg/rede) pra ser testável de verdade.
 */

export type TermoBruto = {
  termo: string;
  /** search_term_view.status: ADDED/EXCLUDED/ADDED_EXCLUDED = já tratado. */
  situacao?: string;
  campaignId: string;
  campanha?: string;
  adGroupId: string;
  grupo?: string;
  impressoes: number;
  cliques: number;
  gasto: number;
  conversoes: number;
};

export type DecisaoIa = {
  termo: string;
  decisao: 'negativar' | 'promover' | 'ignorar';
  motivo: string;
};

export type AcaoNegativar = { termo: string; campaignId: string; motivo: string };
export type AcaoPromover = { termo: string; campaignId: string; adGroupId: string; motivo: string };

export type PlanoAplicacao = {
  negativar: AcaoNegativar[];
  promover: AcaoPromover[];
  recusadas: Array<{ termo: string; decisao: string; motivo: string }>;
};

/** Gasto mínimo no período pra um termo valer análise (abaixo disso é ruído). */
export const GASTO_MINIMO_ANALISE = 5;
/** Tetos por rodada e por conta — nenhuma rodada pode virar uma reforma. */
export const MAX_NEGATIVAS_RODADA = 25;
export const MAX_KEYWORDS_RODADA = 5;
/** Cliques mínimos pra promover um termo SEM conversão a palavra-chave paga. */
export const CLIQUES_MINIMOS_PROMOVER = 10;

export function normalizarTermo(s: string): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Palavras da keyword, sem acento — base do casamento de correspondência de frase. */
function palavras(s: string): string[] {
  return normalizarTermo(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(' ').filter(Boolean);
}

/**
 * ⚠️ TRAVA MAIS IMPORTANTE DA ROTINA. Negativa em correspondência de FRASE
 * bloqueia toda busca que CONTENHA aquela sequência — negativar "dentista"
 * mataria a keyword "dentista florianopolis" e a conta pararia de entregar em
 * silêncio. Verdadeiro quando a negativa é subsequência de alguma keyword ativa.
 */
export function negativaConflitaComKeyword(negativa: string, keywordsAtivas: string[]): boolean {
  const neg = palavras(negativa);
  if (neg.length === 0) return true; // negativa vazia: bloqueia tudo, nunca aplicar
  return keywordsAtivas.some((kw) => {
    const alvo = palavras(kw);
    if (neg.length > alvo.length) return false;
    for (let i = 0; i + neg.length <= alvo.length; i++) {
      if (neg.every((p, j) => alvo[i + j] === p)) return true;
    }
    return false;
  });
}

/**
 * Pré-filtro SEM IA: só chega na IA o que pode virar decisão. Tira o que o
 * Google já marcou como tratado (ADDED/EXCLUDED), o que não gastou o suficiente
 * e duplicatas do mesmo termo (soma as métricas entre grupos, fica com o de
 * maior gasto como origem).
 */
export function filtrarTermosParaAnalise(
  termos: TermoBruto[],
  opts: { gastoMinimo?: number; teto?: number } = {},
): TermoBruto[] {
  const gastoMinimo = opts.gastoMinimo ?? GASTO_MINIMO_ANALISE;
  const teto = opts.teto ?? 80;
  const porTermo = new Map<string, TermoBruto>();
  for (const t of termos) {
    const chave = normalizarTermo(t.termo);
    if (!chave) continue;
    const situacao = String(t.situacao ?? '').toUpperCase();
    if (situacao.includes('ADDED') || situacao.includes('EXCLUDED')) continue;
    const atual = porTermo.get(chave);
    if (!atual) { porTermo.set(chave, { ...t, termo: chave }); continue; }
    const somado: TermoBruto = {
      ...(t.gasto > atual.gasto ? { ...t, termo: chave } : atual),
      impressoes: atual.impressoes + t.impressoes,
      cliques: atual.cliques + t.cliques,
      gasto: atual.gasto + t.gasto,
      conversoes: atual.conversoes + t.conversoes,
    };
    porTermo.set(chave, somado);
  }
  return [...porTermo.values()]
    .filter((t) => t.gasto >= gastoMinimo || t.conversoes > 0)
    .sort((a, b) => b.gasto - a.gasto)
    .slice(0, teto);
}

/**
 * Aplica as travas sobre o que a IA decidiu. Recusa (com motivo legível, que vai
 * pro relatório) tudo que: não existe no lote analisado, é negativa que
 * conflita com keyword ativa, é promoção sem sinal de resultado, ou passa dos
 * tetos da rodada. NUNCA confia na decisão da IA sem passar por aqui.
 */
export function planejarAplicacao(
  decisoes: DecisaoIa[],
  analisados: TermoBruto[],
  keywordsAtivas: string[],
  opts: { maxNegativas?: number; maxKeywords?: number; cliquesMinimos?: number } = {},
): PlanoAplicacao {
  const maxNeg = opts.maxNegativas ?? MAX_NEGATIVAS_RODADA;
  const maxKw = opts.maxKeywords ?? MAX_KEYWORDS_RODADA;
  const cliquesMin = opts.cliquesMinimos ?? CLIQUES_MINIMOS_PROMOVER;
  const porTermo = new Map(analisados.map((t) => [normalizarTermo(t.termo), t]));
  const ativas = new Set(keywordsAtivas.map(normalizarTermo));

  const negativar: AcaoNegativar[] = [];
  const promover: AcaoPromover[] = [];
  const recusadas: PlanoAplicacao['recusadas'] = [];
  const vistos = new Set<string>();

  // Promoção primeiro: com o mesmo termo em duas decisões, "vira keyword" perde
  // pra "negativar" nunca — mas o dedupe abaixo garante uma decisão por termo.
  for (const d of decisoes) {
    const chave = normalizarTermo(d.termo);
    const base = porTermo.get(chave);
    const motivo = String(d.motivo ?? '').trim() || 'sem motivo informado';
    if (!chave) continue;
    if (vistos.has(chave)) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: 'termo repetido na resposta da IA' }); continue; }
    vistos.add(chave);
    if (!base) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: 'termo não estava no lote analisado (IA inventou)' }); continue; }
    if (d.decisao === 'ignorar') continue;

    if (d.decisao === 'negativar') {
      if (ativas.has(chave)) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: 'é uma palavra-chave ATIVA da conta' }); continue; }
      if (negativaConflitaComKeyword(chave, keywordsAtivas)) {
        recusadas.push({ termo: chave, decisao: d.decisao, motivo: 'negativa em frase bloquearia keyword ativa da conta' });
        continue;
      }
      if (negativar.length >= maxNeg) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: `teto de ${maxNeg} negativas por rodada` }); continue; }
      negativar.push({ termo: chave, campaignId: base.campaignId, motivo });
      continue;
    }

    if (d.decisao === 'promover') {
      if (ativas.has(chave)) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: 'já é palavra-chave da conta' }); continue; }
      // Keyword nova GASTA dinheiro: só entra com sinal de resultado.
      if (base.conversoes <= 0 && base.cliques < cliquesMin) {
        recusadas.push({ termo: chave, decisao: d.decisao, motivo: `sem sinal suficiente (${base.conversoes} conversões, ${base.cliques} cliques — mínimo ${cliquesMin} cliques ou 1 conversão)` });
        continue;
      }
      if (promover.length >= maxKw) { recusadas.push({ termo: chave, decisao: d.decisao, motivo: `teto de ${maxKw} keywords novas por rodada` }); continue; }
      promover.push({ termo: chave, campaignId: base.campaignId, adGroupId: base.adGroupId, motivo });
      continue;
    }

    recusadas.push({ termo: chave, decisao: String(d.decisao), motivo: 'decisão desconhecida' });
  }
  return { negativar, promover, recusadas };
}

/** Aceita a resposta da IA em JSON (com ou sem cerca markdown) sem explodir. */
export function parseDecisoesIa(texto: string): DecisaoIa[] {
  const limpo = String(texto ?? '').replace(/```(?:json)?/gi, '').trim();
  const ini = limpo.indexOf('[');
  const fim = limpo.lastIndexOf(']');
  if (ini < 0 || fim <= ini) return [];
  try {
    const arr = JSON.parse(limpo.slice(ini, fim + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
      .map((x) => ({
        termo: String(x.termo ?? ''),
        decisao: (['negativar', 'promover', 'ignorar'] as const).includes(x.decisao as 'negativar')
          ? (x.decisao as DecisaoIa['decisao']) : 'ignorar',
        motivo: String(x.motivo ?? ''),
      }))
      .filter((d) => d.termo);
  } catch { return []; }
}

/** Texto do registro que vai pro Histórico do cliente (trilha entre gestores). */
export function resumoParaHistorico(
  plano: PlanoAplicacao,
  aplicado: { negativadas: number; promovidas: number },
  periodo: { dias: number; gastoAnalisado: number },
): string {
  const linhas: string[] = [
    `Saneamento automático de termos de pesquisa (últimos ${periodo.dias} dias, R$ ${periodo.gastoAnalisado.toFixed(2)} analisados).`,
  ];
  if (aplicado.negativadas > 0) {
    linhas.push('', `Negativadas (${aplicado.negativadas}):`);
    plano.negativar.slice(0, 25).forEach((n) => linhas.push(`• ${n.termo} — ${n.motivo}`));
  }
  if (aplicado.promovidas > 0) {
    linhas.push('', `Promovidas a palavra-chave (${aplicado.promovidas}):`);
    plano.promover.forEach((p) => linhas.push(`• ${p.termo} — ${p.motivo}`));
  }
  if (plano.recusadas.length > 0) {
    linhas.push('', `Sugestões recusadas pelas travas (${plano.recusadas.length}):`);
    plano.recusadas.slice(0, 10).forEach((r) => linhas.push(`• ${r.termo} (${r.decisao}) — ${r.motivo}`));
  }
  if (aplicado.negativadas === 0 && aplicado.promovidas === 0) {
    linhas.push('', 'Nenhuma mudança aplicada — nada fora do padrão nos termos do período.');
  }
  return linhas.join('\n');
}

export const PROMPT_SISTEMA_TERMOS = `Você audita TERMOS DE PESQUISA reais de uma conta de Google Ads (o que as pessoas digitaram no Google antes de ver o anúncio).

Para CADA termo recebido, decida:
- "negativar": o termo NÃO tem relação com o que o cliente vende, OU é de outra cidade/região fora da área de atendimento, OU é busca informacional/gratuita ("como fazer", "grátis", "curso", "salário", "vaga", "concurso"), OU é busca por concorrente nomeado, OU busca por emprego/faculdade. Gasto sem retorno com termo irrelevante é desperdício.
- "promover": o termo é MUITO relevante, já trouxe resultado e ainda não é palavra-chave — vira palavra-chave própria para ganhar controle de lance.
- "ignorar": relevante mas sem sinal claro, ou você tem dúvida. NA DÚVIDA, IGNORE.

REGRAS DURAS:
1. Só responda sobre os termos que EU enviei. Nunca invente termo.
2. NUNCA negative um termo que descreve o produto/serviço principal do cliente, mesmo com custo alto — custo alto em termo relevante é problema de lance, não de relevância.
3. Cidade/bairro dentro da área de atendimento informada NÃO é motivo de negativa. Cidade fora dela é.
4. Motivo em UMA frase curta, factual, em português.

Responda APENAS um array JSON, sem texto em volta:
[{"termo":"...","decisao":"negativar|promover|ignorar","motivo":"..."}]`;
