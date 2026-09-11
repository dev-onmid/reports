/**
 * Resumo diário de tráfego — a régua e o texto dos 3 resumos (LEADS, VENDA,
 * GOOGLE) que saem todo dia no grupo do WhatsApp.
 *
 * Pura e client-safe: sem banco, sem fetch, sem `Date.now()`. A busca vive na
 * rota; aqui só entra dado já coletado. Mesmo desenho de `resumo-dia.ts`.
 *
 * ─── As duas réguas (decisão do Matheus, 09-11/09/2026) ───────────────────
 * CPL .............. comparado à meta do PRÓPRIO cliente (client_planning).
 *                    Sem teto global — cada cliente tem a sua.
 * Custo por compra .. teto FIXO de R$ 12,00, igual para todos. ROI > 10x salva.
 *
 * ⚠️ As duas são independentes: custo por lead e custo por compra são coisas
 * diferentes e nunca compartilham régua.
 */

export const TETO_CUSTO_COMPRA = 12;
export const ROI_QUE_SALVA = 10;
/** Acima da meta até este fator = atenção; acima disso = fora. */
const FATOR_ATENCAO = 1.5;

export type TipoCampanha = 'lead' | 'venda' | 'trafego' | 'branding' | 'engajamento';
export type Status = 'ok' | 'atencao' | 'fora' | 'sem_meta' | 'sem_resultado';

export type CampanhaDia = {
  dia: string;              // YYYY-MM-DD
  nome: string;
  objetivo?: string | null; // Meta
  canal?: string | null;    // Google (advertising_channel_type)
  gasto: number;
  resultados: number;       // leads + conversas (Meta) OU conversões (Google)
  compras: number;
  receita: number;
  cliques: number;
  alcance: number;
  impressoes: number;
};

export type ContaDiaria = {
  clientId: string;
  nome: string;
  cplMeta: number | null;
  tipoDashboard: string | null;
  accountId: string;
  campanhas: CampanhaDia[];
};

// ─── Classificação da campanha ────────────────────────────────────────────

