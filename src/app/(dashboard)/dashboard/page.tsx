"use client";

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ImageIcon, RefreshCw,
  Search, TrendingDown,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { CampaignPerformance } from '@/app/api/campaigns/route';

type Period = 'last_7d' | 'last_30d' | 'this_month' | 'last_month';
type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; formLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
};
type GoalConfig = { type: string; target: number; label?: string; format?: 'currency' | 'number' };
type FunnelStage = { id: string; name: string; conversion: number };
type PlanningConfig = { tkm: number; cplMeta: number; stages: FunnelStage[] };
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

const DEFAULT_STAGES: FunnelStage[] = [
  { id: 's5', name: '5º — Contatos (Leads)', conversion: 50 },
  { id: 's4', name: '4º — Qualificados', conversion: 100 },
  { id: 's3', name: '3º — Agendamentos', conversion: 50 },
  { id: 's2', name: '2º — Comparecimentos', conversion: 47 },
  { id: 's1', name: '1º — Fechamentos (Vendas)', conversion: 0 },
];

const DEFAULT_PLANNING: PlanningConfig = { tkm: 9000, cplMeta: 30, stages: DEFAULT_STAGES };

function readGoalFromStorage(clientId: string): GoalConfig | null {
  try {
    const stored = localStorage.getItem(`clientGoal_${clientId}`);
    return stored ? JSON.parse(stored) as GoalConfig : null;
  } catch { return null; }
}

function readPlanningFromStorage(clientId: string): PlanningConfig {
  try {
    const stored = localStorage.getItem(`clientPlanning_${clientId}`);
    if (!stored) return DEFAULT_PLANNING;
    const parsed = JSON.parse(stored) as Partial<PlanningConfig>;
    const tkm = Number(parsed.tkm ?? DEFAULT_PLANNING.tkm);
    const cplMeta = Number(parsed.cplMeta ?? DEFAULT_PLANNING.cplMeta);
    const stages = Array.isArray(parsed.stages) && parsed.stages.length >= 2
      ? parsed.stages.map((stage, index) => ({
        id: stage.id || `stage-${index + 1}`,
        name: stage.name || `${index + 1}º — Etapa`,
        conversion: Math.min(100, Math.max(0, Number(stage.conversion ?? 50))),
      }))
      : DEFAULT_STAGES;
    return {
      tkm: Number.isFinite(tkm) ? tkm : DEFAULT_PLANNING.tkm,
      cplMeta: Number.isFinite(cplMeta) ? cplMeta : DEFAULT_PLANNING.cplMeta,
      stages,
    };
  } catch {
    return DEFAULT_PLANNING;
  }
}

function computeFunnel(stages: FunnelStage[], revenueTarget: number, ticket: number): number[] {
  const volumes = new Array<number>(stages.length).fill(0);
  if (stages.length === 0 || revenueTarget <= 0 || ticket <= 0) return volumes;
  volumes[stages.length - 1] = Math.ceil(revenueTarget / ticket);
  for (let i = stages.length - 2; i >= 0; i--) {
    const rate = stages[i].conversion / 100;
    volumes[i] = rate > 0 ? Math.ceil(volumes[i + 1] / rate) : 0;
  }
  return volumes;
}

function plannedFunnelFromGoal(goal: GoalConfig | null, planning: PlanningConfig): number[] {
  const volumes = new Array<number>(planning.stages.length).fill(0);
  if (!goal || goal.target <= 0 || planning.stages.length === 0) return volumes;

  if (goal.type === 'leads') {
    volumes[0] = Math.ceil(goal.target);
    for (let i = 1; i < planning.stages.length; i++) {
      const rate = planning.stages[i - 1].conversion / 100;
      volumes[i] = rate > 0 ? Math.ceil(volumes[i - 1] * rate) : 0;
    }
    return volumes;
  }

  if (goal.type === 'revenue') {
    return computeFunnel(planning.stages, goal.target, planning.tkm);
  }

  volumes[planning.stages.length - 1] = Math.ceil(goal.target);
  for (let i = planning.stages.length - 2; i >= 0; i--) {
    const rate = planning.stages[i].conversion / 100;
    volumes[i] = rate > 0 ? Math.ceil(volumes[i + 1] / rate) : 0;
  }
  return volumes;
}

