"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Play,
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
import { ClientAvatar } from '@/components/client-avatar';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { OPTIMIZER_PERIODS } from '@/lib/optimizer';
import type {
  OptimizerAnalysisResult,
  OptimizerAcaoAutomatica,
  OptimizerEstadoConta,
  OptimizerModo,
  OptimizerOutputV2,
  OptimizerPeriodKey,
} from '@/lib/optimizer';

type LevelFilter = 'todos' | 'vermelho' | 'amarelo' | 'verde';

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

type ClientConfig = {
  cliente_id: string;
  modo_operacao: OptimizerModo;
  analise_dia_semana: number;
  acoes_pre_aprovadas: string[];
  min_dias_aprendizado: number;
  orcamento_diario_maximo_conta: number | null;
};

const DOW_LABELS: Record<number, string> = {
  1: 'Segunda-feira',
  2: 'Terça-feira',
  3: 'Quarta-feira',
  4: 'Quinta-feira',
  5: 'Sexta-feira',
};

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

const ESTADO_STYLE: Record<OptimizerEstadoConta | string, string> = {
  SAUDAVEL: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  ATENCAO: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  CRISE: 'border-red-400/40 bg-red-400/10 text-red-300',
};

const ESTADO_LABEL: Record<string, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  CRISE: 'Crise',
};

const LEVEL_STYLE = {
  verde: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  amarelo: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  vermelho: 'border-red-400/40 bg-red-400/10 text-red-300',
};

const SOURCE_LABEL: Record<OptimizerAnalysisResult['origem'], string> = {
  camada_1: 'Regra',
  ia: 'IA',
  cache: 'Cache',
  fallback: 'Fallback',
};

const URGENCIA_STYLE: Record<string, string> = {
  FAZER_AGORA: 'text-red-300',
  PROXIMA_SEMANA: 'text-amber-300',
  QUANDO_POSSIVEL: 'text-emerald-300',
};

const URGENCIA_LABEL: Record<string, string> = {
  FAZER_AGORA: 'Fazer agora',
  PROXIMA_SEMANA: 'Próx. semana',
  QUANDO_POSSIVEL: 'Quando possível',
};

const ACOES_PRE_APROVADAS_OPCOES = [
  { value: 'PAUSAR', label: 'Pausar conjuntos/anúncios' },
  { value: 'ATIVAR', label: 'Ativar conjuntos/anúncios' },
  { value: 'AJUSTAR_ORCAMENTO', label: 'Ajustar orçamento' },
];

