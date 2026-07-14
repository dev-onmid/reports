// ---------------------------------------------------------------------------
// Otimizador — camada de UI compartilhada
// ---------------------------------------------------------------------------
// Tipos, constantes e helpers PUROS usados pela tela do Otimizador e por todos
// os seus componentes (rail de contas, hero de saúde, boards por objetivo,
// painel de decisão, modal de config). Nada aqui renderiza JSX — só dados e
// funções puras — pra poder ser importado por qualquer componente sem acoplar
// a árvore de UI. A lógica de negócio (buildCampaignTree / buildRecomendacoes /
// objetivoInfo) continua em `optimizer.ts` no servidor; aqui é só apresentação.

import { Eye, MinusCircle, PauseCircle, Rocket, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type {
  OptimizerModo,
  OptimizerRecomendacao,
  OptimizerTreeNode,
} from '@/lib/optimizer';

// ─── Paleta dark premium ─────────────────────────────────────────────────────
// O redesign do Otimizador commita num visual escuro único (aprovado): superfícies em camadas,
// bordas suaves, acento verde ONMID. Hex fixo de propósito (não segue o toggle de tema) — um só
// lugar pra hero/boards/árvore/painel compartilharem e não divergir.
export const PREMIUM = {
  bg: '#0a0a0b',
  surf: '#141416',
  surf2: '#0f0f11',
  surfHover: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.08)',
  borderSoft: 'rgba(255,255,255,0.05)',
  txt: '#fafafa',
  txt2: '#a1a1aa',
  txt3: '#71717a',
  green: '#55f52f',
  emerald: '#34d399',
  amber: '#fbbf24',
  red: '#f87171',
  blue: '#7dd3fc',
  purple: '#b794ff',
} as const;

// Cor por severidade na paleta premium.
export const SEV_HEX: Record<'urgente' | 'atencao' | 'ok', string> = {
  urgente: PREMIUM.red,
  atencao: PREMIUM.amber,
  ok: PREMIUM.emerald,
};

// ─── Tipos de tela ─────────────────────────────────────────────────────────

// Recomendação da fila (server já achatou via buildRecomendacoes) + status do workflow.
export type FilaRec = OptimizerRecomendacao & { status: string; atribuido_a: string | null };

// Nó da árvore (server já monta hierarquia completa via buildCampaignTree) + status do workflow.
export type TreeNode = OptimizerTreeNode & { status: string; atribuido_a: string | null };

// Resumo por conta para o seletor.
export type FilaConta = {
  cliente_id: string;
  cliente_nome: string;
  pior_severidade: Severidade;
  pendencias: number;
};

export type AccountOption = FilaConta & {
  tem_analise: boolean;
};

export type ArvoreResumo = {
  estado_da_conta: string | null;
  resumo_executivo: string | null;
  semana_analise: string | null;
  modo_operacao: string | null;
  cruzamento_com_metas: {
    cpl_atual: number | null;
    gasto_total: number;
    volume_conversoes_atual: number;
    orcamento_periodo: number | null;
    status_orcamento: string;
  };
  campanhas: number;
  conjuntos: number;
  criativos: number;
  diagnosticos: number;
};

export type ClientDiagnostic = {
  cliente: string;
  conexao_resolvida: boolean;
  connection_id?: string;
  account_id?: string;
  token_ok?: boolean;
  campanhas_7d?: number;
  campanhas_30d?: number;
  amostra?: Array<{ nome: string; status: string; gasto: number; leads: number; plataforma: string }>;
  meta_direto?: { ok: boolean; status?: number; erro?: string; total?: number; com_gasto?: number; campanhas?: Array<{ nome: string; status: string; gasto: number }> };
  planejamento: { cpl_meta: number | null; volume_leads_meta: number | null; objetivo: string | null; tem_planejamento: boolean };
  veredito: string;
};

export type ClientConfig = {
  cliente_id: string;
  modo_operacao: OptimizerModo;
  analise_dia_semana: number;
  acoes_pre_aprovadas: string[];
  min_dias_aprendizado: number;
  // Mesmo nome da coluna no banco e do campo lido/gravado pela rota config/[clientId]
  // (antes era orcamento_diario_maximo_conta na UI, que nunca casava → orçamento não salvava).
  orcamento_diario_maximo: number | null;
  observacoes_fixas: string | null;
};

