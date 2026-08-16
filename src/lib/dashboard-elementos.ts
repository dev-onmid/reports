/**
 * Estilo por ELEMENTO — a camada que falta para editar métrica por métrica.
 *
 * O modelo de blocos (dashboard-modelo.ts) enxerga 7 caixas opacas: dá para
 * mover e ocultar "Faturamento e ticket médio", mas não para mexer só no
 * Faturamento. Aqui cada elemento dentro do bloco ganha id estável e estilo
 * próprio.
 *
 * ⚠️ Liberdade total foi decisão explícita do Matheus: cor em hex livre e
 * tamanho em px livre, não uma lista fechada de tons e tamanhos. A consequência
 * aceita é que dois clientes podem ficar visualmente diferentes — o design
 * system deixa de ser garantia e vira ponto de partida (os defaults).
 *
 * Puro e client-safe.
 */

import type { BlocoId } from '@/lib/dashboard-modelo';

/** `bloco.elemento` — ex: 'resultado.faturamento'. Estável, nunca renomear. */
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
  /** Ordem dentro do bloco; menor primeiro. `null` = ordem de fábrica. */
  ordem?: number | null;
};

export type EstilosPorElemento = Record<ElementoId, EstiloElemento>;

/** Elemento declarado pelo código — o que o inspetor pode editar. */
export type DefinicaoElemento = {
  id: ElementoId;
  bloco: BlocoId;
  /** Rótulo de fábrica, mostrado quando não há `texto` customizado. */
  rotulo: string;
  /** O que é editável neste elemento — o inspetor esconde o resto. */
  suporta: Array<'texto' | 'corTexto' | 'corValor' | 'corIcone' | 'corFundo'
    | 'tamanhoTexto' | 'tamanhoValor' | 'tamanhoIcone' | 'icone' | 'visivel' | 'ordem'>;
};

const TUDO: DefinicaoElemento['suporta'] = [
  'texto', 'corTexto', 'corValor', 'corIcone', 'corFundo',
  'tamanhoTexto', 'tamanhoValor', 'tamanhoIcone', 'icone', 'visivel', 'ordem',
];

/** Só título e ícone — cabeçalhos não têm "valor". */
const CABECALHO: DefinicaoElemento['suporta'] = [
  'texto', 'corTexto', 'corIcone', 'tamanhoTexto', 'tamanhoIcone', 'icone', 'visivel',
];

/**
 * Catálogo dos elementos editáveis. Elemento que não está aqui não aparece no
 * inspetor — é a lista que impede o modelo salvo de referenciar algo que o
 * código não sabe estilizar.
 */
export const ELEMENTOS: DefinicaoElemento[] = [
  { id: 'resultado.titulo',       bloco: 'resultado',     rotulo: 'Título do bloco',   suporta: CABECALHO },
  { id: 'resultado.faturamento',  bloco: 'resultado',     rotulo: 'Faturamento',       suporta: TUDO },
  { id: 'resultado.ticket',       bloco: 'resultado',     rotulo: 'Ticket médio',      suporta: TUDO },

  { id: 'kpis.investimento',      bloco: 'kpis',          rotulo: 'Investimento total', suporta: TUDO },
  { id: 'kpis.custo_pedido',      bloco: 'kpis',          rotulo: 'Custo por pedido',   suporta: TUDO },
  { id: 'kpis.roas',              bloco: 'kpis',          rotulo: 'ROAS',               suporta: TUDO },
  { id: 'kpis.cac',               bloco: 'kpis',          rotulo: 'CAC',                suporta: TUDO },
  { id: 'kpis.ticket',            bloco: 'kpis',          rotulo: 'Ticket médio',       suporta: TUDO },

  { id: 'vendas.titulo',          bloco: 'vendas',        rotulo: 'Título do bloco',    suporta: CABECALHO },
  { id: 'vendas.receita',         bloco: 'vendas',        rotulo: 'Receita',            suporta: TUDO },
  { id: 'vendas.pedidos',         bloco: 'vendas',        rotulo: 'Pedidos',            suporta: TUDO },
  { id: 'vendas.ticket',          bloco: 'vendas',        rotulo: 'Ticket médio',       suporta: TUDO },
  { id: 'vendas.novos',           bloco: 'vendas',        rotulo: 'Novos clientes',     suporta: TUDO },

  { id: 'quando_vendem.titulo',   bloco: 'quando_vendem', rotulo: 'Título do bloco',    suporta: CABECALHO },
  { id: 'ritmo.titulo',           bloco: 'ritmo',         rotulo: 'Título do bloco',    suporta: CABECALHO },
  { id: 'ritmo.receita_dia',      bloco: 'ritmo',         rotulo: 'Receita/dia',        suporta: TUDO },
  { id: 'ritmo.pedidos_dia',      bloco: 'ritmo',         rotulo: 'Pedidos/dia',        suporta: TUDO },

  { id: 'base_clientes.titulo',   bloco: 'base_clientes', rotulo: 'Título do bloco',    suporta: CABECALHO },
  { id: 'base_clientes.ativos',   bloco: 'base_clientes', rotulo: 'Ativos',             suporta: TUDO },
  { id: 'base_clientes.risco',    bloco: 'base_clientes', rotulo: 'Em risco',           suporta: TUDO },
  { id: 'base_clientes.inativos', bloco: 'base_clientes', rotulo: 'Inativos',           suporta: TUDO },

  { id: 'recorrencia.titulo',     bloco: 'recorrencia',   rotulo: 'Título do bloco',    suporta: CABECALHO },
  { id: 'recorrencia.barras',     bloco: 'recorrencia',   rotulo: 'Barras e anéis',     suporta: ['corValor', 'corIcone', 'tamanhoIcone', 'visivel'] },
];

export function definicaoElemento(id: ElementoId): DefinicaoElemento | null {
  return ELEMENTOS.find((e) => e.id === id) ?? null;
}

export function elementosDoBloco(bloco: BlocoId): DefinicaoElemento[] {
  return ELEMENTOS.filter((e) => e.bloco === bloco);
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
      ordem: Number.isFinite(Number(r.ordem)) ? Number(r.ordem) : null,
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

/**
 * Ordena elementos de um bloco pela `ordem` customizada, caindo na ordem de
 * declaração do catálogo quando não há customização — assim reordenar um
 * elemento não embaralha os outros.
 */
export function ordenarElementos(
  estilos: EstilosPorElemento, ids: ElementoId[],
): ElementoId[] {
  const chave = (id: ElementoId) => {
    const o = estiloDe(estilos, id).ordem;
    const explicito = o !== null && o !== undefined;
    return { valor: explicito ? o : ids.indexOf(id), explicito };
  };
  return [...ids].sort((a, b) => {
    const ka = chave(a);
    const kb = chave(b);
    if (ka.valor !== kb.valor) return ka.valor - kb.valor;
    // ⚠️ Empate entre ordem EXPLÍCITA e implícita: a explícita vence. Sem isto,
    // mandar um elemento para a posição 0 o deixava atrás do que já ocupava o
    // índice 0 — ou seja, arrastar para o topo não funcionava.
    if (ka.explicito !== kb.explicito) return ka.explicito ? -1 : 1;
    return ids.indexOf(a) - ids.indexOf(b);
  });
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
