"use client";

import { useEffect, useState } from 'react';
import {
  Mail, Plus, Play, Pause, X, Users, BarChart2, Server,
  CheckCircle2, AlertCircle, Clock, RefreshCw, Send,
  ChevronDown, Zap, ArrowRight, Trash2, GitBranch,
  Search, Copy, Download, Pencil,
} from 'lucide-react';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { FlowBuilder } from './FlowBuilder';
import type { GmailAccount as FlowBuilderAccount } from './FlowBuilder';
import type { Node, Edge } from '@xyflow/react';

// ─── Types ────────────────────────────────────────────────────────────────────

type GmailAccount = {
  id: string; email: string; display_name: string; picture: string | null; connected_at: string;
};

type Campaign = {
  id: string; account_email: string; name: string; subject: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'cancelled';
  total: number; sent: number; failed: number;
  interval_min: number; interval_max: number;
  scheduled_at: string | null; finished_at: string | null; created_at: string;
  total_opens: number; unique_opens: number;
  total_clicks: number; unique_clicks: number;
};

type Flow = {
  id: string; account_email: string; name: string; status: string;
  flow_mode?: string; steps_count: number; active_contacts: number; created_at: string;
};

type FlowStep = { subject: string; bodyHtml: string; delayDays: number };

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmtDate(v: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function parseRecipients(raw: string): Array<{ email: string; name?: string }> {
  return raw.split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Support "Nome <email>" or just "email"
      const match = s.match(/^(.+?)\s*<(.+?)>$/);
      if (match) return { name: match[1].trim(), email: match[2].trim() };
      return { email: s };
    })
    .filter((r) => r.email.includes('@'));
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando', running: 'Enviando', paused: 'Pausado',
  done: 'Concluído', cancelled: 'Cancelado', active: 'Ativo',
};
const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-400', running: 'text-sky-400', paused: 'text-orange-400',
  done: 'text-emerald-400', cancelled: 'text-rose-400', active: 'text-emerald-400',
};

// ─── Tab: Contas ──────────────────────────────────────────────────────────────