export type ToastState = { text: string; erro?: boolean; undo?: { rec_id: string; cliente_id: string } } | null;

export type NivelFiltro = 'todos' | 'campaign' | 'adset' | 'ad';

// ─── Constantes de config ────────────────────────────────────────────────────

export const DOW_LABELS: Record<number, string> = { 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira' };

export const MODO_LABELS: Record<OptimizerModo, string> = {
  DIAGNOSTICO_APENAS: 'Diagnóstico apenas',
  RECOMENDACAO_COM_APROVACAO: 'Recomendação com aprovação',
  AUTOMATICO_PARCIAL: 'Automático parcial',
  AUTOMATICO_TOTAL: 'Automático total',
};

export const MODO_DESC: Record<OptimizerModo, string> = {
  DIAGNOSTICO_APENAS: 'Só analisa e reporta. Nenhuma ação é executada.',
  RECOMENDACAO_COM_APROVACAO: 'Sugere ações que você aprova individualmente.',
  AUTOMATICO_PARCIAL: 'Executa apenas as ações pré-aprovadas automaticamente.',
  AUTOMATICO_TOTAL: 'Executa todas as ações recomendadas automaticamente.',
};

// Vocabulário canônico das ações pré-aprovadas. Tem que bater EXATAMENTE com o que a checagem
// de auto-execução espera em sanitizeOptimizerOutputV2 (optimizer.ts): ela faz
// `a.acao.toLowerCase().replace('ajustar_orcamento','ajustar_orcamento_reduzir')`, ou seja,
// procura por 'pausar', 'ativar' ou 'ajustar_orcamento_reduzir' na lista. Qualquer outro valor
// (ex: 'PAUSAR' ou 'pausar_conjunto') nunca casa → a ação nunca executa sozinha. "Ajustar
// orçamento" cobre subir E reduzir (o replace mapeia todo AJUSTAR_ORCAMENTO pra '..._reduzir').
export const ACOES_PRE_APROVADAS_OPCOES = [
  { value: 'pausar', label: 'Pausar conjuntos/anúncios' },
  { value: 'ativar', label: 'Ativar conjuntos/anúncios' },
  { value: 'ajustar_orcamento_reduzir', label: 'Ajustar orçamento' },
];

// ─── Severidade / categorias / níveis ────────────────────────────────────────

// Severidade — cor reservada SÓ para gravidade (nunca no texto da recomendação).
export type Severidade = 'urgente' | 'atencao' | 'ok';
export const SEV: Record<Severidade, { badge: string; dot: string; label: string }> = {
  urgente: { badge: 'border-red-400/40 bg-red-400/10 text-red-300', dot: 'bg-red-400', label: 'Urgente' },
  atencao: { badge: 'border-amber-400/40 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400', label: 'Atenção' },
  ok: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Oportunidade' },
};
export const NIVEL_LABEL: Record<string, string> = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Criativo' };

// 5 categorias de decisão rápida — computadas a partir de acao_tipo + severidade de cada nó.
// "Investigar" hoje só cobre VERIFICAR_MANUAL (ambiguidade/aprendizado) — funil/técnico real
// (WhatsApp, pixel, LP) ainda não é um sinal que a IA recebe, ver CLAUDE.md.
export type Categoria = 'pausar' | 'revisar' | 'manter' | 'escalar' | 'investigar' | 'sem_diagnostico';

// Nós ATENCAO/URGENTE sem texto_recomendacao são "buraco de dado" (fallback quando a resposta
// da IA não cobriu aquele objeto — ex: truncamento por limite de tokens em contas grandes),
// NÃO uma recomendação real de revisar. Contá-los como "Revisar" infla o card com nós que não
// têm diagnóstico nenhum.
export function categoriaDoNode(n: { severidade: Severidade; acao_estruturada: { tipo: string } | null; texto_recomendacao: string }): Categoria {
  const tipo = n.acao_estruturada?.tipo;
  const temDiagnostico = n.texto_recomendacao.trim().length > 0;
  if (n.severidade !== 'ok' && !temDiagnostico) return 'sem_diagnostico';
  if (tipo === 'PAUSAR') return 'pausar';
  if (n.severidade === 'ok' && (tipo === 'AJUSTAR_ORCAMENTO' || tipo === 'ATIVAR')) return 'escalar';
  if (n.severidade === 'ok') return 'manter';
  if (/aguardar mais dados|verificar/i.test(n.texto_recomendacao)) return 'investigar';
  return 'revisar';
}

// Só as 5 categorias acionáveis viram card/filtro clicável — "sem_diagnostico" aparece na árvore
// com um rótulo neutro, mas nunca conta nos cards nem é alvo de filtro.
// Paleta por categoria: vermelho=pausar, amarelo=revisar, verde=manter, AZUL=escalar (não verde —
// verde é reservado a "manter/positivo"), roxo=investigar.
export const CATEGORIA_META: Record<Exclude<Categoria, 'sem_diagnostico'>, { label: string; icon: LucideIcon; tone: string }> = {
  pausar: { label: 'Pausar agora', icon: PauseCircle, tone: 'border-red-400/40 bg-red-400/5 text-red-300' },
  revisar: { label: 'Revisar', icon: Search, tone: 'border-amber-400/40 bg-amber-400/5 text-amber-300' },
  manter: { label: 'Manter', icon: MinusCircle, tone: 'border-emerald-400/40 bg-emerald-400/5 text-emerald-300' },
  escalar: { label: 'Escalar', icon: Rocket, tone: 'border-sky-400/40 bg-sky-400/5 text-sky-300' },
  investigar: { label: 'Investigar', icon: Eye, tone: 'border-secondary/40 bg-secondary/5 text-secondary' },
};
export const SEM_DIAGNOSTICO_META = { label: 'Sem diagnóstico', icon: MinusCircle, tone: 'border-border text-muted-foreground' };
export function categoriaMeta(cat: Categoria) {
  return cat === 'sem_diagnostico' ? SEM_DIAGNOSTICO_META : CATEGORIA_META[cat];
}

// Badge do NÍVEL na árvore/painel (Campanha/Conjunto/Criativo). Roxo editorial p/ o nível,
// distinto das cores de severidade/ação, pra o gestor bater o olho e saber a hierarquia.
export const NIVEL_BADGE: Record<string, string> = {
  campaign: 'border-secondary/40 bg-secondary/10 text-secondary',
  adset: 'border-sky-400/30 bg-sky-400/10 text-sky-300',
  ad: 'border-border bg-background text-muted-foreground',
};

// ─── Campos derivados da recomendação (painel "decisão guiada") ──────────────
// A IA ainda não devolve priority/impact/risk/doNotDo estruturados. Derivamos de forma
// determinística do que já existe (severidade, ação, confiança, filhos) — quando o backend
// passar a mandar esses campos, é só trocar estas funções pela leitura direta.
export function prioridadeDoNode(n: { severidade: Severidade }): { label: string; tone: string } {
  if (n.severidade === 'urgente') return { label: 'Alta', tone: 'text-red-300' };
  if (n.severidade === 'atencao') return { label: 'Média', tone: 'text-amber-300' };
  return { label: 'Baixa', tone: 'text-emerald-300' };
}

export function impactoDoNode(n: { acao_estruturada: { tipo: string } | null; texto_recomendacao: string }): string {
  const t = n.acao_estruturada?.tipo;
  if (t === 'PAUSAR') return 'Reduzir desperdício';
  if (t === 'AJUSTAR_ORCAMENTO') return 'Aumentar resultado';
  if (t === 'ATIVAR') return 'Recuperar resultado';
  if (/criativo|apelo|angulo|ângulo/i.test(n.texto_recomendacao)) return 'Recuperar CTR';
  return 'Melhorar eficiência';
}

export function riscoDoNode(n: OptimizerRecomendacao): { label: string; tone: string } {
  // Confiança baixa ou dado insuficiente → risco alto de agir errado.
  if (n.confianca === 'baixa' || !n.aplicavel) return { label: 'Alto', tone: 'text-red-300' };
  // Pausar algo que gastou sem entregar = risco baixo (não há resultado a perder).
  const conv = Number(n.metricas_chave.find((m) => /convers|lead/i.test(m.rotulo))?.valor?.replace(/\D/g, '') ?? '0');
  if (n.acao_estruturada?.tipo === 'PAUSAR' && conv === 0) return { label: 'Baixo', tone: 'text-emerald-300' };
  if (n.acao_estruturada?.tipo === 'AJUSTAR_ORCAMENTO') return { label: 'Médio', tone: 'text-amber-300' };
  return { label: 'Médio', tone: 'text-amber-300' };
}

// Descendentes `ad` que devem ser pausados (gasto sem resultado) — alimenta "itens afetados"
// e o título "Pausar N criativos fracos dentro deste conjunto".
export function criativosAfetados(node: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.nivel === 'ad' && categoriaDoNode(n) === 'pausar') out.push(n);
      walk(n.filhos as TreeNode[]);
    }
  };
  walk(node.filhos as TreeNode[]);
  return out;
}

