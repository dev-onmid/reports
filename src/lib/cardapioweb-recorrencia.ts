/**
 * Lógica PURA do funil de recorrência de delivery (Cardápio Web).
 *
 * A API do Cardápio Web NÃO fornece recorrência: `/merchant/customers` não traz
 * total de pedidos, valor gasto nem última compra. Tudo aqui é derivado dos
 * pedidos que persistimos.
 *
 * Regra de arquitetura: a ETAPA NUNCA É GRAVADA — é função dos fatos (pedidos)
 * contra a régua do cliente, calculada na leitura. Um funil manual mentiria
 * exatamente em quem parou de comprar, que é o que este módulo existe para
 * detectar. (Mesma razão de o painel do Início auto-resolver sinais.)
 *
 * Sem banco, sem fetch, sem Date.now(): o "agora" entra por parâmetro para o
 * teste ser determinístico.
 */

/**
 * Ordem = progressão de saúde, do melhor pro pior. É a ordem que a tela usa,
 * então `reconquistado` fica junto dos saudáveis (ele COMPROU recentemente) —
 * exibi-lo depois de `inativo` sugeriria que é a pior etapa.
 */
export const ETAPAS = ['novo', 'recorrente', 'reconquistado', 'em_risco', 'inativo'] as const;
export type Etapa = typeof ETAPAS[number];

export const ETAPA_LABEL: Record<Etapa, string> = {
  novo: 'Novo',
  recorrente: 'Recorrente',
  em_risco: 'Em risco',
  inativo: 'Inativo',
  reconquistado: 'Reconquistado',
};

/**
 * Régua POR CLIENTE: "em risco" numa pizzaria semanal não é "em risco" num
 * japonês mensal. Mesmo princípio do `red_after_days` do monitor social e do
 * `dias_antecedencia` do alerta de saldo.
 */
export type Regua = {
  /** Comprou há menos que isso = ativo (novo/recorrente/reconquistado). */
  janelaDias: number;
  /** Sem comprar há mais que isso = inativo. Entre a janela e isto = em risco. */
  inatividadeDias: number;
};

export const REGUA_PADRAO: Regua = { janelaDias: 30, inatividadeDias: 60 };

export function normalizarRegua(r?: Partial<Regua> | null): Regua {
  const janela = Math.max(1, Math.round(r?.janelaDias ?? REGUA_PADRAO.janelaDias));
  // Inatividade nunca menor que a janela — régua invertida classificaria
  // "inativo" quem ainda está dentro da janela de recorrência.
  const inatividade = Math.max(janela, Math.round(r?.inatividadeDias ?? REGUA_PADRAO.inatividadeDias));
  return { janelaDias: janela, inatividadeDias: inatividade };
}

/** Pedido mínimo que a classificação precisa (shape de `cardapioweb_orders`). */
export type PedidoLite = {
  /** ISO 8601 ou Date — o driver pg devolve Date. */
  created_at: string | Date;
  total: number;
  status: string;
  sales_channel: string | null;
};

/**
 * Cancelado não conta como compra: um cliente cujo único pedido foi cancelado
 * nunca comprou de fato — classificá-lo como "novo" mentiria pro lojista.
 */
export function pedidoValido(p: PedidoLite): boolean {
  return p.status !== 'canceled';
}

const DIA_MS = 86_400_000;

/**
 * Normaliza data vinda do banco.
 *
 * ⚠️ O driver `pg` devolve coluna `timestamptz` como objeto **Date**, não
 * string — e `Date` não tem `.localeCompare`, então ordenar direto lança
 * TypeError. Com a tabela vazia isso nunca acontecia, o que fez o defeito
 * passar por tsc, build e testes (que usam string, como o tipo declara) e só
 * aparecer na primeira loja com pedido de verdade.
 *
 * Aceitar os dois formatos aqui mata a classe inteira do problema, em vez de
 * depender de todo SQL futuro lembrar de converter.
 */
export function paraIso(v: string | Date | null | undefined): string {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  return String(v);
}

export function diasEntre(deIso: string, ateIso: string): number {
  const de = new Date(deIso).getTime();
  const ate = new Date(ateIso).getTime();
  if (!Number.isFinite(de) || !Number.isFinite(ate)) return NaN;
  return (ate - de) / DIA_MS;
}

