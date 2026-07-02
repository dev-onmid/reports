'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Copy, Check, Trash2, Plus, ExternalLink, RefreshCw,
  Link2, MousePointerClick, ChevronDown, ChevronUp, X, Pencil,
  BarChart2, TrendingUp, Filter, MessageCircle, ShoppingCart,
  Settings, Zap, Eye, EyeOff,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useClients } from '@/lib/client-store';
import { cn } from '@/lib/utils';
import { DictateButton } from '@/components/ui/dictate-button';

type Redirect = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  name: string;
  slug: string;
  whatsapp: string;
  message: string;
  clicks: number;
  last_click: string | null;
  created_at: string;
};

type ClickBreakdown = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  clicks: number;
};

type Analytics = {
  totalClicks: number;
  activeLinks: number;
  clicksPerDay: { day: string; clicks: number }[];
  topLinks: { id: string; name: string; slug: string; clicks: number }[];
  topSources: { label: string; clicks: number }[];
  topMediums: { label: string; clicks: number }[];
  topCampaigns: { label: string; clicks: number }[];
};

type Period = '7d' | '30d' | '90d' | 'custom';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7d',    label: 'Últimos 7 dias' },
  { value: '30d',   label: 'Últimos 30 dias' },
  { value: '90d',   label: 'Últimos 90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

const BAR_COLORS = ['#55F52F','#3b82f6','#a855f7','#f59e0b','#ef4444','#10b981','#ec4899','#06b6d4'];

const BASE = typeof window !== 'undefined' ? window.location.origin : '';

// ── WhatsApp Tracking types ──────────────────────────────────────────────────

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
  client_id: string | null;
  client_name: string | null;
};

