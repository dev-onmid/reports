'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Copy, Check, Trash2, Plus, RefreshCw, Eye, EyeOff,
  Zap, Settings2, MessageCircle, ShoppingCart, X, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type TrackingConfig = {
  pixel_id: string;
  meta_token: string;
  gatilho_compra: string;
  eventos_ativos: { lead: boolean; purchase: boolean };
};

type ZapiInstance = {
  id: string;
  nome: string;
  instance_id: string;
  token: string;
  ativo: boolean;
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

type LeadPeriod = '7d' | '30d' | '90d';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

function maskPhone(phone: string): string {
  if (phone.length >= 10) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ****-${phone.slice(-4)}`;
  }
  return `****${phone.slice(-4)}`;
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

// ── Main component ───────────────────────────────────────────────────────────

export function ClientTrackingTab({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<TrackingConfig>({
    pixel_id: '', meta_token: '',
    gatilho_compra: 'compra aprovada',
    eventos_ativos: { lead: true, purchase: true },
  });
  const [instances, setInstances] = useState<ZapiInstance[]>([]);
  const [leads, setLeads]         = useState<WaLead[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [showToken, setShowToken] = useState(false);

  // New instance modal
  const [showModal, setShowModal] = useState(false);
  const [instForm, setInstForm]   = useState({ nome: '', instance_id: '', token: '' });
  const [instError, setInstError] = useState('');
  const [adding, setAdding]       = useState(false);

  // Leads period
  const [period, setPeriod] = useState<LeadPeriod>('30d');
  const periodDays = { '7d': 7, '30d': 30, '90d': 90 } as const;

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
      fetch(`/api/clients/${clientId}/tracking/instances`).then(r => r.ok ? r.json() as Promise<ZapiInstance[]> : []),
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

  async function addInstance() {
    setInstError('');
    if (!instForm.nome || !instForm.instance_id || !instForm.token) {
      setInstError('Todos os campos são obrigatórios.');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/tracking/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(instForm),
      });
      if (!res.ok) { setInstError('Erro ao salvar instância.'); return; }
      const newInst = await res.json() as ZapiInstance;
      setInstances(prev => [...prev, newInst]);
      setInstForm({ nome: '', instance_id: '', token: '' });
      setShowModal(false);
    } finally {
      setAdding(false);
    }
  }

  async function removeInstance(instId: string) {
    if (!confirm('Remover esta instância? Leads vinculados não serão apagados.')) return;
    await fetch(`/api/clients/${clientId}/tracking/instances/${instId}`, { method: 'DELETE' });
    setInstances(prev => prev.filter(i => i.id !== instId));
  }

  async function toggleInstance(inst: ZapiInstance) {
    await fetch(`/api/clients/${clientId}/tracking/instances/${inst.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo: !inst.ativo }),
    });
    setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, ativo: !i.ativo } : i));
  }

  const totalLeads = leads.length;
  const totalConv  = leads.filter(l => l.evento_compra_enviado).length;
  const taxaConv   = totalLeads > 0 ? `${Math.round((totalConv / totalLeads) * 100)}%` : '—';

  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        {[1, 2, 3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/30" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-2">

      {/* ── Config ─────────────────────────────────────────────────────── */}
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

      {/* ── Z-API Instances ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Instâncias Z-API</p>
          </div>
          <button
            onClick={() => { setInstForm({ nome: '', instance_id: '', token: '' }); setInstError(''); setShowModal(true); }}
            className="flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar instância
          </button>
        </div>

        {instances.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Zap className="mx-auto mb-2 h-6 w-6 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">Nenhuma instância cadastrada.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {instances.map(inst => {
              const webhookUrl = `${BASE}/api/webhook/whatsapp/${inst.id}`;
              return (
                <div key={inst.id} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold">{inst.nome}</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        inst.ativo
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-muted text-muted-foreground',
                      )}>
                        {inst.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-[10px] text-primary font-mono truncate max-w-xs">{webhookUrl}</code>
                      <CopyBtn text={webhookUrl} label="URL" />
                    </div>
                    <p className="text-[10px] text-muted-foreground">ID Z-API: {inst.instance_id}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleInstance(inst)}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {inst.ativo ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      onClick={() => removeInstance(inst.id)}
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
        {/* Stats */}
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

        {/* Period + table */}
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
                  {p === '7d' ? '7d' : p === '30d' ? '30d' : '90d'}
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
              <h3 className="font-bold text-base">Nova instância Z-API</h3>
              <button onClick={() => setShowModal(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Apelido da instância *</label>
                <input
                  value={instForm.nome}
                  onChange={e => setInstForm(p => ({ ...p, nome: e.target.value }))}
                  placeholder="Ex: Vendas, Suporte, Atendimento"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Instance ID (Z-API) *</label>
                <input
                  value={instForm.instance_id}
                  onChange={e => setInstForm(p => ({ ...p, instance_id: e.target.value }))}
                  placeholder="Ex: 3D8A1B2C..."
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Token da instância *</label>
                <input
                  value={instForm.token}
                  onChange={e => setInstForm(p => ({ ...p, token: e.target.value }))}
                  placeholder="Token Z-API"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:border-primary"
                />
              </div>
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
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
