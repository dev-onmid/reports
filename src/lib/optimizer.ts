export const OPTIMIZER_MODEL = 'claude-sonnet-4-6';
export const OPTIMIZER_PROMPT_VERSION = 'otimizador-v1.0';

export type OptimizerCriticalLevel = 'vermelho' | 'amarelo' | 'verde';
export type OptimizerConfidence = 'alta' | 'media' | 'baixa';
export type OptimizerPlatform = 'meta_ads' | 'google_ads';
export type OptimizerRequestKind = 'analise_completa' | 'sugestao_criativo' | 'diagnostico_rapido';
export type OptimizerPeriodKey = 'yesterday' | 'last_3d' | 'last_7d' | 'last_21d' | 'last_30d' | 'last_90d';
export type OptimizerNiche =
  | 'odontologia'
  | 'estetica'
  | 'gastronomia'
  | 'advocacia'
  | 'contabilidade'
  | 'ecommerce'
  | 'industria'
  | 'agencia'
  | 'outro';

export type OptimizerPayload = {
  cliente_id: string;
  cliente_nome: string;
  nicho: OptimizerNiche;
  conta_plataforma: OptimizerPlatform;
  metas_do_cliente: {
    objetivo_campanha: OptimizerObjective;
    cpl_meta: number | null;
    cpa_meta: number | null;
    roas_meta: number | null;
    orcamento_mensal: number | null;
    orcamento_diario: number | null;
    leads_meta_dia: number | null;
    periodo_analise_dias: number;
  };
  dados_da_conta: {
    nivel: 'conjunto' | 'campanha' | 'anuncio';
    conjunto_id: string;
    conjunto_nome: string;
    campanha_nome: string;
    status: string;
    dias_rodando: number | null;
    total_conversoes_historico: number | null;
    aprovacao_aumento?: boolean;
    dias_consecutivos_subentrega?: number | null;
    metricas_periodo: {
      dias_analisados: number;
      gasto_total: number;
      impressoes: number;
      cliques_link: number;
      ctr_link: number;
      cpm: number | null;
      cpc: number | null;
      frequencia: number | null;
      conversoes: number;
      cpl_cpa_atual: number | null;
      roas_atual: number | null;
      taxa_conversao_lp: number | null;
      leads_por_dia_media: number | null;
      ritmo_gasto_percentual: number | null;
      gasto_percentual_do_diario?: number | null;
    };
    tendencia_7_dias: {
      cpl_variacao_percentual: number | null;
      ctr_variacao_percentual: number | null;
      cpm_variacao_percentual: number | null;
      frequencia_variacao: number | null;
      conversoes_variacao_percentual: number | null;
    };
    criativos_ativos: Array<{
      criativo_id: string;
      nome: string;
      dias_ativo: number | null;
      gasto: number;
      ctr: number | null;
      cpl: number | null;
      impressoes: number;
      conversoes: number;
    }>;
    publico_info: {
      tipo: 'interesse' | 'lookalike' | 'remarketing' | 'broad' | 'pesquisa' | 'shopping' | 'display' | 'outro';
      tamanho_estimado: number | null;
      raio_km: number | null;
      faixa_etaria: string | null;
      genero: 'todos' | 'feminino' | 'masculino' | null;
    };
    acoes_disponiveis_no_sistema: string[];
  };
  contexto_adicional: {
    solicitacao: OptimizerRequestKind;
    janela_analise?: string;
    observacao_do_gestor?: string;
  };
};

export type OptimizerAction = {
  prioridade: number;
  acao: string;
  por_que: string;
  executavel_pelo_sistema: boolean;
  endpoint_sugerido: string | null;
};

export type OptimizerDiagnosis = {
  cliente_id: string;
  conjunto_id: string;
  nivel_critico: OptimizerCriticalLevel;
  titulo_problema: string;
  o_que_esta_acontecendo: string;
  acoes: OptimizerAction[];
  metricas_que_embasam: Record<string, string>;
  sugestao_criativo: string | null;
  confianca: OptimizerConfidence;
  observacao: string | null;
};

export type OptimizerAnalysisResult = OptimizerDiagnosis & {
  recomendacao_id: string;
  origem: 'camada_1' | 'ia' | 'cache' | 'fallback';
  prompt_version: string;
  modelo_usado: string | null;
  tokens_usados: number;
  custo_estimado_usd: number;
};

export type OptimizerObjective = 'leads' | 'trafego' | 'vendas' | 'engajamento' | 'reconhecimento' | 'app' | null;

export type OptimizerCampaignInput = {
  id: string;
  name: string;
  platform: 'meta' | 'google';
  accountName?: string;
  status: string;
  objective?: string;
  dailyBudget?: number;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number;
};

export type OptimizerClientInput = {
  id: string;
  name: string;
  segment?: string;
};

