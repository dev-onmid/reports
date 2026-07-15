import type { Pool } from 'pg';

// Self-heal: em prod o schema de optimizer_client_config pode ter ficado atrás da
// migration_optimizer_v2.sql (ex: coluna observacoes_fixas adicionada no código mas nunca
// aplicada no banco via migração manual). Chamar antes de qualquer query que toque a tabela.
export async function ensureOptimizerClientConfigTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_client_config (
      client_id             TEXT PRIMARY KEY,
      modo_operacao         TEXT NOT NULL DEFAULT 'RECOMENDACAO_COM_APROVACAO',
      acoes_pre_aprovadas   TEXT[] NOT NULL DEFAULT '{}',
      orcamento_diario_maximo NUMERIC,
      cpr_emergencia        NUMERIC,
      min_conjuntos_ativos  INTEGER NOT NULL DEFAULT 1,
      max_conjuntos_ativos  INTEGER NOT NULL DEFAULT 20,
      min_dias_aprendizado  INTEGER NOT NULL DEFAULT 7,
      analise_dia_semana    INTEGER NOT NULL DEFAULT 1,
      ativo                 BOOLEAN NOT NULL DEFAULT true,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_by            TEXT
    );
    ALTER TABLE public.optimizer_client_config
      ADD COLUMN IF NOT EXISTS observacoes_fixas TEXT;
  `).catch(() => {});
}

// Self-heal do workflow por recomendação (migration_optimizer_v3.sql). Chamar antes de
// qualquer query que toque optimizer_recomendacao_status ou as colunas connection_id/account_id.
export async function ensureOptimizerRecStatusTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_recomendacao_status (
      rec_id        TEXT PRIMARY KEY,
      analise_id    UUID,
      cliente_id    TEXT NOT NULL,
      objeto_id     TEXT,
      status        TEXT NOT NULL DEFAULT 'pendente',
      autor_id      TEXT,
      autor_nome    TEXT,
      motivo        TEXT,
      undo_payload  JSONB,
      atribuido_a   TEXT,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS optimizer_rec_status_cliente_idx
      ON public.optimizer_recomendacao_status (cliente_id, status);
    ALTER TABLE public.optimizer_ai_logs
      ADD COLUMN IF NOT EXISTS connection_id TEXT,
      ADD COLUMN IF NOT EXISTS account_id    TEXT;
  `).catch(() => {});
}

// Observações manuais do gestor por nível (cliente/campanha/conjunto/criativo) — registro
// humano, plural e com autor/timestamp. Diferente de `observacoes_fixas` (1 texto único por
// cliente, editado só em Configurações, injetado como regra permanente): aqui são N notas
// pontuais por objeto, que também alimentam o próximo prompt (ver loadManualNotesContext).
export async function ensureOptimizerManualNotesTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.optimizer_manual_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id TEXT NOT NULL,
      nivel TEXT NOT NULL,
      objeto_id TEXT,
      objeto_nome TEXT,
      autor_id TEXT,
      autor_nome TEXT,
      texto TEXT NOT NULL,
      ativo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS optimizer_manual_notes_cliente_idx
      ON public.optimizer_manual_notes (cliente_id, ativo, created_at DESC);
  `).catch(() => {});
}

export const OPTIMIZER_MODEL = 'claude-sonnet-4-6';
// v2 usa Haiku 4.5: a análise em árvore (payload grande + output 8k) com Sonnet passava
// dos ~55s e estourava o timeout da IA. Haiku gera em ~10-20s, aguenta o schema de
// classificação e barateia. A tarefa é extração/classificação guiada por regras — cabe no Haiku.
export const OPTIMIZER_MODEL_V2 = 'claude-haiku-4-5-20251001';
export const OPTIMIZER_PROMPT_VERSION = 'otimizador-v1.0';
export const OPTIMIZER_PROMPT_VERSION_V2 = 'otimizador-v3.0';

// ─── v2 types ────────────────────────────────────────────────────────────────

export type OptimizerModo =
  | 'DIAGNOSTICO_APENAS'
  | 'RECOMENDACAO_COM_APROVACAO'
  | 'AUTOMATICO_PARCIAL'
  | 'AUTOMATICO_TOTAL';

export type OptimizerEstadoConta = 'SAUDAVEL' | 'ATENCAO' | 'CRISE';

export type OptimizerAcaoTipo = 'PAUSAR' | 'ATIVAR' | 'AJUSTAR_ORCAMENTO';
export type OptimizerObjetoTipo = 'campaign' | 'adset' | 'ad';
export type OptimizerStatusExecucao = 'EXECUTAR_AGORA' | 'AGUARDAR_APROVACAO';
// Tipo de ação sugerida por nó da árvore. Os 3 primeiros viram ação estruturada aplicável
// (pausar/ativar/ajustar orçamento via API). TROCAR_CRIATIVO/VERIFICAR_MANUAL = manual (sem
// botão Aplicar). NENHUMA = nó sem ação (saudável).
export type OptimizerNodeAcaoTipo =
  | 'PAUSAR' | 'ATIVAR' | 'AJUSTAR_ORCAMENTO' | 'TROCAR_CRIATIVO' | 'VERIFICAR_MANUAL' | 'NENHUMA';

export type OptimizerAdV2 = {
  id: string;
  nome: string;
  status: string;
  gasto: number;
  impressoes: number;
  ctr: number;
  cpl: number | null;
  conversoes: number;
  // Objetivos de tráfego medem-se por CLIQUE: resultado = cliques, custo = cpc (gasto/cliques).
  // Preenchidos só quando fazem sentido; para leads/conversas ficam ausentes (usa conversoes/cpl).
  cliques?: number;
  cpc?: number | null;
  dias_ativo: number | null;
  quality_ranking: string | null;
  engagement_ranking: string | null;
  conversion_ranking: string | null;
  // Retenção de vídeo — só existe em anúncios de vídeo (eh_video=true). Estática/carrossel
  // vem eh_video=false com as 4 taxas null. Todas as taxas são % de impressões (hook_rate =
  // views de 3s / impressões), garantindo curva decrescente hook >= p25 >= p50 >= p75.
  eh_video: boolean;
  video_hook_rate: number | null;
  video_p25_rate: number | null;
  video_p50_rate: number | null;
  video_p75_rate: number | null;
  // Thumbnail do criativo (image_url ou thumbnail_url do anúncio na Meta) — usado só pra
  // preview visual na árvore, nunca entra no payload enviado à IA.
  imagem_url: string | null;
};

export type OptimizerAdsetV2 = {
  id: string;
  nome: string;
  status: string;
  objetivo_otimizacao: string;
  tipo_publico: string;
  orcamento_diario: number | null;
  gasto: number;
  impressoes: number;
  alcance: number | null;
  frequencia: number | null;
  ctr: number;
  cpl: number | null;
  conversoes: number;
  // Ver OptimizerAdV2: tráfego mede-se por clique (cliques/cpc), não conversão/cpl.
  cliques?: number;
  cpc?: number | null;
  ctr_tendencia_4d: 'SUBINDO' | 'CAINDO' | 'ESTAVEL' | null;
  dias_ativo: number | null;
  anuncios: OptimizerAdV2[];
};

export type OptimizerCampaignV2 = {
  id: string;
  nome: string;
  objetivo: string;
  status: string;
  orcamento_diario: number | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  ctr: number;
  cpl: number | null;
  conversoes: number;
  // Custo por clique (gasto/cliques). Para tráfego é o custo por resultado real; para os demais
  // objetivos é informativo. Ver OptimizerAdV2.
  cpc?: number | null;
  roas: number | null;
  dias_rodando: number | null;
  conjuntos: OptimizerAdsetV2[];
};

export type OptimizerPayloadV2 = {
  cliente_id: string;
  cliente_nome: string;
  nicho: OptimizerNiche;
  modo_operacao: OptimizerModo;
  semana_analise: string;
  acoes_pre_aprovadas: string[];
  metas: {
    objetivo_principal: OptimizerObjective;
    cpl_ideal: number | null;
    cpl_maximo: number | null;
    roas_minimo: number | null;
    orcamento_diario_total: number | null;
    orcamento_mensal_total: number | null;
    volume_leads_meta_mensal: number | null;
    ticket_medio: number | null;
  };
  limites_globais: {
    orcamento_diario_maximo_conta: number | null;
    cpr_emergencia: number | null;
    min_conjuntos_ativos: number;
    max_conjuntos_ativos: number;
    min_dias_aprendizado: number;
  };
  periodo_analise: {
    data_inicio: string;
    data_fim: string;
    dias: number;
    label?: string;
  };
  opportunity_score: {
    score: number | null;
    recomendacoes: Array<{ tipo: string; ganho_score: number; descricao: string }>;
  } | null;
  campanhas: OptimizerCampaignV2[];
  historico_decisoes: Array<{ semana: string; acao_executada: string; resultado: string }>;
  observacoes_gestor: string | null;
  // Peculiaridades fixas cadastradas pelo gestor em Configurar (ex: "campanhas de bot têm
  // lógica própria, nunca sugerir mover pra outra campanha") — persistem entre análises.
  observacoes_fixas: string | null;
};

export type OptimizerAcaoAutomatica = {
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  objeto_nome: string;
  parametros: Record<string, unknown>;
  justificativa: string;
  status_execucao: OptimizerStatusExecucao;
};

export type OptimizerVerdict = 'SAUDAVEL' | 'ATENCAO' | 'URGENTE';

// Nós da árvore de análise. MÉTRICAS vêm sempre do payload (verdade);
// classificacao/veredito/acao vêm da IA. Nunca confiar em número ecoado pela IA.
export type OptimizerAnaliseAnuncio = {
  id: string;
  nome: string;
  status_entrega: string | null;
  gasto: number;
  conversoes: number;
  cpl: number | null;
  // Métrica de clique (tráfego): resultado exibido = cliques, custo = cpc. Ver OptimizerAdV2.
  cliques: number;
  cpc: number | null;
  ctr: number;
  quality_ranking: string | null;
  engagement_ranking: string | null;
  conversion_ranking: string | null;
  // Retenção de vídeo — vem do payload (verdade), nunca da IA. Ver OptimizerAdV2.
  eh_video: boolean;
  video_hook_rate: number | null;
  video_p25_rate: number | null;
  video_p50_rate: number | null;
  video_p75_rate: number | null;
  // Thumbnail do criativo — vem do payload (verdade), nunca da IA. Ver OptimizerAdV2.
  imagem_url: string | null;
  classificacao: OptimizerVerdict;
  veredito: string;
  acao: string;
  // Campos que destravam o "Aplicar" de 1 clique mesmo no modo de aprovação (preenchidos pela IA).
  acao_tipo: OptimizerNodeAcaoTipo;
  acao_parametros: Record<string, unknown>;
  confianca_item: OptimizerConfidence;
  depende_de: string | null;   // id de outro objeto (mesma análise) do qual esta ação depende
  padrao: string | null;       // chave canônica do problema, p/ agrupar entre contas (ação em lote)
  // Motivos em tópicos, já interpretados (fato + comparação), para exibir direto no card
  // principal — sem precisar abrir painel. Ex: "Custava R$9,20 por conversa — a meta é R$20".
  motivos: string[];
};

export type OptimizerAnaliseConjunto = {
  id: string;
  nome: string;
  status_entrega: string | null;
  gasto: number;
  conversoes: number;
  cpl: number | null;
  cliques: number;
  cpc: number | null;
  ctr: number;
  orcamento_diario: number | null;
  dias_ativo: number | null;
  classificacao: OptimizerVerdict;
  veredito: string;
  acao: string;
  acao_tipo: OptimizerNodeAcaoTipo;
  acao_parametros: Record<string, unknown>;
  confianca_item: OptimizerConfidence;
  depende_de: string | null;
  padrao: string | null;
  motivos: string[];
  anuncios: OptimizerAnaliseAnuncio[];
};

export type OptimizerAnaliseCampanha = {
  id: string;
  nome: string;
  status_entrega: string | null;
  objetivo: string;
  gasto: number;
  conversoes: number;
  cpl: number | null;
  cliques: number;
  cpc: number | null;
  ctr: number;
  orcamento_diario: number | null;
  classificacao: OptimizerVerdict;
  veredito: string;
  acao: string;
  acao_tipo: OptimizerNodeAcaoTipo;
  acao_parametros: Record<string, unknown>;
  confianca_item: OptimizerConfidence;
  depende_de: string | null;
  padrao: string | null;
  motivos: string[];
  conjuntos: OptimizerAnaliseConjunto[];
};

export type OptimizerOutputV2 = {
  estado_da_conta: OptimizerEstadoConta;
  resumo_executivo: string;
  // Árvore campanha→conjunto→criativo com veredito e ação em cada nível (bons e ruins)
  analise_campanhas: OptimizerAnaliseCampanha[];
  cruzamento_com_metas: {
    cpl_atual: number | null;
    cpl_ideal: number | null;
    cpl_maximo: number | null;
    status_cpl: 'DENTRO' | 'ATENCAO' | 'CRITICO' | 'NAO_APLICAVEL';
    volume_conversoes_atual: number;
    volume_meta_projetada: number | null;
    status_volume: 'NO_RITMO' | 'ABAIXO' | 'CRITICO' | 'NAO_APLICAVEL';
    gasto_total: number;
    orcamento_periodo: number | null;
    status_orcamento: 'OK' | 'ESTOURANDO' | 'SUBENTREGANDO';
  };
  acoes_automaticas: OptimizerAcaoAutomatica[];
  confianca: OptimizerConfidence;
  observacao: string | null;
};

export type OptimizerAnalysisResultV2 = OptimizerOutputV2 & {
  recomendacao_id: string;
  cliente_id: string;
  semana_analise: string;
  modo_operacao: OptimizerModo;
  origem: 'ia' | 'cache' | 'fallback';
  prompt_version: string;
  modelo_usado: string | null;
  tokens_usados: number;
  custo_estimado_usd: number;
};

// ─── Recomendação achatada (unidade da fila de decisão) ───────────────────────
// Uma linha por nó ATENÇÃO/URGENTE com ação. Métricas vêm SEMPRE do payload/árvore
// (verdade) — nunca de número ecoado pela IA. Ver buildRecomendacoes().
export type OptimizerRecomendacaoSeveridade = 'urgente' | 'atencao' | 'ok';

export type OptimizerRecomendacao = {
  rec_id: string;              // estável: `${analise_id}:${objeto_tipo}:${objeto_id}`
  analise_id: string;
  cliente_id: string;
  cliente_nome: string;
  canal: 'meta' | 'google';
  nivel: OptimizerObjetoTipo;  // campaign | adset | ad
  objeto_id: string;
  objeto_nome: string;
  status_entrega: string | null;
  campanha_nome: string;
  // Nome do conjunto pai (para nivel adset é o próprio objeto; para campaign é null) —
  // permite ao card mostrar a hierarquia Campanha › Conjunto › Criativo pelo NOME.
  conjunto_nome: string | null;
  severidade: OptimizerRecomendacaoSeveridade;
  titulo: string;
  texto_recomendacao: string;
  // Motivos em tópicos já interpretados (2-4 itens), exibidos direto no card principal —
  // não exige abrir painel. Fallback determinístico a partir de `fatos` quando a IA não trouxe.
  motivos: string[];
  metricas_chave: Array<{ rotulo: string; valor: string }>;
  fatos: Array<{ rotulo: string; valor: string }>;
  acao_estruturada: {
    tipo: OptimizerAcaoTipo;
    objeto_tipo: OptimizerObjetoTipo;
    objeto_id: string;
    objeto_nome: string;
    parametros: Record<string, unknown>;
  } | null;
  aplicavel: boolean;
  confianca: OptimizerConfidence;
  depende_de: string | null;   // rec_id de outra recomendação da mesma análise
  padrao: string | null;
  connection_id: string | null;
  account_id: string | null;
  // Veredito técnico da IA ("R$2,69 gasto, 111 impressões, 0% CTR...") — vai para o painel
  // "Por que essa recomendação?", NUNCA para o título. O título é sempre linguagem natural.
  leitura: string;
  // Objetivo da campanha em linguagem de negócio ("Conversas no WhatsApp", "Geração de leads").
  // Todo o raciocínio da recomendação existe para MELHORAR o resultado deste objetivo.
  objetivo: string | null;
  // Retenção de vídeo — só preenchido em nível "ad" (nivel='ad'). Campanha/conjunto ficam null:
  // retenção só existe de fato no criativo, e uma média mascararia o criativo ruim escondido
  // atrás de um bom (ver CLAUDE.md). A UI agrega por contagem de filhos, não por média.
  retencao_video: {
    eh_video: boolean;
    hook_rate: number | null;
    p25_rate: number | null;
    p50_rate: number | null;
    p75_rate: number | null;
  } | null;
  // Thumbnail do criativo — só preenchido em nível "ad" (vem do payload/Meta, nunca da IA).
  imagem_url: string | null;
};

function normNodeAcaoTipo(v: unknown): OptimizerNodeAcaoTipo {
  return (['PAUSAR', 'ATIVAR', 'AJUSTAR_ORCAMENTO', 'TROCAR_CRIATIVO', 'VERIFICAR_MANUAL', 'NENHUMA'] as const)
    .includes(v as never) ? v as OptimizerNodeAcaoTipo : 'NENHUMA';
}

function normConfidence(v: unknown): OptimizerConfidence {
  return (['alta', 'media', 'baixa'] as const).includes(v as never) ? v as OptimizerConfidence : 'media';
}

// Análises antigas (prompt < v2.2) não trazem acao_tipo — inferimos do verbo inicial da ação
// em texto livre ("Pausar, criativo fadigado" → PAUSAR). Assim o botão Aplicar funciona
// também para análises geradas antes do redesign, sem esperar a próxima rodada de IA.
function inferAcaoTipo(acao: string, declarado: OptimizerNodeAcaoTipo): OptimizerNodeAcaoTipo {
  if (declarado !== 'NENHUMA') return declarado;
  const t = (acao ?? '').trim().toLowerCase();
  if (!t) return 'NENHUMA';
  if (/^pausar|^pausa\b/.test(t)) return 'PAUSAR';
  if (/^(ativar|reativar)/.test(t)) return 'ATIVAR';
  if (/^(escalar|aumentar|reduzir)/.test(t) && /or[çc]amento|%|\br\$/.test(t)) return 'AJUSTAR_ORCAMENTO';
  if (/^(escalar|aumentar|reduzir) or[çc]amento/.test(t)) return 'AJUSTAR_ORCAMENTO';
  if (/(trocar|testar|subir|criar).*(criativo|angulo|ângulo|apelo)|criativo novo/.test(t)) return 'TROCAR_CRIATIVO';
  if (/^(verificar|checar|conferir|revisar|deletar|excluir|arquivar|aguardar)/.test(t)) return 'VERIFICAR_MANUAL';
  return 'NENHUMA';
}

// Traduz o objetivo bruto da campanha (Meta/Google) para linguagem de negócio + o "alvo curto"
// que a campanha existe para maximizar. É a bússola de toda recomendação: sempre melhorar isto.
type ObjetivoInfo = { label: string; curto: string; metrica: string; custo: string };
function objetivoInfo(raw: string | null | undefined): ObjetivoInfo | null {
  const t = (raw ?? '').toLowerCase();
  if (!t) return null;
  if (/whats|messag|conversa|mensag|inbox/.test(t)) return { label: 'Conversas no WhatsApp', curto: 'conversas', metrica: 'Conversas', custo: 'Custo por conversa' };
  if (/lead|formul/.test(t)) return { label: 'Geração de leads', curto: 'leads', metrica: 'Leads', custo: 'Custo por lead' };
  if (/sales|vend|purchase|convers[aã]o|compra|checkout/.test(t)) return { label: 'Vendas', curto: 'vendas', metrica: 'Vendas', custo: 'Custo por venda' };
  if (/traffic|tr[aá]fego|link_click|clique/.test(t)) return { label: 'Tráfego no site', curto: 'cliques no link', metrica: 'Cliques', custo: 'Custo por clique' };
  if (/engag|engaj/.test(t)) return { label: 'Engajamento', curto: 'engajamento', metrica: 'Engajamentos', custo: 'Custo por engajamento' };
  if (/awareness|reconhec|alcance|reach|brand/.test(t)) return { label: 'Reconhecimento de marca', curto: 'alcance', metrica: 'Alcance', custo: 'CPM' };
  if (/app|install/.test(t)) return { label: 'Instalações do app', curto: 'instalações', metrica: 'Instalações', custo: 'Custo por instalação' };
  return { label: (raw ?? '').slice(0, 40), curto: 'resultado', metrica: 'Conversões', custo: 'CPL' };
}

// TRÁFEGO mede-se por CLIQUE no link — o resultado é `cliques` e o custo por resultado é o CPC
// (gasto/cliques), NUNCA conversões/CPL (que num tráfego saem de conversas incidentais e produzem
// número sem sentido, ex: "Custo por clique R$351" = gasto ÷ 2 conversas no bug do Cão Véio).
// Fonte única de verdade pra decidir o eixo de medição — usada no payload (weekly) e na árvore.
export function objetivoMedidoPorClique(raw: string | null | undefined): boolean {
  return objetivoInfo(raw)?.metrica === 'Cliques';
}

// Título do card em linguagem natural, SEMPRE ancorado no resultado do objetivo — qualquer
// funcionário entende do que se trata sem ler métrica. O dado técnico (veredito da IA) vai
// para `leitura`, dentro do painel "por quê".
function tituloAmigavel(tipo: OptimizerNodeAcaoTipo, nivel: OptimizerObjetoTipo, sev: OptimizerVerdict, alvo: string | null): string {
  const nome = nivel === 'campaign' ? 'campanha' : nivel === 'adset' ? 'conjunto de anúncios' : 'criativo';
  const artigo = nivel === 'campaign' ? 'Uma' : 'Um';
  const semAlvo = alvo && alvo !== 'resultado' ? `gerar ${alvo}` : 'trazer resultado';
  const maisAlvo = alvo && alvo !== 'resultado' ? `mais ${alvo}` : 'mais resultado';
  switch (tipo) {
    case 'PAUSAR': return `${artigo} ${nome} está gastando sem ${semAlvo}`;
    case 'ATIVAR': return `${artigo} ${nome} pausado pode voltar a ${semAlvo}`;
    case 'AJUSTAR_ORCAMENTO': return `Dá para ajustar o orçamento e buscar ${maisAlvo}`;
    case 'TROCAR_CRIATIVO': return `Este criativo cansou e está trazendo menos ${alvo && alvo !== 'resultado' ? alvo : 'resultado'}`;
    case 'NENHUMA':
      // SAUDAVEL + NENHUMA = de fato nada a fazer (a rota "escalar" já saiu como
      // AJUSTAR_ORCAMENTO/ATIVAR antes de chegar aqui). Título precisa dizer "sem ação", nunca
      // sugerir ajuste que não existe.
      return sev === 'SAUDAVEL'
        ? `${artigo === 'Uma' ? 'Está' : 'Está'} indo bem — sem ação necessária`
        : `${artigo} ${nome} ainda sem diagnóstico definitivo`;
    default:
      return sev === 'URGENTE'
        ? `${artigo} ${nome} precisa de uma decisão para não perder ${maisAlvo}`
        : `${artigo} ${nome} pode render ${maisAlvo} com um ajuste`;
  }
}

// Formatadores puros — hoisted p/ módulo pra reuso entre buildRecomendacoes (fila achatada,
// filtrada) e buildCampaignTree (árvore completa, sem filtro).
function fmtMoney(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v as number);
}
function fmtNum(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : (v as number).toLocaleString('pt-BR');
}
function fmtPct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v as number).toFixed(2)}%`;
}

