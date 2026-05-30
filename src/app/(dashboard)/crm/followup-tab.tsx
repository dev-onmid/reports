"use client";

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Pencil, Trash2, X, ChevronDown, ChevronRight,
  ToggleLeft, ToggleRight, Clock, MessageSquare, Zap,
  ArrowRight, AlertCircle, CheckCircle2, Timer, Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type Regra = {
  id: string;
  nome: string;
  status_gatilho: string;
  ativo: boolean;
  created_at: string;
  total_mensagens: number;
};

type Mensagem = {
  id: string;
  ordem: number;
  tipo: 'texto' | 'imagem' | 'audio' | 'video' | 'documento';
  conteudo: string;
  delay_minutos: number;
  timer_sem_resposta_horas: number;
  acao_sem_resposta: 'mover_status' | 'proxima_mensagem';
  status_destino: string | null;
};

type Execucao = {
  id: string;
  lead_id: string;
  lead_nome: string | null;
  lead_numero: string | null;
  regra_nome: string;
  msg_tipo: string;
  msg_conteudo: string;
  msg_ordem: number;
  status: 'aguardando_envio' | 'aguardando_resposta' | 'respondido' | 'expirado' | 'cancelado';
  scheduled_at: string;
  enviado_em: string | null;
  expira_em: string | null;
  respondido_em: string | null;
};

const TIPO_OPTIONS = [
  { value: 'texto',     label: 'Texto' },
  { value: 'imagem',    label: 'Imagem' },
  { value: 'audio',     label: 'Áudio (voz)' },
  { value: 'video',     label: 'Vídeo' },
  { value: 'documento', label: 'Documento' },
] as const;

const ACAO_OPTIONS = [
  { value: 'mover_status',      label: 'Mover para outro status' },
  { value: 'proxima_mensagem',  label: 'Enviar próxima mensagem' },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);
  const prefix = diff < 0 ? 'em ' : 'há ';
  if (mins < 1)   return diff < 0 ? 'agora' : 'agora';
  if (hours < 1)  return `${prefix}${mins}min`;
  if (days < 1)   return `${prefix}${hours}h`;
  return `${prefix}${days}d`;
}

const STATUS_BADGE: Record<string, string> = {
  aguardando_envio:     'bg-amber-500/15 text-amber-400',
  aguardando_resposta:  'bg-blue-500/15 text-blue-400',
  respondido:           'bg-emerald-500/15 text-emerald-400',
  expirado:             'bg-red-500/15 text-red-400',
  cancelado:            'bg-zinc-500/15 text-zinc-400',
};

const STATUS_LABEL: Record<string, string> = {
  aguardando_envio:    'Aguardando envio',
  aguardando_resposta: 'Aguardando resposta',
  respondido:          'Respondido',
  expirado:            'Expirado',
  cancelado:           'Cancelado',
};

// ── Message editor modal ──────────────────────────────────────────────────────

