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
  ChevronRight,
  ChevronUp,
  Eye,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquarePlus,
  MinusCircle,
  MousePointerClick,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  Undo2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DictateButton } from '@/components/ui/dictate-button';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { OPTIMIZER_PERIODS } from '@/lib/optimizer';
import type {
  OptimizerModo,
  OptimizerPeriodKey,
  OptimizerRecomendacao,
  OptimizerTreeNode,
} from '@/lib/optimizer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Recomendação da fila (server já achatou via buildRecomendacoes) + status do workflow.
type FilaRec = OptimizerRecomendacao & { status: string; atribuido_a: string | null };

// Nó da árvore (server já monta hierarquia completa via buildCampaignTree) + status do workflow.
type TreeNode = OptimizerTreeNode & { status: string; atribuido_a: string | null };

// Resumo por conta para o seletor.
type FilaConta = {
  cliente_id: string;
  cliente_nome: string;
  pior_severidade: 'urgente' | 'atencao' | 'ok';
  pendencias: number;
};

type ArvoreResumo = {
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

type ManualNote = {
  id: string;
  cliente_id: string;
  nivel: string;
  objeto_id: string | null;
  objeto_nome: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  texto: string;
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

// Severidade — cor reservada SÓ para gravidade (nunca no texto da recomendação).
type Severidade = 'urgente' | 'atencao' | 'ok';
const SEV: Record<Severidade, { badge: string; dot: string; label: string }> = {
  urgente: { badge: 'border-red-400/40 bg-red-400/10 text-red-300', dot: 'bg-red-400', label: 'Urgente' },
  atencao: { badge: 'border-amber-400/40 bg-amber-400/10 text-amber-300', dot: 'bg-amber-400', label: 'Atenção' },
  ok: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300', dot: 'bg-emerald-400', label: 'Oportunidade' },
};
const SEV_RANK: Record<Severidade, number> = { urgente: 0, atencao: 1, ok: 2 };

const NIVEL_LABEL: Record<string, string> = { campaign: 'Campanha', adset: 'Conjunto', ad: 'Criativo' };
const VERBO_ACAO: Record<string, string> = { PAUSAR: 'Pausar agora', ATIVAR: 'Reativar agora', AJUSTAR_ORCAMENTO: 'Ajustar agora' };

// 5 categorias de decisão rápida — computadas a partir de acao_tipo + severidade de cada nó.
// "Investigar" hoje só cobre VERIFICAR_MANUAL (ambiguidade/aprendizado) — funil/técnico real
// (WhatsApp, pixel, LP) ainda não é um sinal que a IA recebe, ver CLAUDE.md.
type Categoria = 'pausar' | 'revisar' | 'manter' | 'escalar' | 'investigar';
function categoriaDoNode(n: { severidade: Severidade; acao_estruturada: { tipo: string } | null; texto_recomendacao: string }): Categoria {
  const tipo = n.acao_estruturada?.tipo;
  if (tipo === 'PAUSAR') return 'pausar';
  if (n.severidade === 'ok' && (tipo === 'AJUSTAR_ORCAMENTO' || tipo === 'ATIVAR')) return 'escalar';
  if (n.severidade === 'ok') return 'manter';
  if (/aguardar mais dados|verificar/i.test(n.texto_recomendacao)) return 'investigar';
  return 'revisar';
}

const CATEGORIA_META: Record<Categoria, { label: string; icon: typeof PauseCircle; tone: string }> = {
  pausar: { label: 'Pausar agora', icon: PauseCircle, tone: 'border-red-400/40 bg-red-400/5 text-red-300' },
  revisar: { label: 'Revisar', icon: Search, tone: 'border-amber-400/40 bg-amber-400/5 text-amber-300' },
  manter: { label: 'Manter', icon: MinusCircle, tone: 'border-emerald-400/40 bg-emerald-400/5 text-emerald-300' },
  escalar: { label: 'Escalar', icon: Rocket, tone: 'border-primary/40 bg-primary/5 text-primary' },
  investigar: { label: 'Investigar', icon: Eye, tone: 'border-secondary/40 bg-secondary/5 text-secondary' },
};

// Link direto para o objeto no Gerenciador de Anúncios nativo.
function adManagerUrl(rec: { canal: string; account_id: string | null; nivel: string; objeto_id: string }): string | null {
  if (rec.canal === 'google') return 'https://ads.google.com/aw/campaigns';
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

// Achata a árvore em lista plana (com nível) — usado pelos cards de decisão rápida e filtros.
function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) { out.push(n); out.push(...flattenTree(n.filhos as TreeNode[])); }
  return out;
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
function AccountSelector({ contas, value, onChange }: {
  contas: FilaConta[];
  value: string;
  onChange: (clienteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sel = value ? contas.find((c) => c.cliente_id === value) : null;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2.5 text-left hover:border-primary/40 sm:w-80"
      >
        <span className="flex min-w-0 items-center gap-2">
          {sel
            ? <span className={cn('h-2 w-2 shrink-0 rounded-full', SEV[sel.pior_severidade].dot)} />
            : <MousePointerClick className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="truncate text-sm font-medium text-foreground">{sel ? sel.cliente_nome : 'Selecionar cliente'}</span>
          {sel && (
            <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {sel.pendencias} pendência{sel.pendencias === 1 ? '' : 's'}
            </span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-primary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-[var(--radius)] border border-border bg-card shadow-xl sm:w-80">
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
            {contas.length === 0 && <p className="p-3 text-xs text-muted-foreground">Nenhuma conta com análise recente.</p>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resumo geral da conta
// ---------------------------------------------------------------------------
const ESTADO_LABEL: Record<string, { label: string; tone: string }> = {
  SAUDAVEL: { label: 'Saudável', tone: 'text-emerald-300' },
  ATENCAO: { label: 'Atenção', tone: 'text-amber-300' },
  CRISE: { label: 'Crise', tone: 'text-red-300' },
};

function AccountSummaryHeader({ resumo, generatedAt, proximaAnalise }: {
  resumo: ArvoreResumo | null;
  generatedAt: string | null;
  proximaAnalise: string | null;
}) {
  if (!resumo) return null;
  const estado = ESTADO_LABEL[resumo.estado_da_conta ?? ''] ?? { label: '—', tone: 'text-muted-foreground' };
  const cm = resumo.cruzamento_com_metas;
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Verba gasta', value: formatCurrencyBRL(cm?.gasto_total ?? 0) },
    { label: 'Conversões', value: String(cm?.volume_conversoes_atual ?? 0) },
    { label: 'Custo por conversão', value: cm?.cpl_atual != null ? formatCurrencyBRL(cm.cpl_atual) : '—' },
    { label: 'Campanhas', value: String(resumo.campanhas) },
    { label: 'Conjuntos', value: String(resumo.conjuntos) },
    { label: 'Criativos', value: String(resumo.criativos) },
    { label: 'Diagnósticos', value: String(resumo.diagnosticos) },
  ];
  return (
    <section className="space-y-3 rounded-[var(--radius)] border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold uppercase tracking-wide', estado.tone)}>{estado.label}</span>
          {resumo.semana_analise && <span className="text-xs text-muted-foreground">· semana {resumo.semana_analise}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Última análise: {formatDateTime(generatedAt)}</span>
          {proximaAnalise && <span>Próxima automática: {proximaAnalise}</span>}
        </div>
      </div>
      {resumo.resumo_executivo && <p className="text-sm leading-relaxed text-foreground">{resumo.resumo_executivo}</p>}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4 lg:grid-cols-7">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 font-heading text-lg text-foreground">{s.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cards de decisão rápida
// ---------------------------------------------------------------------------
function QuickDecisionCards({ nodes, active, onSelect }: {
  nodes: TreeNode[];
  active: Categoria | null;
  onSelect: (cat: Categoria | null) => void;
}) {
  const counts: Record<Categoria, number> = { pausar: 0, revisar: 0, manter: 0, escalar: 0, investigar: 0 };
  for (const n of nodes) counts[categoriaDoNode(n)]++;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {(Object.keys(CATEGORIA_META) as Categoria[]).map((cat) => {
        const meta = CATEGORIA_META[cat];
        const Icon = meta.icon;
        const isActive = active === cat;
        return (
          <button
            key={cat}
            onClick={() => onSelect(isActive ? null : cat)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-[var(--radius)] border p-3 text-left transition-colors',
              isActive ? meta.tone : 'border-border bg-card hover:border-primary/30',
            )}
          >
            <Icon className={cn('h-4 w-4', isActive ? '' : 'text-muted-foreground')} />
            <span className="font-heading text-2xl text-foreground">{counts[cat]}</span>
            <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------
type NivelFiltro = 'todos' | 'campaign' | 'adset' | 'ad';

function FilterChips({ nivel, onNivel, apenasComAcao, onApenasComAcao }: {
  nivel: NivelFiltro;
  onNivel: (n: NivelFiltro) => void;
  apenasComAcao: boolean;
  onApenasComAcao: (v: boolean) => void;
}) {
  const opcoes: Array<{ value: NivelFiltro; label: string }> = [
    { value: 'todos', label: 'Todos os níveis' },
    { value: 'campaign', label: 'Campanhas' },
    { value: 'adset', label: 'Conjuntos' },
    { value: 'ad', label: 'Criativos' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opcoes.map((o) => (
        <button
          key={o.value}
          onClick={() => onNivel(o.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            nivel === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30',
          )}
        >
          {o.label}
        </button>
      ))}
      <button
        onClick={() => onApenasComAcao(!apenasComAcao)}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          apenasComAcao ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30',
        )}
      >
        Só com diagnóstico
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Árvore de campanhas
// ---------------------------------------------------------------------------
function nodeToneClass(n: TreeNode): string {
  if (n.status === 'ignorado' || n.status === 'aplicado') return 'opacity-40';
  return '';
}

function TreeNodeRow({ node, depth, selectedId, onSelect, filtroNivel, filtroCategoria, apenasComAcao }: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = node.filhos.length > 0;
  const sev = SEV[node.severidade];
  const cat = categoriaDoNode(node);
  const matchesFilter =
    (filtroNivel === 'todos' || node.nivel === filtroNivel) &&
    (!filtroCategoria || cat === filtroCategoria) &&
    (!apenasComAcao || node.texto_recomendacao.trim().length > 0);

  // Um nó aparece se ele mesmo casa com o filtro OU algum descendente casa (pra manter contexto
  // hierárquico visível — filtrar só criativos não deve esconder a campanha-pai).
  function subtreeMatches(n: TreeNode): boolean {
    const own = (filtroNivel === 'todos' || n.nivel === filtroNivel) &&
      (!filtroCategoria || categoriaDoNode(n) === filtroCategoria) &&
      (!apenasComAcao || n.texto_recomendacao.trim().length > 0);
    if (own) return true;
    return (n.filhos as TreeNode[]).some(subtreeMatches);
  }
  if (!subtreeMatches(node)) return null;

  const metricaCusto = node.metricas_chave.find((m) => /custo|cpl|cpa/i.test(m.rotulo));
  const metricaResultado = node.metricas_chave.find((m) => m.rotulo !== 'Gasto' && m !== metricaCusto);
  const gasto = node.metricas_chave.find((m) => m.rotulo === 'Gasto');

  return (
    <div>
      <div
        className={cn(
          'flex cursor-pointer items-center gap-2 border-b border-border/60 py-2 pr-2 hover:bg-surface-soft',
          selectedId === node.rec_id && 'bg-primary/5',
          nodeToneClass(node),
        )}
        style={{ paddingLeft: 8 + depth * 20 }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="shrink-0 text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="w-3.5 shrink-0" />}
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', sev.dot)} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={node.objeto_nome}>
          {node.nivel !== 'campaign' && <span className="mr-1 text-[10px] font-semibold uppercase text-muted-foreground">{NIVEL_LABEL[node.nivel]}</span>}
          {node.objeto_nome}
        </span>
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{gasto?.valor ?? '—'}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{metricaResultado?.valor ?? '—'}</span>
        <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{metricaCusto?.valor ?? '—'}</span>
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold', CATEGORIA_META[cat].tone)}>
          {CATEGORIA_META[cat].label}
        </span>
      </div>
      {open && hasChildren && (
        <div>
          {(node.filhos as TreeNode[]).map((child) => (
            <TreeNodeRow key={child.rec_id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect}
              filtroNivel={filtroNivel} filtroCategoria={filtroCategoria} apenasComAcao={apenasComAcao} />
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignTree({ nodes, selectedId, onSelect, filtroNivel, filtroCategoria, apenasComAcao }: {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (n: TreeNode) => void;
  filtroNivel: NivelFiltro;
  filtroCategoria: Categoria | null;
  apenasComAcao: boolean;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border p-3 text-xs font-semibold text-muted-foreground">
        <Layers className="h-3.5 w-3.5" /> Árvore de campanhas
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {nodes.map((n) => (
          <TreeNodeRow key={n.rec_id} node={n} depth={0} selectedId={selectedId} onSelect={onSelect}
            filtroNivel={filtroNivel} filtroCategoria={filtroCategoria} apenasComAcao={apenasComAcao} />
        ))}
        {nodes.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nenhuma campanha nesta análise.</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observação manual
// ---------------------------------------------------------------------------
function ManualNotesBox({ clienteId, nivel, objetoId, objetoNome }: {
  clienteId: string;
  nivel: string;
  objetoId: string | null;
  objetoNome: string | null;
}) {
  const [notes, setNotes] = useState<ManualNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const session = getAuthSession();

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/otimizador/notes?clientId=${encodeURIComponent(clienteId)}`);
      if (res.ok) {
        const data = await res.json() as { notes: ManualNote[] };
        setNotes(data.notes.filter((n) => n.nivel === nivel && (n.objeto_id ?? null) === objetoId));
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [clienteId, nivel, objetoId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const t = text.trim();
    if (!t) return;
    setSaving(true);
    try {
      await fetch('/api/otimizador/notes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: clienteId, nivel, objeto_id: objetoId, objeto_nome: objetoNome,
          texto: t, autor_id: session?.userId, autor_nome: session?.name,
        }),
      });
      setText('');
      await load();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await fetch(`/api/otimizador/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  return (
    <div className="space-y-2 rounded-[var(--radius)] border border-border bg-background p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <MessageSquarePlus className="h-3.5 w-3.5" /> Observação manual
      </p>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma observação registrada. Sabe algo que a IA não sabe? Registre aqui.</p>
      ) : (
        <ul className="space-y-1.5">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 rounded border border-border/60 bg-card p-2 text-xs">
              <span className="flex-1 text-foreground">{n.texto}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {n.autor_nome ?? 'Alguém'} · {new Date(n.created_at).toLocaleDateString('pt-BR')}
              </span>
              <button onClick={() => remove(n.id)} className="shrink-0 text-muted-foreground hover:text-red-400"><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <textarea
          rows={2}
          maxLength={500}
          placeholder='ex: "Cliente pediu para manter essa campanha ativa"'
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full resize-none rounded border border-border bg-card px-2 py-1.5 pr-9 text-xs text-foreground outline-none focus:border-primary"
        />
        <DictateButton className="absolute bottom-1.5 right-1.5 h-6 w-6" onTranscript={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
      </div>
      <Button type="button" size="sm" variant="outline" onClick={save} disabled={saving || !text.trim()}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        Adicionar observação
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel lateral de detalhe
// ---------------------------------------------------------------------------
function DetailPanel({ node, allNodes, busy, onApply, onIgnore, onHuman, onJump }: {
  node: TreeNode;
  allNodes: TreeNode[];
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

  useEffect(() => {
    setWhy(false); setEditing(false); setBatchOn(false);
    setBudget(String(node.acao_estruturada?.parametros?.novo_orcamento_diario ?? ''));
  }, [node.rec_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sev = SEV[node.severidade];
  const cat = categoriaDoNode(node);
  const lowConf = !node.aplicavel || node.confianca === 'baixa';
  const emAnalise = node.status === 'em_analise_humana';
  const isAjuste = node.acao_estruturada?.tipo === 'AJUSTAR_ORCAMENTO';
  const link = adManagerUrl(node);
  const verbo = node.acao_estruturada ? (VERBO_ACAO[node.acao_estruturada.tipo] ?? 'Aplicar agora') : 'Aplicar agora';
  const semAcao = !node.texto_recomendacao.trim();

  const samePadrao = node.padrao
    ? allNodes.filter((r) => r.padrao === node.padrao && r.cliente_id !== node.cliente_id && r.aplicavel && r.rec_id !== node.rec_id)
    : [];
  const depRec = node.depende_de ? allNodes.find((r) => r.rec_id === node.depende_de) ?? null : null;

  function handleApply() {
    if (isAjuste && !budget.trim()) { setEditing(true); return; }
    const params: { novo_orcamento_diario?: number } = {};
    if (isAjuste && budget.trim()) params.novo_orcamento_diario = Number(budget);
    onApply(node, params, batchOn ? samePadrao : []);
  }

  return (
    <div className="sticky top-4 space-y-3 rounded-[var(--radius)] border border-border bg-card">
      <div className="relative overflow-hidden rounded-t-[var(--radius)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: node.severidade === 'urgente' ? '#f87171' : node.severidade === 'atencao' ? '#fbbf24' : '#34d399' }} />
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-bold uppercase tracking-wide">{NIVEL_LABEL[node.nivel]}</span>
            {node.objetivo && <span className="truncate">Objetivo: {node.objetivo}</span>}
          </div>
          <span className={cn('shrink-0 rounded border px-2 py-1 text-[11px] font-bold uppercase tracking-wide', sev.badge)}>{sev.label}</span>
        </div>
      </div>

      <div className="space-y-4 px-4 pb-4">
        <div className="text-xs text-muted-foreground" title={[node.campanha_nome, node.nivel !== 'campaign' ? node.conjunto_nome : null, node.nivel === 'ad' ? node.objeto_nome : null].filter(Boolean).join(' › ')}>
          <span className="font-medium text-foreground">{node.campanha_nome}</span>
          {node.nivel !== 'campaign' && node.conjunto_nome && <> › {node.conjunto_nome}</>}
          {node.nivel === 'ad' && <> › <span className="font-medium text-foreground">{node.objeto_nome}</span></>}
        </div>

        <p className="text-lg font-medium leading-snug text-foreground">{node.titulo}</p>

        {semAcao ? (
          <p className="text-sm text-muted-foreground">Sem diagnóstico específico neste nó — os números estão dentro do esperado.</p>
        ) : (
          <>
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">O que fazer agora</p>
              <p className="text-sm text-foreground">{node.texto_recomendacao}</p>
            </div>
            {node.motivos.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Por que isso importa</p>
                <div className="overflow-hidden rounded-[var(--radius)] border border-border">
                  {node.motivos.map((m, i) => (
                    <div key={i} className={cn('flex items-start gap-2.5 p-2.5', i < node.motivos.length - 1 && 'border-b border-border/60')}>
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                      <span className="text-sm leading-relaxed text-foreground">{m}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {emAnalise && (
          <div className="flex items-center gap-2 rounded-[var(--radius)] border border-secondary/30 bg-secondary/10 p-2.5 text-xs text-secondary">
            <UserRound className="h-3.5 w-3.5 shrink-0" /> Em análise humana{node.atribuido_a ? ` · ${node.atribuido_a}` : ''}
          </div>
        )}

        {editing && isAjuste && (
          <div className="flex items-end gap-2 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-3">
            <label className="flex-1 space-y-1">
              <span className="text-xs font-semibold text-muted-foreground">Novo orçamento diário (R$)</span>
              <input type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)}
                className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary" />
            </label>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Concluir</Button>
          </div>
        )}

        {!semAcao && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onIgnore(node)} disabled={busy} className="flex-1 sm:flex-none">
              <X className="h-4 w-4" /> Não fazer nada
            </Button>
            {lowConf ? (
              <Button onClick={() => onHuman(node)} disabled={busy || emAnalise} className="flex-1">
                <UserRound className="h-4 w-4" /> Enviar para um humano
              </Button>
            ) : (
              <Button onClick={handleApply} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {batchOn && samePadrao.length > 0 ? `Aplicar em ${samePadrao.length + 1} contas` : verbo}
              </Button>
            )}
          </div>
        )}

        {!semAcao && ((isAjuste && !lowConf) || (!lowConf && !emAnalise)) && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <span>
              {isAjuste && !lowConf && (
                <button onClick={() => setEditing((e) => !e)} className="font-medium text-primary hover:underline">Editar valor antes de aplicar</button>
              )}
            </span>
            {!lowConf && !emAnalise && (
              <button onClick={() => onHuman(node)} className="font-medium text-primary hover:underline">Enviar para um humano</button>
            )}
          </div>
        )}

        <div>
          <button onClick={() => setWhy((w) => !w)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {why ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Por que essa recomendação?
          </button>
          {why && (
            <div className="mt-2 space-y-3 rounded-[var(--radius)] border border-border bg-background p-3">
              <div className="space-y-1">
                {node.fatos.map((f, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">{f.rotulo}</span>
                    <span className="font-mono text-foreground">{f.valor}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-1 text-xs">
                  <span className="text-muted-foreground">Confiança da análise</span>
                  <span className="font-mono text-foreground">{node.confianca}</span>
                </div>
                {node.leitura && (
                  <p className="border-t border-border/60 pt-1.5 text-xs italic text-muted-foreground">{node.leitura}</p>
                )}
              </div>
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
              {samePadrao.length > 0 && !lowConf && (
                <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border border-border p-2.5 text-xs text-foreground">
                  <input type="checkbox" checked={batchOn} onChange={(e) => setBatchOn(e.target.checked)} className="mt-0.5 accent-primary" />
                  <span>Aplicar a mesma ação em <span className="font-semibold">{samePadrao.length}</span> outra(s) conta(s) com este mesmo padrão.</span>
                </label>
              )}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir no Gerenciador de Anúncios
                </a>
              )}
            </div>
          )}
        </div>

        <ManualNotesBox clienteId={node.cliente_id} nivel={node.nivel} objetoId={node.objeto_id} objetoNome={node.objeto_nome} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [contas, setContas] = useState<FilaConta[]>([]);
  const [contaFiltro, setContaFiltro] = useState('');
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [resumo, setResumo] = useState<ArvoreResumo | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [treeLoading, setTreeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoriaFiltro, setCategoriaFiltro] = useState<Categoria | null>(null);
  const [nivelFiltro, setNivelFiltro] = useState<NivelFiltro>('todos');
  const [apenasComAcao, setApenasComAcao] = useState(false);

  // Admin: análise manual
  const [runLoading, setRunLoading] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagResult, setDiagResult] = useState<ClientDiagnostic[] | null>(null);
  const [manualPeriod, setManualPeriod] = useState<OptimizerPeriodKey>('last_7d');
  const [configClientId, setConfigClientId] = useState<string | null>(null);

  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  async function loadOverview() {
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
        const data = await filaRes.json() as { contas: FilaConta[] };
        setContas(data.contas ?? []);
        setContaFiltro((prev) => prev || data.contas?.[0]?.cliente_id || '');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadTree(clientId: string) {
    if (!clientId) { setTreeNodes([]); setResumo(null); setGeneratedAt(null); return; }
    setTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=200`);
      if (!res.ok) {
        setTreeError(`Não foi possível carregar a árvore (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json() as { campanhas: TreeNode[]; resumo: ArvoreResumo | null; generated_at: string | null };
      setTreeNodes(data.campanhas ?? []);
      setResumo(data.resumo);
      setGeneratedAt(data.generated_at);
      setSelectedId(null);
    } catch {
      setTreeError('Falha de rede ao carregar a árvore.');
    } finally {
      setTreeLoading(false);
    }
  }

  useEffect(() => { void loadTree(contaFiltro); }, [contaFiltro]); // eslint-disable-line react-hooks/exhaustive-deps

  const flatNodes = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const selectedNode = useMemo(() => flatNodes.find((n) => n.rec_id === selectedId) ?? null, [flatNodes, selectedId]);

  function jumpTo(recId: string) {
    setSelectedId(recId);
  }

  const autor = { autor_id: session?.userId ?? undefined, autor_nome: session?.name ?? undefined };

  function removeFromTree(ids: string[], newStatus: string) {
    function walk(nodes: TreeNode[]): TreeNode[] {
      return nodes.map((n) => ids.includes(n.rec_id) ? { ...n, status: newStatus } : { ...n, filhos: walk(n.filhos as TreeNode[]) });
    }
    setTreeNodes((prev) => walk(prev));
  }

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
        removeFromTree(okIds.length ? okIds : [rec.rec_id], 'aplicado');
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
        removeFromTree([rec.rec_id], 'aplicado');
        const label = acao.tipo === 'PAUSAR' ? 'Pausado' : acao.tipo === 'ATIVAR' ? 'Ativado' : 'Orçamento ajustado';
        setToast({ text: `${label}. Você pode reverter agora.`, undo: data.pode_desfazer ? { rec_id: rec.rec_id, cliente_id: rec.cliente_id } : undefined });
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
      removeFromTree([rec.rec_id], 'ignorado');
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
      setTreeNodes((prev) => {
        function walk(nodes: TreeNode[]): TreeNode[] {
          return nodes.map((n) => n.rec_id === rec.rec_id ? { ...n, status: 'em_analise_humana' } : { ...n, filhos: walk(n.filhos as TreeNode[]) });
        }
        return walk(prev);
      });
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
    await loadTree(contaFiltro);
  }

  async function fetchAnalysisResumo(clientId: string): Promise<string> {
    try {
      const res = await fetch(`/api/otimizador/analisar?clientId=${encodeURIComponent(clientId)}&hours=2`);
      if (!res.ok) return '';
      const data = await res.json() as {
        items?: Array<{ erro?: string | null; resultado?: { analise_campanhas?: Array<{ acao?: string; conjuntos?: Array<{ acao?: string; anuncios?: Array<{ acao?: string }> }> }> } }>;
      };
      const item = data.items?.[0];
      const camps = item?.resultado?.analise_campanhas ?? [];
      if (camps.length === 0) return 'Atenção: a IA não recebeu nenhuma campanha nesta análise — provável falha ao puxar os dados.';
      if (item?.erro) return `⚠️ Análise com problema: ${item.erro} Os ${camps.length} objeto(s) analisados podem não refletir a conta real — rode de novo antes de confiar no resultado.`;
      let conj = 0, ad = 0, acoes = 0;
      for (const c of camps) {
        if (c.acao?.trim()) acoes++;
        for (const cj of c.conjuntos ?? []) {
          conj++;
          if (cj.acao?.trim()) acoes++;
          for (const a of cj.anuncios ?? []) { ad++; if (a.acao?.trim()) acoes++; }
        }
      }
      return `Analisou ${camps.length} campanha(s), ${conj} conjunto(s) e ${ad} anúncio(s) — ${acoes} com recomendação de ação.`;
    } catch {
      return '';
    }
  }

  async function pollForFreshResult(clientId: string, priorTime: number): Promise<boolean> {
    try {
      const res = await fetch(`/api/otimizador/arvore?clientId=${encodeURIComponent(clientId)}&hours=1`);
      if (!res.ok) return false;
      const data = await res.json() as { generated_at: string | null };
      return !!data.generated_at && new Date(data.generated_at).getTime() > priorTime;
    } catch {
      return false;
    }
  }

  async function runAnalysisNow() {
    if (!contaFiltro) return;
    setRunLoading(true);
    setRunMessage(null);
    const priorTime = generatedAt ? new Date(generatedAt).getTime() : 0;
    const clientName = contas.find((c) => c.cliente_id === contaFiltro)?.cliente_nome ?? 'esta conta';
    try {
      const params = new URLSearchParams({ period: manualPeriod, forceAi: '1', clientId: contaFiltro });
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
      const data = await res.json().catch(() => ({})) as { results?: Array<{ clientId: string; status: string; error?: string }> };
      const outcome = data.results?.find((r) => r.clientId === contaFiltro);
      if (outcome && outcome.status !== 'ok') {
        const motivo = outcome.status === 'sem_conexao_meta' ? 'conta sem conexão Meta vinculada'
          : outcome.status === 'sem_campanhas_ativas' ? 'nenhuma campanha ativa com gasto no período'
          : outcome.error || outcome.status;
        setRunMessage(`Análise de ${clientName} não gerou resultado: ${motivo}.`);
        return;
      }
      await pollForFreshResult(contaFiltro, priorTime);
      await loadTree(contaFiltro);
      const resumoTxt = await fetchAnalysisResumo(contaFiltro);
      setRunMessage(`Análise de ${clientName} concluída. ${resumoTxt}`.trim());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRunMessage(`Erro: ${msg || 'falha de rede'} (a análise pode ter estourado o tempo — tente novamente).`);
    } finally {
      setRunLoading(false);
    }
  }

  async function runDiagnostic() {
    if (!contaFiltro) return;
    setDiagLoading(true);
    setDiagResult(null);
    setRunMessage(null);
    try {
      const params = new URLSearchParams({ period: manualPeriod, dryRun: '1', clientId: contaFiltro });
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
  const temAnalise = !loading && !!contaFiltro && (treeNodes.length > 0 || !!resumo);

  return (
    <div className="space-y-5 p-4 sm:p-6">
      {configClientId && configClient && (
        <ConfigModal clientId={configClientId} clientName={configClient.name} onClose={() => setConfigClientId(null)} />
      )}
      <ConfirmToast toast={toast} onUndo={doUndo} onClose={() => setToast(null)} />

      {/* Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" /> Otimizador de Campanhas
          </div>
          <h1 className="mt-1 font-heading text-4xl text-foreground">Central de decisão</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Onde a verba está performando, onde está sendo desperdiçada e qual é a próxima melhor decisão.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountSelector contas={contas} value={contaFiltro} onChange={setContaFiltro} />
          {isAdmin && (
            <Button variant="outline" onClick={() => setConfigClientId(contaFiltro || null)} disabled={!contaFiltro}>
              <Settings2 className="h-4 w-4" /> Configurar
            </Button>
          )}
          <Button onClick={runAnalysisNow} disabled={runLoading || diagLoading || !contaFiltro}>
            {runLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {temAnalise ? 'Atualizar análise' : 'Fazer análise'}
          </Button>
        </div>
      </header>

      {/* Admin: período + diagnóstico técnico */}
      {isAdmin && (
        <section className="flex flex-wrap items-end gap-3 rounded-[var(--radius)] border border-primary/30 bg-primary/5 p-4">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Período</span>
            <select value={manualPeriod} onChange={(e) => setManualPeriod(e.target.value as OptimizerPeriodKey)} disabled={runLoading}
              className="h-10 rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary">
              {OPTIMIZER_PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          <Button variant="outline" onClick={runDiagnostic} disabled={runLoading || diagLoading || !contaFiltro} className="h-10"
            title="Mostra de onde vêm os dados desta conta — sem gastar tokens de IA">
            {diagLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Diagnosticar
          </Button>
          {runMessage && <p className="w-full text-xs font-medium text-primary">{runMessage}</p>}
          {diagResult && (
            <div className="mt-1 w-full space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">Diagnóstico de dados (sem IA · sem custo)</span>
                <button onClick={() => setDiagResult(null)} className="text-xs text-muted-foreground hover:text-foreground">fechar</button>
              </div>
              {diagResult.length === 0 && <p className="text-xs text-muted-foreground">Nenhum cliente para diagnosticar.</p>}
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

      {loading ? (
        <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando contas...
        </div>
      ) : !contaFiltro ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
          <CalendarClock className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold text-foreground">Nenhuma conta com análise ainda</p>
          <p className="text-sm text-muted-foreground">Selecione um cliente para rodar a primeira análise.</p>
        </div>
      ) : (
        <>
          <AccountSummaryHeader resumo={resumo} generatedAt={generatedAt} proximaAnalise={null} />

          {treeLoading ? (
            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando análise...
            </div>
          ) : treeError ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 p-6 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{treeError}</p>
            </div>
          ) : flatNodes.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <BadgeCheck className="h-8 w-8 text-primary" />
              <p className="font-semibold text-foreground">Nenhuma análise ainda para este cliente</p>
              <p className="max-w-md text-sm text-muted-foreground">Clique em <span className="font-semibold text-foreground">Fazer análise</span> para gerar o primeiro diagnóstico.</p>
            </div>
          ) : (
            <>
              <QuickDecisionCards nodes={flatNodes} active={categoriaFiltro} onSelect={setCategoriaFiltro} />
              <FilterChips nivel={nivelFiltro} onNivel={setNivelFiltro} apenasComAcao={apenasComAcao} onApenasComAcao={setApenasComAcao} />
              <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
                <CampaignTree
                  nodes={treeNodes}
                  selectedId={selectedId}
                  onSelect={(n) => setSelectedId(n.rec_id)}
                  filtroNivel={nivelFiltro}
                  filtroCategoria={categoriaFiltro}
                  apenasComAcao={apenasComAcao}
                />
                {selectedNode ? (
                  <DetailPanel node={selectedNode} allNodes={flatNodes} busy={busy} onApply={doApply} onIgnore={doIgnore} onHuman={doHuman} onJump={jumpTo} />
                ) : (
                  <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border p-6 text-center">
                    <MousePointerClick className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Clique em uma campanha, conjunto ou criativo na árvore para ver o diagnóstico completo.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
