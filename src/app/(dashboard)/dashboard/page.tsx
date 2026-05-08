"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ImageIcon, RefreshCw,
  TrendingDown, TrendingUp, X,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { clientResults } from '@/lib/client-results-store';
import { useInvestmentPayments } from '@/lib/payment-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';

type Period = 'last_7d' | 'last_30d' | 'this_month' | 'last_month';
type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; cpl: number } | null;
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

  const pct = meta > 0 ? Math.min(Math.round((value / meta) * 100), 100) : 0;
  const partialPct = partial > 0 ? Math.min(Math.round((value / partial) * 100), 100) : 0;

  const onTrack = partial > 0
    ? (inverse ? value <= partial * 1.1 : value >= partial * 0.85)
    : (inverse ? (meta > 0 ? value <= meta * 1.1 : true) : pct >= 75);

  const critical = partial > 0
    ? (inverse ? value > partial * 1.5 : value < partial * 0.5)
    : (!inverse && pct < 30);

  const statusColor = critical ? 'text-red-400' : onTrack ? 'text-emerald-400' : 'text-orange-400';
  const barColor = critical ? 'bg-red-500' : onTrack ? 'bg-emerald-500' : 'bg-orange-400';
  const borderColor = critical ? 'border-red-500/40' : onTrack ? 'border-border' : 'border-orange-400/30';

  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-3', borderColor)}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{prefix && <span className="mr-1 opacity-60">{prefix}</span>}{title}</p>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : (
        <>
          <p className={cn('font-heading text-3xl font-bold tracking-wide leading-none', value > 0 ? statusColor : 'text-foreground')}>
            {fmt(value)}
          </p>
          <div className="space-y-1.5">
            {meta > 0 && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Meta</span>
                <span className="font-semibold">{fmt(meta)}</span>
              </div>
            )}
            {partial > 0 && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Parcial hoje</span>
                <span className={cn('font-bold flex items-center gap-1', statusColor)}>
                  {onTrack
                    ? <CheckCircle2 className="w-3 h-3" />
                    : critical
                    ? <TrendingDown className="w-3 h-3" />
                    : <AlertTriangle className="w-3 h-3" />}
                  {fmt(partial)}
                </span>
              </div>
            )}
            {meta > 0 && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', barColor)}
                  style={{ width: `${partial > 0 ? partialPct : pct}%` }}
                />
              </div>
            )}
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
  const ref = useRef<HTMLDivElement>(null);
  const allSelected = selected.size === clients.length;

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    if (next.size === 0) onChange(new Set(clients.map(c => c.id)));
    else onChange(next);
  }

  function toggleAll() {
    onChange(allSelected ? new Set() : new Set(clients.map(c => c.id)));
  }

  const label = allSelected ? 'Todos os clientes' : `${selected.size} cliente${selected.size > 1 ? 's' : ''}`;

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
          <button
            onClick={toggleAll}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
          >
            <span className={cn('w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
              allSelected ? 'bg-primary border-primary text-black' : 'border-border'
            )}>{allSelected && '✓'}</span>
            <span className="font-semibold">Todos</span>
          </button>
          <div className="my-1 border-t border-border" />
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {clients.map(c => (
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
  const { payments } = useInvestmentPayments();

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
    if (clients.length > 0) setSelectedIds(new Set(clients.map(c => c.id)));
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
    setCreativesLoading(true);
    fetch(`/api/meta/top-creatives?period=${period}&sortBy=${sortBy}&limit=20`)
      .then(res => res.ok ? res.json() as Promise<TopCreative[]> : [])
      .then(setCreatives)
      .catch(() => setCreatives([]))
      .finally(() => setCreativesLoading(false));
  }, [period, sortBy]);

  // ── Aggregate metrics ────────────────────────────────────────────────────
  let metaLeads = 0, metaSpend = 0, metaImpressions = 0, metaClicks = 0;
  let googleConv = 0, googleCost = 0;

  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.meta) { metaLeads += m.meta.leads; metaSpend += m.meta.spend; metaImpressions += m.meta.impressions; metaClicks += m.meta.clicks; }
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

  // ── Investment ───────────────────────────────────────────────────────────
  const selPayments = payments.filter(p => selectedIds.has(p.clientId));
  const investBudget = selPayments.reduce((s, p) => s + p.amount, 0);
  const investDone = selPayments.filter(p => p.status === 'Pago' || p.status === 'Enviado').reduce((s, p) => s + p.amount, 0);

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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          title="Investimento no Período"
          value={investDone}
          meta={investBudget}
          partial={0}
          format="currency"
          loading={metricsLoading}
        />
      </div>

      {/* KPI Cards — Row 2 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Leads Meta Ads"
          value={metaLeads}
          meta={metaLeadsGoal}
          partial={metaLeadsPartial}
          prefix="Meta"
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