/**
 * Classifica um cliente final pela sequência de datas de compra VÁLIDAS.
 *
 * - novo:          1 compra, dentro da janela
 * - recorrente:    2+ compras, última dentro da janela, sem gap de inatividade
 *                  imediatamente antes da última
 * - reconquistado: última compra dentro da janela, mas o intervalo entre ela e
 *                  a anterior foi >= inatividade — o cliente MORREU e voltou.
 *                  Não vira "recorrente" de imediato: apagar o fato do sumiço
 *                  esconderia exatamente o que a campanha de resgate precisa
 *                  medir. Volta a ser recorrente na PRÓXIMA compra.
 * - em_risco:      última compra entre a janela e o limite de inatividade
 * - inativo:       última compra além do limite (mesmo quem só comprou 1x —
 *                  "novo" é quem chegou AGORA, não quem apareceu uma vez há
 *                  seis meses)
 * - null:          nenhuma compra válida (só cancelados) — fora do funil
 */
export function classificarEtapa(datasComprasAsc: string[], regua: Regua, agoraIso: string): Etapa | null {
  if (datasComprasAsc.length === 0) return null;

  const ultima = datasComprasAsc[datasComprasAsc.length - 1];
  const diasDesdeUltima = diasEntre(ultima, agoraIso);
  if (!Number.isFinite(diasDesdeUltima)) return null;

  if (diasDesdeUltima >= regua.inatividadeDias) return 'inativo';
  if (diasDesdeUltima >= regua.janelaDias) return 'em_risco';

  // Dentro da janela.
  if (datasComprasAsc.length === 1) return 'novo';

  const penultima = datasComprasAsc[datasComprasAsc.length - 2];
  const gapAnterior = diasEntre(penultima, ultima);
  if (Number.isFinite(gapAnterior) && gapAnterior >= regua.inatividadeDias) return 'reconquistado';

  return 'recorrente';
}

// ---------------------------------------------------------------- Agregação

export type ClienteDelivery = {
  /** Chave de agrupamento: telefone normalizado, ou `id:<customer_id>` sem fone. */
  chave: string;
  nome: string | null;
  telefone: string | null;
  etapa: Etapa;
  pedidos: number;
  receita: number;
  ticketMedio: number;
  primeiraCompra: string;
  ultimaCompra: string;
  diasDesdeUltima: number;
  /** Mediana do intervalo entre compras, null com menos de 2 compras. */
  intervaloMedianoDias: number | null;
};

export type PedidoAgrupavel = PedidoLite & {
  customer_id: number | string | null;
  customer_name: string | null;
  customer_phone: string | null;
};