// Extrai um valor de fato/métrica por rótulo (Gasto, CTR etc.) — helper de exibição.
export function fatoValor(n: OptimizerTreeNode, rotuloRegex: RegExp): string {
  return n.fatos.find((f) => rotuloRegex.test(f.rotulo))?.valor
    ?? n.metricas_chave.find((m) => rotuloRegex.test(m.rotulo))?.valor
    ?? '—';
}

// Link direto para o objeto no Gerenciador de Anúncios nativo.
export function adManagerUrl(rec: { canal: string; account_id: string | null; nivel: string; objeto_id: string }): string | null {
  if (rec.canal === 'google') return 'https://ads.google.com/aw/campaigns';
  if (!rec.account_id) return null;
  const act = String(rec.account_id).replace(/^act_/, '');
  const sel = rec.nivel === 'campaign' ? `&selected_campaign_ids=${rec.objeto_id}`
    : rec.nivel === 'adset' ? `&selected_adset_ids=${rec.objeto_id}`
    : rec.nivel === 'ad' ? `&selected_ad_ids=${rec.objeto_id}` : '';
  return `https://business.facebook.com/adsmanager/manage/campaigns?act=${act}${sel}`;
}

export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Achata a árvore em lista plana (com nível) — usado pelos cards de decisão rápida e filtros.
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) { out.push(n); out.push(...flattenTree(n.filhos as TreeNode[])); }
  return out;
}

