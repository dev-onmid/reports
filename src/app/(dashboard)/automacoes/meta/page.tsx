"use client";

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Check, RefreshCw, AlertCircle,
  CheckCircle2, MinusCircle, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Copy, MessageCircle,
  MessageSquare, Zap, Info, Search, ArrowDownAZ, ArrowUpAZ, X,
} from 'lucide-react';

type Automation = {
  id: string;
  client_id: string | null;
  account_id: string;
  account_name: string | null;
  platform: 'instagram' | 'facebook';
  trigger_type: string;
  keyword: string | null;
  action: string;
  reply_message: string;
  dm_message: string | null;
  enabled: boolean;
  created_at: string;
};

type Log = {
  id: string;
  automation_id: string;
  platform: string;
  event_type: string;
  account_id: string;
  sender_id: string;
  trigger_text: string;
  action_taken: string;
  status: 'success' | 'error' | 'ignored';
  error_msg: string | null;
  triggered_at: string;
  account_name: string | null;
  trigger_type: string | null;
  keyword: string | null;
};

const TRIGGER_LABELS: Record<string, string> = {
  any_comment:     'Qualquer comentário',
  keyword_comment: 'Comentário com palavra-chave',
  any_dm:          'Qualquer DM recebida',
  keyword_dm:      'DM com palavra-chave',
};

const ACTION_LABELS: Record<string, string> = {
  reply_comment: 'Responder comentário',
  send_dm:       'Enviar DM',
  reply_and_dm:  'Responder comentário + Enviar DM',
};

const BASE = typeof window !== 'undefined' ? window.location.origin : 'https://reports.onmid.app';

type Client = { id: string; name: string; segment: string; status: string };

type ClientPage = {
  platform: 'instagram' | 'facebook';
  account_id: string;
  account_name: string;
  picture_url: string | null;
};

const EMPTY_FORM = {
  account_id: '', account_name: '', platform: 'instagram' as 'instagram' | 'facebook',
  trigger_type: 'any_comment', keyword: '',
  action: 'reply_comment', reply_message: '', dm_message: '',
};

