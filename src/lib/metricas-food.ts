/**
 * Dicionário de métricas do modo Food/Delivery — seção 7 do briefing.
 *
 * "Fechar estas definições antes de escrever código. Divergência de fórmula
 * entre telas é a principal causa de perda de confiança no painel."
 *
 * ⚠️ A REGRA MAIS IMPORTANTE DESTE ARQUIVO: métrica derivada sem denominador
 * devolve `null`, JAMAIS 0 ou 1. `null` é renderizado como "—" com tooltip.
 * Zerar ou "100%" é mentira — foi exatamente o bug do print 04 do Cardápio Web,
 * onde CMV não cadastrado virava margem de 100% em todas as linhas.
 *
 * Puro e client-safe: sem pg, sem fetch.
 */

import type { FormatoKpi } from '@/lib/dashboard-segmento';

/** Resultado de métrica: `null` = indefinida (sem denominador / sem fonte). */
export type Metrica = number | null;

/** Divisão protegida — a origem de quase todo `null` deste módulo. */
export function razao(numerador: number, denominador: number): Metrica {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null;
  if (denominador === 0) return null;
  return numerador / denominador;
}

// ───────────────────────────────────────────────── Faturamento e decomposição

/**
 * Componentes do faturamento (print 01 do Cardápio Web). Cada parcela é
 * ligável/desligável pelo cliente, e a preferência é persistida por
 * estabelecimento — é o toggle que resolve a briga de "meu faturamento não bate".
 */
export type ComponenteReceita =
  | 'produtos' | 'entrega' | 'servico' | 'adicionais' | 'maquineta' | 'descontos';

/** `descontos` e `maquineta` SUBTRAEM. O sinal mora aqui, não em quem chama. */
export const COMPONENTES_NEGATIVOS: ComponenteReceita[] = ['descontos', 'maquineta'];

export const ROTULO_COMPONENTE: Record<ComponenteReceita, string> = {
  produtos: 'Produtos',
  entrega: 'Taxa de entrega',
  servico: 'Taxa de serviço',
  adicionais: 'Taxas adicionais',
  maquineta: 'Taxa da maquineta',
  descontos: 'Descontos',
};

export type DecomposicaoReceita = Partial<Record<ComponenteReceita, number>>;

/**
 * Faturamento = Σ produtos + taxas SELECIONADAS − descontos.
 *
 * Só entram os componentes em `selecionados` — desligar "taxa da maquineta" tem
 * de mudar o número do topo, senão o toggle é decorativo.
 */
export function calcularFaturamento(
  valores: DecomposicaoReceita,
  selecionados: ComponenteReceita[],
): number {
  let total = 0;
  for (const comp of selecionados) {
    const v = Number(valores[comp] ?? 0);
    if (!Number.isFinite(v)) continue;
    total += COMPONENTES_NEGATIVOS.includes(comp) ? -Math.abs(v) : v;
  }
  return total;
}

/** Participação de cada componente no faturamento — `null` quando não há base. */
export function participacaoComponente(valor: number, faturamento: number): Metrica {
  return razao(valor, faturamento);
}

// ───────────────────────────────────────────────────────── Métricas da seção 7

/** Ticket médio = Faturamento ÷ Pedidos */
export function ticketMedio(faturamento: number, pedidos: number): Metrica {
  return razao(faturamento, pedidos);
}

/** Taxa de conversão do catálogo = Pedidos ÷ Visitantes únicos */
export function conversaoCatalogo(pedidos: number, visitantesUnicos: number): Metrica {
  return razao(pedidos, visitantesUnicos);
}

/** Taxa de recorrência = Pedidos ÷ Clientes únicos */
export function taxaRecorrencia(pedidos: number, clientesUnicos: number): Metrica {
  return razao(pedidos, clientesUnicos);
}

/** Taxa de fidelidade = Clientes com 2+ pedidos ÷ Clientes únicos */
export function taxaFidelidade(clientesComDoisOuMais: number, clientesUnicos: number): Metrica {
  return razao(clientesComDoisOuMais, clientesUnicos);
}