// ─── Resumo da conta / score ─────────────────────────────────────────────────

export const ESTADO_LABEL: Record<string, { label: string; tone: string; ring: string }> = {
  SAUDAVEL: { label: 'Saudável', tone: 'text-emerald-300', ring: '#34d399' },
  ATENCAO: { label: 'Atenção crítica', tone: 'text-amber-300', ring: '#fbbf24' },
  CRISE: { label: 'Crise', tone: 'text-red-300', ring: '#f87171' },
};

// Score 0-100 do gauge — a API NÃO devolve um número (só estado_da_conta: SAUDAVEL/ATENCAO/
// CRISE). Isto é uma HEURÍSTICA client-side, transparente: parte de uma base por estado e
// ajusta pela proporção de itens "pausar" (penaliza) vs "escalar" (bonifica) na árvore. Se no
// futuro a IA passar a devolver um score próprio, trocar esta função pelo valor real do backend.
export function computeAccountScore(estadoDaConta: string | null, nodes: TreeNode[]): number {
  const base = estadoDaConta === 'SAUDAVEL' ? 80 : estadoDaConta === 'ATENCAO' ? 55 : estadoDaConta === 'CRISE' ? 25 : 50;
  const total = nodes.length || 1;
  const pausar = nodes.filter((n) => categoriaDoNode(n) === 'pausar').length;
  const escalar = nodes.filter((n) => categoriaDoNode(n) === 'escalar').length;
  const penalidade = Math.round((pausar / total) * 30);
  const bonus = Math.round((escalar / total) * 10);
  return Math.max(0, Math.min(100, base - penalidade + bonus));
}

// ─── Árvore: severidade, entrega, retenção ───────────────────────────────────

