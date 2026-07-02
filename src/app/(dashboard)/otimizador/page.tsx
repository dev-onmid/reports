"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Info,
  Loader2,
  MousePointerClick,
  Play,
  RefreshCw,
  Search,
  Settings2,
  ShieldAlert,
  Target,
  ThumbsDown,
  TrendingUp,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DictateButton } from '@/components/ui/dictate-button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ClientAvatar } from '@/components/client-avatar';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { OPTIMIZER_PERIODS } from '@/lib/optimizer';
import type {
  OptimizerAnalysisResult,
  OptimizerAcaoAutomatica,
  OptimizerAnaliseAnuncio,
  OptimizerAnaliseCampanha,
  OptimizerAnaliseConjunto,
  OptimizerEstadoConta,
  OptimizerModo,
  OptimizerOutputV2,
  OptimizerPeriodKey,
} from '@/lib/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type QueueItem = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  conjunto_id: string;
  campanha_nome: string;
  conta_plataforma: string;
  periodo_label: string;
  periodo_dias: number;
  origem: OptimizerAnalysisResult['origem'];
  nivel_critico: OptimizerAnalysisResult['nivel_critico'];
  gasto_total: number;
  conversoes: number;
  cpl_cpa_atual: number | null;
  ctr_link: number | null;
  resultado: OptimizerAnalysisResult | OptimizerOutputV2;
  semana_analise: string | null;
  modo_operacao: string | null;
  estado_da_conta: string | null;
  resumo_executivo: string | null;
  created_at: string;
};

