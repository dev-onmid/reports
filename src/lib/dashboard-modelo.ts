/**
 * Modelo editável do dashboard — o que o "modo edição" salva.
 *
 * Decisão do Matheus: o modelo é POR SEGMENTO, não por cliente. Editar o modelo
 * de food muda o painel de todos os restaurantes de uma vez; 45 clientes com 45
 * arranjos seria impossível de manter (um bloco novo teria de ser posicionado
 * 45 vezes).
 *
 * Escopo do editor, também decidido: LAYOUT e TÍTULO. Cor, fonte e ícone
 * continuam vindo do design system — liberar estilo por bloco faria cada cliente
 * ter um painel diferente e o "Verde Onmid como única cor de CTA" deixaria de
 * valer na prática.
 *
 * Puro e client-safe: sem pg, sem fetch. A tela e os testes importam daqui.
 */

import type { SegmentoDashboard } from '@/lib/dashboard-segmento';

/** Blocos disponíveis no dashboard de food. Id é ESTÁVEL — nunca renomeie. */
export type BlocoId =
  | 'resultado'        // Faturamento + Ticket médio (hero)
  | 'kpis'             // faixa de eficiência
  | 'vendas'           // receita/pedidos/ticket/novos
  | 'quando_vendem'    // heatmap de horários
  | 'ritmo'            // médias diárias + saldos
  | 'base_clientes'    // gauge de ativos/risco/inativos
  | 'recorrencia';     // distribuição por número de pedidos

export type DefinicaoBloco = {
  id: BlocoId;
  /** Rótulo de fábrica. O modelo pode sobrescrever com `titulo`. */
  rotulo: string;
  /** Explica o bloco no painel de edição. */
  descricao: string;
  /** Largura/altura padrão em unidades do grid (12 colunas). */
  w: number;
  h: number;
  minW: number;
  minH: number;
};

/**
 * Catálogo. Bloco que não está aqui NÃO existe para o editor — é a lista que
 * impede o modelo salvo de referenciar algo que o código não sabe renderizar.
 */
export const BLOCOS_FOOD: DefinicaoBloco[] = [
  { id: 'resultado',     rotulo: 'Faturamento e ticket', descricao: 'Meta de faturamento e ticket médio do período', w: 12, h: 3, minW: 6, minH: 3 },
  { id: 'kpis',          rotulo: 'Eficiência',           descricao: 'Investimento, custo por pedido, ROAS, CAC e ticket', w: 12, h: 2, minW: 6, minH: 2 },
  { id: 'vendas',        rotulo: 'Vendas',               descricao: 'Receita, pedidos, ticket e novos clientes', w: 12, h: 3, minW: 6, minH: 3 },
  { id: 'quando_vendem', rotulo: 'Quando vendem',        descricao: 'Mapa de pedidos por dia da semana e horário', w: 7,  h: 5, minW: 4, minH: 4 },
  { id: 'ritmo',         rotulo: 'Ritmo',                descricao: 'Médias diárias e saldo das contas de anúncio', w: 5,  h: 5, minW: 3, minH: 3 },
  { id: 'base_clientes', rotulo: 'Situação da base',     descricao: 'Ativos, em risco e inativos', w: 5, h: 5, minW: 3, minH: 4 },
  { id: 'recorrencia',   rotulo: 'Recorrência',          descricao: 'Distribuição da base por número de pedidos', w: 7, h: 5, minW: 4, minH: 4 },
];

export type BlocoNoModelo = {
  id: BlocoId;
  x: number;
  y: number;
  w: number;
  h: number;
  visivel: boolean;
  /** Título customizado. `null`/ausente = usa o rótulo de fábrica. */
  titulo?: string | null;
};

export type ModeloDashboard = {
  segmento: SegmentoDashboard;
  blocos: BlocoNoModelo[];
};

/** Layout de fábrica do food — a ordem que a tela tem hoje. */
export const MODELO_PADRAO_FOOD: ModeloDashboard = {
  segmento: 'food',
  blocos: [
    { id: 'resultado',     x: 0, y: 0,  w: 12, h: 3, visivel: true },
    { id: 'kpis',          x: 0, y: 3,  w: 12, h: 2, visivel: true },
    { id: 'vendas',        x: 0, y: 5,  w: 12, h: 3, visivel: true },
    { id: 'quando_vendem', x: 0, y: 8,  w: 7,  h: 5, visivel: true },
    { id: 'ritmo',         x: 7, y: 8,  w: 5,  h: 5, visivel: true },
    { id: 'base_clientes', x: 0, y: 13, w: 5,  h: 5, visivel: true },
    { id: 'recorrencia',   x: 5, y: 13, w: 7,  h: 5, visivel: true },
  ],
};