function MensagemModal({
  initial,
  statusOptions,
  onSave,
  onClose,
}: {
  initial: Partial<Mensagem> | null;
  statusOptions: string[];
  onSave: (data: Omit<Mensagem, 'id' | 'ordem'>) => Promise<void>;
  onClose: () => void;
}) {
  const [tipo,    setTipo]    = useState<Mensagem['tipo']>(initial?.tipo ?? 'texto');
  const [conteudo, setConteudo] = useState(initial?.conteudo ?? '');
  const [delayMin, setDelayMin] = useState(String(initial?.delay_minutos ?? 0));
  const [timerH,  setTimerH]  = useState(String(initial?.timer_sem_resposta_horas ?? 24));
  const [acao,    setAcao]    = useState<Mensagem['acao_sem_resposta']>(initial?.acao_sem_resposta ?? 'mover_status');
  const [destino, setDestino] = useState(initial?.status_destino ?? '');
  const [saving,  setSaving]  = useState(false);

  async function handleSave() {
    if (!conteudo.trim()) return;
    setSaving(true);
    await onSave({
      tipo,
      conteudo: conteudo.trim(),
      delay_minutos: Math.max(0, parseInt(delayMin) || 0),
      timer_sem_resposta_horas: Math.max(0.5, parseFloat(timerH) || 24),
      acao_sem_resposta: acao,
      status_destino: acao === 'mover_status' ? (destino || null) : null,
    });
    setSaving(false);
  }

  const isMedia = tipo !== 'texto';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-bold">{initial?.id ? 'Editar mensagem' : 'Nova mensagem'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Tipo */}
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tipo</span>
            <select value={tipo} onChange={e => setTipo(e.target.value as Mensagem['tipo'])}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none">
              {TIPO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>

          {/* Conteúdo */}
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {isMedia ? 'URL do arquivo' : 'Mensagem'}
            </span>
            {isMedia ? (
              <input value={conteudo} onChange={e => setConteudo(e.target.value)} placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            ) : (
              <>
                <textarea value={conteudo} onChange={e => setConteudo(e.target.value)} rows={4}
                  placeholder="Olá {{nome}}, tudo bem? Gostaria de saber se tem alguma dúvida..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
                <p className="text-[10px] text-muted-foreground">
                  Variáveis: <code className="bg-muted px-1 rounded">{'{{nome}}'}</code> <code className="bg-muted px-1 rounded">{'{{telefone}}'}</code> <code className="bg-muted px-1 rounded">{'{{status}}'}</code> <code className="bg-muted px-1 rounded">{'{{campanha}}'}</code>
                </p>
              </>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            {/* Delay */}
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Delay antes de enviar (min)</span>
              <input type="number" min="0" value={delayMin} onChange={e => setDelayMin(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
            {/* Timer */}
            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Timer sem resposta (horas)</span>
              <input type="number" min="0.5" step="0.5" value={timerH} onChange={e => setTimerH(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            </label>
          </div>

          {/* Ação ao expirar */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ação se não responder</span>
            <div className="space-y-1.5">
              {ACAO_OPTIONS.map(o => (
                <label key={o.value} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="radio" value={o.value} checked={acao === o.value} onChange={() => setAcao(o.value as Mensagem['acao_sem_resposta'])}
                    className="accent-primary" />
                  <span className="text-sm">{o.label}</span>
                </label>
              ))}
            </div>
            {acao === 'mover_status' && (
              <select value={destino} onChange={e => setDestino(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none mt-1">
                <option value="">— Selecionar status destino —</option>
                {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
          <button onClick={handleSave} disabled={saving || !conteudo.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule detail (message sequence) ───────────────────────────────────────────

function RegraDetail({
  regra, clientId, statusOptions, onBack,
}: {
  regra: Regra;
  clientId: string;
  statusOptions: string[];
  onBack: () => void;
}) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState<Mensagem | null | 'new'>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/regras/${regra.id}/mensagens`)
      .then(r => r.ok ? r.json() as Promise<Mensagem[]> : [])
      .then(d => { setMensagens(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [regra.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(data: Omit<Mensagem, 'id' | 'ordem'>) {
    if (editing === 'new') {
      await fetch(`/api/crm/followup/regras/${regra.id}/mensagens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, clientId }),
      });
    } else if (editing && editing !== 'new') {
      await fetch(`/api/crm/followup/mensagens/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
    setEditing(null);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover esta mensagem?')) return;
    await fetch(`/api/crm/followup/mensagens/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground text-xs font-semibold flex items-center gap-1">
          ← Voltar
        </button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-bold">{regra.nome}</span>
        <span className="ml-1 text-xs text-muted-foreground">Gatilho: <strong>{regra.status_gatilho}</strong></span>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Carregando mensagens…</div>
      ) : (
        <div className="space-y-2">
          {mensagens.map((msg, i) => (
            <div key={msg.id} className="rounded-xl border border-border bg-card p-4 flex gap-4 items-start">
              {/* Step indicator */}
              <div className="flex flex-col items-center shrink-0">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                  {msg.ordem}
                </div>
                {i < mensagens.length - 1 && <div className="w-px flex-1 bg-border mt-1 min-h-4" />}
              </div>

              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase">
                    {TIPO_OPTIONS.find(t => t.value === msg.tipo)?.label ?? msg.tipo}
                  </span>
                  {msg.delay_minutos > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-3 w-3" /> {msg.delay_minutos >= 60 ? `${(msg.delay_minutos/60).toFixed(1)}h delay` : `${msg.delay_minutos}min delay`}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Timer className="h-3 w-3" /> timer {msg.timer_sem_resposta_horas}h
                  </span>
                </div>

                <p className="text-sm text-foreground line-clamp-2 break-all">
                  {msg.tipo === 'texto' ? msg.conteudo : `URL: ${msg.conteudo}`}
                </p>

                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  {msg.acao_sem_resposta === 'mover_status'
                    ? `Mover para "${msg.status_destino ?? '—'}"`
                    : 'Enviar próxima mensagem'}
                </div>
              </div>

              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(msg)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(msg.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}

          {mensagens.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/5 p-8 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
              <p className="text-xs text-muted-foreground">Adicione a primeira mensagem da cadência.</p>
            </div>
          )}

          <button onClick={() => setEditing('new')}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 py-3 text-sm font-semibold text-primary hover:bg-primary/5 transition-colors">
            <Plus className="h-4 w-4" /> Adicionar mensagem
          </button>
        </div>
      )}

      {editing !== null && (
        <MensagemModal
          initial={editing === 'new' ? null : editing}
          statusOptions={statusOptions}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Executions monitor ────────────────────────────────────────────────────────

function ExecucoesView({ clientId, onProcess, processing }: { clientId: string; onProcess: () => void; processing: boolean }) {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/execucoes?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Execucao[]> : [])
      .then(d => { setExecucoes(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function handleCancel(id: string) {
    await fetch(`/api/crm/followup/execucoes/${id}/cancelar`, { method: 'POST' });
    load();
  }

  const visible = filter
    ? execucoes.filter(e => e.status === filter)
    : execucoes;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'aguardando_envio', 'aguardando_resposta', 'respondido', 'expirado', 'cancelado'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
              filter === s ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
            {s === '' ? 'Todos' : STATUS_LABEL[s]}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs font-semibold text-muted-foreground hover:text-foreground">↻ Atualizar</button>
        <button onClick={onProcess} disabled={processing}
          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
          {processing ? '…' : '▶ Processar agora'}
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Carregando…</div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma execução encontrada.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/30">
              <tr>
                {['Lead', 'Regra', 'Mensagem', 'Status', 'Enviado', 'Expira', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(e => (
                <tr key={e.id} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5">
                    <p className="font-semibold">{e.lead_nome ?? '—'}</p>
                    <p className="text-muted-foreground">{e.lead_numero}</p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{e.regra_nome}</td>
                  <td className="px-3 py-2.5 max-w-[160px]">
                    <p className="text-muted-foreground text-[10px]">#{e.msg_ordem} {e.msg_tipo}</p>
                    <p className="truncate">{e.msg_conteudo.slice(0, 40)}{e.msg_conteudo.length > 40 ? '…' : ''}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', STATUS_BADGE[e.status] ?? 'bg-zinc-500/15 text-zinc-400')}>
                      {STATUS_LABEL[e.status] ?? e.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{relativeTime(e.enviado_em)}</td>
                  <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">{relativeTime(e.expira_em)}</td>
                  <td className="px-3 py-2.5">
                    {(e.status === 'aguardando_envio' || e.status === 'aguardando_resposta') && (
                      <button onClick={() => handleCancel(e.id)}
                        className="rounded border border-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors">
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main FollowupTab ──────────────────────────────────────────────────────────

export function FollowupTab({
  clientId,
  statusOptions,
}: {
  clientId: string;
  statusOptions: string[];
}) {
  const [regras,     setRegras]     = useState<Regra[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view,       setView]       = useState<'regras' | 'execucoes'>('regras');
  const [showNew,    setShowNew]    = useState(false);
  const [processing, setProcessing] = useState(false);

  // New rule form
  const [newNome,    setNewNome]    = useState('');
  const [newGatilho, setNewGatilho] = useState('');
  const [creating,   setCreating]   = useState(false);

  const loadRegras = useCallback(() => {
    setLoading(true);
    fetch(`/api/crm/followup/regras?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Regra[]> : [])
      .then(d => { setRegras(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { loadRegras(); }, [loadRegras]);

  async function handleToggle(regra: Regra) {
    await fetch(`/api/crm/followup/regras/${regra.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !regra.ativo }),
    });
    loadRegras();
  }

  async function handleDelete(id: string) {
    if (!confirm('Excluir esta regra de follow up? Todos os dados serão perdidos.')) return;
    await fetch(`/api/crm/followup/regras/${id}`, { method: 'DELETE' });
    if (selectedId === id) setSelectedId(null);
    loadRegras();
  }

  async function handleProcessNow() {
    setProcessing(true);
    await fetch('/api/crm/followup/processar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId }),
    }).catch(() => null);
    setProcessing(false);
  }

  async function handleCreate() {
    if (!newNome.trim() || !newGatilho.trim()) return;
    setCreating(true);
    const res = await fetch('/api/crm/followup/regras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, nome: newNome.trim(), status_gatilho: newGatilho.trim() }),
    });
    if (res.ok) {
      const regra = await res.json() as Regra;
      setNewNome('');
      setNewGatilho('');
      setShowNew(false);
      loadRegras();
      setSelectedId(regra.id);
    }
    setCreating(false);
  }

  const selectedRegra = regras.find(r => r.id === selectedId) ?? null;

  if (selectedRegra) {
    return (
      <RegraDetail
        regra={selectedRegra}
        clientId={clientId}
        statusOptions={statusOptions}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Tab switch */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {([['regras', 'Regras'], ['execucoes', 'Monitoramento']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={cn('px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors',
              view === v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {view === 'execucoes' ? (
        <ExecucoesView clientId={clientId} onProcess={handleProcessNow} processing={processing} />
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {regras.length} regra{regras.length !== 1 ? 's' : ''} configurada{regras.length !== 1 ? 's' : ''}
            </p>
            <button onClick={() => setShowNew(v => !v)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" /> Nova regra
            </button>
          </div>

          {/* New rule form */}
          {showNew && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-xs font-bold text-primary">Nova regra de follow up</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Nome da regra</span>
                  <input value={newNome} onChange={e => setNewNome(e.target.value)} placeholder="Ex: Follow up proposta"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status gatilho</span>
                  <select value={newGatilho} onChange={e => setNewGatilho(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary appearance-none">
                    <option value="">— Selecionar —</option>
                    {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowNew(false)} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">Cancelar</button>
                <button onClick={handleCreate} disabled={creating || !newNome.trim() || !newGatilho.trim()}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  {creating ? 'Criando…' : 'Criar regra'}
                </button>
              </div>
            </div>
          )}

          {/* Rule list */}
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">Carregando…</div>
          ) : regras.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <Zap className="h-9 w-9 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-semibold text-muted-foreground">Nenhuma regra ainda</p>
              <p className="text-xs text-muted-foreground mt-1">Crie uma regra para disparar mensagens automáticas quando um lead muda de status.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {regras.map(regra => (
                <div key={regra.id}
                  className={cn('group rounded-xl border bg-card p-4 transition-all hover:border-primary/30', regra.ativo ? 'border-border' : 'border-border/50 opacity-60')}>
                  <div className="flex items-center gap-3">
                    {/* Toggle */}
                    <button onClick={() => handleToggle(regra)} title={regra.ativo ? 'Desativar' : 'Ativar'}
                      className="shrink-0 transition-colors">
                      {regra.ativo
                        ? <ToggleRight className="h-5 w-5 text-primary" />
                        : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />}
                    </button>

                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelectedId(regra.id)}>
                      <p className="text-sm font-bold truncate">{regra.nome}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-muted-foreground">Gatilho:</span>
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{regra.status_gatilho}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {regra.total_mensagens} mensagem{regra.total_mensagens !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => setSelectedId(regra.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(regra.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Active follow-up badge (for kanban / list) ────────────────────────────────

export function useActiveFollowups(clientId: string, enabled: boolean) {
  const [activeLeadIds, setActiveLeadIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!clientId || !enabled) return;
    fetch(`/api/crm/followup/execucoes?clientId=${clientId}`)
      .then(r => r.ok ? r.json() as Promise<Execucao[]> : [])
      .then(data => {
        const ids = new Set(
          data
            .filter(e => e.status === 'aguardando_envio' || e.status === 'aguardando_resposta')
            .map(e => e.lead_id),
        );
        setActiveLeadIds(ids);
      })
      .catch(() => {});
  }, [clientId, enabled]);

  return activeLeadIds;
}

export function FollowupBadge({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold text-blue-400">
      <Send className="h-2.5 w-2.5" /> follow up
    </span>
  );
}
