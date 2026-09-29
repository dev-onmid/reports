/**
 * Perfil do dashboard por SEGMENTO — a fonte única de "o que este cliente vê".
 *
 * Tese do briefing (Modo Food/Delivery, seção 5): a diferença entre lead-gen e
 * food é de PERFIL DE CONFIGURAÇÃO, não de aplicação. O mesmo esqueleto de tela
 * troca KPIs, rótulos e visibilidade de blocos a partir daqui. Se implementar um
 * segmento novo exigir duplicar tela, a arquitetura está errada.
 *
 * Puro e client-safe: sem pg, sem fetch — a tela e os testes importam daqui.
 *
 * ⚠️ O segmento vem de `clients.dashboard_type` (TEXT, default 'leads'), coluna
 * que JÁ EXISTIA. Não criar campo novo.
 */

/**
 * ⚠️ `leads` É o "Leads + R$" (com faturamento) — o valor que a carteira quase
 * inteira já tinha e a coluna já nasce com. O "Leads" sem faturamento é o valor
 * NOVO `leads_cpl` (pedido do Matheus, 29/09). Inverter isso exigiria migrar
 * 36 clientes e o default da coluna, e todo `?? 'leads'` do código passaria a
 * esconder o faturamento em silêncio.
 */
export type SegmentoDashboard = 'leads' | 'leads_cpl' | 'branding' | 'food';

/**
 * Valores legados (`conversao`, `clinicas`) caem em `leads`: eram cópias do
 * lead-gen com faturamento e saíram das opções — quem os tinha continua vendo
 * exatamente a mesma tela.
 */
export function normalizarSegmento(v: unknown): SegmentoDashboard {
  if (v === 'food' || v === 'delivery') return 'food';
  if (v === 'leads_cpl') return 'leads_cpl';
  if (v === 'branding') return 'branding';
  return 'leads';
}

/** As opções dos seletores de "Tipo de dashboard", na ordem em que aparecem. */
export const OPCOES_TIPO_DASHBOARD: Array<{ valor: SegmentoDashboard; rotulo: string; dica: string }> = [
  { valor: 'leads_cpl', rotulo: 'Leads', dica: 'Metas de leads e CPL; sem faturamento — o resultado final é a última etapa do funil' },
  { valor: 'leads', rotulo: 'Leads + R$', dica: 'Leads e faturamento (padrão)' },
  { valor: 'branding', rotulo: 'Branding', dica: 'Só métricas de tráfego, sem metas, com comparativo de período' },
  { valor: 'food', rotulo: 'Food / Delivery', dica: 'Pedidos, recorrência e delivery' },
];

// ─────────────────────────────────────────────────────────── Blocos da tela

/**
 * Blocos do dashboard, na ordem canônica do modo food (seção 6 do briefing).
 * `lead-gen` reordena/oculta a partir do mesmo conjunto — nenhum bloco é
 * exclusivo de um segmento no código, só na configuração.
 */
export type BlocoDashboard =
  | 'resultado_negocio'      // Faturamento · Pedidos · Ticket (food) / Faturamento · Leads (lead-gen)
  | 'kpis_topo'              // faixa de KPIs rápidos
  | 'decomposicao_receita'   // NOVO no food — produtos + taxas − descontos
  | 'funil_unificado'        // NOVO no food — impressões → … → receita (peça central)
  | 'funil_leads'            // funil de performance do lead-gen
  | 'clientes_retencao'      // novos/recorrentes/reconquistados/em risco/inativos
  | 'mix_produtos'           // NOVO no food
  | 'resumo_trafego'         // Meta + Google lado a lado
  | 'canais'                 // tabela de canais (food inclui WhatsApp e Orgânico)
  | 'campanhas_whatsapp'     // NOVO no food
  | 'midia_paga'             // campanhas Meta + criativos
  | 'google_ads'
  | 'instagram'
  | 'resumo_clientes';       // quando há vários clientes selecionados

