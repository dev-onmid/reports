"use client";

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ChevronDown, ChevronUp, GripVertical, ImageIcon,
  LayoutDashboard, Play, RefreshCw, Search,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { CampaignPerformance } from '@/app/api/campaigns/route';
import type { AudienceBreakdowns, AudienceResponse, AudienceSlice } from '@/app/api/audience/route';

type Period = 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'custom';
type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; formLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
};
type GoalConfig = { type: string; target: number; label?: string; format?: 'currency' | 'number' };
type FunnelStage = { id: string; name: string; conversion: number };
type PlanningConfig = { tkm: number; cplMeta: number; stages: FunnelStage[] };
type SortKey = 'spend' | 'leads' | 'impressions' | 'clicks' | 'cpl' | 'ctr';
type AudienceKey = keyof AudienceBreakdowns;
type AdsPlatform = 'meta' | 'google';
type ClientAccountLink = {
  clientId: string;
  platform: string;
  accountId: string;
};
type AdAccountBalance = {
  id: string;
  name: string;
  currency: string;
  balance: number | null;
  error: string | null;
  platform: AdsPlatform;
};

const PERIODS: { value: Period; label: string }[] = [
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_14d', label: '14 dias' },
  { value: 'last_30d', label: '30 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
  { value: 'custom', label: 'Personalizado' },
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
    <span className="inline-flex h-8 w-10 shrink-0 items-center justify-center align-[-7px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="max-h-8 max-w-10 object-contain" />
    </span>
  );
}

function GoogleMark() {
  return (
    <span className="inline-flex h-8 w-10 shrink-0 items-center justify-center align-[-7px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/google-ads-logo.png" alt="Google Ads" className="max-h-8 max-w-10 object-contain" />
    </span>
  );
}