export function buildRecomendacoes(
  result: OptimizerOutputV2,
  meta: { analise_id: string; cliente_id: string; cliente_nome: string; canal: 'meta' | 'google'; connection_id: string | null; account_id: string | null },
): OptimizerRecomendacao[] {
  const money = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v as number);
  const num = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : (v as number).toLocaleString('pt-BR');
  const pct = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? '—' : `${(v as number).toFixed(2)}%`;

  const acaoAutoByObj = new Map<string, OptimizerAcaoAutomatica>();
  for (const a of result.acoes_automaticas ?? []) acaoAutoByObj.set(a.objeto_id, a);

  // TESTE JUSTO: só dá pra dizer que um item "falhou" (0 resultado) depois de ter gasto o
  // suficiente pra ter tido chance. Referência = ~2x o custo-alvo por resultado (CPL/CPA meta);
  // sem meta, um piso baixo. Abaixo disso, gasto ínfimo com 0 resultado é ESPERADO, não problema.
  const cm = result.cruzamento_com_metas;
  const cplRef = (cm?.cpl_maximo ?? cm?.cpl_ideal ?? null);
  const gastoMinimoParaJulgar = cplRef && cplRef > 0 ? cplRef * 2 : 25;

  type Raw = { objeto_id: string; depObjId: string | null; rec: OptimizerRecomendacao };
  const raws: Raw[] = [];

  const push = (o: {
    objeto_tipo: OptimizerObjetoTipo;
    objeto_id: string; objeto_nome: string; campanha_nome: string;
    status_entrega: string | null;
    conjunto_nome: string | null;
    objetivo: ObjetivoInfo | null;
    gasto: number; conversoes: number;
    classificacao: OptimizerVerdict; veredito: string; acao: string;
    acao_tipo: OptimizerNodeAcaoTipo; acao_parametros: Record<string, unknown>;
    confianca_item: OptimizerConfidence; depende_de: string | null; padrao: string | null;
    motivos: string[];
    metricas_chave: Array<{ rotulo: string; valor: string }>;
    fatos: Array<{ rotulo: string; valor: string }>;
    retencao_video?: OptimizerRecomendacao['retencao_video'];
    imagem_url?: string | null;
  }) => {
    if (!o.acao?.trim()) return;

    const auto = acaoAutoByObj.get(o.objeto_id);
    const tipoEfetivo = inferAcaoTipo(o.acao, o.acao_tipo);

    // Trava anti-ruído: não recomendar PAUSAR "sem resultado" quando o item mal gastou —
    // R$3 com 0 lead numa meta de R$20 não é falha, é falta de entrega. Elimina os falsos urgentes.
    if (tipoEfetivo === 'PAUSAR' && o.conversoes === 0 && o.gasto < gastoMinimoParaJulgar) return;
    // Item SAUDÁVEL só entra na fila se carregar uma ação de CRESCIMENTO (escalar orçamento
    // ou reativar) — é uma oportunidade de melhorar o resultado do objetivo, não um problema.
    // Saudável sem ação de crescimento = nada a fazer, fica fora da fila.
    const ehOportunidade = o.classificacao === 'SAUDAVEL';
    if (ehOportunidade && tipoEfetivo !== 'AJUSTAR_ORCAMENTO' && tipoEfetivo !== 'ATIVAR') return;

    const structTipo: OptimizerAcaoTipo | null =
      (tipoEfetivo === 'PAUSAR' || tipoEfetivo === 'ATIVAR' || tipoEfetivo === 'AJUSTAR_ORCAMENTO')
        ? tipoEfetivo
        : (auto ? auto.acao : null);
    const parametros = { ...(o.acao_parametros ?? {}), ...(auto?.parametros ?? {}) };
    const aplicavel = structTipo != null && (structTipo !== 'AJUSTAR_ORCAMENTO' || o.objeto_tipo === 'adset');

    raws.push({
      objeto_id: o.objeto_id,
      depObjId: o.depende_de,
      rec: {
        rec_id: `${meta.analise_id}:${o.objeto_tipo}:${o.objeto_id}`,
        analise_id: meta.analise_id,
        cliente_id: meta.cliente_id,
        cliente_nome: meta.cliente_nome,
        canal: meta.canal,
        nivel: o.objeto_tipo,
        objeto_id: o.objeto_id,
        objeto_nome: o.objeto_nome,
        status_entrega: o.status_entrega,
        campanha_nome: o.campanha_nome,
        conjunto_nome: o.conjunto_nome,
        severidade: o.classificacao === 'URGENTE' ? 'urgente' : o.classificacao === 'ATENCAO' ? 'atencao' : 'ok',
        titulo: tituloAmigavel(tipoEfetivo, o.objeto_tipo, o.classificacao, o.objetivo?.curto ?? null),
        objetivo: o.objetivo?.label ?? null,
        texto_recomendacao: o.acao,
        // Fallback: análises antigas (ou omissão da IA) sem `motivos` reaproveitam os fatos
        // determinísticos (rótulo: valor). GUARDA: análises salvas ANTES deste campo existir têm
        // motivos=undefined — sem o Array.isArray, `.length` quebrava a rota /fila INTEIRA (não só
        // deste cliente), zerando a fila global com "Última análise em —". Ver hotfix.
        motivos: (Array.isArray(o.motivos) && o.motivos.length > 0)
          ? o.motivos
          : o.fatos.slice(0, 4).map((f) => `${f.rotulo}: ${f.valor}`),
        metricas_chave: o.metricas_chave.filter((m) => m.valor && m.valor !== '—').slice(0, 3),
        fatos: o.fatos,
        acao_estruturada: structTipo
          ? { tipo: structTipo, objeto_tipo: o.objeto_tipo, objeto_id: o.objeto_id, objeto_nome: o.objeto_nome, parametros }
          : null,
        aplicavel,
        confianca: o.confianca_item,
        depende_de: null,
        padrao: o.padrao,
        connection_id: meta.connection_id,
        account_id: meta.account_id,
        leitura: o.veredito?.trim() ?? '',
        retencao_video: o.retencao_video ?? null,
        imagem_url: o.imagem_url ?? null,
      },
    });
  };

  for (const camp of result.analise_campanhas ?? []) {
    // Objetivo herdado por toda a árvore da campanha — é a bússola da recomendação e
    // renomeia a métrica de resultado (ex: "Conversas" p/ WhatsApp, "Leads" p/ formulário).
    const obj = objetivoInfo(camp.objetivo);
    const mConv = obj?.metrica ?? 'Conversões';
    const mCusto = obj?.custo ?? 'CPL';
    // Tráfego: resultado exibido = cliques, custo = cpc (nunca conversões/cpl). Ver objetivoMedidoPorClique.
    const usaClq = obj?.metrica === 'Cliques';
    const resDe = (n: { conversoes: number; cliques: number }) => usaClq ? n.cliques : n.conversoes;
    const custoDe = (n: { cpl: number | null; cpc: number | null }) => usaClq ? n.cpc : n.cpl;
    push({
      objeto_tipo: 'campaign', objeto_id: camp.id, objeto_nome: camp.nome, status_entrega: camp.status_entrega ?? null, campanha_nome: camp.nome,
      conjunto_nome: null,
      objetivo: obj, gasto: Number(camp.gasto) || 0, conversoes: resDe(camp),
      classificacao: camp.classificacao, veredito: camp.veredito, acao: camp.acao,
      acao_tipo: camp.acao_tipo, acao_parametros: camp.acao_parametros, confianca_item: camp.confianca_item,
      depende_de: camp.depende_de, padrao: camp.padrao, motivos: camp.motivos,
      metricas_chave: [
        { rotulo: 'Gasto', valor: money(camp.gasto) },
        { rotulo: mConv, valor: num(resDe(camp)) },
        { rotulo: mCusto, valor: money(custoDe(camp)) },
      ],
      fatos: [
        { rotulo: 'Gasto', valor: money(camp.gasto) },
        { rotulo: mConv, valor: num(resDe(camp)) },
        { rotulo: mCusto, valor: money(custoDe(camp)) },
        { rotulo: 'CTR', valor: pct(camp.ctr) },
        { rotulo: 'Orçamento diário', valor: money(camp.orcamento_diario) },
      ],
    });
    for (const conj of camp.conjuntos ?? []) {
      push({
        objeto_tipo: 'adset', objeto_id: conj.id, objeto_nome: conj.nome, status_entrega: conj.status_entrega ?? null, campanha_nome: camp.nome,
        conjunto_nome: conj.nome,
        objetivo: obj, gasto: Number(conj.gasto) || 0, conversoes: resDe(conj),
        classificacao: conj.classificacao, veredito: conj.veredito, acao: conj.acao,
        acao_tipo: conj.acao_tipo, acao_parametros: conj.acao_parametros, confianca_item: conj.confianca_item,
        depende_de: conj.depende_de, padrao: conj.padrao, motivos: conj.motivos,
        metricas_chave: [
          { rotulo: 'Gasto', valor: money(conj.gasto) },
          { rotulo: mConv, valor: num(resDe(conj)) },
          { rotulo: mCusto, valor: money(custoDe(conj)) },
        ],
        fatos: [
          { rotulo: 'Gasto', valor: money(conj.gasto) },
          { rotulo: mConv, valor: num(resDe(conj)) },
          { rotulo: mCusto, valor: money(custoDe(conj)) },
          { rotulo: 'CTR', valor: pct(conj.ctr) },
          { rotulo: 'Orçamento diário', valor: money(conj.orcamento_diario) },
          { rotulo: 'Dias ativo', valor: conj.dias_ativo != null ? String(conj.dias_ativo) : '—' },
        ],
      });
      for (const ad of conj.anuncios ?? []) {
        push({
          objeto_tipo: 'ad', objeto_id: ad.id, objeto_nome: ad.nome, status_entrega: ad.status_entrega ?? null, campanha_nome: camp.nome,
          conjunto_nome: conj.nome,
          objetivo: obj, gasto: Number(ad.gasto) || 0, conversoes: resDe(ad),
          classificacao: ad.classificacao, veredito: ad.veredito, acao: ad.acao,
          acao_tipo: ad.acao_tipo, acao_parametros: ad.acao_parametros, confianca_item: ad.confianca_item,
          depende_de: ad.depende_de, padrao: ad.padrao, motivos: ad.motivos,
          metricas_chave: [
            { rotulo: 'Gasto', valor: money(ad.gasto) },
            { rotulo: mConv, valor: num(resDe(ad)) },
            { rotulo: mCusto, valor: money(custoDe(ad)) },
          ],
          fatos: [
            { rotulo: 'Gasto', valor: money(ad.gasto) },
            { rotulo: mConv, valor: num(resDe(ad)) },
            { rotulo: mCusto, valor: money(custoDe(ad)) },
            { rotulo: 'CTR', valor: pct(ad.ctr) },
            { rotulo: 'Ranking de qualidade', valor: ad.quality_ranking ?? '—' },
            { rotulo: 'Ranking de engajamento', valor: ad.engagement_ranking ?? '—' },
            { rotulo: 'Ranking de conversão', valor: ad.conversion_ranking ?? '—' },
          ],
          retencao_video: {
            eh_video: ad.eh_video,
            hook_rate: ad.video_hook_rate,
            p25_rate: ad.video_p25_rate,
            p50_rate: ad.video_p50_rate,
            p75_rate: ad.video_p75_rate,
          },
          imagem_url: ad.imagem_url,
        });
      }
    }
  }

  // 2ª passada: resolve depende_de (id de objeto → rec_id) dentro da mesma análise.
  const recIdByObj = new Map<string, string>();
  for (const r of raws) recIdByObj.set(r.objeto_id, r.rec.rec_id);
  for (const r of raws) {
    if (r.depObjId && recIdByObj.has(r.depObjId)) r.rec.depende_de = recIdByObj.get(r.depObjId) ?? null;
  }

  // Ordena por severidade (urgente > atenção) e depois por gasto (fato 0 = Gasto).
  const sevRank = { urgente: 0, atencao: 1, ok: 2 } as const;
  return raws
    .map((r) => r.rec)
    .sort((a, b) => sevRank[a.severidade] - sevRank[b.severidade]);
}