/** `colapsado` = renderiza recolhido; `auto_colapsa_vazio` = recolhe sozinho sem dado. */
export type VisibilidadeBloco = {
  bloco: BlocoDashboard;
  colapsado?: boolean;
  /** Some da tela quando não há dado — em vez de ocupar seção inteira com estado vazio (print 09). */
  autoColapsaVazio?: boolean;
  /** Só aparece se a condição for satisfeita pela tela (ex: integração de WhatsApp ativa). */
  condicional?: 'whatsapp_atribuido' | 'tem_delivery';
};

// ─────────────────────────────────────────────────────────── KPIs

/**
 * Catálogo de KPIs. `chave` é estável e é o que liga KPI ↔ meta ↔ rótulo —
 * NUNCA use o rótulo como identificador, porque ele muda por segmento.
 */
export type ChaveKpi =
  | 'faturamento' | 'pedidos' | 'ticket_medio'
  | 'leads' | 'conversas' | 'agendamentos'
  | 'investimento' | 'custo_por_pedido' | 'cpl'
  | 'roas' | 'roi' | 'cac'
  | 'conversao_catalogo' | 'conversao_geral'
  | 'taxa_recorrencia' | 'taxa_fidelidade'
  | 'seguidores';

export type FormatoKpi = 'moeda' | 'inteiro' | 'percentual' | 'multiplicador';

export type DefinicaoKpi = {
  chave: ChaveKpi;
  rotulo: string;
  formato: FormatoKpi;
  /** true = número menor é melhor (custo). Usado para colorir a variação. */
  menorMelhor?: boolean;
  /** Pode receber meta? Nem todo KPI faz sentido como alvo. */
  metaPermitida?: boolean;
};

/**
 * Rótulos por segmento. O mesmo conceito muda de nome — é o "vocabulário
 * trocado por segmento" do briefing. Em food: Leads vira Pedidos, CPL vira
 * Custo por pedido, Conversão geral vira Conversão do catálogo.
 */
const KPIS_BASE: Record<ChaveKpi, DefinicaoKpi> = {
  faturamento:        { chave: 'faturamento',        rotulo: 'Faturamento',        formato: 'moeda',          metaPermitida: true },
  pedidos:            { chave: 'pedidos',            rotulo: 'Pedidos',            formato: 'inteiro',        metaPermitida: true },
  ticket_medio:       { chave: 'ticket_medio',       rotulo: 'Ticket médio',       formato: 'moeda',          metaPermitida: true },
  leads:              { chave: 'leads',              rotulo: 'Leads',              formato: 'inteiro',        metaPermitida: true },
  conversas:          { chave: 'conversas',          rotulo: 'Conversas',          formato: 'inteiro',        metaPermitida: true },
  agendamentos:       { chave: 'agendamentos',       rotulo: 'Agendamentos',       formato: 'inteiro',        metaPermitida: true },
  investimento:       { chave: 'investimento',       rotulo: 'Investimento total', formato: 'moeda',          metaPermitida: true },
  custo_por_pedido:   { chave: 'custo_por_pedido',   rotulo: 'Custo por pedido',   formato: 'moeda',          menorMelhor: true, metaPermitida: true },
  cpl:                { chave: 'cpl',                rotulo: 'CPL médio',          formato: 'moeda',          menorMelhor: true, metaPermitida: true },
  roas:               { chave: 'roas',               rotulo: 'ROAS',               formato: 'multiplicador',  metaPermitida: true },
  roi:                { chave: 'roi',                rotulo: 'ROI',                formato: 'multiplicador',  metaPermitida: true },
  cac:                { chave: 'cac',                rotulo: 'CAC',                formato: 'moeda',          menorMelhor: true, metaPermitida: true },
  conversao_catalogo: { chave: 'conversao_catalogo', rotulo: 'Conversão do catálogo', formato: 'percentual',  metaPermitida: true },
  conversao_geral:    { chave: 'conversao_geral',    rotulo: 'Conversão geral',    formato: 'percentual',     metaPermitida: true },
  taxa_recorrencia:   { chave: 'taxa_recorrencia',   rotulo: 'Taxa de recorrência', formato: 'percentual',    metaPermitida: true },
  taxa_fidelidade:    { chave: 'taxa_fidelidade',    rotulo: 'Taxa de fidelidade', formato: 'percentual',     metaPermitida: true },
  seguidores:         { chave: 'seguidores',         rotulo: 'Seguidores',         formato: 'inteiro',        metaPermitida: true },
};

