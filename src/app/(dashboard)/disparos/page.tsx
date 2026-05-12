"use client";

import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, Wifi, WifiOff, Play, Pause, X, Upload,
  CheckCircle2, AlertCircle, Clock, RefreshCw, MessageSquare,
  Users, BarChart2, ChevronDown, Copy,
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
  active_from: string | null;
  active_until: string | null;
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

function NovaCampanhaTab({ onCreated, prefill }: { onCreated: () => void; prefill?: CampaignPrefill | null }) {
  const [clients, setClients] = useState<ZClient[]>([]);
  const [form, setForm] = useState({
    clientId: '',
    name: '',
    message: '',
    numbers: '',
    isNow: true,
    startsAt: '',
    endsAt: '',
    activeFrom: '',
    activeUntil: '',
    intervalMin: 5,
    intervalMax: 15,
  });
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/disparos/clients')
      .then(r => r.json() as Promise<ZClient[]>)
      .then(data => {
        setClients(data);
        if (data[0]) setForm(p => ({ ...p, clientId: p.clientId || data[0].id }));
      });
  }, []);

  useEffect(() => {
    if (!prefill) return;
    setForm({
      clientId: prefill.clientId,
      name: prefill.name + ' (cópia)',
      message: prefill.message,
      numbers: prefill.numbers,
      isNow: true,
      startsAt: '',
      endsAt: '',
      activeFrom: prefill.activeFrom ?? '',
      activeUntil: prefill.activeUntil ?? '',
      intervalMin: prefill.intervalMin,
      intervalMax: prefill.intervalMax,
    });
    setImageUrls(prefill.imageUrls ?? []);
  }, [prefill]);

  function addImages(files: FileList | null) {
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Resize to max 1200px and compress to JPEG 85% to reduce payload size
          const MAX = 1200;
          const scale = img.width > MAX ? MAX / img.width : 1;
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          setImageUrls(prev => [...prev, canvas.toDataURL('image/jpeg', 0.85)]);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  // Convert datetime-local string (local) to proper ISO (UTC) to avoid server timezone issues
  function toISO(local: string) { return local ? new Date(local).toISOString() : ''; }
  // Convert local HH:MM to UTC HH:MM for active window comparison on server
  function localTimeToUTC(hhmm: string) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }

  async function create() {
    if (!form.clientId || !form.name || !form.message || !form.numbers) {
      setError('Preencha todos os campos obrigatórios.');
      return;
    }
    if (!form.isNow && !form.startsAt) {
      setError('Selecione o horário de início ou escolha "Agora".');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const startsAt = form.isNow ? new Date().toISOString() : toISO(form.startsAt);
      const endsAt = form.endsAt ? toISO(form.endsAt) : undefined;
      const activeFrom = form.activeFrom && form.activeUntil ? localTimeToUTC(form.activeFrom) : undefined;
      const activeUntil = form.activeFrom && form.activeUntil ? localTimeToUTC(form.activeUntil) : undefined;

      const res = await fetch('/api/disparos/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId, name: form.name, message: form.message,
          numbers: form.numbers, startsAt, endsAt, activeFrom, activeUntil,
          intervalMin: form.intervalMin, intervalMax: form.intervalMax,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Erro ao criar campanha.'); return; }
      setForm({ clientId: clients[0]?.id ?? '', name: '', message: '', numbers: '', isNow: true, startsAt: '', endsAt: '', activeFrom: '', activeUntil: '', intervalMin: 5, intervalMax: 15 });
      setImageUrls([]);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-stretch">
    <div className="space-y-5">
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

        {/* Images */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Imagens (opcional) <span className="normal-case font-normal text-muted-foreground/60">— primeira imagem receberá o texto como legenda</span>
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            {imageUrls.map((url, idx) => (
              <div key={idx} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
                {idx === 0 && imageUrls.length > 0 && (
                  <span className="absolute bottom-0 left-0 right-0 text-center text-[8px] bg-black/50 text-white rounded-b-lg py-0.5">1ª</span>
                )}
                <button
                  type="button"
                  onClick={() => setImageUrls(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-2.5 w-2.5 text-foreground" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="h-16 w-16 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors"
            >
              <Upload className="h-4 w-4" />
              <span className="text-[9px] font-semibold">Adicionar</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => { addImages(e.target.files); e.target.value = ''; }}
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

        {/* Start */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Início *</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, isNow: true, startsAt: '' }))}
              className={cn(
                'h-9 rounded-lg border px-4 text-xs font-bold uppercase tracking-wider transition-colors',
                form.isNow ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
              )}
            >
              Agora
            </button>
            <button
              type="button"
              onClick={() => setForm(p => ({ ...p, isNow: false }))}
              className={cn(
                'h-9 rounded-lg border px-4 text-xs font-bold uppercase tracking-wider transition-colors',
                !form.isNow ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:bg-muted/50',
              )}
            >
              Agendar
            </button>
          </div>
          {!form.isNow && (
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={e => setForm(p => ({ ...p, startsAt: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          )}
          {form.isNow && (
            <p className="text-[11px] text-muted-foreground">A campanha inicia imediatamente ao clicar em Criar.</p>
          )}
        </div>

        {/* End date + active window */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Término (opcional)</label>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={e => setForm(p => ({ ...p, endsAt: e.target.value }))}
              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Horário de envio (opcional)
              <span className="ml-1 normal-case font-normal text-muted-foreground/60">— pausa fora desse período</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={form.activeFrom}
                onChange={e => setForm(p => ({ ...p, activeFrom: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground shrink-0">até</span>
              <input
                type="time"
                value={form.activeUntil}
                onChange={e => setForm(p => ({ ...p, activeUntil: e.target.value }))}
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {form.activeFrom && form.activeUntil && (
              <p className="text-[11px] text-muted-foreground">Envios apenas das {form.activeFrom} às {form.activeUntil}.</p>
            )}
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

    {/* WhatsApp Preview */}
    <div className="h-full">
      <WhatsAppPreview images={imageUrls} message={form.message} />
    </div>
  </div>
  );
}

// ─── Campaign Card ─────────────────────────────────────────────────────────────

type TickResult = {
  status: string;
  done?: boolean;
  sleeping?: boolean;
  total?: number;
  sent?: number;
  failed?: number;
  lastPhone?: string;
  lastError?: string | null;
};

type NumberDetail = {
  phone: string;
  name: string | null;
  status: string;
  error_msg: string | null;
  sent_at: string | null;
};

type CampaignPrefill = {
  clientId: string;
  name: string;
  message: string;
  numbers: string;
  imageUrls?: string[];
  intervalMin: number;
  intervalMax: number;
  activeFrom?: string;
  activeUntil?: string;
};

// ─── WhatsApp text formatter ──────────────────────────────────────────────────

function parseWASegments(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rem = text;
  let ki = 0;
  while (rem) {
    const b = rem.match(/^\*([^*\n]+)\*/);
    const i = rem.match(/^_([^_\n]+)_/);
    const s = rem.match(/^~([^~\n]+)~/);
    const m = rem.match(/^`([^`\n]+)`/);
    if (b) { nodes.push(<strong key={ki++}>{b[1]}</strong>); rem = rem.slice(b[0].length); }
    else if (i) { nodes.push(<em key={ki++}>{i[1]}</em>); rem = rem.slice(i[0].length); }
    else if (s) { nodes.push(<del key={ki++}>{s[1]}</del>); rem = rem.slice(s[0].length); }
    else if (m) { nodes.push(<code key={ki++} className="font-mono text-[11px] bg-black/10 px-0.5 rounded">{m[1]}</code>); rem = rem.slice(m[0].length); }
    else { nodes.push(rem[0]); rem = rem.slice(1); }
  }
  return nodes;
}

function formatWAText(text: string): React.ReactNode[] {
  return text.split('\n').flatMap((line, i, arr) => {
    const segs = parseWASegments(line);
    return i < arr.length - 1 ? [...segs, <br key={`br${i}`} />] : segs;
  });
}

// ─── WhatsApp Preview component ───────────────────────────────────────────────

function WhatsAppPreview({ images, message }: { images: string[]; message: string }) {
  const preview = message
    .replace(/\{nome\}/g, 'João Silva')
    .replace(/\{telefone\}/g, '43 9 9999-1111');

  const now = new Date();
  const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
  const hasContent = images.length > 0 || preview.trim();

  return (
    <div className="h-full flex flex-col gap-2 min-h-[500px]">
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground shrink-0">Preview</p>

      {/* Phone — fills 100% of right column height */}
      <div className="select-none flex-1 flex flex-col rounded-3xl border-[3px] border-zinc-700 bg-zinc-950 p-2 shadow-2xl overflow-hidden">
        <div className="rounded-[1.4rem] overflow-hidden flex-1 flex flex-col min-h-0">

          {/* Status bar */}
          <div className="bg-[#075E54] px-4 pt-2 pb-1 flex justify-between items-center shrink-0">
            <span className="text-white text-[11px] font-semibold">{time}</span>
            <span className="text-white text-[11px]">📶 🔋</span>
          </div>

          {/* WA header */}
          <div className="bg-[#128C7E] px-4 py-3 flex items-center gap-3 shrink-0 border-b border-[#0d7a6e]">
            <div className="h-10 w-10 rounded-full bg-[#075E54] flex items-center justify-center shrink-0 text-white font-bold text-lg shadow">
              M
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold text-sm truncate">Minha Empresa</p>
              <p className="text-[#d0f0eb] text-xs">online</p>
            </div>
          </div>

          {/* Chat background — fills remaining space */}
          <div className="bg-[#E5DDD5] flex-1 min-h-0 overflow-y-auto flex flex-col justify-end p-4 gap-3">
            {hasContent ? (
              <>
                {images.slice(1).map((img, idx) => (
                  <div key={idx} className="self-end rounded-2xl rounded-tr-sm overflow-hidden shadow" style={{ background: '#DCF8C6', maxWidth: '82%' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-full object-cover" style={{ maxHeight: '220px' }} />
                    <div className="flex justify-end px-3 py-1">
                      <span className="text-[10px] text-black/40">{time} <span className="text-[#53BDEB]">✓✓</span></span>
                    </div>
                  </div>
                ))}
                <div className="self-end rounded-2xl rounded-tr-sm overflow-hidden shadow" style={{ background: '#DCF8C6', maxWidth: '85%' }}>
                  {images[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[0]} alt="" className="w-full object-cover" style={{ maxHeight: '240px' }} />
                  )}
                  {preview.trim() && (
                    <div className="px-3 pt-2 pb-1 text-[14px] text-black/90 leading-snug break-words">
                      {formatWAText(preview)}
                    </div>
                  )}
                  <div className="flex justify-end px-3 pb-2 gap-1 items-center">
                    <span className="text-[11px] text-black/40">{time}</span>
                    <span className="text-[11px] text-[#53BDEB]">✓✓</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center py-10">
                <p className="text-sm text-black/30 text-center px-8 leading-relaxed">
                  Digite uma mensagem para ver o preview
                </p>
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="bg-[#F0F0F0] px-3 py-2.5 flex items-center gap-2 shrink-0">
            <div className="flex-1 bg-white rounded-full px-4 py-2 shadow-sm">
              <span className="text-xs text-black/25">Mensagem</span>
            </div>
            <div className="h-9 w-9 rounded-full bg-[#128C7E] flex items-center justify-center shrink-0 shadow">
              <span className="text-base">🎤</span>
            </div>
          </div>

        </div>
      </div>

      <p className="text-center text-[10px] text-muted-foreground/40 shrink-0">Simulação — layout pode variar</p>
    </div>
  );
}

function CampaignCard({ campaign, onAction, onRefresh }: {
  campaign: Campaign;
  onAction: (id: string, action: string) => void;
  onRefresh: () => void;
}) {
  const [live, setLive] = useState<Progress | null>(null);
  const [tickError, setTickError] = useState('');
  const [lastSendError, setLastSendError] = useState<string | null>(null);
  const [sleeping, setSleeping] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [numbers, setNumbers] = useState<NumberDetail[] | null>(null);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const runningRef = useRef(false);

  const isRunning = campaign.status === 'running';

  async function loadNumbers() {
    setLoadingNumbers(true);
    const data = await fetch(`/api/disparos/campaigns/${campaign.id}/numbers`).then(r => r.json() as Promise<NumberDetail[]>);
    setNumbers(data);
    setLoadingNumbers(false);
  }

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

        if (data.sleeping) {
          setSleeping(true);
          // Outside active window — check again in 60 seconds
          setTimeout(() => { if (runningRef.current) tick(); }, 60_000);
          return;
        }

        setSleeping(false);
        if (data.lastError) setLastSendError(data.lastError);
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

      {sleeping && status === 'running' && (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2 text-[11px] text-yellow-400 flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Fora do horário de envio — aguardando janela...
        </div>
      )}

      {tickError && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-[11px] text-red-400">
          {tickError}
        </div>
      )}

      {lastSendError && !tickError && (
        <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 px-3 py-2 text-[11px] text-orange-400">
          Último erro Z-API: {lastSendError}
        </div>
      )}

      {/* Details panel */}
      {failed > 0 && (
        <button
          type="button"
          onClick={() => {
            setShowDetails(v => !v);
            if (!numbers) loadNumbers();
          }}
          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 text-left"
        >
          {loadingNumbers ? 'Carregando...' : showDetails ? 'Ocultar detalhes' : `Ver detalhes dos ${failed} erro(s)`}
        </button>
      )}

      {showDetails && numbers && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Número</th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Status</th>
                <th className="px-2 py-1.5 text-left font-semibold text-muted-foreground">Erro</th>
              </tr>
            </thead>
            <tbody>
              {numbers.filter(n => n.status === 'failed').map(n => (
                <tr key={n.phone} className="border-b border-border last:border-0">
                  <td className="px-2 py-1.5 font-mono">{n.phone}</td>
                  <td className="px-2 py-1.5 text-red-400 font-semibold">Falha</td>
                  <td className="px-2 py-1.5 text-muted-foreground break-all">{n.error_msg ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

function DashboardTab({ onReuse }: { onReuse: (p: CampaignPrefill) => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedNumbers, setExpandedNumbers] = useState<Record<string, NumberDetail[]>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

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

  async function fetchNumbers(id: string): Promise<NumberDetail[]> {
    if (expandedNumbers[id]) return expandedNumbers[id];
    setLoadingDetail(id);
    const data = await fetch(`/api/disparos/campaigns/${id}/numbers`).then(r => r.json() as Promise<NumberDetail[]>);
    setExpandedNumbers(prev => ({ ...prev, [id]: data }));
    setLoadingDetail(null);
    return data;
  }

  async function handleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    fetchNumbers(id);
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Excluir esta campanha permanentemente?')) return;
    setDeleting(id);
    await fetch(`/api/disparos/campaigns/${id}`, { method: 'DELETE' });
    setDeleting(null);
    setExpandedId(null);
    load();
  }

  async function handleReuse(c: Campaign) {
    const nums = await fetchNumbers(c.id);
    const numbers = nums.map(n => n.name ? `${n.phone},${n.name}` : n.phone).join('\n');
    let imageUrls: string[] = [];
    if (c.image_url) {
      if (c.image_url.startsWith('[')) {
        try { imageUrls = JSON.parse(c.image_url); } catch { imageUrls = [c.image_url]; }
      } else {
        imageUrls = [c.image_url];
      }
    }
    onReuse({
      clientId: c.client_id,
      name: c.name,
      message: c.message,
      numbers,
      imageUrls,
      intervalMin: c.interval_min,
      intervalMax: c.interval_max,
      activeFrom: c.active_from ?? undefined,
      activeUntil: c.active_until ?? undefined,
    });
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
          <div className="space-y-2">
            {done.map(c => {
              const isExpanded = expandedId === c.id;
              const nums = expandedNumbers[c.id];
              return (
                <div key={c.id} className="rounded-xl border border-border overflow-hidden bg-card">
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">{c.client_name}</p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] shrink-0">
                      <span className="text-emerald-400 font-semibold">{c.sent} enviados</span>
                      {c.failed > 0 && <span className="text-red-400 font-semibold">{c.failed} falhas</span>}
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', STATUS_COLOR[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </span>
                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title="Ver detalhes"
                        onClick={() => handleExpand(c.id)}
                        className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      >
                        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                      </button>
                      <button
                        type="button"
                        title="Reaproveitar campanha"
                        onClick={() => handleReuse(c)}
                        className="rounded-lg border border-border bg-background p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 hover:border-primary/30 transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Excluir campanha"
                        onClick={() => handleDelete(c.id)}
                        disabled={deleting === c.id}
                        className="rounded-lg border border-red-500/20 bg-background p-1.5 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {deleting === c.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Expandable detail */}
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/20 p-3">
                      {loadingDetail === c.id || !nums ? (
                        <p className="text-[11px] text-muted-foreground animate-pulse">Carregando...</p>
                      ) : nums.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">Nenhum número registrado.</p>
                      ) : (
                        <div className="rounded-lg border border-border overflow-hidden">
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr className="bg-muted/40 border-b border-border">
                                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Número</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Nome</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Status</th>
                                <th className="px-3 py-1.5 text-left font-semibold text-muted-foreground">Erro / Detalhes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {nums.map((n, i) => (
                                <tr key={i} className="border-b border-border last:border-0">
                                  <td className="px-3 py-1.5 font-mono">{n.phone}</td>
                                  <td className="px-3 py-1.5 text-muted-foreground">{n.name || '—'}</td>
                                  <td className={cn('px-3 py-1.5 font-semibold',
                                    n.status === 'sent' ? 'text-emerald-400' :
                                    n.status === 'failed' ? 'text-red-400' : 'text-muted-foreground'
                                  )}>
                                    {n.status === 'sent' ? 'Enviado' : n.status === 'failed' ? 'Falha' : n.status}
                                  </td>
                                  <td className="px-3 py-1.5 text-muted-foreground break-all">
                                    {n.error_msg || (n.sent_at ? new Date(n.sent_at).toLocaleString('pt-BR') : '—')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
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
  const [prefill, setPrefill] = useState<CampaignPrefill | null>(null);

  function handleReuse(p: CampaignPrefill) {
    setPrefill(p);
    setTab('nova');
  }

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

      {tab === 'dashboard' && <DashboardTab onReuse={handleReuse} />}
      {tab === 'clientes' && <ClientesTab />}
      {tab === 'nova' && (
        <NovaCampanhaTab
          key={prefill ? JSON.stringify(prefill).slice(0, 40) : 'new'}
          prefill={prefill}
          onCreated={() => { setPrefill(null); setTab('dashboard'); }}
        />
      )}
    </div>
  );
}