/** ROAS = Receita atribuída ÷ Investimento em mídia */
export function roas(receitaAtribuida: number, investimento: number): Metrica {
  return razao(receitaAtribuida, investimento);
}

/** Custo por pedido = Investimento ÷ Pedidos ATRIBUÍDOS (não o total de pedidos). */
export function custoPorPedido(investimento: number, pedidosAtribuidos: number): Metrica {
  return razao(investimento, pedidosAtribuidos);
}

/** CAC = Investimento ÷ Novos clientes */
export function cac(investimento: number, novosClientes: number): Metrica {
  return razao(investimento, novosClientes);
}

/**
 * Margem = (Receita − CMV) ÷ Receita.
 *
 * ⚠️ `cmv` NULO ou AUSENTE devolve `null` — nunca 100%. Custo não cadastrado não
 * é lucro total; é dado que falta. Este é o caso do print 04 do briefing.
 * `cmv === 0` explícito é tratado como custo real de zero (raro, mas legítimo),
 * então quem não cadastrou deve passar `null`, não `0`.
 */
export function margem(receita: number, cmv: number | null | undefined): Metrica {
  if (cmv === null || cmv === undefined) return null;
  return razao(receita - cmv, receita);
}

/** Tempo médio para pedir, em MINUTOS — média do intervalo disparo → 1º pedido. */
export function tempoMedioParaPedir(intervalosMinutos: number[]): Metrica {
  const validos = intervalosMinutos.filter((n) => Number.isFinite(n) && n >= 0);
  return razao(validos.reduce((s, n) => s + n, 0), validos.length);
}

// ─────────────────────────────────────────────────────────── Comparações

/**
 * Variação percentual contra o período anterior de MESMA DURAÇÃO.
 *
 * ⚠️ Regra transversal do briefing: jamais comparar contra mês-calendário fixo.
 * Sem base anterior (`anterior === 0`) devolve `null` — "+∞%" ou "+100%" a partir
 * do zero é ruído, não informação.
 */
export function variacao(atual: number, anterior: number): Metrica {
  if (!Number.isFinite(atual) || !Number.isFinite(anterior)) return null;
  if (anterior === 0) return null;
  return (atual - anterior) / anterior;
}

// ─────────────────────────────────────────────────────────── Formatação

/**
 * Formatação centralizada — regra transversal do briefing: "Arredondamento e
 * formatação de moeda centralizados numa única função. Nada de toFixed
 * espalhado." Toda métrica da tela passa por aqui.
 *
 * `null` sempre vira o travessão. É o que garante que nenhuma métrica sem
 * denominador apareça como 0% ou 100%.
 */
export const SEM_DADO = '—';

export function formatarMetrica(valor: Metrica, formato: FormatoKpi): string {
  if (valor === null || !Number.isFinite(valor)) return SEM_DADO;
  switch (formato) {
    case 'moeda':
      return valor.toLocaleString('pt-BR', {
        style: 'currency', currency: 'BRL',
        maximumFractionDigits: Math.abs(valor) >= 1000 ? 0 : 2,
      });
    case 'percentual':
      // Recebe fração (0.036), exibe 3,6%.
      return `${(valor * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
    case 'multiplicador':
      return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}x`;
    case 'inteiro':
    default:
      return Math.round(valor).toLocaleString('pt-BR');
  }
}