function MetaMark() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#0B84FF] align-[-3px]">
      <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5">
        <path d="M2.5 12.5C2.5 9.5 4 7 6 7c1.3 0 2.4 1.1 4 3.8C11.6 8.1 12.7 7 14 7c2 0 3.5 2.5 3.5 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function GoogleMark() {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#4285F4] text-[11px] font-black text-white align-[-3px]">
      G
    </span>
  );
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
  showMeta = true, showPartial = true, showProgress = true, description = 'Realizado contra a meta do período.',
  metaLabel = 'Meta', partialLabel = 'Parcial', featured = false,
}: {
  title: ReactNode; value: number; meta: number; partial: number;
  format?: 'currency' | 'number' | 'percent' | 'times'; inverse?: boolean;
  loading?: boolean; prefix?: string;
  showMeta?: boolean; showPartial?: boolean; showProgress?: boolean; description?: string;
  metaLabel?: string; partialLabel?: string; featured?: boolean;
}) {
  const fmt = (v: number) =>
    format === 'currency' ? formatCurrencyBRL(v)
    : format === 'percent' ? `${v.toFixed(1)}%`
    : format === 'times' ? `${v.toFixed(1)}x`
    : v.toLocaleString('pt-BR');

  const target = partial > 0 ? partial : meta;
  const regularProgress = target > 0 ? Math.round((value / target) * 100) : 0;
  const inverseProgress = target > 0
    ? value <= 0
      ? 100
      : Math.round((target / value) * 100)
    : 0;
  const hasTarget = target > 0;
  const progress = Math.max(0, Math.min(inverse ? inverseProgress : regularProgress, 100));
  const status = progress > 75 ? 'good' : progress >= 36 ? 'warning' : 'critical';

  const statusColor = !showProgress || !hasTarget ? 'text-foreground' : status === 'critical' ? 'text-red-400' : status === 'good' ? 'text-emerald-400' : 'text-orange-400';
  const barColor = status === 'critical' ? 'bg-red-500' : status === 'good' ? 'bg-emerald-500' : 'bg-orange-400';
  const borderColor = !showProgress || !hasTarget ? 'border-border' : status === 'critical' ? 'border-red-500/40' : status === 'good' ? 'border-primary/30' : 'border-orange-400/30';
  const topColor = !showProgress || !hasTarget ? 'bg-muted' : status === 'critical' ? 'bg-red-500' : status === 'good' ? 'bg-primary' : 'bg-orange-400';
  const statusLabel = status === 'critical' ? 'Crítico' : status === 'good' ? 'No ritmo' : 'Atenção';
  const bottomItems = [
    ...(showMeta ? [{ label: metaLabel, value: meta > 0 ? fmt(meta) : prefix ? prefix : 'Sem meta' }] : []),
    ...(showPartial ? [{ label: partialLabel, value: partial > 0 ? fmt(partial) : '—' }] : []),
  ];

  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-card p-4 space-y-3', borderColor)}>
      <div className={cn('absolute inset-x-0 top-0 h-1', topColor)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn('font-bold text-lg', statusColor)}>{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
        {showProgress && hasTarget && (
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
        )}
      </div>
      {loading ? (
        <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-border bg-background/70 text-muted-foreground/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : (
        <>
          <div className={cn('relative overflow-hidden rounded-lg border border-border bg-background/70', featured ? 'min-h-32' : 'min-h-24')}>
            {showProgress && hasTarget && progress > 0 && (
              <div
                className={cn('absolute inset-y-0 left-0 opacity-80 transition-all', barColor)}
                style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
              />
            )}
            <div className="relative z-10 flex items-center justify-between gap-4 p-4">
              <div className="rounded-lg bg-black/25 px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
                <p className={cn('mt-1 font-heading font-bold tracking-wide leading-none text-foreground', featured ? 'text-4xl' : 'text-2xl')}>{fmt(value)}</p>
              </div>
              {showProgress && hasTarget && (
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
              )}
            </div>
          </div>
          {bottomItems.length > 0 && (
            <div className={cn('grid gap-2', bottomItems.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
              {bottomItems.map((item) => (
                <div key={item.label} className="rounded-lg bg-background/70 px-3 py-2 text-center">
                  <p className="text-sm font-bold">{item.value}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChannelMetricBox({
  label,
  value,
  format = 'number',
  color,
}: {
  label: string;
  value: number;
  format?: 'currency' | 'number';
  color: string;
}) {
  const formatted = format === 'currency' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR');
  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 font-heading text-4xl font-bold leading-none" style={{ color }}>
        {formatted}
      </p>
    </div>
  );
}

function RealizedOnlyCard({
  title,
  value,
  format = 'number',
  description,
  loading = false,
}: {
  title: string;
  value: number;
  format?: 'currency' | 'number' | 'percent' | 'times';
  description: string;
  loading?: boolean;
}) {
  const formatted = format === 'currency'
    ? formatCurrencyBRL(value)
    : format === 'percent'
    ? `${value.toFixed(1)}%`
    : format === 'times'
    ? `${value.toFixed(1)}x`
    : value.toLocaleString('pt-BR');

  return (
    <div className="relative self-start overflow-hidden rounded-xl border border-border bg-card p-4">
      <div className="absolute inset-x-0 top-0 h-1 bg-muted" />
      <p className="font-bold text-sm uppercase tracking-wide text-foreground">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      <div className="mt-4 rounded-lg border border-border bg-background/70 p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground/60">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            <span className="text-xs">Carregando...</span>
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
            <p className="mt-2 font-heading text-4xl font-bold leading-none text-foreground">{formatted}</p>
          </>
        )}
      </div>
    </div>
  );
}

function ChannelCard({
  title,
  mark,
  description,
  color,
  resultLabel,
  resultValue,
  costLabel,
  costValue,
}: {
  title: string;
  mark: ReactNode;
  description: string;
  color: string;
  resultLabel: string;
  resultValue: number;
  costLabel: string;
  costValue: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-5">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="flex items-start gap-3">
        {mark}
        <div>
          <h3 className="font-heading text-3xl font-bold uppercase tracking-wide" style={{ color }}>{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ChannelMetricBox label={resultLabel} value={resultValue} color={color} />
        <ChannelMetricBox label={costLabel} value={costValue} format="currency" color={color} />
      </div>
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

function CampaignPerformanceTable({
  campaigns,
  loading,
}: {
  campaigns: CampaignPerformance[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Carregando campanhas do período...
        </div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Nenhuma campanha com gasto no período selecionado.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead className="border-b border-border bg-muted/30">
            <tr className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-3">Campanha</th>
              <th className="px-4 py-3 text-right">Gasto</th>
              <th className="px-4 py-3 text-right">Resultados</th>
              <th className="px-4 py-3 text-right">Custo/Result.</th>
              <th className="px-4 py-3 text-right">Impressões</th>
              <th className="px-4 py-3 text-right">Cliques</th>
              <th className="px-4 py-3 text-right">CTR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {campaigns.map((campaign) => (
              <tr key={`${campaign.platform}-${campaign.accountId}-${campaign.id}`} className="hover:bg-muted/20">
                <td className="max-w-[320px] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {campaign.platform === 'meta' ? <MetaMark /> : <GoogleMark />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{campaign.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{campaign.accountName}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-sm font-bold text-primary">{formatCurrencyBRL(campaign.spend)}</td>
                <td className="px-4 py-3 text-right text-sm font-bold">{campaign.leads.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-3 text-right text-sm font-bold">{campaign.cpl > 0 ? formatCurrencyBRL(campaign.cpl) : '—'}</td>
                <td className="px-4 py-3 text-right text-sm">{campaign.impressions.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-3 text-right text-sm">{campaign.clicks.toLocaleString('pt-BR')}</td>
                <td className="px-4 py-3 text-right text-sm">{campaign.ctr > 0 ? `${campaign.ctr.toFixed(2)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [creatives, setCreatives] = useState<TopCreative[]>([]);
  const [campaignSortBy, setCampaignSortBy] = useState<SortKey>('spend');
  const [sortBy, setSortBy] = useState<SortKey>('spend');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
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

  // Fetch active campaigns with spend in selected period
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setCampaignsLoading(true);
    const params = new URLSearchParams({
      period,
      sortBy: campaignSortBy,
      limit: '30',
      clientIds: [...selectedIds].join(','),
    });
    fetch(`/api/campaigns?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<CampaignPerformance[]> : [])
      .then(setCampaigns)
      .catch(() => setCampaigns([]))
      .finally(() => setCampaignsLoading(false));
  }, [period, campaignSortBy, selectedIds]);

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

  // ── Aggregate planning ───────────────────────────────────────────────────
  let leadsGoal = 0;
  let plannedInvestment = 0;
  let revenueGoal = 0;
  const revenue = 0; // Futuro: realizado vindo da planilha/Google Sheets de vendas.

  for (const id of selectedIds) {
    const goal = goalsByClient[id];
    const planning = readPlanningFromStorage(id);
    const plannedFunnel = plannedFunnelFromGoal(goal, planning);
    const topVolume = plannedFunnel[0] ?? 0;
    leadsGoal += topVolume;
    plannedInvestment += topVolume * planning.cplMeta;
    if (goal?.type === 'revenue') revenueGoal += goal.target;
  }

  const revenuePartial = autoPartial(revenueGoal, period);
  const roi = totalSpend > 0 ? revenue / totalSpend : 0;

  // ── Alerts ───────────────────────────────────────────────────────────────
  type Alert = { clientId: string; clientName: string; msg: string; severity: 'warning' | 'critical' };
  const alerts: Alert[] = [];

  for (const id of selectedIds) {
    const client = clients.find(c => c.id === id);
    if (!client) continue;
    const m = metricsByClient[id];
    const goal = goalsByClient[id];
    const planning = readPlanningFromStorage(id);
    const clientPlannedLeads = plannedFunnelFromGoal(goal, planning)[0] ?? 0;
    const clientLeads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
    const clientLeadsPartial = autoPartial(clientPlannedLeads, period);
    const clientCpl = m?.meta?.cpl ?? 0;
    const clientCplGoal = planning.cplMeta;

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
      <div className="grid items-start gap-4 lg:grid-cols-[2fr_1fr]">
        <KpiCard
          title="Resultado"
          value={revenue}
          meta={revenueGoal}
          partial={revenuePartial}
          format="currency"
          loading={metricsLoading}
          featured
        />
        <RealizedOnlyCard
          title="ROI"
          value={roi}
          format="times"
          loading={metricsLoading}
          description="Resultado realizado dividido pelo total gasto."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <KpiCard
          title="Leads Total"
          value={totalLeads}
          meta={leadsGoal}
          partial={0}
          loading={metricsLoading}
          showPartial={false}
          description="Meta Ads formulários + conversas e conversões Google Ads."
        />
        <KpiCard
          title="Total Gasto"
          value={totalSpend}
          meta={plannedInvestment}
          partial={0}
          format="currency"
          loading={metricsLoading}
          showPartial={false}
          description="Gasto real em campanhas Meta Ads e Google Ads."
        />
      </div>

      {/* Leads por canal */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChannelCard
          title="Meta Ads"
          mark={<MetaMark />}
          description={`${metaFormLeads.toLocaleString('pt-BR')} formulários + ${metaConversations.toLocaleString('pt-BR')} conversas no período selecionado.`}
          color="#0B84FF"
          resultLabel="Leads"
          resultValue={metricsLoading ? 0 : metaLeads}
          costLabel="CPL"
          costValue={metricsLoading ? 0 : avgCpl}
        />
        <ChannelCard
          title="Google Ads"
          mark={<GoogleMark />}
          description="Conversões vindas apenas do Google Ads no período selecionado."
          color="#4285F4"
          resultLabel="Leads"
          resultValue={metricsLoading ? 0 : googleConv}
          costLabel="Custo / Conversão"
          costValue={metricsLoading ? 0 : avgCpa}
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
              const goal = goalsByClient[client.id];
              const clientLeadsGoal = plannedFunnelFromGoal(goal, readPlanningFromStorage(client.id))[0] ?? 0;
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

      {/* Campanhas ativas */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">Campanhas Ativas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Campanhas com gasto no período selecionado, considerando as contas vinculadas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ordenar por</span>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setCampaignSortBy(opt.value)}
                  className={cn(
                    'px-3 py-1.5 text-[11px] font-semibold transition-colors',
                    campaignSortBy === opt.value ? 'bg-primary text-black' : 'bg-card text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {campaignsLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          </div>
        </div>
        <CampaignPerformanceTable campaigns={campaigns} loading={campaignsLoading} />
      </div>

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