export function modeloPadrao(segmento: SegmentoDashboard): ModeloDashboard {
  // Só food tem editor por enquanto; lead-gen cai no mesmo shape vazio para o
  // contrato não precisar de caso especial na rota.
  return segmento === 'food' ? MODELO_PADRAO_FOOD : { segmento, blocos: [] };
}

export function definicaoBloco(id: BlocoId): DefinicaoBloco | null {
  return BLOCOS_FOOD.find((b) => b.id === id) ?? null;
}

/** Título exibido: o customizado, se houver; senão o de fábrica. */
export function tituloDoBloco(bloco: BlocoNoModelo): string {
  const custom = bloco.titulo?.trim();
  if (custom) return custom;
  return definicaoBloco(bloco.id)?.rotulo ?? bloco.id;
}

/**
 * Funde o modelo salvo com o padrão do código — a função que impede o editor de
 * envelhecer mal:
 *
 *  • bloco NOVO no código entra com a posição de fábrica, ao fim da tela. Sem
 *    isso, todo bloco novo ficaria invisível para quem já salvou um modelo, e
 *    ninguém entenderia por que a feature "não apareceu".
 *  • bloco que saiu do código é DESCARTADO do salvo — modelo antigo não pode
 *    fazer a tela tentar renderizar algo que não existe mais.
 *  • posição/tamanho/visibilidade/título salvos vencem o padrão.
 */
export function mesclarModelo(
  salvo: ModeloDashboard | null | undefined,
  padrao: ModeloDashboard,
): ModeloDashboard {
  const porId = new Map<BlocoId, BlocoNoModelo>();
  for (const b of salvo?.blocos ?? []) porId.set(b.id, b);

  const blocos: BlocoNoModelo[] = [];
  let proximoY = 0;
  for (const p of padrao.blocos) {
    const s = porId.get(p.id);
    const def = definicaoBloco(p.id);
    if (s) {
      blocos.push({
        id: p.id,
        // Respeita o salvo, mas nunca abaixo do mínimo do bloco: um modelo
        // antigo não pode espremer um bloco até ele ficar ilegível.
        x: Number.isFinite(s.x) ? s.x : p.x,
        y: Number.isFinite(s.y) ? s.y : p.y,
        w: Math.max(def?.minW ?? 1, Number.isFinite(s.w) ? s.w : p.w),
        h: Math.max(def?.minH ?? 1, Number.isFinite(s.h) ? s.h : p.h),
        visivel: s.visivel !== false,
        titulo: s.titulo?.trim() ? s.titulo.trim() : null,
      });
    } else {
      blocos.push({ ...p });
    }
    proximoY = Math.max(proximoY, (s?.y ?? p.y) + (s?.h ?? p.h));
  }
  void proximoY;
  return { segmento: padrao.segmento, blocos };
}

/** Só os visíveis, na ordem de leitura (cima→baixo, esquerda→direita). */
export function blocosVisiveis(modelo: ModeloDashboard): BlocoNoModelo[] {
  return modelo.blocos.filter((b) => b.visivel).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Valida o que veio do banco/rede antes de usar. Modelo corrompido cai no
 * padrão inteiro em vez de quebrar a tela.
 */
export function normalizarModelo(bruto: unknown, segmento: SegmentoDashboard): ModeloDashboard {
  const padrao = modeloPadrao(segmento);
  if (!bruto || typeof bruto !== 'object') return padrao;
  const blocos = (bruto as { blocos?: unknown }).blocos;
  if (!Array.isArray(blocos)) return padrao;

  const idsValidos = new Set(padrao.blocos.map((b) => b.id));
  const limpos: BlocoNoModelo[] = [];
  for (const b of blocos) {
    if (!b || typeof b !== 'object') continue;
    const r = b as Record<string, unknown>;
    const id = r.id as BlocoId;
    if (!idsValidos.has(id)) continue; // bloco que não existe mais no código
    limpos.push({
      id,
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      w: Number(r.w) || 12,
      h: Number(r.h) || 3,
      visivel: r.visivel !== false,
      titulo: typeof r.titulo === 'string' && r.titulo.trim() ? r.titulo.trim().slice(0, 60) : null,
    });
  }
  return mesclarModelo({ segmento, blocos: limpos }, padrao);
}
