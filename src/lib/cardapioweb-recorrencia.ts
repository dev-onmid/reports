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
  /** ISO 8601 */
  created_at: string;
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
    lista.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const datas = lista.map(p => p.created_at);
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