export const OPTIMIZER_PERIODS: Array<{ key: OptimizerPeriodKey; label: string; days: number }> = [
  { key: 'yesterday', label: 'Ontem', days: 1 },
  { key: 'last_3d', label: 'Últimos 3 dias', days: 3 },
  { key: 'last_7d', label: 'Últimos 7 dias', days: 7 },
  { key: 'last_21d', label: 'Últimos 21 dias', days: 21 },
  { key: 'last_30d', label: 'Últimos 30 dias', days: 30 },
  { key: 'last_90d', label: 'Últimos 3 meses', days: 90 },
];

const DEFAULT_ACTIONS = [
  'pausar_conjunto',
  'pausar_anuncio',
  'aumentar_orcamento',
  'reduzir_orcamento',
  'gerar_briefing_criativo',
  'notificar_gestor',
  'abrir_para_edicao_manual',
];

export function optimizerPeriodDays(key: OptimizerPeriodKey | string): number {
  return OPTIMIZER_PERIODS.find((period) => period.key === key)?.days ?? 7;
}

export function segmentToOptimizerNiche(segment: string | undefined): OptimizerNiche {
  const value = (segment ?? '').toLowerCase();
  if (value.includes('odonto') || value.includes('saude') || value.includes('saúde')) return 'odontologia';
  if (value.includes('estet')) return 'estetica';
  if (value.includes('gastro') || value.includes('delivery') || value.includes('food')) return 'gastronomia';
  if (value.includes('advoc')) return 'advocacia';
  if (value.includes('contab')) return 'contabilidade';
  if (value.includes('ecom') || value.includes('loja')) return 'ecommerce';
  if (value.includes('industr')) return 'industria';
  if (value.includes('agenc')) return 'agencia';
  return 'outro';
}