export default function MetaAutomacoesPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [verifyToken, setVerifyToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'rules' | 'logs' | 'setup'>('rules');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    configured: boolean;
    last_event_at: string | null;
    last_platform: string | null;
    last_event_type: string | null;
    last_status: string | null;
    events_today: number;
    events_week: number;
    errors_today: number;
  } | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'error' | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientSort, setClientSort] = useState<'asc' | 'desc'>('asc');
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientPages, setClientPages] = useState<ClientPage[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const clientPickerRef = useRef<HTMLDivElement>(null);

  async function loadWebhookStatus() {
    const res = await fetch('/api/meta/webhook/status');
    if (res.ok) setWebhookStatus(await res.json());
  }

  async function testWebhook() {
    if (!verifyToken) return;
    setTestingWebhook(true);
    setTestResult(null);
    try {
      const url = `/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=ping123`;
      const res = await fetch(url);
      const text = await res.text();
      setTestResult(res.ok && text === 'ping123' ? 'ok' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTestingWebhook(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  }

  async function loadClients() {
    const res = await fetch('/api/clients');
    if (res.ok) setClients(await res.json());
  }

  async function loadClientPages(clientId: string) {
    setLoadingPages(true);
    setClientPages([]);
    setForm(f => ({ ...f, account_id: '', account_name: '', platform: 'instagram' }));
    try {
      const res = await fetch(`/api/meta/client-pages?clientId=${clientId}`);
      if (res.ok) setClientPages(await res.json());
    } finally {
      setLoadingPages(false);
    }
  }

  async function load() {
    setLoading(true);
    const [aRes, lRes] = await Promise.all([
      fetch('/api/meta/automations'),
      fetch('/api/meta/automations/logs'),
    ]);
    if (aRes.ok) {
      const j = await aRes.json() as { automations: Automation[]; verifyToken: string | null };
      setAutomations(j.automations ?? []);
      setVerifyToken(j.verifyToken ?? '');
    }
    if (lRes.ok) setLogs(await lRes.json());
    setLoading(false);
  }

  useEffect(() => {
    void load();
    void loadClients();
    void loadWebhookStatus();
  }, []);

  async function create() {
    if (!form.account_id || !form.reply_message) return;
    setSaving(true);
    const res = await fetch('/api/meta/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        client_id: selectedClient?.id ?? null,
        keyword: form.keyword || null,
        dm_message: form.dm_message || null,
      }),
    });
    if (res.ok) {
      const row = await res.json() as Automation;
      setAutomations(prev => [row, ...prev]);
      setForm({ ...EMPTY_FORM });
      setSelectedClient(null);
      setClientPages([]);
      setShowForm(false);
    }
    setSaving(false);
  }

  async function toggle(auto: Automation) {
    await fetch(`/api/meta/automations/${auto.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !auto.enabled }),
    });
    setAutomations(prev => prev.map(a => a.id === auto.id ? { ...a, enabled: !a.enabled } : a));
  }

  async function remove(id: string) {
    if (!confirm('Excluir esta automação?')) return;
    await fetch(`/api/meta/automations/${id}`, { method: 'DELETE' });
    setAutomations(prev => prev.filter(a => a.id !== id));
  }

  function copyToken() {
    void navigator.clipboard.writeText(verifyToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const needsKeyword = form.trigger_type === 'keyword_comment' || form.trigger_type === 'keyword_dm';
  const needsDmMessage = form.action === 'reply_and_dm';

  function clientInitials(name: string) {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  function clientColor(name: string) {
    const colors = ['bg-violet-500', 'bg-pink-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500'];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return colors[h % colors.length];
  }

  const filteredClients = clients
    .filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
    .sort((a, b) => clientSort === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));

  const statusIcon = (s: Log['status']) => {
    if (s === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    if (s === 'error')   return <AlertCircle  className="h-3.5 w-3.5 text-rose-500 shrink-0" />;
    return <MinusCircle className="h-3.5 w-3.5 text-zinc-400 shrink-0" />;
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Automações Meta</h1>
            <p className="text-sm text-muted-foreground">Respostas automáticas a comentários e DMs do Instagram e Facebook.</p>
          </div>
        </div>
        <button type="button" onClick={load} className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['rules', 'logs', 'setup'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}>
            {t === 'rules' ? 'Regras' : t === 'logs' ? 'Logs' : 'Configuração'}
          </button>
        ))}
      </div>

      {/* ── Rules tab ── */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" onClick={() => setShowForm(v => !v)}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" />
              Nova Automação
            </button>
          </div>

          {/* Create form */}
          {showForm && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground">Nova automação</p>

              {/* Step 1 — pick client */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Cliente</label>
                <div className="relative" ref={clientPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowClientPicker(v => !v)}
                    className="w-full flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-left hover:border-primary/50 transition-colors"
                  >
                    {selectedClient ? (
                      <>
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0', clientColor(selectedClient.name))}>
                          {clientInitials(selectedClient.name)}
                        </span>
                        <span className="flex-1 truncate">{selectedClient.name}</span>
                        <button type="button" onClick={e => { e.stopPropagation(); setSelectedClient(null); setClientPages([]); setForm(f => ({ ...f, account_id: '', account_name: '', platform: 'instagram' })); }}>
                          <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                      </>
                    ) : (
                      <span className="text-muted-foreground flex-1">Selecione um cliente...</span>
                    )}
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>

                  {showClientPicker && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-xl">
                      {/* Search + sort */}
                      <div className="flex items-center gap-2 p-2 border-b border-border">
                        <div className="relative flex-1">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            autoFocus
                            value={clientSearch}
                            onChange={e => setClientSearch(e.target.value)}
                            placeholder="Buscar cliente..."
                            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setClientSort(s => s === 'asc' ? 'desc' : 'asc')}
                          title={clientSort === 'asc' ? 'A→Z' : 'Z→A'}
                          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        >
                          {clientSort === 'asc' ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowUpAZ className="h-4 w-4" />}
                        </button>
                      </div>

                      {/* List */}
                      <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
                        {filteredClients.length === 0 ? (
                          <p className="py-4 text-center text-xs text-muted-foreground">Nenhum cliente encontrado</p>
                        ) : filteredClients.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedClient(c);
                              setShowClientPicker(false);
                              setClientSearch('');
                              void loadClientPages(c.id);
                            }}
                            className={cn(
                              'w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-left hover:bg-primary/10 transition-colors',
                              selectedClient?.id === c.id && 'bg-primary/10 text-primary'
                            )}
                          >
                            <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white shrink-0', clientColor(c.name))}>
                              {clientInitials(c.name)}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{c.name}</p>
                              {c.segment && <p className="text-[11px] text-muted-foreground truncate">{c.segment}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 2 — pick platform account */}
              {selectedClient && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Conta do cliente</label>
                  {loadingPages ? (
                    <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Buscando páginas vinculadas...
                    </div>
                  ) : clientPages.length > 0 ? (
                    <div className="space-y-3">
                      {(['instagram', 'facebook'] as const).map(plat => {
                        const group = clientPages.filter(p => p.platform === plat);
                        if (!group.length) return null;
                        return (
                          <div key={plat} className="space-y-1.5">
                            <p className={cn('text-[11px] font-semibold uppercase tracking-wider',
                              plat === 'instagram' ? 'text-pink-400' : 'text-blue-400'
                            )}>{plat === 'instagram' ? 'Instagram' : 'Facebook'}</p>
                            {group.map(pg => {
                              const isSelected = form.account_id === pg.account_id && form.platform === pg.platform;
                              return (
                                <button
                                  key={`${pg.platform}::${pg.account_id}`}
                                  type="button"
                                  onClick={() => setForm(f => ({ ...f, account_id: pg.account_id, account_name: pg.account_name, platform: pg.platform }))}
                                  className={cn(
                                    'w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm text-left transition-all',
                                    isSelected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-card/60'
                                  )}
                                >
                                  {pg.picture_url ? (
                                    <img src={pg.picture_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0 border border-border" />
                                  ) : (
                                    <span className={cn('flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0',
                                      pg.platform === 'instagram' ? 'bg-gradient-to-br from-fuchsia-500 to-pink-500' : 'bg-blue-600'
                                    )}>
                                      {pg.account_name.slice(0, 2).toUpperCase()}
                                    </span>
                                  )}
                                  <span className={cn('flex-1 truncate font-medium', isSelected && 'text-primary')}>{pg.account_name}</span>
                                  {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                      Nenhuma página Meta encontrada para este cliente. Verifique se a conta de anúncios está vinculada em{' '}
                      <a href={`/clientes/${selectedClient.id}`} className="text-primary underline">Clientes → Integrações</a>.
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Gatilho</label>
                  <select value={form.trigger_type} onChange={e => setForm(f => ({ ...f, trigger_type: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary">
                    <option value="any_comment">Qualquer comentário</option>
                    <option value="keyword_comment">Comentário com palavra-chave</option>
                    <option value="any_dm">Qualquer DM</option>
                    <option value="keyword_dm">DM com palavra-chave</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Ação</label>
                  <select value={form.action} onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary">
                    <option value="reply_comment">Responder comentário</option>
                    <option value="send_dm">Enviar DM</option>
                    <option value="reply_and_dm">Responder + Enviar DM</option>
                  </select>
                </div>
              </div>

              {needsKeyword && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Palavra-chave (dispara quando encontrada)</label>
                  <input value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                    placeholder="Ex: QUERO, preço, informações"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {form.action === 'send_dm' ? 'Mensagem da DM' : 'Resposta ao comentário'}
                </label>
                <textarea value={form.reply_message} onChange={e => setForm(f => ({ ...f, reply_message: e.target.value }))}
                  placeholder="Digite a mensagem de resposta..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>

              {needsDmMessage && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Mensagem da DM (diferente da resposta ao comentário)</label>
                  <textarea value={form.dm_message} onChange={e => setForm(f => ({ ...f, dm_message: e.target.value }))}
                    placeholder="Olá! Vi seu comentário, aqui estão mais detalhes..."
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                <button type="button" onClick={() => void create()} disabled={saving || !form.account_id || !form.reply_message}
                  className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {saving ? 'Salvando...' : 'Criar automação'}
                </button>
              </div>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando...</div>
          ) : automations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center space-y-2">
              <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Nenhuma automação criada ainda.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {automations.map(auto => (
                <div key={auto.id} className={cn('rounded-xl border bg-card p-4 space-y-3', !auto.enabled && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase',
                          auto.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-blue-500/10 text-blue-500'
                        )}>{auto.platform}</span>
                        <span className="text-sm font-semibold text-foreground truncate">
                          {auto.account_name ?? auto.account_id}
                        </span>
                        <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                          auto.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-zinc-500'
                        )}>{auto.enabled ? 'Ativa' : 'Inativa'}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/80">{TRIGGER_LABELS[auto.trigger_type] ?? auto.trigger_type}</span>
                        {auto.keyword && <span className="ml-1 rounded bg-muted px-1 font-mono text-[10px]">"{auto.keyword}"</span>}
                        <span className="mx-1.5 text-muted-foreground/40">→</span>
                        {ACTION_LABELS[auto.action] ?? auto.action}
                      </p>
                      <p className="text-xs text-muted-foreground/70 italic line-clamp-1">"{auto.reply_message}"</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => toggle(auto)} title={auto.enabled ? 'Desativar' : 'Ativar'}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        {auto.enabled ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
                      </button>
                      <button type="button" onClick={() => remove(auto.id)}
                        className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Logs tab ── */}
      {tab === 'logs' && (
        <div className="space-y-2">
          {logs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-16 text-center">
              <p className="text-sm text-muted-foreground">Nenhum evento processado ainda.</p>
            </div>
          ) : logs.map(log => (
            <div key={log.id} className="rounded-xl border border-border bg-card p-3 space-y-1">
              <div className="flex items-center gap-2">
                {statusIcon(log.status)}
                <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase',
                  log.platform === 'instagram' ? 'bg-pink-500/10 text-pink-500' : 'bg-blue-500/10 text-blue-500'
                )}>{log.platform}</span>
                <span className="text-xs font-medium text-foreground">{log.event_type}</span>
                {log.account_name && <span className="text-xs text-muted-foreground">{log.account_name}</span>}
                {log.action_taken && <span className="text-xs text-muted-foreground/60">→ {log.action_taken}</span>}
                <span className="ml-auto text-[10px] text-muted-foreground/50">{new Date(log.triggered_at).toLocaleString('pt-BR')}</span>
                <button type="button" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                  className="text-muted-foreground hover:text-foreground">
                  {expandedLog === log.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              </div>
              {log.error_msg && <p className="text-xs text-rose-400 pl-5">{log.error_msg}</p>}
              {expandedLog === log.id && (
                <div className="pl-5 pt-1 space-y-0.5 text-xs text-muted-foreground">
                  <p><span className="font-medium">Texto:</span> {log.trigger_text}</p>
                  <p><span className="font-medium">Remetente:</span> {log.sender_id}</p>
                  <p><span className="font-medium">Conta:</span> {log.account_id}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Setup tab ── */}
      {tab === 'setup' && (
        <div className="space-y-4 max-w-2xl">

          {/* Status card */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">Status da integração</p>
              <button type="button" onClick={() => void loadWebhookStatus()}
                className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="h-3 w-3" /> Atualizar
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {/* Webhook configurado */}
              <div className={cn('rounded-lg border p-3 flex flex-col gap-1',
                webhookStatus?.configured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
              )}>
                {webhookStatus?.configured
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <AlertCircle className="h-4 w-4 text-rose-500" />}
                <p className="text-[11px] font-medium text-foreground">Webhook</p>
                <p className={cn('text-[10px]', webhookStatus?.configured ? 'text-emerald-500' : 'text-rose-500')}>
                  {webhookStatus === null ? 'Verificando...' : webhookStatus.configured ? 'Configurado' : 'Não configurado'}
                </p>
              </div>

              {/* Último evento */}
              <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-1">
                <Zap className="h-4 w-4 text-primary" />
                <p className="text-[11px] font-medium text-foreground">Último evento</p>
                <p className="text-[10px] text-muted-foreground">
                  {webhookStatus?.last_event_at
                    ? new Date(webhookStatus.last_event_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                    : 'Nenhum ainda'}
                </p>
              </div>

              {/* Eventos hoje */}
              <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-1">
                <MessageCircle className="h-4 w-4 text-blue-400" />
                <p className="text-[11px] font-medium text-foreground">Hoje</p>
                <p className="text-[10px] text-muted-foreground">
                  {webhookStatus?.events_today ?? '—'} evento{webhookStatus?.events_today !== 1 ? 's' : ''}
                </p>
              </div>

              {/* Erros hoje */}
              <div className={cn('rounded-lg border p-3 flex flex-col gap-1',
                (webhookStatus?.errors_today ?? 0) > 0 ? 'border-rose-500/30 bg-rose-500/5' : 'border-border bg-background'
              )}>
                <AlertCircle className={cn('h-4 w-4', (webhookStatus?.errors_today ?? 0) > 0 ? 'text-rose-500' : 'text-muted-foreground')} />
                <p className="text-[11px] font-medium text-foreground">Erros hoje</p>
                <p className={cn('text-[10px]', (webhookStatus?.errors_today ?? 0) > 0 ? 'text-rose-500' : 'text-muted-foreground')}>
                  {webhookStatus?.errors_today ?? '—'}
                </p>
              </div>
            </div>

            {/* Test button */}
            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={() => void testWebhook()} disabled={testingWebhook || !verifyToken}
                className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
                {testingWebhook ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {testingWebhook ? 'Testando...' : 'Testar conexão'}
              </button>
              {testResult === 'ok' && (
                <span className="flex items-center gap-1 text-xs text-emerald-500 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Webhook respondendo corretamente!
                </span>
              )}
              {testResult === 'error' && (
                <span className="flex items-center gap-1 text-xs text-rose-500 font-medium">
                  <AlertCircle className="h-3.5 w-3.5" /> Falha na verificação — confira a URL e o token.
                </span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-900/50 p-4 flex gap-3">
            <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
              Para as automações funcionarem, você precisa registrar o webhook no painel do Meta for Developers e ativar as assinaturas de campos <strong>comments</strong> e <strong>messages</strong>.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              1. URL do Webhook
            </p>
            <p className="text-xs text-muted-foreground">Cole esta URL no campo "Callback URL" no Meta for Developers:</p>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2">
              <code className="flex-1 text-xs font-mono text-foreground">{BASE}/api/meta/webhook</code>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              2. Token de Verificação
            </p>
            <p className="text-xs text-muted-foreground">Cole este valor no campo "Verify Token" no Meta for Developers:</p>
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border px-3 py-2">
              <code className="flex-1 text-xs font-mono text-foreground">{verifyToken || 'Carregando...'}</code>
              <button type="button" onClick={copyToken}
                className={cn('flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                  copied ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground hover:text-foreground'
                )}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">3. Campos a ativar</p>
            <p className="text-xs text-muted-foreground">Após validar o webhook, ative as assinaturas:</p>
            <div className="space-y-2">
              {[
                { label: 'instagram → comments', desc: 'Comentários no Instagram' },
                { label: 'instagram → messages', desc: 'DMs recebidas no Instagram' },
                { label: 'page → feed', desc: 'Comentários no Facebook' },
                { label: 'page → messages', desc: 'DMs no Messenger' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-3 rounded-lg bg-muted/30 px-3 py-2">
                  <code className="text-xs font-mono text-foreground">{item.label}</code>
                  <span className="text-xs text-muted-foreground">— {item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">4. Encontrar o ID da conta</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              O campo "ID da Conta / Página" nas regras deve ser o <strong>Instagram User ID</strong> ou <strong>Facebook Page ID</strong> — não o nome de usuário. Você pode encontrar esse ID na aba Integrações do sistema ou no Meta Business Suite → Configurações da conta.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