/** Variação com sinal, para o selinho de comparação. `null` → travessão. */
export function formatarVariacao(v: Metrica): string {
  if (v === null || !Number.isFinite(v)) return SEM_DADO;
  const pct = v * 100;
  const sinal = pct > 0 ? '+' : '';
  return `${sinal}${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

// ─────────────────────────────────────────────────── Procedência do número

/**
 * Seção 9 do briefing: "Distinguir visualmente número medido de número estimado
 * ou atribuído." Atribuição sem UTM é MODELADA e a interface precisa dizer isso
 * — número estimado apresentado como medido destrói a confiança no painel.
 */
export type Procedencia = 'medido' | 'atribuido' | 'estimado' | 'ausente';

export const ROTULO_PROCEDENCIA: Record<Procedencia, string> = {
  medido: 'Medido na fonte',
  atribuido: 'Atribuído por UTM',
  estimado: 'Estimado (sem UTM — atribuição modelada)',
  ausente: 'Sem integração ativa',
};

/**
 * Estado de um bloco que depende de integração externa.
 * `ausente` NUNCA deve renderizar zeros: o print 07 mostra o bloco Delivery com
 * todos os contadores zerados, o que sugere operação parada quando na verdade é
 * integração não conectada.
 */
export type EstadoBloco =
  | { status: 'ok'; atualizadoEm: string | null }
  | { status: 'sem_integracao'; comoConectar: string }
  | { status: 'sem_dado_no_periodo' };

/** "atualizado há X" — carimbo exigido pela seção 9 em bloco de integração. */
export function rotuloAtualizacao(atualizadoEm: string | null, agora: Date): string {
  if (!atualizadoEm) return 'nunca sincronizado';
  const ts = Date.parse(atualizadoEm);
  if (Number.isNaN(ts)) return 'nunca sincronizado';
  const min = Math.max(0, Math.floor((agora.getTime() - ts) / 60000));
  if (min < 1) return 'atualizado agora';
  if (min < 60) return `atualizado há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `atualizado há ${h}h`;
  return `atualizado há ${Math.floor(h / 24)}d`;
}

/**
 * Corta a série no último ponto COM dado.
 *
 * Seção 9: "Não plotar o futuro como zero." A queda abrupta a zero nos prints 01
 * e 03 a partir do dia 12 é corte de dados, não queda de vendas — plotar zero
 * ali faz o cliente achar que a operação parou.
 */
export function cortarSerieNoUltimoDado<T>(
  serie: T[], temDado: (ponto: T) => boolean,
): T[] {
  let ultimo = -1;
  for (let i = 0; i < serie.length; i++) if (temDado(serie[i])) ultimo = i;
  return ultimo < 0 ? [] : serie.slice(0, ultimo + 1);
}

// ─────────────────────────────────────────────────────── Funil unificado

/**
 * A peça central do briefing (seção 6, bloco 4): o bloco que não existe em
 * nenhuma das duas ferramentas. O Cardápio Web não enxerga o investimento e nós
 * não enxergamos o pedido — o cruzamento é o diferencial do produto.
 */
export type EtapaFunilFood =
  | 'impressoes' | 'cliques' | 'visitantes_catalogo' | 'pedidos' | 'receita';

export const ETAPAS_FUNIL_FOOD: EtapaFunilFood[] = [
  'impressoes', 'cliques', 'visitantes_catalogo', 'pedidos', 'receita',
];

export const ROTULO_ETAPA_FOOD: Record<EtapaFunilFood, string> = {
  impressoes: 'Impressões',
  cliques: 'Cliques',
  visitantes_catalogo: 'Visitantes do catálogo',
  pedidos: 'Pedidos',
  receita: 'Receita',
};

/** Fonte de cada etapa — a tela mostra isso porque metade vem de fora. */
export const FONTE_ETAPA_FOOD: Record<EtapaFunilFood, string> = {
  impressoes: 'Meta / Google',
  cliques: 'Meta / Google',
  visitantes_catalogo: 'Cardápio Web',
  pedidos: 'Cardápio Web',
  receita: 'Cardápio Web',
};

export type FunilFood = Record<EtapaFunilFood, number | null>;

/**
 * Taxa de passagem entre duas etapas consecutivas. `null` quando a etapa
 * anterior não tem dado — o elo "visitantes do catálogo" é justamente o que hoje
 * não temos, então esta função devolve `null` com frequência e a UI precisa
 * lidar com isso sem inventar 0%.
 */
export function taxaPassagem(funil: FunilFood, de: EtapaFunilFood, para: EtapaFunilFood): Metrica {
  const a = funil[de];
  const b = funil[para];
  if (a === null || b === null) return null;
  return razao(b, a);
}