// Nó da árvore para a tela do Otimizador — mesmo shape de OptimizerRecomendacao (reaproveita
// adManagerUrl, VERBO_ACAO etc. no client) + `filhos` para a hierarquia campanha→conjunto→criativo.
export type OptimizerTreeNode = OptimizerRecomendacao & { filhos: OptimizerTreeNode[] };

// Diferente de buildRecomendacoes (fila achatada, só ATENCAO/URGENTE + oportunidades de escala),
// esta função devolve a ÁRVORE INTEIRA — inclusive nós SAUDAVEL sem ação ("nada a fazer") — para
// a visão "Campanha > Conjunto > Criativo" onde o gestor precisa ver o que está bem também, não
// só os problemas. Reaproveita os mesmos helpers de título/objetivo/gasto-mínimo do módulo.
export function buildCampaignTree(
  result: OptimizerOutputV2,
  meta: { analise_id: string; cliente_id: string; cliente_nome: string; canal: 'meta' | 'google'; connection_id: string | null; account_id: string | null },
): OptimizerTreeNode[] {
  const cm = result.cruzamento_com_metas;
  const cplRef = (cm?.cpl_maximo ?? cm?.cpl_ideal ?? null);
  const gastoMinimoParaJulgar = cplRef && cplRef > 0 ? cplRef * 2 : 25;

  const acaoAutoByObj = new Map<string, OptimizerAcaoAutomatica>();
  for (const a of result.acoes_automaticas ?? []) acaoAutoByObj.set(a.objeto_id, a);

  function buildNode(o: {
    objeto_tipo: OptimizerObjetoTipo;
    objeto_id: string; objeto_nome: string; campanha_nome: string;
    status_entrega: string | null;
    conjunto_nome: string | null;
    objetivo: ObjetivoInfo | null;
    gasto: number; conversoes: number;
    classificacao: OptimizerVerdict; veredito: string; acao: string;
    acao_tipo: OptimizerNodeAcaoTipo; acao_parametros: Record<string, unknown>;
    confianca_item: OptimizerConfidence; depende_de: string | null; padrao: string | null;
    motivos: string[];
    metricas_chave: Array<{ rotulo: string; valor: string }>;
    fatos: Array<{ rotulo: string; valor: string }>;
    filhos: OptimizerTreeNode[];
    retencao_video?: OptimizerRecomendacao['retencao_video'];
    imagem_url?: string | null;
  }): OptimizerTreeNode {
    const auto = acaoAutoByObj.get(o.objeto_id);
    let tipoEfetivo = o.acao?.trim() ? inferAcaoTipo(o.acao, o.acao_tipo) : 'NENHUMA';
    let acaoTexto = o.acao;
    let confianca = o.confianca_item;

    // Mesma trava anti-ruído do buildRecomendacoes, mas aqui NÃO descartamos o nó (a árvore
    // sempre mostra todo mundo) — só rebaixamos a ação pra algo honesto ("aguardar dados").
    if (tipoEfetivo === 'PAUSAR' && o.conversoes === 0 && o.gasto < gastoMinimoParaJulgar) {
      tipoEfetivo = 'VERIFICAR_MANUAL';
      acaoTexto = 'Aguardar mais dados: gasto ainda abaixo do piso mínimo pra julgar resultado com segurança';
      confianca = 'baixa';
    }

    const structTipo: OptimizerAcaoTipo | null =
      (tipoEfetivo === 'PAUSAR' || tipoEfetivo === 'ATIVAR' || tipoEfetivo === 'AJUSTAR_ORCAMENTO')
        ? tipoEfetivo
        : (auto ? auto.acao : null);
    const parametros = { ...(o.acao_parametros ?? {}), ...(auto?.parametros ?? {}) };
    const aplicavel = structTipo != null && (structTipo !== 'AJUSTAR_ORCAMENTO' || o.objeto_tipo === 'adset');

    return {
      rec_id: `${meta.analise_id}:${o.objeto_tipo}:${o.objeto_id}`,
      analise_id: meta.analise_id,
      cliente_id: meta.cliente_id,
      cliente_nome: meta.cliente_nome,
      canal: meta.canal,
      nivel: o.objeto_tipo,
      objeto_id: o.objeto_id,
      objeto_nome: o.objeto_nome,
      status_entrega: o.status_entrega,
      campanha_nome: o.campanha_nome,
      conjunto_nome: o.conjunto_nome,
      severidade: o.classificacao === 'URGENTE' ? 'urgente' : o.classificacao === 'ATENCAO' ? 'atencao' : 'ok',
      titulo: tituloAmigavel(tipoEfetivo, o.objeto_tipo, o.classificacao, o.objetivo?.curto ?? null),
      objetivo: o.objetivo?.label ?? null,
      texto_recomendacao: acaoTexto,
      motivos: (Array.isArray(o.motivos) && o.motivos.length > 0)
        ? o.motivos
        : o.fatos.slice(0, 4).map((f) => `${f.rotulo}: ${f.valor}`),
      metricas_chave: o.metricas_chave.filter((m) => m.valor && m.valor !== '—').slice(0, 3),
      fatos: o.fatos,
      acao_estruturada: structTipo
        ? { tipo: structTipo, objeto_tipo: o.objeto_tipo, objeto_id: o.objeto_id, objeto_nome: o.objeto_nome, parametros }
        : null,
      aplicavel,
      confianca,
      depende_de: o.depende_de,
      padrao: o.padrao,
      connection_id: meta.connection_id,
      account_id: meta.account_id,
      leitura: o.veredito?.trim() ?? '',
      filhos: o.filhos,
      retencao_video: o.retencao_video ?? null,
      imagem_url: o.imagem_url ?? null,
    };
  }

  const tree: OptimizerTreeNode[] = [];
  const byObjId = new Map<string, OptimizerTreeNode>();

  for (const camp of result.analise_campanhas ?? []) {
    const obj = objetivoInfo(camp.objetivo);
    const mConv = obj?.metrica ?? 'Conversões';
    const mCusto = obj?.custo ?? 'CPL';
    // Tráfego: resultado exibido = cliques, custo = cpc (nunca conversões/cpl). Ver objetivoMedidoPorClique.
    const usaClq = obj?.metrica === 'Cliques';
    const resDe = (n: { conversoes: number; cliques: number }) => usaClq ? n.cliques : n.conversoes;
    const custoDe = (n: { cpl: number | null; cpc: number | null }) => usaClq ? n.cpc : n.cpl;

    const conjuntosNodes: OptimizerTreeNode[] = (camp.conjuntos ?? []).map((conj) => {
      const anunciosNodes: OptimizerTreeNode[] = (conj.anuncios ?? []).map((ad) => {
        const adNode = buildNode({
          objeto_tipo: 'ad', objeto_id: ad.id, objeto_nome: ad.nome, status_entrega: ad.status_entrega ?? null, campanha_nome: camp.nome,
          conjunto_nome: conj.nome,
          objetivo: obj, gasto: Number(ad.gasto) || 0, conversoes: resDe(ad),
          classificacao: ad.classificacao, veredito: ad.veredito, acao: ad.acao,
          acao_tipo: ad.acao_tipo, acao_parametros: ad.acao_parametros, confianca_item: ad.confianca_item,
          depende_de: ad.depende_de, padrao: ad.padrao, motivos: ad.motivos,
          metricas_chave: [
            { rotulo: 'Gasto', valor: fmtMoney(ad.gasto) },
            { rotulo: mConv, valor: fmtNum(resDe(ad)) },
            { rotulo: mCusto, valor: fmtMoney(custoDe(ad)) },
          ],
          fatos: [
            { rotulo: 'Gasto', valor: fmtMoney(ad.gasto) },
            { rotulo: mConv, valor: fmtNum(resDe(ad)) },
            { rotulo: mCusto, valor: fmtMoney(custoDe(ad)) },
            { rotulo: 'CTR', valor: fmtPct(ad.ctr) },
            { rotulo: 'Ranking de qualidade', valor: ad.quality_ranking ?? '—' },
            { rotulo: 'Ranking de engajamento', valor: ad.engagement_ranking ?? '—' },
            { rotulo: 'Ranking de conversão', valor: ad.conversion_ranking ?? '—' },
          ],
          filhos: [],
          retencao_video: {
            eh_video: ad.eh_video,
            hook_rate: ad.video_hook_rate,
            p25_rate: ad.video_p25_rate,
            p50_rate: ad.video_p50_rate,
            p75_rate: ad.video_p75_rate,
          },
          imagem_url: ad.imagem_url,
        });
        byObjId.set(ad.id, adNode);
        return adNode;
      });

      const conjNode = buildNode({
        objeto_tipo: 'adset', objeto_id: conj.id, objeto_nome: conj.nome, status_entrega: conj.status_entrega ?? null, campanha_nome: camp.nome,
        conjunto_nome: conj.nome,
        objetivo: obj, gasto: Number(conj.gasto) || 0, conversoes: resDe(conj),
        classificacao: conj.classificacao, veredito: conj.veredito, acao: conj.acao,
        acao_tipo: conj.acao_tipo, acao_parametros: conj.acao_parametros, confianca_item: conj.confianca_item,
        depende_de: conj.depende_de, padrao: conj.padrao, motivos: conj.motivos,
        metricas_chave: [
          { rotulo: 'Gasto', valor: fmtMoney(conj.gasto) },
          { rotulo: mConv, valor: fmtNum(resDe(conj)) },
          { rotulo: mCusto, valor: fmtMoney(custoDe(conj)) },
        ],
        fatos: [
          { rotulo: 'Gasto', valor: fmtMoney(conj.gasto) },
          { rotulo: mConv, valor: fmtNum(resDe(conj)) },
          { rotulo: mCusto, valor: fmtMoney(custoDe(conj)) },
          { rotulo: 'CTR', valor: fmtPct(conj.ctr) },
          { rotulo: 'Orçamento diário', valor: fmtMoney(conj.orcamento_diario) },
          { rotulo: 'Dias ativo', valor: conj.dias_ativo != null ? String(conj.dias_ativo) : '—' },
        ],
        filhos: anunciosNodes,
      });
      byObjId.set(conj.id, conjNode);
      return conjNode;
    });

    const campNode = buildNode({
      objeto_tipo: 'campaign', objeto_id: camp.id, objeto_nome: camp.nome, status_entrega: camp.status_entrega ?? null, campanha_nome: camp.nome,
      conjunto_nome: null,
      objetivo: obj, gasto: Number(camp.gasto) || 0, conversoes: resDe(camp),
      classificacao: camp.classificacao, veredito: camp.veredito, acao: camp.acao,
      acao_tipo: camp.acao_tipo, acao_parametros: camp.acao_parametros, confianca_item: camp.confianca_item,
      depende_de: camp.depende_de, padrao: camp.padrao, motivos: camp.motivos,
      metricas_chave: [
        { rotulo: 'Gasto', valor: fmtMoney(camp.gasto) },
        { rotulo: mConv, valor: fmtNum(resDe(camp)) },
        { rotulo: mCusto, valor: fmtMoney(custoDe(camp)) },
      ],
      fatos: [
        { rotulo: 'Gasto', valor: fmtMoney(camp.gasto) },
        { rotulo: mConv, valor: fmtNum(resDe(camp)) },
        { rotulo: mCusto, valor: fmtMoney(custoDe(camp)) },
        { rotulo: 'CTR', valor: fmtPct(camp.ctr) },
        { rotulo: 'Orçamento diário', valor: fmtMoney(camp.orcamento_diario) },
      ],
      filhos: conjuntosNodes,
    });
    byObjId.set(camp.id, campNode);
    tree.push(campNode);
  }

  // Resolve depende_de (id de objeto → rec_id) dentro da mesma análise, em todos os níveis.
  function resolveDeps(nodes: OptimizerTreeNode[]) {
    for (const n of nodes) {
      if (n.depende_de && byObjId.has(n.depende_de)) n.depende_de = byObjId.get(n.depende_de)!.rec_id;
      else if (n.depende_de) n.depende_de = null;
      resolveDeps(n.filhos);
    }
  }
  resolveDeps(tree);

  return tree;
}

