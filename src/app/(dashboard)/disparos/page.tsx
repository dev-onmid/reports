"use client";

import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, Wifi, WifiOff, Play, Pause, X, Upload,
  CheckCircle2, AlertCircle, Clock, RefreshCw, MessageSquare,
  Users, BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type ZClient = {
  id: string;
  name: string;
  instance_id: string;
  active: boolean;
  online?: boolean;
  created_at: string;
};

type Campaign = {
  id: string;
  name: string;
  client_name: string;
  client_id: string;
  message: string;
  image_url: string | null;
  status: 'pending' | 'running' | 'paused' | 'done' | 'cancelled';
  starts_at: string;
  ends_at: string | null;
  interval_min: number;
  interval_max: number;
  total: number;
  sent: number;
  failed: number;
  created_at: string;
};

type Progress = {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  currentPhone?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Agendada',
  running: 'Enviando',
  paused: 'Pausada',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  running: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  paused: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  done: 'bg-primary/15 text-primary border-primary/30',
  cancelled: 'bg-muted/50 text-muted-foreground border-border',
};

// ─── Tab: Clientes ────────────────────────────────────────────────────────────

function ClientesTab() {
  const [clients, setClients] = useState<ZClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', instanceId: '', token: '', securityToken: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { connected: boolean; error?: string; raw?: unknown }>>({});

  useEffect(() => {
    fetch('/api/disparos/clients')
      .then(r => r.json() as Promise<ZClient[]>)
      .then(setClients)
      .finally(() => setLoading(false));
  }, []);

  async function add() {
    if (!form.name || !form.instanceId || !form.token) {
      setError('Preencha nome, Instance ID e Token.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/disparos/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json() as ZClient;
      if (!res.ok) { setError((data as { error?: string }).error ?? 'Erro'); return; }
      setClients(prev => [data, ...prev]);
      setForm({ name: '', instanceId: '', token: '', securityToken: '' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    await fetch('/api/disparos/clients', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setClients(prev => prev.filter(c => c.id !== id));
  }

  async function testConnection(id: string) {
    setTesting(id);
    try {
      const res = await fetch('/api/disparos/clients/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: id }),
      });
      const data = await res.json() as { connected: boolean; error?: string; raw?: unknown };
      setTestResult(prev => ({ ...prev, [id]: data }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Add form */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Nova instância Z-API</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={form.name}
            onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            placeholder="Nome (ex: Clínica A)"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={form.instanceId}
            onChange={e => setForm(p => ({ ...p, instanceId: e.target.value }))}
            placeholder="Instance ID"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={form.token}
            onChange={e => setForm(p => ({ ...p, token: e.target.value }))}
            placeholder="Token"
            type="password"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            value={form.securityToken}
            onChange={e => setForm(p => ({ ...p, securityToken: e.target.value }))}
            placeholder="Client-Token (segurança)"
            type="password"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={add}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Adicionar
        </button>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1,2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : clients.length === 0 ? (
        <div className="rounded-xl border border-border bg-card/50 py-12 text-center">
          <Wifi className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma instância cadastrada.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {clients.map(c => {
            const result = testResult[c.id];
            return (
              <div key={c.id} className="rounded-xl border border-border bg-card px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {result?.connected ? (
                      <Wifi className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : result && !result.connected ? (
                      <WifiOff className="h-4 w-4 shrink-0 text-red-400" />
                    ) : (
                      <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{c.instance_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => testConnection(c.id)}
                      disabled={testing === c.id}
                      className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {testing === c.id
                        ? <RefreshCw className="h-3 w-3 animate-spin" />
                        : <Wifi className="h-3 w-3" />}
                      Testar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="rounded-lg border border-red-500/20 p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {result && (
                  <div className={cn('rounded-lg px-3 py-2 text-[11px]', result.connected ? 'bg-emerald-500/10 text-emerald-400 font-semibold' : 'bg-red-500/10 text-red-400 space-y-1')}>
                    {result.connected ? (
                      '✓ Instância conectada e funcionando'
                    ) : (
                      <>
                        <p className="font-semibold">✗ {result.error ?? 'Não conectada — verifique o WhatsApp no painel Z-API.'}</p>
                        <p className="opacity-70">Verifique se o Instance ID e Token estão corretos no painel <strong>app.z-api.io</strong> → sua instância → API.</p>
                        {result.raw && (
                          <pre className="mt-1 text-[10px] opacity-50 whitespace-pre-wrap break-all">{JSON.stringify(result.raw, null, 2)}</pre>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Nova Campanha ────────────────────────────────────────────────────────

function NovaCampanhaTab({ onCreated }: { onCreated: () => void }) {
  const [clients, setClients] = useState<ZClient[]>([]);
  const [form, setForm] = useState({
    clientId: '',
    name: '',
    message: '',
    numbers: '',
    startsAt: '',
    endsAt: '',
    intervalMin: 5,
    intervalMax: 15,
  });
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/disparos/clients')
      .then(r => r.json() as Promise<ZClient[]>)
      .then(data => {
        setClients(data);
        if (data[0]) setForm(p => ({ ...p, clientId: data[0].id }));
      });
  }, []);

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = () => setImageUrl(reader.result as string);
      reader.readAsDataURL(file);
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!form.clientId || !form.name || !form.message || !form.numbers || !form.startsAt) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/disparos/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, imageUrl: imageUrl || undefined }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Erro ao criar campanha.'); return; }
      setForm({ clientId: clients[0]?.id ?? '', name: '', message: '', numbers: '', startsAt: '', endsAt: '', intervalMin: 5, intervalMax: 15 });
      setImageUrl('');
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="grid gap-4">
        {/* Name + Client */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome da campanha *</label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Ex: Promoção Janeiro"
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Instância Z-API *</label>
            <select
              value={form.clientId}
              onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            >
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Message */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Mensagem * <span className="normal-case font-normal text-muted-foreground/60">— use {'{nome}'} e {'{telefone}'}</span>
          </label>
          <textarea
            value={form.message}
            onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
            placeholder="Olá {nome}, temos uma novidade para você!"
            rows={4}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary resize-none"
          />
        </div>

        {/* Image */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Imagem (opcional)</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              {uploading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {imageUrl ? 'Trocar imagem' : 'Selecionar imagem'}
            </button>
            {imageUrl && (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="preview" className="h-10 w-10 rounded object-cover border border-border" />
                <button type="button" onClick={() => setImageUrl('')}>
                  <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => e.target.files?.[0] && uploadImage(e.target.files[0])}
            />
          </div>
        </div>

        {/* Numbers */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Números * <span className="normal-case font-normal text-muted-foreground/60">— um por linha, aceita qualquer formato</span>
          </label>
          <textarea
            value={form.numbers}
            onChange={e => setForm(p => ({ ...p, numbers: e.target.value }))}
            placeholder={"(43) 9 9999-1111,João\n11 98888-7777\n+55 43 9 6666-4444,Maria"}
            rows={6}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-primary resize-none"
          />
          {form.numbers && (
            <p className="text-[11px] text-muted-foreground">
              {form.numbers.split('\n').filter(l => l.trim()).length} linha(s) inserida(s)
            </p>
          )}
        </div>

        {/* Dates */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Início *</label>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={e => setForm(p => ({ ...p, startsAt: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Término (opcional)</label>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={e => setForm(p => ({ ...p, endsAt: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Intervals */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Intervalo mínimo (seg) *</label>
            <input
              type="number"
              min={1}
              value={form.intervalMin}
              onChange={e => setForm(p => ({ ...p, intervalMin: Number(e.target.value) }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Intervalo máximo (seg) *</label>
            <input
              type="number"
              min={1}
              value={form.intervalMax}
              onChange={e => setForm(p => ({ ...p, intervalMax: Number(e.target.value) }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={create}
        disabled={saving}
        className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Criar campanha
      </button>
    </div>
  );
}

// ─── Campaign Card ─────────────────────────────────────────────────────────────

type TickResult = {
  status: string;
  done?: boolean;
  total?: number;
  sent?: number;
  failed?: number;
  lastPhone?: string;
};

function CampaignCard({ campaign, onAction, onRefresh }: {
  campaign: Campaign;
  onAction: (id: string, action: string) => void;
  onRefresh: () => void;
}) {
  const [live, setLive] = useState<Progress | null>(null);
  const [tickError, setTickError] = useState('');
  const runningRef = useRef(false);

  const isRunning = campaign.status === 'running';

  useEffect(() => {
    if (!isRunning) { runningRef.current = false; return; }
    runningRef.current = true;
    setTickError('');

    const intervalMin = Math.max(campaign.interval_min * 1000, 1000);
    const intervalMax = Math.max(campaign.interval_max * 1000, intervalMin);

    async function tick() {
      if (!runningRef.current) return;
      try {
        const res = await fetch(`/api/disparos/campaigns/${campaign.id}/tick`, { method: 'POST' });
        const data = await res.json() as TickResult & { error?: string };

        if (!res.ok) {
          setTickError(data.error ?? `Erro HTTP ${res.status}`);
          setTimeout(() => { if (runningRef.current) tick(); }, 5000);
          return;
        }

        setTickError('');
        setLive({
          campaignId: campaign.id,
          total: data.total ?? campaign.total,
          sent: data.sent ?? campaign.sent,
          failed: data.failed ?? campaign.failed,
          status: data.status,
          currentPhone: data.lastPhone,
        });

        if (data.done || data.status !== 'running') {
          runningRef.current = false;
          onRefresh();
          return;
        }

        const delay = Math.floor(Math.random() * (intervalMax - intervalMin + 1)) + intervalMin;
        setTimeout(() => { if (runningRef.current) tick(); }, delay);
      } catch (err) {
        setTickError(`Erro de conexão: ${String(err)}`);
        setTimeout(() => { if (runningRef.current) tick(); }, 5000);
      }
    }

    tick();
    return () => { runningRef.current = false; };
  }, [isRunning, campaign.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = live?.total ?? campaign.total;
  const sent = live?.sent ?? campaign.sent;
  const failed = live?.failed ?? campaign.failed;
  const status = (live?.status ?? campaign.status) as Campaign['status'];
  const pct = total > 0 ? Math.round(((sent + failed) / total) * 100) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{campaign.name}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{campaign.client_name}</p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', STATUS_COLOR[status])}>
          {STATUS_LABEL[status] ?? status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', status === 'running' ? 'bg-primary' : 'bg-muted-foreground/40')}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{sent + failed} / {total} processados</span>
          <span>{pct}%</span>
        </div>
      </div>

      {/* Counters */}
      <div className="flex gap-4 text-[11px]">
        <span className="flex items-center gap-1 text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />{sent} enviados
        </span>
        <span className="flex items-center gap-1 text-red-400">
          <AlertCircle className="h-3 w-3" />{failed} falhas
        </span>
        {live?.currentPhone && status === 'running' && (
          <span className="flex items-center gap-1 text-muted-foreground font-mono truncate">
            <Clock className="h-3 w-3" />{live.currentPhone}
          </span>
        )}
      </div>

      {tickError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-[11px] text-red-400">
          {tickError}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1 border-t border-border">
        {status === 'running' && (
          <button
            type="button"
            onClick={() => onAction(campaign.id, 'pause')}
            className="flex items-center gap-1 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-400 hover:bg-orange-500/20"
          >
            <Pause className="h-3 w-3" />Pausar
          </button>
        )}
        {(status === 'paused' || status === 'pending') && (
          <button
            type="button"
            onClick={() => onAction(campaign.id, status === 'paused' ? 'resume' : 'start')}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/20"
          >
            <Play className="h-3 w-3" />{status === 'paused' ? 'Retomar' : 'Iniciar'}
          </button>
        )}
        {(status === 'running' || status === 'paused' || status === 'pending') && (
          <button
            type="button"
            onClick={() => onAction(campaign.id, 'cancel')}
            className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-semibold text-red-400 hover:bg-red-500/20"
          >
            <X className="h-3 w-3" />Cancelar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Dashboard ────────────────────────────────────────────────────────────

function DashboardTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const data = await fetch('/api/disparos/campaigns').then(r => r.json() as Promise<Campaign[]>);
    setCampaigns(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(id: string, action: string) {
    await fetch(`/api/disparos/campaigns/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    load();
  }

  const active = campaigns.filter(c => ['running', 'paused', 'pending'].includes(c.status));
  const done = campaigns.filter(c => ['done', 'cancelled'].includes(c.status));

  if (loading) return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[1,2,3].map(i => <div key={i} className="h-48 animate-pulse rounded-xl border border-border bg-card" />)}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Campanhas ativas', value: active.length, icon: MessageSquare },
          { label: 'Total enviados', value: campaigns.reduce((s, c) => s + c.sent, 0).toLocaleString('pt-BR'), icon: CheckCircle2 },
          { label: 'Total falhas', value: campaigns.reduce((s, c) => s + c.failed, 0).toLocaleString('pt-BR'), icon: AlertCircle },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Active campaigns */}
      {active.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Em andamento</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map(c => <CampaignCard key={c.id} campaign={c} onAction={handleAction} onRefresh={load} />)}
          </div>
        </div>
      )}

      {/* History */}
      {done.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Histórico</p>
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Campanha</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Instância</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Enviados</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Falhas</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {done.map(c => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{c.client_name}</td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{c.sent}</td>
                    <td className="px-4 py-3 text-right text-red-400 font-semibold">{c.failed}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', STATUS_COLOR[c.status])}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {campaigns.length === 0 && (
        <div className="rounded-xl border border-border bg-card/50 py-16 text-center">
          <BarChart2 className="mx-auto h-10 w-10 text-muted-foreground/30 mb-4" />
          <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ['dashboard', 'clientes', 'nova'] as const;
type Tab = typeof TABS[number];

const TAB_LABEL: Record<Tab, string> = {
  dashboard: 'Dashboard',
  clientes: 'Instâncias',
  nova: 'Nova Campanha',
};

const TAB_ICON: Record<Tab, React.ElementType> = {
  dashboard: BarChart2,
  clientes: Users,
  nova: Plus,
};

export default function DisparosPage() {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 -mt-6 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-4xl uppercase tracking-wider">Disparos WhatsApp</h1>
            <p className="mt-0.5 text-muted-foreground text-sm">Gerencie campanhas de disparo via Z-API.</p>
          </div>
          <div className="flex items-center gap-2">
            {TABS.map(t => {
              const Icon = TAB_ICON[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors',
                    tab === t
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {TAB_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'clientes' && <ClientesTab />}
      {tab === 'nova' && <NovaCampanhaTab onCreated={() => setTab('dashboard')} />}
    </div>
  );
}
