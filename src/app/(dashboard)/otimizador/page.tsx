"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  MousePointerClick,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  ThumbsDown,
  Undo2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DictateButton } from '@/components/ui/dictate-button';
import { ClientAvatar } from '@/components/client-avatar';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { OPTIMIZER_PERIODS } from '@/lib/optimizer';
import type {
  OptimizerModo,
  OptimizerPeriodKey,
  OptimizerRecomendacao,
} from '@/lib/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Recomendação da fila (server já achatou via buildRecomendacoes) + status do workflow.
type FilaRec = OptimizerRecomendacao & { status: string; atribuido_a: string | null };

// Resumo por conta para o seletor.
type FilaConta = {
  cliente_id: string;
  cliente_nome: string;
  pior_severidade: 'urgente' | 'atencao' | 'ok';
  pendencias: number;
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

// Severidade — cor reservada SÓ para gravidade (nunca no texto da recomendação).
type Severidade = 'urgente' | 'atencao' | 'ok';
const SEV: Record<Severidade, { badge: string; dot: string; label: string }> = {
  urgente: { badge: 'border-red-400/40 bg-red-400/10 text-red-300', dot: 'bg-red-400', label: 'Urgente' },
  atencao: { badge: 'border-amber-400/40 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400', label: 'Atenção' },
  ok: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Ok' },
};
const SEV_RANK: Record<Severidade, number> = { urgente: 0, atencao: 1, ok: 2 };
const NIVEL_LABEL: Record<string, string> = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Criativo' };

// Ícone oficial do canal (Meta / Google Ads) — puramente informativo.
function ChannelIcon({ canal }: { canal: 'meta' | 'google' }) {
  const src = canal === 'google' ? '/brand/google-ads-logo.png' : '/brand/meta-ads-logo.webp';
  const label = canal === 'google' ? 'Google Ads' : 'Meta Ads';
  return (
    <span title={label} className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-background">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="max-h-3.5 max-w-3.5 object-contain" />
    </span>
  );
}

// Link direto para o objeto no Gerenciador de Anúncios nativo.
function adManagerUrl(rec: FilaRec): string | null {
  if (rec.canal === 'google') {
    return 'https://ads.google.com/aw/campaigns';
  }
  if (!rec.account_id) return null;
  const act = String(rec.account_id).replace(/^act_/, '');
  const sel = rec.nivel === 'campaign' ? `&selected_campaign_ids=${rec.objeto_id}`
    : rec.nivel === 'adset' ? `&selected_adset_ids=${rec.objeto_id}`
    : rec.nivel === 'ad' ? `&selected_ad_ids=${rec.objeto_id}` : '';
  return `https://business.facebook.com/adsmanager/manage/campaigns?act=${act}${sel}`;
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

  // Peculiaridades fixas armazenadas como texto único (1 linha = 1 item) — sem precisar de
  // coluna nova no banco. A UI trata cada linha como um item independente: edita, remove ou
  // adiciona sem mexer nos demais.
  const observacaoItems = (config.observacoes_fixas ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  const [newObservacao, setNewObservacao] = useState('');
  const [editingObsIndex, setEditingObsIndex] = useState<number | null>(null);
  const [editingObsText, setEditingObsText] = useState('');

  function setObservacaoItems(next: string[]) {
    setConfig((prev) => ({ ...prev, observacoes_fixas: next.length > 0 ? next.join('\n') : null }));
  }
  function addObservacao() {
    const t = newObservacao.trim();
    if (!t) return;
    setObservacaoItems([...observacaoItems, t]);
    setNewObservacao('');
  }
  function startEditObservacao(i: number) {
    setEditingObsIndex(i);
    setEditingObsText(observacaoItems[i]);
  }
  function saveEditObservacao(i: number) {
    const t = editingObsText.trim();
    if (!t) { removeObservacao(i); return; }
    const next = [...observacaoItems];
    next[i] = t;
    setObservacaoItems(next);
    setEditingObsIndex(null);
  }
  function removeObservacao(i: number) {
    setObservacaoItems(observacaoItems.filter((_, idx) => idx !== i));
    if (editingObsIndex === i) setEditingObsIndex(null);
  }

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
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Peculiaridades deste cliente</label>
              <p className="text-[11px] text-muted-foreground">Contexto fixo que a IA considera em toda análise deste cliente, além de metas e performance. Cada item abaixo é uma peculiaridade — edite, remova ou adicione sem afetar as outras.</p>

              {observacaoItems.length > 0 && (
                <ul className="space-y-1.5">
                  {observacaoItems.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-background px-3 py-2">
                      {editingObsIndex === i ? (
                        <>
                          <div className="relative flex-1">
                            <textarea
                              rows={2}
                              autoFocus
                              value={editingObsText}
                              onChange={(e) => setEditingObsText(e.target.value)}
                              className="w-full resize-none rounded border border-primary/50 bg-background px-2 py-1 pr-8 text-sm text-foreground outline-none"
                            />
                            <DictateButton
                              className="absolute bottom-1 right-1 h-6 w-6"
                              onTranscript={(text) => setEditingObsText((prev) => (prev ? `${prev} ${text}` : text))}
                            />
                          </div>
                          <div className="flex shrink-0 flex-col gap-1.5 pt-1">
                            <button type="button" onClick={() => saveEditObservacao(i)} title="Salvar" className="text-primary hover:text-primary/80">
                              <Check className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setEditingObsIndex(null)} title="Cancelar" className="text-muted-foreground hover:text-foreground">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 whitespace-pre-wrap text-sm text-foreground">{item}</span>
                          <div className="flex shrink-0 gap-1.5 pt-0.5">
                            <button type="button" onClick={() => startEditObservacao(i)} title="Editar" className="text-muted-foreground hover:text-primary">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" onClick={() => removeObservacao(i)} title="Remover" className="text-muted-foreground hover:text-red-400">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="relative">
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder='Nova peculiaridade... ex: "Campanhas com [BOT] no nome são fluxo automatizado, têm lógica própria — nunca sugerir mover orçamento delas pra outra campanha."'
                  value={newObservacao}
                  onChange={(e) => setNewObservacao(e.target.value)}
                  className="w-full resize-none rounded-[var(--radius)] border border-border bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none focus:border-primary"
                />
                <DictateButton
                  className="absolute bottom-2 right-2"
                  onTranscript={(text) => setNewObservacao((prev) => (prev ? `${prev} ${text}` : text))}
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addObservacao} disabled={!newObservacao.trim()}>
                <Plus className="h-3.5 w-3.5" />
                Adicionar peculiaridade
              </Button>
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
// Toast de confirmação (com Desfazer)
// ---------------------------------------------------------------------------
type ToastState = { text: string; erro?: boolean; undo?: { rec_id: string; cliente_id: string } } | null;

function ConfirmToast({ toast, onUndo, onClose }: { toast: ToastState; onUndo: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3 shadow-xl">
        {toast.erro
          ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          : <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
        <span className="text-sm text-foreground">{toast.text}</span>
        {toast.undo && (
          <button onClick={onUndo} className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            <Undo2 className="h-3.5 w-3.5" /> Desfazer
          </button>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seletor de conta (dropdown)
// ---------------------------------------------------------------------------
function AccountSelector({ contas, value, total, onChange }: {
  contas: FilaConta[];
  value: string;          // '' = fila por prioridade (todas)
  total: number;          // total de pendências (todas as contas)
  onChange: (clienteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sel = value ? contas.find((c) => c.cliente_id === value) : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-left hover:border-primary/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          {sel
            ? <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV[sel.pior_severidade].dot)} />
            : <MousePointerClick className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-sm font-medium text-foreground">
            {sel ? sel.cliente_nome : 'Fila por prioridade — todas as contas'}
          </span>
          <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {sel ? sel.pendencias : total}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-[var(--radius)] border border-border bg-card shadow-xl">
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-soft', !value && 'bg-surface-soft')}
            >
              <MousePointerClick className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Fila por prioridade (padrão)</span>
              <span className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{total}</span>
            </button>
            <div className="border-t border-border" />
            {contas.map((c) => (
              <button
                key={c.cliente_id}
                onClick={() => { onChange(c.cliente_id); setOpen(false); }}
                className={cn('flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-soft', value === c.cliente_id && 'bg-surface-soft')}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV[c.pior_severidade].dot)} />
                <span className="truncate text-sm text-foreground">{c.cliente_nome}</span>
                <span className="ml-auto shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.pendencias}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card de decisão (a recomendação atual)
// ---------------------------------------------------------------------------
function DecisionCard({ rec, allRecs, busy, onApply, onIgnore, onHuman, onJump }: {
  rec: FilaRec;
  allRecs: FilaRec[];
  busy: boolean;
  onApply: (rec: FilaRec, params: { novo_orcamento_diario?: number }, batch: FilaRec[]) => void;
  onIgnore: (rec: FilaRec) => void;
  onHuman: (rec: FilaRec) => void;
  onJump: (recId: string) => void;
}) {
  const [why, setWhy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [budget, setBudget] = useState('');
  const [batchOn, setBatchOn] = useState(false);

  // Reset ao trocar de recomendação.
  useEffect(() => {
    setWhy(false); setEditing(false); setBatchOn(false);
    setBudget(String(rec.acao_estruturada?.parametros?.novo_orcamento_diario ?? ''));
  }, [rec.rec_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sev = SEV[rec.severidade];
  const lowConf = !rec.aplicavel || rec.confianca === 'baixa';
  const emAnalise = rec.status === 'em_analise_humana';
  const isAjuste = rec.acao_estruturada?.tipo === 'AJUSTAR_ORCAMENTO';
  const link = adManagerUrl(rec);

  // Ação em lote: mesmo padrão, em OUTRAS contas, aplicável.
  const samePadrao = rec.padrao
    ? allRecs.filter((r) => r.padrao === rec.padrao && r.cliente_id !== rec.cliente_id && r.aplicavel && r.rec_id !== rec.rec_id)
    : [];
  const depRec = rec.depende_de ? allRecs.find((r) => r.rec_id === rec.depende_de) ?? null : null;

  function handleApply() {
    const params: { novo_orcamento_diario?: number } = {};
    if (isAjuste && budget.trim()) params.novo_orcamento_diario = Number(budget);
    onApply(rec, params, batchOn ? samePadrao : []);
  }

  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: rec.severidade === 'urgente' ? '#f87171' : rec.severidade === 'atencao' ? '#fbbf24' : '#34d399' }} />

      {/* 2.1 Identificação */}
      <div className="flex items-start gap-3 border-b border-border p-4">
        <ClientAvatar clientId={rec.cliente_id} name={rec.cliente_nome} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{rec.cliente_nome}</span>
            <ChannelIcon canal={rec.canal} />
            <span className="truncate text-xs text-muted-foreground">
              {NIVEL_LABEL[rec.nivel] ?? rec.nivel} · {rec.campanha_nome}
            </span>
          </div>
        </div>
        <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', sev.badge)}>
          {sev.label}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* 2.2 Título + métricas-chave */}
        <div>
          <p className="text-base font-semibold text-foreground">{rec.titulo}</p>
          {rec.metricas_chave.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              {rec.metricas_chave.map((m, i) => (
                <span key={i} className="text-xs text-muted-foreground">
                  {m.rotulo}: <span className="font-semibold text-foreground">{m.valor}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 2.3 Texto da recomendação (cor neutra, nunca verde) */}
        <p className="rounded-[var(--radius)] border border-border bg-background p-3 text-sm text-foreground">
          {rec.texto_recomendacao}
        </p>

        {emAnalise && (
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-2.5 text-xs text-secondary">
            <UserRound className="h-3.5 w-3.5 shrink-0" /> Em análise humana{rec.atribuido_a ? ` · ${rec.atribuido_a}` : ''}
          </div>
        )}

        {/* Edição inline dos parâmetros (só faz sentido p/ orçamento) */}
        {editing && isAjuste && (
          <div className="flex items-end gap-2 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-3">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Novo orçamento diário (R$)</span>
              <input
                type="number" min={1} value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
              />
            </label>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Concluir</Button>
          </div>
        )}

        {/* 2.4 Botões de ação */}
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={() => onIgnore(rec)} disabled={busy}>
            <ThumbsDown className="h-3.5 w-3.5" /> Ignorar
          </Button>
          {isAjuste && !lowConf && (
            <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)} disabled={busy}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Editar
            </Button>
          )}
          {lowConf ? (
            <Button size="sm" onClick={() => onHuman(rec)} disabled={busy || emAnalise}>
              <UserRound className="h-3.5 w-3.5" /> Enviar para análise de um humano
            </Button>
          ) : (
            <Button size="sm" onClick={handleApply} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {batchOn && samePadrao.length > 0 ? `Aplicar em ${samePadrao.length + 1} contas` : 'Aplicar'}
            </Button>
          )}
        </div>

        {/* 3. Toggle "Por que essa recomendação?" */}
        <div>
          <button onClick={() => setWhy((w) => !w)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {why ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Por que essa recomendação?
          </button>
          {why && (
            <div className="mt-2 space-y-3 rounded-[var(--radius)] border border-border bg-background p-3">
              {/* Fatos crus, sem interpretação */}
              <div className="space-y-1">
                {rec.fatos.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{f.rotulo}</span>
                    <span className="font-mono text-foreground">{f.valor}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1 text-xs">
                  <span className="text-muted-foreground">Confiança da análise</span>
                  <span className="font-mono text-foreground">{rec.confianca}</span>
                </div>
              </div>

              {/* Aviso de dependência */}
              {depRec && (
                <div className="flex items-start gap-2 rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-2.5 text-xs text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Depende de resolver antes: <span className="font-semibold">{depRec.objeto_nome}</span>.{' '}
                    <button onClick={() => onJump(depRec.rec_id)} className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline">
                      Ir para esse item <ArrowRight className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              )}

              {/* Ação em lote */}
              {samePadrao.length > 0 && !lowConf && (
                <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border border-border p-2.5 text-xs text-foreground">
                  <input type="checkbox" checked={batchOn} onChange={(e) => setBatchOn(e.target.checked)} className="mt-0.5 accent-primary" />
                  <span>Aplicar a mesma ação em <span className="font-semibold">{samePadrao.length}</span> outra(s) conta(s) com este mesmo padrão. Ao clicar em <span className="font-semibold">Aplicar</span>, a ação é replicada em todas.</span>
                </label>
              )}

              {/* Abrir no Gerenciador */}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir no Gerenciador de Anúncios
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista "Depois desta"
// ---------------------------------------------------------------------------
function NextUpList({ recs, onJump }: { recs: FilaRec[]; onJump: (recId: string) => void }) {
  if (recs.length === 0) return null;
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Depois desta</p>
      <ul className="mt-2 space-y-1.5">
        {recs.map((r) => (
          <li key={r.rec_id}>
            <button onClick={() => onJump(r.rec_id)} className="flex w-full items-center gap-2 text-left text-sm text-muted-foreground hover:text-foreground">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SEV[r.severidade].dot)} />
              <span className="truncate">{r.cliente_nome} — {r.titulo}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [recs, setRecs] = useState<FilaRec[]>([]);
  const [contas, setContas] = useState<FilaConta[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [contaFiltro, setContaFiltro] = useState('');
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  // Admin: análise manual
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<ClientDiagnostic[] | null>(null);
  const [manualClientId, setManualClientId] = useState('programados-hoje');
  const [manualPeriod, setManualPeriod] = useState<OptimizerPeriodKey>('last_7d');
  const [configClientId, setConfigClientId] = useState<string | null>(null);

  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  async function loadFila() {
    setLoading(true);
    try {
      const [clientsRes, filaRes] = await Promise.all([
        fetch('/api/clients'),
        fetch('/api/otimizador/fila?hours=200'),
      ]);
      if (clientsRes.ok) {
        const data = await clientsRes.json() as Client[];
        setClients(data.filter((c) => c.status !== 'Arquivado' && c.status !== 'Inativo'));
      }
      if (filaRes.ok) {
        const data = await filaRes.json() as { recs: FilaRec[]; contas: FilaConta[]; generated_at: string | null };
        setRecs(data.recs ?? []);
        setContas(data.contas ?? []);
        setGeneratedAt(data.generated_at);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadFila(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => (contaFiltro ? recs.filter((r) => r.cliente_id === contaFiltro) : recs),
    [recs, contaFiltro],
  );

  // Mantém o cursor dentro dos limites quando a fila encolhe.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const current = filtered[cursor] ?? null;
  const total = filtered.length;
  const posicao = total === 0 ? 0 : Math.min(cursor + 1, total);
  const nextUp = filtered.slice(cursor + 1, cursor + 4);

  function removeRecs(ids: string[]) {
    setRecs((prev) => prev.filter((r) => !ids.includes(r.rec_id)));
  }

  function jumpTo(recId: string) {
    const idx = filtered.findIndex((r) => r.rec_id === recId);
    if (idx >= 0) setCursor(idx);
  }

  const autor = { autor_id: session?.userId ?? undefined, autor_nome: session?.name ?? undefined };

  async function doApply(rec: FilaRec, params: { novo_orcamento_diario?: number }, batch: FilaRec[]) {
    const acao = rec.acao_estruturada;
    if (!acao) return;
    setBusy(true);
    try {
      if (batch.length > 0) {
        const itens = [rec, ...batch].map((r) => ({
          rec_id: r.rec_id, analise_id: r.analise_id, canal: r.canal, cliente_id: r.cliente_id,
          connection_id: r.connection_id ?? '', account_id: r.account_id ?? undefined,
          acao: r.acao_estruturada!.tipo, objeto_tipo: r.acao_estruturada!.objeto_tipo, objeto_id: r.acao_estruturada!.objeto_id,
          objeto_nome: r.objeto_nome, justificativa: r.texto_recomendacao,
          parametros: r.rec_id === rec.rec_id ? { ...r.acao_estruturada!.parametros, ...params } : r.acao_estruturada!.parametros,
        }));
        const res = await fetch('/api/otimizador/lote', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
          body: JSON.stringify({ itens, ...autor }),
        });
        const data = await res.json().catch(() => ({})) as { ok_count?: number; results?: Array<{ rec_id: string; ok: boolean }> };
        const okIds = (data.results ?? []).filter((r) => r.ok).map((r) => r.rec_id);
        removeRecs(okIds.length ? okIds : [rec.rec_id]);
        setToast({ text: `Aplicado em ${data.ok_count ?? okIds.length} conta(s).` });
      } else {
        const res = await fetch('/api/otimizador/executar', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
          body: JSON.stringify({
            rec_id: rec.rec_id, analise_id: rec.analise_id, canal: rec.canal, client_id: rec.cliente_id,
            connection_id: rec.connection_id ?? '', account_id: rec.account_id ?? undefined,
            acao: acao.tipo, objeto_tipo: acao.objeto_tipo, objeto_id: acao.objeto_id, objeto_nome: rec.objeto_nome,
            parametros: { ...acao.parametros, ...params }, justificativa: rec.texto_recomendacao, ...autor,
          }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; pode_desfazer?: boolean };
        if (!res.ok || !data.ok) {
          setToast({ text: `Não foi possível aplicar: ${data.error ?? res.statusText}`, erro: true });
          return;
        }
        removeRecs([rec.rec_id]);
        const label = acao.tipo === 'PAUSAR' ? 'Pausado' : acao.tipo === 'ATIVAR' ? 'Ativado' : 'Orçamento ajustado';
        setToast({
          text: `${label}. Você pode reverter agora.`,
          undo: data.pode_desfazer ? { rec_id: rec.rec_id, cliente_id: rec.cliente_id } : undefined,
        });
      }
    } catch {
      setToast({ text: 'Erro de rede ao aplicar.', erro: true });
    } finally {
      setBusy(false);
    }
  }

  async function doIgnore(rec: FilaRec) {
    setBusy(true);
    try {
      await fetch('/api/otimizador/ignorar', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({ rec_id: rec.rec_id, analise_id: rec.analise_id, cliente_id: rec.cliente_id, objeto_id: rec.objeto_id, ...autor }),
      });
      removeRecs([rec.rec_id]);
      setToast({ text: 'Recomendação ignorada.' });
    } finally {
      setBusy(false);
    }
  }

  async function doHuman(rec: FilaRec) {
    setBusy(true);
    try {
      await fetch('/api/otimizador/analise-humana', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({ rec_id: rec.rec_id, analise_id: rec.analise_id, cliente_id: rec.cliente_id, objeto_id: rec.objeto_id, atribuido_a: session?.userId, ...autor }),
      });
      removeRecs([rec.rec_id]);
      setToast({ text: 'Enviado para análise de um humano.' });
    } finally {
      setBusy(false);
    }
  }

  async function doUndo() {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    await fetch('/api/otimizador/desfazer', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...callerHeaders() },
      body: JSON.stringify({ rec_id: u.rec_id, cliente_id: u.cliente_id, ...autor }),
    });
    await loadFila();
  }

  // Confirma que existe análise mais nova que a anterior (polling pós-disparo).
  async function pollForFreshResult(clientId: string, priorTime: number): Promise<boolean> {
    try {
      const res = await fetch(`/api/otimizador/fila?clientId=${encodeURIComponent(clientId)}&hours=1`);
      if (!res.ok) return false;
      const data = await res.json() as { generated_at: string | null };
      return !!data.generated_at && new Date(data.generated_at).getTime() > priorTime;
    } catch {
      return false;
    }
  }

  async function runWeeklyNow() {
    setRunLoading(true);
    setRunMessage(null);
    const isSingle = manualClientId !== 'programados-hoje';
    const priorTime = generatedAt ? new Date(generatedAt).getTime() : 0;
    const clientName = isSingle ? (clients.find((c) => c.id === manualClientId)?.name ?? 'conta') : 'grupo de hoje';
    try {
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
      await loadFila();
      if (isSingle) {
        const outcome = data.results?.find((r) => r.clientId === manualClientId);
        if (outcome && outcome.status !== 'ok') {
          const motivo = outcome.status === 'sem_conexao_meta' ? 'conta sem conexão Meta vinculada'
            : outcome.status === 'sem_campanhas_ativas' ? 'nenhuma campanha ativa com gasto no período'
            : outcome.error || outcome.status;
          setRunMessage(`Análise de ${clientName} não gerou resultado: ${motivo}.`);
          return;
        }
        await pollForFreshResult(manualClientId, priorTime);
        setContaFiltro(manualClientId);
        setCursor(0);
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
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      {configClientId && configClient && (
        <ConfigModal clientId={configClientId} clientName={configClient.name} onClose={() => setConfigClientId(null)} />
      )}
      <ConfirmToast toast={toast} onUndo={doUndo} onClose={() => setToast(null)} />

      {/* 1. Título + progresso */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador
          </div>
          <h1 className="mt-1 font-heading text-4xl text-foreground">O que fazer agora</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Última análise em {formatDateTime(generatedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" onClick={() => setConfigClientId(contaFiltro || current?.cliente_id || null)} disabled={!contaFiltro && !current}>
              <Settings2 className="h-4 w-4" /> Configurar
            </Button>
          )}
          <Button variant="outline" onClick={loadFila} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </Button>
        </div>
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
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Seletor + progresso */}
      {!loading && recs.length > 0 && (
        <section className="space-y-3">
          <AccountSelector contas={contas} value={contaFiltro} total={recs.length} onChange={(id) => { setContaFiltro(id); setCursor(0); }} />
          <div className="flex items-center gap-3">
            <span className="shrink-0 text-xs font-semibold text-muted-foreground">{posicao} de {total}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-soft">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (posicao / total) * 100 : 0}%` }} />
            </div>
          </div>
        </section>
      )}

      {/* Card de decisão */}
      <main className="space-y-4">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando fila...
          </div>
        ) : recs.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
            <CalendarClock className="h-8 w-8 text-muted-foreground" />
            <p className="font-semibold text-foreground">Nenhuma decisão pendente</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? 'Rode uma análise acima ou aguarde o cron seg–sex às 10h UTC.' : 'Volte mais tarde — as análises rodam de segunda a sexta.'}
            </p>
          </div>
        ) : !current ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-6 text-center">
            <BadgeCheck className="h-8 w-8 text-primary" />
            <p className="font-semibold text-foreground">Tudo resolvido por aqui!</p>
            <p className="text-sm text-muted-foreground">Nenhuma pendência nesta seleção.</p>
          </div>
        ) : (
          <>
            <DecisionCard
              rec={current}
              allRecs={recs}
              busy={busy}
              onApply={doApply}
              onIgnore={doIgnore}
              onHuman={doHuman}
              onJump={jumpTo}
            />
            <NextUpList recs={nextUp} onJump={jumpTo} />
          </>
        )}
      </main>
    </div>
  );
}