export function definicaoKpi(chave: ChaveKpi): DefinicaoKpi {
  return KPIS_BASE[chave];
}

/**
 * TODOS os KPIs que aceitam meta — a lista que a tela de cadastro oferece.
 *
 * ⚠️ Metas NÃO são exclusivas de um segmento: o cliente de food pode ter meta de
 * seguidores, e o de lead-gen pode ter meta de faturamento. O segmento decide o
 * que aparece por PADRÃO no topo (`metasSugeridas`), não o que é permitido.
 */
export function kpisComMetaPermitida(): DefinicaoKpi[] {
  return Object.values(KPIS_BASE).filter((k) => k.metaPermitida);
}

// ─────────────────────────────────────────────────────────── Perfis

export type PerfilSegmento = {
  segmento: SegmentoDashboard;
  /** Aparece como badge no header, ao lado do seletor de cliente. */
  rotuloSegmento: string;
  /** KPIs da faixa rápida, na ordem. */
  kpisTopo: ChaveKpi[];
  /** Metas mostradas por padrão no topo quando o cliente não configurou nenhuma. */
  metasSugeridas: ChaveKpi[];
  /** Ordem + visibilidade dos blocos. Bloco ausente da lista não renderiza. */
  blocos: VisibilidadeBloco[];
  /** Faturamento, ticket, ROAS, CAC, %FAT e vendas por anúncio aparecem. */
  receita: boolean;
  /** Cards de meta (bullet) e comparação contra meta do planejamento. */
  metas: boolean;
  /** Funil de performance e tudo que vem do CRM (canais, regiões, comercial). */
  funil: boolean;
};

const PERFIL_LEADS: PerfilSegmento = {
  segmento: 'leads',
  rotuloSegmento: 'Leads + R$',
  receita: true, metas: true, funil: true,
  kpisTopo: ['investimento', 'cpl', 'conversas', 'agendamentos', 'roi', 'conversao_geral'],
  metasSugeridas: ['faturamento', 'leads'],
  blocos: [
    { bloco: 'resultado_negocio' },
    { bloco: 'kpis_topo' },
    { bloco: 'resumo_trafego' },
    { bloco: 'funil_leads' },
    { bloco: 'canais' },
    { bloco: 'instagram' },
    { bloco: 'midia_paga' },
    { bloco: 'google_ads' },
    { bloco: 'resumo_clientes' },
  ],
};

/**
 * Modo food — ordem da seção 6 do briefing.
 *
 * O que SAI ou vira condicional (seção 6, segunda metade):
 *  • Agendamentos → oculto (conceito exclusivo de lead-gen, sem equivalente).
 *  • Conversas → condicional: só com WhatsApp/Direct atribuído.
 *  • CPL médio → renomeado e recalculado como Custo por pedido.
 *  • Leads → substituído por Pedidos em todo rótulo.
 *  • Google Ads → colapsa sozinho quando não há investimento no período.
 *  • Conversão geral → redefinida como conversão do catálogo (visitante → pedido).
 *  • Instagram → mantém o conteúdo, recolhido por padrão.
 */
const PERFIL_FOOD: PerfilSegmento = {
  segmento: 'food',
  rotuloSegmento: 'Food / Delivery',
  receita: true, metas: true, funil: true,
  kpisTopo: ['investimento', 'custo_por_pedido', 'roas', 'cac', 'conversao_catalogo', 'ticket_medio'],
  metasSugeridas: ['faturamento', 'pedidos'],
  blocos: [
    { bloco: 'resultado_negocio' },
    { bloco: 'kpis_topo' },
    { bloco: 'decomposicao_receita' },
    { bloco: 'funil_unificado' },
    { bloco: 'clientes_retencao' },
    { bloco: 'mix_produtos' },
    { bloco: 'canais' },
    { bloco: 'campanhas_whatsapp' },
    { bloco: 'midia_paga' },
    { bloco: 'google_ads', autoColapsaVazio: true },
    { bloco: 'instagram', colapsado: true },
    { bloco: 'resumo_clientes' },
  ],
};

