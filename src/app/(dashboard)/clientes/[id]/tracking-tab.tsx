'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Copy, Check, Trash2, Plus, RefreshCw, Eye, EyeOff,
  Settings2, MessageCircle, ShoppingCart, X, TrendingUp, Wifi, WifiOff, QrCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type WhatsAppProvider = 'zapi' | 'evolution';

type TrackingConfig = {
  pixel_id: string;
  meta_token: string;
  gatilho_compra: string;
  eventos_ativos: { lead: boolean; purchase: boolean };
  whatsapp_provider: WhatsAppProvider;
};

type Instance = {
  id: string;
  nome: string;
  instance_id: string;
  token: string;
  ativo: boolean;
  provider: WhatsAppProvider;
  created_at: string;
};

type WaLead = {
  id: string;
  telefone: string;
  ctwa_clid: string | null;
  source_id: string | null;
  campanha: string | null;
  pixel_id: string | null;
  evento_lead_enviado: boolean;
  evento_compra_enviado: boolean;
  valor_compra: number | null;
  created_at: string;
};

type ConnState = 'open' | 'close' | 'connecting' | 'unknown' | 'n/a';

type LeadPeriod = '7d' | '30d' | '90d';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

function maskPhone(phone: string): string {
  if (phone.length >= 10) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ****-${phone.slice(-4)}`;
  }
  return `****${phone.slice(-4)}`;
}

function toSlug(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted">
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {label ?? (copied ? 'Copiado!' : 'Copiar')}
    </button>
  );
}

function StateBadge({ state }: { state: ConnState }) {
  if (state === 'n/a') return null;
  const map: Record<ConnState, { label: string; className: string; dot: string }> = {
    open:       { label: 'Conectado',    className: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400' },
    connecting: { label: 'Aguardando',   className: 'bg-yellow-500/15  text-yellow-400',  dot: 'bg-yellow-400' },
    close:      { label: 'Desconectado', className: 'bg-muted text-muted-foreground',      dot: 'bg-muted-foreground' },
    unknown:    { label: 'Desconectado', className: 'bg-muted text-muted-foreground',      dot: 'bg-muted-foreground' },
    'n/a':      { label: '',             className: '',                                    dot: '' },
  };
  const s = map[state] ?? map.unknown;
  return (
    <span className={cn('flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold', s.className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function ClientTrackingTab({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<TrackingConfig>({
    pixel_id: '', meta_token: '',
    gatilho_compra: 'compra aprovada',
    eventos_ativos: { lead: true, purchase: true },
    whatsapp_provider: 'zapi',
  });
  const [instances, setInstances]   = useState<Instance[]>([]);
  const [leads, setLeads]           = useState<WaLead[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [showToken, setShowToken]   = useState(false);

  // Instance statuses (Evolution only)
  const [statuses, setStatuses] = useState<Record<string, ConnState>>({});
  const statusTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // New instance modal
  const [showModal, setShowModal]     = useState(false);
  const [instProvider, setInstProvider] = useState<WhatsAppProvider>('zapi');
  const [instForm, setInstForm]       = useState({ nome: '', instance_id: '', token: '' });
  const [instError, setInstError]     = useState('');
  const [adding, setAdding]           = useState(false);

  // QR modal
  const [qrInst, setQrInst]           = useState<Instance | null>(null);
  const [qrData, setQrData]           = useState<{ base64?: string; code?: string } | null>(null);
  const [qrLoading, setQrLoading]     = useState(false);

  // Leads
  const [period, setPeriod]   = useState<LeadPeriod>('30d');
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 } as const;

  // ── Status polling ───────────────────────────────────────────────────────

  const fetchStatuses = useCallback((insts: Instance[]) => {
    insts
      .filter(i => i.provider === 'evolution')
      .forEach(inst => {
        fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}/status`)
          .then(r => r.ok ? r.json() as Promise<{ state: string }> : null)
          .then(d => {
            if (d?.state) setStatuses(prev => ({ ...prev, [inst.id]: d.state as ConnState }));
          })
          .catch(() => {});
      });
  }, [clientId]);

  useEffect(() => {
    if (statusTimer.current) clearInterval(statusTimer.current);
    fetchStatuses(instances);
    const hasEvolution = instances.some(i => i.provider === 'evolution');
    if (hasEvolution) {
      statusTimer.current = setInterval(() => fetchStatuses(instances), 30_000);
    }
    return () => { if (statusTimer.current) clearInterval(statusTimer.current); };
  }, [instances, fetchStatuses]);

  // ── Initial load ─────────────────────────────────────────────────────────

  const loadLeads = useCallback((p: LeadPeriod) => {
    fetch(`/api/clients/${clientId}/tracking/leads?days=${periodDays[p]}`)
      .then(r => r.ok ? r.json() as Promise<WaLead[]> : [])
      .then(setLeads)
      .catch(() => setLeads([]));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/clients/${clientId}/tracking`).then(r => r.ok ? r.json() as Promise<TrackingConfig> : null),
      fetch(`/api/clients/${clientId}/tracking/instances`).then(r => r.ok ? r.json() as Promise<Instance[]> : []),
      fetch(`/api/clients/${clientId}/tracking/leads?days=30`).then(r => r.ok ? r.json() as Promise<WaLead[]> : []),
    ]).then(([cfg, insts, ls]) => {
      if (cfg) setConfig(cfg);
      setInstances(insts ?? []);
      setLeads(ls ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    if (!loading) loadLeads(period);
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Config save ──────────────────────────────────────────────────────────

  async function saveConfig() {
    setSaving(true);
    try {
      await fetch(`/api/clients/${clientId}/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    } finally {
      setSaving(false);
    }
  }

  // ── Instance CRUD ────────────────────────────────────────────────────────

  function openAddModal() {
    setInstForm({ nome: '', instance_id: '', token: '' });
    setInstProvider('zapi');
    setInstError('');
    setShowModal(true);
  }

  async function addInstance() {
    setInstError('');
    if (!instForm.nome) { setInstError('Nome é obrigatório.'); return; }
    if (instProvider === 'zapi' && (!instForm.instance_id || !instForm.token)) {
      setInstError('Instance ID e Token são obrigatórios para Z-API.'); return;
    }
    if (instProvider === 'evolution' && !instForm.instance_id) {
      setInstError('Nome da instância Evolution API é obrigatório.'); return;
    }
    if (instProvider === 'evolution' && /\s/.test(instForm.instance_id)) {
      setInstError('O nome da instância não pode ter espaços. Use hífens: ex. celular-matheus'); return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...instForm, provider: instProvider }),
      });
      const data = await res.json() as Instance & { error?: string };
      if (!res.ok) { setInstError(data.error ?? 'Erro ao salvar instância.'); return; }
      setInstances(prev => [...prev, data]);
      setShowModal(false);
    } finally {
      setAdding(false);
    }
  }

  async function removeInstance(inst: Instance) {
    const label = inst.provider === 'evolution'
      ? 'Remover instância e deletar na Evolution API? Leads não serão apagados.'
      : 'Remover esta instância? Leads vinculados não serão apagados.';
    if (!confirm(label)) return;
    await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}`, { method: 'DELETE' });
    setInstances(prev => prev.filter(i => i.id !== inst.id));
    setStatuses(prev => { const n = { ...prev }; delete n[inst.id]; return n; });
  }

  async function toggleInstance(inst: Instance) {
    await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !inst.ativo }),
    });
    setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, ativo: !i.ativo } : i));
  }

  // ── QR Code ──────────────────────────────────────────────────────────────

  async function openQr(inst: Instance) {
    setQrInst(inst);
    setQrData(null);
    setQrLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}/connect`);
      if (res.ok) setQrData(await res.json() as { base64?: string; code?: string });
    } finally {
      setQrLoading(false);
    }
  }

  async function refreshQr() {
    if (!qrInst) return;
    setQrLoading(true);
    setQrData(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances/${qrInst.id}/connect`);
      if (res.ok) setQrData(await res.json() as { base64?: string; code?: string });
    } finally {
      setQrLoading(false);
    }
  }

  // ── Derived stats ────────────────────────────────────────────────────────

  const totalLeads = leads.length;
  const totalConv  = leads.filter(l => l.evento_compra_enviado).length;
  const taxaConv   = totalLeads > 0 ? `${Math.round((totalConv / totalLeads) * 100)}%` : '—';

  // ── Loading skeleton ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/30" />)}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pt-2">

      {/* ── Config Meta Ads ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 className="h-4 w-4 text-muted-foreground" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Configurações Meta Ads</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Pixel ID</label>
            <input
              value={config.pixel_id}
              onChange={e => setConfig(p => ({ ...p, pixel_id: e.target.value }))}
              placeholder="Ex: 1234567890123456"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da API de Conversões</label>
            <div className="relative">
              <input
                type={showToken ? 'text' : 'password'}
                value={config.meta_token}
                onChange={e => setConfig(p => ({ ...p, meta_token: e.target.value }))}
                placeholder="EAAxxxxxxx..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm font-mono outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => setShowToken(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted-foreground">Gatilho de compra</label>
            <input
              value={config.gatilho_compra}
              onChange={e => setConfig(p => ({ ...p, gatilho_compra: e.target.value }))}
              placeholder="compra aprovada"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Texto que dispara o evento Purchase. Ex: &quot;compra aprovada 297&quot;</p>
          </div>
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-xs font-semibold text-muted-foreground">Eventos ativos</p>
            {[
              { key: 'lead' as const, label: 'Lead', icon: MessageCircle },
              { key: 'purchase' as const, label: 'Compra (Purchase)', icon: ShoppingCart },
            ].map(({ key, label, icon: Icon }) => (
              <label key={key} className="flex cursor-pointer items-center gap-3">
                <div
                  onClick={() => setConfig(p => ({
                    ...p,
                    eventos_ativos: { ...p.eventos_ativos, [key]: !p.eventos_ativos[key] },
                  }))}
                  className={cn(
                    'relative h-5 w-9 rounded-full transition-colors cursor-pointer',
                    config.eventos_ativos[key] ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <div className={cn(
                    'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                    config.eventos_ativos[key] ? 'translate-x-4' : 'translate-x-0.5',
                  )} />
                </div>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{label}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={saveConfig}
          disabled={saving}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
          Salvar configurações
        </button>
      </div>

      {/* ── Instâncias ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="h-4 w-4 text-muted-foreground" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Instâncias WhatsApp</p>
          </div>
          <button
            onClick={openAddModal}
            className="flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar instância
          </button>
        </div>

        {instances.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Wifi className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Nenhuma instância cadastrada.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {instances.map(inst => {
              const webhookUrl = `${BASE}/api/webhook/whatsapp/${inst.id}`;
              const state: ConnState = statuses[inst.id] ?? 'unknown';
              const isEvolution = inst.provider === 'evolution';
              return (
                <div key={inst.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{inst.nome}</span>
                      {/* Provider badge */}
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        isEvolution
                          ? 'bg-violet-500/15 text-violet-400'
                          : 'bg-blue-500/15 text-blue-400',
                      )}>
                        {isEvolution ? 'Evolution API' : 'Z-API'}
                      </span>
                      {/* Active badge */}
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        inst.ativo
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {inst.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      {/* Connection state (Evolution only) */}
                      {isEvolution && <StateBadge state={state} />}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-[10px] text-primary font-mono truncate max-w-xs">{webhookUrl}</code>
                      <CopyBtn text={webhookUrl} label="URL" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {isEvolution ? 'Instância Evolution' : 'ID Z-API'}: {inst.instance_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {/* Connect QR — Evolution only */}
                    {isEvolution && state !== 'open' && (
                      <button
                        onClick={() => openQr(inst)}
                        className="flex items-center gap-1 rounded-lg border border-violet-400/30 px-2 py-1 text-xs font-semibold text-violet-400 hover:bg-violet-500/10 transition-colors"
                      >
                        <QrCode className="h-3.5 w-3.5" /> Conectar
                      </button>
                    )}
                    <button
                      onClick={() => toggleInstance(inst)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {inst.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      onClick={() => removeInstance(inst)}
                      className="rounded-lg border border-red-400/30 p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Leads ───────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Leads capturados', value: totalLeads, icon: MessageCircle, color: '#55F52F' },
            { label: 'Compras enviadas',  value: totalConv,  icon: ShoppingCart,  color: '#3b82f6' },
            { label: 'Taxa de conversão', value: taxaConv,   icon: TrendingUp,    color: '#a855f7' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="relative overflow-hidden rounded-xl border bg-card p-4" style={{ borderColor: `${color}44` }}>
              <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 85% 15%, ${color}22, transparent 50%)` }} />
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <p className="mt-2 text-base font-bold tabular-nums" style={{ color }}>{value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              {totalLeads} lead{totalLeads !== 1 ? 's' : ''} capturado{totalLeads !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              {(['7d', '30d', '90d'] as LeadPeriod[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold transition-all',
                    period === p ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground',
                  )}>
                  {p}
                </button>
              ))}
            </div>
          </div>

          {leads.length === 0 ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border">
              <p className="text-xs text-muted-foreground">Nenhum lead no período.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {['Telefone', 'Source ID', 'Lead', 'Compra', 'Valor', 'Data'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] last:text-right">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => (
                    <tr key={lead.id} className={cn('border-b border-border/40 last:border-0', i % 2 === 1 ? 'bg-muted/10' : '')}>
                      <td className="px-3 py-2 font-mono font-medium">{maskPhone(lead.telefone)}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground text-[10px] max-w-[100px] truncate">{lead.source_id ?? '—'}</td>
                      <td className="px-3 py-2">
                        {lead.evento_lead_enviado
                          ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">✓ Enviado</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Pendente</span>}
                      </td>
                      <td className="px-3 py-2">
                        {lead.evento_compra_enviado
                          ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-400">✓ Enviado</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 font-bold tabular-nums">
                        {lead.valor_compra != null
                          ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.valor_compra)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Add Instance Modal ──────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base">Nova instância WhatsApp</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Provider selector */}
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Provedor</p>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5 w-fit">
                {([
                  { value: 'zapi' as WhatsAppProvider, label: 'Z-API' },
                  { value: 'evolution' as WhatsAppProvider, label: 'Evolution API' },
                ]).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setInstProvider(value); setInstError(''); }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-xs font-semibold transition-all',
                      instProvider === value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Apelido da instância *</label>
                <input
                  value={instForm.nome}
                  onChange={e => {
                    const nome = e.target.value;
                    setInstForm(p => ({
                      ...p,
                      nome,
                      // Auto-suggest instance_id slug for Evolution when field is empty
                      instance_id: instProvider === 'evolution' && !p.instance_id
                        ? toSlug(nome)
                        : p.instance_id,
                    }));
                  }}
                  placeholder="Ex: Vendas, Suporte, Atendimento"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  {instProvider === 'evolution' ? 'Nome da instância (Evolution API) *' : 'Instance ID (Z-API) *'}
                </label>
                <input
                  value={instForm.instance_id}
                  onChange={e => {
                    const val = instProvider === 'evolution'
                      ? e.target.value.replace(/\s+/g, '-').toLowerCase()
                      : e.target.value;
                    setInstForm(p => ({ ...p, instance_id: val }));
                  }}
                  placeholder={instProvider === 'evolution' ? 'Ex: vendas-cliente' : 'Ex: 3D8A1B2C...'}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                />
                {instProvider === 'evolution' && (
                  <p className="mt-1 text-[10px] text-muted-foreground">Apenas letras minúsculas, números e hífens. Será criado automaticamente na Evolution API.</p>
                )}
              </div>
              {instProvider === 'zapi' && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da instância *</label>
                  <input
                    value={instForm.token}
                    onChange={e => setInstForm(p => ({ ...p, token: e.target.value }))}
                    placeholder="Token Z-API"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                  />
                </div>
              )}
              {instError && (
                <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{instError}</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={addInstance}
                disabled={adding}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {adding && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {instProvider === 'evolution' ? 'Criar na Evolution API' : 'Adicionar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── QR Code Modal ────────────────────────────────────────────────── */}
      {qrInst && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Conectar WhatsApp</h3>
                <p className="text-xs text-muted-foreground">{qrInst.nome} · {qrInst.instance_id}</p>
              </div>
              <button onClick={() => { setQrInst(null); setQrData(null); }} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-3">
              {qrLoading ? (
                <div className="flex h-48 w-48 items-center justify-center rounded-xl border border-border bg-muted/20">
                  <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground/40" />
                </div>
              ) : qrData?.base64 ? (
                <img
                  src={qrData.base64}
                  alt="QR Code WhatsApp"
                  className="h-48 w-48 rounded-xl border border-border object-contain"
                />
              ) : (
                <div className="flex h-48 w-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border">
                  {statuses[qrInst.id] === 'open' ? (
                    <>
                      <Wifi className="h-8 w-8 text-emerald-400" />
                      <p className="text-xs font-bold text-emerald-400">Conectado!</p>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">QR não disponível</p>
                    </>
                  )}
                </div>
              )}

              <p className="text-center text-xs text-muted-foreground">
                Abra o WhatsApp no celular → Menu → Dispositivos conectados → Conectar dispositivo
              </p>
            </div>

            <button
              onClick={refreshQr}
              disabled={qrLoading}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', qrLoading && 'animate-spin')} />
              Atualizar QR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