function mediana(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Agrupa pedidos por cliente final e classifica cada um.
 *
 * A identidade preferida é o TELEFONE normalizado, não o `customer.id` do
 * Cardápio Web: o telefone é o que casa com o CRM e sobrevive a recadastro.
 * Sem telefone, cai no id; sem os dois, o pedido não é atribuível a ninguém e
 * fica fora do funil (continua na receita total dos KPIs, que soma pedidos).
 */
export function agruparPorCliente(pedidos: PedidoAgrupavel[], regua: Regua, agoraIso: string): ClienteDelivery[] {
  const porChave = new Map<string, PedidoAgrupavel[]>();
  for (const p of pedidos) {
    if (!pedidoValido(p)) continue;
    const fone = normalizarTelefoneBR(p.customer_phone);
    const chave = fone ?? (p.customer_id != null && String(p.customer_id) !== '' ? `id:${p.customer_id}` : null);
    if (!chave) continue;
    const lista = porChave.get(chave);
    if (lista) lista.push(p); else porChave.set(chave, [p]);
  }

  const out: ClienteDelivery[] = [];
  for (const [chave, lista] of porChave) {
    // Normaliza ANTES de ordenar: `Date` não tem localeCompare.
    const datas = lista.map(p => paraIso(p.created_at)).sort((a, b) => a.localeCompare(b));
    const etapa = classificarEtapa(datas, regua, agoraIso);
    if (!etapa) continue;

    const receita = lista.reduce((s, p) => s + (Number(p.total) || 0), 0);
    const intervalos: number[] = [];
    for (let i = 1; i < datas.length; i++) {
      const d = diasEntre(datas[i - 1], datas[i]);
      if (Number.isFinite(d)) intervalos.push(d);
    }

    // O nome mais recente vence: cliente que corrigiu o cadastro aparece certo.
    const nome = [...lista].reverse().find(p => p.customer_name?.trim())?.customer_name?.trim() ?? null;

    out.push({
      chave,
      nome,
      telefone: chave.startsWith('id:') ? null : chave,
      etapa,
      pedidos: lista.length,
      receita,
      ticketMedio: receita / lista.length,
      primeiraCompra: datas[0],
      ultimaCompra: datas[datas.length - 1],
      diasDesdeUltima: Math.floor(diasEntre(datas[datas.length - 1], agoraIso)),
      intervaloMedianoDias: mediana(intervalos),
    });
  }

  // Quem está há mais tempo sumido primeiro dentro de cada etapa é decidido na
  // UI; aqui só uma ordem estável por receita (quem vale mais no topo).
  return out.sort((a, b) => b.receita - a.receita);
}

export type FunilDelivery = {
  etapas: Record<Etapa, { clientes: number; receita: number }>;
  totalClientes: number;
};

export function agregarFunil(clientes: ClienteDelivery[]): FunilDelivery {
  const etapas = Object.fromEntries(
    ETAPAS.map(e => [e, { clientes: 0, receita: 0 }]),
  ) as FunilDelivery['etapas'];
  for (const c of clientes) {
    etapas[c.etapa].clientes += 1;
    etapas[c.etapa].receita += c.receita;
  }
  return { etapas, totalClientes: clientes.length };
}

/**
 * Sugere a janela a partir do comportamento REAL da loja: mediana dos
 * intervalos entre compras dos clientes recorrentes, com folga de 50%.
 * Melhor que o gestor chutar 30 — uma pizzaria de ciclo semanal ganha régua
 * ~11 dias; um japonês mensal, ~45.
 */
export function sugerirRegua(clientes: ClienteDelivery[]): Regua | null {
  const intervalos = clientes
    .map(c => c.intervaloMedianoDias)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  if (intervalos.length < 5) return null; // amostra pequena demais pra opinar
  const med = mediana(intervalos)!;
  const janela = Math.max(7, Math.round(med * 1.5));
  return normalizarRegua({ janelaDias: janela, inatividadeDias: janela * 2 });
}

// ---------------------------------------------------------------- Telefone

/**
 * Normaliza telefone BR para casar Cardápio Web ↔ crm_leads.
 *
 * Devolve só dígitos, SEM o DDI 55 e SEM o 9º dígito flutuante: DDD + os
 * últimos 8 dígitos. O 9º dígito é a maior fonte de "mesmo cliente, dois
 * registros" (o webhook da Evolution manda com, cadastro antigo vem sem) — o
 * fallback de sufixo de 8 já é o padrão do match de avatares do CRM.
 */
export function normalizarTelefoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length < 8) return null;
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2); // tira o DDI
  if (d.length === 11) return d.slice(0, 2) + d.slice(3);   // tira o 9º dígito
  if (d.length === 10) return d;                             // DDD + 8
  if (d.length === 8 || d.length === 9) return d.slice(-8);  // sem DDD: só o sufixo
  return d.slice(-10); // formato exótico: melhor esforço com DDD+8 finais
}

/** Sufixo de 8 — a chave de ÚLTIMO recurso para casar com o CRM. */
export function sufixo8(raw: string | null | undefined): string | null {
  const n = normalizarTelefoneBR(raw);
  return n && n.length >= 8 ? n.slice(-8) : null;
}

// ---------------------------------------------------------------- Período

/**
 * Converte um intervalo de DATAS em BRT para os instantes UTC correspondentes.
 *
 * `created_at` é gravado em UTC, mas o lojista pensa em dias de Brasília — sem
 * essa conversão, pedido feito às 22h de 31/jul cairia em agosto no relatório.
 * BRT fixo em UTC-3: o Brasil não tem mais horário de verão desde 2019, e é a
 * mesma escolha já feita em `disparos-schedule`.
 *
 * O fim é EXCLUSIVO (dia seguinte às 00h BRT), então o último dia entra inteiro.
 */