type ClientDiagnostic = {
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

type ClientConfig = {
  cliente_id: string;
  modo_operacao: OptimizerModo;
  analise_dia_semana: number;
  acoes_pre_aprovadas: string[];
  min_dias_aprendizado: number;
  orcamento_diario_maximo_conta: number | null;
  observacoes_fixas: string | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const DOW_LABELS: Record<number, string> = { 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira', 4: 'Quinta-feira', 5: 'Sexta-feira' };

const MODO_LABELS: Record<OptimizerModo, string> = {
  DIAGNOSTICO_APENAS: 'Diagnóstico apenas',
  RECOMENDACAO_COM_APROVACAO: 'Recomendação com aprovação',
  AUTOMATICO_PARCIAL: 'Automático parcial',
  AUTOMATICO_TOTAL: 'Automático total',
};

const MODO_DESC: Record<OptimizerModo, string> = {
  DIAGNOSTICO_APENAS: 'Só analisa e reporta. Nenhuma ação é executada.',
  RECOMENDACAO_COM_APROVACAO: 'Sugere ações que você aprova individualmente.',
  AUTOMATICO_PARCIAL: 'Executa apenas as ações pré-aprovadas automaticamente.',
  AUTOMATICO_TOTAL: 'Executa todas as ações recomendadas automaticamente.',
};

const ACOES_PRE_APROVADAS_OPCOES = [
  { value: 'PAUSAR', label: 'Pausar conjuntos/anúncios' },
  { value: 'ATIVAR', label: 'Ativar conjuntos/anúncios' },
  { value: 'AJUSTAR_ORCAMENTO', label: 'Ajustar orçamento' },
];

// Veredito por nível (campanha/conjunto/anúncio) — verde OK, âmbar atenção, vermelho urgente
const VERDICT_BADGE: Record<string, string> = {
  SAUDAVEL: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  ATENCAO: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  URGENTE: 'border-red-400/40 bg-red-400/10 text-red-300',
};
const VERDICT_LABEL: Record<string, string> = {
  SAUDAVEL: 'OK',
  ATENCAO: 'Atenção',
  URGENTE: 'Urgente',
};

// Métricas compactas de um nó: "R$ 420 · 34 conv · CPL R$ 12,37"
function nodeMetrics(m: { gasto: number; conversoes: number; cpl: number | null }): string {
  const parts = [formatCurrencyBRL(m.gasto), `${m.conversoes.toLocaleString('pt-BR')} conv`];
  if (m.cpl != null) parts.push(`CPL ${formatCurrencyBRL(m.cpl)}`);
  return parts.join(' · ');
}

// "Precisa de atenção" = o próprio nó não é saudável OU algum descendente não é — usado para
// auto-expandir só os ramos com algo a ajustar. Campanha/conjunto 100% saudáveis ficam
// fechados por padrão (1 linha, sem ruído); só abrem quem tem ação de verdade.
function adNeedsAttention(ad: OptimizerAnaliseAnuncio): boolean {
  return ad.classificacao !== 'SAUDAVEL';
}
function conjNeedsAttention(conj: OptimizerAnaliseConjunto): boolean {
  return conj.classificacao !== 'SAUDAVEL' || conj.anuncios.some(adNeedsAttention);
}
function campNeedsAttention(camp: OptimizerAnaliseCampanha): boolean {
  return camp.classificacao !== 'SAUDAVEL' || camp.conjuntos.some(conjNeedsAttention);
}

function VerdictBadge({ v }: { v: string }) {
  return (
    <span className={cn(
      'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
      VERDICT_BADGE[v] ?? 'border-border text-muted-foreground',
    )}>
      {VERDICT_LABEL[v] ?? v}
    </span>
  );
}

// Diz em que nível o ajuste se aplica — deixa claro que a ação é na campanha, no conjunto
// ou no criativo específico, sem depender só da indentação da árvore.
function LevelTag({ level }: { level: 'Campanha' | 'Conjunto' | 'Criativo' }) {
  return <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">{level}</span>;
}

// Ícone (i) com o "porquê" (veredito) no hover — mantém a linha limpa
function VerdictInfo({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Tooltip>
      <TooltipTrigger className="mt-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none">
        <Info className="h-3.5 w-3.5" />
      </TooltipTrigger>
      <TooltipContent side="left" className="block max-w-xs whitespace-normal p-2.5 text-left text-xs leading-relaxed text-background">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function isV2Result(resultado: QueueItem['resultado']): resultado is OptimizerOutputV2 {
  return 'estado_da_conta' in resultado && 'resumo_executivo' in resultado;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Config Modal
// ---------------------------------------------------------------------------
function ConfigModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [config, setConfig] = useState<ClientConfig>({
    cliente_id: clientId, modo_operacao: 'RECOMENDACAO_COM_APROVACAO',
    analise_dia_semana: 1, acoes_pre_aprovadas: [], min_dias_aprendizado: 7, orcamento_diario_maximo_conta: null,
    observacoes_fixas: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`);
        if (res.ok) setConfig(await res.json() as ClientConfig);
      } finally { setLoading(false); }
    })();
  }, [clientId]);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  function toggleAcao(value: string) {
    setConfig((prev) => ({
      ...prev,
      acoes_pre_aprovadas: prev.acoes_pre_aprovadas.includes(value)
        ? prev.acoes_pre_aprovadas.filter((v) => v !== value)
        : [...prev.acoes_pre_aprovadas, value],
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-foreground">Config do Otimizador</h2>
            <p className="text-sm text-muted-foreground">{clientName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Modo de operação</label>
              <div className="space-y-2">
                {(Object.keys(MODO_LABELS) as OptimizerModo[]).map((modo) => (
                  <label key={modo} className="flex cursor-pointer items-start gap-3">
                    <input type="radio" name="modo" value={modo} checked={config.modo_operacao === modo}
                      onChange={() => setConfig((prev) => ({ ...prev, modo_operacao: modo }))} className="mt-0.5 accent-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{MODO_LABELS[modo]}</p>
                      <p className="text-xs text-muted-foreground">{MODO_DESC[modo]}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Dia da semana da análise</label>
              <select value={config.analise_dia_semana}
                onChange={(e) => setConfig((prev) => ({ ...prev, analise_dia_semana: Number(e.target.value) }))}
                className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                {Object.entries(DOW_LABELS).map(([day, label]) => (
                  <option key={day} value={Number(day)}>{label}</option>
                ))}
              </select>
            </div>
            {(config.modo_operacao === 'AUTOMATICO_PARCIAL' || config.modo_operacao === 'AUTOMATICO_TOTAL') && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Ações pré-aprovadas</label>
                <div className="space-y-1.5">
                  {ACOES_PRE_APROVADAS_OPCOES.map((op) => (
                    <label key={op.value} className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={config.acoes_pre_aprovadas.includes(op.value)}
                        onChange={() => toggleAcao(op.value)} className="accent-primary" />
                      <span className="text-sm text-foreground">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Mín. dias para pausar</label>
                <input type="number" min={1} max={90} value={config.min_dias_aprendizado}
                  onChange={(e) => setConfig((prev) => ({ ...prev, min_dias_aprendizado: Number(e.target.value) }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Orçamento máx. diário (R$)</label>
                <input type="number" min={0} placeholder="Sem limite" value={config.orcamento_diario_maximo_conta ?? ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, orcamento_diario_maximo_conta: e.target.value === '' ? null : Number(e.target.value) }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Peculiaridades deste cliente</label>
              <div className="relative">
                <textarea
                  rows={4}
                  maxLength={2000}
                  placeholder='Ex: "Campanhas com [BOT] no nome são fluxo automatizado, têm lógica própria — nunca sugerir mover orçamento delas pra outra campanha." A IA lê isso antes de cada análise, junto com metas e desempenho.'
                  value={config.observacoes_fixas ?? ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, observacoes_fixas: e.target.value }))}
                  className="w-full resize-none rounded-[var(--radius)] border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-primary"
                />
                <DictateButton
                  className="absolute bottom-2 right-2"
                  onTranscript={(text) => setConfig((prev) => ({ ...prev, observacoes_fixas: prev.observacoes_fixas ? `${prev.observacoes_fixas} ${text}` : text }))}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Contexto fixo que a IA considera em toda análise deste cliente, além de metas e performance.</p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              {saved && <span className="text-xs text-primary">Configuração salva!</span>}
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Card (v2 only)
// ---------------------------------------------------------------------------
function TaskCard({
  item,
  isSelected,
  isAdmin,
  onClick,
  onConfig,
}: {
  item: QueueItem;
  isSelected: boolean;
  isAdmin: boolean;
  onClick: () => void;
  onConfig: () => void;
}) {
  const resultado = item.resultado as OptimizerOutputV2;
  // Prévia do card = ação da campanha mais crítica (URGENTE primeiro, depois ATENÇÃO)
  const topCampAction = [...(resultado.analise_campanhas ?? [])]
    .sort((a, b) => (a.classificacao === 'URGENTE' ? -1 : b.classificacao === 'URGENTE' ? 1 : a.classificacao === 'ATENCAO' ? -1 : 1))
    .find((c) => c.acao)?.acao;
  const pendingActions = resultado.acoes_automaticas?.filter((a) => a.status_execucao === 'AGUARDAR_APROVACAO') ?? [];

  const estadoStyle: Record<string, string> = {
    SAUDAVEL: 'border-emerald-400/30 bg-emerald-400/8',
    ATENCAO: 'border-amber-400/30 bg-amber-400/8',
    CRISE: 'border-red-400/30 bg-red-400/8',
  };
  const estadoBadge: Record<string, string> = {
    SAUDAVEL: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300',
    ATENCAO: 'border-amber-400/40 bg-amber-400/15 text-amber-300',
    CRISE: 'border-red-400/40 bg-red-400/15 text-red-300',
  };
  const estadoLabel: Record<string, string> = { SAUDAVEL: 'Saudável', ATENCAO: 'Atenção', CRISE: 'Crise' };

  const estado = item.estado_da_conta ?? 'SAUDAVEL';

  return (
    <div
      className={cn(
        'group rounded-[var(--radius)] border transition-all cursor-pointer',
        estadoStyle[estado],
        isSelected ? 'ring-1 ring-primary' : 'hover:border-primary/40',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3 p-3">
        <ClientAvatar clientId={item.cliente_id} name={item.cliente_nome} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', estadoBadge[estado])}>
              {estadoLabel[estado] ?? estado}
            </span>
            {item.semana_analise && (
              <span className="text-[10px] text-muted-foreground">{item.semana_analise}</span>
            )}
            {pendingActions.length > 0 && (
              <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                {pendingActions.length} aguardando aprovação
              </span>
            )}
          </div>
          <p className="mt-1 font-semibold text-foreground truncate">{item.cliente_nome}</p>
          {topCampAction && (
            <p className="mt-0.5 text-sm text-muted-foreground line-clamp-2">{topCampAction}</p>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={(e) => { e.stopPropagation(); onConfig(); }}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-opacity"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel (v2)
// ---------------------------------------------------------------------------
function DetailPanel({
  item,
  isAdmin,
  onConfig,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  isAdmin: boolean;
  onConfig: () => void;
  onApprove: (acao: OptimizerAcaoAutomatica, index: number) => Promise<void>;
  onReject: (index: number) => void;
}) {
  const [approvalFeedback, setApprovalFeedback] = useState<Record<number, string>>({});
  const [v1Feedback, setV1Feedback] = useState<Record<number, string>>({});
  const [showResumo, setShowResumo] = useState(false);
  const [openCamp, setOpenCamp] = useState<Set<string>>(new Set());
  const [openConj, setOpenConj] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const isV2 = isV2Result(item.resultado);
  const resultado = item.resultado as OptimizerOutputV2;
  const resultadoV1 = item.resultado as OptimizerAnalysisResult;

  // Auto-expande só os ramos com algo a ajustar — campanha/conjunto 100% saudáveis ficam
  // fechados (1 linha, sem ruído) até o gestor clicar pra auditar.
  useEffect(() => {
    const campanhas = resultado.analise_campanhas ?? [];
    setOpenCamp(new Set(campanhas.filter(campNeedsAttention).map((c) => c.id)));
    setOpenConj(new Set(campanhas.flatMap((c) => c.conjuntos.filter(conjNeedsAttention).map((cj) => cj.id))));
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pendingActions = isV2 ? (resultado.acoes_automaticas?.filter((a) => a.status_execucao === 'AGUARDAR_APROVACAO') ?? []) : [];
  const executedActions = isV2 ? (resultado.acoes_automaticas?.filter((a) => a.status_execucao === 'EXECUTAR_AGORA') ?? []) : [];

  const estadoStyle: Record<string, string> = {
    SAUDAVEL: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
    ATENCAO: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    CRISE: 'border-red-400/40 bg-red-400/10 text-red-300',
  };
  const estadoLabel: Record<string, string> = { SAUDAVEL: 'Saudável', ATENCAO: 'Atenção', CRISE: 'Crise' };
  const estado = item.estado_da_conta ?? '';

  async function handleApprove(acao: OptimizerAcaoAutomatica, index: number) {
    setApprovalFeedback((prev) => ({ ...prev, [index]: 'Executando...' }));
    await onApprove(acao, index);
    setApprovalFeedback((prev) => ({ ...prev, [index]: 'Executado' }));
  }

  const session = getAuthSession();

  async function logDecisionV1(index: number, decisao: 'aceito' | 'recusado' | 'manual', actionText: string) {
    setV1Feedback((prev) => ({ ...prev, [index]: 'Salvando...' }));
    try {
      const res = await fetch('/api/otimizador/analisar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestor_id: session?.userId ?? 'desconhecido',
          cliente_id: item.cliente_id,
          conjunto_id: item.conjunto_id,
          recomendacao_id: resultadoV1.recomendacao_id ?? item.id,
          decisao,
          acao_executada: actionText,
          resultado_da_acao: decisao === 'aceito' ? 'pendente' : decisao === 'manual' ? 'sucesso' : undefined,
        }),
      });
      setV1Feedback((prev) => ({ ...prev, [index]: res.ok ? 'Registrado' : 'Erro' }));
    } catch {
      setV1Feedback((prev) => ({ ...prev, [index]: 'Erro' }));
    }
  }

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
        <div className="flex items-start gap-3 min-w-0">
          <ClientAvatar clientId={item.cliente_id} name={item.cliente_nome} size="sm" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{item.cliente_nome}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {estado && (
                <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase', estadoStyle[estado])}>
                  {estadoLabel[estado] ?? estado}
                </span>
              )}
              {item.semana_analise && (
                <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {item.semana_analise}
                </span>
              )}
              {item.modo_operacao && (
                <span className="rounded border border-purple-400/40 bg-purple-400/10 px-1.5 py-0.5 text-[10px] text-purple-300">
                  {MODO_LABELS[item.modo_operacao as OptimizerModo] ?? item.modo_operacao}
                </span>
              )}
            </div>
          </div>
        </div>
        {isAdmin && (
          <button onClick={onConfig}
            className="shrink-0 flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
            <Settings2 className="h-3.5 w-3.5" />
            Configurar
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Resumo executivo — colapsado em 2 linhas; contexto completo sob demanda */}
        {item.resumo_executivo && (
          <div>
            <p className={cn('text-sm leading-relaxed text-muted-foreground', !showResumo && 'line-clamp-2')}>
              {item.resumo_executivo}
            </p>
            <button
              onClick={() => setShowResumo((s) => !s)}
              className="mt-0.5 text-xs font-medium text-primary hover:underline"
            >
              {showResumo ? 'ver menos' : 'ver contexto'}
            </button>
          </div>
        )}

        {/* v1 fallback header */}
        {!isV2 && (
          <div>
            <p className="font-semibold text-foreground">{resultadoV1.titulo_problema}</p>
            <p className="mt-1 text-sm text-muted-foreground">{resultadoV1.o_que_esta_acontecendo}</p>
          </div>
        )}

        {/* Métricas rápidas */}
        {isV2 && resultado.cruzamento_com_metas && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[var(--radius)] border border-border bg-background p-3">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              <span className="mt-1.5 block text-xs text-muted-foreground">Gasto</span>
              <span className="font-semibold text-foreground text-sm">{formatCurrencyBRL(resultado.cruzamento_com_metas.gasto_total)}</span>
            </div>
            <div className="rounded-[var(--radius)] border border-border bg-background p-3">
              <Target className="h-4 w-4 text-primary" />
              <span className="mt-1.5 block text-xs text-muted-foreground">Conversões</span>
              <span className="font-semibold text-foreground text-sm">{resultado.cruzamento_com_metas.volume_conversoes_atual.toLocaleString('pt-BR')}</span>
            </div>
            <div className="rounded-[var(--radius)] border border-border bg-background p-3">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="mt-1.5 block text-xs text-muted-foreground">CPL</span>
              <span className="font-semibold text-foreground text-sm">
                {resultado.cruzamento_com_metas.cpl_atual != null ? formatCurrencyBRL(resultado.cruzamento_com_metas.cpl_atual) : '—'}
              </span>
            </div>
          </div>
        )}

        {/* Ações aguardando aprovação */}
        {pendingActions.length > 0 && (
          <div className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/5 p-3 space-y-3">
            <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Aguardando sua aprovação</p>
            {pendingActions.map((acao, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{acao.acao} — {acao.objeto_nome}</p>
                    <p className="text-xs text-muted-foreground">{acao.justificativa}</p>
                    {approvalFeedback[i] && <p className="text-xs text-primary mt-0.5">{approvalFeedback[i]}</p>}
                  </div>
                </div>
                <div className="flex gap-2 pl-6">
                  <Button size="xs" onClick={() => handleApprove(acao, i)} disabled={!!approvalFeedback[i]}>
                    <Check className="h-3.5 w-3.5" /> Aprovar e executar
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onReject(i)} disabled={!!approvalFeedback[i]}>
                    <ThumbsDown className="h-3.5 w-3.5" /> Recusar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ações executadas automaticamente */}
        {executedActions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Executado automaticamente</p>
            {executedActions.map((acao, i) => (
              <div key={i} className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-background p-2.5">
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{acao.acao} — {acao.objeto_nome}</p>
                  <p className="text-xs text-muted-foreground">{acao.justificativa}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Análise por campanha — árvore campanha → conjunto → criativo. Só mostra o que
            precisa de ajuste: campanha/conjunto/criativo 100% OK não aparece, é ruído. */}
        {isV2 && resultado.analise_campanhas && resultado.analise_campanhas.length > 0 && (() => {
          const campanhasComAjuste = resultado.analise_campanhas.filter(campNeedsAttention);
          const totalCamp = resultado.analise_campanhas.length;
          const okCamp = totalCamp - campanhasComAjuste.length;
          return (
            <TooltipProvider delay={120}>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Análise por campanha
                  {okCamp > 0 && <span className="ml-1.5 normal-case font-normal text-muted-foreground/70">· {okCamp} campanha{okCamp > 1 ? 's' : ''} ok, oculta{okCamp > 1 ? 's' : ''}</span>}
                </p>
                {campanhasComAjuste.length === 0 ? (
                  <div className="rounded-[var(--radius)] border border-border bg-background p-4 text-center text-sm text-muted-foreground">
                    Tudo certo por aqui — nenhuma campanha precisa de ajuste agora.
                  </div>
                ) : campanhasComAjuste.map((camp) => {
                  const campOpen = openCamp.has(camp.id);
                  const conjuntosComAjuste = camp.conjuntos.filter(conjNeedsAttention);
                  const okConj = camp.conjuntos.length - conjuntosComAjuste.length;
                  const hasConj = conjuntosComAjuste.length > 0;
                  return (
                    <div key={camp.id} className="overflow-hidden rounded-[var(--radius)] border border-border bg-background">
                      <div
                        role={hasConj ? 'button' : undefined}
                        onClick={() => hasConj && toggle(openCamp, setOpenCamp, camp.id)}
                        className={cn('flex items-start gap-2.5 p-3', hasConj && 'cursor-pointer hover:bg-muted/30')}
                      >
                        {hasConj
                          ? (campOpen ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />)
                          : <span className="w-4 shrink-0" />}
                        <VerdictBadge v={camp.classificacao} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <LevelTag level="Campanha" />
                            <p className="truncate text-sm font-semibold text-foreground">{camp.nome}</p>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {nodeMetrics(camp)}{hasConj ? ` · ${conjuntosComAjuste.length} conj. c/ ajuste${okConj > 0 ? ` (${okConj} ok)` : ''}` : ''}
                          </p>
                          {camp.classificacao !== 'SAUDAVEL' && camp.acao && <p className="mt-1 text-xs font-medium text-primary">{camp.acao}</p>}
                        </div>
                        <VerdictInfo text={camp.veredito} />
                      </div>

                      {campOpen && hasConj && (
                        <div className="space-y-1.5 border-t border-border/60 bg-muted/10 p-2 pl-6">
                          {conjuntosComAjuste.map((conj) => {
                            const conjOpen = openConj.has(conj.id);
                            const anunciosComAjuste = conj.anuncios.filter(adNeedsAttention);
                            const okAd = conj.anuncios.length - anunciosComAjuste.length;
                            const hasAds = anunciosComAjuste.length > 0;
                            return (
                              <div key={conj.id} className="overflow-hidden rounded-[var(--radius)] border border-border/60 bg-background">
                                <div
                                  role={hasAds ? 'button' : undefined}
                                  onClick={() => hasAds && toggle(openConj, setOpenConj, conj.id)}
                                  className={cn('flex items-start gap-2 p-2.5', hasAds && 'cursor-pointer hover:bg-muted/30')}
                                >
                                  {hasAds
                                    ? (conjOpen ? <ChevronUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />)
                                    : <span className="w-3.5 shrink-0" />}
                                  <VerdictBadge v={conj.classificacao} />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-baseline gap-1.5">
                                      <LevelTag level="Conjunto" />
                                      <p className="truncate text-xs font-semibold text-foreground">{conj.nome}</p>
                                    </div>
                                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                                      {nodeMetrics(conj)}{hasAds ? ` · ${anunciosComAjuste.length} criativos c/ ajuste${okAd > 0 ? ` (${okAd} ok)` : ''}` : ''}
                                    </p>
                                    {conj.classificacao !== 'SAUDAVEL' && conj.acao && <p className="mt-0.5 text-[11px] font-medium text-primary">{conj.acao}</p>}
                                  </div>
                                  <VerdictInfo text={conj.veredito} />
                                </div>

                                {conjOpen && hasAds && (
                                  <div className="space-y-1 border-t border-border/50 p-1.5 pl-5">
                                    {anunciosComAjuste.map((ad) => (
                                      <div key={ad.id} className="flex items-start gap-2 rounded border border-border/40 bg-background/60 p-2">
                                        <VerdictBadge v={ad.classificacao} />
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-baseline gap-1.5">
                                            <LevelTag level="Criativo" />
                                            <p className="truncate text-[11px] font-semibold text-foreground">{ad.nome}</p>
                                          </div>
                                          <p className="mt-0.5 text-[10px] text-muted-foreground">{nodeMetrics(ad)}</p>
                                          {ad.classificacao !== 'SAUDAVEL' && ad.acao && <p className="mt-0.5 text-[11px] font-medium text-primary">{ad.acao}</p>}
                                        </div>
                                        <VerdictInfo text={ad.veredito} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </TooltipProvider>
          );
        })()}

        {/* v1 ações */}
        {!isV2 && resultadoV1.acoes && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ações recomendadas</p>
            {resultadoV1.acoes.map((action, index) => (
              <div key={index} className="rounded-[var(--radius)] border border-border bg-background p-3">
                <div className="flex items-start gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-primary text-xs font-bold text-primary-foreground">
                    {action.prioridade}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{action.acao}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{action.por_que}</p>
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {action.executavel_pelo_sistema
                        ? <span className="text-xs text-emerald-300 flex items-center gap-1"><BadgeCheck className="h-3 w-3" /> Executável</span>
                        : <span className="text-xs text-amber-300 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Manual</span>}
                      {v1Feedback[index] && <span className="text-xs text-primary">{v1Feedback[index]}</span>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button size="xs" onClick={() => logDecisionV1(index, 'aceito', action.acao)}>
                        <Check className="h-3.5 w-3.5" /> Vou fazer
                      </Button>
                      <Button size="xs" variant="outline" onClick={() => logDecisionV1(index, 'manual', action.acao)}>
                        Marcar feita
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => logDecisionV1(index, 'recusado', action.acao)}>
                        <ThumbsDown className="h-3.5 w-3.5" /> Recusar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {resultado.observacao && (
          <div className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            {(resultado as OptimizerOutputV2).observacao}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Group
// ---------------------------------------------------------------------------
function TaskGroup({
  title,
  items,
  selectedId,
  isAdmin,
  onSelect,
  onConfig,
}: {
  title: string;
  items: QueueItem[];
  selectedId: string;
  isAdmin: boolean;
  onSelect: (id: string) => void;
  onConfig: (clientId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{title} ({items.length})</p>
      {items.map((item) => (
        <TaskCard
          key={item.id}
          item={item}
          isSelected={item.id === selectedId}
          isAdmin={isAdmin}
          onClick={() => onSelect(item.id)}
          onConfig={() => onConfig(item.cliente_id)}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<ClientDiagnostic[] | null>(null);
  const [manualClientId, setManualClientId] = useState('programados-hoje');
  const [manualPeriod, setManualPeriod] = useState<OptimizerPeriodKey>('last_7d');
  const [configClientId, setConfigClientId] = useState<string | null>(null);
  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  async function loadQueue() {
    setLoading(true);
    try {
      const [clientsRes, queueRes] = await Promise.all([
        fetch('/api/clients'),
        fetch('/api/otimizador/analisar?hours=200'),
      ]);
      if (clientsRes.ok) {
        const data = await clientsRes.json() as Client[];
        setClients(data.filter((c) => c.status !== 'Arquivado' && c.status !== 'Inativo'));
      }
      if (queueRes.ok) {
        const data = await queueRes.json() as { items: QueueItem[]; generated_at: string | null };
        // Deduplica: um card por cliente, priorizando v2 > v1, depois mais urgente > mais recente
        const urgency = (item: QueueItem) => {
          const estado = item.estado_da_conta;
          if (estado === 'CRISE' || item.nivel_critico === 'vermelho') return 0;
          if (estado === 'ATENCAO' || item.nivel_critico === 'amarelo') return 1;
          return 2;
        };
        const byClient = new Map<string, QueueItem>();
        for (const item of data.items) {
          const existing = byClient.get(item.cliente_id);
          if (!existing) { byClient.set(item.cliente_id, item); continue; }
          // v2 sempre vence v1
          const itemIsV2 = !!item.semana_analise;
          const existingIsV2 = !!existing.semana_analise;
          if (itemIsV2 && !existingIsV2) { byClient.set(item.cliente_id, item); continue; }
          if (!itemIsV2 && existingIsV2) continue;
          // mesmo tipo: mais RECENTE vence — garante que uma reanálise substitua a antiga na tela
          if (new Date(item.created_at).getTime() > new Date(existing.created_at).getTime()) {
            byClient.set(item.cliente_id, item);
          }
        }
        const deduped = Array.from(byClient.values());
        setQueue(deduped);
        // "última em" = análise mais recente exibida (não a primeira da ordenação por urgência)
        const latest = deduped.reduce<string | null>((acc, it) =>
          !acc || new Date(it.created_at).getTime() > new Date(acc).getTime() ? it.created_at : acc, null);
        setGeneratedAt(latest ?? data.generated_at);
        const v2Only = deduped.filter((item) => !!item.semana_analise);
        setSelectedId((cur) => v2Only.some((item) => item.id === cur) ? cur : v2Only[0]?.id ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadQueue(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(() => queue.find((item) => item.id === selectedId) ?? null, [queue, selectedId]);

  // Separate v2 (weekly) from v1 (legacy)
  const v2Items = useMemo(() => queue.filter((item) => !!item.semana_analise), [queue]);
  const v1Items = useMemo(() => queue.filter((item) => !item.semana_analise), [queue]);

  const criseItems = useMemo(() => v2Items.filter((i) => i.estado_da_conta === 'CRISE' || i.nivel_critico === 'vermelho'), [v2Items]);
  const atencaoItems = useMemo(() => v2Items.filter((i) => i.estado_da_conta === 'ATENCAO' && i.nivel_critico !== 'vermelho'), [v2Items]);
  const saudavelItems = useMemo(() => v2Items.filter((i) => i.estado_da_conta === 'SAUDAVEL' && i.nivel_critico !== 'vermelho'), [v2Items]);

  async function approveAutoAction(acao: OptimizerAcaoAutomatica, _index: number) {
    if (!selected) return;
    await fetch('/api/otimizador/executar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...callerHeaders() },
      body: JSON.stringify({
        analise_id: selected.id,
        client_id: selected.cliente_id,
        connection_id: selected.conjunto_id,
        acao: acao.acao,
        objeto_tipo: acao.objeto_tipo,
        objeto_id: acao.objeto_id,
        objeto_nome: acao.objeto_nome,
        parametros: acao.parametros,
        justificativa: acao.justificativa,
        modo_operacao: selected.modo_operacao ?? 'RECOMENDACAO_COM_APROVACAO',
      }),
    });
  }

  // Busca um resultado de análise mais recente que o já existente (polling pós-disparo async).
  // Compara contra o created_at anterior (ambos do servidor) — imune a diferença de relógio.
  async function pollForFreshResult(clientId: string, priorTime: number): Promise<QueueItem | null> {
    try {
      const res = await fetch(`/api/otimizador/analisar?clientId=${encodeURIComponent(clientId)}&hours=1`);
      if (!res.ok) return null;
      const data = await res.json() as { items: QueueItem[] };
      return data.items.find((it) =>
        it.cliente_id === clientId
        && !!it.semana_analise
        && new Date(it.created_at).getTime() > priorTime,
      ) ?? null;
    } catch {
      return null;
    }
  }

  async function runWeeklyNow() {
    setRunLoading(true);
    setRunMessage(null);
    const isSingle = manualClientId !== 'programados-hoje';
    // Marca de tempo da última análise já existente deste cliente (do servidor) — só aceitamos
    // um resultado mais novo que este. Evita falsos positivos e dispensa o relógio do browser.
    const prior = queue.find((it) => it.cliente_id === manualClientId && !!it.semana_analise);
    const priorTime = prior ? new Date(prior.created_at).getTime() : 0;
    const clientName = isSingle ? (clients.find((c) => c.id === manualClientId)?.name ?? 'conta') : 'grupo de hoje';
    try {
      // Síncrono: o request só retorna quando a análise (busca + IA) terminou e foi gravada.
      // Sem `after()`/segundo plano — se der erro, o gestor VÊ o erro em vez de silêncio.
      // As rotas têm maxDuration=300; contas grandes (muitas campanhas/criativos) cabem no tempo.
      const params = new URLSearchParams({ period: manualPeriod, forceAi: '1' });
      if (isSingle) params.set('clientId', manualClientId);
      setRunMessage(`Analisando ${clientName}… isso pode levar até 2 minutos. Não feche a página.`);
      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST',
        headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setRunMessage(`Erro na análise: ${data.error || res.statusText || `HTTP ${res.status}`}`);
        return;
      }

      const data = await res.json().catch(() => ({})) as {
        ok_count?: number; erros?: number;
        results?: Array<{ clientId: string; status: string; error?: string }>;
      };

      // A análise já rodou e gravou no banco. Recarrega a fila para exibir.
      await loadQueue();

      if (isSingle) {
        const outcome = data.results?.find((r) => r.clientId === manualClientId);
        if (outcome && outcome.status !== 'ok') {
          // Rodou mas não gerou análise (sem conexão, sem campanhas, erro de IA…)
          const motivo = outcome.status === 'sem_conexao_meta' ? 'conta sem conexão Meta vinculada'
            : outcome.status === 'sem_campanhas_ativas' ? 'nenhuma campanha ativa com gasto no período'
            : outcome.error || outcome.status;
          setRunMessage(`Análise de ${clientName} não gerou resultado: ${motivo}.`);
          return;
        }
        const fresh = await pollForFreshResult(manualClientId, priorTime);
        if (fresh) setSelectedId(fresh.id);
        setRunMessage(`Análise de ${clientName} concluída.`);
      } else {
        setRunMessage(`Análise do grupo concluída: ${data.ok_count ?? 0} ok, ${data.erros ?? 0} erro(s).`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunMessage(`Erro: ${msg || 'falha de rede'} (a análise pode ter estourado o tempo — tente novamente).`);
    } finally {
      setRunLoading(false);
    }
  }

  // Diagnóstico de dados — sem IA, sem custo. Mostra de onde vêm (ou não) os dados do cliente.
  async function runDiagnostic() {
    setDiagLoading(true);
    setDiagResult(null);
    setRunMessage(null);
    try {
      const params = new URLSearchParams({ period: manualPeriod, dryRun: '1' });
      if (manualClientId !== 'programados-hoje') params.set('clientId', manualClientId);
      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST',
        headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as { diagnostics?: ClientDiagnostic[]; error?: string };
      if (!res.ok) {
        setRunMessage(`Erro no diagnóstico: ${data.error || `HTTP ${res.status}`}`);
        return;
      }
      setDiagResult(data.diagnostics ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunMessage(`Erro no diagnóstico: ${msg || 'falha de rede'}`);
    } finally {
      setDiagLoading(false);
    }
  }

  const configClient = configClientId ? clients.find((c) => c.id === configClientId) ?? null : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {configClientId && configClient && (
        <ConfigModal clientId={configClientId} clientName={configClient.name} onClose={() => setConfigClientId(null)} />
      )}

      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador v2.0
          </div>
          <h1 className="mt-1 text-2xl font-bold text-foreground">O que fazer agora</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Análises semanais por cliente · última em {formatDateTime(generatedAt)}
          </p>
        </div>
        <Button variant="outline" onClick={loadQueue} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </Button>
      </header>

      {/* Admin: análise manual */}
      {isAdmin && (
        <section className="rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.65fr)_auto] lg:items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Conta para analisar</span>
              <select value={manualClientId} onChange={(e) => setManualClientId(e.target.value)} disabled={runLoading}
                className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                <option value="programados-hoje">Todas programadas para hoje</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Período</span>
              <select value={manualPeriod} onChange={(e) => setManualPeriod(e.target.value as OptimizerPeriodKey)} disabled={runLoading}
                className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
                {OPTIMIZER_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <div className="flex gap-2">
              <Button onClick={runWeeklyNow} disabled={runLoading || diagLoading} className="h-10 flex-1">
                {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {manualClientId === 'programados-hoje' ? 'Analisar grupo de hoje' : 'Analisar esta conta'}
              </Button>
              <Button variant="outline" onClick={runDiagnostic} disabled={runLoading || diagLoading} className="h-10"
                title="Mostra de onde vêm os dados desta conta — sem gastar tokens de IA">
                {diagLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Diagnosticar
              </Button>
            </div>
          </div>
          {runMessage && <p className="mt-2 text-xs font-medium text-primary">{runMessage}</p>}

          {diagResult && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Diagnóstico de dados (sem IA · sem custo)</span>
                <button onClick={() => setDiagResult(null)} className="text-xs text-muted-foreground hover:text-foreground">fechar</button>
              </div>
              {diagResult.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum cliente para diagnosticar (verifique se está programado para hoje).</p>
              )}
              {diagResult.map((d, i) => {
                const ok = /DADOS OK/.test(d.veredito);
                const warn = /30 dias|período/.test(d.veredito);
                const tone = ok ? 'border-primary/40 bg-primary/5' : warn ? 'border-amber-500/40 bg-amber-500/5' : 'border-red-500/40 bg-red-500/5';
                return (
                  <div key={i} className={`rounded-[var(--radius)] border ${tone} p-3 text-xs`}>
                    <p className="font-semibold text-foreground">{d.cliente}</p>
                    <p className="mt-1 text-muted-foreground">{d.veredito}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-muted-foreground sm:grid-cols-3">
                      <span>conexão: {d.conexao_resolvida ? 'sim' : 'NÃO'}</span>
                      <span>token: {d.token_ok ? 'ok' : '—'}</span>
                      <span>account_id: {d.account_id ?? '—'}</span>
                      <span>camp. 7d: {d.campanhas_7d ?? '—'}</span>
                      <span>camp. 30d: {d.campanhas_30d ?? '—'}</span>
                      <span>planejamento: {d.planejamento.tem_planejamento ? 'sim' : 'não'}</span>
                      <span>CPL meta: {d.planejamento.cpl_meta ?? '—'}</span>
                      <span>meta leads: {d.planejamento.volume_leads_meta ?? '—'}</span>
                      <span>objetivo: {d.planejamento.objetivo ?? '—'}</span>
                    </div>
                    {d.amostra && d.amostra.length > 0 && (
                      <div className="mt-2 border-t border-border/50 pt-2">
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Campanhas com gasto via /api/campaigns (amostra 30d):</p>
                        {d.amostra.map((c, j) => (
                          <p key={j} className="font-mono text-[11px] text-muted-foreground">
                            • {c.nome} — {c.status} — R$ {c.gasto.toFixed(2)} — {c.leads} leads
                          </p>
                        ))}
                      </div>
                    )}
                    {d.meta_direto && (
                      <div className="mt-2 border-t border-border/50 pt-2">
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                          Direto na Meta (30d, sem filtros):{' '}
                          {d.meta_direto.ok
                            ? `${d.meta_direto.total ?? 0} campanha(s), ${d.meta_direto.com_gasto ?? 0} com gasto`
                            : `ERRO — ${d.meta_direto.erro ?? '?'}`}
                        </p>
                        {d.meta_direto.campanhas?.map((c, j) => (
                          <p key={j} className="font-mono text-[11px] text-muted-foreground">
                            • {c.nome} — {c.status} — R$ {c.gasto.toFixed(2)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Layout principal */}
      <main className="grid gap-5 xl:grid-cols-[380px_1fr]">
        {/* Lista de tarefas */}
        <section className="space-y-5">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando análises...
            </div>
          ) : v2Items.length === 0 && v1Items.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <CalendarClock className="h-8 w-8 text-muted-foreground" />
              <p className="font-semibold text-foreground">Nenhuma análise recente</p>
              <p className="text-sm text-muted-foreground">Rode a análise manualmente acima ou aguarde o cron de segunda a sexta às 10h UTC.</p>
            </div>
          ) : (
            <>
              <TaskGroup title="Crise — fazer agora" items={criseItems} selectedId={selectedId} isAdmin={isAdmin}
                onSelect={(id) => setSelectedId(id)} onConfig={(cid) => setConfigClientId(cid)} />
              <TaskGroup title="Atenção" items={atencaoItems} selectedId={selectedId} isAdmin={isAdmin}
                onSelect={(id) => setSelectedId(id)} onConfig={(cid) => setConfigClientId(cid)} />
              <TaskGroup title="Tudo certo" items={saudavelItems} selectedId={selectedId} isAdmin={isAdmin}
                onSelect={(id) => setSelectedId(id)} onConfig={(cid) => setConfigClientId(cid)} />
              {v2Items.length === 0 && (
                <div className="rounded-[var(--radius)] border border-dashed border-border p-6 text-center space-y-2">
                  <p className="font-semibold text-foreground">Nenhuma análise semanal gerada ainda</p>
                  <p className="text-sm text-muted-foreground">
                    As análises v2 são geradas automaticamente seg–sex. Use o painel acima para rodar manualmente uma conta agora.
                  </p>
                  {v1Items.length > 0 && (
                    <p className="text-xs text-muted-foreground">({v1Items.length} análise(s) antiga(s) ocultada(s) — rode uma nova para substituir)</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        {/* Painel de detalhe */}
        <aside>
          {!selected ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Selecione um cliente para ver os detalhes e recomendações.</p>
            </div>
          ) : (
            <DetailPanel
              item={selected}
              isAdmin={isAdmin}
              onConfig={() => setConfigClientId(selected.cliente_id)}
              onApprove={approveAutoAction}
              onReject={() => {}}
            />
          )}
        </aside>
      </main>
    </div>
  );
}