const semAcento = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * ⚠️ `[ENGAJAMENTO]` NÃO entra como marcador de branding, de propósito. Nesta
 * carteira ele nomeia o OBJETIVO da Meta — é assim que campanha de conversa no
 * WhatsApp é criada — e não a finalidade: das 21 campanhas com esse marcador, a
 * maioria produz conversa ("[ENGAJAMENTO] [WHATSAPP]" gerou 10, "[ENGAJAMENTO]
 * [DELIVERY]" gerou 25 e 2 compras). Tratá-lo como branding tirava clínica
 * inteira do radar de lead.
 *
 * ⚠️ LEAD é testado ANTES de VENDA porque existe "[FORMS] [DIRETO] [JUNH]
 * [VENDA] #3" — ali o [VENDA] é o assunto do anúncio, não o objetivo.
 */
const MARCADORES: Array<[TipoCampanha, RegExp]> = [
  ['lead', /\b(FORMS?|FORMULARIOS?|LEADS?|WPP|WHATS|WHATSAPP|ENG\/WPP|CONVERSAS?|MENSAJES|MENSAGENS?|MSG)\b/],
  ['venda', /\b(VENDAS?|COMPRAS?|CARDAPIO|CARDAPIO_WEB|ANOTA AI|PRATO-DIGITAL|CATALOGO)\b/],
  ['trafego', /\b(TRAFEGO|TRAF|CLICKS)\b/],
  ['branding', /\b(ALCANCE|BRANDING|VIEW|YT|VISITAS AO PERFIL|CRESCIMENTO DE SEGUIDORES|SEGUIDORES)\b/],
];

/** "MAX-CLICKS" é estratégia de lance, não finalidade — não pode virar tráfego. */
const RUIDO_NO_NOME = /MAX-CLICKS/g;

export function tipoPeloNome(nome: string): TipoCampanha | null {
  const n = semAcento(nome).replace(RUIDO_NO_NOME, '');
  for (const [tipo, re] of MARCADORES) if (re.test(n)) return tipo;
  return null;
}

function tipoPeloObjetivoMeta(objetivo: string | null | undefined): TipoCampanha | null {
  const o = semAcento(objetivo);
  if (/OUTCOME_SALES|CONVERSIONS|PRODUCT_CATALOG_SALES|CATALOG/.test(o)) return 'venda';
  if (/OUTCOME_LEADS|LEAD_GENERATION|MESSAGES/.test(o)) return 'lead';
  if (/OUTCOME_TRAFFIC|LINK_CLICKS|TRAFFIC/.test(o)) return 'trafego';
  if (/OUTCOME_AWARENESS|BRAND_AWARENESS|REACH|VIDEO_VIEWS/.test(o)) return 'branding';
  return null; // OUTCOME_ENGAGEMENT cai aqui de propósito: é ambíguo
}

function tipoPeloCanalGoogle(canal: string | null | undefined): TipoCampanha | null {
  const c = semAcento(canal);
  if (/DISPLAY|VIDEO|DEMAND_GEN|DISCOVERY/.test(c)) return 'branding';
  if (/SEARCH|PERFORMANCE_MAX|SHOPPING|MULTI_CHANNEL/.test(c)) return 'lead';
  return null;
}

/** Cadeia Meta: NOME → OBJETIVO → COMPORTAMENTO. */
export function classificarMeta(
  nome: string, objetivo: string | null | undefined, resultados: number, compras: number,
): TipoCampanha {
  return tipoPeloNome(nome)
    ?? tipoPeloObjetivoMeta(objetivo)
    ?? (compras > 0 ? 'venda' : resultados > 0 ? 'lead' : 'engajamento');
}

/**
 * Cadeia Google: CANAL → NOME → COMPORTAMENTO.
 *
 * ⚠️ Aqui o canal vem ANTES do nome, o inverso do Meta. O canal do Google é
 * estrutural e não é ambíguo (Search sempre atende intenção de busca), enquanto
 * o marcador no nome frequentemente descreve a estratégia de lance — deixar o
 * nome mandar tirava do radar campanhas como "[TRÁFEGO] [SEARCH] [IMPLANTES]"
 * (R$ 99,90 por 1 conversão). No Google, "lead" é o balde de performance.
 */
export function classificarGoogle(
  nome: string, canal: string | null | undefined, conversoes: number,
): TipoCampanha {
  const porCanal = tipoPeloCanalGoogle(canal);
  if (porCanal) return porCanal;
  const porNome = tipoPeloNome(nome);
  if (porNome) return porNome === 'venda' ? 'lead' : porNome;
  return conversoes > 0 ? 'lead' : 'branding';
}

// ─── Agregação ────────────────────────────────────────────────────────────

export type Balde = {
  gasto: number; resultados: number; compras: number; receita: number;
  cliques: number; alcance: number; impressoes: number; campanhas: CampanhaDia[];
};
const baldeVazio = (): Balde => ({
  gasto: 0, resultados: 0, compras: 0, receita: 0, cliques: 0, alcance: 0, impressoes: 0, campanhas: [],
});
export const BALDE_VAZIO: Readonly<Balde> = Object.freeze(baldeVazio());

const TIPOS: TipoCampanha[] = ['lead', 'venda', 'trafego', 'branding', 'engajamento'];

/**
 * Agrupa as campanhas por dia e por tipo.
 *
 * ⚠️ A classificação é decidida por CAMPANHA na janela inteira, nunca por dia:
 * campanha de conversa que teve um dia sem conversa seria rotulada
 * "engajamento" naquele dia e escaparia do radar.
 */
export function agruparPorTipo(
  conta: ContaDiaria,
  classificar: (c: { nome: string; objetivo?: string | null; canal?: string | null; resultados: number; compras: number }) => TipoCampanha,
): Record<string, Record<TipoCampanha, Balde>> {
  const janela = new Map<string, { objetivo?: string | null; canal?: string | null; resultados: number; compras: number }>();
  for (const k of conta.campanhas) {
    const g = janela.get(k.nome) ?? { objetivo: k.objetivo, canal: k.canal, resultados: 0, compras: 0 };
    g.resultados += k.resultados; g.compras += k.compras;
    janela.set(k.nome, g);
  }
  const tipoDe = new Map<string, TipoCampanha>();
  for (const [nome, g] of janela) tipoDe.set(nome, classificar({ nome, ...g }));

  const porDia: Record<string, Record<TipoCampanha, Balde>> = {};
  for (const k of conta.campanhas) {
    porDia[k.dia] ??= Object.fromEntries(TIPOS.map(t => [t, baldeVazio()])) as Record<TipoCampanha, Balde>;
    const b = porDia[k.dia][tipoDe.get(k.nome)!];
    b.gasto += k.gasto; b.resultados += k.resultados; b.compras += k.compras;
    b.receita += k.receita; b.cliques += k.cliques; b.alcance += k.alcance; b.impressoes += k.impressoes;
    if (k.gasto > 0) b.campanhas.push(k);
  }
  return porDia;
}

export function baldeDo(
  porDia: Record<string, Record<TipoCampanha, Balde>>, dia: string, tipo: TipoCampanha,
): Balde {
  return porDia[dia]?.[tipo] ?? (BALDE_VAZIO as Balde);
}

// ─── Janela do relatório ──────────────────────────────────────────────────

/** Intervalo fechado de dias, em ISO. Um único dia tem inicio === fim. */
export type Periodo = { inicio: string; fim: string };

const DIA_MS = 86_400_000;
/** Meio-dia UTC evita que horário de verão empurre a data para o dia vizinho. */
const aoMeioDia = (iso: string) => new Date(`${iso}T12:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);
export const somarDias = (iso: string, n: number) => paraIso(new Date(aoMeioDia(iso).getTime() + n * DIA_MS));
/** 0 = domingo … 6 = sábado. */
export const diaDaSemana = (iso: string) => aoMeioDia(iso).getUTCDay();

export type Janela = {
  enviar: boolean;
  tipo: 'diario' | 'semanal' | 'nenhum';
  atual: Periodo;
  anterior: Periodo;
};

/**
 * Decide o que o relatório de hoje cobre (pedido do Matheus, 11/09/2026):
 *
 * - sábado e domingo ....... não envia nada
 * - segunda ................ a SEMANA ANTERIOR INTEIRA (segunda a domingo),
 *                            comparada com a semana antes dela
 * - terça a sexta .......... o dia anterior, comparado com o dia antes dele
 *
 * ⚠️ Na segunda o dia anterior seria domingo — dia de comportamento atípico e
 * que ninguém acompanhou desde sexta. A janela semanal existe por isso.
 */
export function decidirJanela(hoje: string): Janela {
  const dow = diaDaSemana(hoje);
  if (dow === 0 || dow === 6) {
    const vazio = { inicio: hoje, fim: hoje };
    return { enviar: false, tipo: 'nenhum', atual: vazio, anterior: vazio };
  }
  if (dow === 1) {
    return {
      enviar: true, tipo: 'semanal',
      atual: { inicio: somarDias(hoje, -7), fim: somarDias(hoje, -1) },
      anterior: { inicio: somarDias(hoje, -14), fim: somarDias(hoje, -8) },
    };
  }
  return {
    enviar: true, tipo: 'diario',
    atual: { inicio: somarDias(hoje, -1), fim: somarDias(hoje, -1) },
    anterior: { inicio: somarDias(hoje, -2), fim: somarDias(hoje, -2) },
  };
}

/** Todos os dias ISO do período, inclusive as pontas. */
export function diasDo(p: Periodo): string[] {
  const out: string[] = [];
  for (let d = p.inicio; d <= p.fim; d = somarDias(d, 1)) out.push(d);
  return out;
}

/** Soma os baldes de um tipo ao longo do período inteiro. */
export function baldeDoPeriodo(
  porDia: Record<string, Record<TipoCampanha, Balde>>, p: Periodo, tipo: TipoCampanha,
): Balde {
  const total = baldeVazio();
  for (const dia of diasDo(p)) {
    const b = porDia[dia]?.[tipo];
    if (!b) continue;
    total.gasto += b.gasto; total.resultados += b.resultados; total.compras += b.compras;
    total.receita += b.receita; total.cliques += b.cliques; total.alcance += b.alcance;
    total.impressoes += b.impressoes;
    total.campanhas.push(...b.campanhas);
  }
  return total;
}

/**
 * Junta as linhas diárias da MESMA campanha.
 *
 * ⚠️ Obrigatório na janela semanal: sem isso, campanha que ficou um dia sem
 * resultado entraria no radar de "gastou e não entregou" mesmo tendo entregado
 * nos outros seis.
 */
export function agregarCampanhas(b: Balde): Array<{ nome: string; gasto: number; resultados: number; cliques: number }> {
  const porNome = new Map<string, { nome: string; gasto: number; resultados: number; cliques: number }>();
  for (const k of b.campanhas) {
    const g = porNome.get(k.nome) ?? { nome: k.nome, gasto: 0, resultados: 0, cliques: 0 };
    g.gasto += k.gasto; g.resultados += k.resultados; g.cliques += k.cliques;
    porNome.set(k.nome, g);
  }
  return [...porNome.values()];
}

// ─── Régua ────────────────────────────────────────────────────────────────

export function statusCpl(cpl: number | null, meta: number | null): Status {
  if (cpl === null) return 'sem_resultado';
  if (meta === null || meta <= 0) return 'sem_meta';
  if (cpl <= meta) return 'ok';
  return cpl <= meta * FATOR_ATENCAO ? 'atencao' : 'fora';
}

/** Teto global. ROI acima de 10x salva um custo alto — decisão de negócio. */
export function statusCustoCompra(custo: number | null, roi: number): Status {
  if (custo === null) return 'sem_resultado';
  if (custo <= TETO_CUSTO_COMPRA) return 'ok';
  return roi > ROI_QUE_SALVA ? 'ok' : 'fora';
}

export const EMOJI: Record<Status, string> = {
  ok: '✅', atencao: '🟡', fora: '🔴', sem_meta: 'ℹ️', sem_resultado: '⚠️',
};

// ─── Texto ────────────────────────────────────────────────────────────────

const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
const inteiro = (n: number) => n.toLocaleString('pt-BR');
const div = (a: number, b: number) => (b > 0 ? a / b : null);

/**
 * ⚠️ O relatório NUNCA diz "ontem" nem "hoje": ele já é de um dia passado, e a
 * palavra relativa não tem âncora para quem lê. Sempre a data literal.
 * `guardDataRelativa` é a trava que impede isso de voltar.
 */
export function contemDataRelativa(texto: string): boolean {
  return /\bontem\b|\bhoje\b|\bamanh[ãa]\b/i.test(texto);
}

const curto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Rotula 'YYYY-MM-DD' como "quinta-feira, 10/09" sem depender de fuso. */
export function rotularDia(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  const semana = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${semana}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/** "quinta-feira, 10/09" para um dia; "07/09 a 13/09 (7 dias)" para um intervalo. */
export function rotularPeriodo(p: Periodo): string {
  if (p.inicio === p.fim) return rotularDia(p.inicio);
  return `${curto(p.inicio)} a ${curto(p.fim)} (${diasDo(p).length} dias)`;
}
/** Rótulo enxuto usado no meio da frase: "09/09" ou "31/08–06/09". */
export function rotuloCurto(p: Periodo): string {
  return p.inicio === p.fim ? curto(p.inicio) : `${curto(p.inicio)}–${curto(p.fim)}`;
}

function cabecalho(atual: Periodo, anterior: Periodo): string {
  return [
    `📅 *Dados de:* ${rotularPeriodo(atual)}`,
    `📅 *Comparados com:* ${rotularPeriodo(anterior)}`,
    '',
    '━━━━━━━━━━━',
    '✅ dentro da meta',
    '🟡 até 50% acima da meta',
    '🔴 mais de 50% acima da meta',
    '━━━━━━━━━━━',
  ].join('\n');
}

export type LinhaLead = {
  nome: string; cpl: number | null; meta: number | null; status: Status;
  resultados: number; resultadosAnterior: number; gasto: number;
};
export type LinhaVenda = {
  nome: string; custo: number | null; status: Status; compras: number;
  comprasAnterior: number; receita: number; roi: number; gasto: number; conversas: number;
};
export type LinhaSimples = { nome: string; gasto: number; cliques: number; alcance: number; impressoes: number; resultados: number };
export type LinhaDesperdicio = { nome: string; gasto: number; campanhas: number; cliques: number };

function blocoLeadDetalhado(l: LinhaLead, rotuloAnterior: string): string {
  const linhas = [
    `${EMOJI[l.status]} *${l.nome.toUpperCase()}*`,
    `Custo por lead: *R$ ${brl(l.cpl ?? 0)}*`,
  ];
  if (l.meta) {
    const desvio = ((l.cpl! - l.meta) / l.meta) * 100;
    linhas.push(`Meta: R$ ${brl(l.meta)} _(${pct(desvio)})_`);
  } else {
    linhas.push('Meta: _não cadastrada_');
  }
  linhas.push(`Quantidade de leads: *${l.resultados}*`);
  const variacao = l.resultadosAnterior > 0
    ? Math.round(((l.resultados - l.resultadosAnterior) / l.resultadosAnterior) * 100) : null;
  const queda = variacao === null ? ''
    : variacao === 0 ? ' _(igual)_'
    : ` _(${variacao > 0 ? 'subiu' : 'caiu'} ${Math.abs(variacao)}%)_`;
  linhas.push(`Leads em ${rotuloAnterior}: ${l.resultadosAnterior}${queda}`);
  linhas.push(`Investimento: R$ ${brl(l.gasto)}`);
  return linhas.join('\n');
}

const linhaCompacta = (l: LinhaLead) =>
  `• *${l.nome}* — R$ ${brl(l.cpl ?? 0)} · meta ${l.meta ? `R$ ${brl(l.meta)}` : '—'} · ${l.resultados}`;

export function montarResumoLeads(input: {
  atual: Periodo; anterior: Periodo;
  gasto: number; resultados: number; gastoAnterior: number; resultadosAnterior: number;
  linhas: LinhaLead[]; desperdicio: LinhaDesperdicio[];
}): string {
  const { atual, anterior } = input;
  const dm = rotuloCurto(anterior);
  const cpl = div(input.gasto, input.resultados);
  const cplAnt = div(input.gastoAnterior, input.resultadosAnterior);
  const p: string[] = ['🎯 *RESUMO LEADS — META ADS*', '', cabecalho(atual, anterior), '', '*VISÃO GERAL*',
    '_Somente campanhas de lead e conversa_',
    `Investimento: R$ ${brl(input.gasto)}`,
    `Quantidade de leads: *${input.resultados}*`,
    `_em ${dm} foram ${input.resultadosAnterior}_`,
    `Custo por lead: *R$ ${brl(cpl ?? 0)}*`];
  if (cpl !== null && cplAnt !== null) {
    const v = ((cpl - cplAnt) / cplAnt) * 100;
    p.push(`_em ${dm} foi R$ ${brl(cplAnt)} → ${v <= 0 ? 'caiu' : 'subiu'} ${Math.abs(v).toFixed(0)}%_ ${v <= 0 ? '✅' : '🔴'}`);
  }

  const ordem = (s: Status) => (s === 'fora' ? 0 : s === 'atencao' ? 1 : 2);
  const fora = input.linhas.filter(l => l.status === 'fora').sort((a, b) => (b.cpl! / (b.meta || 1)) - (a.cpl! / (a.meta || 1)));
  const atencao = input.linhas.filter(l => l.status === 'atencao').sort((a, b) => (b.cpl! / (b.meta || 1)) - (a.cpl! / (a.meta || 1)));
  const ok = input.linhas.filter(l => ordem(l.status) === 2).sort((a, b) => (a.cpl ?? 0) - (b.cpl ?? 0));

  if (fora.length) {
    p.push('', '━━━━━━━━━━━', '🔴 *FORA DA META*', '');
    p.push(fora.map(l => blocoLeadDetalhado(l, dm)).join('\n\n'));
  }
  if (atencao.length) {
    p.push('', '━━━━━━━━━━━', '🟡 *ATENÇÃO*', '_custo por lead · meta · leads_', '');
    p.push(atencao.map(linhaCompacta).join('\n'));
  }
  if (ok.length) {
    p.push('', '━━━━━━━━━━━', '✅ *DENTRO DA META*', '_custo por lead · meta · leads_', '');
    p.push(ok.map(linhaCompacta).join('\n'));
  }
  if (input.desperdicio.length) {
    const total = input.desperdicio.reduce((s, x) => s + x.gasto, 0);
    p.push('', '━━━━━━━━━━━', '⚠️ *CAMPANHA DE LEAD QUE GASTOU E NÃO ENTREGOU*', '');
    p.push(input.desperdicio.map(x => `• *${x.nome}* — R$ ${brl(x.gasto)} · ${x.campanhas} camp · ${x.cliques} cliques`).join('\n'));
    p.push(`*Total: R$ ${brl(total)}*`);
  }
  return p.join('\n');
}

export function montarResumoVenda(input: {
  atual: Periodo; anterior: Periodo;
  gasto: number; compras: number; receita: number;
  gastoAnterior: number; comprasAnterior: number; receitaAnterior: number;
  linhas: LinhaVenda[]; semCompra: LinhaVenda[];
  trafego: LinhaSimples[]; branding: LinhaSimples[]; engajamento: LinhaSimples[];
}): string {
  const { atual, anterior } = input;
  const dm = rotuloCurto(anterior);
  const custo = div(input.gasto, input.compras);
  const custoAnt = div(input.gastoAnterior, input.comprasAnterior);
  const p: string[] = ['🛒 *RESUMO VENDA — META ADS*', '', cabecalho(atual, anterior),
    `Teto de custo por compra: *R$ ${brl(TETO_CUSTO_COMPRA)}*`, '', '*VISÃO GERAL*',
    `Investimento: R$ ${brl(input.gasto)}`,
    `Quantidade de compras: *${input.compras}*`,
    `_em ${dm} foram ${input.comprasAnterior}_`,
    `Custo por compra: *R$ ${brl(custo ?? 0)}*`,
    custoAnt !== null ? `_em ${dm} foi R$ ${brl(custoAnt)}_` : `_em ${dm} não houve compra_`,
    `Valor de venda: *R$ ${brl(input.receita)}*`,
    `_em ${dm} foi R$ ${brl(input.receitaAnterior)}_`];

  for (const l of input.linhas) {
    const desvio = l.custo! > TETO_CUSTO_COMPRA ? ` _(${pct(((l.custo! - TETO_CUSTO_COMPRA) / TETO_CUSTO_COMPRA) * 100)})_` : ' → _dentro_';
    p.push('', '━━━━━━━━━━━', '', `${EMOJI[l.status]} *${l.nome.toUpperCase()}*`,
      `Custo por compra: *R$ ${brl(l.custo!)}*`,
      `Teto: R$ ${brl(TETO_CUSTO_COMPRA)}${desvio}`,
      `Quantidade de compras: *${l.compras}*`,
      `Compras em ${dm}: ${l.comprasAnterior}`,
      `Valor de venda: *R$ ${brl(l.receita)}*`,
      `Retorno: ${l.roi.toFixed(1)}x`,
      `Investimento: R$ ${brl(l.gasto)}`);
    if (l.conversas > 0) p.push(`_Também gerou ${l.conversas} conversas._`);
  }

  if (input.semCompra.length) {
    const total = input.semCompra.reduce((s, x) => s + x.gasto, 0);
    p.push('', '━━━━━━━━━━━', '⚠️ *CAMPANHA DE VENDA SEM NENHUMA COMPRA*', '');
    p.push(input.semCompra.map(x => `• *${x.nome}* — R$ ${brl(x.gasto)}${x.conversas ? ` _(gerou ${x.conversas} conversas)_` : ''}`).join('\n'));
    p.push(`*Total: R$ ${brl(total)}*`);
  }

  const secoes: Array<[string, LinhaSimples[], 'cpc' | 'alcance']> = [
    ['TRÁFEGO', input.trafego, 'cpc'], ['ALCANCE', input.branding, 'alcance'], ['ENGAJAMENTO', input.engajamento, 'alcance'],
  ];
  const temExtra = secoes.some(([, l]) => l.length);
  if (temExtra) p.push('', '━━━━━━━━━━━', '📊 *O QUE NÃO ENTRA NO RADAR DE LEAD NEM DE VENDA*');
  for (const [titulo, linhas, metrica] of secoes) {
    if (!linhas.length) continue;
    const soma = linhas.reduce((s, x) => s + x.gasto, 0);
    const extra = metrica === 'cpc' ? ` · ${inteiro(linhas.reduce((s, x) => s + x.cliques, 0))} cliques` : '';
    p.push('', `*${titulo} — R$ ${brl(soma)}${extra}*`);
    p.push(linhas.map(x => metrica === 'cpc'
      ? `• ${x.nome} — R$ ${brl(x.gasto)} · ${inteiro(x.cliques)} cliques · CPC R$ ${brl(div(x.gasto, x.cliques) ?? 0)}`
      : `• ${x.nome} — R$ ${brl(x.gasto)} · ${x.alcance.toLocaleString('pt-BR')} pessoas`).join('\n'));
  }
  return p.join('\n');
}

export function montarResumoGoogle(input: {
  atual: Periodo; anterior: Periodo;
  gasto: number; conversoes: number; gastoAnterior: number; conversoesAnterior: number;
  cplMediaMeta: number | null;
  linhas: LinhaLead[]; semConversao: LinhaSimples[]; branding: LinhaSimples[];
  totalMeta: number; totalGoogle: number;
}): string {
  const { atual, anterior } = input;
  const dm = rotuloCurto(anterior);
  const custo = div(input.gasto, input.conversoes);
  const custoAnt = div(input.gastoAnterior, input.conversoesAnterior);
  const p: string[] = ['🔍 *RESUMO GOOGLE ADS*', '', cabecalho(atual, anterior), '', '*VISÃO GERAL*',
    '_Somente Pesquisa e Performance Max_',
    `Investimento: *R$ ${brl(input.gasto)}*`,
    `_em ${dm} foi R$ ${brl(input.gastoAnterior)}_`,
    `Quantidade de conversões: *${input.conversoes.toFixed(1).replace('.', ',')}*`,
    `_em ${dm} foram ${input.conversoesAnterior.toFixed(1).replace('.', ',')}_`,
    `Custo por conversão: *R$ ${brl(custo ?? 0)}*`];
  if (custo !== null && custoAnt !== null) {
    const v = ((custo - custoAnt) / custoAnt) * 100;
    p.push(`_em ${dm} foi R$ ${brl(custoAnt)} → ${v <= 0 ? 'caiu' : 'subiu'} ${Math.abs(v).toFixed(0)}%_ ${v <= 0 ? '✅' : '🔴'}`);
  }
  if (input.cplMediaMeta && custo) {
    p.push('', `📌 _Comparação:_`, `_Meta: R$ ${brl(input.cplMediaMeta)} por lead_`,
      `_Google: R$ ${brl(custo)} por conversão_`,
      `_O Google está ${(custo / input.cplMediaMeta).toFixed(1)}x mais caro._`);
  }

  const bloco = (l: LinhaLead) => {
    const desvio = l.meta ? ` _(${pct(((l.cpl! - l.meta) / l.meta) * 100)})_` : '';
    return [`• *${l.nome}*`, `  R$ ${brl(l.cpl!)} · meta ${l.meta ? `R$ ${brl(l.meta)}` : '—'}${desvio}`,
      `  ${l.resultados.toFixed(1).replace('.', ',')} conv · investiu R$ ${brl(l.gasto)}`].join('\n');
  };
  for (const [titulo, st] of [['🔴 *FORA DA META*', 'fora'], ['🟡 *ATENÇÃO*', 'atencao'], ['✅ *DENTRO DA META*', 'ok']] as const) {
    const lista = input.linhas.filter(l => l.status === st)
      .sort((a, b) => (b.cpl! / (b.meta || 1)) - (a.cpl! / (a.meta || 1)));
    if (!lista.length) continue;
    p.push('', '━━━━━━━━━━━', titulo, '_custo por conversão · meta · conversões · investimento_', '');
    p.push(lista.map(bloco).join('\n'));
  }
  if (input.semConversao.length) {
    const total = input.semConversao.reduce((s, x) => s + x.gasto, 0);
    p.push('', '━━━━━━━━━━━', '⚠️ *GASTARAM E NÃO CONVERTERAM*', '');
    p.push(input.semConversao.map(x => `• ${x.nome} — R$ ${brl(x.gasto)}`).join('\n'));
    p.push(`*Total: R$ ${brl(total)}*`);
  }
  if (input.branding.length) {
    const total = input.branding.reduce((s, x) => s + x.gasto, 0);
    p.push('', '━━━━━━━━━━━', '📊 *FORA DO RADAR DE CONVERSÃO*',
      `*VÍDEO E DISPLAY — R$ ${brl(total)}*`);
    p.push(input.branding.map(x => `• ${x.nome} — R$ ${brl(x.gasto)} · ${inteiro(x.cliques)} cliques`).join('\n'));
    p.push('_Campanha de vídeo constrói lembrança, não converte._');
  }
  p.push('', '━━━━━━━━━━━', `💰 *INVESTIMENTO TOTAL DE ${rotuloCurto(atual)}*`,
    `Meta Ads: R$ ${brl(input.totalMeta)}`,
    `Google Ads: R$ ${brl(input.totalGoogle)}`,
    `*Total: R$ ${brl(input.totalMeta + input.totalGoogle)}*`);
  return p.join('\n');
}
