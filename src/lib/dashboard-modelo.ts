/**
 * Modelo editável do dashboard — o que o "modo edição" salva.
 *
 * Decisão do Matheus: o modelo é POR SEGMENTO, não por cliente. Editar o modelo
 * de food muda o painel de todos os restaurantes de uma vez; 45 clientes com 45
 * arranjos seria impossível de manter (um elemento novo teria de ser posicionado
 * 45 vezes).
 *
 * ⚠️ A unidade do modelo é o ELEMENTO, não o bloco. Enquanto a grade era feita
 * de blocos, arrastar "Vendas" carregava as 4 métricas de dentro e não havia
 * como mover só o Faturamento — foi exatamente a reclamação do Matheus. Agora
 * cada métrica/título/gráfico tem posição própria; o bloco virou só um rótulo
 * de agrupamento (ver `BLOCOS_FOOD`).
 *
 * Puro e client-safe: sem pg, sem fetch. A tela e os testes importam daqui.
 */

import type { SegmentoDashboard } from '@/lib/dashboard-segmento';
import {
  ELEMENTOS, definicaoElemento, normalizarEstilos,
  type ElementoId, type EstilosPorElemento,
} from '@/lib/dashboard-elementos';

/**
 * Agrupamento semântico dos elementos. NÃO posiciona nada — serve para rotular
 * o elemento no editor ("Vendas › Receita") e agrupar a lista de elementos
 * ocultos. Id é ESTÁVEL — nunca renomeie.
 */
export type BlocoId =
  | 'resultado'        // Faturamento + Ticket médio (hero)
  | 'kpis'             // faixa de eficiência
  | 'vendas'           // receita/pedidos/ticket/novos
  | 'quando_vendem'    // heatmap de horários
  | 'ritmo'            // médias diárias + saldos
  | 'base_clientes'    // gauge de ativos/risco/inativos
  | 'recorrencia';     // distribuição por número de pedidos

export const BLOCOS_FOOD: Array<{ id: BlocoId; rotulo: string }> = [
  { id: 'resultado',     rotulo: 'Resultado' },
  { id: 'kpis',          rotulo: 'Eficiência' },
  { id: 'vendas',        rotulo: 'Vendas' },
  { id: 'quando_vendem', rotulo: 'Quando vendem' },
  { id: 'ritmo',         rotulo: 'Ritmo' },
  { id: 'base_clientes', rotulo: 'Situação da base' },
  { id: 'recorrencia',   rotulo: 'Recorrência' },
];

export function definicaoBloco(id: BlocoId): { id: BlocoId; rotulo: string } | null {
  return BLOCOS_FOOD.find((b) => b.id === id) ?? null;
}

/** Rótulo legível do elemento no editor: "Vendas › Receita". */
export function caminhoDoElemento(id: ElementoId): string {
  const def = definicaoElemento(id);
  if (!def) return id;
  const grupo = definicaoBloco(def.bloco)?.rotulo ?? def.bloco;
  return `${grupo} › ${def.rotulo}`;
}

export type ElementoNoModelo = {
  id: ElementoId;
  x: number;
  y: number;
  w: number;
  h: number;
  visivel: boolean;
};

export type ModeloDashboard = {
  segmento: SegmentoDashboard;
  /** Posição de cada elemento na grade de 12 colunas. */
  elementos: ElementoNoModelo[];
  /**
   * Estilo por elemento — cor, tamanho, ícone e texto de cada métrica.
   * Ver dashboard-elementos.ts. Ausente = tudo nos padrões do componente.
   */
  estilos?: EstilosPorElemento;
};

/** Layout de fábrica: as posições declaradas no catálogo, todas visíveis. */
export const MODELO_PADRAO_FOOD: ModeloDashboard = {
  segmento: 'food',
  elementos: ELEMENTOS.map((e) => ({ id: e.id, x: e.x, y: e.y, w: e.w, h: e.h, visivel: true })),
};

export function modeloPadrao(segmento: SegmentoDashboard): ModeloDashboard {
  // Só food tem editor por enquanto; lead-gen cai no mesmo shape vazio para o
  // contrato não precisar de caso especial na rota.
  return segmento === 'food'
    ? { segmento: 'food', elementos: MODELO_PADRAO_FOOD.elementos.map((e) => ({ ...e })) }
    : { segmento, elementos: [] };
}

/**
 * Funde o modelo salvo com o padrão do código — a função que impede o editor de
 * envelhecer mal:
 *
 *  • elemento NOVO no código entra com a posição de fábrica. Sem isso, toda
 *    métrica nova ficaria invisível para quem já salvou um modelo, e ninguém
 *    entenderia por que a feature "não apareceu".
 *  • elemento que saiu do código é DESCARTADO do salvo — modelo antigo não pode
 *    fazer a tela tentar renderizar algo que não existe mais.
 *  • posição/tamanho/visibilidade salvos vencem o padrão, mas o tamanho nunca
 *    cai abaixo do mínimo legível do elemento.
 */
export function mesclarModelo(
  salvo: ModeloDashboard | null | undefined,
  padrao: ModeloDashboard,
): ModeloDashboard {
  const porId = new Map<ElementoId, ElementoNoModelo>();
  for (const e of salvo?.elementos ?? []) porId.set(e.id, e);

  const elementos: ElementoNoModelo[] = padrao.elementos.map((p) => {
    const s = porId.get(p.id);
    if (!s) return { ...p };
    const def = definicaoElemento(p.id);
    return {
      id: p.id,
      x: Number.isFinite(s.x) ? s.x : p.x,
      y: Number.isFinite(s.y) ? s.y : p.y,
      w: Math.max(def?.minW ?? 1, Number.isFinite(s.w) ? s.w : p.w),
      h: Math.max(def?.minH ?? 1, Number.isFinite(s.h) ? s.h : p.h),
      visivel: s.visivel !== false,
    };
  });

  return { segmento: padrao.segmento, elementos, estilos: salvo?.estilos ?? {} };
}

/** Só os visíveis, na ordem de leitura (cima→baixo, esquerda→direita). */
export function elementosVisiveis(modelo: ModeloDashboard): ElementoNoModelo[] {
  return modelo.elementos.filter((e) => e.visivel).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * Valida o que veio do banco/rede antes de usar. Modelo corrompido cai no
 * padrão inteiro em vez de quebrar a tela.
 *
 * ⚠️ Os `estilos` são lidos SEMPRE, mesmo quando a lista de elementos é
 * inválida ou ausente. É o que preserva as cores/textos já escolhidos de um
 * modelo salvo no formato antigo (por BLOCO), cuja lista de posições não tem
 * mais como ser aproveitada: o layout volta ao de fábrica, a estilização não se
 * perde.
 */
export function normalizarModelo(bruto: unknown, segmento: SegmentoDashboard): ModeloDashboard {
  const padrao = modeloPadrao(segmento);
  if (!bruto || typeof bruto !== 'object') return padrao;

  const estilos = normalizarEstilos((bruto as { estilos?: unknown }).estilos);
  const lista = (bruto as { elementos?: unknown }).elementos;
  if (!Array.isArray(lista)) return mesclarModelo({ segmento, elementos: [], estilos }, padrao);

  const idsValidos = new Set(padrao.elementos.map((e) => e.id));
  const limpos: ElementoNoModelo[] = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = String(r.id ?? '');
    if (!idsValidos.has(id)) continue; // elemento que não existe mais no código
    limpos.push({
      id,
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      w: Number(r.w) || 3,
      h: Number(r.h) || 2,
      visivel: r.visivel !== false,
    });
  }
  return mesclarModelo({ segmento, elementos: limpos, estilos }, padrao);
}