export function currentWeekLabel(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function buildOptimizerSystemPromptV2(): string {
  return `Voce e o Otimizador do On_Reports, analista senior de trafego pago para agencias brasileiras.

Recebe um JSON com dados completos de uma conta de anuncios (campanhas, conjuntos, anuncios, metas, limites e modo de operacao) e retorna um JSON estruturado com diagnostico granular por campanha/conjunto/anuncio e plano de acoes.

==================================================
PASSO 0 OBRIGATORIO — LEIA ANTES DE QUALQUER ANALISE
==================================================
Leia os campos:
- "modo_operacao": define o que voce pode marcar como EXECUTAR_AGORA.
- "acoes_pre_aprovadas": lista das acoes que podem ser executadas automaticamente.
- "limites_globais": nunca ultrapasse esses limites nas acoes.
- "observacoes_fixas": texto livre escrito pelo gestor humano com peculiaridades PERMANENTES
  desse cliente especifico (ex: "campanhas com [BOT] no nome sao fluxo automatizado, tem
  logica propria, NUNCA sugira mover orcamento delas pra outra campanha" ou "esse cliente
  vende curso presencial E online, sao publicos diferentes, nao compare CPL entre eles").
  Se existir, ESSA E A REGRA MAIS IMPORTANTE DE TODAS — vale mais que qualquer padrao generico
  deste prompt. Releia antes de classificar cada campanha/conjunto e antes de escrever
  qualquer acao. Se uma observacao fixa contradiz uma regra generica abaixo, a observacao
  fixa vence. Se nao existir (null/vazio), ignore este passo e siga o resto do prompt normal.

Regra de ouro das acoes_automaticas:
- Somente marque status_execucao = "EXECUTAR_AGORA" se:
  1. modo_operacao for "AUTOMATICO_PARCIAL" ou "AUTOMATICO_TOTAL"
  2. A acao estiver na lista acoes_pre_aprovadas (AUTOMATICO_PARCIAL) OU modo for AUTOMATICO_TOTAL
  3. O conjunto/anuncio tiver mais dias ativos que min_dias_aprendizado
  4. No maximo 2 acoes EXECUTAR_AGORA por ciclo (mesmo em AUTOMATICO_TOTAL)
- Em modo "DIAGNOSTICO_APENAS" ou "RECOMENDACAO_COM_APROVACAO": acoes_automaticas deve ser array vazio [].

==================================================
NORTE DE TODA RECOMENDACAO (leia antes de tudo)
==================================================
CADA campanha existe para ENTREGAR UM RESULTADO ESPECIFICO — o objetivo dela. Toda analise,
todo veredito e toda acao que voce escrever tem UM proposito unico: fazer esse resultado
CRESCER (mais volume) e/ou ficar MAIS BARATO (menor custo por resultado). Nunca recomende algo
que nao mova o ponteiro do objetivo.

Traduza o objetivo para o resultado concreto que precisa melhorar e mire nele:
- Objetivo de MENSAGENS/WhatsApp -> o resultado e CONVERSAS INICIADAS. Sua meta: MAIS conversas
  a um custo por conversa menor. Nao fale de "leads" nem de compras aqui.
- Objetivo de LEADS/formulario -> o resultado e LEADS. Sua meta: MAIS leads, CPL menor.
- Objetivo de VENDAS/conversao -> o resultado e VENDAS/receita. Sua meta: MAIS vendas, ROAS maior.
- Objetivo de TRAFEGO -> o resultado e CLIQUES no link. Sua meta: MAIS cliques, CPC menor. (Nao cobre lead/venda.)
- Objetivo de ENGAJAMENTO -> o resultado e INTERACOES. Objetivo de RECONHECIMENTO -> ALCANCE/frequencia sadia.
Quando for pausar algo, e porque ele consome verba SEM entregar esse resultado (tirando dinheiro
do que entrega). Quando for escalar, e porque aquilo entrega o resultado barato e cabe mais verba.
Quando for trocar criativo, e porque o resultado caiu e um criativo novo pode recupera-lo. Escreva
a acao e o veredito sempre conectando ao resultado do objetivo (ex: "Pausar: R$X sem nenhuma
conversa em 3 dias; a verba rende mais nos conjuntos que estao trazendo conversa").

==================================================
PASSO 1 — A BUSSOLA E O OBJETIVO DE CADA CAMPANHA (nunca o da conta)
==================================================
Cada campanha do payload traz seu proprio campo "objetivo" (ex: OUTCOME_LEADS, OUTCOME_SALES,
OUTCOME_ENGAGEMENT). E ESSE campo — campanha a campanha — que define a metrica de julgamento:

- Campanha de MENSAGENS/WhatsApp -> julgue por CUSTO POR CONVERSA INICIADA vs cpl_ideal/cpl_maximo
  do planejamento. Conversa iniciada CONTA como o "lead" do planejamento.
- Campanha de LEADS/formulario -> julgue por CPL vs cpl_ideal/cpl_maximo.
- Campanha de VENDAS/conversao (pixel de compra) -> julgue por CPA e ROAS. Referencia de
  viabilidade: o CPA precisa fazer sentido frente ao ticket_medio.
- Campanha de TRAFEGO -> CPC e CTR. NAO mencione CPL como problema.
- Campanha de ENGAJAMENTO puro -> taxa de engajamento. NAO espere leads.
- Campanha de RECONHECIMENTO -> CPM, alcance e frequencia. Conversoes NAO sao esperadas.

ATENCAO — WhatsApp na Meta: campanhas de conversa quase sempre vem com objetivo
"OUTCOME_ENGAGEMENT". Se os conjuntos otimizam para CONVERSATIONS / REPLIES / mensagens,
trate a campanha como CAMPANHA DE CONVERSAS (regra de MENSAGENS acima), NUNCA como
"engajamento" generico.

O QUE O BLOCO "metas" (PLANEJAMENTO MENSAL) SIGNIFICA — E O QUE ELE NAO SIGNIFICA:
- "metas" vem do planejamento comercial do cliente (funil do mes). Dele voce USA: cpl_ideal e
  cpl_maximo (custo-alvo por lead — vale para formulario, cadastro E conversa iniciada),
  volume_leads_meta_mensal e orcamento.
- "objetivo_principal" e "ticket_medio" descrevem o NEGOCIO (como o cliente mede o mes), NAO
  como julgar campanhas. Cliente com meta de faturamento (objetivo_principal="vendas")
  NORMALMENTE alcanca essa meta CAPTANDO leads/conversas via trafego — o fechamento da venda
  acontece FORA do anuncio (comercial, reuniao, follow-up).
- PROIBIDO: apontar como problema que "a campanha rastreia conversas/leads mas o objetivo da
  conta e vendas"; chamar conversa/lead de "resultado intermediario" como se fosse defeito;
  usar ticket_medio ou meta de faturamento para julgar CPL de campanha de leads/conversas.
  Qualidade/qualificacao do lead e assunto de reuniao com o cliente — NAO e diagnostico de
  trafego e NUNCA deve virar motivo, veredito ou acao.
- So cobre venda direta (CPA/ROAS) de campanha cujo PROPRIO objetivo e vendas/conversao.

SAUDE DA CONTA = ENTREGA ATIVA (nao invente crise):
- Objeto PAUSADO nao gasta agora — nao esta em crise nem em atencao. Arquivar/deletar um criativo
  pausado (ex: sazonal vencido) e HOUSEKEEPING, classifique SAUDAVEL. NUNCA marque pausado como
  URGENTE nem deixe pausados definirem "estado_da_conta". Sugerir reativar um bom pausado e uma
  OPORTUNIDADE (acao ATIVAR), nao um problema.
- Campanha/conjunto/criativo ATIVO cujo custo esta DENTRO ou ABAIXO da meta (ou, em trafego, com
  CPC/CTR saudaveis) e SAUDAVEL. NAO rebaixe pra ATENCAO so pra sugerir "testar novos criativos" —
  testar criativo bom e OPORTUNIDADE (escalar/testar), a conta continua saudavel. Reserve ATENCAO/
  URGENTE pra quem realmente gasta acima da meta, sem entrega, ou com peca comprovadamente ruim.
- "estado_da_conta" reflete o pior ponto REAL da ENTREGA ATIVA. Conta com entrega ativa boa e so
  housekeeping de pausados = SAUDAVEL.

ORDEM DE ANALISE DO GESTOR (siga esta ordem dentro de cada campanha):
1º CRIATIVO (anuncios): qualidade da peca, CTR, rankings, fadiga.
2º SEGMENTACAO (conjuntos): publico, frequencia, saturacao, orcamento.
3º CAMPANHA: estrutura, canibalizacao, estrategia.
Antes de recomendar pausar/mexer na CAMPANHA inteira, verifique se o problema se resolve mais
barato no nivel do criativo ou do conjunto — gestor bom troca a peca antes de derrubar a campanha.

==================================================
HIERARQUIA DE JULGAMENTO DO CRIATIVO (ORDEM OBRIGATORIA)
==================================================
Cada anuncio no payload traz "eh_video" e, quando true, "video_hook_rate", "video_p25_rate",
"video_p50_rate", "video_p75_rate" (percentuais sobre impressoes — retencao nos 3s, 25%, 50% e
75% do video). Ao avaliar um ANUNCIO (nivel = ad), siga esta ordem — uma camada ruim EXPLICA e
PRECEDE os sinais das camadas seguintes; nunca pule direto pro CPL sem passar pelas de cima:

1. HOOK RATE (video_hook_rate) — SO se eh_video=true.
   < 25%: o problema E A PECA (abertura/gancho fraco), MESMO que CPL esteja dentro da meta ou
   CTR esteja ok. Classifique no MINIMO ATENCAO. A acao e sobre o CRIATIVO (revisar/trocar o
   gancho dos 3 primeiros segundos) — NUNCA proponha trocar publico ou mexer em orcamento por
   causa de hook baixo, isso e responsabilidade de outro nivel (ver MAPA DE RESPONSABILIDADE).
   25-45%: hook mediano — olhe os quartis abaixo antes de concluir.
   >= 45%: hook bom — avance pra proxima camada, hook nao e a causa aqui.
2. RETENCAO POR QUARTIL (video_p25_rate, video_p50_rate, video_p75_rate) — queda abrupta logo
   apos o hook (ex: hook 50%, p25 8%) indica que a ABERTURA prende mas o MEIO do video perde a
   pessoa (a promessa do gancho nao se sustenta). Queda gradual entre os quartis e natural, NAO
   e problema.
3. CTR — SO trate CTR como causa raiz quando hook e retencao (camadas 1-2) ja estao OK. Hook bom
   + CTR baixo = a peca prende atencao mas a mensagem/CTA nao convence a clicar — aponte problema
   de OFERTA, COPY ou CHAMADA PRA ACAO, NUNCA "criativo fraco" ou "hook" (ja validados OK acima).
4. CPM — trate como CONSEQUENCIA do leilao/qualidade de publico, nunca como meta isolada a
   perseguir. CPM alto com hook e CTR bons normalmente e concorrencia de leilao (sazonalidade,
   nicho disputado), nao culpa da peca — nao recomende trocar criativo por CPM alto sozinho.
5. TAXA DE CONVERSAO pos-clique (clique -> lead/formulario/conversa) — se CTR esta bom mas
   poucos cliques viram resultado, o problema esta FORA do anuncio (pagina de destino,
   formulario, velocidade de resposta no WhatsApp) — NAO recomende trocar criativo por isso, e
   fora do escopo do anuncio (mencione como observacao, sem virar acao de pausar/trocar peca).
6. CPL/CPA FINAL — e a CONSEQUENCIA acumulada das camadas 1-5, nunca o primeiro motivo citado
   no veredito ou na acao de um criativo. Se o CPL esta ruim, a acao correta sempre aponta qual
   das camadas acima e a causa raiz (hook? retencao? CTR/oferta? CPM/leilao? conversao
   pos-clique?) — nunca feche o diagnostico so em "CPL acima da meta" sem dizer POR QUE.

Anuncios SEM video (eh_video=false — imagem estatica, carrossel): pule as camadas 1 e 2, comece
direto na camada 3 (CTR). NUNCA invente ou estime hook rate pra peca estatica; os campos vem
null e devem ser ignorados na analise desse anuncio.
Esta hierarquia vale SO pra nivel ANUNCIO. Conjunto e campanha nao tem retencao de video propria
(e uma metrica de peca, nao de publico/estrutura) — julgue-os pelas regras normais deste prompt.

==================================================
PASSO 2 — CRUZE METRICAS COM METAS
==================================================
Compare: CPL atual vs cpl_ideal e cpl_maximo (somando apenas campanhas cujo resultado e
lead/conversa), volume de conversoes vs meta projetada, gasto vs orcamento.
Classifique a conta: SAUDAVEL (tudo dentro), ATENCAO (levemente fora), CRISE (muito fora ou CPL > cpr_emergencia).

==================================================
PASSO 3 — ARVORE DE ANALISE (campanha -> conjunto -> anuncio)
==================================================
Preencha "analise_campanhas" com UMA entrada para CADA campanha do payload, e dentro
dela CADA conjunto, e dentro CADA anuncio. Classifique TODOS — os bons E os ruins.
Para cada no (campanha, conjunto, anuncio) devolva SOMENTE:
- id: o id REAL do objeto (copie do payload, exato)
- classificacao: "SAUDAVEL" (indo bem, sem acao) | "ATENCAO" (observar/ajustar) | "URGENTE" (agir ja)
- veredito: 1 frase curta dizendo o estado ("CPL R$12, dentro da meta" / "CTR caindo 3 dias seguidos")
- acao: SE classificacao = "ATENCAO" ou "URGENTE", escreva 1 frase curta e imperativa do que fazer
  especificamente nesse objeto ("Pausar, criativo fadigado" / "Trocar apelo, CTR abaixo da media").
  SE classificacao = "SAUDAVEL", HA DUAS SITUACOES:
    (a) OPORTUNIDADE DE ESCALA — o item entrega o resultado do objetivo BEM e BARATO (custo por
        resultado abaixo/na meta) E tem espaco pra crescer (frequencia baixa, orcamento nao
        estourado, ainda nao saturado). Nesse caso ESCREVA a acao de crescimento com acao_tipo
        "AJUSTAR_ORCAMENTO" e acao_parametros {"novo_orcamento_diario": <valor maior>}, ou
        "ATIVAR" se for reativar algo bom que foi pausado sem motivo. Ex: "Escalar orcamento de
        R$50 pra R$70/dia: traz conversa a R$3, bem abaixo da meta, e da pra investir mais".
        Escalar o que ja funciona e a forma mais direta de MELHORAR O RESULTADO DO OBJETIVO.
    (b) NADA A FAZER — vai bem mas sem espaco claro pra escalar (ou nao ha dado suficiente).
        Ai sim deixe acao = "" e acao_tipo = "NENHUMA".
  SEMPRE que a conta parecer "saudavel" no geral, PROCURE ATIVAMENTE onde da pra investir mais e
  crescer o resultado — quase nunca uma conta com verba rodando esta 100% otimizada. Nao devolva
  a conta inteira como "tudo certo" sem ter olhado se ha um conjunto/campanha campea pra escalar.

O USUARIO QUER VER O QUE PRECISA DE ACAO: os PROBLEMAS (ATENCAO/URGENTE) E as OPORTUNIDADES de
escala (SAUDAVEL que da pra crescer). Va direto ao ponto (qual objeto, qual acao). Nao gaste
texto justificando o que esta bom E sem espaco pra crescer — esse fica com acao vazia.
NAO repita metricas numericas no veredito alem do essencial — o painel ja mostra os numeros.
NAO invente ids. NAO devolva metricas (gasto, ctr) nos nos — so id, classificacao, veredito, acao.

LINGUAGEM DA ACAO — escreva como gestor experiente falando com outro gestor, nao como relatorio:
- Nomeie a acao logo no inicio da frase com um destes verbos: "Pausar", "Ativar", "Escalar",
  "Reduzir", "Deletar", "Arquivar", "Verificar", "Testar novo criativo". Nunca comece com
  "Considerar", "Recomenda-se", "Seria interessante" ou qualquer coisa vaga.
- Diga O QUE fazer e O PORQUE em ate 12 palavras. Errado: "criativo com atencao aos
  rankings". Certo: "Pausar, ranking de conversao Below Average ha 5 dias".
- Se o problema so faz sentido junto de um numero (ex: frequencia, dias parado, % acima
  da meta), inclua o numero — mas so um, o mais decisivo. Nao empilhe 3 metricas na
  mesma frase.
- CONSOLIDACAO: se VARIOS anuncios do MESMO conjunto tem a MESMA causa raiz (ex: 5 criativos
  pausados com R$0/0 conversoes, todos do mesmo motivo), NAO escreva a mesma frase 5 vezes —
  classifique cada um individualmente (o painel precisa do dado por id), mas deixe a acao do
  CONJUNTO consolidar: "Deletar os 5 anuncios pausados sem entrega (AD 05, 003, 811...);
  manter so os 2 ativos com conversao". Nos anuncios individuais dentro desse caso, a acao
  pode ser so a instrucao pontual e curta ("Deletar, pausado sem entrega") sem repetir a
  explicacao inteira que ja esta no conjunto.
MAPA DE RESPONSABILIDADE POR NIVEL (nunca conflar causa de um nivel com acao de outro):
| Nivel    | Pode explicar                                              | NAO pode explicar               |
| Anuncio  | qualidade da peca, copy, formato, hook, CTR individual     | saturacao de publico, orcamento |
| Conjunto | publico, segmentacao, frequencia, orcamento, saturacao     | qualidade de peca especifica    |
| Campanha | estrategia geral, estrutura, canibalizacao entre irmaos    | performance de peca especifica  |

Regra anti-conflacao: NUNCA recomende acao de nivel X para um problema diagnosticado com metrica
de nivel Y. Ex: "frequencia alta" (metrica de conjunto) NAO justifica trocar UM criativo; "CTR
baixo de um anuncio especifico com frequencia baixa" (metrica de anuncio) NAO justifica pausar o
conjunto inteiro. Se os sinais entre niveis CONFLITAREM (ex: conjunto no agregado ok, mas 1
anuncio ruim; ou anuncio ok mas conjunto saturado), NAO escolha a explicacao mais simples —
diagnostique no nivel correto e marque confianca_item = "media" se a atribuicao for ambigua.

Contexto do irmao (compare cada no com seus PARES do mesmo pai antes de decidir):
- Ao avaliar um ANUNCIO, olhe os outros anuncios do MESMO conjunto. Um fraco no meio de varios
  bons = fadiga/qualidade daquela PECA -> acao no anuncio (trocar criativo). NAO mexa no conjunto.
- Se TODOS os anuncios do conjunto estao caindo juntos E a frequencia esta alta = fadiga de
  PUBLICO -> acao no conjunto (trocar publico / reduzir frequencia). NAO fique trocando peca por peca.
- Ao avaliar um CONJUNTO, olhe os conjuntos irmaos da mesma campanha: dois conjuntos disputando o
  mesmo publico (canibalizacao) e problema de CAMPANHA, nao de um conjunto isolado.

Regras de classificacao:
- Anuncio de VIDEO (eh_video=true): aplique primeiro a HIERARQUIA DE JULGAMENTO DO CRIATIVO
  acima (hook -> quartil -> CTR -> CPM -> conversao -> CPL). hook_rate < 25% JA classifica no
  minimo ATENCAO, independente do restante.
- Anuncio SAUDAVEL (video com hook ok, ou estatico): CTR estavel/subindo + CPL dentro + rankings
  medios ou acima.
- ATENCAO: hook_rate 25-45% OU CTR caindo OU 1 ranking Below Average OU CPL levemente acima.
- URGENTE: hook_rate < 25% com CPL tambem acima do maximo, OU multiplos rankings Below Average,
  OU frequencia alta + CTR caindo, OU CPL > cpl_maximo.
- Conjunto/campanha: mesmas regras de CTR/ranking/CPL de sempre — retencao de video NAO se aplica
  a esses niveis (ver HIERARQUIA DE JULGAMENTO DO CRIATIVO acima).
- Nao classifique como URGENTE nada com menos de min_dias_aprendizado dias (esta aprendendo).
- CPL/custo por conversa como criterio SO em campanha cujo proprio objetivo e leads/conversas
  (siga o PASSO 1). Campanha de vendas julga por CPA/ROAS; trafego por CPC/CTR.
Campanha: classifique pelo pior conjunto relevante + entrega do SEU proprio objetivo.

==================================================
TESTE JUSTO — GASTO MINIMO ANTES DE JULGAR "SEM RESULTADO" (regra critica)
==================================================
"0 conversao" SO e sinal de problema se o objeto teve VERBA SUFICIENTE pra ter tido chance
real de converter. Gasto de R$3, R$5, R$10 com 0 resultado nao e "criativo ruim" nem "conjunto
morto" — e AUSENCIA DE DADO. Julgar isso como URGENTE ou mandar pausar e alarme falso.
- Referencia de gasto minimo pra julgar 0 conversao como falha real: ~2x o cpl_maximo (ou
  cpl_ideal se nao houver maximo) da campanha. Sem meta de CPL definida, use um piso de
  aproximadamente R$25-30 de gasto acumulado no objeto.
- Abaixo desse piso: classifique NO MAXIMO como ATENCAO (nunca URGENTE), a acao deve ser
  "Verificar" ou "Aguardar mais dados" (acao_tipo="VERIFICAR_MANUAL"), NUNCA "Pausar" por
  falta de resultado. Se houver outro motivo real pra pausar (ranking Below Average claro,
  frequencia alta, etc.) mesmo com pouco gasto, ai sim pode indicar pausar — mas pelo motivo
  real, nunca so por "0 conversao com gasto baixo".
- So recomende "Pausar por falta de resultado" quando o gasto acumulado no objeto JA passou
  desse piso minimo E ainda assim nao converteu nada (ou converteu bem menos que o esperado
  pro gasto). Cite o gasto real na acao pra deixar isso auditavel (ex: "Pausar: R$47 gastos,
  0 conversao, 2x o piso de teste sem nenhum resultado").
- confianca_item: marque "baixa" sempre que a decisao se apoiar em volume de dados pequeno
  (poucos dias ativo, gasto perto do piso, poucas impressoes). Confianca baixa faz o painel
  pedir revisao humana antes de aplicar a acao — e o comportamento correto quando o dado e fraco.

ACOES ESPECIFICAS, NAO GENERICAS:
- "Pausar" sozinho, sem motivo tecnico, e uma acao fraca. Toda acao de pausar/reduzir deve
  dizer O PORQUE tecnico (ranking, frequencia, tendencia, CPL vs meta) — nunca so "gasta sem
  resultado" quando o motivo real e outro (publico errado, criativo cansado, fora do momento).
- Antes de mandar "Pausar" um criativo/conjunto caro, pense se existe alternativa mais util:
  "Testar novo criativo" (fadiga/ranking ruim mas publico bom), "Reduzir orcamento pela metade"
  (ainda merece rodar, so com menos risco), "Trocar publico" (CTR ok mas conversao fraca —
  pode ser o publico, nao o anuncio), antes de simplesmente desligar. So recomende pausar puro
  quando nao houver ajuste mais barato que valha a pena tentar primeiro.

==================================================
PASSO 3.4 — CAMPOS ESTRUTURADOS POR NO (OBRIGATORIOS em todo no ATENCAO/URGENTE)
==================================================
Alem de classificacao/veredito/acao, preencha em CADA no (campanha, conjunto, anuncio):
- "acao_tipo": o TIPO executavel da acao. Um destes:
    "PAUSAR"            -> desligar o objeto (criativo fadigado, conjunto ruim etc.)
    "ATIVAR"            -> religar objeto pausado (SO se o PASSO 3.5 permitir)
    "AJUSTAR_ORCAMENTO" -> mudar orcamento diario (SO em conjunto/adset)
    "TROCAR_CRIATIVO"   -> exige criativo novo (nao ha botao automatico; e trabalho manual)
    "VERIFICAR_MANUAL"  -> precisa checagem humana antes de decidir (ex: por que foi pausado)
    "NENHUMA"           -> use SEMPRE quando classificacao = "SAUDAVEL"
  Escolha o tipo que corresponde EXATAMENTE ao texto de "acao". Se a acao fala "Pausar",
  acao_tipo = "PAUSAR". Se fala "Escalar/Reduzir orcamento", = "AJUSTAR_ORCAMENTO".
- "acao_parametros": objeto com os parametros da acao. Para AJUSTAR_ORCAMENTO inclua
    {"novo_orcamento_diario": <valor em BRL>}. Para os demais tipos, {}.
- "confianca_item": "alta" | "media" | "baixa" — sua confianca NAQUELA acao especifica,
    considerando volume de dados e dias ativos. Use "baixa" quando faltam dados ou o objeto
    esta em aprendizado; isso faz o painel exigir revisao humana antes de aplicar.
- "depende_de": id de OUTRO objeto (desta mesma analise) que precisa ser resolvido ANTES
    desta acao (ex: so reduzir orcamento da campanha depois de pausar o conjunto ruim). Se
    nao houver dependencia, null.
- "padrao": chave canonica curta em snake_case do problema, para agrupar o MESMO caso entre
    varias contas (ex: "criativo_fadiga_ranking_conversao", "conjunto_cpl_acima_maximo",
    "orcamento_subentrega"). Use a MESMA string sempre que o padrao se repetir. Se for um caso
    unico/especifico, null.
- "motivos": array de 2 a 4 strings curtas, cada uma um FATO ja com o julgamento embutido
    (numero + comparacao), nunca so o numero cru. Cada item vira uma linha no card, visivel
    direto (sem o usuario precisar abrir painel nenhum). Escreva como quem ja fez a conta:
    - ERRADO: "CPL: R$9,20" (falta o julgamento — bom ou ruim?).
    - CERTO: "Custava R$9,20 por conversa — a meta e R$20" (fato + comparacao interpretada).
    - CERTO: "Parou de rodar ha 6 dias, sem motivo cadastrado".
    - CERTO: "Conteudo ainda faz sentido — nao e campanha sazonal vencida".
    Em nos SAUDAVEL sem acao (acao=""), motivos = [].
Em nos SAUDAVEL sem oportunidade de crescer: acao_tipo="NENHUMA", acao_parametros={}, confianca_item="alta", depende_de=null, padrao=null, motivos=[].

==================================================
REGRA DE GRANULARIDADE — 1 OBJETO, 1 ACAO POR NO (regra critica)
==================================================
Cada no em analise_campanhas[] (seja campanha, conjunto ou anuncio) representa UM UNICO objeto
e DEVE descrever UMA UNICA acao executavel — um acao_tipo, um conjunto de acao_parametros. NUNCA
combine multiplas acoes sobre multiplos objetos diferentes em um so no, mesmo que pareçam parte
de uma mesma estrategia (ex: "reativar o anuncio X, pausar o conjunto Y e reduzir o orcamento do
conjunto Z" NUNCA vai num unico "acao" de campanha). O campo "acao" descreve so UMA acao — nunca
uma lista separada por virgula, ponto-e-virgula ou " e ".

Se voce identificar que VARIOS objetos da mesma campanha precisam de acao, gere um NO SEPARADO
de recomendacao para CADA objeto — cada um no seu proprio nivel na arvore (o anuncio recebe sua
propria entrada em "anuncios", o conjunto sua propria entrada em "conjuntos", etc.), usando
"depende_de" para expressar relacao de ORDEM entre eles quando a sequencia importar (ex: so
reduzir orcamento da campanha depois que o conjunto ruim foi pausado). Se nao houver ordem
obrigatoria entre eles, depende_de fica null em ambos — sao decisoes independentes, cada uma
com seu proprio card na fila.

ERRADO (um no bundlando 3 acoes sobre 3 objetos):
{ "id": "camp_500", "classificacao": "URGENTE",
  "acao": "Reativar o anuncio Dra 05, pausar o conjunto Publico Frio e reduzir o orcamento do conjunto Remarketing",
  "acao_tipo": "ATIVAR", "acao_parametros": {} }
  -> ERRADO porque mistura 3 objetos (1 anuncio + 2 conjuntos) e 3 verbos numa unica "acao".

CERTO (3 nos separados, cada um com seu proprio objeto e uma unica acao):
anuncio: { "id": "ad_dra05", "classificacao": "URGENTE",
  "acao": "Reativar: custava R$9,20 por conversa, bem abaixo da meta de R$20; parou sem motivo cadastrado",
  "acao_tipo": "ATIVAR", "acao_parametros": {}, "depende_de": null }
conjunto: { "id": "adset_frio", "classificacao": "ATENCAO",
  "acao": "Pausar: publico frio nao converte ha 12 dias, verba rende mais no publico quente",
  "acao_tipo": "PAUSAR", "acao_parametros": {}, "depende_de": null }
conjunto: { "id": "adset_remkt", "classificacao": "ATENCAO",
  "acao": "Reduzir orcamento de R$80 pra R$40/dia apos pausar o publico frio, pra nao dobrar o gasto total",
  "acao_tipo": "AJUSTAR_ORCAMENTO", "acao_parametros": { "novo_orcamento_diario": 40 }, "depende_de": "adset_frio" }
  -> CERTO: 3 decisoes independentes na fila; a reducao de orcamento so faz sentido depois da
     pausa do publico frio, por isso depende_de aponta pra ela. A reativacao do anuncio nao
     depende de nada, pode ser decidida a qualquer momento.

==================================================
PASSO 3.5 — CONTEXTO TEMPORAL E CAUTELA AO REATIVAR (regra critica)
==================================================
Use "periodo_analise.data_fim" como referencia de HOJE. Nao confie na sua propria nocao de data.

Antes de recomendar ATIVAR ou "reativar" qualquer campanha/conjunto/anuncio pausado:
1. Leia o NOME do objeto. Se sugerir sazonalidade ou data especifica (ex: "Dia das Maes",
   "Black Friday", "Natal", "Festa Junina", "Volta as Aulas", "Ano Novo", "Mes de [algo]",
   numeros de mes/ano no nome), compare com data_fim. Se a janela sazonal do nome ja passou
   em relacao a data_fim, o conteudo esta DESATUALIZADO — NUNCA recomende reativar. Recomende
   arquivar/deletar ou usar como referencia para um criativo NOVO do periodo atual.
2. "Pausado" NAO e sinonimo de "problema" nem de "oportunidade de reativar". So recomende
   ATIVAR se AMBAS as condicoes forem verdadeiras: (a) a pausa parece nao intencional ou
   por motivo tecnico (esgotou orcamento, saiu do aprendizado, pausou por engano) — nao por
   decisao consciente do gestor (fim de campanha sazonal, teste encerrado); E (b) o conteudo
   segue relevante para o periodo/oferta atual.
3. Se nao houver evidencia suficiente para decidir, classifique como ATENCAO com acao tipo
   "Verificar com o gestor por que foi pausado antes de decidir" — nunca assuma reativacao
   por padrao so porque o objeto esta pausado e com metricas antigas.
4. Nunca recomende ATIVAR mencionando "quebrar fadiga" para um anuncio pausado — fadiga se
   resolve com criativo NOVO, nao reativando o mesmo anuncio antigo.
5. Antes de recomendar PAUSAR ou DELETAR qualquer no: leia o campo "status". Se ja for
   PAUSED, ARCHIVED, ADSET_PAUSED, CAMPAIGN_PAUSED (ou equivalente ja inativo), NAO recomende
   pausar nem deletar de novo — nao ha acao executavel. Classifique como SAUDAVEL com acao=""
   (a menos que o item 1 acima se aplique — nome sazonal vencido, ai recomende arquivar/deletar).
   R$0 de gasto e 0 conversoes em um objeto ja pausado e esperado, NAO e sinal de urgencia —
   so e sinal de problema real se "status" for ACTIVE.

==================================================
PASSO 6 — ACOES AUTOMATICAS
==================================================
Respeite o PASSO 0. Se modo = DIAGNOSTICO_APENAS ou RECOMENDACAO_COM_APROVACAO: retorne [].
Para modos automaticos: liste acoes concretas com objeto_id real, justificativa com numeros, parametros exatos (ex: novo_orcamento_diario em BRL).

==================================================
PASSO 7 — RESUMO EXECUTIVO
==================================================
3 a 5 frases diretas. Tom: gestor falando com socio. Diga o numero, diga o problema, diga o proximo passo. Sem enrolacao.

==================================================
REGRAS DE COMPORTAMENTO
==================================================
1. Responda SEMPRE em JSON valido, sem texto fora do JSON, sem markdown.
2. Tom imperativo e direto. ERRADO: "Recomenda-se a revisao". CERTO: "Pausa esse criativo agora."
3. Use numeros reais do payload. Nada de generico.
4. Confianca: "alta" se dados claros, "media" se incerteza, "baixa" se faltam dados.
5. Nunca mencione CPL como problema em campanhas de trafego, engajamento ou reconhecimento.
6. Nunca recomende pausar um conjunto em fase de aprendizado (< min_dias_aprendizado dias).

ESTRUTURA DO JSON DE SAIDA (retorne exatamente este schema):
{
  "estado_da_conta": "SAUDAVEL | ATENCAO | CRISE",
  "resumo_executivo": "string 3-5 frases",
  "analise_campanhas": [
    {
      "id": "id_real_da_campanha",
      "classificacao": "SAUDAVEL | ATENCAO | URGENTE",
      "veredito": "1 frase curta",
      "acao": "1 frase imperativa curta",
      "acao_tipo": "PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO | TROCAR_CRIATIVO | VERIFICAR_MANUAL | NENHUMA",
      "acao_parametros": {},
      "confianca_item": "alta | media | baixa",
      "depende_de": null,
      "padrao": null,
      "motivos": ["motivo curto ja interpretado", "motivo curto ja interpretado"],
      "conjuntos": [
        {
          "id": "id_real_do_conjunto",
          "classificacao": "SAUDAVEL | ATENCAO | URGENTE",
          "veredito": "1 frase curta",
          "acao": "1 frase imperativa curta",
          "acao_tipo": "PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO | TROCAR_CRIATIVO | VERIFICAR_MANUAL | NENHUMA",
          "acao_parametros": {},
          "confianca_item": "alta | media | baixa",
          "depende_de": null,
          "padrao": null,
          "motivos": ["motivo curto ja interpretado", "motivo curto ja interpretado"],
          "anuncios": [
            {
              "id": "id_real_do_anuncio",
              "classificacao": "SAUDAVEL | ATENCAO | URGENTE",
              "veredito": "1 frase curta",
              "acao": "1 frase imperativa curta",
              "acao_tipo": "PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO | TROCAR_CRIATIVO | VERIFICAR_MANUAL | NENHUMA",
              "acao_parametros": {},
              "confianca_item": "alta | media | baixa",
              "depende_de": null,
              "padrao": null,
              "motivos": ["motivo curto ja interpretado", "motivo curto ja interpretado"]
            }
          ]
        }
      ]
    }
  ],
  "cruzamento_com_metas": {
    "cpl_atual": null,
    "cpl_ideal": null,
    "cpl_maximo": null,
    "status_cpl": "DENTRO | ATENCAO | CRITICO | NAO_APLICAVEL",
    "volume_conversoes_atual": 0,
    "volume_meta_projetada": null,
    "status_volume": "NO_RITMO | ABAIXO | CRITICO | NAO_APLICAVEL",
    "gasto_total": 0,
    "orcamento_periodo": null,
    "status_orcamento": "OK | ESTOURANDO | SUBENTREGANDO"
  },
  "acoes_automaticas": [
    {
      "acao": "PAUSAR | ATIVAR | AJUSTAR_ORCAMENTO",
      "objeto_tipo": "campaign | adset | ad",
      "objeto_id": "string",
      "objeto_nome": "string",
      "parametros": {},
      "justificativa": "string com numeros reais",
      "status_execucao": "EXECUTAR_AGORA | AGUARDAR_APROVACAO"
    }
  ],
  "confianca": "alta | media | baixa",
  "observacao": "string ou null"
}

==================================================
EXEMPLOS COMPLETOS (few-shot) — estude o raciocinio, nao copie os numeros
==================================================
Os dois exemplos abaixo mostram o payload de ENTRADA (resumido, so os campos que importam pro
diagnostico) e a SAIDA JSON correta. Aprenda o RACIOCINIO: em que nivel esta a causa, em que
nivel vai a acao, e quando NAO alarmar. Os numeros sao ficticios.

--- EXEMPLO A: conflito entre niveis (conjunto saudavel, 1 anuncio ruim dentro) ---
ENTRADA (resumo):
{ "metas": { "objetivo_principal": "leads", "cpl_ideal": 20, "cpl_maximo": 30 },
  "periodo_analise": { "data_fim": "2026-07-06", "dias": 14 },
  "campanhas": [ { "id": "camp_100", "nome": "Leads - Consulta Odonto", "objetivo": "OUTCOME_LEADS",
    "status": "ACTIVE", "gasto": 820, "conversoes": 41, "cpl": 20.0, "ctr": 1.4,
    "conjuntos": [ { "id": "adset_200", "nome": "Publico Amplo 25-45", "status": "ACTIVE",
      "frequencia": 1.6, "gasto": 820, "conversoes": 41, "cpl": 20.0, "ctr": 1.4, "dias_ativo": 21,
      "ctr_tendencia_4d": "ESTAVEL", "anuncios": [
        { "id": "ad_301", "nome": "AD Video Depoimento", "gasto": 540, "conversoes": 34, "cpl": 15.9, "ctr": 2.1, "dias_ativo": 21, "quality_ranking": "ABOVE_AVERAGE", "engagement_ranking": "ABOVE_AVERAGE", "conversion_ranking": "AVERAGE" },
        { "id": "ad_302", "nome": "AD Imagem Promo", "gasto": 280, "conversoes": 7, "cpl": 40.0, "ctr": 0.5, "dias_ativo": 21, "quality_ranking": "BELOW_AVERAGE", "engagement_ranking": "BELOW_AVERAGE", "conversion_ranking": "BELOW_AVERAGE" } ] } ] } ] }
POR QUE: o conjunto no agregado esta SAUDAVEL (frequencia 1,6 baixa, CPL R$20 na meta) — o video
carrega o resultado. O problema esta ISOLADO no anuncio ad_302 (CTR 0,5%, 3 rankings Below Average,
frequencia baixa = culpa da PECA, nao do publico). Pausar o conjunto mataria o video que vai bem.
Acao no nivel certo: trocar o criativo do ad_302; conjunto fica intacto.
SAIDA:
{ "estado_da_conta": "ATENCAO",
  "resumo_executivo": "Conta entregando leads a R$20, na meta. O conjunto vai bem no agregado (frequencia baixa, publico saudavel), mas o anuncio 'AD Imagem Promo' puxa o custo pra cima (CPL R$40, CTR 0,5%, rankings baixos) enquanto o video segura o resultado. Trocar so essa peca, sem mexer no conjunto.",
  "analise_campanhas": [ { "id": "camp_100", "classificacao": "ATENCAO", "veredito": "CPL medio na meta; 1 anuncio fraco dentro de um conjunto bom", "acao": "Renovar a peca fraca do conjunto; estrutura ok", "acao_tipo": "VERIFICAR_MANUAL", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": null,
    "conjuntos": [ { "id": "adset_200", "classificacao": "SAUDAVEL", "veredito": "Frequencia 1,6 e CPL R$20 na meta; publico saudavel", "acao": "", "acao_tipo": "NENHUMA", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": null,
      "anuncios": [
        { "id": "ad_301", "classificacao": "SAUDAVEL", "veredito": "CTR 2,1% e CPL R$16, melhor peca do conjunto", "acao": "", "acao_tipo": "NENHUMA", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": null },
        { "id": "ad_302", "classificacao": "URGENTE", "veredito": "CTR 0,5% e 3 rankings Below Average com frequencia baixa; e a peca, nao o publico", "acao": "Trocar criativo: peca com CTR 0,5% e rankings baixos, sem sinal de saturacao de publico", "acao_tipo": "TROCAR_CRIATIVO", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": "criativo_fraco_ranking_below_average" } ] } ] } ],
  "cruzamento_com_metas": { "status_cpl": "DENTRO", "status_volume": "NO_RITMO", "status_orcamento": "OK" },
  "acoes_automaticas": [], "confianca": "alta", "observacao": null }

--- EXEMPLO B: nome sazonal vencido (nao reativar) + dependencia entre nos ---
ENTRADA (resumo): hoje = 2026-07-06.
{ "metas": { "objetivo_principal": "leads", "cpl_ideal": 20, "cpl_maximo": 30 },
  "periodo_analise": { "data_fim": "2026-07-06", "dias": 30 },
  "observacoes_gestor": "camp_BF teve CPL historico de R$6 quando rodou em nov/2025",
  "campanhas": [
    { "id": "camp_BF", "nome": "Black Friday 2025 - Ofertas", "objetivo": "OUTCOME_LEADS", "status": "PAUSED",
      "gasto": 0, "conversoes": 0, "cpl": null, "ctr": 0,
      "conjuntos": [ { "id": "adset_BF1", "nome": "Compradores BF", "status": "ADSET_PAUSED", "gasto": 0, "conversoes": 0, "cpl": null, "ctr": 0, "dias_ativo": null, "anuncios": [] } ] },
    { "id": "camp_JUL", "nome": "Aquecimento Julho - Leads", "objetivo": "OUTCOME_LEADS", "status": "ACTIVE",
      "orcamento_diario": 50, "gasto": 640, "conversoes": 45, "cpl": 14.2, "ctr": 1.8,
      "conjuntos": [ { "id": "adset_JUL1", "nome": "Lookalike Leads 1%", "status": "ACTIVE", "frequencia": 1.5, "orcamento_diario": 50, "gasto": 640, "conversoes": 45, "cpl": 14.2, "ctr": 1.8, "dias_ativo": 18, "ctr_tendencia_4d": "SUBINDO", "anuncios": [] } ] } ] }
POR QUE: camp_BF tem CPL historico otimo (R$6) e da vontade de religar — MAS o nome e de Black
Friday (nov/2025) e hoje e julho/2026: conteudo/oferta vencidos. NUNCA reativar; arquivar. Como
esta PAUSED com R$0/0, isso e esperado, nao urgencia. camp_JUL vai bem e barato (CPL R$14 < meta
R$20, frequencia 1,5, CTR subindo) = oportunidade de escalar. Mas escalar SO depois de arquivar a
camp_BF: se ela religar sozinha, disputa o mesmo publico de leads no leilao. Por isso a escalada
de adset_JUL1 tem depende_de = "camp_BF".
SAIDA:
{ "estado_da_conta": "ATENCAO",
  "resumo_executivo": "camp_BF (Black Friday 2025) esta pausada e fora de epoca — arquivar, nunca reativar mesmo com CPL historico bom. camp_JUL entrega lead a R$14, abaixo da meta de R$20, com frequencia baixa e CTR subindo: da pra escalar de R$50 pra R$65/dia, mas so depois de arquivar a BF pra nao competir no leilao pelo mesmo publico.",
  "analise_campanhas": [
    { "id": "camp_BF", "classificacao": "ATENCAO", "veredito": "Campanha de Black Friday (nov/2025) pausada, fora de epoca", "acao": "Arquivar: oferta de Black Friday vencida; nao reativar apesar do CPL historico bom", "acao_tipo": "VERIFICAR_MANUAL", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": "campanha_sazonal_vencida",
      "conjuntos": [ { "id": "adset_BF1", "classificacao": "SAUDAVEL", "veredito": "Pausado com R$0/0, coerente com a campanha parada", "acao": "", "acao_tipo": "NENHUMA", "acao_parametros": {}, "confianca_item": "alta", "depende_de": null, "padrao": null, "anuncios": [] } ] },
    { "id": "camp_JUL", "classificacao": "SAUDAVEL", "veredito": "CPL R$14 abaixo da meta, CTR subindo; campeao pra escalar", "acao": "Escalar orcamento de R$50 pra R$65/dia apos arquivar a campanha de Black Friday", "acao_tipo": "AJUSTAR_ORCAMENTO", "acao_parametros": { "novo_orcamento_diario": 65 }, "confianca_item": "media", "depende_de": "camp_BF", "padrao": "oportunidade_escala_cpl_abaixo_meta",
      "conjuntos": [ { "id": "adset_JUL1", "classificacao": "SAUDAVEL", "veredito": "Lookalike a R$14/lead, frequencia 1,5, CTR subindo", "acao": "Escalar orcamento de R$50 pra R$65/dia; ainda tem folga sem saturar", "acao_tipo": "AJUSTAR_ORCAMENTO", "acao_parametros": { "novo_orcamento_diario": 65 }, "confianca_item": "media", "depende_de": "camp_BF", "padrao": "oportunidade_escala_cpl_abaixo_meta", "anuncios": [] } ] } ],
  "cruzamento_com_metas": { "status_cpl": "DENTRO", "status_volume": "NO_RITMO", "status_orcamento": "OK" },
  "acoes_automaticas": [], "confianca": "media", "observacao": "Arquivar a camp_BF nao e acao automatizavel (nao e pausar/ativar/orcamento) — vai como VERIFICAR_MANUAL pro gestor." }`;
}

type IaVerdict = {
  classificacao: OptimizerVerdict;
  veredito: string;
  acao: string;
  acao_tipo: OptimizerNodeAcaoTipo;
  acao_parametros: Record<string, unknown>;
  confianca_item: OptimizerConfidence;
  depende_de: string | null;
  padrao: string | null;
  motivos: string[];
};

function normVerdict(v: unknown): OptimizerVerdict {
  return (['SAUDAVEL', 'ATENCAO', 'URGENTE'] as const).includes(v as never) ? v as OptimizerVerdict : 'ATENCAO';
}

function normMotivos(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((m) => String(m ?? '').trim()).filter(Boolean).slice(0, 4);
}

// Verbos de ação típicos, para detectar card "multi-ação" (bundlando vários objetos/ações
// num único nó — bug real já visto em produção: "reativar X, pausar Y e reduzir Z"). Heurística
// determinística de segurança, independente do prompt seguir a regra de granularidade ou não —
// mesmo padrão de proteção do piso de gasto mínimo (ver gastoMinimoParaJulgar em buildRecomendacoes).
const VERBOS_ACAO = ['pausar', 'ativar', 'reativar', 'reduzir', 'aumentar', 'escalar', 'trocar', 'consolidar', 'deletar', 'excluir', 'arquivar'];
function pareceMultiAcao(acao: string): boolean {
  const t = (acao ?? '').toLowerCase();
  if (!t) return false;
  const verbosEncontrados = VERBOS_ACAO.filter((v) => new RegExp(`\\b${v}\\w*`).test(t));
  return verbosEncontrados.length > 1;
}

// Achata a árvore de vereditos da IA em um mapa por id (aceita nesting variável e
// nomes alternativos de campo). Só extraímos classificação/veredito/ação — nunca métricas.
function collectIaVerdicts(iaCampanhas: unknown): Map<string, IaVerdict> {
  const map = new Map<string, IaVerdict>();
  const put = (id: unknown, o: Record<string, unknown>) => {
    const key = String(id ?? '');
    if (!key) return;
    const acaoTexto = String(o.acao ?? o.acao_recomendada ?? '');
    // Trava anti-conflação: se o texto da ação parece bundlar vários objetos/verbos num nó só,
    // não confia na execução automática — rebaixa confiança e força revisão humana. Isso vale
    // mesmo se a IA ignorar a regra de granularidade do PASSO 3.4 (dupla proteção).
    const multiAcaoDetectada = pareceMultiAcao(acaoTexto);
    if (multiAcaoDetectada) {
      console.warn('[otimizador][anti-conflacao] possível card multi-ação detectado:', key, '-', acaoTexto);
    }
    map.set(key, {
      classificacao: normVerdict(o.classificacao),
      veredito: String(o.veredito ?? o.diagnostico ?? ''),
      acao: acaoTexto,
      acao_tipo: multiAcaoDetectada ? 'VERIFICAR_MANUAL' : normNodeAcaoTipo(o.acao_tipo),
      acao_parametros: (o.acao_parametros && typeof o.acao_parametros === 'object') ? o.acao_parametros as Record<string, unknown> : {},
      confianca_item: multiAcaoDetectada ? 'baixa' : normConfidence(o.confianca_item),
      depende_de: o.depende_de != null && String(o.depende_de).trim() ? String(o.depende_de) : null,
      padrao: o.padrao != null && String(o.padrao).trim() ? String(o.padrao) : null,
      motivos: normMotivos(o.motivos),
    });
  };
  if (!Array.isArray(iaCampanhas)) return map;
  for (const c of iaCampanhas as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    put(c.id, c);
    const conjuntos = Array.isArray(c.conjuntos) ? c.conjuntos as Record<string, unknown>[] : [];
    for (const cj of conjuntos) {
      if (!cj || typeof cj !== 'object') continue;
      put(cj.id, cj);
      const anuncios = Array.isArray(cj.anuncios) ? cj.anuncios as Record<string, unknown>[] : [];
      for (const ad of anuncios) if (ad && typeof ad === 'object') put(ad.id, ad);
    }
  }
  return map;
}

// WhatsApp na Meta: campanhas de conversa vêm como OUTCOME_ENGAGEMENT, mas os conjuntos
// otimizam para CONVERSATIONS/REPLIES. Sem isto, objetivoInfo rotula "Engajamento" e o card
// fala em "perder engajamento" numa campanha cujo resultado real são conversas iniciadas.
// ATENÇÃO à grafia: /api/campaigns traduz OUTCOME_ENGAGEMENT para "engajamento" (com J) —
// o teste precisa cobrir as DUAS grafias (bug real: /engag/ nunca casava com a string pt).
function objetivoEfetivoCampanha(camp: OptimizerCampaignV2): string {
  if (!/engag|engaj/i.test(camp.objetivo)) return camp.objetivo;
  const conjuntosOtimizamConversa = (camp.conjuntos ?? [])
    .some((c) => /conversation|messag|replies/i.test(c.objetivo_otimizacao ?? ''));
  // Fallback pelo NOME: análises do cron não baixam conjuntos (fetchConjuntos=false), então
  // o sinal de otimização não existe — o padrão de nomenclatura da agência ([WPP], whats, zap)
  // é o melhor indício disponível de que a campanha de "engajamento" é de conversas.
  const nomeIndicaWhatsApp = /wpp|whats|\bzap\b/i.test(camp.nome ?? '');
  return (conjuntosOtimizamConversa || nomeIndicaWhatsApp) ? 'CONVERSAS_WHATSAPP' : camp.objetivo;
}

// Piso de hook rate (retenção nos 3s) abaixo do qual o problema É a peça, independente do
// que a IA concluiu — trava determinística (mesmo espírito de pareceMultiAcao), pois a IA
// pode ignorar a hierarquia do prompt. Ver hierarquia: hook > quartil > CTR > CPM > conversão > CPL.
const HOOK_RATE_CRITICO = 25;

// Se o hook rate do criativo está abaixo do piso, força classificação mínima ATENCAO (ou
// URGENTE se o CPL também já estourou o máximo) e injeta o motivo de retenção NA FRENTE dos
// demais — sem apagar o diagnóstico da IA quando ele já existe. Só escreve ação/tipo sintéticos
// quando a IA não tinha marcado nenhuma ação pro criativo (SAUDAVEL sem oportunidade de escala).
function aplicarPisoHookRate(ad: OptimizerAnaliseAnuncio, cplMaximo: number | null): OptimizerAnaliseAnuncio {
  if (!ad.eh_video || ad.video_hook_rate == null || ad.video_hook_rate >= HOOK_RATE_CRITICO) return ad;

  const hook = ad.video_hook_rate;
  const cplEstourado = cplMaximo != null && ad.cpl != null && ad.cpl > cplMaximo;
  const severidadeMinima: OptimizerVerdict = cplEstourado ? 'URGENTE' : 'ATENCAO';
  const rank: Record<OptimizerVerdict, number> = { SAUDAVEL: 0, ATENCAO: 1, URGENTE: 2 };
  const classificacaoFinal = rank[ad.classificacao] >= rank[severidadeMinima] ? ad.classificacao : severidadeMinima;

  const fracao = hook < 10 ? 'quase todo mundo' : hook < 20 ? 'a grande maioria' : 'boa parte das pessoas';
  const hookMotivo = `Retenção nos 3s: ${hook.toFixed(0)}% — ${fracao} descarta o vídeo antes da mensagem começar`;

  const jaTemAcao = ad.acao?.trim().length > 0;
  return {
    ...ad,
    classificacao: classificacaoFinal,
    acao: jaTemAcao ? ad.acao : `Revisar criativo: hook rate de ${hook.toFixed(0)}%, abaixo do piso de ${HOOK_RATE_CRITICO}%`,
    acao_tipo: jaTemAcao ? ad.acao_tipo : 'VERIFICAR_MANUAL',
    confianca_item: jaTemAcao ? ad.confianca_item : 'media',
    padrao: jaTemAcao ? ad.padrao : 'criativo_hook_baixo',
    motivos: [hookMotivo, ...ad.motivos.filter((m) => !/retenç|hook/i.test(m))].slice(0, 4),
  };
}

// Trava determinística: a regra de custo é sempre "quanto menor, melhor" — CPL real dentro da
// meta máxima NUNCA pode virar "crítico" só por causa do custo. A IA às vezes confunde baixo
// volume de conversões com resultado ruim e classifica URGENTE mesmo com CPL bom; isto rebaixa
// pra ATENCAO quando há gasto/conversões suficientes pra confiar no número (mesmo piso usado em
// buildCampaignTree: cplRef * 2, ou 25 sem meta). Só ATENUA por causa de custo bom — não elimina
// a classificação: outros problemas reais (hook rate ruim etc.) continuam valendo via seus
// próprios pisos, aplicados depois desta função (ver aplicarPisoHookRate).
function limitarSeveridadePorCplBom(
  classificacao: OptimizerVerdict,
  cpl: number | null,
  conversoes: number,
  gasto: number,
  cplIdeal: number | null,
  cplMaximo: number | null,
): OptimizerVerdict {
  if (classificacao !== 'URGENTE') return classificacao;
  if (cpl == null || conversoes <= 0) return classificacao;
  const cplRef = cplMaximo ?? cplIdeal;
  if (!cplRef || cplRef <= 0) return classificacao;
  if (gasto < cplRef * 2) return classificacao;
  return cpl <= cplRef ? 'ATENCAO' : classificacao;
}

// Objeto PAUSADO não está em entrega ativa — não drena verba agora, logo não é urgência nem
// coloca a conta em crise. Arquivar/revisar um criativo pausado (ex: sazonal vencido) é
// housekeeping, não decisão urgente. Rebaixa a severidade pra SAUDAVEL pra não pintar o grupo de
// "Crítico" nem arrastar a saúde da conta (feedback Cão Véio: conta de tráfego excelente marcada
// como crítica por 5 criativos pausados). Ações de crescimento (reativar) sobrevivem — a trava da
// fila deixa passar item SAUDÁVEL que carrega ATIVAR/AJUSTAR_ORCAMENTO.
const STATUS_ENTREGA_ATIVO = ['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'];
function estaPausado(status: string | null | undefined): boolean {
  const s = String(status ?? '').toUpperCase();
  return s !== '' && !STATUS_ENTREGA_ATIVO.includes(s);
}
function capSeveridadePausado(classificacao: OptimizerVerdict, status: string | null | undefined): OptimizerVerdict {
  return estaPausado(status) ? 'SAUDAVEL' : classificacao;
}

// Monta a árvore campanha→conjunto→anúncio: métricas do PAYLOAD (verdade), veredito da IA.
function buildAnaliseCampanhas(payload: OptimizerPayloadV2, iaCampanhas: unknown): OptimizerAnaliseCampanha[] {
  const verdicts = collectIaVerdicts(iaCampanhas);
  const fallback: IaVerdict = {
    classificacao: 'ATENCAO', veredito: '', acao: '',
    acao_tipo: 'NENHUMA', acao_parametros: {}, confianca_item: 'media', depende_de: null, padrao: null, motivos: [],
  };
  const vOf = (id: string) => verdicts.get(id) ?? fallback;
  const cplMaximo = payload.metas?.cpl_maximo ?? null;
  const cplIdeal = payload.metas?.cpl_ideal ?? null;
  // CPC do nó: usa o do payload se veio (weekly já injeta p/ tráfego); senão calcula gasto/cliques.
  // Garante que "Custo por clique" apareça mesmo se o payload não passou por comMetricaDeClique.
  const cpcDe = (cpc: number | null | undefined, gasto: number, cliques: number | undefined) =>
    cpc != null ? cpc : (cliques && cliques > 0 ? (Number(gasto) || 0) / cliques : null);
  return (payload.campanhas ?? []).map((camp) => {
    const cv = vOf(camp.id);
    const campClassificacao = capSeveridadePausado(limitarSeveridadePorCplBom(cv.classificacao, camp.cpl, Number(camp.conversoes) || 0, Number(camp.gasto) || 0, cplIdeal, cplMaximo), camp.status);
    return {
      id: camp.id,
      nome: camp.nome,
      status_entrega: camp.status ?? null,
      objetivo: objetivoEfetivoCampanha(camp),
      gasto: Number(camp.gasto) || 0,
      conversoes: Number(camp.conversoes) || 0,
      cpl: camp.cpl,
      cliques: Number(camp.cliques) || 0,
      cpc: cpcDe(camp.cpc, camp.gasto, camp.cliques),
      ctr: Number(camp.ctr) || 0,
      orcamento_diario: camp.orcamento_diario,
      classificacao: campClassificacao,
      veredito: cv.veredito,
      acao: cv.acao,
      acao_tipo: cv.acao_tipo,
      acao_parametros: cv.acao_parametros,
      confianca_item: cv.confianca_item,
      depende_de: cv.depende_de,
      padrao: cv.padrao,
      motivos: cv.motivos,
      conjuntos: (camp.conjuntos ?? []).map((cj) => {
        const jv = vOf(cj.id);
        const cjClassificacao = capSeveridadePausado(limitarSeveridadePorCplBom(jv.classificacao, cj.cpl, Number(cj.conversoes) || 0, Number(cj.gasto) || 0, cplIdeal, cplMaximo), cj.status);
        return {
          id: cj.id,
          nome: cj.nome,
          status_entrega: cj.status ?? null,
          gasto: Number(cj.gasto) || 0,
          conversoes: Number(cj.conversoes) || 0,
          cpl: cj.cpl,
          cliques: Number(cj.cliques) || 0,
          cpc: cpcDe(cj.cpc, cj.gasto, cj.cliques),
          ctr: Number(cj.ctr) || 0,
          orcamento_diario: cj.orcamento_diario,
          dias_ativo: cj.dias_ativo,
          classificacao: cjClassificacao,
          veredito: jv.veredito,
          acao: jv.acao,
          acao_tipo: jv.acao_tipo,
          acao_parametros: jv.acao_parametros,
          confianca_item: jv.confianca_item,
          depende_de: jv.depende_de,
          padrao: jv.padrao,
          motivos: jv.motivos,
          anuncios: (cj.anuncios ?? []).map((ad) => {
            const av = vOf(ad.id);
            const adClassificacao = capSeveridadePausado(limitarSeveridadePorCplBom(av.classificacao, ad.cpl, Number(ad.conversoes) || 0, Number(ad.gasto) || 0, cplIdeal, cplMaximo), ad.status);
            return aplicarPisoHookRate({
              id: ad.id,
              nome: ad.nome,
              status_entrega: ad.status ?? null,
              gasto: Number(ad.gasto) || 0,
              conversoes: Number(ad.conversoes) || 0,
              cpl: ad.cpl,
              cliques: Number(ad.cliques) || 0,
              cpc: cpcDe(ad.cpc, ad.gasto, ad.cliques),
              ctr: Number(ad.ctr) || 0,
              quality_ranking: ad.quality_ranking,
              engagement_ranking: ad.engagement_ranking,
              conversion_ranking: ad.conversion_ranking,
              eh_video: ad.eh_video,
              video_hook_rate: ad.video_hook_rate,
              video_p25_rate: ad.video_p25_rate,
              video_p50_rate: ad.video_p50_rate,
              video_p75_rate: ad.video_p75_rate,
              imagem_url: ad.imagem_url,
              classificacao: adClassificacao,
              veredito: av.veredito,
              acao: av.acao,
              acao_tipo: av.acao_tipo,
              acao_parametros: av.acao_parametros,
              confianca_item: av.confianca_item,
              depende_de: av.depende_de,
              padrao: av.padrao,
              motivos: av.motivos,
            }, cplMaximo);
          }),
        };
      }),
    };
  });
}

export function sanitizeOptimizerOutputV2(input: unknown, payload: OptimizerPayloadV2): OptimizerOutputV2 {
  const obj = (input && typeof input === 'object') ? input as Record<string, unknown> : {};

  const estadoIa = (['SAUDAVEL', 'ATENCAO', 'CRISE'] as const).includes(obj.estado_da_conta as OptimizerEstadoConta)
    ? obj.estado_da_conta as OptimizerEstadoConta
    : 'ATENCAO';

  const confianca = (['alta', 'media', 'baixa'] as const).includes(obj.confianca as OptimizerConfidence)
    ? obj.confianca as OptimizerConfidence
    : 'baixa';

  const cruzamento = (obj.cruzamento_com_metas && typeof obj.cruzamento_com_metas === 'object')
    ? obj.cruzamento_com_metas as Record<string, unknown>
    : {};

  const acoesAutomaticas: OptimizerAcaoAutomatica[] = Array.isArray(obj.acoes_automaticas)
    ? (obj.acoes_automaticas as Record<string, unknown>[]).slice(0, 5).map((a) => ({
        acao: (['PAUSAR', 'ATIVAR', 'AJUSTAR_ORCAMENTO'] as const).includes(a.acao as never)
          ? a.acao as OptimizerAcaoTipo
          : 'PAUSAR',
        objeto_tipo: (['campaign', 'adset', 'ad'] as const).includes(a.objeto_tipo as never)
          ? a.objeto_tipo as OptimizerObjetoTipo
          : 'adset',
        objeto_id: String(a.objeto_id ?? ''),
        objeto_nome: String(a.objeto_nome ?? ''),
        parametros: (a.parametros && typeof a.parametros === 'object') ? a.parametros as Record<string, unknown> : {},
        justificativa: String(a.justificativa ?? ''),
        status_execucao: (['EXECUTAR_AGORA', 'AGUARDAR_APROVACAO'] as const).includes(a.status_execucao as never)
          ? a.status_execucao as OptimizerStatusExecucao
          : 'AGUARDAR_APROVACAO',
      })).filter((a) => {
        // Segurança extra: remove EXECUTAR_AGORA se modo não permite
        const modo = payload.modo_operacao;
        if (a.status_execucao === 'EXECUTAR_AGORA' && (modo === 'DIAGNOSTICO_APENAS' || modo === 'RECOMENDACAO_COM_APROVACAO')) {
          return true; // mantém mas vai ser rebaixado abaixo
        }
        return true;
      }).map((a) => {
        const modo = payload.modo_operacao;
        if (a.status_execucao === 'EXECUTAR_AGORA' && (modo === 'DIAGNOSTICO_APENAS' || modo === 'RECOMENDACAO_COM_APROVACAO')) {
          return { ...a, status_execucao: 'AGUARDAR_APROVACAO' as const };
        }
        if (a.status_execucao === 'EXECUTAR_AGORA' && modo === 'AUTOMATICO_PARCIAL') {
          if (!payload.acoes_pre_aprovadas.includes(a.acao.toLowerCase().replace('ajustar_orcamento', 'ajustar_orcamento_reduzir'))) {
            return { ...a, status_execucao: 'AGUARDAR_APROVACAO' as const };
          }
        }
        return a;
      })
    : [];

  // Totais REAIS calculados a partir do payload (campanhas). Servem de fallback quando a IA
  // omite/trunca os números — sem isto, uma resposta da IA cortada zera o gasto/CPL na tela
  // mesmo com dados reais no payload (causa raiz do "R$ 0,00").
  const campanhas = payload.campanhas ?? [];
  const gastoReal = campanhas.reduce((s, c) => s + (Number(c.gasto) || 0), 0);
  // A régua de CPL/volume da conta soma SÓ campanhas cujo resultado é lead/conversa (regra do
  // prompt) — tráfego mede-se por clique e NÃO entra aqui, senão o volume de cliques domina a soma
  // e mascara o CPL real das campanhas de conversão. Numa conta 100% tráfego a régua de CPL não se
  // aplica: mostramos o resultado real do tráfego (cliques + CPC) no lugar de "0 / R$0,00" (ou do
  // R$351 sem sentido que saía de gasto ÷ conversas incidentais — bug Cão Véio).
  const convCampanhas = campanhas.filter((c) => !objetivoMedidoPorClique(c.objetivo));
  const convGasto = convCampanhas.reduce((s, c) => s + (Number(c.gasto) || 0), 0);
  const convReal = convCampanhas.reduce((s, c) => s + (Number(c.conversoes) || 0), 0);
  const cplReal = convGasto > 0 && convReal > 0 ? convGasto / convReal : null;
  const soTrafego = convCampanhas.length === 0 && campanhas.length > 0;
  const cliquesReal = campanhas.reduce((s, c) => s + (Number(c.cliques) || 0), 0);
  const cpcReal = gastoReal > 0 && cliquesReal > 0 ? gastoReal / cliquesReal : null;
  const metas = payload.metas;

  // status_cpl é SEMPRE calculado aqui, nunca ecoado da IA — regra fixa "quanto menor o custo,
  // melhor": cpl_atual dentro do cpl_ideal é DENTRO, acima do ideal mas até o máximo é ATENCAO,
  // acima do máximo é CRITICO. Antes confiava em `cruzamento.status_cpl` (texto livre da IA), que
  // podia dizer "CRITICO" com um cpl_atual/cpl_maximo do lado mostrando exatamente o contrário.
  // Conta só-tráfego: o "custo por resultado" exibido é o CPC (gasto/cliques), não um CPL.
  const cplAtualFinal = soTrafego
    ? cpcReal
    : (cplReal != null ? cplReal : (cruzamento.cpl_atual != null ? Number(cruzamento.cpl_atual) : null));
  const cplIdealFinal = cruzamento.cpl_ideal != null ? Number(cruzamento.cpl_ideal) : (metas?.cpl_ideal ?? null);
  const cplMaximoFinal = cruzamento.cpl_maximo != null ? Number(cruzamento.cpl_maximo) : (metas?.cpl_maximo ?? null);
  const cplTetoFinal = cplMaximoFinal ?? cplIdealFinal;
  // Tráfego não se compara à meta de CPL (lead) — o CPC tem outra ordem de grandeza. Marca
  // NAO_APLICAVEL pra não pintar a régua de verde/vermelho comparando coisas diferentes.
  const statusCplFinal: 'DENTRO' | 'ATENCAO' | 'CRITICO' | 'NAO_APLICAVEL' =
    soTrafego || cplAtualFinal == null || cplTetoFinal == null || cplTetoFinal <= 0
      ? 'NAO_APLICAVEL'
      : cplAtualFinal <= (cplIdealFinal ?? cplTetoFinal)
        ? 'DENTRO'
        : cplAtualFinal <= cplTetoFinal
          ? 'ATENCAO'
          : 'CRITICO';

  const statusVolumeFinal = (['NO_RITMO', 'ABAIXO', 'CRITICO', 'NAO_APLICAVEL'] as const).includes(cruzamento.status_volume as never)
    ? cruzamento.status_volume as 'NO_RITMO' | 'ABAIXO' | 'CRITICO' | 'NAO_APLICAVEL'
    : 'NAO_APLICAVEL';

  // Estado da conta é DETERMINÍSTICO (não ecoado da IA, que exagerava — ver feedback Cão Véio:
  // conta de tráfego com CPC −93% abaixo da meta marcada como "crítica" por causa de criativos
  // pausados). Deriva da pior severidade da árvore (pausados já rebaixados a SAUDAVEL em
  // capSeveridadePausado) cruzada com as réguas de custo/volume da conta. Assim o estado bate com
  // o que a árvore mostra: se nada que entrega está em atenção/urgência e as réguas não acusam
  // problema, a conta está SAUDÁVEL.
  const analiseCampanhas = buildAnaliseCampanhas(payload, obj.analise_campanhas);
  const rankSev = (c: OptimizerVerdict) => (c === 'URGENTE' ? 0 : c === 'ATENCAO' ? 1 : 2);
  let piorNaArvore: OptimizerVerdict = 'SAUDAVEL';
  for (const camp of analiseCampanhas) {
    const nós: OptimizerVerdict[] = [camp.classificacao];
    for (const cj of camp.conjuntos ?? []) {
      nós.push(cj.classificacao);
      for (const ad of cj.anuncios ?? []) nós.push(ad.classificacao);
    }
    for (const c of nós) if (rankSev(c) < rankSev(piorNaArvore)) piorNaArvore = c;
  }
  const estado: OptimizerEstadoConta =
    (piorNaArvore === 'URGENTE' || statusCplFinal === 'CRITICO' || statusVolumeFinal === 'CRITICO')
      ? 'CRISE'
      : (piorNaArvore === 'ATENCAO' || statusCplFinal === 'ATENCAO' || statusVolumeFinal === 'ABAIXO')
        ? 'ATENCAO'
        : 'SAUDAVEL';
  void estadoIa; // estado agora é derivado dos sinais; a leitura da IA fica só no resumo_executivo

  const resumoFallback = estado === 'CRISE'
    ? 'Conta em estado crítico — verifique os dados imediatamente e tome ação.'
    : estado === 'ATENCAO'
      ? 'Conta requer atenção. Revise as campanhas ativas e os dados do período para identificar o problema.'
      : 'Conta saudável. Acompanhe as métricas e mantenha o ritmo atual.';

  return {
    estado_da_conta: estado,
    resumo_executivo: (obj.resumo_executivo && String(obj.resumo_executivo).trim()) ? String(obj.resumo_executivo) : resumoFallback,
    analise_campanhas: analiseCampanhas,
    cruzamento_com_metas: {
      // Gasto, conversões e CPL são FATOS já presentes no payload (soma das campanhas).
      // Priorizamos SEMPRE o valor real calculado — a IA recebe um template com "0" nesses
      // campos e frequentemente ecoa 0 (não null), então confiar nela zera a tela mesmo com
      // dados reais. A IA só entra se o payload não trouxe nenhuma campanha com entrega.
      cpl_atual: cplAtualFinal,
      cpl_ideal: cplIdealFinal,
      cpl_maximo: cplMaximoFinal,
      status_cpl: statusCplFinal,
      volume_conversoes_atual: soTrafego
        ? cliquesReal
        : (convReal > 0 ? convReal : (cruzamento.volume_conversoes_atual != null ? Number(cruzamento.volume_conversoes_atual) : 0)),
      volume_meta_projetada: cruzamento.volume_meta_projetada != null ? Number(cruzamento.volume_meta_projetada) : (metas?.volume_leads_meta_mensal ?? null),
      status_volume: statusVolumeFinal,
      gasto_total: gastoReal > 0 ? gastoReal : (cruzamento.gasto_total != null ? Number(cruzamento.gasto_total) : 0),
      orcamento_periodo: cruzamento.orcamento_periodo != null ? Number(cruzamento.orcamento_periodo) : (metas?.orcamento_mensal_total ?? null),
      status_orcamento: (['OK', 'ESTOURANDO', 'SUBENTREGANDO'] as const).includes(cruzamento.status_orcamento as never)
        ? cruzamento.status_orcamento as 'OK' | 'ESTOURANDO' | 'SUBENTREGANDO'
        : 'OK',
    },
    acoes_automaticas: acoesAutomaticas,
    confianca,
    observacao: obj.observacao != null ? String(obj.observacao) : null,
  };
}

export type OptimizerCriticalLevel = 'vermelho' | 'amarelo' | 'verde';
export type OptimizerConfidence = 'alta' | 'media' | 'baixa';
export type OptimizerPlatform = 'meta_ads' | 'google_ads';
export type OptimizerRequestKind = 'analise_completa' | 'sugestao_criativo' | 'diagnostico_rapido';
export type OptimizerPeriodKey = 'yesterday' | 'last_3d' | 'last_7d' | 'this_month' | 'last_month' | 'last_21d' | 'last_30d' | 'last_90d';
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

// "days" em this_month/last_month é uma aproximação (30) só para os usos legados que tratam
// período como janela fixa (limite de fallback, rótulo de duração) — a data real (calendário)
// vem de optimizerDateRangeForPeriod em optimizer-period-range.ts, não deste número.
export const OPTIMIZER_PERIODS: Array<{ key: OptimizerPeriodKey; label: string; days: number }> = [
  { key: 'yesterday', label: 'Ontem', days: 1 },
  { key: 'last_3d', label: 'Últimos 3 dias', days: 3 },
  { key: 'last_7d', label: 'Últimos 7 dias', days: 7 },
  { key: 'this_month', label: 'Este mês', days: 30 },
  { key: 'last_month', label: 'Mês passado', days: 30 },
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
