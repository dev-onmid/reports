"use client";

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ChevronDown, ChevronRight, ImageIcon, Play, RefreshCw, Search,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { CampaignPerformance } from '@/app/api/campaigns/route';
import type { AudienceBreakdowns, AudienceResponse, AudienceSlice } from '@/app/api/audience/route';
import type { GoogleAdPreview, GoogleKeywordInsight, GoogleKeywordInsightsResponse } from '@/app/api/google/keyword-insights/route';

type Period = 'last_7d' | 'last_30d' | 'this_month' | 'last_month';
type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; formLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
};
type GoalConfig = { type: string; target: number; label?: string; format?: 'currency' | 'number' };
type FunnelStage = { id: string; name: string; conversion: number };
type PlanningConfig = { tkm: number; cplMeta: number; stages: FunnelStage[] };
type SortKey = 'spend' | 'leads' | 'impressions' | 'clicks' | 'cpl' | 'ctr';
type AudienceKey = keyof AudienceBreakdowns;

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

const EMPTY_AUDIENCE: AudienceResponse = {
  meta: { age: [], gender: [], platform: [], device: [] },
  google: { age: [], gender: [], platform: [], device: [] },
};
const EMPTY_GOOGLE_KEYWORD_INSIGHTS: GoogleKeywordInsightsResponse = { keywords: [], ads: [] };

const META_AUDIENCE_COLORS = ['#0B84FF', '#55F52F', '#7B2CFF', '#38BDF8', '#F59E0B', '#EC4899', '#EF4444', '#A3E635'];
const GOOGLE_AUDIENCE_COLORS = ['#EA4335', '#FBBC05', '#34A853', '#4285F4', '#7B2CFF', '#F97316', '#EC4899', '#22C55E'];
const AUDIENCE_TITLES: Record<AudienceKey, string> = {
  age: 'Idade',
  gender: 'Gênero',
  platform: 'Plataforma',
  device: 'Dispositivo',
};

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees - 90) * Math.PI / 180;
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians)),
  };
}

