"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ImageIcon, RefreshCw,
  Search, TrendingDown,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { clientResults } from '@/lib/client-results-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';

type Period = 'last_7d' | 'last_30d' | 'this_month' | 'last_month';
type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; formLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
};
type GoalConfig = { type: string; target: number };
type SortKey = 'spend' | 'leads' | 'impressions' | 'clicks' | 'cpl' | 'ctr';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'spend', label: 'Investimento' },
  { value: 'leads', label: 'Leads' },
  { value: 'impressions', label: 'Impressões' },
  { value: 'clicks', label: 'Cliques' },
  { value: 'cpl', label: 'CPL (menor)' },
  { value: 'ctr', label: 'CTR' },
];

function readGoalFromStorage(clientId: string): GoalConfig | null {
  try {
    const stored = localStorage.getItem(`clientGoal_${clientId}`);
    return stored ? JSON.parse(stored) as GoalConfig : null;
  } catch { return null; }
}

function autoPartial(target: number, period: Period): number {
  if (period !== 'this_month') return 0;
  const now = new Date();
  const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.round((target * now.getDate()) / totalDays);
}

// ── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({
  title, value, meta, partial, format = 'number', inverse = false, loading = false, prefix,
}: {
  title: string; value: number; meta: number; partial: number;
  format?: 'currency' | 'number' | 'percent'; inverse?: boolean;
  loading?: boolean; prefix?: string;
}) {
  const fmt = (v: number) =>
    format === 'currency' ? formatCurrencyBRL(v)
    : format === 'percent' ? `${v.toFixed(1)}%`
    : v.toLocaleString('pt-BR');

  const target = partial > 0 ? partial : meta;
  const regularProgress = target > 0 ? Math.round((value / target) * 100) : 0;
  const inverseProgress = target > 0
    ? value <= 0
      ? 100
      : Math.round((target / value) * 100)
    : 0;
  const progress = Math.max(0, Math.min(inverse ? inverseProgress : regularProgress, 100));
  const status = progress > 75 ? 'good' : progress >= 36 ? 'warning' : 'critical';

  const statusColor = status === 'critical' ? 'text-red-400' : status === 'good' ? 'text-emerald-400' : 'text-orange-400';
  const barColor = status === 'critical' ? 'bg-red-500' : status === 'good' ? 'bg-emerald-500' : 'bg-orange-400';
  const borderColor = status === 'critical' ? 'border-red-500/40' : status === 'good' ? 'border-primary/30' : 'border-orange-400/30';
  const topColor = status === 'critical' ? 'bg-red-500' : status === 'good' ? 'bg-primary' : 'bg-orange-400';
  const statusLabel = status === 'critical' ? 'Crítico' : status === 'good' ? 'No ritmo' : 'Atenção';

  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-card p-4 space-y-3', borderColor)}>
      <div className={cn('absolute inset-x-0 top-0 h-1', topColor)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn('font-bold text-lg', statusColor)}>{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Realizado contra a meta do período.</p>
        </div>
        <span className={cn(
          'rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
          status === 'critical'
            ? 'border-red-500/40 bg-red-500/10 text-red-300'
            : status === 'good'
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-orange-400/40 bg-orange-400/10 text-orange-300',
        )}>
          {statusLabel}
        </span>
      </div>
      {loading ? (
        <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-border bg-background/70 text-muted-foreground/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-lg border border-border bg-background/70 min-h-24">
            {progress > 0 && (
              <div
                className={cn('absolute inset-y-0 left-0 opacity-80 transition-all', barColor)}
                style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
              />
            )}
            <div className="relative z-10 flex items-center justify-between gap-4 p-4">
              <div className="rounded-lg bg-black/25 px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
                <p className="mt-1 font-heading text-2xl font-bold tracking-wide leading-none text-foreground">{fmt(value)}</p>
              </div>
              <div className="rounded-lg bg-black/25 px-3 py-2 text-right shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
                <p className={cn('font-heading text-2xl font-bold leading-none', statusColor)}>{progress}%</p>
                <p className={cn('mt-1 flex items-center justify-end gap-1 text-[10px] font-bold uppercase tracking-wider', statusColor)}>
                  {status === 'good'
                    ? <CheckCircle2 className="w-3 h-3" />
                    : status === 'critical'
                    ? <TrendingDown className="w-3 h-3" />
                    : <AlertTriangle className="w-3 h-3" />}
                  {statusLabel}
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-background/70 px-3 py-2 text-center">
              <p className="text-sm font-bold">{meta > 0 ? fmt(meta) : prefix ? prefix : 'Sem meta'}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Meta</p>
            </div>
            <div className="rounded-lg bg-background/70 px-3 py-2 text-center">
              <p className="text-sm font-bold">{partial > 0 ? fmt(partial) : meta > 0 ? fmt(meta) : '—'}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Parcial</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Client Multi-Select ─────────────────────────────────────────────────────
function ClientSelector({
  clients, selected, onChange,
}: {
  clients: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'az' | 'za'>('az');
  const ref = useRef<HTMLDivElement>(null);
  const hasMultipleClients = clients.length > 1;
  const allClientsSelected = clients.length > 0 && selected.size === clients.length;
  const showingAllClients = hasMultipleClients && allClientsSelected;
  const visibleClients = [...clients]
    .filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => {
      const result = a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      return sort === 'az' ? result : -result;
    });

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function toggle(id: string) {
    if (showingAllClients) {
      onChange(new Set([id]));
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    if (next.size === 0) onChange(new Set(clients.map(c => c.id)));
    else onChange(next);
  }

  function toggleAll() {
    onChange(new Set(clients.map(c => c.id)));
  }

  const label = showingAllClients
    ? 'Todos os clientes'
    : selected.size === 1
    ? clients.find(c => selected.has(c.id))?.name ?? '1 cliente'
    : `${selected.size} clientes`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        {label}
        <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-64 rounded-xl border border-border bg-card shadow-xl p-1">
          <div className="grid gap-1 p-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar cliente..."
                className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
            <button
              type="button"
              onClick={() => setSort(sort === 'az' ? 'za' : 'az')}
              className="h-7 rounded-lg border border-border bg-background px-2 text-[10px] font-bold text-muted-foreground hover:text-foreground"
            >
              Ordem {sort === 'az' ? 'A-Z' : 'Z-A'}
            </button>
          </div>
          {hasMultipleClients && (
            <>
              <button
                onClick={toggleAll}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
              >
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
                  allClientsSelected ? 'bg-primary border-primary text-black' : 'border-border'
                )}>{allClientsSelected && '✓'}</span>
                <span className="font-semibold">Todos</span>
              </button>
              <div className="my-1 border-t border-border" />
            </>
          )}
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {visibleClients.map(c => (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
              >
                <span className={cn('w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
                  selected.has(c.id) ? 'bg-primary border-primary text-black' : 'border-border'
                )}>{selected.has(c.id) && '✓'}</span>
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Creative Card ────────────────────────────────────────────────────────────
function CreativeCard({ creative, sortBy }: { creative: TopCreative; sortBy: SortKey }) {
  const [imgError, setImgError] = useState(false);
  const imgUrl = creative.imageUrl ?? creative.thumbnailUrl;

  const primaryMetric = (() => {
    switch (sortBy) {
      case 'leads': return { label: 'Leads', value: creative.leads.toLocaleString('pt-BR') };
      case 'impressions': return { label: 'Impressões', value: creative.impressions.toLocaleString('pt-BR') };
      case 'clicks': return { label: 'Cliques', value: creative.clicks.toLocaleString('pt-BR') };
      case 'cpl': return { label: 'CPL', value: creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—' };
      case 'ctr': return { label: 'CTR', value: `${creative.ctr.toFixed(2)}%` };
      default: return { label: 'Investido', value: formatCurrencyBRL(creative.spend) };
    }
  })();

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden hover:border-primary/30 transition-colors">
      {/* Creative preview */}
      <div className="aspect-[4/3] bg-muted/30 flex items-center justify-center overflow-hidden relative">
        {imgUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgUrl}
            alt={creative.adName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
        )}
        {/* Primary metric badge */}
        <div className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-primary">
          {primaryMetric.value}
        </div>
      </div>

      <div className="p-3 space-y-2">
        {/* Ad name */}
        <p className="text-xs font-bold truncate">{creative.adName}</p>
        {/* Copy */}
        {(creative.headline || creative.body) && (
          <div className="space-y-1">
            {creative.headline && (
              <p className="text-[11px] font-semibold text-foreground/80 line-clamp-1">{creative.headline}</p>
            )}
            {creative.body && (
              <p className="text-[11px] text-muted-foreground line-clamp-2">{creative.body}</p>
            )}
          </div>
        )}

        {/* Metrics row */}
        <div className="grid grid-cols-3 gap-1 pt-1 border-t border-border">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Invest.</p>
            <p className="text-[11px] font-bold">{formatCurrencyBRL(creative.spend)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Leads</p>
            <p className="text-[11px] font-bold">{creative.leads > 0 ? creative.leads : '—'}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">CTR</p>
            <p className="text-[11px] font-bold">{creative.ctr > 0 ? `${creative.ctr.toFixed(1)}%` : '—'}</p>
          </div>
        </div>

        {/* Account name */}
        <p className="text-[9px] text-muted-foreground/50 truncate">{creative.accountName}</p>
      </div>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function GeneralDashboard() {
  const { clients } = useClients();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<Period>('this_month');
  const [metricsByClient, setMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [creatives, setCreatives] = useState<TopCreative[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('spend');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [creativesLoading, setCreativesLoading] = useState(false);

  // Initialize: all clients selected
  useEffect(() => {
    if (clients.length === 0) return;
    const clientIds = new Set(clients.map(c => c.id));
    setSelectedIds((current) => {
      if (current.size === 0) return new Set(clientIds);
      const valid = [...current].filter((id) => clientIds.has(id));
      return valid.length > 0 ? new Set(valid) : new Set(clientIds);
    });
  }, [clients]);

  // Read goals from localStorage
  useEffect(() => {
    const g: Record<string, GoalConfig | null> = {};
    for (const c of clients) g[c.id] = readGoalFromStorage(c.id);
    setGoalsByClient(g);
  }, [clients]);

  // Fetch metrics for selected clients
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setMetricsLoading(true);
    const ids = [...selectedIds];
    Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/clients/${id}/metrics?period=${period}`);
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null };
        return [id, data] as const;
      })
    ).then(results => {
      const map: Record<string, ApiMetrics> = {};
      for (const r of results) if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
      setMetricsByClient(map);
    }).finally(() => setMetricsLoading(false));
  }, [selectedIds, period]);

  // Fetch top creatives
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setCreativesLoading(true);
    const params = new URLSearchParams({
      period,
      sortBy,
      limit: '20',
      clientIds: [...selectedIds].join(','),
    });
    fetch(`/api/meta/top-creatives?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<TopCreative[]> : [])
      .then(setCreatives)
      .catch(() => setCreatives([]))
      .finally(() => setCreativesLoading(false));
  }, [period, sortBy, selectedIds]);

  // ── Aggregate metrics ────────────────────────────────────────────────────
  let metaLeads = 0, metaFormLeads = 0, metaConversations = 0, metaSpend = 0, metaImpressions = 0, metaClicks = 0;
  let googleConv = 0, googleCost = 0;

  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.meta) {
      metaLeads += m.meta.leads;
      metaFormLeads += m.meta.formLeads ?? 0;
      metaConversations += m.meta.conversations ?? 0;
      metaSpend += m.meta.spend;
      metaImpressions += m.meta.impressions;
      metaClicks += m.meta.clicks;
    }
    if (m?.google) { googleConv += m.google.conversions; googleCost += m.google.cost; }
  }

  const totalLeads = metaLeads + googleConv;
  const totalSpend = metaSpend + googleCost;
  const avgCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
  const avgCpa = googleConv > 0 ? googleCost / googleConv : 0;

  // ── Aggregate goals ──────────────────────────────────────────────────────
  let leadsGoal = 0, metaLeadsGoal = 0, googleConvGoal = 0;
  let revenueGoal = 0, revenue = 0;
  let cplGoal = 0, cpaGoal = 0;

  for (const id of selectedIds) {
    const goal = goalsByClient[id];
    const h = clientResults.find(r => r.clientId === id);
    if (goal?.type === 'leads') { leadsGoal += goal.target; metaLeadsGoal += goal.target; }
    else if (h) { leadsGoal += h.metaLeads; metaLeadsGoal += h.metaLeads; }
    if (goal?.type === 'revenue') revenueGoal += goal.target;
    else if (h) revenueGoal += h.meta;
    if (h) { revenue += h.resultado; cplGoal += h.metaCpl; cpaGoal += h.metaCac; }
  }

  const leadsPartial = autoPartial(leadsGoal, period);
  const metaLeadsPartial = autoPartial(metaLeadsGoal, period);
  const googleConvPartial = autoPartial(googleConvGoal, period);
  const revenuePartial = autoPartial(revenueGoal, period);
  const roi = totalSpend > 0 && revenue > 0 ? ((revenue - totalSpend) / totalSpend * 100) : 0;

  // ── Alerts ───────────────────────────────────────────────────────────────
  type Alert = { clientId: string; clientName: string; msg: string; severity: 'warning' | 'critical' };
  const alerts: Alert[] = [];

  for (const id of selectedIds) {
    const client = clients.find(c => c.id === id);
    if (!client) continue;
    const m = metricsByClient[id];
    const h = clientResults.find(r => r.clientId === id);
    const goal = goalsByClient[id];
    const clientLeads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
    const clientLeadsGoal = goal?.type === 'leads' ? goal.target : (h?.metaLeads ?? 0);
    const clientLeadsPartial = autoPartial(clientLeadsGoal, period);
    const clientCpl = m?.meta?.cpl ?? 0;
    const clientCplGoal = h?.metaCpl ?? 0;

    if (clientLeadsPartial > 0 && clientLeads < clientLeadsPartial * 0.5) {
      alerts.push({ clientId: id, clientName: client.name, msg: `Leads muito abaixo do esperado (${clientLeads} / ${clientLeadsPartial} parcial)`, severity: 'critical' });
    } else if (clientLeadsPartial > 0 && clientLeads < clientLeadsPartial * 0.75) {
      alerts.push({ clientId: id, clientName: client.name, msg: `Leads abaixo do ritmo (${clientLeads} / ${clientLeadsPartial} parcial)`, severity: 'warning' });
    }
    if (clientCplGoal > 0 && clientCpl > clientCplGoal * 1.5) {
      alerts.push({ clientId: id, clientName: client.name, msg: `CPL acima da meta (${formatCurrencyBRL(clientCpl)} / meta ${formatCurrencyBRL(clientCplGoal)})`, severity: 'critical' });
    }
  }

  const selectedClients = clients.filter(c => selectedIds.has(c.id));

  return (
    <div className="space-y-6 pb-10">
      {/* Header + Filters */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-4xl uppercase tracking-wider">Dashboard Geral</h1>
          <p className="mt-1 text-muted-foreground text-sm">Performance consolidada das contas vinculadas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClientSelector clients={clients} selected={selectedIds} onChange={setSelectedIds} />
          <div className="flex rounded-lg border border-border overflow-hidden">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'px-3 py-2 text-xs font-semibold transition-colors',
                  period === p.value ? 'bg-primary text-black' : 'bg-card text-muted-foreground hover:bg-muted/50'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {metricsLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* Alerts */}
      {!metricsLoading && alerts.length > 0 && (
        <div className="rounded-xl border border-orange-400/30 bg-orange-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-400" />
            <p className="text-sm font-bold text-orange-400">{alerts.length} alerta{alerts.length > 1 ? 's' : ''} fora do padrão</p>
          </div>
          <div className="space-y-1.5">
            {alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold border',
                  a.severity === 'critical'
                    ? 'bg-red-500/15 text-red-400 border-red-500/30'
                    : 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                )}>
                  {a.severity === 'critical' ? 'Crítico' : 'Atenção'}
                </span>
                <div className="text-xs">
                  <Link href={`/clientes/${a.clientId}`} className="font-bold hover:text-primary transition-colors">
                    {a.clientName}
                  </Link>
                  <span className="text-muted-foreground"> — {a.msg}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KPI Cards — Row 1 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <KpiCard
          title="Resultado"
          value={revenue}
          meta={revenueGoal}
          partial={revenuePartial}
          format="currency"
          loading={metricsLoading}
        />
        <KpiCard
          title="ROI"
          value={roi}
          meta={0}
          partial={0}
          format="percent"
          loading={metricsLoading}
          prefix={roi >= 0 ? '▲' : '▼'}
        />
        <KpiCard
          title="Leads Total"
          value={totalLeads}
          meta={leadsGoal}
          partial={leadsPartial}
          loading={metricsLoading}
        />
        <KpiCard
          title="Total Gasto"
          value={totalSpend}
          meta={0}
          partial={0}
          format="currency"
          loading={metricsLoading}
        />
      </div>

      {/* KPI Cards — Row 2 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <KpiCard
          title="Meta Leads + Conversas"
          value={metaLeads}
          meta={metaLeadsGoal}
          partial={metaLeadsPartial}
          prefix={`${metaFormLeads.toLocaleString('pt-BR')} formulários · ${metaConversations.toLocaleString('pt-BR')} conversas`}
          loading={metricsLoading}
        />
        <KpiCard
          title="Conversões Google Ads"
          value={googleConv}
          meta={googleConvGoal}
          partial={googleConvPartial}
          prefix="Google"
          loading={metricsLoading}
        />
        <KpiCard
          title="CPL Meta Ads"
          value={avgCpl}
          meta={cplGoal}
          partial={0}
          format="currency"
          inverse
          loading={metricsLoading}
        />
        <KpiCard
          title="Custo/Conv. Google"
          value={avgCpa}
          meta={cpaGoal}
          partial={0}
          format="currency"
          inverse
          loading={metricsLoading}
        />
      </div>

      {/* Client summary quick-view */}
      {selectedClients.length > 1 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Resumo por cliente</p>
          <div className="divide-y divide-border">
            {selectedClients.map(client => {
              const m = metricsByClient[client.id];
              const leads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
              const spend = (m?.meta?.spend ?? 0) + (m?.google?.cost ?? 0);
              const h = clientResults.find(r => r.clientId === client.id);
              const goal = goalsByClient[client.id];
              const clientLeadsGoal = goal?.type === 'leads' ? goal.target : (h?.metaLeads ?? 0);
              const pct = clientLeadsGoal > 0 ? Math.min(100, Math.round(leads / clientLeadsGoal * 100)) : null;

              return (
                <div key={client.id} className="flex items-center gap-4 py-2.5">
                  <Link href={`/clientes/${client.id}`} className="text-sm font-bold w-40 truncate hover:text-primary transition-colors shrink-0">
                    {client.name}
                  </Link>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    {pct !== null && (
                      <div
                        className={cn('h-full rounded-full', pct >= 75 ? 'bg-emerald-500' : pct >= 40 ? 'bg-orange-400' : 'bg-red-500')}
                        style={{ width: `${pct}%` }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    <span>{leads > 0 ? `${leads} leads` : metricsLoading ? '…' : '— leads'}</span>
                    <span>{spend > 0 ? formatCurrencyBRL(spend) : metricsLoading ? '…' : '—'}</span>
                    {pct !== null && (
                      <span className={cn('font-bold', pct >= 75 ? 'text-emerald-400' : pct >= 40 ? 'text-orange-400' : 'text-red-400')}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Criativos */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">Top Criativos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Anúncios com melhor performance no período selecionado.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ordenar por</span>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setSortBy(opt.value)}
                  className={cn(
                    'px-3 py-1.5 text-[11px] font-semibold transition-colors',
                    sortBy === opt.value ? 'bg-primary text-black' : 'bg-card text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {creativesLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>
        </div>

        {creativesLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-muted/30" />
                <div className="p-3 space-y-2">
                  <div className="h-3 bg-muted/40 rounded w-3/4" />
                  <div className="h-2 bg-muted/30 rounded w-full" />
                  <div className="h-2 bg-muted/30 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : creatives.length === 0 ? (
          <div className="rounded-xl border border-border bg-card/50 py-12 text-center">
            <ImageIcon className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum criativo encontrado.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Conecte uma conta Meta Ads em Integrações e vincule a um cliente.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {creatives.map(c => (
              <CreativeCard key={c.adId} creative={c} sortBy={sortBy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