function PlatformMarkForText({ text }: { text: string }) {
  if (/meta/i.test(text)) return <MetaMark />;
  if (/google/i.test(text)) return <GoogleMark />;
  return null;
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
  const detailItems = [
    ...(showMeta ? [{ label: metaLabel, value: meta > 0 ? fmt(meta) : prefix ? prefix : 'Sem meta', tone: 'text-foreground' }] : []),
    ...(showPartial ? [{ label: partialLabel, value: partial > 0 ? fmt(partial) : '—', tone: 'text-foreground' }] : []),
    ...(showProgress && hasTarget ? [{ label: 'Atingimento', value: `${progress}%`, tone: statusColor }] : []),
  ];

  return (
    <div className="relative h-full overflow-hidden rounded-xl border border-border bg-card/95 p-10 space-y-10 shadow-[0_22px_80px_rgba(0,0,0,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_12%,rgba(123,44,255,0.10),transparent_40%)]" />
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          <p className="font-bold text-lg text-foreground">{title}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {loading ? (
        <div className="flex min-h-28 items-center justify-center gap-2 rounded-lg border border-border bg-background/70 text-muted-foreground/50">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : (
        <div className={cn('relative overflow-hidden rounded-lg border border-border bg-background/70 p-10', featured ? 'min-h-56' : 'min-h-48')}>
          <div className="grid h-full items-center gap-16 xl:grid-cols-[1.05fr_1.95fr]">
            <div className="rounded-lg bg-black/15 px-8 py-8">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
              <p className={cn('mt-1 font-heading font-bold tracking-wide leading-none text-foreground', featured ? 'text-4xl' : 'text-2xl')}>{fmt(value)}</p>
            </div>
            {detailItems.length > 0 && (
              <div className={cn(
                  'grid gap-10',
                  detailItems.length === 1 ? 'sm:grid-cols-1' : detailItems.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'
                )}>
                {detailItems.map((item) => (
                  <div key={item.label} className="min-w-0 rounded-lg bg-black/15 px-8 py-8">
                    <p className="text-[10px] font-semibold text-muted-foreground">{item.label}</p>
                    <p className={cn('mt-1 truncate text-sm font-bold', item.tone)}>{item.value}</p>
                    {item.label === 'Atingimento' && (
                        <div className="mt-6 h-2 overflow-hidden rounded-full bg-[#2b2144]">
                        <div className="h-full rounded-full bg-[#8B35FF] shadow-[0_0_18px_rgba(139,53,255,0.65)]" style={{ width: `${progress}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniTrendLine({ color }: { color: string }) {
  const gradientId = `trend-${color.replace('#', '')}`;
  return (
    <svg viewBox="0 0 320 92" className="h-20 w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 76 C28 65 45 56 68 67 S111 79 132 61 S158 62 178 47 S204 16 229 31 S264 52 287 36 S306 26 320 16"
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M0 76 C28 65 45 56 68 67 S111 79 132 61 S158 62 178 47 S204 16 229 31 S264 52 287 36 S306 26 320 16 L320 92 L0 92 Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
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
    <div className="h-full rounded-xl border border-border bg-background/70 p-9">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-6 font-heading text-4xl font-bold leading-none" style={{ color }}>
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
    <div className="relative h-full overflow-hidden rounded-xl border border-border bg-card/95 p-10 shadow-[0_22px_80px_rgba(0,0,0,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_30%,rgba(139,53,255,0.14),transparent_42%)]" />
      <div className="relative">
      <p className="font-bold text-lg text-foreground">{title}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      <div className="mt-10 rounded-lg border border-border bg-background/70 p-10">
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
      <div className="mt-10">
        <MiniTrendLine color="#8B35FF" />
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
    <div className="relative h-full overflow-hidden rounded-xl border border-border bg-card/95 p-10 shadow-[0_22px_80px_rgba(0,0,0,0.18)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_20%,rgba(255,255,255,0.05),transparent_38%)]" />
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
      <div className="relative flex items-start gap-8">
        {mark}
        <div>
          <h3 className="flex items-center gap-3 font-heading text-3xl font-bold uppercase tracking-wide text-foreground">
            <PlatformMarkForText text={title} />
            <span>{title}</span>
          </h3>
          <p className="mt-1 text-xs text-foreground/75">{description}</p>
        </div>
      </div>
      <div className="relative mt-10 grid gap-10 sm:grid-cols-2">
        <ChannelMetricBox label={resultLabel} value={resultValue} color={color} />
        <ChannelMetricBox label={costLabel} value={costValue} format="currency" color={color} />
      </div>
      <div className="relative mt-10">
        <MiniTrendLine color={color} />
      </div>
    </div>
  );
}

function MetricSection({
  title,
  description,
  accent,
  children,
}: {
  title?: string;
  description?: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        {title && (
        <div>
          <h2 className="flex items-center gap-3 font-heading text-3xl font-bold uppercase tracking-wide text-foreground">
            <PlatformMarkForText text={title} />
            <span>{title}</span>
          </h2>
          {description && <p className="mt-1 text-xs text-foreground/75">{description}</p>}
        </div>
        )}
      </div>
      {children}
    </section>
  );
}

function MetricTile({
  title,
  value,
  format = 'number',
  accent = '#8B35FF',
  description,
  meta,
  partial,
  loading = false,
}: {
  title: string;
  value: number;
  format?: 'currency' | 'number' | 'percent' | 'times';
  accent?: string;
  description?: string;
  meta?: number;
  partial?: number;
  loading?: boolean;
}) {
  const fmt = (v: number) =>
    format === 'currency' ? formatCurrencyBRL(v)
    : format === 'percent' ? `${v.toFixed(1)}%`
    : format === 'times' ? `${v.toFixed(1)}x`
    : v.toLocaleString('pt-BR');
  const target = partial && partial > 0 ? partial : meta;
  const rawProgress = target && target > 0 ? (value / target) * 100 : null;
  const progress = rawProgress === null ? null : Math.max(0, Math.min(100, rawProgress));
  const progressLabel = rawProgress === null ? null : `${rawProgress.toFixed(rawProgress >= 100 ? 2 : 0)}%`;
  const progressColor = (() => {
    if (rawProgress === null) return accent;
    if (rawProgress <= 35) return '#EF4444';
    if (rawProgress <= 75) return '#FACC15';
    const boost = Math.min(Math.max(rawProgress - 100, 0) / 100, 1);
    const green = Math.round(197 + (245 - 197) * boost);
    return `rgb(${Math.round(34 - 10 * boost)}, ${green}, ${Math.round(94 - 30 * boost)})`;
  })();
  const hasProgressPanel = meta !== undefined || partial !== undefined || progress !== null;

  return (
    <div className={cn(
      'relative flex flex-col overflow-hidden rounded-xl border border-border bg-card/95 p-8 shadow-[0_22px_80px_rgba(0,0,0,0.18)]',
      hasProgressPanel ? 'min-h-[320px]' : 'min-h-[260px]'
    )}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: hasProgressPanel ? progressColor : accent }} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_18%,rgba(123,44,255,0.10),transparent_40%)]" />
      <div className="relative flex h-full flex-col">
        <p className="flex items-center gap-2 text-lg font-bold text-foreground">
          <PlatformMarkForText text={title} />
          <span>{title}</span>
        </p>
        {description && <p className="mt-1 text-[11px] text-foreground/75">{description}</p>}
        {loading ? (
          <div className="mt-8 flex flex-1 items-center rounded-lg border border-border bg-background/70 p-7">
            <div className="flex items-center gap-2 text-muted-foreground/60">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Carregando...</span>
            </div>
          </div>
        ) : hasProgressPanel ? (
          <div className="mt-8 flex flex-1 flex-col justify-center rounded-lg border border-border bg-background/70 p-8">
            <div className={cn('grid gap-8 text-center', partial !== undefined ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              {meta !== undefined && (
                <div>
                  <p className="font-heading text-2xl font-bold leading-none text-foreground">{meta > 0 ? fmt(meta) : 'Sem meta'}</p>
                  <p className="mt-2 text-sm font-bold text-muted-foreground">Meta</p>
                </div>
              )}
              {partial !== undefined && (
                <div>
                  <p className="font-heading text-2xl font-bold leading-none text-foreground">{partial > 0 ? fmt(partial) : '—'}</p>
                  <p className="mt-2 text-sm font-bold text-muted-foreground">Meta Parcial</p>
                </div>
              )}
              <div>
                <p className="font-heading text-2xl font-bold leading-none text-foreground">{fmt(value)}</p>
                <p className="mt-2 text-sm font-bold text-muted-foreground">Realizado</p>
              </div>
            </div>
            {progress !== null && progressLabel && (
              <div className="mt-8">
                <div
                  className="relative h-9 overflow-hidden rounded-md bg-muted/50"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${progressColor}33 25%, transparent 25%, transparent 50%, ${progressColor}33 50%, ${progressColor}33 75%, transparent 75%, transparent)`,
                    backgroundSize: '32px 32px',
                  }}
                >
                  <div
                    className="absolute inset-y-0 left-0 rounded-md transition-all"
                    style={{
                      width: `${progress}%`,
                      backgroundColor: progressColor,
                      boxShadow: `0 0 24px ${progressColor}66`,
                      opacity: 0.82,
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="rounded bg-background/65 px-3 py-0.5 text-base font-black text-foreground">{progressLabel}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-8 flex flex-1 items-center rounded-lg border border-border bg-background/70 p-7">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
              <p className="mt-3 font-heading text-4xl font-bold leading-none" style={{ color: accent }}>
                {fmt(value)}
              </p>
            </div>
          </div>
        )}
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
    <div className="flex min-h-[420px] flex-col rounded-xl border border-border bg-background/60 p-5">
      <div>
        <h4 className="text-base font-bold uppercase tracking-wide">{title}</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{total.toLocaleString('pt-BR')} pessoas/imp.</p>
      </div>
      <div className="mt-5 flex justify-center">
        {slices.length > 0 ? (
          <svg viewBox="0 0 220 220" className="h-52 w-52 overflow-visible" role="img" aria-label={`Gráfico de ${title}`}>
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
          <div className="relative h-52 w-52 rounded-full bg-muted/30">
            <div className="absolute inset-12 rounded-full bg-card" />
          </div>
        )}
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
          <h3 className="font-heading text-2xl font-bold uppercase tracking-wide text-foreground">{title}</h3>
          <p className="mt-1 text-xs text-foreground/75">{description}</p>
        </div>
      </div>
      <div className="mt-4 grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {keys.map((key) => (
          <AudiencePieCard key={key} title={AUDIENCE_TITLES[key]} data={data[key]} colors={colors} />
        ))}
      </div>
    </div>
  );
}

// ── Dashboard Edit Mode ──────────────────────────────────────────────────────
type WidgetId = 'general' | 'meta' | 'google';

const WIDGET_INFO: Record<WidgetId, { label: string }> = {
  general: { label: 'Métricas Gerais' },
  meta: { label: 'Meta Ads' },
  google: { label: 'Google Ads' },
};

const DEFAULT_WIDGET_ORDER: WidgetId[] = ['general', 'meta', 'google'];
const LS_ORDER = 'dashboard_widget_order';
const LS_COLLAPSED = 'dashboard_widget_collapsed';

function SortableWidget({
  id, editMode, collapsed, onToggleCollapse, children,
}: {
  id: WidgetId; editMode: boolean; collapsed: boolean; onToggleCollapse: () => void; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style}>
      {editMode && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Arrastar seção"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="flex-1 text-xs font-semibold text-muted-foreground">{WIDGET_INFO[id].label}</span>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={collapsed ? 'Expandir seção' : 'Recolher seção'}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      )}
      {!collapsed && children}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function GeneralDashboard() {
  const { clients } = useClients();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [period, setPeriod] = useState<Period>('this_month');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [metricsByClient, setMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [creatives, setCreatives] = useState<TopCreative[]>([]);
  const [audience, setAudience] = useState<AudienceResponse>(EMPTY_AUDIENCE);
  const [balances, setBalances] = useState<AdAccountBalance[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientAccountLink[]>([]);
  const [previewCreative, setPreviewCreative] = useState<TopCreative | null>(null);
  const [campaignSortBy, setCampaignSortBy] = useState<SortKey>('spend');
  const [sortBy, setSortBy] = useState<SortKey>('spend');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(DEFAULT_WIDGET_ORDER);
  const [collapsedWidgets, setCollapsedWidgets] = useState<Set<WidgetId>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setWidgetOrder(order => {
        const oldIndex = order.indexOf(active.id as WidgetId);
        const newIndex = order.indexOf(over.id as WidgetId);
        return arrayMove(order, oldIndex, newIndex);
      });
    }
  }

  function toggleCollapse(id: WidgetId) {
    setCollapsedWidgets(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Load layout from localStorage
  useEffect(() => {
    try {
      const order = localStorage.getItem(LS_ORDER);
      if (order) {
        const parsed = JSON.parse(order) as WidgetId[];
        if (Array.isArray(parsed) && parsed.every(id => DEFAULT_WIDGET_ORDER.includes(id))) {
          setWidgetOrder(parsed);
        }
      }
      const collapsed = localStorage.getItem(LS_COLLAPSED);
      if (collapsed) setCollapsedWidgets(new Set(JSON.parse(collapsed) as WidgetId[]));
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem(LS_ORDER, JSON.stringify(widgetOrder)); }, [widgetOrder]);
  useEffect(() => { localStorage.setItem(LS_COLLAPSED, JSON.stringify([...collapsedWidgets])); }, [collapsedWidgets]);

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

  // Skip fetching when custom period but dates not yet filled
  const customReady = period !== 'custom' || (customDateFrom.length === 10 && customDateTo.length === 10);

  const buildPeriodParams = (extra?: Record<string, string>) => {
    const p: Record<string, string> = { period, ...extra };
    if (period === 'custom' && customDateFrom && customDateTo) {
      p.dateFrom = customDateFrom;
      p.dateTo = customDateTo;
    }
    return new URLSearchParams(p);
  };

  // Fetch metrics for selected clients
  useEffect(() => {
    let cancelled = false;
    setMetricsLoading(true);
    setMetricsByClient({});
    if (selectedIds.size === 0 || !customReady) {
      setMetricsLoading(false);
      return () => { cancelled = true; };
    }
    const ids = [...selectedIds];
    const periodParams = period === 'custom' && customDateFrom && customDateTo
      ? `period=${period}&dateFrom=${customDateFrom}&dateTo=${customDateTo}`
      : `period=${period}`;
    Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/clients/${id}/metrics?${periodParams}`);
        if (cancelled) return null;
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null };
        return [id, data] as const;
      })
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, ApiMetrics> = {};
      for (const r of results) if (r.status === 'fulfilled' && r.value !== null) map[r.value[0]] = r.value[1];
      setMetricsByClient(map);
    }).finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady]);

  // Fetch active campaigns with spend in selected period
  useEffect(() => {
    let cancelled = false;
    setCampaignsLoading(true);
    setCampaigns([]);
    if (selectedIds.size === 0 || !customReady) {
      setCampaignsLoading(false);
      return () => { cancelled = true; };
    }
    const params = buildPeriodParams({ sortBy: campaignSortBy, limit: '30', clientIds: [...selectedIds].join(',') });
    fetch(`/api/campaigns?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<CampaignPerformance[]> : [])
      .then(data => { if (!cancelled) setCampaigns(data); })
      .catch(() => { if (!cancelled) setCampaigns([]); })
      .finally(() => { if (!cancelled) setCampaignsLoading(false); });
    return () => { cancelled = true; };
  }, [period, campaignSortBy, selectedIds, customDateFrom, customDateTo, customReady]);

  // Fetch top creatives
  useEffect(() => {
    let cancelled = false;
    setCreativesLoading(true);
    setCreatives([]);
    if (selectedIds.size === 0 || !customReady) {
      setCreativesLoading(false);
      return () => { cancelled = true; };
    }
    const params = buildPeriodParams({ sortBy, limit: '20', clientIds: [...selectedIds].join(',') });
    fetch(`/api/meta/top-creatives?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<TopCreative[]> : [])
      .then(data => { if (!cancelled) setCreatives(data); })
      .catch(() => { if (!cancelled) setCreatives([]); })
      .finally(() => { if (!cancelled) setCreativesLoading(false); });
    return () => { cancelled = true; };
  }, [period, sortBy, selectedIds, customDateFrom, customDateTo, customReady]);

  // Fetch audience breakdowns
  useEffect(() => {
    let cancelled = false;
    setAudienceLoading(true);
    setAudience(EMPTY_AUDIENCE);
    if (selectedIds.size === 0 || !customReady) {
      setAudienceLoading(false);
      return () => { cancelled = true; };
    }
    const params = buildPeriodParams({ clientIds: [...selectedIds].join(',') });
    fetch(`/api/audience?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<AudienceResponse> : EMPTY_AUDIENCE)
      .then(data => { if (!cancelled) setAudience(data); })
      .catch(() => { if (!cancelled) setAudience(EMPTY_AUDIENCE); })
      .finally(() => { if (!cancelled) setAudienceLoading(false); });
    return () => { cancelled = true; };
  }, [period, selectedIds, customDateFrom, customDateTo, customReady]);

  // Fetch balances and account links used by the general balance cards
  useEffect(() => {
    setBalancesLoading(true);
    Promise.all([
      fetch('/api/meta/account-balances'),
      fetch('/api/google/account-balances'),
      fetch('/api/clients/links'),
    ])
      .then(async ([metaRes, googleRes, linksRes]) => {
        const metaRaw: Array<Omit<AdAccountBalance, 'platform'>> = metaRes.ok ? await metaRes.json() : [];
        const googleRaw: Array<Omit<AdAccountBalance, 'platform'>> = googleRes.ok ? await googleRes.json() : [];
        const linksRaw: ClientAccountLink[] = linksRes.ok ? await linksRes.json() : [];
        setBalances([
          ...metaRaw.map((account) => ({ ...account, platform: 'meta' as const })),
          ...googleRaw.map((account) => ({ ...account, platform: 'google' as const })),
        ]);
        setClientLinks(linksRaw.filter((link) => link.platform === 'meta_ads' || link.platform === 'google_ads'));
      })
      .catch(() => {
        setBalances([]);
        setClientLinks([]);
      })
      .finally(() => setBalancesLoading(false));
  }, []);

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
  const totalCostPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const avgCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
  const avgCpa = googleConv > 0 ? googleCost / googleConv : 0;
  const metaCtr = metaImpressions > 0 ? (metaClicks / metaImpressions) * 100 : 0;
  const metaCpc = metaClicks > 0 ? metaSpend / metaClicks : 0;
  let googleImpressions = 0, googleClicks = 0;
  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.google) {
      googleImpressions += m.google.impressions;
      googleClicks += m.google.clicks;
    }
  }
  const googleCpc = googleClicks > 0 ? googleCost / googleClicks : 0;
  const googleCtrValue = googleImpressions > 0 ? (googleClicks / googleImpressions) * 100 : 0;

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
  const selectedLinkedAccountIds = new Set(
    clientLinks
      .filter((link) => selectedIds.has(link.clientId))
      .map((link) => {
        const p = link.platform === 'meta_ads' ? 'meta' : link.platform === 'google_ads' ? 'google' : link.platform;
        return `${p}:${link.accountId}`;
      })
  );
  const metaBalance = balances
    .filter((account) => account.platform === 'meta' && selectedLinkedAccountIds.has(`meta:${account.id}`) && account.balance !== null)
    .reduce((sum, account) => sum + (account.balance ?? 0), 0);
  const googleBalance = balances
    .filter((account) => account.platform === 'google' && selectedLinkedAccountIds.has(`google:${account.id}`) && account.balance !== null)
    .reduce((sum, account) => sum + (account.balance ?? 0), 0);

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
  const metaCampaigns = campaigns.filter((campaign) => campaign.platform === 'meta');
  const googleCampaigns = campaigns.filter((campaign) => campaign.platform === 'google');

  return (
    <div className="space-y-6 pb-10">
      {/* Header + Filters */}
      <div className="sticky top-0 z-20 -mx-6 px-6 py-3 -mt-6 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-heading text-4xl uppercase tracking-wider">Dashboard Geral</h1>
            <p className="mt-0.5 text-muted-foreground text-sm">Performance consolidada das contas vinculadas.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ClientSelector clients={clients} selected={selectedIds} onChange={setSelectedIds} />
            <div className="flex overflow-hidden rounded-lg border border-border">
              {PERIODS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    'px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors',
                    period === p.value ? 'bg-primary text-black' : 'bg-card text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {metricsLoading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
            <button
              type="button"
              onClick={() => setEditMode(v => !v)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                editMode
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
              )}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              {editMode ? 'Concluir edição' : 'Editar layout'}
            </button>
          </div>
        </div>
        {period === 'custom' && (
          <div className="mt-2 pb-1 flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Período</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customDateFrom}
                onChange={e => setCustomDateFrom(e.target.value)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={customDateTo}
                onChange={e => setCustomDateTo(e.target.value)}
                className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {customDateFrom && customDateTo && customReady && (
              <span className="text-[11px] font-semibold text-primary">Aplicado</span>
            )}
            {customDateFrom && customDateTo && !customReady && (
              <span className="text-[11px] text-muted-foreground">Preencha as duas datas</span>
            )}
          </div>
        )}
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

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgetOrder} strategy={verticalListSortingStrategy}>
          <div className="grid gap-12">
            {widgetOrder.map(id => (
              <SortableWidget
                key={id}
                id={id}
                editMode={editMode}
                collapsed={collapsedWidgets.has(id)}
                onToggleCollapse={() => toggleCollapse(id)}
              >
                {id === 'general' && (
                  <MetricSection accent="#8B35FF">
                    <div className="grid gap-12">
                      <div className="grid items-stretch gap-12 lg:grid-cols-2">
                        <MetricTile title="Resultado" value={revenue} meta={revenueGoal} partial={revenuePartial} format="currency" loading={metricsLoading} description="Resultado realizado no período." />
                        <MetricTile title="ROI" value={roi} format="times" loading={metricsLoading} description="Resultado dividido pelo total investido." />
                      </div>
                      <div className="grid items-stretch gap-12 lg:grid-cols-2">
                        <MetricTile title="Total de Leads" value={totalLeads} meta={leadsGoal} partial={leadsPartial} loading={metricsLoading} description="Meta Ads + Google Ads." />
                        <MetricTile title="Custo por Lead" value={totalCostPerLead} format="currency" loading={metricsLoading} description="Custo por resultado consolidado." />
                      </div>
                      <div className="grid items-stretch gap-12 lg:grid-cols-3">
                        <MetricTile title="Total Investido" value={totalSpend} meta={plannedInvestment} format="currency" loading={metricsLoading} description="Investimento total em mídia." />
                        <MetricTile title="Saldo da Conta Meta Ads" value={metaBalance} format="currency" loading={balancesLoading} accent="#0B84FF" description="Soma dos saldos vinculados aos clientes selecionados." />
                        <MetricTile title="Saldo da Conta Google Ads" value={googleBalance} format="currency" loading={balancesLoading} accent="#55F52F" description="Soma dos saldos vinculados aos clientes selecionados." />
                      </div>
                    </div>
                  </MetricSection>
                )}
                {id === 'meta' && (
                  <MetricSection
                    title="Métricas Meta Ads"
                    description={`${metaFormLeads.toLocaleString('pt-BR')} formulários + ${metaConversations.toLocaleString('pt-BR')} conversas no período selecionado.`}
                    accent="#0B84FF"
                  >
          <div className="grid items-stretch gap-12 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile title="Leads Meta Ads" value={metaLeads} loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="CPL Meta Ads" value={avgCpl} format="currency" loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="Investimento Meta Ads" value={metaSpend} format="currency" loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="Impressões Meta Ads" value={metaImpressions} loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="Cliques Meta Ads" value={metaClicks} loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="CPC Meta Ads" value={metaCpc} format="currency" loading={metricsLoading} accent="#0B84FF" />
            <MetricTile title="CTR Meta Ads" value={metaCtr} format="percent" loading={metricsLoading} accent="#0B84FF" />
          </div>

          <div className="mt-12 space-y-12">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                    <MetaMark />
                    <span>Campanhas Ativas Meta Ads</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-foreground/75">
                    Campanhas Meta com gasto no período selecionado.
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
              <CampaignPerformanceTable campaigns={metaCampaigns} loading={campaignsLoading} />
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                    <MetaMark />
                    <span>Anúncios e previews Meta Ads</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-foreground/75">Criativos com melhor performance no período selecionado.</p>
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
                      <div className="aspect-[9/16] bg-muted/30" />
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
                    <CreativeCard key={c.adId} creative={c} sortBy={sortBy} onPreview={setPreviewCreative} />
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                  <MetaMark />
                  <span>Público Meta Ads</span>
                </h3>
                <p className="mt-0.5 text-xs text-foreground/75">Recortes por idade, gênero, plataforma e dispositivo do Meta Ads.</p>
              </div>
              {audienceLoading ? (
                <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
                  <div className="h-5 w-32 rounded bg-muted/40" />
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((__, itemIndex) => (
                      <div key={itemIndex} className="h-40 rounded-xl bg-muted/20" />
                    ))}
                  </div>
                </div>
              ) : (
                <AudiencePlatformBlock
                  title="Meta Ads"
                  description="Alcance vindo das contas Meta vinculadas."
                  color="#0B84FF"
                  colors={META_AUDIENCE_COLORS}
                  data={audience.meta}
                />
              )}
            </div>
          </div>
                  </MetricSection>
                )}
                {id === 'google' && (
                  <MetricSection
                    title="Métricas Google Ads"
                    description="Conversões e custos vindos apenas das contas Google Ads vinculadas."
                    accent="#55F52F"
                  >
          <div className="grid items-stretch gap-12 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile title="Leads Google Ads" value={googleConv} loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="Custo / Conversão" value={avgCpa} format="currency" loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="Investimento Google Ads" value={googleCost} format="currency" loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="Impressões Google Ads" value={googleImpressions} loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="Cliques Google Ads" value={googleClicks} loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="CPC Google Ads" value={googleCpc} format="currency" loading={metricsLoading} accent="#55F52F" />
            <MetricTile title="CTR Google Ads" value={googleCtrValue} format="percent" loading={metricsLoading} accent="#55F52F" />
          </div>

          <div className="mt-12 space-y-12">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                    <GoogleMark />
                    <span>Campanhas Ativas Google Ads</span>
                  </h3>
                  <p className="mt-0.5 text-xs text-foreground/75">
                    Campanhas Google com gasto no período selecionado.
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
              <CampaignPerformanceTable campaigns={googleCampaigns} loading={campaignsLoading} />
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                  <GoogleMark />
                  <span>Público Google Ads</span>
                </h3>
                <p className="mt-0.5 text-xs text-foreground/75">Recortes por idade, gênero, plataforma e dispositivo do Google Ads.</p>
              </div>
              {audienceLoading ? (
                <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
                  <div className="h-5 w-32 rounded bg-muted/40" />
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {Array.from({ length: 4 }).map((__, itemIndex) => (
                      <div key={itemIndex} className="h-40 rounded-xl bg-muted/20" />
                    ))}
                  </div>
                </div>
              ) : (
                <AudiencePlatformBlock
                  title="Google Ads"
                  description="Impressões vindas das contas Google Ads vinculadas."
                  color="#EA4335"
                  colors={GOOGLE_AUDIENCE_COLORS}
                  data={audience.google}
                />
              )}
            </div>
          </div>
                  </MetricSection>
                )}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>

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

      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />
    </div>
  );
}