function formatDateTime(value: string | null): string {
  if (!value) return 'Ainda não gerado';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isV2Result(resultado: QueueItem['resultado']): resultado is OptimizerOutputV2 {
  return 'estado_da_conta' in resultado && 'resumo_executivo' in resultado;
}

function levelSort(level: QueueItem['nivel_critico']) {
  if (level === 'vermelho') return 0;
  if (level === 'amarelo') return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Config Modal
// ---------------------------------------------------------------------------
function ConfigModal({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ClientConfig>({
    cliente_id: clientId,
    modo_operacao: 'RECOMENDACAO_COM_APROVACAO',
    analise_dia_semana: 1,
    acoes_pre_aprovadas: [],
    min_dias_aprendizado: 7,
    orcamento_diario_maximo_conta: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`);
        if (res.ok) {
          const data = await res.json() as ClientConfig;
          setConfig(data);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/otimizador/config/${encodeURIComponent(clientId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify(config),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
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
      <div
        className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-foreground">Config do Otimizador</h2>
            <p className="text-sm text-muted-foreground">{clientName}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 p-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Modo de operação</label>
              <div className="space-y-2">
                {(Object.keys(MODO_LABELS) as OptimizerModo[]).map((modo) => (
                  <label key={modo} className="flex cursor-pointer items-start gap-3">
                    <input
                      type="radio"
                      name="modo"
                      value={modo}
                      checked={config.modo_operacao === modo}
                      onChange={() => setConfig((prev) => ({ ...prev, modo_operacao: modo }))}
                      className="mt-0.5 accent-primary"
                    />
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
              <select
                value={config.analise_dia_semana}
                onChange={(e) => setConfig((prev) => ({ ...prev, analise_dia_semana: Number(e.target.value) }))}
                className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              >
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
                      <input
                        type="checkbox"
                        checked={config.acoes_pre_aprovadas.includes(op.value)}
                        onChange={() => toggleAcao(op.value)}
                        className="accent-primary"
                      />
                      <span className="text-sm text-foreground">{op.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Mín. dias para pausar</label>
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={config.min_dias_aprendizado}
                  onChange={(e) => setConfig((prev) => ({ ...prev, min_dias_aprendizado: Number(e.target.value) }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Orçamento máx. diário (R$)</label>
                <input
                  type="number"
                  min={0}
                  placeholder="Sem limite"
                  value={config.orcamento_diario_maximo_conta ?? ''}
                  onChange={(e) => setConfig((prev) => ({
                    ...prev,
                    orcamento_diario_maximo_conta: e.target.value === '' ? null : Number(e.target.value),
                  }))}
                  className="h-10 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                />
              </div>
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
// V2 Detail Panel
// ---------------------------------------------------------------------------
function V2DetailPanel({
  item,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  onApprove: (acao: OptimizerAcaoAutomatica, index: number) => Promise<void>;
  onReject: (index: number) => void;
}) {
  const resultado = item.resultado as OptimizerOutputV2;
  const [actionFeedback, setActionFeedback] = useState<Record<number, string>>({});

  const pendingActions = resultado.acoes_automaticas?.filter(
    (a) => a.status_execucao === 'AGUARDAR_APROVACAO',
  ) ?? [];

  const executedActions = resultado.acoes_automaticas?.filter(
    (a) => a.status_execucao === 'EXECUTAR_AGORA',
  ) ?? [];

  async function handleApprove(acao: OptimizerAcaoAutomatica, index: number) {
    setActionFeedback((prev) => ({ ...prev, [index]: 'Executando...' }));
    await onApprove(acao, index);
    setActionFeedback((prev) => ({ ...prev, [index]: 'Aprovado e executado' }));
  }

  return (
    <div className="space-y-4">
      {/* Estado da conta */}
      {item.estado_da_conta && (
        <div className={cn(
          'flex items-center gap-3 rounded-[var(--radius)] border p-3',
          ESTADO_STYLE[item.estado_da_conta] ?? 'border-border bg-card text-foreground',
        )}>
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide">Estado da conta</p>
            <p className="font-bold">{ESTADO_LABEL[item.estado_da_conta] ?? item.estado_da_conta}</p>
          </div>
          {item.modo_operacao && (
            <span className="ml-auto rounded border border-current/30 px-2 py-0.5 text-[11px] font-semibold">
              {MODO_LABELS[item.modo_operacao as OptimizerModo] ?? item.modo_operacao}
            </span>
          )}
        </div>
      )}

      {/* Resumo executivo */}
      {item.resumo_executivo && (
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Resumo executivo</p>
          </div>
          <p className="px-4 py-3 text-sm leading-relaxed text-foreground">{item.resumo_executivo}</p>
        </section>
      )}

      {/* Métricas cruzamento */}
      {resultado.cruzamento_com_metas && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[var(--radius)] border border-border bg-background p-3">
            <CircleDollarSign className="h-4 w-4 text-primary" />
            <span className="mt-2 block text-xs text-muted-foreground">Gasto</span>
            <span className="font-semibold text-foreground">{formatCurrencyBRL(resultado.cruzamento_com_metas.gasto_total)}</span>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-background p-3">
            <Target className="h-4 w-4 text-primary" />
            <span className="mt-2 block text-xs text-muted-foreground">Conversões</span>
            <span className="font-semibold text-foreground">{resultado.cruzamento_com_metas.volume_conversoes_atual.toLocaleString('pt-BR')}</span>
          </div>
          <div className="rounded-[var(--radius)] border border-border bg-background p-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="mt-2 block text-xs text-muted-foreground">CPL</span>
            <span className="font-semibold text-foreground">
              {resultado.cruzamento_com_metas.cpl_atual != null ? formatCurrencyBRL(resultado.cruzamento_com_metas.cpl_atual) : '-'}
            </span>
          </div>
        </div>
      )}

      {/* Recomendações */}
      {resultado.recomendacoes && resultado.recomendacoes.length > 0 && (
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recomendações</p>
          </div>
          <div className="divide-y divide-border">
            {resultado.recomendacoes.map((rec, i) => (
              <div key={i} className="p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={cn('text-[11px] font-bold uppercase', URGENCIA_STYLE[rec.urgencia])}>
                    {URGENCIA_LABEL[rec.urgencia] ?? rec.urgencia}
                  </span>
                  <span className="text-sm font-semibold text-foreground">{rec.titulo}</span>
                </div>
                <p className="text-sm text-muted-foreground">{rec.como_fazer}</p>
                {rec.impacto_estimado && (
                  <p className="text-xs text-primary">Impacto: {rec.impacto_estimado}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ações automáticas executadas */}
      {executedActions.length > 0 && (
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ações executadas automaticamente</p>
          </div>
          <div className="divide-y divide-border">
            {executedActions.map((acao, i) => (
              <div key={i} className="flex items-start gap-3 p-3">
                <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{acao.acao} — {acao.objeto_nome}</p>
                  <p className="text-xs text-muted-foreground">{acao.justificativa}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Ações pendentes de aprovação */}
      {pendingActions.length > 0 && (
        <section className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/5">
          <div className="border-b border-amber-400/20 px-4 py-2.5">
            <p className="text-xs font-semibold text-amber-300 uppercase tracking-wide">Ações aguardando aprovação</p>
          </div>
          <div className="divide-y divide-amber-400/10">
            {pendingActions.map((acao, i) => (
              <div key={i} className="p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{acao.acao} — {acao.objeto_nome}</p>
                    <p className="text-xs text-muted-foreground">{acao.justificativa}</p>
                    {actionFeedback[i] && (
                      <p className="text-xs text-primary mt-1">{actionFeedback[i]}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 pl-7">
                  <Button
                    size="xs"
                    onClick={() => handleApprove(acao, i)}
                    disabled={!!actionFeedback[i]}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Aprovar e executar
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onReject(i)}
                    disabled={!!actionFeedback[i]}
                  >
                    <ThumbsDown className="h-3.5 w-3.5" />
                    Recusar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Conjuntos */}
      {resultado.conjuntos && resultado.conjuntos.length > 0 && (
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Conjuntos de anúncios</p>
          </div>
          <div className="divide-y divide-border">
            {resultado.conjuntos.map((c, i) => (
              <div key={i} className="p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('text-[11px] font-bold uppercase rounded border px-1.5 py-0.5',
                    c.classificacao === 'SAUDAVEL' ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                      : c.classificacao === 'URGENTE' ? 'border-red-400/40 bg-red-400/10 text-red-300'
                        : 'border-amber-400/40 bg-amber-400/10 text-amber-300',
                  )}>
                    {c.classificacao === 'SAUDAVEL' ? 'OK' : c.classificacao === 'URGENTE' ? 'Urgente' : 'Atenção'}
                  </span>
                  <p className="text-sm font-semibold text-foreground truncate">{c.nome}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.diagnostico}</p>
                {c.acao_recomendada && <p className="mt-0.5 text-xs text-primary">{c.acao_recomendada}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {resultado.observacao && (
        <div className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          {resultado.observacao}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// V1 Detail Panel (backward compat)
// ---------------------------------------------------------------------------
function V1DetailPanel({
  selected,
  actionFeedback,
  onDecision,
}: {
  selected: QueueItem;
  actionFeedback: Record<number, string>;
  onDecision: (index: number, decisao: 'aceito' | 'recusado' | 'manual', actionText: string, resultado?: 'pendente' | 'sucesso' | 'erro') => Promise<void>;
}) {
  const resultado = selected.resultado as OptimizerAnalysisResult;
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-[var(--radius)] border border-border bg-background p-3">
          <CircleDollarSign className="h-4 w-4 text-primary" />
          <span className="mt-2 block text-xs text-muted-foreground">Gasto</span>
          <span className="font-semibold text-foreground">{formatCurrencyBRL(selected.gasto_total)}</span>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-background p-3">
          <Target className="h-4 w-4 text-primary" />
          <span className="mt-2 block text-xs text-muted-foreground">Conversões</span>
          <span className="font-semibold text-foreground">{selected.conversoes.toLocaleString('pt-BR')}</span>
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-background p-3">
          <MousePointerClick className="h-4 w-4 text-primary" />
          <span className="mt-2 block text-xs text-muted-foreground">CTR</span>
          <span className="font-semibold text-foreground">{selected.ctr_link == null ? '-' : `${selected.ctr_link.toFixed(2)}%`}</span>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-foreground">Ações recomendadas</h4>
      {resultado.acoes.map((action, index) => (
        <div key={`${selected.id}-${action.prioridade}-${index}`} className="rounded-[var(--radius)] border border-border bg-background p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary text-sm font-bold text-primary-foreground">
              {action.prioridade}
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">{action.acao}</p>
              <p className="mt-1 text-sm text-muted-foreground">{action.por_que}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {action.executavel_pelo_sistema ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300"><BadgeCheck className="h-3.5 w-3.5" /> Executável</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Manual</span>
                )}
                {actionFeedback[index] && <span className="text-primary">{actionFeedback[index]}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="xs" onClick={() => onDecision(index, 'aceito', action.acao, 'pendente')}>
                  <Check className="h-3.5 w-3.5" />
                  Vou fazer
                </Button>
                <Button size="xs" variant="outline" onClick={() => onDecision(index, 'manual', action.acao, 'sucesso')}>
                  <WandSparkles className="h-3.5 w-3.5" />
                  Marcar feita
                </Button>
                <Button size="xs" variant="ghost" onClick={() => onDecision(index, 'recusado', action.acao)}>
                  <ThumbsDown className="h-3.5 w-3.5" />
                  Recusar
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {resultado.observacao && (
        <div className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
          {resultado.observacao}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientFilter, setClientFilter] = useState('todos');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('todos');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [manualClientId, setManualClientId] = useState('programados-hoje');
  const [manualPeriod, setManualPeriod] = useState<OptimizerPeriodKey>('last_7d');
  const [configClientId, setConfigClientId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const [actionFeedback, setActionFeedback] = useState<Record<number, string>>({});
  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  async function loadQueue() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('hours', '200'); // ~8 dias para pegar análises semanais
      if (clientFilter !== 'todos') params.set('clientId', clientFilter);
      if (levelFilter !== 'todos') params.set('level', levelFilter);

      const [clientsRes, queueRes] = await Promise.all([
        fetch('/api/clients'),
        fetch(`/api/otimizador/analisar?${params.toString()}`),
      ]);

      if (clientsRes.ok) {
        const data = await clientsRes.json() as Client[];
        setClients(data.filter((client) => client.status !== 'Arquivado' && client.status !== 'Inativo'));
      }

      if (queueRes.ok) {
        const data = await queueRes.json() as { items: QueueItem[]; generated_at: string | null };
        setQueue(data.items);
        setGeneratedAt(data.generated_at);
        setSelectedId((current) => data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadQueue(); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, levelFilter]);

  const selected = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? queue[0] ?? null,
    [queue, selectedId],
  );

  const stats = useMemo(() => {
    const vermelho = queue.filter((item) => item.nivel_critico === 'vermelho').length;
    const amarelo = queue.filter((item) => item.nivel_critico === 'amarelo').length;
    const verde = queue.filter((item) => item.nivel_critico === 'verde').length;
    const spend = queue.reduce((sum, item) => sum + item.gasto_total, 0);
    return { vermelho, amarelo, verde, spend };
  }, [queue]);

  const sortedQueue = useMemo(
    () => [...queue].sort((a, b) => {
      const levelDiff = levelSort(a.nivel_critico) - levelSort(b.nivel_critico);
      if (levelDiff !== 0) return levelDiff;
      return b.gasto_total - a.gasto_total;
    }),
    [queue],
  );

  async function logDecision(
    index: number,
    decisao: 'aceito' | 'recusado' | 'manual',
    actionText: string,
    resultado: 'pendente' | 'sucesso' | 'erro' = 'pendente',
  ) {
    if (!selected) return;
    setActionFeedback((prev) => ({ ...prev, [index]: 'Salvando...' }));
    try {
      const res = await fetch('/api/otimizador/analisar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestor_id: session?.userId ?? 'desconhecido',
          cliente_id: selected.cliente_id,
          conjunto_id: selected.conjunto_id,
          recomendacao_id: (selected.resultado as OptimizerAnalysisResult).recomendacao_id ?? selected.id,
          decisao,
          motivo_recusa: decisao === 'recusado' ? 'outro' : undefined,
          acao_executada: actionText,
          resultado_da_acao: resultado,
        }),
      });
      setActionFeedback((prev) => ({ ...prev, [index]: res.ok ? 'Registrado' : 'Erro ao salvar' }));
    } catch {
      setActionFeedback((prev) => ({ ...prev, [index]: 'Erro ao salvar' }));
    }
  }

  async function approveAutoAction(acao: OptimizerAcaoAutomatica, _index: number) {
    if (!selected) return;
    await fetch('/api/otimizador/executar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...callerHeaders() },
      body: JSON.stringify({
        analise_id: selected.id,
        client_id: selected.cliente_id,
        connection_id: selected.conjunto_id, // weekly route stores connection_id in conjunto_id for v2
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

  async function runWeeklyNow() {
    setRunLoading(true);
    setRunMessage(null);
    abortRef.current = false;
    try {
      const params = new URLSearchParams({
        period: manualPeriod,
        forceAi: '1',
      });
      if (manualClientId !== 'programados-hoje') {
        params.set('clientId', manualClientId);
      }

      const res = await fetch(`/api/otimizador/weekly?${params.toString()}`, {
        method: 'POST',
        headers: { ...callerHeaders(), 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({})) as {
        processados?: number;
        ok_count?: number;
        erros?: number;
        periodo_label?: string;
        error?: string;
      };
      if (res.ok) {
        const scope = manualClientId === 'programados-hoje'
          ? 'grupo de hoje'
          : clients.find((client) => client.id === manualClientId)?.name ?? 'conta selecionada';
        setRunMessage(
          `${scope}: ${data.ok_count ?? 0} análise(s) concluída(s) em ${data.periodo_label ?? 'período selecionado'}${data.erros ? `, ${data.erros} erro(s)` : ''}.`,
        );
        if (manualClientId !== 'programados-hoje') setClientFilter(manualClientId);
        await loadQueue();
      } else {
        setRunMessage(`Erro: ${data.error ?? res.statusText}`);
      }
    } catch (err) {
      setRunMessage(`Erro ao rodar análise: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunLoading(false);
    }
  }

  const configClient = configClientId
    ? clients.find((c) => c.id === configClientId) ?? null
    : null;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      {configClientId && configClient && (
        <ConfigModal
          clientId={configClientId}
          clientName={configClient.name}
          onClose={() => setConfigClientId(null)}
        />
      )}

      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" />
            Otimizador v2.0
          </div>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Painel de decisões</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Uma análise por cliente a cada semana, distribuída por dia útil. A IA interpreta os dados e recomenda ou executa ações conforme o modo configurado.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[680px]">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Cliente</span>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="todos">Todos</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Prioridade</span>
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
              className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="todos">Todas</option>
              <option value="vermelho">Vermelho</option>
              <option value="amarelo">Amarelo</option>
              <option value="verde">Verde</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={loadQueue} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      {isAdmin && (
        <section className="rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(180px,0.65fr)_auto] lg:items-end">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Conta para analisar</span>
              <select
                value={manualClientId}
                onChange={(event) => setManualClientId(event.target.value)}
                disabled={runLoading}
                className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="programados-hoje">Todas programadas para hoje</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Período da análise</span>
              <select
                value={manualPeriod}
                onChange={(event) => setManualPeriod(event.target.value as OptimizerPeriodKey)}
                disabled={runLoading}
                className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              >
                {OPTIMIZER_PERIODS.map((period) => (
                  <option key={period.key} value={period.key}>{period.label}</option>
                ))}
              </select>
            </label>

            <Button onClick={runWeeklyNow} disabled={runLoading} className="h-11 lg:min-w-56">
              {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {manualClientId === 'programados-hoje' ? 'Analisar grupo de hoje' : 'Analisar esta conta'}
            </Button>
          </div>
          <div className="mt-3 border-t border-primary/15 pt-3">
            <p className="text-xs text-muted-foreground">
              A análise individual ignora o dia do rodízio e usa somente a conta e o período escolhidos.
            </p>
            {runMessage && <p className="mt-1.5 text-xs font-medium text-primary">{runMessage}</p>}
          </div>
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CalendarClock className="h-4 w-4 text-primary" />
            Última análise
          </div>
          <div className="mt-2 text-lg font-bold text-foreground">{formatDateTime(generatedAt)}</div>
        </div>
        <button onClick={() => setLevelFilter('vermelho')} className="rounded-[var(--radius)] border border-red-400/30 bg-red-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-red-200">Crise / Fazer agora</div>
          <div className="mt-2 text-2xl font-bold text-red-100">{stats.vermelho}</div>
        </button>
        <button onClick={() => setLevelFilter('amarelo')} className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-amber-200">Atenção</div>
          <div className="mt-2 text-2xl font-bold text-amber-100">{stats.amarelo}</div>
        </button>
        <button onClick={() => setLevelFilter('verde')} className="rounded-[var(--radius)] border border-emerald-400/30 bg-emerald-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-emerald-200">Saudável</div>
          <div className="mt-2 text-2xl font-bold text-emerald-100">{stats.verde}</div>
        </button>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CircleDollarSign className="h-4 w-4 text-primary" />
            Verba analisada
          </div>
          <div className="mt-2 text-lg font-bold text-foreground">{formatCurrencyBRL(stats.spend)}</div>
        </div>
      </section>

      <main className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold text-foreground">Análises da semana</h2>
            <p className="text-xs text-muted-foreground">Ordem por urgência. Clique para ver o detalhamento e as recomendações.</p>
          </div>

          {loading ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando análises...
            </div>
          ) : sortedQueue.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-300" />
              <p className="font-semibold text-foreground">Nenhuma análise recente</p>
              <p className="max-w-md text-sm text-muted-foreground">
                As análises são geradas automaticamente a cada semana para os clientes configurados. Você também pode rodar manualmente acima.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedQueue.map((item) => {
                const selectedRow = item.id === selected?.id;
                const isV2 = !!item.semana_analise;
                const firstAction = isV2
                  ? ((item.resultado as OptimizerOutputV2).recomendacoes?.[0]?.titulo ?? 'Ver detalhes')
                  : ((item.resultado as OptimizerAnalysisResult).acoes?.[0]?.acao ?? 'Revisar');
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setActionFeedback({});
                    }}
                    className={cn(
                      'grid w-full gap-3 p-4 text-left transition-colors lg:grid-cols-[1fr_auto] hover:bg-primary/5',
                      selectedRow && 'bg-primary/10',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-[11px] font-bold uppercase', LEVEL_STYLE[item.nivel_critico])}>
                          {item.nivel_critico}
                        </span>
                        {item.estado_da_conta && (
                          <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-[11px] font-bold uppercase', ESTADO_STYLE[item.estado_da_conta])}>
                            {ESTADO_LABEL[item.estado_da_conta] ?? item.estado_da_conta}
                          </span>
                        )}
                        {item.semana_analise && (
                          <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                            {item.semana_analise}
                          </span>
                        )}
                        {!item.semana_analise && (
                          <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                            {item.periodo_label}
                          </span>
                        )}
                        <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                          {SOURCE_LABEL[item.origem]}
                        </span>
                        <span className={`rounded-[var(--radius)] border px-2 py-1 text-[11px] font-semibold ${item.conta_plataforma === 'google_ads' ? 'border-blue-400/40 bg-blue-400/10 text-blue-300' : 'border-sky-400/40 bg-sky-400/10 text-sky-300'}`}>
                          {item.conta_plataforma === 'google_ads' ? 'Google' : 'Meta'}
                        </span>
                        {item.modo_operacao && (
                          <span className="rounded-[var(--radius)] border border-purple-400/40 bg-purple-400/10 px-2 py-1 text-[11px] text-purple-300">
                            {MODO_LABELS[item.modo_operacao as OptimizerModo] ?? item.modo_operacao}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex items-start gap-3">
                        <ClientAvatar clientId={item.cliente_id} name={item.cliente_nome} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-foreground">{item.cliente_nome}</p>
                          <p className="truncate text-sm text-muted-foreground">{item.campanha_nome}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-foreground">{firstAction}</p>
                        </div>
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); setConfigClientId(item.cliente_id); }}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                            title="Configurar cliente"
                          >
                            <Settings2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 lg:justify-end">
                      <div className="grid grid-cols-3 gap-3 text-right text-xs">
                        <div>
                          <span className="block text-muted-foreground">Gasto</span>
                          <span className="font-semibold text-foreground">{formatCurrencyBRL(item.gasto_total)}</span>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">CPL</span>
                          <span className="font-semibold text-foreground">{item.cpl_cpa_atual ? formatCurrencyBRL(item.cpl_cpa_atual) : '-'}</span>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">Conv.</span>
                          <span className="font-semibold text-foreground">{item.conversoes.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {!selected ? (
            <section className="rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <WandSparkles className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-semibold text-foreground">Nenhuma análise selecionada</p>
              <p className="mt-1 text-sm text-muted-foreground">Clique em um item da lista para ver os detalhes.</p>
            </section>
          ) : (
            <section className="rounded-[var(--radius)] border border-border bg-card">
              <div className="border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-xs font-bold uppercase', LEVEL_STYLE[selected.nivel_critico])}>
                        {selected.nivel_critico}
                      </span>
                      {!isV2Result(selected.resultado) && (
                        <>
                          <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                            {selected.periodo_label}
                          </span>
                          <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                            Confiança {(selected.resultado as OptimizerAnalysisResult).confianca}
                          </span>
                        </>
                      )}
                      <span className={`rounded-[var(--radius)] border px-2 py-1 text-xs font-semibold ${selected.conta_plataforma === 'google_ads' ? 'border-blue-400/40 bg-blue-400/10 text-blue-300' : 'border-sky-400/40 bg-sky-400/10 text-sky-300'}`}>
                        {selected.conta_plataforma === 'google_ads' ? 'Google' : 'Meta'}
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-foreground">
                      {isV2Result(selected.resultado)
                        ? selected.cliente_nome
                        : (selected.resultado as OptimizerAnalysisResult).titulo_problema}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {selected.cliente_nome} · {selected.campanha_nome}
                    </p>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => setConfigClientId(selected.cliente_id)}
                      className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configurar
                    </button>
                  )}
                </div>
                {!isV2Result(selected.resultado) && (
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {(selected.resultado as OptimizerAnalysisResult).o_que_esta_acontecendo}
                  </p>
                )}
              </div>

              {isV2Result(selected.resultado) ? (
                <div className="p-4">
                  <V2DetailPanel
                    item={selected}
                    onApprove={approveAutoAction}
                    onReject={(index) => setActionFeedback((prev) => ({ ...prev, [index]: 'Recusado' }))}
                  />
                </div>
              ) : (
                <V1DetailPanel
                  selected={selected}
                  actionFeedback={actionFeedback}
                  onDecision={logDecision}
                />
              )}
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