export function limitesBRT(deData: string, ateData: string): { inicio: string; fimExclusivo: string } {
  return {
    inicio: `${deData}T03:00:00.000Z`,
    fimExclusivo: new Date(new Date(`${ateData}T03:00:00.000Z`).getTime() + DIA_MS).toISOString(),
  };
}

export type Periodo = { de: string; ate: string };

export function noPeriodo(createdAt: string | Date, p: Periodo): boolean {
  const iso = paraIso(createdAt);
  if (!iso) return false;
  const { inicio, fimExclusivo } = limitesBRT(p.de, p.ate);
  return iso >= inicio && iso < fimExclusivo;
}

export type ResumoPeriodo = {
  receita: number;
  pedidos: number;
  ticketMedio: number;
  clientesUnicos: number;
  /** Clientes cuja PRIMEIRA compra de toda a base caiu neste período. */
  clientesNovos: number;
};

/**
 * KPIs somados no período. Cancelado fica de fora — ele não é receita.
 *
 * ⚠️ Isto é uma SOMA sobre um intervalo, conceito diferente do funil, que é uma
 * FOTO num instante. Misturar os dois numa mesma leitura é a principal fonte de
 * confusão nesse tipo de painel, por isso são funções separadas.
 */
export function resumoPeriodo(pedidos: PedidoAgrupavel[], p: Periodo): ResumoPeriodo {
  const validos = pedidos.filter(pedidoValido);

  // Primeira compra histórica de cada cliente — precisa varrer TUDO, não só o
  // período: quem comprou pela primeira vez em maio não é "novo" em julho.
  const primeiraCompra = new Map<string, string>();
  for (const o of validos) {
    const chave = chaveCliente(o);
    if (!chave) continue;
    const iso = paraIso(o.created_at);
    const atual = primeiraCompra.get(chave);
    if (!atual || iso < atual) primeiraCompra.set(chave, iso);
  }

  const doPeriodo = validos.filter(o => noPeriodo(o.created_at, p));
  const receita = doPeriodo.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const clientes = new Set<string>();
  let novos = 0;
  for (const o of doPeriodo) {
    const chave = chaveCliente(o);
    if (!chave || clientes.has(chave)) continue;
    clientes.add(chave);
    const pc = primeiraCompra.get(chave);
    if (pc && noPeriodo(pc, p)) novos++;
  }

  return {
    receita,
    pedidos: doPeriodo.length,
    ticketMedio: doPeriodo.length ? receita / doPeriodo.length : 0,
    clientesUnicos: clientes.size,
    clientesNovos: novos,
  };
}

/** Identidade do cliente: telefone normalizado, senão o id da plataforma. */
function chaveCliente(o: PedidoAgrupavel): string | null {
  const fone = normalizarTelefoneBR(o.customer_phone);
  if (fone) return fone;
  return o.customer_id != null && String(o.customer_id) !== '' ? `id:${o.customer_id}` : null;
}

/**
 * Variação percentual. `null` quando não há base de comparação — dividir por
 * zero viraria "∞%" ou "+100%", que mentiria sobre um período sem histórico.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

/**
 * Funil COMO ESTAVA num instante do passado.
 *
 * Só é possível porque `classificarEtapa` recebe o "agora" por parâmetro:
 * filtrando os pedidos até a data e passando essa data como referência, a
 * classificação vale para aquele momento. É o que permite dizer "no mês passado
 * eram 138 recorrentes, hoje são 150".
 */
export function funilEm(pedidos: PedidoAgrupavel[], regua: Regua, momentoIso: string): FunilDelivery {
  const ate = pedidos.filter(o => paraIso(o.created_at) <= momentoIso);
  return agregarFunil(agruparPorCliente(ate, regua, momentoIso));
}

// ---------------------------------------------------------------- Cupons

export type DescontoBruto = {
  kind?: string;
  category?: string;
  coupon_code?: string | null;
  coupon_name?: string | null;
  total?: number;
};

