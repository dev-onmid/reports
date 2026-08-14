/**
 * Contrato de dados do dashboard de Delivery.
 *
 * Derivado do que o protótipo `docs/dashboard-delivery-v4.jsx` consome — o
 * protótipo gerava esses números com um RNG; aqui eles viram props.
 *
 * ⚠️ Convenção que atravessa o arquivo: `number | null` significa MÉTRICA SEM
 * FONTE, e a UI renderiza "—" com explicação. Nunca use 0 para representar
 * ausência: zero é um valor legítimo (nenhum pedido hoje) e confundir os dois é
 * o que faz um painel mentir sobre operação parada.
 */

// ───────────────────────────────────────────────────────────── Vendas

export type VendasAgregado = {
  receita: number;
  pedidos: number;
  /** Receita ÷ pedidos. `null` sem pedidos no período. */
  ticket: number | null;
  novosClientes: number;
  /** Dias cobertos pela janela — usado em médias diárias e runway. */
  dias: number;
};

/** Ponto da série diária. Dia sem dado NÃO entra (não plotar futuro como zero). */
export type PontoSerie = {
  /** ISO YYYY-MM-DD. */
  data: string;
  /** Rótulo curto pt-BR (dd/mm). */
  label: string;
  receita: number;
  pedidos: number;
  novos: number;
  investimento: number;
};

// ───────────────────────────────────────────────────────────── Funil

/**
 * Funil do catálogo: acesso → visualização de item → carrinho → checkout → pedido.
 *
 * ⚠️ Hoje só o último degrau tem fonte (pedidos, do cardápio digital). Os quatro
 * primeiros exigem instrumentação do catálogo que ainda não existe — por isso
 * são `number | null`, e o componente mostra o degrau como indisponível em vez
 * de desenhar um funil que despenca a zero.
 */
export type EtapaCatalogo = 'acessos' | 'viuItens' | 'carrinho' | 'checkout' | 'pedidos';

export type FunilCatalogo = Record<EtapaCatalogo, number | null>;

export const ETAPAS_CATALOGO: EtapaCatalogo[] = [
  'acessos', 'viuItens', 'carrinho', 'checkout', 'pedidos',
];

export const ROTULO_ETAPA_CATALOGO: Record<EtapaCatalogo, string> = {
  acessos: 'Acessos',
  viuItens: 'Viu itens',
  carrinho: 'Carrinho',
  checkout: 'Checkout',
  pedidos: 'Pedidos',
};

// ───────────────────────────────────────────────────────────── Heatmap

/**
 * Pedidos por dia da semana × faixa de horário.
 *
 * `matriz[faixa][diaDaSemana]`, com diaDaSemana 0=domingo (mesma convenção de
 * `Date.getDay()`), em fuso do ESTABELECIMENTO. Vem dos `created_at` dos pedidos.
 */
export type Heatmap = {
  faixas: string[];
  /** matriz[faixaIndex][dow] — média de pedidos naquela célula. */
  matriz: number[][];
  max: number;
};

export const HEATMAP_VAZIO: Heatmap = { faixas: [], matriz: [], max: 0 };

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ───────────────────────────────────────────────────────── Clientes

/** Distribuição da base por número de pedidos — o argumento comercial da retenção. */
export type FaixaRecorrencia = {
  /** 'Comprou 1 vez', '2 a 4 pedidos'… */
  nome: string;
  clientes: number;
  /** Token de cor do design system (ex: 'primary', 'secondary'). */
  tom: TomGrafico;
};

export type BaseClientes = {
  ativos: number;
  /** Sem pedido há 30–60 dias. */
  emRisco: number;
  /** Sem pedido há mais de 60 dias. */
  inativos: number;
  recorrencia: FaixaRecorrencia[];
  /** Fração da base que voltou (clientes com 2+ pedidos ÷ total). `null` sem base. */
  taxaRecorrencia: number | null;
};

// ───────────────────────────────────────────────────────────── Tráfego

export type CanalTrafego = {
  /** Chave estável — a UI escolhe o logo por aqui, nunca pelo rótulo. */
  canal: 'meta' | 'google' | 'instagram' | 'whatsapp' | 'organico';
  investimento: number;
  impressoes: number | null;
  cliques: number | null;
  /** Resultado reportado pela plataforma (não é pedido pago). */
  resultados: number | null;
  ctr: number | null;
  cpc: number | null;
};

export type Criativo = {
  id: string;
  nome: string;
  formato: string;
  /** URL da thumb real do anúncio. `null` → placeholder neutro, nunca desenho fake. */
  thumbnailUrl: string | null;
  ctr: number | null;
  cpc: number | null;
  roas: number | null;
  pedidos: number | null;
};

export type PresencaInstagram = {
  seguidores: number | null;
  novosSeguidores: number | null;
  alcance: number | null;
  interacoes: number | null;
  salvamentos: number | null;
  visitasPerfil: number | null;
  /** Interações ÷ alcance. */
  engajamento: number | null;
};

// ─────────────────────────────────────────────────────────── Saldos

export type SaldoCanal = {
  canal: 'meta' | 'google';
  saldo: number | null;
  /** Dias que o saldo ainda cobre no ritmo atual. `null` sem ritmo. */
  diasRestantes: number | null;
};

// ─────────────────────────────────────────────── Estado da integração

/**
 * Toda seção que depende de fonte externa carrega isto. `sem_integracao` faz o
 * bloco explicar o que conectar em vez de desenhar zeros.
 */
export type EstadoFonte =
  | { status: 'ok'; atualizadoEm: string | null }
  | { status: 'sem_integracao'; comoConectar: string }
  | { status: 'sem_dado_no_periodo' };

// ──────────────────────────────────────────────────────── Raiz

/** Tudo que o dashboard de delivery precisa para renderizar um período. */
export type DadosDelivery = {
  periodo: { de: string; ate: string };
  fonte: EstadoFonte;
  vendas: VendasAgregado;
  /** Agregado do período ANTERIOR — sustenta os comparativos de custo/pedido e ROAS. `null` sem base. */
  anterior: { receita: number; pedidos: number } | null;
  /** Variação vs período anterior de MESMA duração. `null` sem base anterior. */
  variacao: { receita: number | null; pedidos: number | null; ticket: number | null };
  serie: PontoSerie[];
  funil: FunilCatalogo;
  heatmap: Heatmap;
  clientes: BaseClientes;
  canais: CanalTrafego[];
  criativos: Criativo[];
  instagram: PresencaInstagram;
  saldos: SaldoCanal[];
};

// ────────────────────────────────────────────────── Tokens de cor

/**
 * Tons permitidos nos gráficos, mapeando os tokens do design system. A UI
 * traduz para classe Tailwind — nenhum componente escreve hex.
 */
export type TomGrafico = 'primary' | 'secondary' | 'blue' | 'orange' | 'destructive' | 'muted';

export const CLASSE_TEXTO: Record<TomGrafico, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  blue: 'text-[#0B84FF]',
  orange: 'text-[#FF6B35]',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
};

export const CLASSE_FUNDO: Record<TomGrafico, string> = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  blue: 'bg-[#0B84FF]',
  orange: 'bg-[#FF6B35]',
  destructive: 'bg-destructive',
  muted: 'bg-muted-foreground',
};

/** `currentColor` deixa o SVG herdar a cor da classe — evita hex no componente. */
export const CLASSE_BORDA: Record<TomGrafico, string> = {
  primary: 'border-primary',
  secondary: 'border-secondary',
  blue: 'border-[#0B84FF]',
  orange: 'border-[#FF6B35]',
  destructive: 'border-destructive',
  muted: 'border-border',
};
