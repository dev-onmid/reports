/**
 * Catálogo de ELEMENTOS do dashboard — a unidade que o editor manipula.
 *
 * ⚠️ Mudança de arquitetura (pedido do Matheus): a unidade deixou de ser o
 * BLOCO e passou a ser o ELEMENTO. Antes, arrastar "Vendas" levava junto as 4
 * métricas de dentro dele; não havia como mover só o Faturamento. Agora cada
 * métrica, título e gráfico é um item próprio da grade — por isso a posição
 * (x/y/w/h) mora aqui, ao lado do estilo.
 *
 * O bloco sobrevive apenas como AGRUPAMENTO semântico (`bloco`), para rotular
 * o elemento na tela de edição ("Vendas › Receita"). Ele não posiciona mais
 * nada.
 *
 * ⚠️ Liberdade total foi decisão explícita do Matheus: cor em hex livre e
 * tamanho em px livre, não uma lista fechada de tons e tamanhos. A consequência
 * aceita é que dois clientes podem ficar visualmente diferentes — o design
 * system deixa de ser garantia e vira ponto de partida (os defaults).
 *
 * Puro e client-safe.
 */

import type { BlocoId } from '@/lib/dashboard-modelo';

/** `bloco.elemento` — ex: 'vendas.receita'. Estável, nunca renomear. */
export type ElementoId = string;

export type EstiloElemento = {
  /** Sobrescreve o texto do rótulo/título. */
  texto?: string | null;
  /** Hex livre (#RRGGBB). `null` = herda o padrão do componente. */
  corTexto?: string | null;
  corValor?: string | null;
  corIcone?: string | null;
  corFundo?: string | null;
  /** Tamanhos em PX. `null` = padrão do componente. */
  tamanhoTexto?: number | null;
  tamanhoValor?: number | null;
  tamanhoIcone?: number | null;
  /** Nome do ícone lucide (ex: 'Wallet'). `null` = o de fábrica. */
  icone?: string | null;
  visivel?: boolean;
};

export type EstilosPorElemento = Record<ElementoId, EstiloElemento>;

export type PropriedadeEditavel =
  | 'texto' | 'corTexto' | 'corValor' | 'corIcone' | 'corFundo'
  | 'tamanhoTexto' | 'tamanhoValor' | 'tamanhoIcone' | 'icone' | 'visivel';

/** Elemento declarado pelo código — o que o editor pode mover e estilizar. */
export type DefinicaoElemento = {
  id: ElementoId;
  bloco: BlocoId;
  /** Rótulo de fábrica, mostrado quando não há `texto` customizado. */
  rotulo: string;
  /** O que é editável neste elemento — os controles escondem o resto. */
  suporta: PropriedadeEditavel[];
  /** Posição e tamanho de FÁBRICA na grade de 12 colunas. */
  x: number;
  y: number;
  w: number;
  h: number;
  minW: number;
  minH: number;
};

const TUDO: PropriedadeEditavel[] = [
  'texto', 'corTexto', 'corValor', 'corIcone', 'corFundo',
  'tamanhoTexto', 'tamanhoValor', 'tamanhoIcone', 'icone', 'visivel',
];

/** Só título e ícone — cabeçalhos não têm "valor". */
const CABECALHO: PropriedadeEditavel[] = [
  'texto', 'corTexto', 'corIcone', 'tamanhoTexto', 'tamanhoIcone', 'icone', 'visivel',
];

/**
 * Catálogo dos elementos editáveis. Elemento que não está aqui não existe para
 * o editor — é a lista que impede o modelo salvo de referenciar algo que o
 * código não sabe renderizar nem estilizar.
 *
 * ⚠️ As posições de fábrica reproduzem a leitura atual da tela (hero → KPIs →
 * vendas → horários/ritmo → base/recorrência) e são coerentes com a compactação
 * vertical do grid: não há buraco que faça um elemento "subir sozinho".
 */