function maskPhone(phone: string): string {
  if (phone.length >= 10) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ****-${phone.slice(-4)}`;
  }
  return `****${phone.slice(-4)}`;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function periodToDates(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const today = new Date();
  if (period === 'custom') return { from: customFrom, to: customTo };
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date(today); from.setDate(from.getDate() - (days - 1));
  return { from: toISODate(from), to: toISODate(today) };
}
function fmtDay(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button onClick={copy} title="Copiar link"
      className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted">
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  );
}

function BreakdownRow({ row }: { row: ClickBreakdown }) {
  const parts = [
    row.utm_source   && `src: ${row.utm_source}`,
    row.utm_medium   && `mid: ${row.utm_medium}`,
    row.utm_campaign && `camp: ${row.utm_campaign}`,
    row.utm_content  && `cont: ${row.utm_content}`,
    row.utm_term     && `term: ${row.utm_term}`,
  ].filter(Boolean);
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs border-b border-border/50 last:border-0">
      <span className="text-muted-foreground truncate max-w-xs">
        {parts.length > 0 ? parts.join(' · ') : <span className="italic">sem UTMs</span>}
      </span>
      <span className="shrink-0 font-bold tabular-nums text-foreground">{row.clicks}x</span>
    </div>
  );
}

const EMPTY_ANALYTICS: Analytics = {
  totalClicks: 0, activeLinks: 0,
  clicksPerDay: [], topLinks: [], topSources: [], topMediums: [], topCampaigns: [],
};

export default function RastreamentoPage() {
  const { clients } = useClients();

  // Links state
  const [links, setLinks]       = useState<Redirect[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [breakdown, setBreakdown]   = useState<Record<string, ClickBreakdown[]>>({});
  const [editingId, setEditingId]   = useState<string | null>(null);

  // Analytics state
  const [analytics, setAnalytics]         = useState<Analytics>(EMPTY_ANALYTICS);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  // Filters
  const [filterClient, setFilterClient] = useState('');
  const [period, setPeriod]             = useState<Period>('30d');
  const [customFrom, setCustomFrom]     = useState('');
  const [customTo, setCustomTo]         = useState('');

  // Form
  const [form, setForm] = useState({
    clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!',
  });

  // WhatsApp tracking — consolidated admin view
  const [waLeads, setWaLeads]         = useState<WaLead[]>([]);
  const [waLoading, setWaLoading]     = useState(true);
  const [waClientFilter, setWaClientFilter] = useState('');
  const [waDays, setWaDays]           = useState(30);

  function loadLinks() {
    setLoading(true);
    const qs = filterClient ? `?clientId=${filterClient}` : '';
    fetch(`/api/link-redirects${qs}`)
      .then(r => r.ok ? r.json() as Promise<Redirect[]> : [])
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLoading(false));
  }

  const loadAnalytics = useCallback(() => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setAnalyticsLoading(true);
    const { from, to } = periodToDates(period, customFrom, customTo);
    const params = new URLSearchParams({ from, to });
    if (filterClient) params.set('clientId', filterClient);
    fetch(`/api/link-redirects/analytics?${params}`)
      .then(r => r.ok ? r.json() as Promise<Analytics> : EMPTY_ANALYTICS)
      .then(setAnalytics)
      .catch(() => setAnalytics(EMPTY_ANALYTICS))
      .finally(() => setAnalyticsLoading(false));
  }, [period, customFrom, customTo, filterClient]);

  useEffect(() => { loadLinks(); }, [filterClient]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  async function save() {
    setError('');
    if (!form.name || !form.whatsapp) { setError('Nome e WhatsApp são obrigatórios.'); return; }
    setSaving(true);
    try {
      const isEdit = !!editingId;
      const url = isEdit ? `/api/link-redirects/${editingId}` : '/api/link-redirects';
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: form.clientId || undefined,
          name: form.name, slug: form.slug || undefined,
          whatsapp: form.whatsapp, message: form.message,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? 'Erro ao salvar.'); return;
      }
      setShowForm(false); setEditingId(null);
      setForm({ clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!' });
      loadLinks(); loadAnalytics();
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Remover este link e todos os seus cliques?')) return;
    await fetch(`/api/link-redirects/${id}`, { method: 'DELETE' });
    setLinks(prev => prev.filter(l => l.id !== id));
    loadAnalytics();
  }

  function openEdit(link: Redirect) {
    setForm({ clientId: link.client_id ?? '', name: link.name, slug: link.slug, whatsapp: link.whatsapp, message: link.message });
    setEditingId(link.id); setShowForm(true);
  }

  async function toggleBreakdown(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!breakdown[id]) {
      const rows = await fetch(`/api/link-redirects/${id}`)
        .then(r => r.ok ? r.json() as Promise<ClickBreakdown[]> : [])
        .catch(() => [] as ClickBreakdown[]);
      setBreakdown(prev => ({ ...prev, [id]: rows }));
    }
  }

  // WhatsApp consolidated load
  const loadWaLeads = useCallback(() => {
    setWaLoading(true);
    const params = new URLSearchParams({ days: String(waDays) });
    if (waClientFilter) params.set('clientId', waClientFilter);
    fetch(`/api/whatsapp-leads?${params}`)
      .then(r => r.ok ? r.json() as Promise<WaLead[]> : [])
      .then(setWaLeads)
      .catch(() => setWaLeads([]))
      .finally(() => setWaLoading(false));
  }, [waDays, waClientFilter]);

  useEffect(() => { loadWaLeads(); }, [loadWaLeads]);

  // Per-client aggregates derived from waLeads
  const waByClient = (() => {
    const map = new Map<string, { name: string; leads: number; conv: number }>();
    for (const l of waLeads) {
      const key = l.client_id ?? '__none__';
      const name = l.client_name ?? 'Sem cliente';
      const cur = map.get(key) ?? { name, leads: 0, conv: 0 };
      cur.leads += 1;
      if (l.evento_compra_enviado) cur.conv += 1;
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.leads - a.leads);
  })();

  const waLeadTotal = waLeads.length;
  const waConvTotal = waLeads.filter(l => l.evento_compra_enviado).length;

  const { from: periodFrom, to: periodTo } = periodToDates(period, customFrom, customTo);
  const totalLinksFiltered = links.length;
  const totalClicksFiltered = links.reduce((s, l) => s + l.clicks, 0);

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Rastreamento de Links</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Crie links que capturam UTMs e redireciona para o WhatsApp.
          </p>
        </div>
        <button
          onClick={() => { setEditingId(null); setForm({ clientId: '', name: '', slug: '', whatsapp: '', message: 'Olá, vim pelo anúncio!' }); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-black shadow-[0_0_16px_rgba(85,245,47,0.35)] hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Novo Link
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />

        {/* Client filter */}
        <select
          value={filterClient}
          onChange={e => setFilterClient(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary"
        >
          <option value="">Todos os clientes</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
          {PERIOD_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setPeriod(o.value)}
              className={cn(
                'rounded-md px-3 py-1 text-xs font-semibold transition-all',
                period === o.value ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground',
              )}
            >{o.label}</button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
            <span className="text-xs text-muted-foreground">até</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary" />
          </div>
        )}

        {!analyticsLoading && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {period !== 'custom' ? PERIOD_OPTIONS.find(o => o.value === period)?.label : `${periodFrom} → ${periodTo}`}
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Cliques no período', value: analytics.totalClicks, icon: MousePointerClick, color: '#55F52F' },
          { label: 'Links ativos',        value: analytics.activeLinks,  icon: Link2,            color: '#3b82f6' },
          { label: 'Links cadastrados',   value: totalLinksFiltered,     icon: BarChart2,         color: '#a855f7' },
          { label: 'Total de cliques',    value: totalClicksFiltered,    icon: TrendingUp,        color: '#f59e0b' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="relative overflow-hidden rounded-xl border bg-card p-4" style={{ borderColor: `${color}44` }}>
            <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 85% 15%, ${color}22, transparent 50%)` }} />
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className="h-4 w-4" style={{ color }} />
            </div>
            <p className="mt-2 text-base font-bold tabular-nums" style={{ color }}>
              {analyticsLoading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted" /> : value}
            </p>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Clicks over time */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Cliques por dia</p>
          {analyticsLoading ? (
            <div className="h-40 animate-pulse rounded-lg bg-muted/30" />
          ) : analytics.clicksPerDay.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Nenhum clique no período</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={analytics.clicksPerDay} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="clickGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#55F52F" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#55F52F" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={(l) => fmtDay(String(l))}
                  formatter={(v) => [v, 'Cliques']}
                />
                <Area type="monotone" dataKey="clicks" stroke="#55F52F" strokeWidth={2} fill="url(#clickGrad)" dot={false} activeDot={{ r: 4, fill: '#55F52F' }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top sources */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Top origens (utm_source)</p>
          {analyticsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-6 animate-pulse rounded bg-muted/30" />)}</div>
          ) : analytics.topSources.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">Sem dados</div>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={analytics.topSources} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#6b7280' }} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#9ca3af' }} width={80} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => [v, 'Cliques']}
                />
                <Bar dataKey="clicks" radius={[0, 4, 4, 0]}>
                  {analytics.topSources.map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Second charts row */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Top links */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Top links por cliques</p>
          {analyticsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-7 animate-pulse rounded bg-muted/30" />)}</div>
          ) : analytics.topLinks.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Sem dados</div>
          ) : (
            <div className="space-y-2">
              {analytics.topLinks.slice(0, 6).map((link, i) => {
                const max = analytics.topLinks[0]?.clicks || 1;
                const pct = Math.round((link.clicks / max) * 100);
                return (
                  <div key={link.id} className="flex items-center gap-3">
                    <span className="w-4 shrink-0 text-[10px] font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold">{link.name}</span>
                        <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: BAR_COLORS[i % BAR_COLORS.length] }}>{link.clicks}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top campaigns */}
        <div className="rounded-[var(--radius)] border border-border bg-card p-5">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Top campanhas (utm_campaign)</p>
          {analyticsLoading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-7 animate-pulse rounded bg-muted/30" />)}</div>
          ) : analytics.topCampaigns.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Sem dados</div>
          ) : (
            <div className="space-y-2">
              {analytics.topCampaigns.slice(0, 6).map((camp, i) => {
                const max = analytics.topCampaigns[0]?.clicks || 1;
                const pct = Math.round((camp.clicks / max) * 100);
                return (
                  <div key={camp.label} className="flex items-center gap-3">
                    <span className="w-4 shrink-0 text-[10px] font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-semibold">{camp.label}</span>
                        <span className="shrink-0 text-xs font-bold tabular-nums" style={{ color: BAR_COLORS[i % BAR_COLORS.length] }}>{camp.clicks}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-card p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-bold text-lg">{editingId ? 'Editar Link' : 'Novo Link de Rastreamento'}</h2>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Nome do link *</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ex: Facebook - Campanha Novembro"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Cliente</label>
                <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary">
                  <option value="">— Sem cliente —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Número WhatsApp * <span className="text-muted-foreground/60">(com DDD e DDI)</span>
                </label>
                <input value={form.whatsapp} onChange={e => setForm(p => ({ ...p, whatsapp: e.target.value }))}
                  placeholder="5511999999999"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">Mensagem de abertura</label>
                <div className="relative">
                  <textarea value={form.message} onChange={e => setForm(p => ({ ...p, message: e.target.value }))}
                    rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:border-primary resize-none" />
                  <DictateButton className="absolute bottom-2 right-2" onTranscript={(text) => setForm(p => ({ ...p, message: p.message ? `${p.message} ${text}` : text }))} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                  Slug personalizado <span className="text-muted-foreground/60">(vazio = automático)</span>
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">/r/</span>
                  <input value={form.slug}
                    onChange={e => setForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="minha-campanha"
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                </div>
              </div>
              {error && <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => setShowForm(false)} className="flex-1 rounded-lg border border-border py-2 text-sm font-semibold hover:bg-muted/50 transition-colors">Cancelar</button>
                <button onClick={save} disabled={saving}
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-sm font-bold text-black hover:bg-primary/90 disabled:opacity-60 transition-colors">
                  {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  {editingId ? 'Salvar alterações' : 'Criar link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Links list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {totalLinksFiltered} link{totalLinksFiltered !== 1 ? 's' : ''} cadastrado{totalLinksFiltered !== 1 ? 's' : ''}
          </p>
        </div>

        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-muted/30" />)}</div>
        ) : links.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <Link2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="font-semibold text-muted-foreground">Nenhum link encontrado.</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Crie um novo link ou altere os filtros.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map(link => {
              const url = `${BASE}/r/${link.slug}`;
              const isExpanded = expandedId === link.id;
              const rows = breakdown[link.id];
              return (
                <div key={link.id} className="rounded-[var(--radius)] border border-border bg-card overflow-hidden">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm">{link.name}</p>
                        {link.client_name && (
                          <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{link.client_name}</span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="text-xs text-primary font-mono truncate max-w-xs">{url}</code>
                        <a href={url} target="_blank" rel="noreferrer" title="Abrir link">
                          <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        </a>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        WhatsApp: {link.whatsapp} · &quot;{link.message}&quot;
                      </p>
                    </div>
                    <div className="text-center shrink-0">
                      <p className="text-xl font-bold text-primary tabular-nums">{link.clicks}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">cliques</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CopyButton text={url} />
                      <button onClick={() => toggleBreakdown(link.id)} title="Ver breakdown UTMs"
                        className={cn('flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold transition-colors hover:bg-muted/50', isExpanded && 'bg-muted/50')}>
                        {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        UTMs
                      </button>
                      <button onClick={() => openEdit(link)} title="Editar"
                        className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/50">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(link.id)} title="Remover"
                        className="rounded-lg border border-red-400/30 p-1.5 text-red-400 transition-colors hover:bg-red-500/10">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/20 px-4 py-3">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Breakdown por UTMs (todos os tempos)</p>
                      {!rows ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="h-3 w-3 animate-spin" /> Carregando...</div>
                      ) : rows.length === 0 ? (
                        <p className="text-xs text-muted-foreground">Nenhum clique registrado ainda.</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto">
                          {rows.map((row, i) => <BreakdownRow key={i} row={row} />)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── WhatsApp Tracking — Consolidated ───────────────────────────── */}
      <div className="mt-8 border-t border-border pt-8 space-y-6">

        {/* Section header + filters */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold">
              <MessageCircle className="h-5 w-5 text-primary" />
              Rastreio WhatsApp → Meta Ads
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Visão consolidada de todos os clientes. Configure por cliente na aba Clientes → Rastreio WA.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={waClientFilter}
              onChange={e => setWaClientFilter(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold outline-none focus:border-primary"
            >
              <option value="">Todos os clientes</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setWaDays(d)}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-semibold transition-all',
                    waDays === d ? 'bg-primary text-black' : 'text-muted-foreground hover:text-foreground',
                  )}>{d}d</button>
              ))}
            </div>
            <button onClick={loadWaLeads}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs font-semibold hover:bg-muted/50 transition-colors">
              <RefreshCw className={cn('h-3.5 w-3.5', waLoading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Global stats */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Total de leads', value: waLeadTotal, icon: MessageCircle, color: '#55F52F' },
            { label: 'Total compras',  value: waConvTotal, icon: ShoppingCart,  color: '#3b82f6' },
            { label: 'Taxa de conversão', value: waLeadTotal > 0 ? `${Math.round((waConvTotal / waLeadTotal) * 100)}%` : '—', icon: TrendingUp, color: '#a855f7' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="relative overflow-hidden rounded-xl border bg-card p-4" style={{ borderColor: `${color}44` }}>
              <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 85% 15%, ${color}22, transparent 50%)` }} />
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <Icon className="h-4 w-4" style={{ color }} />
              </div>
              <p className="mt-2 text-base font-bold tabular-nums" style={{ color }}>
                {waLoading ? <span className="inline-block h-7 w-16 animate-pulse rounded bg-muted" /> : value}
              </p>
            </div>
          ))}
        </div>

        {/* Per-client cards */}
        {!waLoading && waByClient.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {waByClient.map(c => {
              const taxa = c.leads > 0 ? `${Math.round((c.conv / c.leads) * 100)}%` : '—';
              return (
                <div key={c.name} className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <p className="text-sm font-semibold truncate">{c.name}</p>
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Leads</p>
                      <p className="text-base font-bold text-primary tabular-nums">{c.leads}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Compras</p>
                      <p className="text-base font-bold text-blue-400 tabular-nums">{c.conv}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Taxa</p>
                      <p className="text-base font-bold text-purple-400 tabular-nums">{taxa}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* All leads table */}
        <div>
          <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {waLeadTotal} lead{waLeadTotal !== 1 ? 's' : ''} · últimos {waDays} dias
          </p>

          {waLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 animate-pulse rounded-xl border border-border bg-muted/30" />)}</div>
          ) : waLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <MessageCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="font-semibold text-muted-foreground">Nenhum lead no período.</p>
              <p className="mt-1 text-xs text-muted-foreground/60">Configure as instâncias Z-API em cada cliente na aba Rastreio WA.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-card">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['Cliente', 'Telefone', 'Source ID', 'Lead', 'Compra', 'Valor', 'Data'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px] last:text-right">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {waLeads.map((lead, i) => (
                    <tr key={lead.id} className={cn('border-b border-border/50 last:border-0', i % 2 === 0 ? '' : 'bg-muted/10')}>
                      <td className="px-4 py-2.5 font-medium max-w-[120px] truncate">{lead.client_name ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono font-medium">{maskPhone(lead.telefone)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-[10px] max-w-[100px] truncate">{lead.source_id ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {lead.evento_lead_enviado
                          ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-400">✓ Enviado</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">Pendente</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.evento_compra_enviado
                          ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-400">✓ Enviado</span>
                          : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 font-bold tabular-nums">
                        {lead.valor_compra != null
                          ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(lead.valor_compra)
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
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
    </div>
  );
}