function ContasTab({ accounts, onRefresh }: { accounts: GmailAccount[]; onRefresh: () => void }) {
  function connectGmail() {
    const w = window.open('/api/auth/google?type=gmail', '_blank', 'width=500,height=650');
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'google_oauth_success') { window.removeEventListener('message', handler); w?.close(); onRefresh(); }
      if (e.data?.type === 'google_oauth_error') { window.removeEventListener('message', handler); alert(e.data.error); }
    };
    window.addEventListener('message', handler);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{accounts.length} conta{accounts.length !== 1 ? 's' : ''} conectada{accounts.length !== 1 ? 's' : ''}</p>
        <button type="button" onClick={connectGmail}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary/90 transition-colors">
          <Plus className="h-4 w-4" />Conectar Gmail
        </button>
      </div>
      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Mail className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">Nenhuma conta conectada</p>
          <p className="text-xs text-muted-foreground mb-4">Conecte uma conta Gmail para começar a enviar e-mails.</p>
          <button type="button" onClick={connectGmail}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary/90">
            <Plus className="h-4 w-4" />Conectar Gmail
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <div key={acc.id} className="flex items-center gap-4 rounded-xl border border-border bg-card/80 p-4">
              {acc.picture
                ? <img src={acc.picture} alt="" className="h-10 w-10 rounded-full border border-border" />
                : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary font-bold">{acc.email[0].toUpperCase()}</div>
              }
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{acc.display_name || acc.email}</p>
                <p className="text-xs text-muted-foreground">{acc.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />Conectado
                </span>
                <span className="text-xs text-muted-foreground">desde {fmtDate(acc.connected_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Nova Campanha ───────────────────────────────────────────────────────

function NovaCampanhaTab({ accounts, onCreated }: { accounts: GmailAccount[]; onCreated: () => void }) {
  const [form, setForm] = useState({
    accountEmail: accounts[0]?.email ?? '',
    name: '',
    subject: '',
    bodyHtml: '',
    recipientsRaw: '',
    intervalMin: 10,
    intervalMax: 30,
    scheduledAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (accounts[0] && !form.accountEmail) setForm((f) => ({ ...f, accountEmail: accounts[0].email }));
  }, [accounts]);

  const recipients = parseRecipients(form.recipientsRaw);

  async function generateVariation() {
    if (!form.bodyHtml.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/whatsapp-variations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: form.bodyHtml, count: 1, type: 'email' }),
      });
      const data = await res.json() as { variations?: string[] };
      if (data.variations?.[0]) setForm((f) => ({ ...f, bodyHtml: data.variations![0] }));
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCreate(startNow: boolean) {
    if (!form.accountEmail || !form.name || !form.subject || !form.bodyHtml || recipients.length === 0) {
      setError('Preencha todos os campos e adicione pelo menos 1 destinatário.'); return;
    }
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/email/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountEmail: form.accountEmail,
          name: form.name,
          subject: form.subject,
          bodyHtml: form.bodyHtml,
          recipients,
          intervalMin: form.intervalMin,
          intervalMax: form.intervalMax,
          scheduledAt: form.scheduledAt || null,
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || !data.id) { setError(data.error ?? 'Erro ao criar'); return; }

      if (startNow) {
        await fetch(`/api/email/campaigns/${data.id}/tick`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-card/80 p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider">Configuração da Campanha</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-bold">Conta Gmail</span>
            <select value={form.accountEmail} onChange={(e) => setForm((f) => ({ ...f, accountEmail: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
              {accounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold">Nome da campanha</span>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Ex: Newsletter Maio 2025" />
          </label>
          <label className="space-y-2 sm:col-span-2">
            <span className="text-xs font-bold">Assunto</span>
            <input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              placeholder="Assunto do e-mail" />
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/80 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider">Corpo do E-mail</h2>
          <button type="button" onClick={generateVariation} disabled={aiLoading || !form.bodyHtml}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50 transition-colors">
            {aiLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            Gerar variação IA
          </button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Suporta HTML. Use <code className="rounded bg-muted px-1">{'{nome}'}</code> e <code className="rounded bg-muted px-1">{'{email}'}</code> como variáveis.</p>
        <textarea value={form.bodyHtml} onChange={(e) => setForm((f) => ({ ...f, bodyHtml: e.target.value }))}
          rows={10}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono outline-none focus:border-primary resize-y"
          placeholder="<p>Olá {nome},</p><p>Seu conteúdo aqui...</p>" />
      </div>

      <div className="rounded-xl border border-border bg-card/80 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wider">Destinatários</h2>
          <span className={cn('text-xs font-bold', recipients.length > 0 ? 'text-emerald-400' : 'text-muted-foreground')}>
            {recipients.length} e-mail{recipients.length !== 1 ? 's' : ''} válido{recipients.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Um por linha, separados por vírgula ou ponto-e-vírgula. Formato: <code className="rounded bg-muted px-1">email</code> ou <code className="rounded bg-muted px-1">Nome &lt;email&gt;</code></p>
        <textarea value={form.recipientsRaw} onChange={(e) => setForm((f) => ({ ...f, recipientsRaw: e.target.value }))}
          rows={6}
          className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono outline-none focus:border-primary resize-y"
          placeholder={"joao@email.com\nMaria Silva <maria@email.com>\ncarlos@email.com"} />
      </div>

      <div className="rounded-xl border border-border bg-card/80 p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider">Intervalo de Envio</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs font-bold">Mínimo (segundos)</span>
            <input type="number" min={5} value={form.intervalMin} onChange={(e) => setForm((f) => ({ ...f, intervalMin: Number(e.target.value) }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold">Máximo (segundos)</span>
            <input type="number" min={5} value={form.intervalMax} onChange={(e) => setForm((f) => ({ ...f, intervalMax: Number(e.target.value) }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-bold">Agendar para (opcional)</span>
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </label>
        </div>
      </div>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={() => handleCreate(false)} disabled={saving}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-bold text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Clock className="h-4 w-4" />Criar sem enviar
        </button>
        <button type="button" onClick={() => handleCreate(true)} disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-50">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Criar e enviar agora
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Fluxos ──────────────────────────────────────────────────────────────

function FluxosTab({ accounts, onOpenBuilder }: {
  accounts: GmailAccount[];
  onOpenBuilder: (flowId: string | null, flow?: Flow) => void;
}) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ accountEmail: accounts[0]?.email ?? '', name: '', recipientsRaw: '' });
  const [steps, setSteps] = useState<FlowStep[]>([{ subject: '', bodyHtml: '', delayDays: 0 }]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/email/flows');
      setFlows(await res.json() as Flow[]);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function addStep() { setSteps((s) => [...s, { subject: '', bodyHtml: '', delayDays: 1 }]); }
  function removeStep(i: number) { setSteps((s) => s.filter((_, j) => j !== i)); }

  async function handleCreate() {
    if (!form.accountEmail || !form.name || steps.some((s) => !s.subject || !s.bodyHtml)) return;
    setSaving(true);
    try {
      const contacts = parseRecipients(form.recipientsRaw);
      const res = await fetch('/api/email/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountEmail: form.accountEmail, name: form.name, steps: steps.map((s) => ({ subject: s.subject, bodyHtml: s.bodyHtml, delayDays: s.delayDays })), contacts }),
      });
      if (res.ok) { setShowNew(false); load(); }
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{flows.length} fluxo{flows.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground">
            <Plus className="h-4 w-4" />Fluxo linear
          </button>
          <button type="button" onClick={() => onOpenBuilder(null)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary/90">
            <GitBranch className="h-4 w-4" />Fluxo visual
          </button>
        </div>
      </div>

      {showNew && (
        <div className="rounded-xl border border-violet-400/30 bg-card/80 p-5 space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider">Novo Fluxo de E-mail</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-bold">Conta Gmail</span>
              <select value={form.accountEmail} onChange={(e) => setForm((f) => ({ ...f, accountEmail: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                {accounts.map((a) => <option key={a.email} value={a.email}>{a.email}</option>)}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-bold">Nome do fluxo</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                placeholder="Ex: Onboarding clientes" />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider">Steps / Etapas</span>
              <button type="button" onClick={addStep}
                className="flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                <Plus className="h-3 w-3" />Adicionar etapa
              </button>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">Etapa {i + 1}</span>
                  {i > 0 && (
                    <button type="button" onClick={() => removeStep(i)} className="text-muted-foreground/50 hover:text-red-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5 sm:col-span-2">
                    <span className="text-xs font-bold">Assunto</span>
                    <input value={step.subject} onChange={(e) => setSteps((s) => s.map((st, j) => j === i ? { ...st, subject: e.target.value } : st))}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" placeholder="Assunto do e-mail" />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-bold">Enviar após (dias)</span>
                    <input type="number" min={0} value={step.delayDays} onChange={(e) => setSteps((s) => s.map((st, j) => j === i ? { ...st, delayDays: Number(e.target.value) } : st))}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
                  </label>
                </div>
                <textarea value={step.bodyHtml} onChange={(e) => setSteps((s) => s.map((st, j) => j === i ? { ...st, bodyHtml: e.target.value } : st))}
                  rows={4} className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono outline-none focus:border-primary resize-y"
                  placeholder="<p>Olá {nome}, ...</p>" />
              </div>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-bold">Contatos (opcional — pode adicionar depois)</span>
            <textarea value={form.recipientsRaw} onChange={(e) => setForm((f) => ({ ...f, recipientsRaw: e.target.value }))}
              rows={3} className="w-full rounded-lg border border-border bg-background p-3 text-sm font-mono outline-none focus:border-primary resize-y"
              placeholder="joao@email.com&#10;Maria <maria@email.com>" />
          </label>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowNew(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground">Cancelar</button>
            <button type="button" onClick={handleCreate} disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
              Criar fluxo
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto h-5 w-5 animate-spin mb-2" />Carregando...</div>
      ) : flows.length === 0 && !showNew ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <GitBranch className="mx-auto h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">Nenhum fluxo criado</p>
          <p className="text-xs text-muted-foreground">Crie sequências automáticas de e-mail para nutrir seus contatos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {flows.map((flow) => (
            <div key={flow.id} className="flex items-center gap-4 rounded-xl border border-border bg-card/80 p-4">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                flow.flow_mode === 'graph' ? 'bg-primary/10 text-primary' : 'bg-violet-500/15 text-violet-400')}>
                <GitBranch className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{flow.name}</p>
                  {flow.flow_mode === 'graph' && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">visual</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{flow.account_email} · {flow.steps_count} etapa{flow.steps_count !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className={cn('font-bold', STATUS_COLOR[flow.status] ?? 'text-muted-foreground')}>{STATUS_LABEL[flow.status] ?? flow.status}</span>
                <span className="text-muted-foreground">{flow.active_contacts} contato{flow.active_contacts !== 1 ? 's' : ''} ativos</span>
                {flow.flow_mode === 'graph' && (
                  <button type="button" onClick={() => onOpenBuilder(flow.id, flow)}
                    className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Dashboard ───────────────────────────────────────────────────────────

function DashboardTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/email/campaigns');
      setCampaigns(await res.json() as Campaign[]);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function action(id: string, act: 'start' | 'pause' | 'cancel') {
    await fetch(`/api/email/campaigns/${id}/tick`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: act }),
    });
    load();
  }

  async function tick(id: string) {
    setTicking(id);
    await fetch(`/api/email/campaigns/${id}/tick`, { method: 'POST' });
    load();
    setTicking(null);
  }

  const totalSent = campaigns.reduce((s, c) => s + c.sent, 0);
  const totalFailed = campaigns.reduce((s, c) => s + c.failed, 0);
  const totalOpens = campaigns.reduce((s, c) => s + (c.unique_opens ?? 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + (c.unique_clicks ?? 0), 0);
  const running = campaigns.filter((c) => c.status === 'running').length;
  const done = campaigns.filter((c) => c.status === 'done').length;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'E-mails enviados', value: totalSent, color: '#55f52f' },
          { label: 'Aberturas únicas', value: totalOpens, color: '#2498ff' },
          { label: 'Cliques únicos', value: totalClicks, color: '#f59e0b' },
          { label: 'Falhas', value: totalFailed, color: '#ff4778' },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-white/5 bg-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{k.label}</p>
            <p className="mt-3 font-heading text-3xl leading-none text-foreground">{k.value.toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>

      {/* Campaigns table */}
      <div className="rounded-xl border border-border bg-card/80 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider">Campanhas</h2>
          <button type="button" onClick={load} className="text-muted-foreground hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
        </div>
        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground"><RefreshCw className="mx-auto h-5 w-5 animate-spin mb-2" />Carregando...</div>
        ) : campaigns.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Nenhuma campanha criada ainda.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/20 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-3 px-5 text-left">Nome</th>
                <th className="py-3 px-4 text-left">Conta</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-center">Progresso</th>
                <th className="py-3 px-4 text-center">Aberturas</th>
                <th className="py-3 px-4 text-center">Cliques</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {campaigns.map((c) => {
                const pct = c.total > 0 ? Math.round((c.sent / c.total) * 100) : 0;
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-5">
                      <p className="font-semibold text-foreground">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-48">{c.subject}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-muted-foreground">{c.account_email}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={cn('text-xs font-bold', STATUS_COLOR[c.status])}>{STATUS_LABEL[c.status]}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
                          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{c.sent}/{c.total}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {c.sent > 0 ? (
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-bold text-sky-400">{c.unique_opens ?? 0}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.sent > 0 ? Math.round(((c.unique_opens ?? 0) / c.sent) * 100) : 0}%
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground/40">—</span>}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {c.sent > 0 ? (
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-bold text-amber-400">{c.unique_clicks ?? 0}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {c.sent > 0 ? Math.round(((c.unique_clicks ?? 0) / c.sent) * 100) : 0}%
                          </span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground/40">—</span>}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {c.status === 'pending' && (
                          <button type="button" onClick={() => action(c.id, 'start')} title="Iniciar"
                            className="rounded p-1.5 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {c.status === 'running' && (
                          <>
                            <button type="button" onClick={() => tick(c.id)} disabled={ticking === c.id} title="Enviar próximo"
                              className="rounded p-1.5 text-muted-foreground hover:text-sky-400 hover:bg-sky-500/10 disabled:opacity-50">
                              {ticking === c.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                            </button>
                            <button type="button" onClick={() => action(c.id, 'pause')} title="Pausar"
                              className="rounded p-1.5 text-muted-foreground hover:text-amber-400 hover:bg-amber-500/10">
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        {c.status === 'paused' && (
                          <button type="button" onClick={() => action(c.id, 'start')} title="Retomar"
                            className="rounded p-1.5 text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10">
                            <Play className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {(c.status !== 'done' && c.status !== 'cancelled') && (
                          <button type="button" onClick={() => action(c.id, 'cancel')} title="Cancelar"
                            className="rounded p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ['dashboard', 'contas', 'campanha', 'fluxos'] as const;
type Tab = typeof TABS[number];

type BuilderState = {
  flowId: string | null;
  name: string;
  accountEmail: string;
  nodes?: Node[];
  edges?: Edge[];
};

export default function EmailMarketingPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [builder, setBuilder] = useState<BuilderState | null>(null);

  async function loadAccounts() {
    const res = await fetch('/api/email/accounts');
    if (res.ok) setAccounts(await res.json() as GmailAccount[]);
  }

  useEffect(() => { loadAccounts(); }, []);

  async function openBuilder(flowId: string | null, flow?: Flow) {
    if (flowId && flow?.flow_mode === 'graph') {
      // Load existing graph
      const res = await fetch(`/api/email/flows/${flowId}`);
      if (res.ok) {
        const data = await res.json() as { flow: { nodes_json: Node[]; edges_json: Edge[]; name: string; account_email: string } };
        setBuilder({
          flowId,
          name: data.flow?.name ?? flow.name,
          accountEmail: data.flow?.account_email ?? flow.account_email,
          nodes: data.flow?.nodes_json ?? undefined,
          edges: data.flow?.edges_json ?? undefined,
        });
        return;
      }
    }
    setBuilder({ flowId: null, name: '', accountEmail: accounts[0]?.email ?? '' });
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 -mt-6 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full shrink-0"
              style={{ background: 'radial-gradient(circle at 35% 35%, #EA4335, #c5221f)', boxShadow: '0 0 18px rgba(234,67,53,0.35)' }}>
              <Mail className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">E-mail Marketing</h1>
              <p className="mt-0.5 text-muted-foreground text-sm">Campanhas e fluxos automáticos via Gmail.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTab('dashboard')}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                tab === 'dashboard' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
              <BarChart2 className="h-3.5 w-3.5" />Dashboard
            </button>
            <button type="button" onClick={() => setTab('contas')}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                tab === 'contas' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
              <Server className="h-3.5 w-3.5" />Contas
              {accounts.length > 0 && <span className="ml-1 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">{accounts.length}</span>}
            </button>
            <button type="button" onClick={() => setTab('fluxos')}
              className={cn('flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                tab === 'fluxos' ? 'border-violet-500/40 bg-violet-500/10 text-violet-400' : 'border-border bg-card text-muted-foreground hover:bg-muted/50')}>
              <GitBranch className="h-3.5 w-3.5" />Fluxos
            </button>
            <button type="button" onClick={() => setTab('campanha')}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 transition-colors">
              <Plus className="h-3.5 w-3.5" />Nova campanha
            </button>
          </div>
        </div>
      </div>

      {accounts.length === 0 && tab !== 'contas' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 flex items-center gap-3">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Nenhuma conta Gmail conectada.{' '}
          <button type="button" onClick={() => setTab('contas')} className="font-bold underline hover:no-underline">Conectar agora</button>
        </div>
      )}

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'contas' && <ContasTab accounts={accounts} onRefresh={loadAccounts} />}
      {tab === 'campanha' && <NovaCampanhaTab accounts={accounts} onCreated={() => setTab('dashboard')} />}
      {tab === 'fluxos' && <FluxosTab accounts={accounts} onOpenBuilder={openBuilder} />}

      {/* Full-screen flow builder overlay */}
      {builder && (
        <FlowBuilder
          flowId={builder.flowId}
          initialName={builder.name}
          initialAccountEmail={builder.accountEmail}
          initialNodes={builder.nodes}
          initialEdges={builder.edges}
          accounts={accounts as FlowBuilderAccount[]}
          onClose={() => setBuilder(null)}
          onSaved={() => { setBuilder(null); setTab('fluxos'); }}
        />
      )}
    </div>
  );
}
