"use client";

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Check, RefreshCw, AlertCircle,
  CheckCircle2, MinusCircle, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Copy, MessageCircle,
  MessageSquare, Zap, Info, Search, ArrowDownAZ, ArrowUpAZ, X, Pencil,
  Pause, Eye, Send, Clock3, Timer, Camera, ShieldCheck,
  CalendarDays, XCircle, Inbox, List, Grid2X2, ArrowUpDown,
  BookOpen, ExternalLink, Rocket,
} from 'lucide-react';

type Automation = {
  id: string;
  client_id: string | null;
  account_id: string;
  account_name: string | null;
  picture_url: string | null;
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
  account_id: '', account_name: '', picture_url: '' as string | null, platform: 'instagram' as 'instagram' | 'facebook',
  trigger_type: 'any_comment', keyword: '',
  action: 'reply_comment', reply_message: '', dm_message: '',
};

function MetaMark({ className }: { className?: string }) {
  return (
    <span className={cn('font-black leading-none text-blue-500', className)} aria-hidden>
      ∞
    </span>
  );
}

function InstagramMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center justify-center rounded-lg bg-gradient-to-br from-yellow-300 via-pink-500 to-purple-600 text-white shadow-lg shadow-pink-500/20', className)}>
      <Camera className="h-4 w-4" />
    </span>
  );
}