export type PedidoComDesconto = PedidoAgrupavel & { discounts?: DescontoBruto[] | string | null };

export type UsoCupom = {
  codigo: string;
  nome: string | null;
  categoria: string;
  usos: number;
  descontoTotal: number;
  /** Receita dos pedidos em que este cupom apareceu (já líquida do desconto). */
  receita: number;
  ticketMedio: number;
};

export type ResumoCupons = {
  cupons: UsoCupom[];
  pedidosComDesconto: number;
  pedidosSemDesconto: number;
  descontoTotal: number;
  ticketComDesconto: number;
  ticketSemDesconto: number;
  /** Pedidos ainda sem o campo lido (importados antes da coluna existir). */
  semDadoDeDesconto: number;
};

function lerDescontos(v: DescontoBruto[] | string | null | undefined): DescontoBruto[] | null {
  if (v == null) return null; // NULL = nunca lido, diferente de "sem desconto"
  if (Array.isArray(v)) return v;
  try {
    const p = JSON.parse(v) as unknown;
    return Array.isArray(p) ? p as DescontoBruto[] : [];
  } catch {
    return [];
  }
}

/**
 * Uso real de cupom, derivado dos PEDIDOS.
 *
 * O endpoint de cupons do Cardápio Web só devolve a definição (código, valor,
 * limite) — não há contagem de uso nem valor descontado. Isso só existe dentro
 * do pedido, em `discounts[]`, e por isso é calculado aqui.
 *
 * `semDadoDeDesconto` é reportado de propósito: enquanto a recaptura não passa
 * por todos os pedidos antigos, os números são parciais — e um total parcial
 * apresentado como completo levaria a decisão errada sobre a campanha.
 */
export function agregarCupons(pedidos: PedidoComDesconto[], p: Periodo): ResumoCupons {
  const doPeriodo = pedidos.filter(pedidoValido).filter(o => noPeriodo(o.created_at, p));

  const porCodigo = new Map<string, UsoCupom>();
  let comDesconto = 0, semDesconto = 0, semDado = 0;
  let descontoTotal = 0, receitaCom = 0, receitaSem = 0;

  for (const o of doPeriodo) {
    const ds = lerDescontos(o.discounts);
    if (ds === null) { semDado++; continue; }

    const valor = Number(o.total) || 0;
    if (ds.length === 0) { semDesconto++; receitaSem += valor; continue; }

    comDesconto++; receitaCom += valor;
    for (const d of ds) {
      const desc = Number(d.total) || 0;
      descontoTotal += desc;
      // Fidelidade e cortesia não têm código; agrupa pela categoria para não
      // sumirem do relatório nem se misturarem com cupom de campanha.
      const codigo = d.coupon_code?.trim() || (d.category ? `(${d.category})` : '(sem código)');
      const cur = porCodigo.get(codigo) ?? {
        codigo, nome: d.coupon_name?.trim() || null,
        categoria: d.category ?? 'other', usos: 0, descontoTotal: 0, receita: 0, ticketMedio: 0,
      };
      cur.usos += 1;
      cur.descontoTotal += desc;
      cur.receita += valor;
      porCodigo.set(codigo, cur);
    }
  }

  return {
    cupons: [...porCodigo.values()]
      .map(c => ({ ...c, ticketMedio: c.usos ? c.receita / c.usos : 0 }))
      .sort((a, b) => b.usos - a.usos || b.descontoTotal - a.descontoTotal),
    pedidosComDesconto: comDesconto,
    pedidosSemDesconto: semDesconto,
    descontoTotal,
    ticketComDesconto: comDesconto ? receitaCom / comDesconto : 0,
    ticketSemDesconto: semDesconto ? receitaSem / semDesconto : 0,
    semDadoDeDesconto: semDado,
  };
}

// ---------------------------------------------------------------- Série / Heatmap / Frequência

/**
 * Parte local (BRT, UTC-3 fixo — sem horário de verão desde 2019) de um instante.
 *
 * Reusa a mesma convenção de `limitesBRT`: deslocar o instante UTC em -3h e ler
 * as partes UTC devolve o relógio de parede de Brasília. Sem isso, pedido às 22h
 * de 31/jul cairia no dia seguinte no relatório.
 */