export function nodeToneClass(n: TreeNode): string {
  if (n.status === 'ignorado' || n.status === 'aplicado') return 'opacity-40';
  return '';
}

// Status por severidade — distinto da coluna "Ação recomendada" (categoria/verbo). Aqui é só
// a leitura de saúde do nó (bom/atenção/crítico), igual em qualquer nível da árvore.
export const STATUS_SEVERIDADE: Record<Severidade, { label: string; tone: string }> = {
  urgente: { label: 'Crítica', tone: 'border-red-400/40 bg-red-400/10 text-red-300' },
  atencao: { label: 'Atenção', tone: 'border-amber-400/40 bg-amber-400/10 text-amber-300' },
  ok: { label: 'Bom', tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' },
};

export function deliveryDisplay(raw: string | null | undefined): { label: string; tone: string } {
  const status = String(raw ?? '').trim().toUpperCase();
  if (['ACTIVE', 'ENABLED', 'IN_PROCESS', 'WITH_ISSUES'].includes(status)) {
    return { label: 'Ativo', tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300' };
  }
  if (['PAUSED', 'DISABLED'].includes(status)) {
    return { label: 'Pausado', tone: 'border-amber-400/40 bg-amber-400/10 text-amber-300' };
  }
  if (['ARCHIVED', 'DELETED', 'REMOVED'].includes(status)) {
    return { label: 'Arquivado', tone: 'border-border bg-background text-muted-foreground' };
  }
  if (!status) return { label: 'Não informado', tone: 'border-border bg-background text-muted-foreground' };
  return { label: status.replaceAll('_', ' '), tone: 'border-sky-400/30 bg-sky-400/10 text-sky-300' };
}

// Status de exibição: criativo marcado pra pausar sem conversão vira "Gasto sem resultado"
// (linguagem da referência), o resto usa a leitura de severidade padrão.
export function statusDisplay(node: TreeNode): { label: string; tone: string } {
  if (node.nivel === 'ad' && categoriaDoNode(node) === 'pausar') {
    return { label: 'Gasto sem resultado', tone: 'border-red-400/40 bg-red-400/10 text-red-300' };
  }
  return STATUS_SEVERIDADE[node.severidade];
}

export function ctrDoNode(n: TreeNode): string {
  return n.fatos.find((f) => f.rotulo === 'CTR')?.valor ?? '—';
}

// Limiares de hook rate (retenção nos 3s) — mesma régua do backend (HOOK_RATE_CRITICO em
// optimizer.ts): abaixo de 25% o problema é a peça; 45%+ é hook bom.
export const HOOK_RATE_CRITICO = 25;
export const HOOK_RATE_BOM = 45;

export function hookBarTone(hook: number): string {
  if (hook >= HOOK_RATE_BOM) return 'bg-emerald-400';
  if (hook >= HOOK_RATE_CRITICO) return 'bg-amber-400';
  return 'bg-red-400';
}

// Retenção de vídeo só existe de fato no criativo (nível "ad") — conjunto/campanha agregam por
// CONTAGEM de filhos com hook baixo, nunca por média: uma média esconderia o criativo ruim
// escondido atrás de um bom, exatamente o que o gestor precisa caçar.
export function videoRetencaoResumo(node: TreeNode): { low: number; total: number } | null {
  let low = 0;
  let total = 0;
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.nivel === 'ad' && n.retencao_video?.eh_video && n.retencao_video.hook_rate != null) {
        total++;
        if (n.retencao_video.hook_rate < HOOK_RATE_CRITICO) low++;
      }
      walk(n.filhos as TreeNode[]);
    }
  };
  walk(node.filhos as TreeNode[]);
  return total > 0 ? { low, total } : null;
}

// ─── Agrupamento por objetivo ────────────────────────────────────────────────

// Todos os rec_id da árvore (recursivo) — usado por "Expandir tudo".
export function collectAllIds(nodes: TreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.filhos.length > 0) ids.push(n.rec_id);
      walk(n.filhos as TreeNode[]);
    }
  };
  walk(nodes);
  return ids;
}