function RulePill({ children, tone = 'slate' }: { children: ReactNode; tone?: 'green' | 'purple' | 'blue' | 'slate' }) {
  const tones = {
    green: 'border-[#40ff2a]/30 bg-[#40ff2a]/10 text-[#40ff2a]',
    purple: 'border-purple-400/30 bg-purple-500/10 text-purple-300',
    blue: 'border-blue-400/30 bg-blue-500/10 text-blue-300',
    slate: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  };

  return (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [subscribeResults, setSubscribeResults] = useState<Record<string, 'ok' | 'error'>>({});
  const [subscribeErrors, setSubscribeErrors] = useState<Record<string, string>>({});

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

  async function subscribePageForAutomation(auto: Automation) {
    const key = `${auto.platform}::${auto.account_id}`;
    setSubscribing(key);
    setSubscribeErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    try {
      const res = await fetch('/api/meta/subscribe-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: auto.account_id, platform: auto.platform }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setSubscribeResults(prev => ({ ...prev, [key]: 'error' }));
        setSubscribeErrors(prev => ({ ...prev, [key]: data.error ?? 'Erro desconhecido' }));
      } else {
        setSubscribeResults(prev => ({ ...prev, [key]: 'ok' }));
        setTimeout(() => setSubscribeResults(prev => { const n = { ...prev }; delete n[key]; return n; }), 6000);
      }
    } finally {
      setSubscribing(null);
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
        picture_url: form.picture_url || null,
        keyword: form.keyword || null,
        dm_message: form.dm_message || null,
      }),
    });
    if (res.ok) {
      const row = await res.json() as Automation;
      setAutomations(prev => [row, ...prev]);
      resetForm();
    }
    setSaving(false);
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setSelectedClient(null);
    setClientPages([]);
    setShowForm(false);
    setEditingId(null);
  }

  function startEdit(auto: Automation) {
    setEditingId(auto.id);
    setShowForm(true);
    setForm({
      account_id: auto.account_id,
      account_name: auto.account_name ?? '',
      picture_url: auto.picture_url ?? null,
      platform: auto.platform,
      trigger_type: auto.trigger_type,
      keyword: auto.keyword ?? '',
      action: auto.action,
      reply_message: auto.reply_message,
      dm_message: auto.dm_message ?? '',
    });
    // clear client picker since we're editing an existing record
    setSelectedClient(null);
    setClientPages([]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveEdit() {
    if (!editingId || !form.account_id || !form.reply_message) return;
    setSaving(true);
    const res = await fetch(`/api/meta/automations/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: form.account_id,
        account_name: form.account_name || null,
        picture_url: form.picture_url || null,
        platform: form.platform,
        trigger_type: form.trigger_type,
        keyword: form.keyword || null,
        action: form.action,
        reply_message: form.reply_message,
        dm_message: form.dm_message || null,
      }),
    });
    if (res.ok) {
      const row = await res.json() as Automation;
      setAutomations(prev => prev.map(a => a.id === row.id ? row : a));
      resetForm();
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

  const activeAutomations = automations.filter(auto => auto.enabled);
  const pausedAutomations = automations.filter(auto => !auto.enabled);
  const primaryAutomation = automations[0] ?? null;
  const displayRule: Automation = primaryAutomation ?? {
    id: 'preview-rule',
    client_id: null,
    account_id: 'preview',
    account_name: '@onmidmkt',
    picture_url: null,
    platform: 'instagram',
    trigger_type: 'any_dm',
    keyword: null,
    action: 'send_dm',
    reply_message: 'Shoow, estamos testando tudo.',
    dm_message: null,
    enabled: true,
    created_at: '2025-04-24T10:32:00.000Z',
  };
  const hasPrimaryAutomation = Boolean(primaryAutomation);
  const primaryKey = `${displayRule.platform}::${displayRule.account_id}`;
  const primaryLogCount = hasPrimaryAutomation ? logs.filter(log => log.automation_id === displayRule.id).length : 0;
  const otherAutomations = automations.slice(1);
  const displayTrigger = TRIGGER_LABELS[displayRule.trigger_type] ?? displayRule.trigger_type;
  const displayAction = displayRule.action === 'send_dm'
    ? 'Enviar DM automática'
    : ACTION_LABELS[displayRule.action] ?? displayRule.action;
  const createdAt = new Date(displayRule.created_at).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const todayKey = new Date().toDateString();
  const logsToday = logs.filter(log => new Date(log.triggered_at).toDateString() === todayKey);
  const successLogs = logs.filter(log => log.status === 'success');
  const failureLogs = logs.filter(log => log.status === 'error');
  const latestLog = logs
    .slice()
    .sort((a, b) => new Date(b.triggered_at).getTime() - new Date(a.triggered_at).getTime())[0];
  const percentOfLogs = (value: number) => logs.length ? Math.round((value / logs.length) * 100) : 0;

  return (
    <div className="relative -m-6 min-h-[calc(100vh-7rem)] overflow-hidden bg-[#070b13] px-6 py-6 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(64,255,42,0.10),transparent_24%),radial-gradient(circle_at_74%_8%,rgba(126,55,255,0.12),transparent_28%),linear-gradient(180deg,rgba(12,18,32,0.92),rgba(7,11,19,1))]" />
      <div className="relative z-10 space-y-6 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400 shadow-[0_0_34px_rgba(59,130,246,0.20)]">
              <MessageCircle className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-[28px] font-semibold tracking-normal text-white">Automações Meta</h1>
              <p className="mt-1 text-sm text-slate-400">Respostas automáticas a comentários e DMs do Instagram e Facebook.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={load} className="flex h-11 items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/30 px-5 text-sm font-semibold text-slate-200 shadow-lg shadow-black/20 transition-colors hover:border-slate-500 hover:bg-slate-900/70">
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
            <button type="button" onClick={() => setShowForm(v => !v)} className="flex h-11 items-center gap-2 rounded-xl bg-[#40ff2a] px-5 text-sm font-bold text-black shadow-[0_0_22px_rgba(64,255,42,0.32)] transition-transform hover:scale-[1.01]">
              <Plus className="h-4 w-4" />
              Nova Automação
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-900/45 px-5 shadow-xl shadow-black/15">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#40ff2a]/15 text-[#40ff2a]">
              <Zap className="h-7 w-7 fill-current" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-white">{activeAutomations.length}</p>
              <p className="text-sm text-slate-400">{activeAutomations.length === 1 ? 'automação ativa' : 'automações ativas'}</p>
            </div>
          </div>

          <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-900/45 px-5 shadow-xl shadow-black/15">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-500/15 text-slate-300">
              <Pause className="h-6 w-6 fill-current" />
            </div>
            <div>
              <p className="text-2xl font-semibold text-white">{pausedAutomations.length}</p>
              <p className="text-sm text-slate-400">pausadas</p>
            </div>
          </div>

          <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-900/45 px-5 shadow-xl shadow-black/15">
            <div className="flex items-center gap-1">
              <MetaMark className="text-5xl" />
              <InstagramMark className="h-8 w-8" />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Instagram + Facebook</p>
              <p className="text-sm text-slate-400">Canais conectados</p>
            </div>
          </div>
        </div>

        <div className="flex gap-8 border-b border-slate-700/70">
        {(['rules', 'logs', 'setup'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn('border-b-2 px-0 pb-3 pt-1 text-sm font-semibold transition-colors',
              tab === t ? 'border-[#40ff2a] text-[#40ff2a]' : 'border-transparent text-slate-400 hover:text-white'
            )}>
            {t === 'rules' ? 'Regras' : t === 'logs' ? 'Logs' : 'Configuração'}
          </button>
        ))}
      </div>

      {/* ── Rules tab ── */}
      {tab === 'rules' && (
        <div className="space-y-4">
          {/* Create / Edit form */}
          {showForm && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <p className="text-sm font-semibold text-foreground">{editingId ? 'Editar automação' : 'Nova automação'}</p>

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
                                  onClick={() => setForm(f => ({ ...f, account_id: pg.account_id, account_name: pg.account_name, picture_url: pg.picture_url, platform: pg.platform }))}
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
                <button type="button" onClick={resetForm} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">Cancelar</button>
                <button type="button" onClick={() => void (editingId ? saveEdit() : create())} disabled={saving || !form.account_id || !form.reply_message}
                  className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                  {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Criar automação'}
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 py-16 text-center text-sm text-slate-400">Carregando...</div>
          ) : (
            <>
              <div className="overflow-hidden rounded-2xl border border-[#40ff2a]/35 bg-[linear-gradient(110deg,rgba(64,255,42,0.12),rgba(15,23,42,0.82)_31%,rgba(15,23,42,0.92)_68%,rgba(64,255,42,0.06))] shadow-[0_0_40px_rgba(64,255,42,0.10)]">
                <div className="grid gap-6 p-6 lg:grid-cols-[1.1fr_1.25fr_220px_58px]">
                  <div className="flex flex-col justify-between gap-8">
                    <div className="flex items-start gap-5">
                      <div className="relative">
                        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[#40ff2a]/30 bg-slate-950 shadow-[0_0_34px_rgba(147,51,234,0.25)]">
                          {displayRule.picture_url ? (
                            <img src={displayRule.picture_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-sm font-bold text-[#40ff2a]">onmid</span>
                          )}
                        </div>
                        <InstagramMark className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full border-2 border-slate-950" />
                      </div>
                      <div className="pt-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-2xl font-semibold tracking-normal text-white">{displayRule.account_name ?? displayRule.account_id}</h2>
                          <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold uppercase', displayRule.enabled ? 'border-[#40ff2a]/30 bg-[#40ff2a]/10 text-[#40ff2a]' : 'border-slate-500/30 bg-slate-500/10 text-slate-300')}>
                            {displayRule.enabled ? 'Ativa' : 'Pausada'}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <RulePill tone="purple"><InstagramMark className="h-4 w-4 rounded-full" /> Instagram</RulePill>
                          <RulePill tone="blue"><MetaMark className="text-xl" /> Facebook</RulePill>
                        </div>
                        <p className="mt-4 text-sm text-slate-400">Automação criada em {createdAt}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <RulePill tone="green"><MessageCircle className="h-3.5 w-3.5" /> DM</RulePill>
                      <RulePill tone="purple">Instagram</RulePill>
                      <RulePill tone="blue">Facebook</RulePill>
                      <RulePill>Resposta automática</RulePill>
                    </div>
                  </div>

                  <div className="border-slate-700/70 lg:border-l lg:pl-8">
                    <div className="grid items-start gap-5 md:grid-cols-[1fr_auto_1fr]">
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Gatilho</p>
                        <div className="flex items-start gap-3">
                          <MessageCircle className="mt-1 h-6 w-6 text-slate-300" />
                          <div>
                            <p className="text-base font-semibold text-white">{displayTrigger}</p>
                            <p className="mt-1 text-sm text-slate-400">{displayRule.trigger_type.includes('dm') ? 'Mensagens diretas (DM)' : 'Comentários Meta'}</p>
                          </div>
                        </div>
                      </div>
                      <span className="hidden pt-8 text-2xl text-slate-400 md:block">→</span>
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Ação</p>
                        <div className="flex items-start gap-3">
                          <Send className="mt-1 h-6 w-6 text-slate-300" />
                          <div>
                            <p className="text-base font-semibold text-white">{displayAction}</p>
                            <p className="mt-1 text-sm text-slate-400">Resposta automática</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Resposta</p>
                      <div className="rounded-xl border border-slate-800/70 bg-slate-900/75 px-5 py-4 text-lg text-slate-200 shadow-inner shadow-black/20">
                        “{displayRule.reply_message}”
                      </div>
                    </div>
                  </div>

                  <div className="border-slate-700/70 lg:border-l lg:pl-6">
                    <div className="space-y-7">
                      <div className="flex items-center gap-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-300"><MessageCircle className="h-6 w-6" /></span>
                        <div>
                          <p className="text-sm text-slate-400">Respostas hoje</p>
                          <p className="text-2xl font-semibold text-white">{primaryLogCount}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-300"><Timer className="h-6 w-6" /></span>
                        <div>
                          <p className="text-sm text-slate-400">Último disparo</p>
                          <p className="text-lg font-semibold text-white">—</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-300"><Clock3 className="h-6 w-6" /></span>
                        <div>
                          <p className="text-sm text-slate-400">Tempo médio</p>
                          <p className="text-lg font-semibold text-white">—</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-row gap-2 lg:flex-col">
                    <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-400/25 bg-blue-500/5 text-blue-300"><Eye className="h-5 w-5" /></button>
                    <button type="button" disabled={!hasPrimaryAutomation} onClick={() => primaryAutomation && startEdit(primaryAutomation)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-500/30 bg-slate-500/5 text-slate-300 disabled:opacity-40"><Pencil className="h-5 w-5" /></button>
                    <button type="button" disabled={!hasPrimaryAutomation} onClick={() => primaryAutomation && toggle(primaryAutomation)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#40ff2a]/30 bg-[#40ff2a]/10 text-[#40ff2a] disabled:opacity-40">{displayRule.enabled ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}</button>
                    <button type="button" disabled={!hasPrimaryAutomation} onClick={() => primaryAutomation && void subscribePageForAutomation(primaryAutomation)} className={cn('flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-500/5 text-cyan-300 disabled:opacity-40', subscribing === primaryKey && 'animate-pulse')}><Copy className="h-5 w-5" /></button>
                    <button type="button" disabled={!hasPrimaryAutomation} onClick={() => primaryAutomation && remove(primaryAutomation.id)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-rose-400/25 bg-rose-500/5 text-rose-400 disabled:opacity-40"><Trash2 className="h-5 w-5" /></button>
                  </div>
                </div>
                {subscribeErrors[primaryKey] && (
                  <div className="border-t border-rose-500/20 px-6 py-3 text-sm text-rose-300">{subscribeErrors[primaryKey]}</div>
                )}
              </div>

              <div className="grid gap-5 lg:grid-cols-[1.35fr_0.9fr]">
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-900/40 p-6 shadow-xl shadow-black/15">
                  <MetaMark className="pointer-events-none absolute right-12 top-6 text-8xl text-blue-500/15" />
                  <h3 className="text-lg font-semibold text-white">Como funciona</h3>
                  <p className="mt-1 text-sm text-slate-400">Entenda o fluxo da sua automação de DM.</p>
                  <div className="mt-6 grid gap-5 md:grid-cols-3">
                    {[
                      { icon: MessageCircle, title: 'Mensagem recebida', text: 'O contato envia uma DM no Instagram ou Facebook.', tone: 'text-[#40ff2a] bg-[#40ff2a]/10', n: 1 },
                      { icon: ShieldCheck, title: 'Validação da regra', text: 'Verificamos se a mensagem se encaixa na sua regra ativa.', tone: 'text-purple-300 bg-purple-500/10', n: 2 },
                      { icon: Send, title: 'Resposta automática enviada', text: 'Enviamos sua resposta automaticamente para o contato via DM.', tone: 'text-blue-300 bg-blue-500/10', n: 3 },
                    ].map(item => (
                      <div key={item.title} className="relative rounded-xl border border-slate-700/70 bg-slate-950/35 p-5">
                        <span className={cn('mb-8 flex h-12 w-12 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-7 w-7" /></span>
                        <span className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold text-slate-300">{item.n}</span>
                        <p className="font-semibold text-white">{item.title}</p>
                        <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.text}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mt-7 flex items-center gap-3 text-sm text-slate-400">
                    <Info className="h-5 w-5 text-[#40ff2a]" />
                    Respostas automáticas ajudam a engajar mais rápido e não deixar nenhum cliente sem atenção.
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-6 shadow-xl shadow-black/15">
                  <h3 className="text-lg font-semibold text-white">Boas práticas</h3>
                  <p className="mt-1 text-sm text-slate-400">Dicas para automações de DM que geram resultado.</p>
                  <div className="mt-5 space-y-3">
                    {[
                      { icon: MessageSquare, title: 'Use mensagens curtas e objetivas', text: 'Facilite a leitura e aumente as chances de resposta.', tone: 'text-[#40ff2a] bg-[#40ff2a]/10' },
                      { icon: MessageCircle, title: 'Evite respostas muito genéricas', text: 'Personalize quando possível para criar conexão.', tone: 'text-purple-300 bg-purple-500/10' },
                      { icon: ShieldCheck, title: 'Personalize com variáveis', text: 'Use o nome do contato ou informações do contexto.', tone: 'text-indigo-300 bg-indigo-500/10' },
                    ].map(item => (
                      <div key={item.title} className="flex gap-4 rounded-xl bg-slate-800/35 p-4">
                        <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', item.tone)}><item.icon className="h-5 w-5" /></span>
                        <div>
                          <p className="font-semibold text-white">{item.title}</p>
                          <p className="mt-1 text-sm text-slate-400">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="mt-6 flex items-center gap-2 text-sm font-semibold text-blue-400">Ver mais dicas e exemplos <span>›</span></button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-6 shadow-xl shadow-black/15">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">Outras regras</h3>
                    <p className="mt-1 text-sm text-slate-400">Gerencie outras automações ou crie novas regras.</p>
                  </div>
                  <button type="button" onClick={() => setShowForm(true)} className="flex h-10 items-center gap-2 rounded-xl bg-[#40ff2a] px-5 text-sm font-bold text-black">
                    <Plus className="h-4 w-4" />
                    Nova Automação
                  </button>
                </div>
                {otherAutomations.length > 0 ? (
                  <div className="mt-5 space-y-2">
                    {otherAutomations.map(auto => (
                      <div key={auto.id} className="flex items-center justify-between gap-4 rounded-xl border border-slate-700/60 bg-slate-950/30 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{auto.account_name ?? auto.account_id}</p>
                          <p className="truncate text-sm text-slate-400">{TRIGGER_LABELS[auto.trigger_type] ?? auto.trigger_type} → {ACTION_LABELS[auto.action] ?? auto.action}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => startEdit(auto)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                          <button type="button" onClick={() => toggle(auto)} className="rounded-lg p-2 text-[#40ff2a] hover:bg-slate-800">{auto.enabled ? <ToggleRight className="h-5 w-5" /> : <ToggleLeft className="h-5 w-5" />}</button>
                          <button type="button" onClick={() => remove(auto.id)} className="rounded-lg p-2 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-5 flex min-h-24 items-center justify-center gap-4 rounded-xl border border-dashed border-slate-600/80 bg-slate-950/25">
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#40ff2a]/10 text-[#40ff2a]"><MessageSquare className="h-7 w-7" /></span>
                    <div>
                      <p className="font-semibold text-white">Ainda não há outras automações criadas.</p>
                      <p className="text-sm text-slate-400">Crie uma nova automação para começar.</p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Logs tab ── */}
      {tab === 'logs' && (
        <div className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {[
              { label: 'Eventos hoje', value: logsToday.length, caption: '0% vs ontem', icon: CalendarDays, tone: 'blue' },
              { label: 'Sucesso', value: successLogs.length, caption: `${percentOfLogs(successLogs.length)}% do total`, icon: CheckCircle2, tone: 'green' },
              { label: 'Falhas', value: failureLogs.length, caption: `${percentOfLogs(failureLogs.length)}% do total`, icon: XCircle, tone: 'red' },
              { label: 'Último evento', value: latestLog ? new Date(latestLog.triggered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', caption: latestLog ? new Date(latestLog.triggered_at).toLocaleDateString('pt-BR') : 'Nenhum evento ainda', icon: Clock3, tone: 'purple' },
            ].map(card => {
              const toneClass = card.tone === 'blue'
                ? 'bg-blue-500/15 text-blue-400 shadow-blue-500/15'
                : card.tone === 'green'
                  ? 'bg-[#40ff2a]/15 text-[#40ff2a] shadow-[#40ff2a]/15'
                  : card.tone === 'red'
                    ? 'bg-red-500/15 text-red-400 shadow-red-500/15'
                    : 'bg-purple-500/15 text-purple-300 shadow-purple-500/15';
              return (
                <div key={card.label} className="flex h-28 items-center gap-5 rounded-xl border border-slate-700/70 bg-slate-900/45 px-6 shadow-xl shadow-black/15">
                  <span className={cn('flex h-14 w-14 items-center justify-center rounded-full shadow-[0_0_30px_currentColor]', toneClass)}>
                    <card.icon className="h-7 w-7" />
                  </span>
                  <div>
                    <p className="text-sm text-slate-400">{card.label}</p>
                    <p className="mt-1 text-3xl font-semibold text-white">{card.value}</p>
                    <p className="mt-1 text-sm text-slate-400">{card.caption}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5 shadow-xl shadow-black/15">
            <div className="grid gap-4 lg:grid-cols-[150px_150px_160px_1fr_auto]">
              <label className="space-y-2">
                <span className="text-sm text-slate-400">Status</span>
                <select className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-[#40ff2a]">
                  <option>Todos</option>
                  <option>Sucesso</option>
                  <option>Falhas</option>
                  <option>Ignorados</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-400">Canal</span>
                <select className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-[#40ff2a]">
                  <option>Todos</option>
                  <option>Instagram</option>
                  <option>Facebook</option>
                  <option>DM</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-400">Data</span>
                <select className="h-10 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 text-sm text-white outline-none focus:border-[#40ff2a]">
                  <option>Hoje</option>
                  <option>7 dias</option>
                  <option>30 dias</option>
                  <option>Todos</option>
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-400">&nbsp;</span>
                <span className="flex h-10 items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/60 px-4 text-sm text-slate-500">
                  <Search className="h-4 w-4" />
                  Buscar por regra ou usuário...
                </span>
              </label>
              <div className="flex items-end gap-3">
                <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-pink-400/30 bg-pink-500/10 px-4 text-sm font-semibold text-white"><InstagramMark className="h-5 w-5 rounded-md" />Instagram</button>
                <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-blue-400/30 bg-blue-500/10 px-4 text-sm font-semibold text-white"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs font-bold">f</span>Facebook</button>
                <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-[#40ff2a]/30 bg-[#40ff2a]/5 px-4 text-sm font-semibold text-white"><MessageCircle className="h-5 w-5 text-[#40ff2a]" />DM</button>
                <button type="button" className="flex h-10 items-center gap-2 rounded-lg border border-purple-400/30 bg-purple-500/10 px-4 text-sm font-semibold text-white"><MessageSquare className="h-5 w-5 text-purple-300" />Comentário</button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-5 shadow-xl shadow-black/15">
            <div className="flex items-center justify-between gap-4">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
                <CalendarDays className="h-5 w-5 text-slate-300" />
                Timeline de eventos
              </h3>
              <div className="flex items-center gap-3">
                <button type="button" className="flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-4 text-sm text-slate-400">
                  <ArrowUpDown className="h-4 w-4" />
                  Mais recentes
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button type="button" className="flex h-9 w-10 items-center justify-center rounded-lg bg-[#40ff2a]/20 text-[#40ff2a]"><List className="h-5 w-5" /></button>
                <button type="button" className="flex h-9 w-10 items-center justify-center rounded-lg border border-slate-700 text-slate-400"><Grid2X2 className="h-5 w-5" /></button>
              </div>
            </div>

            {logs.length === 0 ? (
              <div className="mt-5 flex min-h-[285px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-[radial-gradient(circle_at_50%_20%,rgba(59,130,246,0.12),transparent_38%),rgba(15,23,42,0.16)] px-6 text-center">
                <span className="flex h-24 w-24 items-center justify-center rounded-full border border-blue-400/30 bg-blue-500/10 text-blue-400 shadow-[0_0_36px_rgba(59,130,246,0.18)]">
                  <Inbox className="h-12 w-12" />
                </span>
                <h4 className="mt-5 text-xl font-semibold text-white">Nenhum evento processado ainda.</h4>
                <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-slate-400">
                  Os eventos de comentários e DMs recebidos pelo Instagram e Facebook aparecerão aqui conforme suas automações forem acionadas.
                </p>
                <button type="button" onClick={() => setTab('rules')} className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-5 text-sm font-semibold text-white">
                  <Zap className="h-5 w-5 text-[#40ff2a]" />
                  Ver regras ativas
                </button>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                {logs.map(log => (
                  <div key={log.id} className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4">
                    <div className="flex items-center gap-3">
                      {statusIcon(log.status)}
                      <span className={cn('rounded-full px-2 py-1 text-[10px] font-bold uppercase',
                        log.platform === 'instagram' ? 'bg-pink-500/10 text-pink-300' : 'bg-blue-500/10 text-blue-300'
                      )}>{log.platform}</span>
                      <span className="text-sm font-semibold text-white">{log.event_type}</span>
                      {log.account_name && <span className="text-sm text-slate-400">{log.account_name}</span>}
                      {log.action_taken && <span className="text-sm text-slate-500">→ {log.action_taken}</span>}
                      <span className="ml-auto text-xs text-slate-500">{new Date(log.triggered_at).toLocaleString('pt-BR')}</span>
                      <button type="button" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)} className="text-slate-400 hover:text-white">
                        {expandedLog === log.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>
                    {log.error_msg && <p className="mt-2 pl-7 text-sm text-rose-300">{log.error_msg}</p>}
                    {expandedLog === log.id && (
                      <div className="mt-3 grid gap-2 border-t border-slate-800 pt-3 pl-7 text-sm text-slate-400 md:grid-cols-3">
                        <p><span className="font-medium text-slate-300">Texto:</span> {log.trigger_text}</p>
                        <p><span className="font-medium text-slate-300">Remetente:</span> {log.sender_id}</p>
                        <p><span className="font-medium text-slate-300">Conta:</span> {log.account_id}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-6 shadow-xl shadow-black/15">
            <h3 className="text-lg font-semibold text-white">Como os logs ajudam</h3>
            <p className="mt-1 text-sm text-slate-400">Acompanhe cada etapa das suas automações em tempo real.</p>
            <div className="mt-6 grid gap-5 lg:grid-cols-4">
              {[
                { icon: Inbox, title: 'Recebimento', text: 'Registramos quando um comentário ou DM é recebido pelas plataformas.', tone: 'bg-blue-500/15 text-blue-400' },
                { icon: ShieldCheck, title: 'Validação', text: 'Verificamos se o evento atende às regras da automação.', tone: 'bg-[#40ff2a]/15 text-[#40ff2a]' },
                { icon: Send, title: 'Resposta enviada', text: 'Enviamos a resposta automática e registramos o envio com sucesso.', tone: 'bg-blue-500/15 text-blue-400' },
                { icon: AlertCircle, title: 'Erro', text: 'Se algo falhar, registramos o erro para você analisar e corrigir.', tone: 'bg-red-500/15 text-red-400' },
              ].map((item, index) => (
                <div key={item.title} className={cn('flex gap-4', index > 0 && 'lg:border-l lg:border-slate-700/70 lg:pl-6')}>
                  <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-full', item.tone)}>
                    <item.icon className="h-7 w-7" />
                  </span>
                  <div>
                    <p className="font-semibold text-white">{item.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Setup tab ── */}
      {tab === 'setup' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-6 shadow-xl shadow-black/15">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold text-white">Status da integração</h3>
                <span className={cn('flex items-center gap-2 text-sm', webhookStatus?.configured ? 'text-slate-300' : 'text-amber-300')}>
                  <span className={cn('h-3 w-3 rounded-full shadow-[0_0_18px_currentColor]', webhookStatus?.configured ? 'bg-[#40ff2a] text-[#40ff2a]' : 'bg-amber-400 text-amber-400')} />
                  {webhookStatus?.configured ? 'Tudo funcionando!' : 'Verificando configuração'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void loadWebhookStatus()} className="flex h-9 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 px-4 text-sm font-semibold text-slate-300">
                  <RefreshCw className="h-4 w-4" />
                  Atualizar
                </button>
                <button type="button" onClick={() => void testWebhook()} disabled={testingWebhook || !verifyToken} className="flex h-9 items-center gap-2 rounded-lg border border-[#40ff2a]/40 bg-[#40ff2a]/10 px-4 text-sm font-semibold text-[#40ff2a] disabled:opacity-50">
                  {testingWebhook ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4 fill-current" />}
                  {testingWebhook ? 'Testando...' : 'Testar conexão'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className={cn('flex h-20 items-center gap-4 rounded-xl border px-5', webhookStatus?.configured ? 'border-[#40ff2a]/25 bg-[#40ff2a]/8' : 'border-amber-400/25 bg-amber-500/8')}>
                <span className={cn('flex h-12 w-12 items-center justify-center rounded-full', webhookStatus?.configured ? 'bg-[#40ff2a]/15 text-[#40ff2a]' : 'bg-amber-500/15 text-amber-300')}>
                  {webhookStatus?.configured ? <CheckCircle2 className="h-8 w-8" /> : <AlertCircle className="h-8 w-8" />}
                </span>
                <div>
                  <p className="font-semibold text-white">Webhook configurado</p>
                  <p className="mt-1 text-sm text-slate-400">{webhookStatus?.configured ? 'Ativo e recebendo eventos' : 'Aguardando validação'}</p>
                </div>
              </div>

              <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-950/25 px-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#40ff2a]/10 text-[#40ff2a]">
                  <Zap className="h-8 w-8 fill-current" />
                </span>
                <div>
                  <p className="font-semibold text-white">Último evento</p>
                  <p className="mt-1 text-sm text-slate-400">
                    {webhookStatus?.last_event_at
                      ? new Date(webhookStatus.last_event_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                      : 'Nenhum ainda'}
                  </p>
                </div>
              </div>

              <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-950/25 px-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15 text-blue-400">
                  <MessageCircle className="h-8 w-8" />
                </span>
                <div>
                  <p className="font-semibold text-white">Hoje</p>
                  <p className="mt-1 text-sm text-slate-400">{webhookStatus?.events_today ?? 0} eventos</p>
                </div>
              </div>

              <div className="flex h-20 items-center gap-4 rounded-xl border border-slate-700/70 bg-slate-950/25 px-5">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pink-500/15 text-pink-400">
                  <AlertCircle className="h-8 w-8" />
                </span>
                <div>
                  <p className="font-semibold text-white">Erros hoje</p>
                  <p className="mt-1 text-sm text-slate-400">{webhookStatus?.errors_today ?? 0}</p>
                </div>
              </div>
            </div>

            {testResult === 'ok' && (
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[#40ff2a]"><CheckCircle2 className="h-4 w-4" /> Webhook respondendo corretamente!</p>
            )}
            {testResult === 'error' && (
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-rose-300"><AlertCircle className="h-4 w-4" /> Falha na verificação. Confira a URL e o token.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-500/45 bg-amber-500/8 px-6 py-4 text-amber-200 shadow-xl shadow-black/15">
            <div className="flex items-start gap-4">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <p className="max-w-4xl text-sm leading-relaxed">
                Para as automações funcionarem, você precisa registrar o webhook no painel do Meta for Developers e ativar as assinaturas de campos <strong>comments</strong> e <strong>messages</strong>.
              </p>
            </div>
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-4 text-sm font-semibold text-slate-300">
              <ExternalLink className="h-4 w-4" />
              Abrir Meta for Developers
            </a>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.95fr]">
            <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-6 shadow-xl shadow-black/15">
              <div className="relative space-y-8 before:absolute before:left-3.5 before:top-7 before:h-[calc(100%-5rem)] before:border-l before:border-dashed before:border-slate-600">
                <div className="relative pl-10">
                  <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#40ff2a]/20 text-sm font-bold text-[#40ff2a]">1</span>
                  <h4 className="text-base font-semibold text-white">1. URL do Webhook</h4>
                  <p className="mt-2 text-sm text-slate-400">Cole esta URL no campo "Callback URL" no Meta for Developers.</p>
                  <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-white">{BASE}/api/meta/webhook</code>
                    <button type="button" onClick={() => void navigator.clipboard.writeText(`${BASE}/api/meta/webhook`)} className="flex h-8 items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/70 px-3 text-sm text-slate-300">
                      <Copy className="h-4 w-4" />
                      Copiar
                    </button>
                  </div>
                </div>

                <div className="relative pl-10">
                  <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#40ff2a]/20 text-sm font-bold text-[#40ff2a]">2</span>
                  <h4 className="text-base font-semibold text-white">2. Token de Verificação</h4>
                  <p className="mt-2 text-sm text-slate-400">Cole este valor no campo "Verify Token" no Meta for Developers.</p>
                  <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-white">{verifyToken || 'Carregando...'}</code>
                    <button type="button" onClick={copyToken} className={cn('flex h-8 items-center gap-2 rounded-lg border px-3 text-sm', copied ? 'border-[#40ff2a]/35 bg-[#40ff2a]/10 text-[#40ff2a]' : 'border-slate-700 bg-slate-800/70 text-slate-300')}>
                      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>

                <div className="relative pl-10">
                  <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#40ff2a]/20 text-sm font-bold text-[#40ff2a]">3</span>
                  <h4 className="text-base font-semibold text-white">3. Campos a ativar</h4>
                  <p className="mt-2 text-sm text-slate-400">Após validar o webhook, ative as assinaturas abaixo.</p>
                  <div className="mt-4 overflow-hidden rounded-lg border border-slate-700">
                    {[
                      { label: 'instagram — comments', desc: 'Comentários no Instagram', icon: <InstagramMark className="h-6 w-6 rounded-md" /> },
                      { label: 'instagram — messages', desc: 'DMs recebidas no Instagram', icon: <InstagramMark className="h-6 w-6 rounded-md" /> },
                      { label: 'page — feed', desc: 'Comentários no Facebook', icon: <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500 text-sm font-bold text-white">f</span> },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-4 border-b border-slate-700/70 bg-slate-950/35 px-4 py-3 last:border-b-0">
                        {item.icon}
                        <code className="w-52 font-mono text-sm font-semibold text-white">{item.label}</code>
                        <span className="flex-1 text-sm text-slate-400">{item.desc}</span>
                        <span className="rounded-md border border-[#40ff2a]/25 bg-[#40ff2a]/10 px-2 py-1 text-xs font-semibold text-[#40ff2a]">Obrigatório</span>
                        <CheckCircle2 className="h-5 w-5 text-[#40ff2a]" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
                    <Info className="h-5 w-5 text-[#40ff2a]" />
                    Todos os campos obrigatórios ativados
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-6 shadow-xl shadow-black/15">
                <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                  <BookOpen className="h-5 w-5 text-blue-400" />
                  Guia rápido
                </h3>
                <p className="mt-1 text-sm text-slate-400">Siga este passo a passo para conectar a ONMID.</p>
                <div className="mt-5 space-y-2">
                  {[
                    ['Acesse o Meta for Developers', 'Entre no painel de desenvolvedores da Meta.'],
                    ['Selecione seu app', 'Escolha o app que será usado para as automações.'],
                    ['Configure o Webhook', 'Cole a URL e o token de verificação nos campos indicados.'],
                    ['Assine os campos', 'Ative os campos comments e messages.'],
                    ['Testar conexão', 'Clique em "Testar conexão" para validar o recebimento de eventos.'],
                  ].map(([title, text], index) => (
                    <div key={title} className="flex items-center gap-4 rounded-lg bg-slate-800/35 px-4 py-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-blue-400/50 text-xs font-semibold text-blue-400">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white">{title}</p>
                        <p className="text-sm text-slate-400">{text}</p>
                      </div>
                      {index === 0 && <ExternalLink className="h-4 w-4 text-blue-400" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-700/70 bg-slate-900/45 p-6 shadow-xl shadow-black/15">
                <h3 className="flex items-center gap-3 text-lg font-semibold text-white">
                  <ShieldCheck className="h-5 w-5 text-[#40ff2a]" />
                  Checklist de validação
                </h3>
                <p className="mt-1 text-sm text-slate-400">Use esta lista para garantir que tudo está correto.</p>
                <div className="mt-5 space-y-3">
                  {[
                    'Webhook configurado e respondendo 200 OK',
                    'Token de verificação salvo corretamente',
                    'Campos comments e messages ativados',
                    'Eventos sendo recebidos sem erros',
                  ].map(item => (
                    <p key={item} className="flex items-center gap-3 text-sm text-slate-300">
                      <CheckCircle2 className="h-5 w-5 text-[#40ff2a]" />
                      {item}
                    </p>
                  ))}
                </div>
                <p className="mt-5 flex items-center gap-3 text-sm font-semibold text-[#40ff2a]">
                  <Rocket className="h-5 w-5" />
                  Tudo certo! Sua integração está pronta para rodar.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