export const ELEMENTOS: DefinicaoElemento[] = [
  // Hero — meta de faturamento e ticket
  { id: 'resultado.faturamento',  bloco: 'resultado',     rotulo: 'Faturamento',        suporta: ['texto', 'corTexto', 'corValor', 'corIcone', 'tamanhoTexto', 'tamanhoValor', 'tamanhoIcone', 'icone', 'visivel'], x: 0,  y: 0,  w: 6,  h: 3, minW: 3, minH: 2 },
  { id: 'resultado.ticket',       bloco: 'resultado',     rotulo: 'Ticket médio',       suporta: ['texto', 'corTexto', 'corValor', 'corIcone', 'tamanhoTexto', 'tamanhoValor', 'tamanhoIcone', 'icone', 'visivel'], x: 6,  y: 0,  w: 6,  h: 3, minW: 3, minH: 2 },

  // Faixa de eficiência
  { id: 'kpis.investimento',      bloco: 'kpis',          rotulo: 'Investimento total', suporta: TUDO, x: 0,  y: 3,  w: 3,  h: 2, minW: 2, minH: 2 },
  { id: 'kpis.custo_pedido',      bloco: 'kpis',          rotulo: 'Custo por pedido',   suporta: TUDO, x: 3,  y: 3,  w: 3,  h: 2, minW: 2, minH: 2 },
  { id: 'kpis.roas',              bloco: 'kpis',          rotulo: 'ROAS',               suporta: TUDO, x: 6,  y: 3,  w: 2,  h: 2, minW: 2, minH: 2 },
  { id: 'kpis.ticket',            bloco: 'kpis',          rotulo: 'Ticket médio',       suporta: TUDO, x: 8,  y: 3,  w: 2,  h: 2, minW: 2, minH: 2 },
  { id: 'kpis.recorrencia',       bloco: 'kpis',          rotulo: 'Recorrência',        suporta: TUDO, x: 10, y: 3,  w: 2,  h: 2, minW: 2, minH: 2 },

  // Vendas
  { id: 'vendas.titulo',          bloco: 'vendas',        rotulo: 'Vendas',             suporta: CABECALHO, x: 0,  y: 5,  w: 12, h: 1, minW: 2, minH: 1 },
  { id: 'vendas.receita',         bloco: 'vendas',        rotulo: 'Receita',            suporta: TUDO, x: 0,  y: 6,  w: 3,  h: 2, minW: 2, minH: 1 },
  { id: 'vendas.pedidos',         bloco: 'vendas',        rotulo: 'Pedidos',            suporta: TUDO, x: 3,  y: 6,  w: 3,  h: 2, minW: 2, minH: 1 },
  { id: 'vendas.ticket',          bloco: 'vendas',        rotulo: 'Ticket médio',       suporta: TUDO, x: 6,  y: 6,  w: 3,  h: 2, minW: 2, minH: 1 },
  { id: 'vendas.novos',           bloco: 'vendas',        rotulo: 'Novos clientes',     suporta: TUDO, x: 9,  y: 6,  w: 3,  h: 2, minW: 2, minH: 1 },

  // Quando vendem
  { id: 'quando_vendem.titulo',   bloco: 'quando_vendem', rotulo: 'Quando vendem',      suporta: CABECALHO, x: 0, y: 8,  w: 7,  h: 1, minW: 2, minH: 1 },
  { id: 'quando_vendem.mapa',     bloco: 'quando_vendem', rotulo: 'Mapa de horários',   suporta: ['corFundo', 'visivel'], x: 0, y: 9, w: 7, h: 4, minW: 4, minH: 3 },

  // Ritmo
  { id: 'ritmo.titulo',           bloco: 'ritmo',         rotulo: 'Ritmo',              suporta: CABECALHO, x: 7, y: 8,  w: 5,  h: 1, minW: 2, minH: 1 },
  { id: 'ritmo.receita_dia',      bloco: 'ritmo',         rotulo: 'Receita/dia',        suporta: TUDO, x: 7,  y: 9,  w: 5,  h: 1, minW: 2, minH: 1 },
  { id: 'ritmo.pedidos_dia',      bloco: 'ritmo',         rotulo: 'Pedidos/dia',        suporta: TUDO, x: 7,  y: 10, w: 5,  h: 1, minW: 2, minH: 1 },
  { id: 'ritmo.saldos',           bloco: 'ritmo',         rotulo: 'Saldo das contas',   suporta: ['corFundo', 'visivel'], x: 7, y: 11, w: 5, h: 2, minW: 2, minH: 1 },

  // Situação da base
  { id: 'base_clientes.titulo',   bloco: 'base_clientes', rotulo: 'Situação da base',   suporta: CABECALHO, x: 0, y: 13, w: 5, h: 1, minW: 2, minH: 1 },
  { id: 'base_clientes.gauge',    bloco: 'base_clientes', rotulo: 'Medidor de ativos',  suporta: ['corFundo', 'visivel'], x: 0, y: 14, w: 2, h: 3, minW: 2, minH: 2 },
  { id: 'base_clientes.ativos',   bloco: 'base_clientes', rotulo: 'Ativos',             suporta: TUDO, x: 2,  y: 14, w: 3,  h: 1, minW: 2, minH: 1 },
  { id: 'base_clientes.risco',    bloco: 'base_clientes', rotulo: 'Em risco',           suporta: TUDO, x: 2,  y: 15, w: 3,  h: 1, minW: 2, minH: 1 },
  { id: 'base_clientes.inativos', bloco: 'base_clientes', rotulo: 'Inativos',           suporta: TUDO, x: 2,  y: 16, w: 3,  h: 1, minW: 2, minH: 1 },

  // Recorrência
  { id: 'recorrencia.titulo',     bloco: 'recorrencia',   rotulo: 'Recorrência',        suporta: CABECALHO, x: 5, y: 13, w: 7, h: 1, minW: 2, minH: 1 },
  { id: 'recorrencia.barras',     bloco: 'recorrencia',   rotulo: 'Barras e anéis',     suporta: ['corValor', 'corIcone', 'corFundo', 'tamanhoIcone', 'visivel'], x: 5, y: 14, w: 7, h: 4, minW: 4, minH: 3 },
];