/**
 * Leads (sem faturamento) — pedido do Matheus, 29/09: cliente cujo resultado
 * final é a ÚLTIMA ETAPA do funil (reunião, contrato, matrícula), não venda com
 * valor. As metas viram leads e CPL, e tudo que é R$ de venda some da tela.
 *
 * ⚠️ Cópia das LISTAS, não `...PERFIL_LEADS` — spread é raso e a primeira
 * customização deste perfil mudaria o de todo o resto junto.
 */
const PERFIL_LEADS_CPL: PerfilSegmento = {
  segmento: 'leads_cpl',
  rotuloSegmento: 'Leads',
  receita: false, metas: true, funil: true,
  kpisTopo: ['investimento', 'cpl', 'conversas', 'agendamentos', 'conversao_geral'],
  metasSugeridas: ['leads', 'cpl'],
  blocos: PERFIL_LEADS.blocos.map((b) => ({ ...b })),
};

/**
 * Branding — só tráfego (investimento, alcance, impressões, cliques, CTR, CPC,
 * CPM), SEM metas e sem CRM, mas com o comparativo contra o período anterior.
 */
const PERFIL_BRANDING: PerfilSegmento = {
  segmento: 'branding',
  rotuloSegmento: 'Branding',
  receita: false, metas: false, funil: false,
  kpisTopo: ['investimento'],
  metasSugeridas: [],
  blocos: [
    { bloco: 'kpis_topo' },
    { bloco: 'resumo_trafego' },
    { bloco: 'instagram' },
    { bloco: 'midia_paga' },
    { bloco: 'google_ads' },
    { bloco: 'resumo_clientes' },
  ],
};

const PERFIS: Record<SegmentoDashboard, PerfilSegmento> = {
  leads: PERFIL_LEADS,
  leads_cpl: PERFIL_LEADS_CPL,
  branding: PERFIL_BRANDING,
  food: PERFIL_FOOD,
};

export function perfilDoSegmento(segmento: SegmentoDashboard): PerfilSegmento {
  return PERFIS[segmento];
}

/**
 * Perfil de uma SELEÇÃO de clientes. Seleção mista (food + lead-gen) cai no
 * lead-gen de propósito: somar recorrência de pedidos com funil de leads produz
 * um agregado que não descreve nem um nem outro. Só vira food quando todos os
 * selecionados são food.
 */
export function perfilDaSelecao(segmentos: SegmentoDashboard[]): PerfilSegmento {
  if (segmentos.length === 0) return PERFIL_LEADS;
  // Só assume um perfil quando TODOS os selecionados são dele. Seleção mista
  // cai no lead-gen: somar recorrência de pedidos com funil de leads produz um
  // agregado que não descreve nenhum dos dois.
  // Mista sem food cai no mais COMPLETO (Leads + R$): esconder faturamento de um
  // cliente que tem por causa de outro que não tem seria pior que mostrar "—".
  for (const seg of ['food', 'leads_cpl', 'branding'] as const) {
    if (segmentos.every((s) => s === seg)) return PERFIS[seg];
  }
  return PERFIL_LEADS;
}

export function blocoVisivel(perfil: PerfilSegmento, bloco: BlocoDashboard): boolean {
  return perfil.blocos.some((b) => b.bloco === bloco);
}

export function configDoBloco(perfil: PerfilSegmento, bloco: BlocoDashboard): VisibilidadeBloco | null {
  return perfil.blocos.find((b) => b.bloco === bloco) ?? null;
}

/** Índice do bloco na ordem do perfil — para ordenar a renderização. */
export function ordemDoBloco(perfil: PerfilSegmento, bloco: BlocoDashboard): number {
  const i = perfil.blocos.findIndex((b) => b.bloco === bloco);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** Rótulo do KPI já no vocabulário do segmento. */
export function rotuloKpi(perfil: PerfilSegmento, chave: ChaveKpi): string {
  // O vocabulário já está embutido nas chaves escolhidas por perfil (pedidos vs
  // leads, custo_por_pedido vs cpl), então o rótulo base basta. A função existe
  // para que a tela nunca escreva rótulo na mão.
  void perfil;
  return KPIS_BASE[chave].rotulo;
}