function describeDonutSlice(cx: number, cy: number, outerRadius: number, innerRadius: number, startAngle: number, endAngle: number) {
  const safeEndAngle = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
  const outerStart = polarToCartesian(cx, cy, outerRadius, safeEndAngle);
  const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerRadius, safeEndAngle);
  const largeArcFlag = safeEndAngle - startAngle <= 180 ? '0' : '1';

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

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

  const statusColor = !showProgress || !hasTarget ? 'text-foreground' : status === 'critical' ? 'text-red-400' : status === 'good' ? 'text-primary' : 'text-orange-400';
  const barColor = status === 'critical' ? 'bg-red-500' : status === 'good' ? 'bg-emerald-500' : 'bg-orange-400';
  const borderColor = !showProgress || !hasTarget ? 'border-border' : status === 'critical' ? 'border-red-500/35' : status === 'good' ? 'border-primary/30' : 'border-orange-400/35';
  const statusLabel = status === 'critical' ? 'Crítico' : status === 'good' ? 'No ritmo' : 'Atenção';
  const bottomItems = [
    ...(showMeta ? [{ label: metaLabel, value: meta > 0 ? fmt(meta) : prefix ? prefix : 'Sem meta' }] : []),
    ...(showPartial ? [{ label: partialLabel, value: partial > 0 ? fmt(partial) : '—' }] : []),
  ];

  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-card/95 p-5 space-y-3 shadow-[0_20px_70px_rgba(0,0,0,0.18)]', borderColor)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(123,44,255,0.10),transparent_36%)]" />
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          <p className={cn('font-bold text-base', showProgress && hasTarget ? statusColor : 'text-foreground')}>{title}</p>
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
                className={cn('absolute inset-y-0 left-0 opacity-85 transition-all', barColor)}
                style={{ width: `${Math.max(0, Math.min(progress, 100))}%` }}
              />
            )}
            <div className="relative z-10 grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
              <div className="rounded-lg bg-black/25 px-3 py-2 shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
                <p className={cn('mt-1 font-heading font-bold tracking-wide leading-none text-foreground', featured ? 'text-4xl' : 'text-2xl')}>{fmt(value)}</p>
              </div>
              {showProgress && hasTarget && (
                <div className="min-w-36 rounded-lg bg-black/25 px-3 py-2 text-right shadow-[0_12px_30px_rgba(0,0,0,0.3)]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Atingimento</p>
                  <p className={cn('font-heading text-2xl font-bold leading-none', statusColor)}>{progress}%</p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                    <div className={cn('h-full rounded-full', barColor)} style={{ width: `${progress}%` }} />
                  </div>
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

function MiniTrendLine({ color = '#7B2CFF' }: { color?: string }) {
  return (
    <svg viewBox="0 0 320 92" className="h-20 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`trend-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 76 C30 62 42 58 66 69 S110 80 132 62 S165 55 188 40 S224 14 248 30 S286 46 320 18"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M0 76 C30 62 42 58 66 69 S110 80 132 62 S165 55 188 40 S224 14 248 30 S286 46 320 18 L320 92 L0 92 Z"
        fill={`url(#trend-${color.replace('#', '')})`}
      />
    </svg>
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
    <div className="relative h-full overflow-hidden rounded-xl border border-border bg-card p-5">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_35%,rgba(123,44,255,0.12),transparent_42%)]" />
      <div className="relative">
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
      <div className="mt-3">
        <MiniTrendLine color="#7B2CFF" />
      </div>
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
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.05),transparent_38%)]" />
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="relative flex items-start gap-3">
        {mark}
        <div>
          <h3 className="font-heading text-3xl font-bold uppercase tracking-wide" style={{ color }}>{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="relative mt-4 grid gap-3 sm:grid-cols-2">
        <ChannelMetricBox label={resultLabel} value={resultValue} color={color} />
        <ChannelMetricBox label={costLabel} value={costValue} format="currency" color={color} />
      </div>
      <div className="relative mt-3">
        <MiniTrendLine color={color} />
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
function CreativeCard({
  creative,
  sortBy,
  onPreview,
}: {
  creative: TopCreative;
  sortBy: SortKey;
  onPreview: (creative: TopCreative) => void;
}) {
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
      <div className="relative flex aspect-[9/16] items-center justify-center overflow-hidden bg-muted/30">
        {imgUrl && !imgError ? (
          <button
            type="button"
            onClick={() => onPreview(creative)}
            className="block h-full w-full cursor-zoom-in"
            title={`Ampliar preview de ${creative.adName}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imgUrl}
              alt={creative.adName}
              className="h-full w-full object-cover"
              onError={() => setImgError(true)}
            />
            {creative.videoUrl && (
              <span className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white">
                <Play className="h-3.5 w-3.5 fill-current" />
              </span>
            )}
          </button>
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
        <div className="grid grid-cols-4 gap-1 pt-1 border-t border-border">
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Invest.</p>
            <p className="text-[11px] font-bold">{formatCurrencyBRL(creative.spend)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Leads</p>
            <p className="text-[11px] font-bold">{creative.leads > 0 ? creative.leads : '—'}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Custo/Res.</p>
            <p className="text-[11px] font-bold">{creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—'}</p>
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

function CreativePreviewOverlay({
  creative,
  onClose,
}: {
  creative: TopCreative | null;
  onClose: () => void;
}) {
  if (!creative) return null;
  const imgUrl = creative.imageUrl ?? creative.thumbnailUrl;

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 p-4 backdrop-blur-sm" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/20"
      >
        Fechar
      </button>
      <div className="mx-auto flex h-full max-w-6xl items-center justify-center gap-6">
        <div className="flex h-full max-h-[88vh] w-full max-w-[min(56vh,520px)] items-center justify-center">
          {creative.videoUrl ? (
            <video
              src={creative.videoUrl}
              poster={imgUrl}
              controls
              autoPlay
              className="max-h-full w-full rounded-xl border border-white/15 bg-black object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          ) : imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt={creative.adName}
              className="max-h-full w-full rounded-xl border border-white/15 bg-black object-contain"
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center rounded-xl border border-white/15 bg-white/5">
              <ImageIcon className="h-10 w-10 text-white/30" />
            </div>
          )}
        </div>
        <div className="hidden w-80 shrink-0 rounded-xl border border-white/15 bg-white/10 p-4 text-white lg:block" onClick={(event) => event.stopPropagation()}>
          <p className="text-xs font-bold uppercase tracking-widest text-white/50">Criativo</p>
          <h3 className="mt-2 text-lg font-bold leading-snug">{creative.adName}</h3>
          {creative.headline && <p className="mt-3 text-sm font-semibold text-white/80">{creative.headline}</p>}
          {creative.body && <p className="mt-2 text-sm text-white/60">{creative.body}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-black/30 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Invest.</p>
              <p className="mt-1 font-bold">{formatCurrencyBRL(creative.spend)}</p>
            </div>
            <div className="rounded-lg bg-black/30 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Leads</p>
              <p className="mt-1 font-bold">{creative.leads > 0 ? creative.leads : '—'}</p>
            </div>
          </div>
          <p className="mt-4 text-xs text-white/40">{creative.accountName}</p>
        </div>
      </div>
    </div>
  );
}

function TopCreativesTablePanel({
  creatives,
  loading,
  onPreview,
}: {
  creatives: TopCreative[];
  loading: boolean;
  onPreview: (creative: TopCreative) => void;
}) {
  const topItems = creatives.slice(0, 5);
  return (
    <div className="h-full rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider">Top Criativos</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Anúncios com melhor performance no período selecionado.</p>
      </div>
      <div className="mt-4 space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-14 rounded-lg bg-muted/20 animate-pulse" />
          ))
        ) : topItems.length > 0 ? topItems.map((creative) => {
          const imgUrl = creative.thumbnailUrl ?? creative.imageUrl;
          return (
            <button
              key={creative.adId}
              type="button"
              onClick={() => onPreview(creative)}
              className="grid w-full grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent p-1.5 text-left transition-colors hover:border-primary/30 hover:bg-muted/20"
            >
              <div className="relative aspect-video overflow-hidden rounded-md bg-muted/30">
                {imgUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imgUrl} alt={creative.adName} className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon className="m-auto h-full w-5 text-muted-foreground/30" />
                )}
                {creative.videoUrl && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Play className="h-4 w-4 fill-white text-white" />
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">{creative.adName}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{creative.headline || creative.accountName}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-right text-[10px]">
                <span><b className="block text-foreground">{formatCurrencyBRL(creative.spend)}</b>Invest.</span>
                <span><b className="block text-foreground">{creative.leads || '—'}</b>Leads</span>
                <span><b className="block text-foreground">{creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—'}</b>Custo</span>
              </div>
            </button>
          );
        }) : (
          <div className="rounded-lg border border-border bg-background/60 p-6 text-center text-sm text-muted-foreground">
            Nenhum criativo encontrado.
          </div>
        )}
      </div>
    </div>
  );
}

function AudienceSnapshotCard({
  audience,
  loading,
}: {
  audience: AudienceResponse;
  loading: boolean;
}) {
  const [platform, setPlatform] = useState<'meta' | 'google'>('meta');
  const [metric, setMetric] = useState<AudienceKey>('age');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const data = audience[platform][metric];
  const colors = platform === 'meta' ? META_AUDIENCE_COLORS : GOOGLE_AUDIENCE_COLORS;
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cursorAngle = 0;
  const slices = data.map((item, index) => {
    const angle = total > 0 ? (item.value / total) * 360 : 0;
    const slice = {
      ...item,
      index,
      color: colors[index % colors.length],
      pct: total > 0 ? Math.round((item.value / total) * 100) : 0,
      startAngle: cursorAngle,
      endAngle: cursorAngle + angle,
    };
    cursorAngle += angle;
    return slice;
  });

  return (
    <div className="h-full rounded-xl border border-border bg-card p-5">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider">Público Atingido</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Recortes por idade, gênero, plataforma e dispositivo.</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(['meta', 'google'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setPlatform(item)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase transition-colors',
              platform === item ? 'bg-primary text-black' : 'bg-background text-muted-foreground hover:bg-muted/50'
            )}
          >
            {item === 'meta' ? 'Meta Ads' : 'Google Ads'}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(['age', 'gender', 'platform', 'device'] as AudienceKey[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setMetric(item)}
            className={cn(
              'border-b-2 px-1.5 py-1 text-[11px] font-bold transition-colors',
              metric === item ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {AUDIENCE_TITLES[item]}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="mt-5 h-72 rounded-xl bg-muted/20 animate-pulse" />
      ) : (
        <div className="mt-5 grid items-center gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex justify-center">
            {slices.length > 0 ? (
              <svg viewBox="0 0 220 220" className="h-64 w-64 overflow-visible" role="img" aria-label={`Gráfico de ${AUDIENCE_TITLES[metric]}`}>
                {slices.map((slice) => (
                  <path
                    key={slice.label}
                    d={describeDonutSlice(110, 110, 104, 48, slice.startAngle, slice.endAngle)}
                    fill={slice.color}
                    stroke="rgba(0,0,0,0.35)"
                    strokeWidth="1"
                    className="origin-center transition-all duration-200"
                    style={{
                      opacity: activeIndex === null || activeIndex === slice.index ? 1 : 0.35,
                      transform: activeIndex === slice.index ? 'scale(1.06)' : 'scale(1)',
                    }}
                    onMouseEnter={() => setActiveIndex(slice.index)}
                    onMouseLeave={() => setActiveIndex(null)}
                  >
                    <title>{`${slice.label}: ${slice.pct}%`}</title>
                  </path>
                ))}
                <circle cx="110" cy="110" r="40" className="fill-card" />
                <text x="110" y="106" textAnchor="middle" className="fill-muted-foreground text-[10px] font-bold uppercase tracking-widest">Total</text>
                <text x="110" y="125" textAnchor="middle" className="fill-foreground text-[18px] font-bold">{total.toLocaleString('pt-BR')}</text>
              </svg>
            ) : (
              <div className="relative h-56 w-56 rounded-full bg-muted/30">
                <div className="absolute inset-12 rounded-full bg-card" />
              </div>
            )}
          </div>
          <div className="space-y-2">
            {slices.length > 0 ? slices.slice(0, 7).map((item) => (
              <button
                key={item.label}
                type="button"
                onMouseEnter={() => setActiveIndex(item.index)}
                onMouseLeave={() => setActiveIndex(null)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors',
                  activeIndex === item.index ? 'bg-muted/60' : 'hover:bg-muted/30'
                )}
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="min-w-0 flex-1 truncate font-semibold">{item.label}</span>
                <span className="font-bold">{item.pct}%</span>
              </button>
            )) : (
              <p className="text-sm text-muted-foreground">Sem dados no período.</p>
            )}
          </div>
        </div>
      )}
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

function AudiencePieCard({
  title,
  data,
  colors,
}: {
  title: string;
  data: AudienceSlice[];
  colors: string[];
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cursorAngle = 0;
  const slices = data.map((item, index) => {
    const angle = total > 0 ? (item.value / total) * 360 : 0;
    const slice = {
      ...item,
      index,
      color: colors[index % colors.length],
      pct: total > 0 ? Math.round((item.value / total) * 100) : 0,
      startAngle: cursorAngle,
      endAngle: cursorAngle + angle,
    };
    cursorAngle += angle;
    return slice;
  });

  return (
    <div className="grid min-h-[340px] grid-cols-[minmax(0,1fr)_240px] gap-5 rounded-xl border border-border bg-background/60 p-5">
      <div className="flex min-w-0 flex-col">
        <div>
          <h4 className="text-base font-bold uppercase tracking-wide">{title}</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{total.toLocaleString('pt-BR')} pessoas/imp.</p>
        </div>
        <div className="mt-5 flex-1 space-y-2">
          {slices.length > 0 ? slices.slice(0, 7).map((item) => (
            <button
              key={item.label}
              type="button"
              onMouseEnter={() => setActiveIndex(item.index)}
              onMouseLeave={() => setActiveIndex(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                activeIndex === item.index ? 'bg-muted/60 text-foreground' : 'text-muted-foreground hover:bg-muted/40'
              )}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className="font-bold text-foreground">{item.pct}%</span>
            </button>
          )) : (
            <p className="text-xs text-muted-foreground">Sem dados no período.</p>
          )}
        </div>
      </div>
      <div className="flex h-full items-center justify-center">
        {slices.length > 0 ? (
          <svg viewBox="0 0 220 220" className="h-56 w-56 overflow-visible" role="img" aria-label={`Gráfico de ${title}`}>
            {slices.map((slice) => (
              <path
                key={slice.label}
                d={describeDonutSlice(110, 110, 100, 48, slice.startAngle, slice.endAngle)}
                fill={slice.color}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="1"
                className="origin-center transition-all duration-200"
                style={{
                  opacity: activeIndex === null || activeIndex === slice.index ? 1 : 0.35,
                  transform: activeIndex === slice.index ? 'scale(1.07)' : 'scale(1)',
                  filter: activeIndex === slice.index ? 'drop-shadow(0 12px 18px rgba(0,0,0,0.45))' : 'none',
                }}
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <title>{`${slice.label}: ${slice.pct}%`}</title>
              </path>
            ))}
            <circle cx="110" cy="110" r="40" className="fill-card" />
            <text x="110" y="106" textAnchor="middle" className="fill-muted-foreground text-[10px] font-bold uppercase tracking-widest">Total</text>
            <text x="110" y="124" textAnchor="middle" className="fill-foreground text-[18px] font-bold">{total.toLocaleString('pt-BR')}</text>
          </svg>
        ) : (
          <div className="relative h-56 w-56 rounded-full bg-muted/30">
            <div className="absolute inset-12 rounded-full bg-card" />
          </div>
        )}
      </div>
    </div>
  );
}

function AudiencePlatformBlock({
  title,
  description,
  color,
  colors,
  data,
}: {
  title: string;
  description: string;
  color: string;
  colors: string[];
  data: AudienceBreakdowns;
}) {
  const keys: AudienceKey[] = ['age', 'gender', 'platform', 'device'];
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{title === 'Meta Ads' ? <MetaMark /> : <GoogleMark />}</span>
        <div>
          <h3 className="font-heading text-2xl font-bold uppercase tracking-wide" style={{ color }}>{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid flex-1 grid-rows-4 gap-3">
        {keys.map((key) => (
          <AudiencePieCard key={key} title={AUDIENCE_TITLES[key]} data={data[key]} colors={colors} />
        ))}
      </div>
    </div>
  );
}

function GoogleKeywordInsightsSection({
  keywords,
  ads,
  loading,
}: {
  keywords: GoogleKeywordInsight[];
  ads: GoogleAdPreview[];
  loading: boolean;
}) {
  const topKeyword = keywords[0];
  const totalClicks = keywords.reduce((sum, item) => sum + item.clicks, 0);
  const totalCost = keywords.reduce((sum, item) => sum + item.cost, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider">Palavras-chave e anúncios Google Ads</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Termos e prévias montadas com títulos e descrições dos anúncios ativos no período selecionado.
          </p>
        </div>
        {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
          <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
          <div className="h-96 rounded-xl border border-border bg-card animate-pulse" />
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.35fr]">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <GoogleMark />
              <div>
                <h3 className="font-heading text-2xl font-bold uppercase tracking-wide text-[#EA4335]">Palavras-chave</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {keywords.length > 0
                    ? `${keywords.length} termos com impressão no período.`
                    : 'Nenhuma palavra-chave com impressão no período.'}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Principal</p>
                <p className="mt-1 truncate text-sm font-bold">{topKeyword?.keyword ?? '—'}</p>
              </div>
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cliques</p>
                <p className="mt-1 text-sm font-bold">{totalClicks.toLocaleString('pt-BR')}</p>
              </div>
              <div className="rounded-lg bg-background/70 p-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Custo</p>
                <p className="mt-1 text-sm font-bold">{formatCurrencyBRL(totalCost)}</p>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[minmax(0,1.4fr)_0.6fr_0.6fr_0.7fr] gap-2 bg-muted/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <span>Palavra</span>
                <span className="text-right">Cliques</span>
                <span className="text-right">Conv.</span>
                <span className="text-right">CPC</span>
              </div>
              <div className="max-h-[420px] divide-y divide-border overflow-y-auto">
                {keywords.length > 0 ? keywords.map((keyword) => (
                  <div key={`${keyword.accountId}-${keyword.campaignName}-${keyword.keyword}`} className="grid grid-cols-[minmax(0,1.4fr)_0.6fr_0.6fr_0.7fr] gap-2 px-3 py-2.5 text-xs">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{keyword.keyword}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{keyword.campaignName}</p>
                    </div>
                    <span className="text-right font-bold">{keyword.clicks.toLocaleString('pt-BR')}</span>
                    <span className="text-right font-bold">{keyword.conversions.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>
                    <span className="text-right font-bold">{keyword.cpc > 0 ? formatCurrencyBRL(keyword.cpc) : '—'}</span>
                  </div>
                )) : (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">Sem palavras-chave no período.</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start gap-3">
              <GoogleMark />
              <div>
                <h3 className="font-heading text-2xl font-bold uppercase tracking-wide text-[#EA4335]">Prévias dos anúncios</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Simulação do anúncio de pesquisa com os títulos e descrições configurados.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {ads.length > 0 ? ads.map((ad) => <GoogleSearchAdPreviewCard key={`${ad.accountId}-${ad.id}`} ad={ad} />) : (
                <div className="rounded-xl border border-border bg-background/60 p-6 text-sm text-muted-foreground">
                  Nenhum anúncio ativo com impressão no período.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GoogleSearchAdPreviewCard({ ad }: { ad: GoogleAdPreview }) {
  const domain = (() => {
    try { return ad.finalUrls[0] ? new URL(ad.finalUrls[0]).hostname.replace(/^www\./, '') : 'site.com.br'; }
    catch { return 'site.com.br'; }
  })();
  const path = [ad.path1, ad.path2].filter(Boolean).join('/');
  const headline = ad.headlines.slice(0, 3).filter(Boolean).join(' | ') || 'Título do anúncio';
  const description = ad.descriptions.slice(0, 2).filter(Boolean).join(' ') || 'Descrição configurada no Google Ads.';

  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded border border-[#EA4335]/30 bg-[#EA4335]/10 px-1.5 py-0.5 font-bold text-[#EA4335]">Anúncio</span>
          <span className="truncate text-muted-foreground">{domain}{path ? `/${path}` : ''}</span>
        </div>
        <h4 className="mt-2 line-clamp-2 text-base font-bold leading-snug text-[#4285F4]">{headline}</h4>
        <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-card p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Impr.</p>
          <p className="font-bold">{ad.impressions.toLocaleString('pt-BR')}</p>
        </div>
        <div className="rounded-lg bg-card p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Cliques</p>
          <p className="font-bold">{ad.clicks.toLocaleString('pt-BR')}</p>
        </div>
        <div className="rounded-lg bg-card p-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Custo</p>
          <p className="font-bold">{formatCurrencyBRL(ad.cost)}</p>
        </div>
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">{ad.campaignName} · {ad.accountName}</p>
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
  const [audience, setAudience] = useState<AudienceResponse>(EMPTY_AUDIENCE);
  const [googleKeywordInsights, setGoogleKeywordInsights] = useState<GoogleKeywordInsightsResponse>(EMPTY_GOOGLE_KEYWORD_INSIGHTS);
  const [previewCreative, setPreviewCreative] = useState<TopCreative | null>(null);
  const [campaignSortBy, setCampaignSortBy] = useState<SortKey>('spend');
  const [sortBy, setSortBy] = useState<SortKey>('spend');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [googleKeywordInsightsLoading, setGoogleKeywordInsightsLoading] = useState(false);

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

  // Fetch audience breakdowns
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setAudienceLoading(true);
    const params = new URLSearchParams({
      period,
      clientIds: [...selectedIds].join(','),
    });
    fetch(`/api/audience?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<AudienceResponse> : EMPTY_AUDIENCE)
      .then(setAudience)
      .catch(() => setAudience(EMPTY_AUDIENCE))
      .finally(() => setAudienceLoading(false));
  }, [period, selectedIds]);

  // Fetch Google Ads keyword and ad preview insights
  useEffect(() => {
    if (selectedIds.size === 0) return;
    setGoogleKeywordInsightsLoading(true);
    const params = new URLSearchParams({
      period,
      clientIds: [...selectedIds].join(','),
    });
    fetch(`/api/google/keyword-insights?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<GoogleKeywordInsightsResponse> : EMPTY_GOOGLE_KEYWORD_INSIGHTS)
      .then(setGoogleKeywordInsights)
      .catch(() => setGoogleKeywordInsights(EMPTY_GOOGLE_KEYWORD_INSIGHTS))
      .finally(() => setGoogleKeywordInsightsLoading(false));
  }, [period, selectedIds]);

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
  const leadsPartial = autoPartial(leadsGoal, period);
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
    <div className="space-y-5 pb-10">
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
        <Link
          href={`/clientes/${alerts[0].clientId}`}
          className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-orange-400/40 hover:bg-orange-500/5"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-orange-400">{alerts.length} alerta{alerts.length > 1 ? 's' : ''} fora do padrão</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className={cn('mr-2 rounded-full border px-2 py-0.5 text-[10px] font-bold',
                alerts[0].severity === 'critical'
                  ? 'border-red-500/30 bg-red-500/15 text-red-400'
                  : 'border-orange-500/30 bg-orange-500/15 text-orange-400'
              )}>
                {alerts[0].severity === 'critical' ? 'Crítico' : 'Atenção'}
              </span>
              {alerts[0].clientName} — {alerts[0].msg}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
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
          partial={leadsPartial}
          loading={metricsLoading}
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
          showProgress={false}
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

      <div className="grid items-stretch gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <AudienceSnapshotCard audience={audience} loading={audienceLoading} />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ordenar criativos por</span>
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
          </div>
          <TopCreativesTablePanel creatives={creatives} loading={creativesLoading} onPreview={setPreviewCreative} />
        </div>
      </div>

      <GoogleKeywordInsightsSection
        keywords={googleKeywordInsights.keywords}
        ads={googleKeywordInsights.ads}
        loading={googleKeywordInsightsLoading}
      />
      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />
    </div>
  );
}