export function definicaoElemento(id: ElementoId): DefinicaoElemento | null {
  return ELEMENTOS.find((e) => e.id === id) ?? null;
}

export function elementosDoBloco(bloco: BlocoId): DefinicaoElemento[] {
  return ELEMENTOS.filter((e) => e.bloco === bloco);
}

/** O elemento aceita esta propriedade? Os controles usam para esconder campo morto. */
export function suporta(id: ElementoId, prop: PropriedadeEditavel): boolean {
  return definicaoElemento(id)?.suporta.includes(prop) ?? false;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Limites de sanidade. Liberdade total não inclui fonte de 900px. */
export const LIMITE = { texto: [8, 72], valor: [10, 120], icone: [10, 96] } as const;

function px(v: unknown, faixa: readonly [number, number]): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(faixa[1], Math.max(faixa[0], Math.round(n)));
}

function cor(v: unknown): string | null {
  return typeof v === 'string' && HEX.test(v) ? v : null;
}

/** Estilo vazio — o elemento usa inteiramente os padrões do componente. */
export const SEM_ESTILO: EstiloElemento = {};

/**
 * Sanitiza o que veio do banco/rede. Valor inválido vira `null` (= herda o
 * padrão) em vez de derrubar a tela ou pintar algo de uma cor impossível.
 */
export function normalizarEstilos(bruto: unknown): EstilosPorElemento {
  if (!bruto || typeof bruto !== 'object') return {};
  const out: EstilosPorElemento = {};
  for (const [id, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!definicaoElemento(id)) continue; // elemento que não existe mais no código
    if (!valor || typeof valor !== 'object') continue;
    const r = valor as Record<string, unknown>;
    out[id] = {
      texto: typeof r.texto === 'string' && r.texto.trim() ? r.texto.trim().slice(0, 80) : null,
      corTexto: cor(r.corTexto),
      corValor: cor(r.corValor),
      corIcone: cor(r.corIcone),
      corFundo: cor(r.corFundo),
      tamanhoTexto: px(r.tamanhoTexto, LIMITE.texto),
      tamanhoValor: px(r.tamanhoValor, LIMITE.valor),
      tamanhoIcone: px(r.tamanhoIcone, LIMITE.icone),
      icone: typeof r.icone === 'string' && r.icone.trim() ? r.icone.trim().slice(0, 40) : null,
      visivel: r.visivel !== false,
    };
  }
  return out;
}

export function estiloDe(estilos: EstilosPorElemento, id: ElementoId): EstiloElemento {
  return estilos[id] ?? SEM_ESTILO;
}

export function elementoVisivel(estilos: EstilosPorElemento, id: ElementoId): boolean {
  return estiloDe(estilos, id).visivel !== false;
}

/** Texto exibido: o customizado, senão o de fábrica. */
export function textoDe(estilos: EstilosPorElemento, id: ElementoId, padrao: string): string {
  const t = estiloDe(estilos, id).texto?.trim();
  return t || padrao;
}

/** Converte o estilo em `style` inline. Campo nulo sai do objeto (herda o CSS). */
export function styleTexto(e: EstiloElemento): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (e.corTexto) s.color = e.corTexto;
  if (e.tamanhoTexto) s.fontSize = `${e.tamanhoTexto}px`;
  return s;
}

export function styleValor(e: EstiloElemento): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (e.corValor) s.color = e.corValor;
  if (e.tamanhoValor) {
    s.fontSize = `${e.tamanhoValor}px`;
    // Sem isso, valor grande estoura a caixa: o line-height herdado continua
    // apertado e o glifo é cortado.
    s.lineHeight = 1.05;
  }
  return s;
}

export function styleFundo(e: EstiloElemento): React.CSSProperties {
  return e.corFundo ? { backgroundColor: e.corFundo } : {};
}