function numberOrNull(value: number | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function buildOptimizerPayloadFromCampaign(params: {
  client: OptimizerClientInput;
  campaign: OptimizerCampaignInput;
  periodKey: OptimizerPeriodKey | string;
  cplMeta: number | null;
  requestKind?: OptimizerRequestKind;
  managerNote?: string;
}): OptimizerPayload {
  const { client, campaign, periodKey, cplMeta, requestKind = 'analise_completa', managerNote = '' } = params;
  const days = optimizerPeriodDays(periodKey);
  const dailyBudget = campaign.dailyBudget ?? null;
  const cpm = campaign.impressions > 0 ? (campaign.spend / campaign.impressions) * 1000 : null;
  const leadsPerDay = campaign.leads > 0 ? campaign.leads / days : 0;
  const rhythm = dailyBudget && dailyBudget > 0
    ? Math.round((campaign.spend / (dailyBudget * days)) * 1000) / 10
    : null;

  return {
    cliente_id: client.id,
    cliente_nome: client.name,
    nicho: segmentToOptimizerNiche(client.segment),
    conta_plataforma: campaign.platform === 'meta' ? 'meta_ads' : 'google_ads',
    metas_do_cliente: {
      objetivo_campanha: (campaign.objective as OptimizerObjective) ?? null,
      cpl_meta: cplMeta,
      cpa_meta: null,
      roas_meta: null,
      orcamento_mensal: dailyBudget ? dailyBudget * 30 : null,
      orcamento_diario: dailyBudget,
      leads_meta_dia: cplMeta && dailyBudget ? Math.max(1, Math.round(dailyBudget / cplMeta)) : null,
      periodo_analise_dias: days,
    },
    dados_da_conta: {
      nivel: 'campanha',
      conjunto_id: campaign.id,
      conjunto_nome: campaign.name,
      campanha_nome: campaign.name,
      status: campaign.status,
      dias_rodando: null,
      total_conversoes_historico: campaign.leads,
      aprovacao_aumento: false,
      dias_consecutivos_subentrega: null,
      metricas_periodo: {
        dias_analisados: days,
        gasto_total: campaign.spend,
        impressoes: campaign.impressions,
        cliques_link: campaign.clicks,
        ctr_link: campaign.ctr,
        cpm,
        cpc: numberOrNull(campaign.cpc),
        frequencia: null,
        conversoes: campaign.leads,
        cpl_cpa_atual: campaign.cpl > 0 ? campaign.cpl : null,
        roas_atual: null,
        taxa_conversao_lp: null,
        leads_por_dia_media: leadsPerDay,
        ritmo_gasto_percentual: rhythm,
        gasto_percentual_do_diario: rhythm,
      },
      tendencia_7_dias: {
        cpl_variacao_percentual: null,
        ctr_variacao_percentual: null,
        cpm_variacao_percentual: null,
        frequencia_variacao: null,
        conversoes_variacao_percentual: null,
      },
      criativos_ativos: [],
      publico_info: {
        tipo: campaign.platform === 'google' ? 'pesquisa' : 'outro',
        tamanho_estimado: null,
        raio_km: null,
        faixa_etaria: null,
        genero: null,
      },
      acoes_disponiveis_no_sistema: DEFAULT_ACTIONS,
    },
    contexto_adicional: {
      solicitacao: requestKind,
      janela_analise: OPTIMIZER_PERIODS.find((period) => period.key === periodKey)?.label,
      observacao_do_gestor: managerNote.trim() || undefined,
    },
  };
}

export function optimizerImpactScore(result: OptimizerAnalysisResult): number {
  const levelWeight = result.nivel_critico === 'vermelho' ? 1000 : result.nivel_critico === 'amarelo' ? 500 : 100;
  const confidenceWeight = result.confianca === 'alta' ? 60 : result.confianca === 'media' ? 30 : 10;
  return levelWeight + confidenceWeight + Math.max(0, 10 - result.acoes.length);
}

function brl(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'indisponivel';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function percent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'indisponivel';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')}%`;
}

function signedDiff(actual: number, target: number): string {
  if (!target) return 'sem referencia';
  return `${percent(((actual - target) / target) * 100)} da referencia`;
}

function base(payload: OptimizerPayload): Pick<OptimizerDiagnosis, 'cliente_id' | 'conjunto_id'> {
  return {
    cliente_id: payload.cliente_id,
    conjunto_id: payload.dados_da_conta.conjunto_id,
  };
}

function normalizeActions(payload: OptimizerPayload): string[] {
  return payload.dados_da_conta.acoes_disponiveis_no_sistema?.length
    ? payload.dados_da_conta.acoes_disponiveis_no_sistema
    : DEFAULT_ACTIONS;
}

function executable(payload: OptimizerPayload, action: string): boolean {
  return normalizeActions(payload).includes(action);
}

function poorCreative(payload: OptimizerPayload) {
  const meta = payload.metas_do_cliente.cpl_meta ?? payload.metas_do_cliente.cpa_meta;
  return [...payload.dados_da_conta.criativos_ativos]
    .filter((creative) => creative.cpl != null && creative.gasto > 0)
    .sort((a, b) => {
      const aScore = (a.cpl ?? 0) / Math.max(meta ?? 1, 1);
      const bScore = (b.cpl ?? 0) / Math.max(meta ?? 1, 1);
      return bScore - aScore;
    })[0] ?? null;
}

export function applyLayerOneRules(payload: OptimizerPayload): OptimizerDiagnosis | null {
  const goals = payload.metas_do_cliente;
  const data = payload.dados_da_conta;
  const metrics = data.metricas_periodo;
  const audience = data.publico_info;
  const objetivo = goals.objetivo_campanha;
  const isLeadsOrSales = !objetivo || objetivo === 'leads' || objetivo === 'vendas';
  const isTraffic = objetivo === 'trafego';
  const target = goals.cpl_meta ?? goals.cpa_meta;
  const currentCost = metrics.cpl_cpa_atual;
  const daysRunning = data.dias_rodando ?? 0;
  const conversionsHistory = data.total_conversoes_historico ?? metrics.conversoes;
  const badCreative = poorCreative(payload);

  if (isLeadsOrSales && target && currentCost && currentCost > target * 2 && daysRunning > 14 && conversionsHistory > 50) {
    return {
      ...base(payload),
      nivel_critico: 'vermelho',
      titulo_problema: 'CPL critico acima da meta',
      o_que_esta_acontecendo: `O custo atual esta em ${brl(currentCost)}, mais que o dobro da meta de ${brl(target)}. Como a campanha ja rodou ${daysRunning} dias e tem ${conversionsHistory} conversoes historicas, ha volume suficiente para intervir.`,
      acoes: [
        {
          prioridade: 1,
          acao: badCreative
            ? `Pausar o criativo "${badCreative.nome}" com CPL de ${brl(badCreative.cpl)}`
            : 'Pausar os criativos com pior CPL',
          por_que: `O CPL esta ${signedDiff(currentCost, target)}, consumindo verba acima do limite aceitavel.`,
          executavel_pelo_sistema: executable(payload, 'pausar_anuncio'),
          endpoint_sugerido: badCreative ? `PATCH /ads/${badCreative.criativo_id}/status {status: 'paused'}` : 'pausar_anuncio',
        },
        {
          prioridade: 2,
          acao: 'Revisar segmentacao antes de aumentar verba',
          por_que: 'A campanha ja tem historico, entao manter a entrega atual tende a repetir o desperdicio.',
          executavel_pelo_sistema: executable(payload, 'abrir_para_edicao_manual'),
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
      ],
      metricas_que_embasam: {
        cpl_atual: brl(currentCost),
        meta: brl(target),
        desvio: signedDiff(currentCost, target),
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: null,
    };
  }

  if ((metrics.frequencia ?? 0) > 4 && audience.tipo === 'interesse' && metrics.ctr_link > 1.5) {
    return {
      ...base(payload),
      nivel_critico: 'amarelo',
      titulo_problema: 'Publico saturando',
      o_que_esta_acontecendo: `A frequencia chegou a ${metrics.frequencia?.toFixed(1)} enquanto o CTR segue em ${metrics.ctr_link.toFixed(2)}%. O criativo ainda chama atencao, mas o mesmo publico esta sendo impactado vezes demais.`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Expandir o publico atual com interesses complementares',
          por_que: 'A entrega precisa de novo inventario antes que o custo por resultado piore.',
          executavel_pelo_sistema: executable(payload, 'abrir_para_edicao_manual'),
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
        {
          prioridade: 2,
          acao: 'Criar lookalike a partir dos leads recentes',
          por_que: 'O CTR indica que a mensagem funciona; o melhor proximo teste e renovar a audiencia.',
          executavel_pelo_sistema: executable(payload, 'abrir_para_edicao_manual'),
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
      ],
      metricas_que_embasam: {
        frequencia: `${metrics.frequencia?.toFixed(1)} (limite recomendado: 4,0)`,
        ctr_link: `${metrics.ctr_link.toFixed(2)}%`,
        publico: audience.tipo,
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: 'Nao pause o criativo principal apenas por frequencia alta; o sinal aponta primeiro para saturacao de publico.',
    };
  }

  if (
    goals.roas_meta
    && metrics.roas_atual
    && metrics.roas_atual > goals.roas_meta * 1.3
    && (metrics.frequencia ?? 0) < 2.5
    && (metrics.ritmo_gasto_percentual ?? 0) < 95
  ) {
    return {
      ...base(payload),
      nivel_critico: 'verde',
      titulo_problema: 'Oportunidade de escala',
      o_que_esta_acontecendo: `O ROAS atual esta ${signedDiff(metrics.roas_atual, goals.roas_meta)} e a frequencia segue baixa. A campanha ainda tem espaco de entrega sem pressionar o orcamento.`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Aumentar o orcamento em 20%',
          por_que: 'O retorno esta acima da meta e o ritmo de gasto ainda nao chegou ao limite.',
          executavel_pelo_sistema: executable(payload, 'aumentar_orcamento'),
          endpoint_sugerido: 'PATCH /adsets/{id}/budget',
        },
      ],
      metricas_que_embasam: {
        roas_atual: String(metrics.roas_atual),
        roas_meta: String(goals.roas_meta),
        ritmo_gasto: percent(metrics.ritmo_gasto_percentual),
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: null,
    };
  }

  if ((metrics.ritmo_gasto_percentual ?? 0) > 115 && data.aprovacao_aumento === false) {
    return {
      ...base(payload),
      nivel_critico: 'vermelho',
      titulo_problema: 'Orcamento vai estourar',
      o_que_esta_acontecendo: `O ritmo de gasto esta em ${percent(metrics.ritmo_gasto_percentual)}, acima do planejado. Sem aprovacao de aumento, a conta tende a ultrapassar o limite combinado.`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Reduzir o orcamento diario',
          por_que: 'A reducao corrige o ritmo antes do fechamento do periodo.',
          executavel_pelo_sistema: executable(payload, 'reduzir_orcamento'),
          endpoint_sugerido: 'PATCH /adsets/{id}/budget',
        },
        {
          prioridade: 2,
          acao: 'Adicionar limite de campanha',
          por_que: 'O limite evita que a campanha volte a acelerar acima do aprovado.',
          executavel_pelo_sistema: false,
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
      ],
      metricas_que_embasam: {
        ritmo_gasto: percent(metrics.ritmo_gasto_percentual),
        aprovacao_aumento: 'false',
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: null,
    };
  }

  if ((metrics.gasto_percentual_do_diario ?? 100) < 70 && (data.dias_consecutivos_subentrega ?? 0) >= 3) {
    return {
      ...base(payload),
      nivel_critico: 'amarelo',
      titulo_problema: 'Subentrega de orcamento',
      o_que_esta_acontecendo: `A campanha vem usando menos de 70% do diario por ${data.dias_consecutivos_subentrega} dias. Ha verba disponivel, mas a entrega nao esta conseguindo gastar.`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Verificar anuncios reprovados ou limitados',
          por_que: 'Reprovacao e aprendizado limitado sao causas comuns de verba parada.',
          executavel_pelo_sistema: executable(payload, 'abrir_para_edicao_manual'),
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
        {
          prioridade: 2,
          acao: 'Ampliar publico',
          por_que: 'Se nao houver reprovas, o publico pode estar estreito demais para o orcamento.',
          executavel_pelo_sistema: executable(payload, 'abrir_para_edicao_manual'),
          endpoint_sugerido: 'abrir_para_edicao_manual',
        },
      ],
      metricas_que_embasam: {
        gasto_do_diario: percent(metrics.gasto_percentual_do_diario),
        dias_subentrega: String(data.dias_consecutivos_subentrega),
      },
      sugestao_criativo: null,
      confianca: 'media',
      observacao: null,
    };
  }

  if (metrics.ctr_link < 0.8 && (metrics.frequencia ?? 0) < 2 && daysRunning > 5) {
    return {
      ...base(payload),
      nivel_critico: 'vermelho',
      titulo_problema: 'Criativo nao gera cliques',
      o_que_esta_acontecendo: `O CTR esta em ${metrics.ctr_link.toFixed(2)}% com frequencia abaixo de 2. O publico ainda nao esta saturado; o problema mais provavel e a promessa ou visual do criativo.${isTraffic ? ' Em campanha de trafego, CTR baixo significa custo por clique alto — metrica principal comprometida.' : ''}`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Pausar o criativo atual e subir novo angulo',
          por_que: 'Baixo CTR com baixa frequencia indica que a primeira impressao nao esta gerando interesse.',
          executavel_pelo_sistema: executable(payload, 'pausar_anuncio'),
          endpoint_sugerido: 'pausar_anuncio',
        },
        {
          prioridade: 2,
          acao: 'Gerar briefing criativo com hook mais direto',
          por_que: 'O proximo teste deve atacar a atencao inicial, nao apenas ajustar orcamento.',
          executavel_pelo_sistema: executable(payload, 'gerar_briefing_criativo'),
          endpoint_sugerido: 'gerar_briefing_criativo',
        },
      ],
      metricas_que_embasam: {
        ctr_link: `${metrics.ctr_link.toFixed(2)}%`,
        frequencia: String(metrics.frequencia ?? 'indisponivel'),
        dias_rodando: String(daysRunning),
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: null,
    };
  }

  if (isLeadsOrSales && daysRunning < 7 && conversionsHistory < 50) {
    return {
      ...base(payload),
      nivel_critico: 'amarelo',
      titulo_problema: 'Campanha em aprendizado',
      o_que_esta_acontecendo: `A campanha tem ${daysRunning} dias e apenas ${conversionsHistory} conversoes historicas. Ainda nao existe volume suficiente para uma decisao agressiva.`,
      acoes: [
        {
          prioridade: 1,
          acao: 'Nao alterar o conjunto ainda',
          por_que: 'Mudancas cedo demais reiniciam aprendizado e podem piorar a leitura dos dados.',
          executavel_pelo_sistema: false,
          endpoint_sugerido: null,
        },
      ],
      metricas_que_embasam: {
        dias_rodando: String(daysRunning),
        conversoes_historicas: String(conversionsHistory),
        referencia: 'Aguardar pelo menos 7 dias ou 50 conversoes',
      },
      sugestao_criativo: null,
      confianca: 'alta',
      observacao: 'Aguardar 50 conversoes antes de qualquer decisao estrutural.',
    };
  }

  return null;
}

export function estimateCriticalLevel(payload: OptimizerPayload): OptimizerCriticalLevel {
  const objetivo = payload.metas_do_cliente.objetivo_campanha;
  const isLeadsOrSales = !objetivo || objetivo === 'leads' || objetivo === 'vendas';
  const target = payload.metas_do_cliente.cpl_meta ?? payload.metas_do_cliente.cpa_meta;
  const metrics = payload.dados_da_conta.metricas_periodo;
  if (isLeadsOrSales && target && metrics.cpl_cpa_atual && metrics.cpl_cpa_atual > target * 1.6) return 'vermelho';
  if (metrics.ctr_link < 0.9 || (metrics.ritmo_gasto_percentual ?? 0) > 110) return 'vermelho';
  if (isLeadsOrSales && target && metrics.cpl_cpa_atual && metrics.cpl_cpa_atual > target * 1.1) return 'amarelo';
  if ((metrics.frequencia ?? 0) > 3.2) return 'amarelo';
  return 'verde';
}

export function buildGreenDiagnosis(payload: OptimizerPayload): OptimizerDiagnosis {
  const metrics = payload.dados_da_conta.metricas_periodo;
  const objetivo = payload.metas_do_cliente.objetivo_campanha;
  const target = payload.metas_do_cliente.cpl_meta ?? payload.metas_do_cliente.cpa_meta;
  const isLeadsOrSales = !objetivo || objetivo === 'leads' || objetivo === 'vendas';
  const metricasEmbasam: Record<string, string> = {
    ctr_link: `${metrics.ctr_link.toFixed(2)}%`,
    frequencia: String(metrics.frequencia ?? 'indisponivel'),
  };
  if (objetivo === 'trafego') {
    metricasEmbasam.cpc = brl(metrics.cpc);
    metricasEmbasam.cliques = String(metrics.cliques_link);
  } else if (objetivo === 'engajamento' || objetivo === 'reconhecimento') {
    metricasEmbasam.cpm = brl(metrics.cpm);
    metricasEmbasam.impressoes = String(metrics.impressoes);
  } else {
    metricasEmbasam.cpl_atual = brl(metrics.cpl_cpa_atual);
    metricasEmbasam.meta = brl(target);
  }
  return {
    ...base(payload),
    nivel_critico: 'verde',
    titulo_problema: 'Conta sem urgencia',
    o_que_esta_acontecendo: 'Nenhuma regra critica foi acionada e as principais metricas estao dentro de uma faixa aceitavel. O melhor movimento agora e acompanhar tendencia antes de mexer na estrutura.',
    acoes: [
      {
        prioridade: 1,
        acao: 'Manter campanha ativa e revisar novamente em 24 horas',
        por_que: 'Sem desvio relevante, alteracoes podem gerar ruido sem ganho claro.',
        executavel_pelo_sistema: false,
        endpoint_sugerido: null,
      },
    ],
    metricas_que_embasam: metricasEmbasam,
    sugestao_criativo: null,
    confianca: (isLeadsOrSales && target) ? 'media' : (!objetivo ? 'baixa' : 'media'),
    observacao: !objetivo ? 'Objetivo da campanha nao identificado. Defina o objetivo para analises mais precisas.' : null,
  };
}

export function buildFallbackDiagnosis(payload: OptimizerPayload, reason: string): OptimizerDiagnosis {
  const metrics = payload.dados_da_conta.metricas_periodo;
  const target = payload.metas_do_cliente.cpl_meta ?? payload.metas_do_cliente.cpa_meta;
  return {
    ...base(payload),
    nivel_critico: estimateCriticalLevel(payload),
    titulo_problema: 'Analise indisponivel',
    o_que_esta_acontecendo: 'A analise por IA nao ficou disponivel neste momento. O sistema preservou uma leitura basica das metricas para orientar a proxima checagem.',
    acoes: [
      {
        prioridade: 1,
        acao: 'Tentar analisar novamente em instantes',
        por_que: 'A recomendacao completa depende do retorno estruturado da IA.',
        executavel_pelo_sistema: false,
        endpoint_sugerido: null,
      },
    ],
    metricas_que_embasam: {
      cpl_atual: brl(metrics.cpl_cpa_atual),
      meta: brl(target),
      ctr_link: `${metrics.ctr_link.toFixed(2)}%`,
      gasto: brl(metrics.gasto_total),
    },
    sugestao_criativo: null,
    confianca: 'baixa',
    observacao: reason,
  };
}

export function buildOptimizerSystemPrompt(kind: OptimizerRequestKind): string {
  const creativeAddon = kind === 'sugestao_criativo'
    ? `
Quando solicitacao = "sugestao_criativo", preencha o campo sugestao_criativo com:
- Formato recomendado (video curto, estatico, carrossel, stories)
- Duracao se video (em segundos)
- Hook sugerido (o que aparece nos primeiros 3 segundos ou primeira linha)
- Angulo da mensagem (prova social, urgencia, beneficio direto, objecao, curiosidade)
- Referencia ao que ja funcionou na conta (use os dados dos criativos recebidos)
- Adaptacao ao nicho do cliente
- Adaptacao ao objetivo da campanha (nao recomende formulario de lead para campanha de trafego, por exemplo)
Seja especifico. Nao use genericos como "mostre o produto". Diga exatamente o que mostrar.`
    : '';

  return `Voce e o Otimizador do On_Reports, um analista senior de trafego pago especializado em Meta Ads e Google Ads.

Sua funcao e analisar dados de performance de campanhas e gerar diagnosticos precisos com recomendacoes de acao para os gestores de trafego.

==================================================
PASSO 1 OBRIGATORIO — IDENTIFIQUE O OBJETIVO DA CAMPANHA
==================================================
Leia "metas_do_cliente.objetivo_campanha" ANTES de qualquer analise. Esse campo define qual e a metrica principal e o que e considerado sucesso ou fracasso:

OBJETIVO = "leads":
  Metrica principal: CPL (custo por lead).
  O que analisar: CPL vs meta, taxa de conversao LP, volume de leads/dia, qualidade do publico.
  CPL acima da meta E UM PROBLEMA CRITICO.
  Segmentacoes importantes: faixa etaria com melhor conversao, genero, posicionamentos com menor CPL, criativos com maior taxa de conversao.

OBJETIVO = "trafego":
  Metrica principal: CPC e CTR.
  O que analisar: CPC, CTR, volume de cliques, custo por clique, ritmo de gasto.
  CPL NAO E RELEVANTE — nao mencione CPL como problema. Nao ha meta de lead aqui.
  Segmentacoes: posicionamentos com menor CPC, faixa etaria com maior CTR, criativos com melhor CTR.
  Um CPL "alto" e esperado e nao deve ser mencionado.

OBJETIVO = "vendas":
  Metrica principal: ROAS e CPA.
  O que analisar: ROAS vs meta, CPA, receita gerada, taxa de conversao pos-clique.
  CPL isolado nao e a metrica correta. Foque em retorno sobre investimento.
  Segmentacoes: publicos com melhor ROAS, criativos com maior taxa de compra.

OBJETIVO = "engajamento":
  Metrica principal: taxa de engajamento (curtidas, comentarios, compartilhamentos, saves).
  O que analisar: CPE (custo por engajamento), alcance, frequencia, tipos de interacao.
  NAO espere leads ou conversoes de vendas. CPL nao existe como metrica valida aqui.
  Criativos de alto engajamento geralmente tem CTR mais baixo que campanhas de trafego — isso e normal.
  Segmentacoes: publicos mais engajados, melhores horarios de entrega, formatos com mais interacao.

OBJETIVO = "reconhecimento":
  Metrica principal: CPM, alcance unico e frequencia.
  O que analisar: eficiencia do CPM, alcance vs orcamento, frequencia (ideal: 2 a 4 exposicoes).
  Conversoes NAO sao esperadas. Um CPL alto e totalmente irrelevante.
  Segmentacoes: faixas etarias com maior alcance, posicionamentos mais eficientes por CPM.

OBJETIVO = null (nao identificado):
  Analise conservadoramente com base no que os dados sugerem.
  Mencione no campo "observacao" que o objetivo nao esta definido, o que limita a precisao.

==================================================
PASSO 2 — REGRAS DE ANALISE POR OBJETIVO
==================================================
- NUNCA avalie CPL em campanhas de trafego, engajamento ou reconhecimento.
- NUNCA diga que "conversoes estao baixas" em campanhas de engajamento ou reconhecimento.
- NUNCA chame de "problema" uma metrica que nao e a metrica principal do objetivo.
- SEMPRE adapte o que e "vermelho" vs "verde" ao objetivo da campanha.
- SEMPRE mencione segmentacoes concretas nas acoes: faixa etaria, genero, posicionamento, criativo, copy.

==================================================
PASSO 3 — DIAGNOSTICO CRUZADO
==================================================
Cruze multiplas variaveis. Nunca diagnostique com base em uma metrica isolada:

TRAFEGO E LEADS:
- CPM subiu + CTR subiu + Frequencia alta = publico saturado (trocar publico, nao criativo).
- CPM normal + CTR baixo + Frequencia baixa = criativo fraco ou publico errado (testar novo angulo).
- CTR alto + CPL alto = problema na landing page, formulario ou alinhamento criativo-oferta.
- CPL alto + campanha nova (menos de 7 dias ou menos de 50 conversoes) = aprendizado, nao intervir.
- ROAS/CPL bom + frequencia baixa + orcamento sem estouro = oportunidade de escalar (+20% verba).

ENGAJAMENTO:
- Alta frequencia + baixa taxa de engajamento = criativo esgotado, renovar conteudo.
- CPE alto + alcance baixo = publico muito estreito ou lance competitivo.
- CTR baixo em campanha de engajamento = normal se as interacoes estiverem altas.

RECONHECIMENTO:
- Frequencia abaixo de 1.5 = orcamento insuficiente para impactar o publico.
- Frequencia acima de 5 = saturacao, ampliar publico ou pausar temporariamente.
- CPM acima de benchmark do nicho = lance muito competitivo ou publico estreito.

==================================================
REGRAS DE COMPORTAMENTO
==================================================
1. Responda SEMPRE em JSON valido, sem texto fora do JSON, sem markdown.
2. Tom: voce e um gestor de trafego senior falando diretamente com outro gestor. Curto, direto, imperativo. Sem enrolacao, sem linguagem de relatorio corporativo.
   - ERRADO: "Recomenda-se a revisao do criativo atual considerando os indicadores de performance."
   - CERTO: "Pausa esse criativo agora. CTR de 0,4% com frequencia baixa — o angulo nao ta funcionando."
   - ERRADO: "Observa-se uma oportunidade de escalonamento com base nos indicadores positivos de retorno."
   - CERTO: "Escala 20%. ROAS acima da meta e frequencia baixa — aproveita o momento."
3. Use numeros reais do payload em todas as frases. Nada de generico.
4. Priorize acoes da mais urgente para a menos urgente.
5. Considere o nicho do cliente. Odontologia tem sazonalidade diferente de ecommerce.
6. Nunca recomende acoes fora da lista de acoes disponiveis no payload.
7. Confianca: "alta" se os dados sao claros, "media" se ha incerteza, "baixa" se faltam dados.
8. Nas acoes, seja especifico com segmentacoes: "pausa faixa 55+ que ta com CPC de R$ 4,20 — 3x mais caro que a faixa 25-34", "testa posicionamento Feed vs Reels separado".

ESTRUTURA DO JSON DE SAIDA:
{
  "cliente_id": "string",
  "conjunto_id": "string",
  "nivel_critico": "vermelho | amarelo | verde",
  "titulo_problema": "string curto, direto — maximo 7 palavras, sem verbos no infinitivo formal",
  "o_que_esta_acontecendo": "2 a 3 frases curtas. Fale os numeros. Tom de conversa, nao de laudo.",
  "acoes": [
    {
      "prioridade": 1,
      "acao": "verbo imperativo + o que fazer + segmentacao especifica quando aplicavel",
      "por_que": "1 frase explicando o dado que justifica. Cite o numero.",
      "executavel_pelo_sistema": true,
      "endpoint_sugerido": "string ou null"
    }
  ],
  "metricas_que_embasam": {
    "metrica_principal": "valor real — metrica correta pro objetivo da campanha",
    "referencia": "meta ou benchmark",
    "desvio": "ex: +42% acima da meta"
  },
  "sugestao_criativo": "string ou null",
  "confianca": "alta | media | baixa",
  "observacao": "string ou null — use so se tiver algo relevante que nao coube acima"
}${creativeAddon}`;
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Resposta sem objeto JSON');
  return JSON.parse(match[0]);
}

export function sanitizeOptimizerDiagnosis(input: unknown, payload: OptimizerPayload): OptimizerDiagnosis {
  const obj = (input && typeof input === 'object') ? input as Partial<OptimizerDiagnosis> : {};
  const level = obj.nivel_critico === 'vermelho' || obj.nivel_critico === 'amarelo' || obj.nivel_critico === 'verde'
    ? obj.nivel_critico
    : estimateCriticalLevel(payload);
  const confidence = obj.confianca === 'alta' || obj.confianca === 'media' || obj.confianca === 'baixa'
    ? obj.confianca
    : 'baixa';
  const actions = Array.isArray(obj.acoes) ? obj.acoes : [];

  return {
    cliente_id: payload.cliente_id,
    conjunto_id: payload.dados_da_conta.conjunto_id,
    nivel_critico: level,
    titulo_problema: String(obj.titulo_problema ?? 'Diagnostico da conta').slice(0, 90),
    o_que_esta_acontecendo: String(obj.o_que_esta_acontecendo ?? 'A IA retornou uma analise incompleta, mas os dados foram processados.'),
    acoes: actions.slice(0, 5).map((action, index) => ({
      prioridade: Number(action?.prioridade ?? index + 1),
      acao: String(action?.acao ?? 'Revisar manualmente'),
      por_que: String(action?.por_que ?? 'A justificativa nao foi informada pela IA.'),
      executavel_pelo_sistema: Boolean(action?.executavel_pelo_sistema),
      endpoint_sugerido: action?.endpoint_sugerido == null ? null : String(action.endpoint_sugerido),
    })),
    metricas_que_embasam: obj.metricas_que_embasam && typeof obj.metricas_que_embasam === 'object'
      ? Object.fromEntries(Object.entries(obj.metricas_que_embasam).map(([key, value]) => [key, String(value)]))
      : {},
    sugestao_criativo: obj.sugestao_criativo == null ? null : String(obj.sugestao_criativo),
    confianca: confidence,
    observacao: obj.observacao == null ? null : String(obj.observacao),
  };
}

export function payloadNumericSnapshot(payload: OptimizerPayload): Record<string, number> {
  const m = payload.dados_da_conta.metricas_periodo;
  const t = payload.dados_da_conta.tendencia_7_dias;
  return {
    gasto_total: m.gasto_total,
    impressoes: m.impressoes,
    cliques_link: m.cliques_link,
    ctr_link: m.ctr_link,
    cpm: m.cpm ?? 0,
    cpc: m.cpc ?? 0,
    frequencia: m.frequencia ?? 0,
    conversoes: m.conversoes,
    cpl_cpa_atual: m.cpl_cpa_atual ?? 0,
    roas_atual: m.roas_atual ?? 0,
    leads_por_dia_media: m.leads_por_dia_media ?? 0,
    ritmo_gasto_percentual: m.ritmo_gasto_percentual ?? 0,
    cpl_variacao_percentual: t.cpl_variacao_percentual ?? 0,
    ctr_variacao_percentual: t.ctr_variacao_percentual ?? 0,
  };
}

export function maxSnapshotDriftPercent(current: Record<string, number>, previous: Record<string, number> | null): number {
  if (!previous) return Infinity;
  let max = 0;
  for (const [key, value] of Object.entries(current)) {
    const prev = previous[key];
    if (prev == null) return Infinity;
    const denominator = Math.max(Math.abs(prev), 1);
    max = Math.max(max, Math.abs(value - prev) / denominator * 100);
  }
  return max;
}