function parteBRT(createdAt: string | Date): { data: string; dow: number; hora: number } | null {
  const iso = paraIso(createdAt);
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const brt = new Date(t - 3 * 3_600_000);
  return { data: brt.toISOString().slice(0, 10), dow: brt.getUTCDay(), hora: brt.getUTCHours() };
}

export type PontoSerieDia = { data: string; receita: number; pedidos: number };

/**
 * Receita e pedidos por dia BRT dentro do período. Só dias COM pedido entram —
 * plotar dia sem venda como zero puxaria a linha pra baixo e sugeriria operação
 * parada (mesma convenção de "null = sem fonte" do resto do painel).
 */
export function serieDiaria(pedidos: PedidoLite[], p: Periodo): PontoSerieDia[] {
  const porDia = new Map<string, { receita: number; pedidos: number }>();
  for (const o of pedidos) {
    if (!pedidoValido(o) || !noPeriodo(o.created_at, p)) continue;
    const parte = parteBRT(o.created_at);
    if (!parte) continue;
    const cur = porDia.get(parte.data) ?? { receita: 0, pedidos: 0 };
    cur.receita += Number(o.total) || 0;
    cur.pedidos += 1;
    porDia.set(parte.data, cur);
  }
  return [...porDia.entries()]
    .map(([data, v]) => ({ data, receita: v.receita, pedidos: v.pedidos }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

/** Faixas de horário do mapa de calor — recorte de delivery (almoço 10–14, jantar 18–22). */
export const FAIXAS_HEATMAP = [
  { label: '00–06h', min: 0, max: 5 },
  { label: '06–10h', min: 6, max: 9 },
  { label: '10–14h', min: 10, max: 13 },
  { label: '14–18h', min: 14, max: 17 },
  { label: '18–22h', min: 18, max: 21 },
  { label: '22–24h', min: 22, max: 23 },
] as const;

export type HeatmapPedidos = { faixas: string[]; matriz: number[][]; max: number };

/**
 * Pedidos por dia da semana × faixa de horário, em BRT. `matriz[faixa][dow]`,
 * dow 0=domingo (convenção de `Date.getDay()`, casada com `DIAS_SEMANA` da UI).
 */
export function heatmapPedidos(pedidos: PedidoLite[], p: Periodo): HeatmapPedidos {
  const matriz = FAIXAS_HEATMAP.map(() => new Array<number>(7).fill(0));
  let max = 0;
  for (const o of pedidos) {
    if (!pedidoValido(o) || !noPeriodo(o.created_at, p)) continue;
    const parte = parteBRT(o.created_at);
    if (!parte) continue;
    const fi = FAIXAS_HEATMAP.findIndex(f => parte.hora >= f.min && parte.hora <= f.max);
    if (fi < 0) continue;
    const v = (matriz[fi][parte.dow] += 1);
    if (v > max) max = v;
  }
  return { faixas: FAIXAS_HEATMAP.map(f => f.label), matriz, max };
}

export type FaixaFrequencia = { chave: '1' | '2-4' | '5-9' | '10+'; nome: string; clientes: number };

const FAIXAS_FREQ: Array<{ chave: FaixaFrequencia['chave']; nome: string; min: number; max: number }> = [
  { chave: '1', nome: '1 pedido', min: 1, max: 1 },
  { chave: '2-4', nome: '2 a 4 pedidos', min: 2, max: 4 },
  { chave: '5-9', nome: '5 a 9 pedidos', min: 5, max: 9 },
  { chave: '10+', nome: '10+ pedidos', min: 10, max: Number.POSITIVE_INFINITY },
];

/**
 * Distribuição da base por número de pedidos na vida (1x, 2–4, 5–9, 10+) — o
 * argumento comercial da retenção. Recebe os clientes já agrupados
 * (`agruparPorCliente`), cada um com sua contagem de pedidos.
 */
export function distribuicaoFrequencia(clientes: Array<{ pedidos: number }>): FaixaFrequencia[] {
  return FAIXAS_FREQ.map(f => ({
    chave: f.chave,
    nome: f.nome,
    clientes: clientes.filter(c => c.pedidos >= f.min && c.pedidos <= f.max).length,
  }));
}
