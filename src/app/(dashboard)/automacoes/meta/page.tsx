"use client";

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Check, RefreshCw, AlertCircle,
  CheckCircle2, MinusCircle, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Copy, MessageCircle,
  MessageSquare, Zap, Info,
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

  useEffect(() => { void load(); }, []);

  async function create() {
    if (!form.account_id || !form.reply_message) return;
    setSaving(true);
    const res = await fetch('/api/meta/automations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        keyword: form.keyword || null,
        dm_message: form.dm_message || null,
      }),
    });
    if (res.ok) {
      const row = await res.json() as Automation;
      setAutomations(prev => [row, ...prev]);
      setForm({ ...EMPTY_FORM });
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Plataforma</label>
                  <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value as 'instagram' | 'facebook' }))}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary">
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ID da Conta / Página</label>
                  <input value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
                    placeholder="123456789"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome da conta (para identificação)</label>
                <input value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))}
                  placeholder="Ex: @clinicasorrir"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>

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