// Agrupa campanhas (nível raiz) pelo objetivo (node.objetivo já vem em linguagem de negócio —
// "Geração de leads", "Conversas no WhatsApp", "Vendas", "Engajamento"...). O otimizador não pode
// ser só sobre leads: uma conta de e-commerce (vendas) ou institucional (engajamento) precisa de
// árvore, coluna e rótulo próprios. Ordena por gasto total desc — o objetivo que mais consome
// verba aparece primeiro.
export function agruparPorObjetivo(nodes: TreeNode[]): Array<{ objetivo: string; nodes: TreeNode[]; gastoTotal: number }> {
  const groups = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    const key = n.objetivo?.trim() || 'Outro objetivo';
    const list = groups.get(key);
    if (list) list.push(n); else groups.set(key, [n]);
  }
  // Valor vem formatado em pt-BR ("R$ 1.234,56") — remove separador de milhar antes de trocar
  // a vírgula decimal por ponto, senão "1.234,56" vira "1.23456" e o total sai errado.
  const gastoDoNode = (n: TreeNode) => {
    const raw = n.fatos.find((f) => f.rotulo === 'Gasto')?.valor ?? '';
    return Number(raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
  };
  return Array.from(groups.entries())
    .map(([objetivo, list]) => ({ objetivo, nodes: list, gastoTotal: list.reduce((s, n) => s + gastoDoNode(n), 0) }))
    .sort((a, b) => b.gastoTotal - a.gastoTotal);
}

// Rótulos de coluna do grupo (ex: "Conversas"/"Custo por conversa"). Faz a UNIÃO entre os nós —
// pega o primeiro custo e o primeiro resultado não-vazios de QUALQUER nó do grupo, em vez de
// depender do primeiro nó ter métrica (que quebrava o cabeçalho quando o 1º nó vinha sem dado).
export function rotulosDoGrupo(nodes: TreeNode[]): { resultado: string; custo: string } {
  let custoLabel: string | null = null;
  let resultadoLabel: string | null = null;
  for (const n of nodes) {
    const custo = n.metricas_chave.find((m) => /custo|cpl|cpa/i.test(m.rotulo));
    const resultado = n.metricas_chave.find((m) => m.rotulo !== 'Gasto' && m !== custo);
    if (!custoLabel && custo) custoLabel = custo.rotulo;
    if (!resultadoLabel && resultado) resultadoLabel = resultado.rotulo;
    if (custoLabel && resultadoLabel) break;
  }
  return { resultado: resultadoLabel ?? 'Resultado', custo: custoLabel ?? 'Custo por resultado' };
}

// Converte um valor formatado em pt-BR ("R$ 1.234,56", "56", "1.234") para número. Remove
// símbolos, tira o separador de milhar (ponto) e troca a vírgula decimal por ponto.
export function parseNumeroBR(raw: string | null | undefined): number {
  if (!raw) return 0;
  return Number(String(raw).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

// Agrega um grupo de objetivo (campanhas de nível raiz) para o modo apresentação: verba total,
// resultados totais, custo por resultado (recomputado de gasto/resultados) e a pior severidade
// de TODA a subárvore do grupo (não só das campanhas) — pra o card refletir o pior ponto real.
export function resumoDoObjetivo(nodes: TreeNode[]): {
  gasto: number;
  resultados: number;
  custo: number | null;
  rotulos: { resultado: string; custo: string };
  piorSeveridade: Severidade;
  campanhas: number;
} {
  const rotulos = rotulosDoGrupo(nodes);
  let gasto = 0;
  let resultados = 0;
  for (const n of nodes) {
    gasto += parseNumeroBR(n.metricas_chave.find((m) => m.rotulo === 'Gasto')?.valor);
    const resultado = n.metricas_chave.find((m) => m.rotulo === rotulos.resultado);
    resultados += parseNumeroBR(resultado?.valor);
  }
  const rank = (s: Severidade) => (s === 'urgente' ? 0 : s === 'atencao' ? 1 : 2);
  let pior: Severidade = 'ok';
  for (const n of flattenTree(nodes)) {
    if (rank(n.severidade) < rank(pior)) pior = n.severidade;
  }
  return {
    gasto,
    resultados,
    custo: resultados > 0 ? gasto / resultados : null,
    rotulos,
    piorSeveridade: pior,
    campanhas: nodes.length,
  };
}
