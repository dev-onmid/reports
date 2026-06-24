"use client";

import RGL, { WidthProvider } from 'react-grid-layout';
import type { Layout as RglLayout } from 'react-grid-layout';
const RglGrid = WidthProvider(RGL);
import React, { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ChevronDown, ChevronUp, ChevronRight, GripVertical, ImageIcon,
  LayoutDashboard, LayoutTemplate, Play, RefreshCw, Search, Sparkles, Check, X,
  Pause, CircleDot, Pencil, Settings2, Users, Copy,
  Bell, DollarSign, Tag, TrendingUp, Calendar, BarChart3, Zap, Target, Briefcase,
  Wallet, MousePointerClick, CreditCard, PiggyBank, Clock, Info, Lightbulb, UserPlus, CheckCircle2,
  Eye, Heart, Monitor, ExternalLink, Bookmark, MessageCircle,
} from 'lucide-react';
import { getAuthSession } from '@/lib/auth-store';
import type { AiInsight } from '@/app/api/ai/insights/route';
import type { AdSet, AdSetWithMetrics } from '@/app/api/meta/campaigns/[id]/adsets/route';
import type { MetaAd } from '@/app/api/meta/campaigns/[id]/ads/route';
import type { MetaAdWithMetrics } from '@/app/api/meta/adsets/[id]/ads/route';
import type { GoogleAdGroup } from '@/app/api/google/campaigns/[id]/adgroups/route';
import type { GoogleAd } from '@/app/api/google/adgroups/[id]/ads/route';
import type { CopyVariation } from '@/app/api/ai/copy/route';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, rectSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { ClientAvatar } from '@/components/client-avatar';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { PageInsightsResult, FacebookPageData, InstagramPageData } from '@/app/api/meta/page-insights/route';
import type { CampaignPerformance } from '@/app/api/campaigns/route';
import type { GoogleKeyword } from '@/app/api/google/keywords/route';
import type { AudienceBreakdowns, AudienceResponse, AudienceSlice } from '@/app/api/audience/route';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { APP_VERSION } from '@/lib/app-version';
import { BackButton } from '@/components/layout/back-button';
import { MetaAdsMark, GoogleAdsMark } from '@/components/platform-logos';

type Period = 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'custom';
type FunnelEntry = { date: string; stage: string; amount?: number };
type ClientSheetsSummary = { entries: FunnelEntry[]; stages: string[] };
type ApiMetrics = {
  meta: { spend: number; reach?: number; impressions: number; clicks: number; leads: number; formLeads?: number; siteLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
  crm?: { revenue: number; sales: number; leads: number; ticket: number } | null;
  daily?: DailyMetricPoint[];
};
type DailyMetricPoint = {
  date: string;
  meta?: { spend: number; reach: number; impressions: number; clicks: number; leads: number };
  google?: { cost: number; impressions: number; clicks: number; conversions: number };
  crm?: { revenue: number; sales: number; leads: number };
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
  meta: { age: [], gender: [], platform: [], device: [], platformConversions: [], deviceConversions: [] },
  google: { age: [], gender: [], platform: [], device: [], platformConversions: [], deviceConversions: [] },
};

const META_AUDIENCE_COLORS = ['#0B84FF', '#55F52F', '#7B2CFF', '#38BDF8', '#F59E0B', '#EC4899', '#EF4444', '#A3E635'];
const GOOGLE_AUDIENCE_COLORS = ['#EA4335', '#FBBC05', '#34A853', '#4285F4', '#7B2CFF', '#F97316', '#EC4899', '#22C55E'];
const AUDIENCE_TITLES: Record<AudienceKey, string> = {
  age: 'Idade',
  gender: 'Gênero',
  platform: 'Plataforma',
  device: 'Dispositivo',
  platformConversions: 'Conv. por Plataforma',
  deviceConversions: 'Conv. por Dispositivo',
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

function periodToDateRange(
  period: Period,
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

  switch (period) {
    case 'yesterday': return { from: yesterday, to: yesterday };
    case 'last_7d': { const f = new Date(today); f.setDate(f.getDate() - 6); return { from: f, to: today }; }
    case 'last_14d': { const f = new Date(today); f.setDate(f.getDate() - 13); return { from: f, to: today }; }
    case 'last_30d': { const f = new Date(today); f.setDate(f.getDate() - 29); return { from: f, to: today }; }
    case 'this_month': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
    case 'last_month': return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
    case 'custom': return { from: customFrom ? new Date(customFrom) : today, to: customTo ? new Date(customTo) : today };
    default: return { from: today, to: today };
  }
}

function entriesInRange(entries: FunnelEntry[], from: Date, to: Date): FunnelEntry[] {
  const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
  return entries.filter(e => { const d = new Date(e.date); return d >= from && d <= toEnd; });
}

function dateKey(date: Date) {
  return date.toISOString().split('T')[0];
}

function dateKeysInRange(from: Date, to: Date) {
  const keys: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    keys.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function cumulative(values: number[]) {
  let sum = 0;
  return values.map((value) => {
    sum += value;
    return sum;
  });
}

function ratioSeries(numerators: number[], denominators: number[], multiplier = 1) {
  let n = 0;
  let d = 0;
  return numerators.map((value, index) => {
    n += value;
    d += denominators[index] ?? 0;
    return d > 0 ? (n / d) * multiplier : 0;
  });
}

function pacingSeries(total: number, length: number) {
  if (length <= 1) return [total, total];
  return Array.from({ length }, (_, index) => total * ((index + 1) / length));
}

function aggregateDailySeries(
  metrics: Record<string, ApiMetrics>,
  ids: Set<string>,
  keys: string[],
) {
  const byDate = new Map<string, DailyMetricPoint>();
  for (const key of keys) byDate.set(key, { date: key });
  for (const id of ids) {
    for (const row of metrics[id]?.daily ?? []) {
      const current = byDate.get(row.date) ?? { date: row.date };
      if (row.meta) {
        const meta = current.meta ?? { spend: 0, reach: 0, impressions: 0, clicks: 0, leads: 0 };
        meta.spend += row.meta.spend ?? 0;
        meta.reach += row.meta.reach ?? 0;
        meta.impressions += row.meta.impressions ?? 0;
        meta.clicks += row.meta.clicks ?? 0;
        meta.leads += row.meta.leads ?? 0;
        current.meta = meta;
      }
      if (row.google) {
        const google = current.google ?? { cost: 0, impressions: 0, clicks: 0, conversions: 0 };
        google.cost += row.google.cost ?? 0;
        google.impressions += row.google.impressions ?? 0;
        google.clicks += row.google.clicks ?? 0;
        google.conversions += row.google.conversions ?? 0;
        current.google = google;
      }
      if (row.crm) {
        const crm = current.crm ?? { revenue: 0, sales: 0, leads: 0 };
        crm.revenue += row.crm.revenue ?? 0;
        crm.sales += row.crm.sales ?? 0;
        crm.leads += row.crm.leads ?? 0;
        current.crm = crm;
      }
      byDate.set(row.date, current);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Sums same-position values across multiple social page datasets for sparklines.
function aggPageSeries<T extends Record<string, number[]>>(
  pages: (T | undefined)[],
  key: keyof T,
): number[] {
  const out: number[] = [];
  for (const d of pages) {
    (d?.[key] ?? [] as number[]).forEach((v: number, i: number) => { out[i] = (out[i] ?? 0) + v; });
  }
  return out;
}

// If the daily series has real data, return it; otherwise return a 2-point slope from prev→current.
// This ensures each card has a unique sparkline shape even when daily data is unavailable.
function socialSeriesOrSlope(daily: number[], prev: number, current: number): number[] | undefined {
  if (daily.some(v => v > 0)) return daily;
  const pts = [prev, current].filter(v => v > 0);
  return pts.length >= 2 ? pts : undefined;
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

function PlatformTableIcon({ platform }: { platform: AdsPlatform }) {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-white/10 shadow-[0_0_18px_rgba(255,255,255,0.12)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={platform === 'meta' ? '/brand/meta-ads-logo.webp' : '/brand/google-ads-logo.png'}
        alt={platform === 'meta' ? 'Meta Ads' : 'Google Ads'}
        className="h-4 w-4 object-contain"
      />
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
function KpiCard({ title, value, prevValue, goalValue, format = 'number', icon: Icon, iconColor, iconBg, loading = false, inverseGoal = false, inverseChange = false, footer, logo, chart = 'sparkline', series, hideGoal = false }: {
  title: string; value: number; prevValue?: number; goalValue?: number;
  format?: 'currency' | 'number' | 'percent' | 'times';
  icon: React.ElementType; iconColor: string; iconBg: string; loading?: boolean; inverseGoal?: boolean; inverseChange?: boolean;
  footer?: React.ReactNode;
  logo?: React.ReactNode;
  chart?: 'sparkline' | 'none';
  series?: number[];
  hideGoal?: boolean;
}) {
  const fmt = (v: number) =>
    format === 'currency' ? formatCurrencyBRL(v)
    : format === 'percent' ? `${v.toFixed(1)}%`
    : format === 'times' ? `${v.toFixed(2)}x`
    : v.toLocaleString('pt-BR');
  const change = (prevValue !== undefined && prevValue > 0) ? ((value - prevValue) / prevValue) * 100 : null;
  // inverseChange: métricas onde menor = melhor (ex: CPL) — aumento é ruim, queda é boa
  const isPositive = change !== null && (inverseChange ? change <= 0 : change >= 0);
  const goalProgress = goalValue !== undefined && goalValue > 0
    ? inverseGoal
      ? (goalValue / Math.max(value, 0.01)) * 100
      : (value / goalValue) * 100
    : null;
  const goalGood = goalProgress !== null && goalProgress >= 100;
  return (
    <div className="relative flex flex-col h-full overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
      {/* Accent bar — 2px top stripe in platform color */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: iconColor }} />
      {/* Corner square — NVIDIA-inspired decorative motif */}
      <div className="pointer-events-none absolute top-0 left-0 h-3 w-3" style={{ backgroundColor: iconColor }} />
      <div className="flex items-start justify-between gap-2 mt-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
        {logo ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-card">
            {logo}
          </span>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border bg-card">
            <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-32 animate-pulse rounded-[var(--radius)] bg-muted/30" />
      ) : (
        <>
          <p className="mt-3 font-heading font-normal text-xl leading-none text-foreground">{fmt(value)}</p>
          {change !== null ? (
            <p className={cn('mt-1.5 flex items-center gap-0.5 text-xs font-semibold', isPositive ? 'text-emerald-500' : 'text-red-500')}>
              {change >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs mês passado
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">— vs mês passado</p>
          )}
          {!hideGoal && (goalProgress !== null ? (
            <p className={cn('mt-1 flex items-center gap-1 text-[11px] font-semibold', goalGood ? 'text-emerald-500' : 'text-amber-500')}>
              <CircleDot className="h-2.5 w-2.5" />
              {goalProgress.toFixed(0)}% vs meta
              <span className="text-muted-foreground/70">({fmt(goalValue!)})</span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground/70">— vs meta</p>
          ))}
          {chart === 'sparkline' && (
            <div className="mt-3 -mx-1 flex-1 min-h-0">
              <MiniTrendLine
                color={change === null ? iconColor : isPositive ? '#34d399' : '#f87171'}
                trend={change === null ? 'up' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}
                values={series}
              />
            </div>
          )}
          {goalProgress !== null && (
            <div className="mt-3 h-[3px] overflow-hidden rounded-none bg-border">
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.min(100, goalProgress)}%`,
                  backgroundColor: goalGood ? '#22c55e' : goalProgress >= 50 ? '#facc15' : '#ef4444',
                }}
              />
            </div>
          )}
          {footer && <div className="mt-2 border-t border-border pt-2">{footer}</div>}
        </>
      )}
    </div>
  );
}

function TargetSummaryCard({
  title,
  value,
  partial,
  target,
  format = 'number',
  accent,
  icon: Icon,
}: {
  title: string;
  value: number;
  partial: number;
  target: number;
  format?: 'currency' | 'number';
  accent: string;
  icon: React.ElementType;
}) {
  const fmt = (v: number) => format === 'currency' ? formatCurrencyBRL(v) : v.toLocaleString('pt-BR');
  const partialPct = partial > 0 ? Math.round((value / partial) * 100) : 0;
  const progress = Math.max(0, Math.min(100, partialPct));
  const progressAccent = partialPct >= 80 ? '#22c55e' : partialPct >= 50 ? '#facc15' : '#ef4444';
  return (
    <div className="relative overflow-hidden rounded-xl border bg-[#06100D] p-5" style={{ borderColor: `${accent}99`, boxShadow: `0 0 42px ${accent}33, inset 0 0 36px ${accent}12` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(140deg, ${accent}24, transparent 46%), radial-gradient(circle at 18% 0%, ${accent}55, transparent 34%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15" style={{ background: `${accent}35`, color: accent, boxShadow: `0 0 24px ${accent}88` }}>
            <Icon className="h-4 w-4" />
          </span>
          <p className="text-sm font-bold uppercase tracking-widest text-foreground">{title}</p>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15 bg-white/10 text-foreground/70">
          <CircleDot className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="relative mt-5 grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Meta', val: target },
          { label: 'Meta Parcial', val: partial },
          { label: 'Realizado', val: value },
        ].map(item => (
          <div key={item.label} className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">{item.val > 0 ? fmt(item.val) : '—'}</p>
            <p className="mt-1 text-xs font-semibold text-foreground/65">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="relative mt-5 h-8 overflow-hidden rounded-lg border" style={{ borderColor: `${progressAccent}99`, background: `${progressAccent}18`, boxShadow: `inset 0 0 18px ${progressAccent}20` }}>
        <div
          className="flex h-full items-center justify-center rounded-md text-sm font-black text-black transition-all"
          style={{
            width: `${progress}%`,
            minWidth: progress > 0 ? '64px' : '0',
            background: `repeating-linear-gradient(45deg, ${progressAccent}, ${progressAccent} 14px, color-mix(in srgb, ${progressAccent} 78%, white) 14px, color-mix(in srgb, ${progressAccent} 78%, white) 28px)`,
            boxShadow: `0 0 22px ${progressAccent}66`,
          }}
        >
          {progress > 0 ? `${partialPct.toFixed(2)}%` : ''}
        </div>
      </div>
      <button type="button" className="relative mt-4 flex items-center gap-1.5 text-xs font-bold" style={{ color: accent }}>
        Ver detalhes <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CrmResultCard({
  revenue, revenueGoal, revenuePartial,
  sales, salesGoal, salesPartial,
  ticket,
}: {
  revenue: number; revenueGoal: number; revenuePartial: number;
  sales: number; salesGoal: number; salesPartial: number;
  ticket: number;
}) {
  const accent = '#22c55e';
  const fmtCur = (v: number) => formatCurrencyBRL(v);
  const fmtNum = (v: number) => v.toLocaleString('pt-BR');

  function bar(value: number, goal: number) {
    const pct = goal > 0 ? Math.min(100, (value / goal) * 100) : 0;
    const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#facc15' : '#ef4444';
    return { pct, color, label: pct > 0 ? `${pct.toFixed(0)}%` : '' };
  }

  const revBar = bar(revenue, revenuePartial > 0 ? revenuePartial : revenueGoal);
  const salesBar = bar(sales, salesPartial > 0 ? salesPartial : salesGoal);

  const cols: Array<{
    title: string;
    items: Array<{ label: string; val: string }>;
    bar?: { pct: number; color: string; label: string };
  }> = [
    {
      title: 'Faturamento CRM',
      items: [
        { label: 'Objetivo', val: revenueGoal > 0 ? fmtCur(revenueGoal) : '—' },
        { label: 'Res. Parcial', val: revenuePartial > 0 ? fmtCur(revenuePartial) : '—' },
        { label: 'Resultado', val: revenue > 0 ? fmtCur(revenue) : '—' },
      ],
      bar: revBar,
    },
    {
      title: 'Fechamentos',
      items: [
        { label: 'Objetivo', val: salesGoal > 0 ? fmtNum(salesGoal) : '—' },
        { label: 'Res. Parcial', val: salesPartial > 0 ? fmtNum(salesPartial) : '—' },
        { label: 'Resultado', val: fmtNum(sales) },
      ],
      bar: salesBar,
    },
    {
      title: 'Ticket Médio',
      items: [
        { label: 'Resultado', val: ticket > 0 ? fmtCur(ticket) : '—' },
      ],
    },
  ];

  return (
    <div className="relative h-full overflow-hidden rounded-xl border bg-[#06100D] p-5" style={{ borderColor: `${accent}80`, boxShadow: `0 0 42px ${accent}22, inset 0 0 36px ${accent}0a` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}18, transparent 46%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <div className="relative mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/15" style={{ background: `${accent}35`, color: accent, boxShadow: `0 0 18px ${accent}88` }}>
          <TrendingUp className="h-3.5 w-3.5" />
        </span>
        <p className="text-sm font-bold uppercase tracking-widest text-foreground">Resultado CRM</p>
      </div>
      <div className="relative grid gap-4 sm:grid-cols-3">
        {cols.map(col => (
          <div key={col.title} className="rounded-lg border border-white/10 bg-black/30 p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-foreground/60">{col.title}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {col.items.map(item => (
                <div key={item.label}>
                  <p className="text-sm font-semibold text-foreground leading-tight">{item.val}</p>
                  <p className="mt-1 text-[10px] text-foreground/55">{item.label}</p>
                </div>
              ))}
            </div>
            {col.bar && col.bar.pct > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${col.bar.pct}%`, backgroundColor: col.bar.color, boxShadow: `0 0 8px ${col.bar.color}88` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactInfoCard({
  title,
  value,
  icon: Icon,
  color,
  helper,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  helper?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-4">
      {/* Accent bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: color }} />
      {/* Corner square */}
      <div className="pointer-events-none absolute top-0 left-0 h-3 w-3" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between gap-3 mt-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
          <p className="mt-2 font-heading text-xl leading-none text-foreground">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</p>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border" style={{ color }}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {helper && <p className="mt-2 text-[10px] text-muted-foreground">{helper}</p>}
    </div>
  );
}

const TREND_UP   = "M0 76 C28 65 45 56 68 67 S111 79 132 61 S158 62 178 47 S204 16 229 31 S264 52 287 36 S306 26 320 16";
const TREND_DOWN = "M0 16 C28 27 45 36 68 25 S111 13 132 31 S158 30 178 45 S204 76 229 61 S264 40 287 56 S306 66 320 76";
const TREND_FLAT = "M0 46 C28 43 45 48 68 45 S111 42 132 46 S158 44 178 46 S204 44 229 46 S264 44 287 46 S306 44 320 46";

function sparkPathFromValues(values: number[], width = 320, height = 92) {
  const clean = values.filter(v => Number.isFinite(v));
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const points = clean.map((value, index) => {
    const x = clean.length === 1 ? 0 : (index / (clean.length - 1)) * width;
    const y = height - 12 - ((value - min) / range) * (height - 24);
    return { x, y };
  });
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function MiniTrendLine({ color, trend = 'up', values }: { color: string; trend?: 'up' | 'down' | 'flat'; values?: number[] }) {
  const safeId = color.replace(/[^a-zA-Z0-9]/g, '');
  const gradientId = `trend-${safeId}-${trend}`;
  const realPath = sparkPathFromValues(values ?? []);
  const path = realPath ?? (trend === 'down' ? TREND_DOWN : trend === 'flat' ? TREND_FLAT : TREND_UP);
  const closedPath = `${path} L320 92 L0 92 Z`;
  return (
    <svg viewBox="0 0 320 92" preserveAspectRatio="none" className="h-full min-h-[48px] w-full block overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <path d={closedPath} fill={`url(#${gradientId})`} />
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
      <p className="mt-4 font-heading font-normal text-2xl leading-none" style={{ color }}>
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
      <p className="font-bold text-sm text-foreground">{title}</p>
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
            <p className="mt-2 font-heading font-normal text-xl leading-none text-foreground">{formatted}</p>
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
          <h3 className="flex items-center gap-3 font-heading font-normal text-xl uppercase tracking-wide text-foreground">
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
    <section className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
      {/* Platform accent bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: accent }} />
      <div className="relative mb-5 flex items-end justify-between gap-4">
        {title && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <PlatformMarkForText text={title} />
            <span>{title}</span>
          </h2>
          {description && <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>}
        </div>
        )}
      </div>
      <div className="relative">{children}</div>
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
      'relative flex flex-col overflow-hidden rounded-xl border bg-[#070B14] p-8 shadow-[0_22px_80px_rgba(0,0,0,0.38)]',
      hasProgressPanel ? 'min-h-[320px]' : 'min-h-[260px]'
    )}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: hasProgressPanel ? progressColor : accent, boxShadow: `0 0 24px ${hasProgressPanel ? progressColor : accent}` }} />
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}22, transparent 42%), radial-gradient(circle at 85% 18%, ${accent}44, transparent 40%)` }} />
      <div className="relative flex h-full flex-col">
        <p className="flex items-center gap-2 text-sm font-bold text-foreground">
          <PlatformMarkForText text={title} />
          <span>{title}</span>
        </p>
        {description && <p className="mt-1 text-[11px] text-foreground/65">{description}</p>}
        {loading ? (
          <div className="mt-8 flex flex-1 items-center rounded-lg border border-white/15 bg-black/35 p-7">
            <div className="flex items-center gap-2 text-muted-foreground/60">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Carregando...</span>
            </div>
          </div>
        ) : hasProgressPanel ? (
          <div className="mt-8 flex flex-1 flex-col justify-center rounded-lg border border-white/15 bg-black/35 p-8">
            <div className={cn('grid gap-8 text-center', partial !== undefined ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
              {meta !== undefined && (
                <div>
                  <p className="font-heading font-normal text-[22px] leading-none text-foreground">{meta > 0 ? fmt(meta) : 'Sem meta'}</p>
                  <p className="mt-2 text-sm font-bold text-foreground/60">Meta</p>
                </div>
              )}
              {partial !== undefined && (
                <div>
                  <p className="font-heading font-normal text-[22px] leading-none text-foreground">{partial > 0 ? fmt(partial) : '—'}</p>
                  <p className="mt-2 text-sm font-bold text-foreground/60">Meta Parcial</p>
                </div>
              )}
              <div>
                <p className="font-heading font-normal text-[22px] leading-none text-foreground">{fmt(value)}</p>
                <p className="mt-2 text-sm font-bold text-foreground/60">Realizado</p>
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
                    <span className="rounded-[var(--radius)] bg-black/70 px-2 py-0.5 text-xs font-bold text-white">{progressLabel}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-8 flex flex-1 items-center rounded-lg border border-white/15 bg-black/35 p-7">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
              <p className="mt-3 font-heading font-normal text-[22px] leading-none" style={{ color: accent }}>
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
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
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  function handleToggleOpen() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({ position: 'fixed', top: rect.bottom + 6, left: rect.left, zIndex: 9999 });
    }
    setOpen(v => !v);
  }

  function toggle(id: string) {
    if (showingAllClients) {
      onChange(new Set([id]));
      return;
    }
    const next = new Set(selected);
    if (next.has(id)) { next.delete(id); } else { next.add(id); }
    onChange(next);
  }

  function toggleAll() {
    onChange(new Set(clients.map(c => c.id)));
  }

  const label = selected.size === 0
    ? 'Selecionar cliente...'
    : showingAllClients
    ? 'Todos os clientes'
    : selected.size === 1
    ? clients.find(c => selected.has(c.id))?.name ?? '1 cliente'
    : `${selected.size} clientes`;

  const dropdown = (
    <div ref={dropdownRef} style={dropdownStyle} className="w-64 rounded-xl border border-border bg-card shadow-xl p-1">
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
            <ClientAvatar clientId={c.id} name={c.name} size="sm" />
            <span className="truncate">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={handleToggleOpen}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted/50 transition-colors"
      >
        {selected.size === 1 && (() => { const c = clients.find(cl => selected.has(cl.id)); return c ? <ClientAvatar clientId={c.id} name={c.name} size="sm" /> : null; })()}
        {label}
        <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && createPortal(dropdown, document.body)}
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
  const [videoFailed, setVideoFailed] = useState(false);

  // Reset video failed state whenever a different creative is opened
  const prevAdId = useRef<string | null>(null);
  if (creative && prevAdId.current !== creative.adId) {
    prevAdId.current = creative.adId;
    setVideoFailed(false);
  }

  if (!creative) return null;
  const imgUrl = creative.imageUrl ?? creative.thumbnailUrl;
  const showVideo = !!creative.videoUrl && !videoFailed;
  const isVideo = creative.mediaType === 'video';

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 p-4 backdrop-blur-sm" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white hover:bg-white/20"
      >
        Fechar
      </button>
      <div className="mx-auto grid h-full max-w-7xl items-center justify-center gap-6 px-4 py-8 lg:grid-cols-[minmax(360px,560px)_360px]">
        <div
          className="flex h-[min(78vh,760px)] w-[min(82vw,560px)] items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_0_60px_rgba(11,132,255,0.18)]"
          onClick={(event) => event.stopPropagation()}
        >
          {showVideo ? (
            <video
              src={creative.videoUrl}
              poster={imgUrl}
              controls
              autoPlay
              className="h-full w-full bg-black object-contain"
              onError={() => setVideoFailed(true)}
            />
          ) : imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt={creative.adName}
              className="h-full w-full bg-black object-cover"
              style={{ imageRendering: 'auto' }}
              loading="eager"
            />
          ) : creative.permalink ? (
            /* Video creative with no thumbnail — offer link to original */
            <a
              href={creative.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center justify-center gap-3 text-white/60 hover:text-white/90 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <Play className="h-12 w-12 fill-current opacity-40" />
              <span className="text-sm font-semibold">Ver publicação original</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <ImageIcon className="h-10 w-10 text-white/30" />
            </div>
          )}

          {/* When video source failed but there is a permalink — show an overlay link */}
          {isVideo && videoFailed && creative.permalink && (
            <div className="absolute inset-x-0 bottom-0 flex justify-center pb-4">
              <a
                href={creative.permalink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-white/20 bg-black/70 px-4 py-2 text-xs font-semibold text-white hover:bg-black/90 transition-colors backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                Ver vídeo original
              </a>
            </div>
          )}
        </div>
        <div className="w-[min(82vw,560px)] rounded-xl border border-white/15 bg-white/10 p-4 text-white shadow-[0_0_40px_rgba(255,255,255,0.08)] backdrop-blur-md lg:w-full" onClick={(event) => event.stopPropagation()}>
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
          {creative.permalink && (
            <a
              href={creative.permalink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              Ver publicação original
            </a>
          )}
          <p className="mt-3 text-xs text-white/40">{creative.accountName}</p>
        </div>
      </div>
    </div>
  );
}

function CampaignStatusDot({ status }: { status: string }) {
  const isActive = status === 'ACTIVE' || status === 'ENABLED';
  const isPaused = status === 'PAUSED';
  return (
    <span className={cn(
      'inline-block h-2 w-2 rounded-full shrink-0',
      isActive ? 'bg-emerald-400' : isPaused ? 'bg-yellow-400' : 'bg-muted-foreground/40',
    )} title={isActive ? 'Ativa' : isPaused ? 'Pausada' : status} />
  );
}

// ─── Campaign Optimize Drawer ─────────────────────────────────────────────────

function CampaignOptimizeDrawer({ campaign, onClose }: { campaign: CampaignPerformance; onClose: () => void }) {
  const [tab, setTab] = useState<'publico' | 'copy'>('publico');

  // Audience state
  const [adsets, setAdsets] = useState<AdSet[]>([]);
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  const [savingAdset, setSavingAdset] = useState<string | null>(null);
  const [adsetMsg, setAdsetMsg] = useState<Record<string, string>>({});
  const [editedTargeting, setEditedTargeting] = useState<Record<string, AdSet>>({});

  // Copy state
  const [ads, setAds] = useState<MetaAd[]>([]);
  const [adsLoading, setAdsLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  const [variations, setVariations] = useState<CopyVariation[]>([]);
  const [copyError, setCopyError] = useState('');
  const [creatingAd, setCreatingAd] = useState<string | null>(null);
  const [createMsg, setCreateMsg] = useState('');

  useEffect(() => {
    if (campaign.platform !== 'meta') return;
    setAdsetsLoading(true);
    fetch(`/api/meta/campaigns/${campaign.id}/adsets?connectionId=${campaign.connectionId}`)
      .then(r => r.json() as Promise<AdSet[]>)
      .then(data => { setAdsets(data); setEditedTargeting(Object.fromEntries(data.map(s => [s.id, { ...s }]))); })
      .finally(() => setAdsetsLoading(false));
  }, [campaign.id, campaign.connectionId, campaign.platform]);

  useEffect(() => {
    if (tab !== 'copy' || campaign.platform !== 'meta') return;
    if (ads.length > 0) return;
    setAdsLoading(true);
    fetch(`/api/meta/campaigns/${campaign.id}/ads?connectionId=${campaign.connectionId}`)
      .then(r => r.json() as Promise<MetaAd[]>)
      .then(setAds)
      .finally(() => setAdsLoading(false));
  }, [tab, campaign.id, campaign.connectionId, campaign.platform, ads.length]);

  async function saveTargeting(adset: AdSet) {
    const edited = editedTargeting[adset.id];
    if (!edited) return;
    setSavingAdset(adset.id);
    setAdsetMsg(p => ({ ...p, [adset.id]: '' }));
    const res = await fetch(`/api/meta/adsets/${adset.id}/targeting`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: campaign.connectionId, targeting: edited.targeting, daily_budget: edited.daily_budget }),
    });
    const data = await res.json() as { ok?: boolean; error?: string };
    setAdsetMsg(p => ({ ...p, [adset.id]: res.ok ? '✓ Salvo' : (data.error ?? 'Erro') }));
    setSavingAdset(null);
  }

  function patchTargeting(adsetId: string, patch: Partial<AdSet['targeting']>) {
    setEditedTargeting(p => ({
      ...p,
      [adsetId]: { ...p[adsetId], targeting: { ...p[adsetId].targeting, ...patch } },
    }));
  }

  async function generateCopy() {
    setCopyLoading(true);
    setCopyError('');
    setVariations([]);
    const res = await fetch('/api/ai/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName: campaign.name,
        platform: campaign.platform,
        currentAds: ads.map(a => ({ name: a.name, body: a.body ?? '', title: a.title ?? '' })),
        metrics: { spend: campaign.spend, leads: campaign.leads, ctr: campaign.ctr, cpl: campaign.cpl },
      }),
    });
    const data = await res.json() as CopyVariation[] | { error: string };
    if (!res.ok) { setCopyError((data as { error: string }).error); }
    else setVariations(data as CopyVariation[]);
    setCopyLoading(false);
  }

  async function useVariation(v: CopyVariation, sourceAd: MetaAd, pauseOld: boolean) {
    if (!sourceAd.creativeId) { setCreateMsg('Anúncio sem criativo identificado.'); return; }
    const firstAdset = adsets[0];
    if (!firstAdset) { setCreateMsg('Nenhum conjunto de anúncios encontrado.'); return; }
    setCreatingAd(v.body);
    setCreateMsg('');
    const res = await fetch(`/api/meta/campaigns/${campaign.id}/create-ad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connectionId: campaign.connectionId,
        accountId: campaign.accountId,
        adsetId: firstAdset.id,
        sourceCreativeId: sourceAd.creativeId,
        newBody: v.body,
        newTitle: v.title,
        pauseSourceAdId: pauseOld ? sourceAd.id : undefined,
      }),
    });
    const data = await res.json() as { ok?: boolean; newAdId?: string; error?: string };
    setCreateMsg(res.ok ? `✓ Anúncio criado (ID: ${data.newAdId})` : (data.error ?? 'Erro ao criar anúncio.'));
    setCreatingAd(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative ml-auto h-full w-full max-w-[520px] bg-background border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {campaign.platform === 'meta' ? <MetaMark /> : <GoogleMark />}
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Otimizar campanha</p>
            </div>
            <p className="mt-1 text-sm font-bold truncate">{campaign.name}</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {campaign.platform === 'google' && (
          <div className="px-5 py-8 text-sm text-muted-foreground text-center">
            Edição de público e copy disponível apenas para Meta Ads no momento.
          </div>
        )}

        {campaign.platform === 'meta' && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-border shrink-0">
              {([['publico', Users, 'Público'], ['copy', Copy, 'Copy IA']] as const).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors',
                    tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">

              {/* ── Público tab ── */}
              {tab === 'publico' && (
                <>
                  {adsetsLoading && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <RefreshCw className="h-4 w-4 animate-spin" /> Carregando conjuntos...
                    </div>
                  )}
                  {!adsetsLoading && adsets.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nenhum conjunto de anúncios encontrado.</p>
                  )}
                  {adsets.map((adset) => {
                    const edited = editedTargeting[adset.id] ?? adset;
                    const t = edited.targeting;
                    const countries = t.geo_locations?.countries ?? [];
                    const interests = (t.flexible_spec ?? []).flatMap(s => s.interests ?? []);
                    return (
                      <div key={adset.id} className="rounded-xl border border-border bg-card p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold">{adset.name}</p>
                            <CampaignStatusDot status={adset.status} />
                          </div>
                          {adset.daily_budget != null && (
                            <span className="text-xs text-muted-foreground">Verba: {formatCurrencyBRL(edited.daily_budget ?? adset.daily_budget ?? 0)}/dia</span>
                          )}
                        </div>

                        {/* Budget */}
                        {adset.daily_budget != null && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Orçamento diário (R$)</label>
                            <input
                              type="number"
                              min={1}
                              value={edited.daily_budget ?? adset.daily_budget ?? ''}
                              onChange={e => setEditedTargeting(p => ({ ...p, [adset.id]: { ...p[adset.id], daily_budget: Number(e.target.value) } }))}
                              className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        )}

                        {/* Age */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Faixa etária</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number" min={13} max={65}
                              value={t.age_min ?? 18}
                              onChange={e => patchTargeting(adset.id, { age_min: Number(e.target.value) })}
                              className="w-20 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                            />
                            <span className="text-xs text-muted-foreground">até</span>
                            <input
                              type="number" min={13} max={65}
                              value={t.age_max ?? 65}
                              onChange={e => patchTargeting(adset.id, { age_max: Number(e.target.value) })}
                              className="w-20 h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
                            />
                            <span className="text-[10px] text-muted-foreground">anos</span>
                          </div>
                        </div>

                        {/* Gender */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Gênero</label>
                          <div className="flex gap-2">
                            {[{ label: 'Todos', val: [] }, { label: 'Masculino', val: [1] }, { label: 'Feminino', val: [2] }].map(opt => {
                              const active = JSON.stringify(t.genders ?? []) === JSON.stringify(opt.val);
                              return (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => patchTargeting(adset.id, { genders: opt.val })}
                                  className={cn(
                                    'px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
                                    active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted/50',
                                  )}
                                >{opt.label}</button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Countries */}
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Países</label>
                          <div className="flex flex-wrap gap-1.5">
                            {countries.map(c => (
                              <span key={c} className="flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-0.5 text-xs font-semibold">
                                {c}
                                <button type="button" onClick={() => patchTargeting(adset.id, { geo_locations: { ...t.geo_locations, countries: countries.filter(x => x !== c) } })}>
                                  <X className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            ))}
                            <input
                              placeholder="+ código (ex: BR)"
                              className="h-6 w-24 rounded-full border border-dashed border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                                  if (val && !countries.includes(val)) {
                                    patchTargeting(adset.id, { geo_locations: { ...t.geo_locations, countries: [...countries, val] } });
                                  }
                                  (e.target as HTMLInputElement).value = '';
                                }
                              }}
                            />
                          </div>
                        </div>

                        {/* Interests (read-only) */}
                        {interests.length > 0 && (
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Interesses (somente leitura)</label>
                            <div className="flex flex-wrap gap-1.5">
                              {interests.map(i => (
                                <span key={i.id} className="rounded-full bg-muted/30 px-2.5 py-0.5 text-xs text-muted-foreground">{i.name}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={savingAdset === adset.id}
                            onClick={() => saveTargeting(adset)}
                            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-primary/90 disabled:opacity-50"
                          >
                            {savingAdset === adset.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            Salvar alterações
                          </button>
                          {adsetMsg[adset.id] && (
                            <span className={cn('text-xs font-semibold', adsetMsg[adset.id].startsWith('✓') ? 'text-emerald-400' : 'text-red-400')}>
                              {adsetMsg[adset.id]}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* ── Copy IA tab ── */}
              {tab === 'copy' && (
                <div className="space-y-5">
                  {/* Current ads */}
                  {adsLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="h-4 w-4 animate-spin" /> Carregando anúncios...</div>}
                  {!adsLoading && ads.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Anúncios atuais</p>
                      {ads.slice(0, 3).map(ad => (
                        <div key={ad.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
                          <div className="flex items-center gap-2">
                            <CampaignStatusDot status={ad.status} />
                            <p className="text-xs font-semibold truncate">{ad.name}</p>
                          </div>
                          {ad.title && <p className="text-xs font-bold text-foreground">{ad.title}</p>}
                          {ad.body && <p className="text-xs text-muted-foreground line-clamp-2">{ad.body}</p>}
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={generateCopy}
                    disabled={copyLoading}
                    className="flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-violet-400 hover:bg-violet-500/20 disabled:opacity-50 w-full justify-center"
                  >
                    {copyLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {copyLoading ? 'Gerando variações...' : 'Gerar variações com IA'}
                  </button>
                  {copyError && <p className="text-xs text-red-400">{copyError}</p>}

                  {/* Variations */}
                  {variations.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Variações geradas — escolha uma para criar</p>
                      {variations.map((v, idx) => (
                        <div key={idx} className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-2">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-violet-400">Variação {idx + 1}</p>
                          {v.title && <p className="text-sm font-bold">{v.title}</p>}
                          <p className="text-sm text-foreground leading-relaxed">{v.body}</p>
                          <p className="text-[11px] text-muted-foreground italic">{v.rationale}</p>
                          {ads.length > 0 && (
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                disabled={creatingAd === v.body}
                                onClick={() => useVariation(v, ads[0], false)}
                                className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                {creatingAd === v.body ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                                Criar anúncio
                              </button>
                              <button
                                type="button"
                                disabled={creatingAd === v.body}
                                onClick={() => useVariation(v, ads[0], true)}
                                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[10px] font-bold uppercase text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                              >
                                Criar + pausar original
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {createMsg && (
                        <p className={cn('text-xs font-semibold', createMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400')}>
                          {createMsg}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Campaign Performance Table ───────────────────────────────────────────────

type ChildState = { loading: boolean; data: unknown[] };

type RowKind = 'campaign' | 'adset' | 'meta-ad' | 'adgroup' | 'google-ad';

type ExpandableRow =
  | { kind: 'campaign'; key: string; fetchUrl: string; data: CampaignPerformance; level: 0 }
  | { kind: 'adset'; key: string; fetchUrl: string; data: AdSetWithMetrics; campaign: CampaignPerformance; level: 1 }
  | { kind: 'meta-ad'; key: string; data: MetaAdWithMetrics; adset: AdSetWithMetrics; campaign: CampaignPerformance; level: 2 }
  | { kind: 'adgroup'; key: string; fetchUrl: string; data: GoogleAdGroup; campaign: CampaignPerformance; level: 1 }
  | { kind: 'google-ad'; key: string; data: GoogleAd; adgroup: GoogleAdGroup; campaign: CampaignPerformance; level: 2 }
  | { kind: 'loading'; key: string; level: 1 | 2 };

function canExpand(r: ExpandableRow): r is Extract<ExpandableRow, { fetchUrl: string }> {
  return 'fetchUrl' in r;
}

const INDENT = ['pl-2', 'pl-8', 'pl-14'] as const;

function PauseActivateBtn({
  status, busy, onClick,
}: { status: string; busy: boolean; onClick: () => void }) {
  const isActive = status === 'ACTIVE' || status === 'ENABLED';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      title={isActive ? 'Pausar' : 'Ativar'}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors',
        busy && 'opacity-50 cursor-wait',
        isActive ? 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                 : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
      )}
    >
      {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : isActive ? <Pause className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
    </button>
  );
}

const MATCH_COLORS: Record<string, string> = {
  'Exata': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'Frase': 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  'Ampla': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

function TopKeywordsTable({ keywords, loading }: { keywords: GoogleKeyword[]; loading: boolean }) {
  const [sortKey, setSortKey] = useState<'impressions' | 'clicks' | 'spend' | 'conversions' | 'ctr' | 'cpl'>('impressions');
  const sorted = [...keywords].sort((a, b) => {
    if (sortKey === 'cpl') return (a.cpl || Infinity) - (b.cpl || Infinity);
    return (b[sortKey] ?? 0) - (a[sortKey] ?? 0);
  });

  const cols: { key: typeof sortKey; label: string }[] = [
    { key: 'impressions', label: 'Impressões' },
    { key: 'clicks', label: 'Cliques' },
    { key: 'ctr', label: 'CTR' },
    { key: 'spend', label: 'Investido' },
    { key: 'conversions', label: 'Conv.' },
    { key: 'cpl', label: 'CPL' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-[#EA4335]/40 bg-black/35 shadow-[0_0_30px_rgba(234,67,53,0.18)] h-full flex flex-col">
      <div className="shrink-0 flex items-center justify-between border-b border-[#EA4335]/25 bg-[#EA4335]/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <GoogleMark />
          <p className="text-sm font-bold uppercase tracking-wider">Top Palavras-chave</p>
        </div>
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando palavras-chave...
        </div>
      ) : sorted.length === 0 ? (
        <p className="p-6 text-sm text-muted-foreground">Nenhuma palavra-chave encontrada no período.</p>
      ) : (
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full min-w-[780px] text-left">
            <thead className="border-b border-[#EA4335]/25 bg-black/35 sticky top-0 z-10">
              <tr className="text-[10px] font-bold uppercase tracking-widest text-foreground/60">
                <th className="px-4 py-2.5">Palavra-chave</th>
                {cols.map(c => (
                  <th key={c.key} className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => setSortKey(c.key)}
                      className={cn('hover:text-foreground transition-colors', sortKey === c.key && 'text-primary')}
                    >
                      {c.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((kw, i) => (
                <tr key={i} className="border-t border-white/10 transition-colors hover:bg-[#EA4335]/10">
                  <td className="px-4 py-2.5 max-w-[320px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', MATCH_COLORS[kw.matchType] ?? 'bg-muted/30 text-muted-foreground border-border')}>
                        {kw.matchType}
                      </span>
                      <span className="truncate text-xs font-semibold">{kw.text}</span>
                    </div>
                    <p className="mt-0.5 truncate pl-[42px] text-[10px] text-foreground/45">{kw.adGroupName}</p>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold">{kw.impressions.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold">{kw.clicks.toLocaleString('pt-BR')}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold">{kw.ctr.toFixed(2)}%</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold text-primary">{formatCurrencyBRL(kw.spend)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold">{kw.conversions > 0 ? kw.conversions.toLocaleString('pt-BR') : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-semibold">{kw.cpl > 0 ? formatCurrencyBRL(kw.cpl) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdCreativePreview({ ad, x, y }: { ad: MetaAdWithMetrics; x: number; y: number }) {
  const CARD_W = 240;
  const CARD_H = 340;
  const GAP = 14;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
  const left = x + GAP + CARD_W > vw ? x - CARD_W - GAP : x + GAP;
  const top = Math.min(Math.max(y - 40, 8), vh - CARD_H - 8);
  const hasImage = !!ad.imageUrl;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9999] rounded-xl border border-border bg-card shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-150"
      style={{ left, top, width: CARD_W }}
    >
      {hasImage && (
        <div className="relative bg-muted/30 overflow-hidden" style={{ aspectRatio: '1/1' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ad.imageUrl} alt={ad.name} className="h-full w-full object-cover" />
        </div>
      )}
      <div className="p-3 space-y-2">
        {ad.title && (
          <p className="text-[11px] font-bold leading-snug line-clamp-2">{ad.title}</p>
        )}
        {ad.body && (
          <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">{ad.body}</p>
        )}
        {!ad.title && !ad.body && (
          <p className="text-[11px] font-semibold">{ad.name}</p>
        )}
        <div className="flex gap-3 pt-0.5 text-[10px] border-t border-border">
          <span className="text-muted-foreground">Investido <strong className="text-foreground">{formatCurrencyBRL(ad.spend)}</strong></span>
          {ad.leads > 0 && <span className="text-muted-foreground">CPL <strong className="text-foreground">{formatCurrencyBRL(ad.cpl)}</strong></span>}
          {ad.impressions > 0 && <span className="text-muted-foreground">CTR <strong className="text-foreground">{ad.ctr.toFixed(1)}%</strong></span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CampaignPerformanceTable({
  campaigns: initialCampaigns,
  loading,
  period,
  dateFrom,
  dateTo,
}: {
  campaigns: CampaignPerformance[];
  loading: boolean;
  period: string;
  dateFrom: string;
  dateTo: string;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<Record<string, string>>({});
  const [editingBudget, setEditingBudget] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [savingBudget, setSavingBudget] = useState<string | null>(null);
  const [optimizeCampaign, setOptimizeCampaign] = useState<CampaignPerformance | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, ChildState>>({});
  const [childStatus, setChildStatus] = useState<Record<string, string>>({});
  const [adPreview, setAdPreview] = useState<{ ad: MetaAdWithMetrics; x: number; y: number } | null>(null);
  const adPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setCampaigns(initialCampaigns); }, [initialCampaigns]);

  const periodParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [period, dateFrom, dateTo]);

  async function toggleExpand(key: string, fetchUrl: string) {
    if (expanded.has(key)) {
      setExpanded(prev => { const s = new Set(prev); s.delete(key); return s; });
      return;
    }
    setExpanded(prev => new Set([...prev, key]));
    if (childrenMap[key]) return;
    setChildrenMap(prev => ({ ...prev, [key]: { loading: true, data: [] } }));
    try {
      const res = await fetch(fetchUrl);
      const data = await res.json();
      setChildrenMap(prev => ({ ...prev, [key]: { loading: false, data: Array.isArray(data) ? data : [] } }));
    } catch {
      setChildrenMap(prev => ({ ...prev, [key]: { loading: false, data: [] } }));
    }
  }

  const rows = useMemo<ExpandableRow[]>(() => {
    const result: ExpandableRow[] = [];
    for (const campaign of campaigns) {
      const campKey = campaign.id;
      const campUrl = campaign.platform === 'meta'
        ? `/api/meta/campaigns/${campaign.id}/adsets?connectionId=${campaign.connectionId}&${periodParams}`
        : `/api/google/campaigns/${campaign.id}/adgroups?connectionId=${campaign.connectionId}&accountId=${campaign.accountId}${campaign.loginCustomerId ? `&loginCustomerId=${campaign.loginCustomerId}` : ''}&${periodParams}`;

      result.push({ kind: 'campaign', key: campKey, fetchUrl: campUrl, data: campaign, level: 0 });

      if (expanded.has(campKey)) {
        const campChildren = childrenMap[campKey];
        if (campChildren?.loading) {
          result.push({ kind: 'loading', key: `${campKey}:loading`, level: 1 });
        } else {
          for (const child of campChildren?.data ?? []) {
            if (campaign.platform === 'meta') {
              const adset = child as AdSetWithMetrics;
              const adsetKey = `${campKey}:${adset.id}`;
              const adsetUrl = `/api/meta/adsets/${adset.id}/ads?connectionId=${campaign.connectionId}&${periodParams}`;
              result.push({ kind: 'adset', key: adsetKey, fetchUrl: adsetUrl, data: adset, campaign, level: 1 });
              if (expanded.has(adsetKey)) {
                const adChildren = childrenMap[adsetKey];
                if (adChildren?.loading) {
                  result.push({ kind: 'loading', key: `${adsetKey}:loading`, level: 2 });
                } else {
                  for (const ad of (adChildren?.data ?? []) as MetaAdWithMetrics[]) {
                    result.push({ kind: 'meta-ad', key: `${adsetKey}:${ad.id}`, data: ad, adset, campaign, level: 2 });
                  }
                }
              }
            } else {
              const adgroup = child as GoogleAdGroup;
              const adgroupKey = `${campKey}:${adgroup.id}`;
              const adgroupUrl = `/api/google/adgroups/${adgroup.id}/ads?connectionId=${campaign.connectionId}&accountId=${campaign.accountId}${campaign.loginCustomerId ? `&loginCustomerId=${campaign.loginCustomerId}` : ''}&${periodParams}`;
              result.push({ kind: 'adgroup', key: adgroupKey, fetchUrl: adgroupUrl, data: adgroup, campaign, level: 1 });
              if (expanded.has(adgroupKey)) {
                const adChildren = childrenMap[adgroupKey];
                if (adChildren?.loading) {
                  result.push({ kind: 'loading', key: `${adgroupKey}:loading`, level: 2 });
                } else {
                  for (const ad of (adChildren?.data ?? []) as GoogleAd[]) {
                    result.push({ kind: 'google-ad', key: `${adgroupKey}:${ad.id}`, data: ad, adgroup, campaign, level: 2 });
                  }
                }
              }
            }
          }
        }
      }
    }
    return result;
  }, [campaigns, expanded, childrenMap, periodParams]);

  async function toggleStatus(c: CampaignPerformance) {
    const isActive = c.status === 'ACTIVE' || c.status === 'ENABLED';
    setActionLoading(p => ({ ...p, [c.id]: true }));
    setActionError(p => ({ ...p, [c.id]: '' }));
    const apiBase = c.platform === 'meta' ? '/api/meta' : '/api/google';
    const res = await fetch(`${apiBase}/campaigns/${c.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: isActive ? 'pause' : 'activate', connectionId: c.connectionId, accountId: c.accountId, loginCustomerId: c.loginCustomerId }),
    });
    const data = await res.json() as { ok?: boolean; newStatus?: string; error?: string };
    if (res.ok && data.newStatus) setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, status: data.newStatus! } : x));
    else setActionError(p => ({ ...p, [c.id]: data.error ?? 'Erro.' }));
    setActionLoading(p => ({ ...p, [c.id]: false }));
  }

  async function toggleChildStatus(
    rowKey: string,
    currentStatus: string,
    apiUrl: string,
    body: Record<string, unknown>,
  ) {
    const isActive = currentStatus === 'ACTIVE' || currentStatus === 'ENABLED';
    setActionLoading(p => ({ ...p, [rowKey]: true }));
    setActionError(p => ({ ...p, [rowKey]: '' }));
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, action: isActive ? 'pause' : 'activate' }),
    });
    const data = await res.json() as { ok?: boolean; newStatus?: string; error?: string };
    if (res.ok && data.newStatus) {
      setChildStatus(p => ({ ...p, [rowKey]: data.newStatus! }));
    } else {
      setActionError(p => ({ ...p, [rowKey]: data.error ?? 'Erro.' }));
    }
    setActionLoading(p => ({ ...p, [rowKey]: false }));
  }

  async function saveBudget(c: CampaignPerformance) {
    const value = parseFloat(budgetInput);
    if (!value || value <= 0) { setEditingBudget(null); return; }
    setSavingBudget(c.id);
    const apiBase = c.platform === 'meta' ? '/api/meta' : '/api/google';
    const res = await fetch(`${apiBase}/campaigns/${c.id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_budget',
        connectionId: c.connectionId,
        accountId: c.accountId,
        loginCustomerId: c.loginCustomerId,
        budgetResourceName: c.budgetResourceName,
        dailyBudget: value,
      }),
    });
    if (res.ok) setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, dailyBudget: value } : x));
    setSavingBudget(null);
    setEditingBudget(null);
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/15 bg-black/35 p-6">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando campanhas do período...
        </div>
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-white/15 bg-black/35 px-5 py-7">
        <p className="text-sm font-semibold text-foreground">Nenhuma campanha ativa no período.</p>
        <p className="mt-1 text-xs text-muted-foreground">Quando houver investido nas contas vinculadas, as campanhas aparecem aqui com métricas e ações rápidas.</p>
      </div>
    );
  }

  function renderRow(row: ExpandableRow) {
    if (row.kind === 'loading') {
      return (
        <tr key={row.key} className="border-t border-border/50">
          <td colSpan={9} className={cn('px-4 py-2', INDENT[row.level])}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" /> Carregando...
            </div>
          </td>
        </tr>
      );
    }

    const isExpanded = 'fetchUrl' in row && expanded.has(row.key);
    const expandable = canExpand(row);

    const rowKind: RowKind = row.kind;
    const busy = actionLoading[row.key] ?? false;
    const err = actionError[row.key] ?? '';

    // Determine display status (with optimistic override for children)
    let displayStatus: string;
    let displayName: string;
    let spend = 0, impressions = 0, clicks = 0, leads = 0, ctr = 0, cpl = 0;
    let dailyBudget: number | undefined;
    let isActive: boolean;

    if (row.kind === 'campaign') {
      displayStatus = row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
      dailyBudget = row.data.dailyBudget;
    } else if (row.kind === 'adset') {
      displayStatus = childStatus[row.key] ?? row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
      dailyBudget = row.data.daily_budget;
    } else if (row.kind === 'meta-ad') {
      displayStatus = childStatus[row.key] ?? row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
    } else if (row.kind === 'adgroup') {
      displayStatus = childStatus[row.key] ?? row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
    } else {
      // google-ad
      displayStatus = childStatus[row.key] ?? row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
    }

    isActive = displayStatus === 'ACTIVE' || displayStatus === 'ENABLED';

    const levelBg = row.level === 0 ? '' : row.level === 1 ? 'bg-white/[0.04]' : 'bg-white/[0.025]';

    const isMetaAd = row.kind === 'meta-ad';

    return (
      <tr key={row.key} className={cn('border-t border-white/10 transition-colors hover:bg-white/[0.07]', !isActive && 'opacity-60', levelBg)}>
        {/* Name column — whole name area is clickable when expandable */}
        <td
          className="max-w-[300px] px-2 py-0"
          onMouseEnter={isMetaAd ? (e) => {
            if (adPreviewTimer.current) clearTimeout(adPreviewTimer.current);
            const rect = e.currentTarget.getBoundingClientRect();
            adPreviewTimer.current = setTimeout(() => {
              setAdPreview({ ad: (row as Extract<ExpandableRow, { kind: 'meta-ad' }>).data, x: rect.right, y: rect.top + rect.height / 2 });
            }, 300);
          } : undefined}
          onMouseLeave={isMetaAd ? () => {
            if (adPreviewTimer.current) clearTimeout(adPreviewTimer.current);
            setAdPreview(null);
          } : undefined}
        >
          <div
            className={cn(
              'flex min-w-0 items-center gap-1.5 py-2.5',
              INDENT[row.level],
              expandable && 'cursor-pointer select-none',
            )}
            onClick={expandable ? () => toggleExpand(row.key, (row as { fetchUrl: string }).fetchUrl) : undefined}
            role={expandable ? 'button' : undefined}
          >
            {/* Expand chevron */}
            {expandable ? (
              <span className={cn(
                'shrink-0 transition-colors',
                row.level === 0 ? 'text-foreground/70' : 'text-primary/70',
              )}>
                {isExpanded
                  ? <ChevronDown className="h-3.5 w-3.5" />
                  : <ChevronRight className="h-3.5 w-3.5" />}
              </span>
            ) : (
              <span className="h-3.5 w-3.5 shrink-0" />
            )}

            <CampaignStatusDot status={displayStatus} />
            <div className="min-w-0">
              <p className={cn('truncate font-semibold', row.level === 0 ? 'text-sm font-bold' : row.level === 1 ? 'text-xs' : 'text-[11px] text-foreground/55')}>
                {displayName}
              </p>
              {row.kind === 'campaign' && (
                <p className="truncate text-[11px] text-foreground/45">{row.data.accountName}</p>
              )}
              {row.kind === 'adset' && (row.data.targeting?.geo_locations?.countries?.length ?? 0) > 0 && (
                <p className="truncate text-[10px] text-foreground/45">{(row.data.targeting.geo_locations?.countries ?? []).join(', ')}</p>
              )}
              {err && <p className="text-[10px] text-red-400 mt-0.5 truncate">{err}</p>}
            </div>
          </div>
        </td>

        <td className="px-3 py-2.5 text-center">
          {row.kind === 'campaign' ? (
            <PlatformTableIcon platform={row.data.platform} />
          ) : (
            <span className="text-xs text-muted-foreground/30">—</span>
          )}
        </td>

        {/* Budget cell — editable for campaign level */}
        <td className="px-3 py-2.5 text-right">
          {row.kind === 'campaign' && editingBudget === row.data.id ? (
            <div className="flex items-center justify-end gap-1">
              <input
                autoFocus
                type="number"
                min={1}
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveBudget(row.data); if (e.key === 'Escape') setEditingBudget(null); }}
                className="w-20 h-7 rounded border border-primary bg-background px-2 text-xs outline-none"
              />
              <button type="button" onClick={() => saveBudget(row.data)} className="text-emerald-400 hover:text-emerald-300">
                {savingBudget === row.data.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              </button>
              <button type="button" onClick={() => setEditingBudget(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
            </div>
          ) : dailyBudget != null ? (
            <button
              type="button"
              onClick={row.kind === 'campaign' ? () => { setEditingBudget(row.data.id); setBudgetInput(String(dailyBudget ?? '')); } : undefined}
              className={cn('group flex items-center justify-end gap-1 text-xs font-semibold', row.kind === 'campaign' && 'hover:text-primary transition-colors')}
            >
              {formatCurrencyBRL(dailyBudget)}
              {row.kind === 'campaign' && <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          )}
        </td>

        {/* Metrics */}
        <td className="px-3 py-2.5 text-right text-xs font-bold text-primary">{formatCurrencyBRL(spend)}</td>
        <td className="px-3 py-2.5 text-right text-xs font-semibold">{leads > 0 ? leads.toLocaleString('pt-BR') : <span className="text-muted-foreground/40">—</span>}</td>
        <td className="px-3 py-2.5 text-right text-xs font-semibold">{cpl > 0 ? formatCurrencyBRL(cpl) : <span className="text-muted-foreground/40">—</span>}</td>
        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{impressions > 0 ? impressions.toLocaleString('pt-BR') : <span className="opacity-40">—</span>}</td>
        <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{ctr > 0 ? `${ctr.toFixed(2)}%` : <span className="opacity-40">—</span>}</td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-center gap-1">
            {/* Pause/Activate */}
            {rowKind === 'campaign' && (
              <PauseActivateBtn
                status={displayStatus}
                busy={busy}
                onClick={() => toggleStatus(row.data as CampaignPerformance)}
              />
            )}
            {rowKind === 'adset' && (
              <PauseActivateBtn
                status={displayStatus}
                busy={busy}
                onClick={() => {
                  const r = row as Extract<ExpandableRow, { kind: 'adset' }>;
                  toggleChildStatus(
                    row.key, displayStatus,
                    `/api/meta/adsets/${r.data.id}/action`,
                    { connectionId: r.campaign.connectionId },
                  );
                }}
              />
            )}
            {rowKind === 'meta-ad' && (
              <PauseActivateBtn
                status={displayStatus}
                busy={busy}
                onClick={() => {
                  const r = row as Extract<ExpandableRow, { kind: 'meta-ad' }>;
                  toggleChildStatus(
                    row.key, displayStatus,
                    `/api/meta/ads/${r.data.id}/action`,
                    { connectionId: r.campaign.connectionId },
                  );
                }}
              />
            )}
            {rowKind === 'adgroup' && (
              <PauseActivateBtn
                status={displayStatus}
                busy={busy}
                onClick={() => {
                  const r = row as Extract<ExpandableRow, { kind: 'adgroup' }>;
                  toggleChildStatus(
                    row.key, displayStatus,
                    `/api/google/adgroups/${r.data.id}/action`,
                    { connectionId: r.campaign.connectionId, accountId: r.campaign.accountId, loginCustomerId: r.campaign.loginCustomerId },
                  );
                }}
              />
            )}
            {rowKind === 'google-ad' && (
              <PauseActivateBtn
                status={displayStatus}
                busy={busy}
                onClick={() => {
                  const r = row as Extract<ExpandableRow, { kind: 'google-ad' }>;
                  toggleChildStatus(
                    row.key, displayStatus,
                    `/api/google/ads/${r.data.id}/action`,
                    { connectionId: r.campaign.connectionId, accountId: r.campaign.accountId, loginCustomerId: r.campaign.loginCustomerId, adGroupId: r.data.adGroupId },
                  );
                }}
              />
            )}

            {/* Campaign-level optimize button */}
            {rowKind === 'campaign' && (
              <button
                type="button"
                onClick={() => setOptimizeCampaign(row.data as CampaignPerformance)}
                title="Otimizar público e copy"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-violet-500/60 bg-violet-500/20 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.32)] transition-colors hover:bg-violet-500/30"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      {optimizeCampaign && <CampaignOptimizeDrawer campaign={optimizeCampaign} onClose={() => setOptimizeCampaign(null)} />}
      {adPreview && <AdCreativePreview ad={adPreview.ad} x={adPreview.x} y={adPreview.y} />}
      <div className="overflow-hidden rounded-xl border border-white/15 bg-black/35 shadow-[0_0_28px_rgba(255,255,255,0.08)] h-full">
        <div className="overflow-auto h-full">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="border-b border-white/15 bg-white/[0.06] sticky top-0 z-10">
              <tr className="text-[10px] font-bold uppercase tracking-widest text-foreground/62">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3 text-center">Plataforma</th>
                <th className="px-4 py-3 text-right">Verba/dia</th>
                <th className="px-4 py-3 text-right">Investido</th>
                <th className="px-4 py-3 text-right">Resultados</th>
                <th className="px-4 py-3 text-right">CPL</th>
                <th className="px-4 py-3 text-right">Impressões</th>
                <th className="px-4 py-3 text-right">CTR</th>
                <th className="px-4 py-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AudiencePieCard({
  title,
  data,
  colors,
  variant = 'donut',
}: {
  title: string;
  data: AudienceSlice[];
  colors: string[];
  variant?: 'donut' | 'list';
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
    <div className="flex min-h-[240px] flex-col rounded-[var(--radius)] border border-border bg-card p-4">
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-foreground">{title}</h4>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{total.toLocaleString('pt-BR')} pessoas/imp.</p>
      </div>
      {variant === 'donut' && (
        <div className="mt-3 flex flex-1 min-h-0 justify-center items-center overflow-hidden">
          {slices.length > 0 ? (
          <svg viewBox="0 0 240 240" className="h-full w-auto max-w-full overflow-visible" role="img" aria-label={`Gráfico de ${title}`}>
            {slices.map((slice) => (
              <path
                key={slice.label}
                d={describeDonutSlice(120, 120, 108, 50, slice.startAngle, slice.endAngle)}
                fill={slice.color}
                stroke="rgba(0,0,0,0.35)"
                strokeWidth="1"
                className="origin-center transition-all duration-200"
                style={{
                  opacity: activeIndex === null || activeIndex === slice.index ? 1 : 0.35,
                  transform: activeIndex === slice.index ? 'scale(1.07)' : 'scale(1)',
                  filter: `drop-shadow(0 0 ${activeIndex === slice.index ? 16 : 8}px ${slice.color}AA)`,
                }}
                onMouseEnter={() => setActiveIndex(slice.index)}
                onMouseLeave={() => setActiveIndex(null)}
              >
                <title>{`${slice.label}: ${slice.pct}%`}</title>
              </path>
            ))}
            <circle cx="120" cy="120" r="42" className="fill-card" />
            <text x="120" y="116" textAnchor="middle" className="fill-muted-foreground text-[10px] font-bold uppercase tracking-widest">Total</text>
            <text x="120" y="134" textAnchor="middle" className="fill-foreground text-[18px] font-bold">{total.toLocaleString('pt-BR')}</text>
          </svg>
          ) : (
            <div className="relative h-full w-auto max-w-full aspect-square rounded-full bg-muted/20">
              <div className="absolute inset-8 rounded-full bg-card" />
            </div>
          )}
        </div>
      )}
      <div className="mt-4 grid content-start gap-1.5 sm:grid-cols-2">
        {slices.length > 0 ? slices.slice(0, 7).map((item) => (
          <button
            key={item.label}
            type="button"
            onMouseEnter={() => setActiveIndex(item.index)}
            onMouseLeave={() => setActiveIndex(null)}
            className={cn(
              'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors',
              activeIndex === item.index ? 'bg-white/[0.12] text-foreground' : 'text-foreground/60 hover:bg-white/[0.08] hover:text-foreground'
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color, boxShadow: `0 0 12px ${item.color}` }} />
              <span className="min-w-0 truncate">{item.label}</span>
            </span>
            <span className="font-bold text-foreground">{item.pct}%</span>
          </button>
        )) : (
          <p className="col-span-full text-[11px] text-muted-foreground">Sem dados no período.</p>
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
  keys,
  chartVariant = 'donut',
  extraKeys,
}: {
  title: string;
  description: string;
  color: string;
  colors: string[];
  data: AudienceBreakdowns;
  keys?: AudienceKey[];
  chartVariant?: 'donut' | 'list';
  extraKeys?: AudienceKey[];
}) {
  const baseKeys: AudienceKey[] = keys ?? ['age', 'gender', 'platform', 'device'];
  const allKeys = extraKeys ? [...baseKeys, ...extraKeys] : baseKeys;
  const colClass = allKeys.length === 2
    ? 'md:grid-cols-2'
    : allKeys.length > 4
    ? 'md:grid-cols-2 xl:grid-cols-3'
    : 'md:grid-cols-2 xl:grid-cols-4';
  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card p-4">
      {/* Platform accent bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: color }} />
      <div className="relative flex items-start gap-2 mt-1">
        <span className="mt-0.5">{title === 'Meta Ads' ? <MetaMark /> : <GoogleMark />}</span>
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11px] text-foreground/55">{description}</p>
        </div>
      </div>
      <div className={`relative mt-4 grid flex-1 gap-3 ${colClass}`}>
        {allKeys.map((key) => (
          <AudiencePieCard key={key} title={AUDIENCE_TITLES[key]} data={data[key]} colors={colors} variant={chartVariant} />
        ))}
      </div>
    </div>
  );
}

// ── Dashboard Customization ─────────────────────────────────────────────────
type DashboardWidgetSize = 'sm' | 'md' | 'lg';
type DashboardCardChart = 'sparkline' | 'none';
type AudienceChartVariant = 'donut' | 'list';
type DashboardCardId =
  | 'general-revenue' | 'general-leads' | 'general-roi' | 'general-cpl' | 'general-spend' | 'general-ctr' | 'general-funnel' | 'general-crm'
  | 'meta-reach' | 'meta-impressions' | 'meta-leads' | 'meta-cpl' | 'meta-spend' | 'meta-ctr' | 'meta-total-spend' | 'meta-balance' | 'meta-active-campaigns' | 'meta-adsets' | 'meta-creatives' | 'meta-clicks' | 'meta-campaigns' | 'meta-audience' | 'meta-creative-preview'
  | 'google-impressions' | 'google-conversions' | 'google-cpa' | 'google-spend' | 'google-ctr' | 'google-total-spend' | 'google-balance' | 'google-active-campaigns' | 'google-keyword-count' | 'google-clicks' | 'google-cpc' | 'google-campaigns' | 'google-keywords' | 'google-audience'
  | 'social-fb-fans' | 'social-fb-fan-adds' | 'social-fb-reach' | 'social-fb-impressions' | 'social-fb-engagements' | 'social-fb-views'
  | 'social-ig-followers' | 'social-ig-reach' | 'social-ig-views' | 'social-ig-profile-views' | 'social-ig-website-clicks'
  | 'social-ig-engaged' | 'social-ig-interactions' | 'social-ig-likes' | 'social-ig-saves'
  | 'social-ig-top-posts'
  | 'crm-total' | 'crm-ativos' | 'crm-ganhos' | 'crm-perdidos' | 'crm-funnel';

type DashboardCardConfig = {
  visible: boolean;
  size: DashboardWidgetSize;
  height?: number;
  order: number;
  chart: DashboardCardChart;
};

type DashboardPrefs = {
  cards: Record<DashboardCardId, DashboardCardConfig>;
  metaAudienceChart: AudienceChartVariant;
  googleAudienceChart: AudienceChartVariant;
  showCrmPanel: boolean;
  sectionOrder: string[];
};

const DEFAULT_SECTION_ORDER = ['geral', 'meta', 'google', 'social', 'crm'];

const CARD_LABELS: Record<DashboardCardId, string> = {
  'general-revenue': 'Faturamento / Resultado',
  'general-leads': 'Leads total / parcial / meta',
  'general-roi': 'ROI',
  'general-cpl': 'CPL geral',
  'general-spend': 'Valor investido',
  'general-ctr': 'CTR geral',
  'general-funnel': 'Funil de vendas',
  'general-crm': 'Resultado CRM',
  'meta-reach': 'Meta: Alcance',
  'meta-impressions': 'Meta: Impressões',
  'meta-leads': 'Meta: Leads',
  'meta-cpl': 'Meta: CPL',
  'meta-spend': 'Meta: Valor investido',
  'meta-ctr': 'Meta: CTR',
  'meta-total-spend': 'Meta: Total investido',
  'meta-balance': 'Meta: Saldo da conta',
  'meta-active-campaigns': 'Meta: Campanhas ativas',
  'meta-adsets': 'Meta: Conjuntos',
  'meta-creatives': 'Meta: Criativos',
  'meta-clicks': 'Meta: Cliques',
  'meta-campaigns': 'Meta: Tabela de campanhas',
  'meta-audience': 'Meta: Audiências e recortes',
  'meta-creative-preview': 'Meta: Preview de criativos',
  'google-impressions': 'Google: Impressões',
  'google-conversions': 'Google: Conversões',
  'google-cpa': 'Google: Custo por conversão',
  'google-spend': 'Google: Valor investido',
  'google-ctr': 'Google: CTR',
  'google-total-spend': 'Google: Total investido',
  'google-balance': 'Google: Saldo da conta',
  'google-active-campaigns': 'Google: Campanhas ativas',
  'google-keyword-count': 'Google: Contador top palavras-chave',
  'google-clicks': 'Google: Cliques',
  'google-cpc': 'Google: Custo por Clique (CPC)',
  'google-campaigns': 'Google: Tabela de campanhas',
  'google-keywords': 'Google: Top palavras-chave',
  'google-audience': 'Google: Recortes por gênero/dispositivo',
  'social-fb-fans': 'FB: Curtidas/Seguidores',
  'social-fb-fan-adds': 'FB: Novas curtidas',
  'social-fb-reach': 'FB: Alcance',
  'social-fb-impressions': 'FB: Impressões',
  'social-fb-engagements': 'FB: Engajamentos',
  'social-fb-views': 'FB: Visitas à página',
  'social-ig-followers': 'IG: Seguidores',
  'social-ig-reach': 'IG: Alcance',
  'social-ig-views': 'IG: Visualizações',
  'social-ig-profile-views': 'IG: Visitas ao perfil',
  'social-ig-website-clicks': 'IG: Cliques no site',
  'social-ig-engaged': 'IG: Contas engajadas',
  'social-ig-interactions': 'IG: Interações',
  'social-ig-likes': 'IG: Curtidas',
  'social-ig-saves': 'IG: Salvamentos',
  'social-ig-top-posts': 'IG: Top Postagens',
  'crm-total':    'CRM: Total de Leads',
  'crm-ativos':   'CRM: Leads Ativos',
  'crm-ganhos':   'CRM: Leads Ganhos',
  'crm-perdidos': 'CRM: Leads Perdidos',
  'crm-funnel':   'CRM: Funil por Status',
};

const CARD_GROUPS: Array<{ title: string; ids: DashboardCardId[] }> = [
  { title: 'Métricas Gerais', ids: ['general-revenue', 'general-leads', 'general-roi', 'general-cpl', 'general-spend', 'general-ctr', 'general-funnel', 'general-crm'] },
  { title: 'Meta Ads', ids: ['meta-reach', 'meta-impressions', 'meta-leads', 'meta-cpl', 'meta-spend', 'meta-ctr', 'meta-total-spend', 'meta-balance', 'meta-active-campaigns', 'meta-adsets', 'meta-creatives', 'meta-clicks', 'meta-campaigns', 'meta-audience', 'meta-creative-preview'] },
  { title: 'Google Ads', ids: ['google-impressions', 'google-conversions', 'google-cpa', 'google-spend', 'google-ctr', 'google-total-spend', 'google-balance', 'google-active-campaigns', 'google-keyword-count', 'google-clicks', 'google-cpc', 'google-campaigns', 'google-keywords', 'google-audience'] },
  { title: 'Páginas & Perfis Sociais', ids: ['social-fb-fans', 'social-fb-fan-adds', 'social-fb-reach', 'social-fb-impressions', 'social-fb-engagements', 'social-fb-views', 'social-ig-followers', 'social-ig-reach', 'social-ig-views', 'social-ig-profile-views', 'social-ig-website-clicks', 'social-ig-engaged', 'social-ig-interactions', 'social-ig-likes', 'social-ig-saves', 'social-ig-top-posts'] },
  { title: 'CRM Leads', ids: ['crm-total', 'crm-ativos', 'crm-ganhos', 'crm-perdidos', 'crm-funnel'] },
];

const META_KPI_IDS: DashboardCardId[] = [
  'meta-reach', 'meta-impressions', 'meta-leads', 'meta-cpl', 'meta-spend',
  'meta-ctr', 'meta-total-spend', 'meta-balance', 'meta-active-campaigns',
  'meta-adsets', 'meta-creatives', 'meta-clicks',
];
const GOOGLE_KPI_IDS: DashboardCardId[] = [
  'google-impressions', 'google-conversions', 'google-cpa', 'google-spend',
  'google-ctr', 'google-total-spend', 'google-balance',
  'google-active-campaigns', 'google-keyword-count', 'google-clicks', 'google-cpc',
];

const CHANNEL_GROUPS: Array<{ id: string; label: string; color: string; ids: DashboardCardId[] }> = [
  { id: 'geral',   label: 'Métricas Gerais',          color: '#55F52F', ids: CARD_GROUPS[0].ids },
  { id: 'meta',    label: 'Meta Ads',                  color: '#0668E1', ids: CARD_GROUPS[1].ids },
  { id: 'google',  label: 'Google Ads',                color: '#7B2CFF', ids: CARD_GROUPS[2].ids },
  { id: 'social',  label: 'Páginas & Perfis Sociais',  color: '#F59E0B', ids: CARD_GROUPS[3].ids },
  { id: 'crm',     label: 'CRM Leads',                 color: '#8B5CF6', ids: CARD_GROUPS[4].ids },
];

// ── React Grid Layout ────────────────────────────────────────────────────────
const LS_RGL_LAYOUT = 'dashboard_rgl_layout_v7';
function lsClientSuffix(ids: Set<string>): string {
  if (ids.size === 1) return `__${[...ids][0]}`;
  return '';
}
const RGL_COLS = 12;
const RGL_ROW_H = 100; // px per row unit
const RGL_MARGIN: [number, number] = [16, 16];

// Natural-height helpers — compute the grid row count that fits content with no empty space.
// chrome = card header/padding, rows capped at 15 to avoid infinite-scroll cards.
function tableAutoH(rowCount: number, minH: number): number {
  const total = 72 + (rowCount > 0 ? 34 + rowCount * 36 : 60) + 20;
  return Math.max(minH, Math.min(15, Math.ceil(total / RGL_ROW_H)));
}
function kwAutoH(rowCount: number, minH: number): number {
  const total = 74 + (rowCount > 0 ? rowCount * 50 : 60) + 20;
  return Math.max(minH, Math.min(15, Math.ceil(total / RGL_ROW_H)));
}
function creativesGridAutoH(count: number, minH: number): number {
  // 5 cols assumed (~1350px card); each row ≈ 467px (228px col × 16/9 + text + gap)
  const total = 80 + (count > 0 ? Math.ceil(count / 5) * 467 : 80) + 20;
  return Math.max(minH, Math.min(15, Math.ceil(total / RGL_ROW_H)));
}
function igPostsGridAutoH(count: number, minH: number): number {
  // 8 cols assumed; each row ≈ 236px (160px sq + info + gap)
  const total = 60 + (count > 0 ? Math.ceil(count / 8) * 236 : 60) + 20;
  return Math.max(minH, Math.min(15, Math.ceil(total / RGL_ROW_H)));
}

const DEFAULT_META_KPI_LAYOUT: RglLayout[] = [
  { i: 'meta-reach',            x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-impressions',      x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-leads',            x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-cpl',              x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-spend',            x: 0, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-ctr',              x: 3, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-total-spend',      x: 6, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-balance',          x: 9, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-active-campaigns', x: 0, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-adsets',           x: 3, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-creatives',        x: 6, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'meta-clicks',           x: 9, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
];

const DEFAULT_GOOGLE_KPI_LAYOUT: RglLayout[] = [
  { i: 'google-impressions',      x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-conversions',      x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-cpa',              x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-spend',            x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-ctr',              x: 0, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-total-spend',      x: 3, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-balance',          x: 6, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-active-campaigns', x: 9, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-keyword-count',    x: 0, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-clicks',           x: 3, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'google-cpc',              x: 6, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
];

const DEFAULT_GENERAL_LAYOUT: RglLayout[] = [
  { i: 'general-revenue', x: 0, y: 0, w: 8, h: 2, minW: 3, minH: 2 },
  { i: 'general-leads',   x: 0, y: 2, w: 8, h: 2, minW: 3, minH: 2 },
  { i: 'general-roi',     x: 0, y: 4, w: 4, h: 2, minW: 2, minH: 1 },
  { i: 'general-cpl',     x: 4, y: 4, w: 4, h: 2, minW: 2, minH: 1 },
  { i: 'general-ctr',     x: 0, y: 6, w: 4, h: 2, minW: 2, minH: 1 },
  { i: 'general-spend',   x: 4, y: 6, w: 4, h: 2, minW: 2, minH: 1 },
  { i: 'general-funnel',  x: 0, y: 8, w: 8,  h: 5,  minW: 3, minH: 4  },
  { i: 'general-crm',    x: 0, y: 13, w: 12, h: 2, minW: 4, minH: 2  },
];

const DEFAULT_SOCIAL_KPI_LAYOUT: RglLayout[] = [
  { i: 'social-fb-fans',           x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-fb-fan-adds',       x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-fb-reach',          x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-fb-impressions',    x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-fb-engagements',    x: 0, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-fb-views',          x: 3, y: 2, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-followers',     x: 0, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-reach',         x: 3, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-views',         x: 6, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-profile-views', x: 9, y: 4, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-website-clicks',x: 0, y: 6, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-engaged',       x: 3, y: 6, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-interactions',  x: 6, y: 6, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-likes',         x: 9, y: 6, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-saves',         x: 0, y: 8, w: 3, h: 2, minW: 2, minH: 2 },
  { i: 'social-ig-top-posts',    x: 0, y: 10, w: 12, h: 5, minW: 4, minH: 3 },
];

const DEFAULT_META_PANELS_LAYOUT: RglLayout[] = [
  { i: 'meta-campaigns',       x: 0, y: 0, w: 8, h: 4, minW: 4, minH: 2 },
  { i: 'meta-audience',        x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 2 },
  { i: 'meta-creative-preview',x: 0, y: 4, w: 12, h: 4, minW: 4, minH: 2 },
];

const DEFAULT_GOOGLE_PANELS_LAYOUT: RglLayout[] = [
  { i: 'google-campaigns', x: 0, y: 0, w: 8, h: 4, minW: 4, minH: 2 },
  { i: 'google-keywords',  x: 8, y: 0, w: 4, h: 4, minW: 3, minH: 2 },
  { i: 'google-audience',  x: 8, y: 4, w: 4, h: 4, minW: 3, minH: 2 },
];

const DEFAULT_CARD_OVERRIDES: Partial<Record<DashboardCardId, Partial<DashboardCardConfig>>> = {
  'general-revenue': { size: 'lg', chart: 'none' },
  'general-leads': { size: 'lg', chart: 'none' },
  'general-funnel': { size: 'lg', chart: 'none' },
  'general-crm': { size: 'lg', chart: 'none' },
  'meta-campaigns': { size: 'lg', chart: 'none' },
  'meta-audience': { size: 'lg', chart: 'none' },
  'meta-creative-preview': { size: 'lg', chart: 'none' },
  'google-campaigns': { size: 'lg', chart: 'none' },
  'google-keywords': { size: 'md', chart: 'none' },
  'google-audience': { size: 'md', chart: 'none' },
  'social-ig-top-posts': { size: 'lg', chart: 'none' },
  'crm-funnel': { size: 'lg', chart: 'none' },
  'crm-total': { chart: 'none' }, 'crm-ativos': { chart: 'none' }, 'crm-ganhos': { chart: 'none' }, 'crm-perdidos': { chart: 'none' },
  'meta-adsets': { chart: 'none' },
  'meta-creatives': { chart: 'none' },
  'meta-active-campaigns': { chart: 'none' },
  'google-active-campaigns': { chart: 'none' },
  'google-keyword-count': { chart: 'none' },
};

const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  cards: (Object.keys(CARD_LABELS) as DashboardCardId[]).reduce((acc, id) => {
    const groupIndex = CARD_GROUPS.find(group => group.ids.includes(id))?.ids.indexOf(id) ?? 0;
    acc[id] = { visible: true, size: 'sm', height: undefined, order: groupIndex, chart: 'sparkline', ...DEFAULT_CARD_OVERRIDES[id] };
    return acc;
  }, {} as Record<DashboardCardId, DashboardCardConfig>),
  metaAudienceChart: 'donut',
  googleAudienceChart: 'donut',
  showCrmPanel: false,
  sectionOrder: DEFAULT_SECTION_ORDER,
};

const LS_DASHBOARD_PREFS = 'dashboard_global_preferences_v2';

function mergeDashboardPrefs(input: unknown): DashboardPrefs {
  const raw = input as Partial<DashboardPrefs> | null;
  const cards = { ...DEFAULT_DASHBOARD_PREFS.cards };
  if (raw?.cards) {
    for (const id of Object.keys(CARD_LABELS) as DashboardCardId[]) {
      cards[id] = { ...cards[id], ...raw.cards[id], order: raw.cards[id]?.order ?? cards[id].order };
    }
  }
  return {
    cards,
    metaAudienceChart: raw?.metaAudienceChart ?? DEFAULT_DASHBOARD_PREFS.metaAudienceChart,
    googleAudienceChart: raw?.googleAudienceChart ?? DEFAULT_DASHBOARD_PREFS.googleAudienceChart,
    showCrmPanel: raw?.showCrmPanel ?? false,
    sectionOrder: (() => {
      const stored = raw?.sectionOrder ?? [];
      const all = DEFAULT_SECTION_ORDER;
      const valid = stored.filter((s): s is string => all.includes(s));
      const missing = all.filter(s => !valid.includes(s));
      return [...valid, ...missing];
    })(),
  };
}

function gridSpan(size: DashboardWidgetSize) {
  return size === 'lg' ? 'xl:col-span-4' : size === 'md' ? 'xl:col-span-2' : 'xl:col-span-1';
}

const DashboardEditCtx = createContext<{
  editMode: boolean;
  hideCard: (id: DashboardCardId) => void;
  toggleChart: (id: DashboardCardId) => void;
}>({ editMode: false, hideCard: () => {}, toggleChart: () => {} });

function DashboardGridItem({
  id,
  prefs,
  children,
  className,
  ignoreSpan = false,
}: {
  id: DashboardCardId;
  prefs: DashboardPrefs;
  children: ReactNode;
  className?: string;
  ignoreSpan?: boolean;
}) {
  const { editMode, hideCard, toggleChart } = useContext(DashboardEditCtx);
  const [hiding, setHiding] = useState(false);
  const cfg = prefs.cards[id] ?? DEFAULT_DASHBOARD_PREFS.cards[id];
  const isPanel = id.includes('campaigns') || id.includes('audience') || id.includes('preview') || id.includes('keywords') || id === 'general-funnel' || id === 'general-crm';
  if (!cfg.visible) return null;

  function handleHide() {
    setHiding(true);
    setTimeout(() => hideCard(id), 180);
  }

  return (
    <div
      className={cn(
        'min-w-0 [&>*]:h-full relative group/card transition-all duration-200',
        !ignoreSpan && gridSpan(cfg.size),
        hiding && 'opacity-0 scale-95',
        className,
      )}
      style={{ order: ignoreSpan ? undefined : cfg.order, minHeight: cfg.height ? `${cfg.height}px` : undefined }}
    >
      {children}
      {editMode && (
        <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {!isPanel && (
            <button
              type="button"
              title={cfg.chart === 'sparkline' ? 'Ocultar gráfico' : 'Mostrar gráfico'}
              onClick={() => toggleChart(id)}
              className="flex items-center justify-center w-6 h-6 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-md"
            >
              <BarChart3 className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            title="Ocultar métrica"
            onClick={handleHide}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-card border border-border text-muted-foreground hover:text-destructive transition-colors shadow-md"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

function SortableGridItem({
  id, prefs, children, className,
}: {
  id: DashboardCardId; prefs: DashboardPrefs; children: ReactNode; className?: string;
}) {
  const { editMode, hideCard, toggleChart } = useContext(DashboardEditCtx);
  const [hiding, setHiding] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const cfg = prefs.cards[id] ?? DEFAULT_DASHBOARD_PREFS.cards[id];
  const isPanel = id.includes('campaigns') || id.includes('audience') || id.includes('preview') || id.includes('keywords') || id === 'general-funnel' || id === 'general-crm';
  if (!cfg.visible) return null;

  function handleHide() {
    setHiding(true);
    setTimeout(() => hideCard(id), 180);
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, order: cfg.order, zIndex: isDragging ? 10 : undefined }}
      className={cn(
        'min-w-0 [&>*]:h-full relative group/card transition-all duration-200',
        gridSpan(cfg.size),
        hiding && 'opacity-0 scale-95',
        isDragging && 'opacity-60',
        className,
      )}
    >
      {children}
      {editMode && (
        <>
          <div className="absolute top-1.5 left-1.5 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity">
            <button
              type="button"
              {...attributes}
              {...listeners}
              className="cursor-grab active:cursor-grabbing flex items-center justify-center w-6 h-6 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground shadow-md"
            >
              <GripVertical className="w-3 h-3" />
            </button>
          </div>
          <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
            {!isPanel && (
              <button
                type="button"
                title={cfg.chart === 'sparkline' ? 'Ocultar gráfico' : 'Mostrar gráfico'}
                onClick={() => toggleChart(id)}
                className="flex items-center justify-center w-6 h-6 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors shadow-md"
              >
                <BarChart3 className="w-3 h-3" />
              </button>
            )}
            <button
              type="button"
              title="Ocultar métrica"
              onClick={handleHide}
              className="flex items-center justify-center w-6 h-6 rounded-md bg-card border border-border text-muted-foreground hover:text-destructive transition-colors shadow-md"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RglCardShell({
  id, prefs, children,
}: {
  id: DashboardCardId; prefs: DashboardPrefs; children: ReactNode;
}) {
  const { editMode, hideCard, toggleChart } = useContext(DashboardEditCtx);
  const [hiding, setHiding] = useState(false);
  const cfg = prefs.cards[id] ?? DEFAULT_DASHBOARD_PREFS.cards[id];
  const isPanel = id.includes('campaigns') || id.includes('audience') || id.includes('preview') || id.includes('keywords') || id === 'general-funnel' || id === 'general-crm';

  function handleHide() {
    setHiding(true);
    setTimeout(() => hideCard(id), 180);
  }

  return (
    <div className={cn(
      'relative h-full w-full group/card transition-all duration-200',
      hiding && 'opacity-0 scale-95',
    )}>
      <div className="h-full w-full [&>*]:h-full">{children}</div>
      <div className="drag-handle absolute top-1.5 left-1.5 z-20 opacity-0 group-hover/card:opacity-100 transition-opacity cursor-grab active:cursor-grabbing flex items-center justify-center w-6 h-6 rounded-md bg-card/90 border border-border text-muted-foreground hover:text-foreground shadow-md backdrop-blur-sm">
        <GripVertical className="w-3 h-3" />
      </div>
      <div className="absolute top-1.5 right-1.5 z-20 flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
        {!isPanel && (
          <button
            type="button"
            title={cfg.chart === 'sparkline' ? 'Ocultar gráfico' : 'Mostrar gráfico'}
            onClick={() => toggleChart(id)}
            className="flex items-center justify-center w-6 h-6 rounded-md bg-card/90 border border-border text-muted-foreground hover:text-foreground transition-colors shadow-md"
          >
            <BarChart3 className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          title="Ocultar métrica"
          onClick={handleHide}
          className="flex items-center justify-center w-6 h-6 rounded-md bg-card/90 border border-border text-muted-foreground hover:text-destructive transition-colors shadow-md"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function MetricConfigPanel({
  prefs,
  onPrefsChange,
  onClose,
}: {
  prefs: DashboardPrefs;
  onPrefsChange: (prefs: DashboardPrefs) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function updateCard(id: DashboardCardId, patch: Partial<DashboardCardConfig>) {
    onPrefsChange({ ...prefs, cards: { ...prefs.cards, [id]: { ...prefs.cards[id], ...patch } } });
  }

  function toggleChannel(ids: DashboardCardId[]) {
    const allOn = ids.every(id => prefs.cards[id]?.visible !== false);
    const cards = { ...prefs.cards };
    ids.forEach(id => { cards[id] = { ...cards[id], visible: !allOn }; });
    onPrefsChange({ ...prefs, cards });
  }

  function moveCard(groupIds: DashboardCardId[], id: DashboardCardId, dir: -1 | 1) {
    const ordered = [...groupIds].sort((a, b) =>
      (prefs.cards[a]?.order ?? groupIds.indexOf(a)) - (prefs.cards[b]?.order ?? groupIds.indexOf(b))
    );
    const cur = ordered.indexOf(id);
    const nxt = cur + dir;
    if (nxt < 0 || nxt >= ordered.length) return;
    [ordered[cur], ordered[nxt]] = [ordered[nxt], ordered[cur]];
    const cards = { ...prefs.cards };
    ordered.forEach((cid, i) => { cards[cid] = { ...cards[cid], order: i }; });
    onPrefsChange({ ...prefs, cards });
  }

  const filteredChannels = CHANNEL_GROUPS.map(ch => ({
    ...ch,
    ids: search
      ? ch.ids.filter(id => CARD_LABELS[id]?.toLowerCase().includes(search.toLowerCase()))
      : ch.ids,
  })).filter(ch => ch.ids.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm p-4 pt-16">
      <div className="flex h-full max-h-[calc(100vh-5rem)] w-full max-w-[360px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider">Configurar métricas</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Ative ou oculte por canal</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Buscar métrica..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Audience chart global settings */}
        <div className="shrink-0 grid grid-cols-2 gap-2 px-4 py-3 border-b border-border">
          <label className="space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Gráfico público Meta</span>
            <select value={prefs.metaAudienceChart} onChange={e => onPrefsChange({ ...prefs, metaAudienceChart: e.target.value as AudienceChartVariant })}
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
              <option value="donut">Donut</option>
              <option value="list">Lista</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Gráfico público Google</span>
            <select value={prefs.googleAudienceChart} onChange={e => onPrefsChange({ ...prefs, googleAudienceChart: e.target.value as AudienceChartVariant })}
              className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
              <option value="donut">Donut</option>
              <option value="list">Lista</option>
            </select>
          </label>
        </div>

        {/* Channel sections */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {filteredChannels.map(ch => {
            const allOn   = ch.ids.every(id => prefs.cards[id]?.visible !== false);
            const someOn  = ch.ids.some(id => prefs.cards[id]?.visible !== false);
            const isCollapsed = collapsed.has(ch.id);
            const visibleCount = ch.ids.filter(id => prefs.cards[id]?.visible !== false).length;
            const orderedIds = [...ch.ids].sort((a, b) =>
              (prefs.cards[a]?.order ?? ch.ids.indexOf(a)) - (prefs.cards[b]?.order ?? ch.ids.indexOf(b))
            );

            return (
              <div key={ch.id} className="overflow-hidden rounded-xl border border-border">
                {/* Channel header */}
                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none hover:bg-muted/20 transition-colors"
                  style={{ borderLeft: `3px solid ${ch.color}` }}
                >
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={el => { if (el) el.indeterminate = !allOn && someOn; }}
                    onChange={() => toggleChannel(ch.ids)}
                    onClick={e => e.stopPropagation()}
                    className="h-3.5 w-3.5 shrink-0 accent-primary"
                  />
                  <span
                    className="flex-1 text-[10px] font-bold uppercase tracking-widest"
                    style={{ color: ch.color }}
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev);
                      next.has(ch.id) ? next.delete(ch.id) : next.add(ch.id);
                      return next;
                    })}
                  >
                    {ch.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{visibleCount}/{ch.ids.length}</span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', !isCollapsed && 'rotate-180')}
                    onClick={() => setCollapsed(prev => {
                      const next = new Set(prev);
                      next.has(ch.id) ? next.delete(ch.id) : next.add(ch.id);
                      return next;
                    })}
                  />
                </div>

                {/* Metric rows */}
                {!isCollapsed && (
                  <div className="divide-y divide-border border-t border-border">
                    {orderedIds.map(id => {
                      const cfg = prefs.cards[id];
                      const isPanel = id.includes('campaigns') || id.includes('audience') || id.includes('preview') || id.includes('keywords') || id === 'general-funnel' || id === 'general-crm';
                      return (
                        <div key={id} className={cn('flex items-center gap-2 px-3 py-2 transition-colors', !cfg.visible && 'opacity-40')}>
                          <input
                            type="checkbox"
                            checked={cfg.visible}
                            onChange={e => updateCard(id, { visible: e.target.checked })}
                            className="h-3.5 w-3.5 shrink-0 accent-primary"
                          />
                          <span className="flex-1 min-w-0 text-xs leading-tight truncate">{CARD_LABELS[id]}</span>
                          {isPanel && (
                            <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground">painel</span>
                          )}
                          <select
                            value={cfg.size}
                            onChange={e => updateCard(id, { size: e.target.value as DashboardWidgetSize })}
                            className="shrink-0 rounded border border-border bg-card px-1 py-0.5 text-[10px]"
                          >
                            <option value="sm">1col</option>
                            <option value="md">2col</option>
                            <option value="lg">4col</option>
                          </select>
                          <div className="flex shrink-0 gap-0 overflow-hidden rounded border border-border">
                            <button type="button" onClick={() => moveCard(ch.ids, id, -1)}
                              className="px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <ChevronUp className="h-3 w-3" />
                            </button>
                            <button type="button" onClick={() => moveCard(ch.ids, id, 1)}
                              className="border-l border-border px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <ChevronDown className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Seções opcionais */}
        <div className="shrink-0 border-t border-border px-4 py-3 space-y-2">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground px-1">Seções extras</p>
          <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/20 cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.showCrmPanel}
              onChange={e => onPrefsChange({ ...prefs, showCrmPanel: e.target.checked })}
              className="h-3.5 w-3.5 accent-primary shrink-0"
            />
            <div>
              <p className="text-xs font-semibold">Painel de Leads CRM</p>
              <p className="text-[10px] text-muted-foreground">Cards de Ativos/Ganhos/Perdidos + funil de conversão</p>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border px-5 py-4">
          <button type="button" onClick={() => onPrefsChange(DEFAULT_DASHBOARD_PREFS)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Restaurar padrão
          </button>
          <button type="button" onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-black">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

type PerformanceFunnelRow = {
  label: string;
  value: number;
  color: string;
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
};

function funnelNumber(value: number) {
  return Math.round(value).toLocaleString('pt-BR');
}

function funnelPercent(value: number, digits = 2) {
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

function stageConversion(current: number, previous: number) {
  return previous > 0 ? (current / previous) * 100 : 0;
}

function displayStageName(label: string) {
  const lower = label.toLowerCase();
  return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
}

function DashboardPerformanceFunnel({ periodLabel, rows }: { periodLabel: string; rows: PerformanceFunnelRow[] }) {
  const stages = rows.slice(0, 5);
  const conversions = stages.map((stage, index) => (
    index === 0 ? 100 : stageConversion(stage.value, stages[index - 1].value)
  ));
  const transitionConversions = conversions.slice(1);
  const bottleneckIndex = transitionConversions.reduce((lowest, value, index) => (
    value < transitionConversions[lowest] ? index : lowest
  ), 0);
  const bottleneck = `${displayStageName(stages[bottleneckIndex]?.label ?? '')} → ${displayStageName(stages[bottleneckIndex + 1]?.label ?? '')}`;
  const generalConversion = stageConversion(stages[4]?.value ?? 0, stages[0]?.value ?? 0);

  const sectionRef = useRef<HTMLElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      // 500px = scale 1.0 (default h=5 grid rows); clamp 0.65–1.0 (never bigger than KPI cards)
      const s = Math.min(Math.max(entry.contentRect.height / 500, 0.65), 1.0);
      setScale(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const iconSz = Math.round(13 * scale);
  const badgeSz = Math.round(16 * scale);
  const connH = Math.round(22 * scale);
  const labelFs = Math.round(11 * scale);
  const valueFs = Math.round(13 * scale);
  const subFs = Math.round(10 * scale);
  const convFs = Math.round(10 * scale);
  const footerFs = Math.round(10 * scale);
  const footerValueFs = Math.round(11 * scale);

  return (
    <section ref={sectionRef} className="relative h-full flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card p-4 sm:p-5">
      {/* Accent bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />

      {/* Header */}
      <div className="relative flex-none flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Funil de Performance</h3>
            <Info className="h-3 w-3 text-muted-foreground/60" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Período: <span className="text-foreground font-semibold">{periodLabel}</span></p>
        </div>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-[var(--radius)] border border-border bg-muted px-3 text-xs font-bold text-muted-foreground"
        >
          <span className="text-muted-foreground/60">Exibir</span>
          Conversão %
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Stages — fills remaining height */}
      <div className="relative flex-1 flex flex-col mt-3 min-h-0">
        {stages.map((stage, index) => {
          const Icon = stage.Icon;
          const nextConversion = conversions[index + 1] ?? 0;
          const isLast = index === stages.length - 1;

          return (
            <Fragment key={stage.label}>
              {/* Stage row — grows proportionally */}
              <div
                className="relative flex-1 grid grid-cols-[40px_28px_1fr_auto] items-center overflow-hidden rounded-[var(--radius)] border pr-3"
                style={{ borderColor: `${stage.color}80`, minHeight: Math.round(32 * scale) }}
              >
                <div
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(90deg, ${stage.color}22 0%, ${stage.color}10 40%, transparent 100%)` }}
                />
                <div
                  className="relative flex h-full items-center justify-center border-r"
                  style={{ borderColor: `${stage.color}55` }}
                >
                  <Icon style={{ color: stage.color, width: iconSz, height: iconSz }} />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className="flex items-center justify-center rounded-full font-black text-white"
                    style={{ backgroundColor: `${stage.color}cc`, width: badgeSz, height: badgeSz, fontSize: Math.round(8 * scale) }}
                  >
                    {index + 1}
                  </span>
                </div>
                <p className="relative font-bold uppercase text-foreground" style={{ fontSize: labelFs, letterSpacing: '0.08em' }}>{stage.label}</p>
                <div className="relative text-right">
                  <p className="font-heading font-normal leading-none text-foreground" style={{ fontSize: valueFs }}>{funnelNumber(stage.value)}</p>
                  <p className="mt-0.5 font-semibold text-muted-foreground" style={{ fontSize: subFs }}>{funnelPercent(conversions[index], index === 0 ? 1 : 2)}</p>
                </div>
              </div>

              {/* Connector — fixed proportional height */}
              {!isLast && (
                <div className="relative flex-none flex justify-center" style={{ height: connH }}>
                  <div className="absolute left-1/2 top-0 h-full border-l border-dashed" style={{ borderColor: `${stage.color}88` }} />
                  <span className="absolute rounded-full" style={{ backgroundColor: stage.color, width: Math.round(7 * scale), height: Math.round(7 * scale), top: -Math.round(3 * scale) }} />
                  <div className="relative z-10 flex items-center gap-1.5 rounded-[var(--radius)] border border-border bg-card px-2 self-center">
                    <span className="font-bold text-muted-foreground" style={{ fontSize: convFs }}>Taxa de conversão</span>
                    <span className="font-bold" style={{ color: stage.color, fontSize: convFs }}>{funnelPercent(nextConversion)}</span>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {/* Footer */}
      <div className="relative flex-none mt-3 grid gap-0 overflow-hidden rounded-[var(--radius)] border border-border bg-muted/30 md:grid-cols-3">
        <div className="flex gap-2 p-2.5 md:border-r md:border-border">
          <div className="flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-border text-destructive" style={{ width: Math.round(26 * scale), height: Math.round(26 * scale) }}>
            <AlertTriangle style={{ width: Math.round(12 * scale), height: Math.round(12 * scale) }} />
          </div>
          <div>
            <p className="font-bold uppercase tracking-widest text-muted-foreground" style={{ fontSize: footerFs }}>Maior Gargalo</p>
            <p className="mt-0.5 font-bold text-foreground" style={{ fontSize: footerValueFs }}>{bottleneck}</p>
            <p className="mt-0.5 text-muted-foreground" style={{ fontSize: footerFs }}>Conversão de {funnelPercent(transitionConversions[bottleneckIndex] ?? 0)}</p>
          </div>
        </div>
        <div className="flex gap-2 p-2.5 md:border-r md:border-border">
          <div className="flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-border" style={{ color: '#55f52f', width: Math.round(26 * scale), height: Math.round(26 * scale) }}>
            <TrendingUp style={{ width: Math.round(12 * scale), height: Math.round(12 * scale) }} />
          </div>
          <div>
            <p className="font-bold uppercase tracking-widest text-muted-foreground" style={{ fontSize: footerFs }}>Conversão Geral</p>
            <p className="mt-0.5 font-heading font-normal leading-none text-foreground" style={{ fontSize: Math.round(16 * scale) }}>{funnelPercent(generalConversion)}</p>
            <p className="mt-0.5 text-muted-foreground" style={{ fontSize: footerFs }}>{funnelNumber(stages[4]?.value ?? 0)} de {funnelNumber(stages[0]?.value ?? 0)} visitantes</p>
          </div>
        </div>
        <div className="flex gap-2 p-2.5">
          <div className="flex shrink-0 items-center justify-center rounded-[var(--radius)] border border-border" style={{ color: '#55f52f', width: Math.round(26 * scale), height: Math.round(26 * scale) }}>
            <Lightbulb style={{ width: Math.round(12 * scale), height: Math.round(12 * scale) }} />
          </div>
          <div>
            <p className="font-bold uppercase tracking-widest text-muted-foreground" style={{ fontSize: footerFs }}>Oportunidade</p>
            <p className="mt-0.5 font-bold text-foreground" style={{ fontSize: footerValueFs }}>Melhore a qualificação</p>
            <p className="mt-0.5 text-muted-foreground" style={{ fontSize: footerFs }}>Ative automações e nutrições</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── CRM Dashboard Panel ──────────────────────────────────────────────────────
type CrmStats = {
  total: number;
  ativos: number;
  ganhos: number;
  perdidos: number;
  faturamento: number;
  byStatus: Array<{ status: string; count: number; valor: number; pct: number }>;
};

const STATUS_FUNNEL_ORDER = [
  'Em Atendimento', 'Agendado', 'Reagendado', 'Fechado', 'Comprou',
  'Paciente', 'Não Retorna', 'Distante', 'Sem Interesse', 'Desqualificado',
];

const STATUS_FUNNEL_COLOR: Record<string, string> = {
  'Em Atendimento': '#0ea5e9',
  'Agendado':       '#3b82f6',
  'Reagendado':     '#7dd3fc',
  'Fechado':        '#10b981',
  'Comprou':        '#34d399',
  'Paciente':       '#a1a1aa',
  'Não Retorna':    '#71717a',
  'Distante':       '#f97316',
  'Sem Interesse':  '#ef4444',
  'Desqualificado': '#dc2626',
};

function CrmDashboardPanel({ clientIds, prefs }: { clientIds: Set<string>; prefs: DashboardPrefs }) {
  const [stats, setStats] = React.useState<CrmStats | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<'count' | 'valor'>('count');
  const cardVisible = (id: DashboardCardId) => prefs.cards[id]?.visible !== false;

  React.useEffect(() => {
    if (clientIds.size === 0) return;
    setLoading(true);
    const ids = [...clientIds];

    Promise.all(ids.map(id =>
      fetch(`/api/dashboard/crm-stats?clientId=${id}`).then(r => r.json()) as Promise<CrmStats>
    )).then(results => {
      const merged: CrmStats = {
        total: 0, ativos: 0, ganhos: 0, perdidos: 0, faturamento: 0,
        byStatus: [],
      };
      const statusMap = new Map<string, { count: number; valor: number }>();

      for (const r of results) {
        if (!r || typeof r !== 'object' || !('total' in r)) continue;
        merged.total += r.total ?? 0;
        merged.ativos += r.ativos ?? 0;
        merged.ganhos += r.ganhos ?? 0;
        merged.perdidos += r.perdidos ?? 0;
        merged.faturamento += r.faturamento ?? 0;
        for (const s of r.byStatus ?? []) {
          const cur = statusMap.get(s.status) ?? { count: 0, valor: 0 };
          statusMap.set(s.status, { count: cur.count + s.count, valor: cur.valor + s.valor });
        }
      }

      merged.byStatus = [...statusMap.entries()].map(([status, d]) => ({
        status,
        count: d.count,
        valor: d.valor,
        pct: merged.total > 0 ? Math.round((d.count / merged.total) * 100) : 0,
      }));

      setStats(merged);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [[...clientIds].sort().join(',')]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Carregando dados de leads…
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Nenhum lead registrado ainda.</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Conecte o WhatsApp para capturar leads automaticamente.</p>
      </div>
    );
  }

  const sortedStatuses = STATUS_FUNNEL_ORDER
    .map(s => stats.byStatus.find(b => b.status === s) ?? { status: s, count: 0, valor: 0, pct: 0 })
    .filter(s => s.count > 0);

  const maxVal = Math.max(...sortedStatuses.map(s => sortBy === 'count' ? s.count : s.valor), 1);

  const summaryCards = [
    { id: 'crm-total' as DashboardCardId,    label: 'Total de Leads',  value: stats.total,    cls: 'text-foreground',  sub: 'no período' },
    { id: 'crm-ativos' as DashboardCardId,   label: 'Leads Ativos',    value: stats.ativos,   cls: 'text-sky-400',     sub: 'em andamento' },
    { id: 'crm-ganhos' as DashboardCardId,   label: 'Leads Ganhos',    value: stats.ganhos,   cls: 'text-emerald-400', sub: 'negócios fechados' },
    { id: 'crm-perdidos' as DashboardCardId, label: 'Leads Perdidos',  value: stats.perdidos, cls: 'text-red-400',     sub: 'sem interesse / desqualif.' },
  ].filter(c => cardVisible(c.id));

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summaryCards.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryCards.map(({ label, value, cls, sub }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className={cn('font-heading font-normal text-2xl leading-none mt-2', cls)}>{value.toLocaleString('pt-BR')}</p>
              <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Funnel chart */}
      {cardVisible('crm-funnel') && <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold">Funil de Leads por Status</p>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            <button onClick={() => setSortBy('count')}
              className={cn('px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors',
                sortBy === 'count' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              Por Qtd.
            </button>
            <button onClick={() => setSortBy('valor')}
              className={cn('px-2.5 py-1 rounded-md text-[10px] font-bold transition-colors',
                sortBy === 'valor' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
              Por Valor
            </button>
          </div>
        </div>

        <div className="space-y-2.5">
          {sortedStatuses.map(s => {
            const barVal = sortBy === 'count' ? s.count : s.valor;
            const barPct = Math.round((barVal / maxVal) * 100);
            const color = STATUS_FUNNEL_COLOR[s.status] ?? '#71717a';
            return (
              <div key={s.status} className="flex items-center gap-3">
                <span className="w-32 shrink-0 text-[11px] text-right text-muted-foreground">{s.pct}%</span>
                <div className="flex-1 h-6 bg-muted/30 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${barPct}%`, background: color, opacity: 0.85 }}
                  />
                </div>
                <div className="w-48 shrink-0">
                  <p className="text-xs font-semibold text-foreground">{s.status}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.count} leads · {s.valor > 0 ? formatCurrencyBRL(s.valor) : 'R$ 0'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {stats.faturamento > 0 && (
          <div className="mt-4 pt-4 border-t border-border flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Faturamento total CRM:</span>
            <span className="text-sm font-bold text-primary">{formatCurrencyBRL(stats.faturamento)}</span>
          </div>
        )}
      </div>}
    </div>
  );
}

// ── Dashboard Section Drag Ordering ─────────────────────────────────────────
const SECTION_INFO: Record<string, { label: string }> = {
  geral:   { label: 'Métricas Gerais' },
  meta:    { label: 'Meta Ads' },
  google:  { label: 'Google Ads' },
  social:  { label: 'Páginas & Perfis Sociais' },
  crm:     { label: 'CRM Leads' },
};

function SortableSection({
  id, editMode, orderIndex, children,
}: {
  id: string; editMode: boolean; orderIndex: number; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    order: orderIndex,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {editMode && (
        <div className="mb-1 flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-1.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Arrastar seção"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span className="flex-1 text-xs font-semibold text-muted-foreground">{SECTION_INFO[id]?.label ?? id}</span>
        </div>
      )}
      {children}
    </div>
  );
}

// ── Insight Card ────────────────────────────────────────────────────────────
function InsightCard({ insight, onDismiss }: { insight: AiInsight; onDismiss: () => void }) {
  const sev = insight.severity as string;
  const cfg = sev === 'critical'
    ? { badge: 'CRÍTICO', badgeCls: 'bg-red-500/15 text-red-400 border-red-500/30', cardCls: 'border-red-500/20 bg-red-500/5' }
    : sev === 'warn'
    ? { badge: 'ATENÇÃO', badgeCls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', cardCls: 'border-amber-500/20 bg-amber-500/5' }
    : sev === 'opportunity'
    ? { badge: 'OPORTUNIDADE', badgeCls: 'bg-teal-500/15 text-teal-400 border-teal-500/30', cardCls: 'border-teal-500/20 bg-teal-500/5' }
    : { badge: 'INFO', badgeCls: 'bg-blue-500/15 text-blue-400 border-blue-500/30', cardCls: 'border-blue-500/20 bg-blue-500/5' };
  return (
    <div className={cn('relative rounded-xl border p-4 space-y-2', cfg.cardCls)}>
      <button type="button" onClick={onDismiss} className="absolute right-2.5 top-2.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors">
        <X className="h-3.5 w-3.5" />
      </button>
      <span className={cn('inline-block rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest', cfg.badgeCls)}>{cfg.badge}</span>
      <p className="text-xs font-bold text-foreground leading-snug pr-5">{insight.title}</p>
      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{insight.suggestion}</p>
      <button type="button" className="text-[11px] font-semibold text-primary hover:underline transition-colors">Ver recomendação →</button>
    </div>
  );
}

function AiRecommendationsBox({
  insights,
  loading,
  onAnalyze,
}: {
  insights: AiInsight[];
  loading: boolean;
  onAnalyze: () => void;
}) {
  const visibleInsights = insights.slice(0, 4);
  const placeholders = [
    {
      id: 'rec-placeholder-1',
      title: 'Aumentar investimento em CTR',
      suggestion: 'CTR acima do benchmark para Feed. Investir mais nessa campanha pode reduzir CPL.',
      severity: 'critical' as const,
    },
    {
      id: 'rec-placeholder-2',
      title: 'Consolidar criativos de baixo desempenho',
      suggestion: 'Variações com desempenho baixo devem ser pausadas para liberar verba.',
      severity: 'warn' as const,
    },
    {
      id: 'rec-placeholder-3',
      title: 'Reativar públicos quentes',
      suggestion: 'Públicos engajados têm sinal de intenção e podem retomar conversas.',
      severity: 'info' as const,
    },
    {
      id: 'rec-placeholder-4',
      title: 'Testar novos criativos para Reels',
      suggestion: 'Realocar parte do orçamento para criativos verticais pode abrir nova escala.',
      severity: 'warn' as const,
    },
  ];
  const items = visibleInsights.length > 0 ? visibleInsights : placeholders;
  const icons = [BarChart3, Zap, Target, Briefcase];
  const styles = [
    {
      wrap: 'border-violet-500/45 bg-violet-500/20 shadow-[0_0_30px_rgba(139,92,246,0.24)]',
      icon: 'bg-violet-500/35 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.54)]',
      badge: 'bg-violet-500/30 text-violet-200',
      label: 'Alto impacto',
    },
    {
      wrap: 'border-emerald-500/45 bg-emerald-500/18 shadow-[0_0_30px_rgba(34,197,94,0.22)]',
      icon: 'bg-emerald-500/35 text-emerald-300 shadow-[0_0_20px_rgba(34,197,94,0.50)]',
      badge: 'bg-emerald-500/30 text-emerald-200',
      label: 'Médio impacto',
    },
    {
      wrap: 'border-blue-500/45 bg-blue-500/18 shadow-[0_0_30px_rgba(59,130,246,0.23)]',
      icon: 'bg-blue-500/35 text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.52)]',
      badge: 'bg-blue-500/30 text-blue-200',
      label: 'Médio impacto',
    },
    {
      wrap: 'border-amber-500/45 bg-amber-500/18 shadow-[0_0_30px_rgba(245,158,11,0.24)]',
      icon: 'bg-amber-500/35 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.54)]',
      badge: 'bg-amber-500/30 text-amber-100',
      label: 'Alto impacto',
    },
  ];

  return (
    <aside className="relative overflow-hidden rounded-2xl border border-violet-500/45 bg-[#090716] p-3.5 shadow-[0_0_48px_rgba(139,92,246,0.22)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.20),transparent_42%),radial-gradient(circle_at_88%_0%,rgba(139,92,246,0.34),transparent_38%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#A855F7,transparent)]" />
      <div className="relative flex items-center justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground">Recomendações com IA</p>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading}
          className="rounded-md border border-violet-500/35 bg-violet-500/15 px-2 py-1 text-[9px] font-bold text-violet-200 transition-colors hover:bg-violet-500/25 disabled:opacity-60"
        >
          {loading ? 'Gerando...' : 'Ver todas'}
        </button>
      </div>
      <div className="relative mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item, index) => {
          const Icon = icons[index % icons.length];
          const style = styles[index % styles.length];
          return (
            <button
              key={item.id}
              type="button"
              onClick={visibleInsights.length > 0 ? undefined : onAnalyze}
              className={cn('group flex min-h-[92px] w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-white/10', style.wrap)}
            >
              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md', style.icon)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-bold leading-tight text-foreground">{item.title}</span>
                <span className="mt-1 block text-[9.5px] leading-snug text-foreground/58 line-clamp-2">{item.suggestion}</span>
                <span className={cn('mt-2 inline-flex rounded-full px-2 py-0.5 text-[8.5px] font-bold', style.badge)}>{style.label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ── Circular Quality ─────────────────────────────────────────────────────────
function CircularQuality({ pct, color, size = 120 }: { pct: number; color: string; size?: number }) {
  const sw = Math.round(size * 0.085);
  const r = (size - sw) / 2 - 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  const cx = size / 2, cy = size / 2;
  const fontSize = size >= 150 ? '1.75rem' : size >= 120 ? '1.35rem' : '1.1rem';
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={sw} />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ filter: `drop-shadow(0 0 10px ${color}90)`, transition: 'stroke-dasharray 0.7s ease' }} />
      </svg>
      <span className="absolute font-bold" style={{ color, fontSize }}>{pct}%</span>
    </div>
  );
}

// ── Creative Carousel Card ───────────────────────────────────────────────────
const MEDIA_TYPE_BADGE: Record<string, { label: string; bg: string }> = {
  video:    { label: 'VÍDEO',     bg: 'rgba(139,92,246,0.85)' },
  carousel: { label: 'CARROSSEL', bg: 'rgba(247,119,55,0.85)' },
  image:    { label: 'IMAGEM',    bg: 'rgba(64,93,230,0.85)'  },
};

function CreativeCarouselCard({ creative, idx, sortBy, onPreview }: {
  creative: TopCreative; idx: number; sortBy: SortKey; onPreview: (c: TopCreative) => void;
}) {
  const [imgStage, setImgStage] = useState<'primary' | 'thumb' | 'error'>('primary');

  // Reset image state when creative changes so stale error from a previous ad doesn't bleed through
  const prevAdId = useRef(creative.adId);
  if (prevAdId.current !== creative.adId) {
    prevAdId.current = creative.adId;
    setImgStage('primary');
  }

  const primaryUrl = creative.imageUrl;
  const thumbUrl = creative.thumbnailUrl;
  const imgUrl = imgStage === 'primary' ? (primaryUrl ?? thumbUrl) : imgStage === 'thumb' ? thumbUrl : undefined;
  const isVideo = creative.mediaType === 'video';
  const mediaBadge = MEDIA_TYPE_BADGE[creative.mediaType];

  const metricValue = sortBy === 'leads' ? creative.leads.toLocaleString('pt-BR')
    : sortBy === 'cpl' ? (creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—')
    : sortBy === 'ctr' ? `${creative.ctr.toFixed(2)}%`
    : formatCurrencyBRL(creative.spend);

  function handleImgError() {
    if (imgStage === 'primary' && primaryUrl && thumbUrl && thumbUrl !== primaryUrl) {
      setImgStage('thumb');
    } else {
      setImgStage('error');
    }
  }

  return (
    <div className="w-[228px] shrink-0 overflow-hidden rounded-xl border border-[#0B84FF]/35 bg-black/45 shadow-[0_0_24px_rgba(11,132,255,0.16)] transition-colors hover:border-[#55F52F]/65 hover:shadow-[0_0_30px_rgba(85,245,47,0.26)]">
      <div className="relative overflow-hidden bg-[#07101F]" style={{ aspectRatio: '9/16' }}>
        {imgUrl && imgStage !== 'error' ? (
          <button type="button" onClick={() => onPreview(creative)} className="block h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl} alt={creative.adName} className="h-full w-full object-cover" onError={handleImgError} />
            {isVideo && <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none" />}
          </button>
        ) : creative.permalink ? (
          <a
            href={creative.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 hover:bg-black/60 transition-colors"
            title="Ver publicação original"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-7 w-7 text-white/60" />
            <span className="text-[10px] font-semibold text-white/50">Ver publicação</span>
          </a>
        ) : <ImageIcon className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground/30" />}

        {/* Play button — shows for any video creative, not only when videoUrl is available */}
        {isVideo && imgStage !== 'error' && imgUrl && (
          <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 pointer-events-none">
            <Play className="h-3 w-3 fill-white text-white" />
          </span>
        )}

        {/* Media type badge — bottom-left, above rank */}
        {mediaBadge && (
          <span
            className="absolute bottom-9 left-2 rounded px-1.5 py-0.5 text-[8px] font-black text-white leading-none"
            style={{ backgroundColor: mediaBadge.bg }}
          >
            {mediaBadge.label}
          </span>
        )}

        <span className="absolute left-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/85 text-[11px] font-bold text-white shadow-[0_0_14px_rgba(255,255,255,0.18)]">{idx + 1}</span>
        <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-black shadow-[0_0_16px_rgba(85,245,47,0.72)]">{metricValue}</span>
      </div>
      <div className="p-2.5 space-y-2">
        <p className="text-[11px] font-bold truncate">{creative.adName}</p>
        {(creative.campaignName ?? creative.adSetName) && (
          <div className="space-y-0.5">
            {creative.campaignName && (
              <p className="text-[9px] text-foreground/45 truncate" title={creative.campaignName}>
                <span className="font-semibold text-foreground/60">Camp:</span> {creative.campaignName}
              </p>
            )}
            {creative.adSetName && (
              <p className="text-[9px] text-foreground/45 truncate" title={creative.adSetName}>
                <span className="font-semibold text-foreground/60">Conj:</span> {creative.adSetName}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1">
          {([
            { label: 'INVEST.', val: formatCurrencyBRL(creative.spend) },
            { label: 'LEADS', val: creative.leads.toLocaleString('pt-BR') },
            { label: 'CPL', val: creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—' },
            { label: 'CTR', val: `${creative.ctr.toFixed(2)}%` },
          ] as const).map(m => (
            <div key={m.label} className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-foreground/52">{m.label}</p>
              <p className="text-[11px] font-bold text-foreground">{m.val}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Social Page Cards ─────────────────────────────────────────────────────────
function numK(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('pt-BR');
}

function SocialMetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-foreground/55">{label}</span>
      <span className="font-bold tabular-nums text-foreground">{numK(value)}</span>
    </div>
  );
}

function FbCard({ data }: { data: FacebookPageData }) {
  const FB = '#1877F2';
  return (
    <div className="relative overflow-hidden rounded-xl border bg-[#070B14] p-4" style={{ borderColor: `${FB}55`, boxShadow: `0 0 28px ${FB}18` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 88% 10%, ${FB}30, transparent 46%)` }} />
      <div className="relative flex items-center gap-3 mb-3">
        {data.picture
          ? <img src={data.picture} alt={data.pageName} className="h-10 w-10 rounded-full object-cover border-2" style={{ borderColor: `${FB}88` }} />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-white text-lg" style={{ borderColor: `${FB}88`, background: `${FB}33` }}>f</span>
        }
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase tracking-widest" style={{ color: FB }}>Facebook</p>
          <p className="truncate text-sm font-semibold text-foreground">{data.pageName}</p>
        </div>
      </div>
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 mb-0.5">Curtidas / Seguidores</p>
        <p className="font-heading text-xl leading-none font-normal mb-3" style={{ color: FB }}>{numK(data.fans)}</p>
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          {data.fanAdds > 0 && <SocialMetricRow label="Novas curtidas no período" value={data.fanAdds} />}
          <SocialMetricRow label="Alcance" value={data.reach} />
          <SocialMetricRow label="Impressões" value={data.impressions} />
          <SocialMetricRow label="Engajamentos" value={data.engagements} />
          <SocialMetricRow label="Visitas à página" value={data.pageViews} />
        </div>
      </div>
    </div>
  );
}

function IgCard({ data }: { data: InstagramPageData }) {
  const IG = '#E1306C';
  return (
    <div className="relative overflow-hidden rounded-xl border bg-[#070B14] p-4" style={{ borderColor: `${IG}55`, boxShadow: `0 0 28px ${IG}18` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 88% 10%, ${IG}28, transparent 46%)` }} />
      <div className="relative flex items-center gap-3 mb-3">
        {data.picture
          ? <img src={data.picture} alt={data.username} className="h-10 w-10 rounded-full object-cover border-2" style={{ borderColor: `${IG}88` }} />
          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-white text-lg" style={{ borderColor: `${IG}88`, background: `${IG}33` }}>ig</span>
        }
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase tracking-widest" style={{ color: IG }}>Instagram</p>
          <p className="truncate text-sm font-semibold text-foreground">{data.username}</p>
        </div>
      </div>
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/50 mb-0.5">Seguidores</p>
        <p className="font-heading text-xl leading-none font-normal mb-3" style={{ color: IG }}>{numK(data.followers)}</p>
        <div className="space-y-1.5 border-t border-white/10 pt-2">
          <SocialMetricRow label="Alcance" value={data.reach} />
          <SocialMetricRow label="Visualizações" value={data.views} />
          <SocialMetricRow label="Visitas ao perfil" value={data.profileViews} />
          {data.websiteClicks > 0 && <SocialMetricRow label="Cliques no site" value={data.websiteClicks} />}
          {data.accountsEngaged > 0 && <SocialMetricRow label="Contas engajadas" value={data.accountsEngaged} />}
          {data.totalInteractions > 0 && <SocialMetricRow label="Interações" value={data.totalInteractions} />}
        </div>
      </div>
    </div>
  );
}

function SocialPageCards({
  clientName, showClientName, facebook, instagram,
}: {
  clientName?: string;
  showClientName?: boolean;
  facebook: FacebookPageData | null;
  instagram: InstagramPageData | null;
}) {
  if (!facebook && !instagram) return null;
  return (
    <div className="contents">
      {showClientName && (facebook ?? instagram) && (
        <p className="col-span-full text-[10px] font-bold uppercase tracking-widest text-foreground/50 mt-1">{clientName}</p>
      )}
      {facebook && <FbCard data={facebook} />}
      {instagram && <IgCard data={instagram} />}
    </div>
  );
}

// ── IgTopPostsCard ────────────────────────────────────────────────────────────
import type { IgPost } from '@/app/api/meta/ig-posts/route';

type IgSortKey = 'reach' | 'views' | 'likes' | 'saves' | 'comments';

const IG_SORT_OPTIONS: { value: IgSortKey; label: string }[] = [
  { value: 'reach',    label: 'Alcance' },
  { value: 'views',   label: 'Visualizações' },
  { value: 'likes',   label: 'Curtidas' },
  { value: 'saves',   label: 'Salvamentos' },
  { value: 'comments',label: 'Comentários' },
];

function IgTopPostsCard({ posts, loading, sortBy, onSortChange, periodFrom, periodTo }: {
  posts: IgPost[];
  loading: boolean;
  sortBy: IgSortKey;
  onSortChange: (s: IgSortKey) => void;
  periodFrom?: string;
  periodTo?: string;
}) {
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all');

  function fmt(n: number) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  function fmtDate(ts: string) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  function fmtPeriodDate(iso: string) {
    return new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  const MEDIA_BADGE: Record<string, { label: string; color: string }> = {
    REELS:          { label: 'REELS',     color: '#E1306C' },
    VIDEO:          { label: 'VÍDEO',     color: '#833AB4' },
    CAROUSEL_ALBUM: { label: 'CARROSSEL', color: '#F77737' },
    IMAGE:          { label: 'FOTO',      color: '#405DE6' },
  };

  const TYPE_FILTERS = [
    { value: 'all',            label: 'Todos' },
    { value: 'REELS',          label: 'Reels' },
    { value: 'IMAGE',          label: 'Foto' },
    { value: 'CAROUSEL_ALBUM', label: 'Carrossel' },
  ];

  const METRIC_COLS: Array<{ key: IgSortKey; label: string; getValue: (p: IgPost) => number }> = [
    { key: 'reach',    label: 'Alcance',  getValue: p => p.reach },
    { key: 'views',    label: 'Views',    getValue: p => p.videoViews },
    { key: 'likes',    label: 'Curtidas', getValue: p => p.likes },
    { key: 'comments', label: 'Coment.',  getValue: p => p.comments },
    { key: 'saves',    label: 'Salv.',    getValue: p => p.saves },
  ];

  const filtered = typeFilter === 'all' ? posts : posts.filter(p => p.mediaType === typeFilter);
  const periodLabel = periodFrom && periodTo
    ? `${fmtPeriodDate(periodFrom)} – ${fmtPeriodDate(periodTo)} · métricas vitalícias`
    : 'métricas vitalícias';

  return (
    <div className="rounded-xl border border-[#E1306C]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(225,48,108,0.06),0_0_28px_rgba(225,48,108,0.14)] h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#E1306C] shrink-0"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/75 leading-none">Top Postagens Instagram</p>
            <p className="text-[9px] text-muted-foreground mt-0.5">{periodLabel}</p>
          </div>
          {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Type filter chips */}
          <div className="flex items-center gap-1">
            {TYPE_FILTERS.map(f => {
              const count = f.value === 'all' ? posts.length : posts.filter(p => p.mediaType === f.value).length;
              if (f.value !== 'all' && count === 0) return null;
              return (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors border',
                    typeFilter === f.value
                      ? 'bg-[#E1306C]/20 text-[#E1306C] border-[#E1306C]/50'
                      : 'text-muted-foreground border-border hover:text-foreground'
                  )}
                >
                  {f.label}{f.value !== 'all' && <span className="ml-1 opacity-50">{count}</span>}
                </button>
              );
            })}
          </div>
          <div className="w-px h-3.5 bg-border" />
          {/* Sort buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-widest text-foreground/40 mr-0.5">Ordenar</span>
            {IG_SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => onSortChange(opt.value)}
                className={cn(
                  'px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors border',
                  sortBy === opt.value
                    ? 'bg-[#E1306C] text-white border-[#E1306C] shadow-[0_0_8px_rgba(225,48,108,0.35)]'
                    : 'text-muted-foreground border-border hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 flex-1 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando postagens...
        </div>
      ) : filtered.length === 0 ? (
        <p className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          {posts.length === 0 ? 'Nenhuma postagem encontrada no período.' : 'Nenhuma postagem desse tipo no período.'}
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Column header row */}
          <div className="flex items-center gap-3 pb-1.5 mb-1 border-b border-border/40 sticky top-0 bg-black/60 backdrop-blur-sm z-10">
            <div className="w-5 shrink-0" />
            <div className="w-14 shrink-0" />
            <div className="flex-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground/50">Post</div>
            {METRIC_COLS.map(col => (
              <button
                key={col.key}
                onClick={() => onSortChange(col.key)}
                className={cn(
                  'text-right min-w-[2.75rem] shrink-0 text-[9px] font-bold uppercase tracking-widest transition-colors',
                  sortBy === col.key ? 'text-[#E1306C]' : 'text-muted-foreground/50 hover:text-foreground'
                )}
              >
                {col.label}
              </button>
            ))}
            <div className="w-5 shrink-0" />
          </div>

          {/* Post rows */}
          <div className="space-y-0.5">
            {filtered.map((post, idx) => {
              const badge = MEDIA_BADGE[post.mediaType] ?? MEDIA_BADGE.IMAGE;
              const thumb = post.thumbnailUrl ?? post.mediaUrl;
              return (
                <div
                  key={post.id}
                  className="flex items-center gap-3 px-1 py-2 rounded-lg hover:bg-[#E1306C]/5 transition-colors group"
                >
                  {/* Rank */}
                  <span className="w-5 text-center text-[11px] font-black text-muted-foreground shrink-0">{idx + 1}</span>

                  {/* Thumbnail */}
                  <div className="relative h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-muted">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <ImageIcon className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                    )}
                    <span
                      className="absolute bottom-0 inset-x-0 py-0.5 text-center text-[7px] font-black text-white leading-tight"
                      style={{ backgroundColor: badge.color + 'cc' }}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Caption + date */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug text-foreground/80 line-clamp-2">
                      {post.caption || <em className="text-muted-foreground not-italic opacity-50">Sem legenda</em>}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      @{post.username}{post.timestamp && <> · {fmtDate(post.timestamp)}</>}
                      {!post.publishedInPeriod && <span className="text-amber-400 ml-1">· fora do período</span>}
                    </p>
                  </div>

                  {/* Metric values */}
                  {METRIC_COLS.map(col => {
                    const isActive = col.key === sortBy;
                    const val = col.getValue(post);
                    return (
                      <div key={col.key} className="text-right min-w-[2.75rem] shrink-0">
                        <p className={cn(
                          'text-sm tabular-nums leading-none',
                          isActive ? 'text-[#E1306C] font-black' : val > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground/30 font-normal'
                        )}>
                          {val > 0 ? fmt(val) : '—'}
                        </p>
                      </div>
                    );
                  })}

                  {/* External link */}
                  <a
                    href={post.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-5 shrink-0 flex items-center justify-center text-muted-foreground/30 hover:text-[#E1306C] transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

type PremiumMetricFormat = 'currency' | 'number' | 'percent' | 'times';

function premiumValue(value: number | null | undefined, format: PremiumMetricFormat = 'number', digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (format === 'currency') return formatCurrencyBRL(value);
  if (format === 'percent') return `${value.toFixed(digits).replace('.', ',')}%`;
  if (format === 'times') return `${value.toFixed(2).replace('.', ',')}x`;
  return value.toLocaleString('pt-BR');
}

function PremiumPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 shadow-[0_18px_60px_rgba(0,0,0,0.28)]', className)}>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: 'Excelente' | 'Bom' | 'Neutro' | 'Alerta' }) {
  const styles = {
    Excelente: 'border-[#6cff2f]/35 bg-[#6cff2f]/18 text-[#9cff75]',
    Bom: 'border-[#78d957]/30 bg-[#78d957]/14 text-[#85e45f]',
    Neutro: 'border-white/10 bg-white/[0.07] text-[#a7b0b6]',
    Alerta: 'border-amber-400/30 bg-amber-400/12 text-amber-300',
  }[status];
  return <span className={cn('rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.04em]', styles)}>{status}</span>;
}

function GoalProgressCard({
  title, icon: Icon, target, partial, value, format = 'number',
}: {
  title: string;
  icon: React.ElementType;
  target: number;
  partial: number;
  value: number;
  format?: PremiumMetricFormat;
}) {
  const base = partial > 0 ? partial : target;
  const progress = base > 0 ? Math.max(0, Math.min(100, (value / base) * 100)) : 0;
  return (
    <PremiumPanel className="relative overflow-hidden p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(108,255,47,0.16),transparent_32%),linear-gradient(135deg,rgba(108,255,47,0.05),rgba(22,139,255,0.02))]" />
      <div className="relative flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#6cff2f]/18 bg-[#6cff2f]/10 text-[#6cff2f]">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">{title}</h2>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              ['Meta', target],
              ['Meta Parcial', partial],
              ['Realizado', value],
            ].map(([label, amount]) => (
              <div key={String(label)} className="min-w-0">
                <p className="truncate font-heading text-2xl leading-none text-[#f4f7f8]">{Number(amount) > 0 ? premiumValue(Number(amount), format) : '—'}</p>
                <p className="mt-1.5 text-xs font-medium text-[#a7b0b6]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <div className="relative h-7 overflow-hidden rounded-md border border-white/10 bg-[#081014]">
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-[#8bdc62] transition-all"
                style={{
                  width: `${progress}%`,
                  backgroundImage: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.14) 0 12px,transparent 12px 24px)',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-black text-black">{progress > 0 ? premiumValue(progress, 'percent') : '—'}</span>
              </div>
            </div>
            <div className="mt-2 flex justify-between text-xs text-[#a7b0b6]">
              <span>0%</span>
              <span>Meta Parcial</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      </div>
    </PremiumPanel>
  );
}

function QuickMetricCard({ title, value, change, icon: Icon }: {
  title: string;
  value: string;
  change?: number | null;
  icon: React.ElementType;
}) {
  const hasChange = change !== null && change !== undefined && Number.isFinite(change);
  const positive = !hasChange || change >= 0;
  return (
    <PremiumPanel className="relative overflow-hidden p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#6cff2f]/18 bg-[#6cff2f]/10 text-[#6cff2f]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.06em] text-[#dce4e8]">{title}</p>
          <p className="mt-2 font-heading text-2xl leading-none text-[#f4f7f8]">{value}</p>
          <p className={cn('mt-1 text-xs font-bold', positive ? 'text-[#6cff2f]' : 'text-red-400')}>
            {hasChange ? `${change >= 0 ? '+' : ''}${change.toFixed(1).replace('.', ',')}%` : '—'} <span className="font-medium text-[#a7b0b6]">vs mês passado</span>
          </p>
        </div>
      </div>
    </PremiumPanel>
  );
}

function MiniPlatformMetric({ label, value, sub, icon: Icon, logo }: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ElementType;
  logo?: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-[#111a20]/80 p-3">
      <div className="mb-3 flex items-center gap-2">
        {logo ?? (Icon ? <Icon className="h-4 w-4 text-[#6cff2f]" /> : null)}
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#a7b0b6]">{label}</span>
      </div>
      <p className="font-heading text-xl leading-none text-[#f4f7f8]">{value}</p>
      {sub && <p className="mt-1 text-xs font-semibold text-[#78d957]">{sub}</p>}
    </div>
  );
}

function SimpleFunnel({ steps, totalRate, metaRate, previousRate }: {
  steps: Array<{ label: string; value: string; percent: string }>;
  totalRate: string;
  metaRate: string;
  previousRate: string;
}) {
  return (
    <PremiumPanel className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Funil de Performance</h3>
        <span className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-[#a7b0b6]">Conversão: {totalRate}</span>
      </div>
      <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
        {steps.map((step, index) => (
          <div key={step.label} className="relative">
            <p className="text-xs font-black uppercase tracking-[0.06em] text-[#9aa4aa]">{step.label}</p>
            <div className="mt-2 flex items-end justify-between gap-2">
              <span className="font-heading text-xl leading-none text-[#f4f7f8]">{step.value}</span>
              <span className="text-xs text-[#a7b0b6]">{step.percent}</span>
            </div>
            {index < steps.length - 1 && <ChevronRight className="absolute -right-3 top-8 hidden h-4 w-4 text-[#a7b0b6] xl:block" />}
          </div>
        ))}
      </div>
      <div className="mt-5 h-12 overflow-hidden rounded-sm bg-[#081014]">
        <div className="h-full w-full bg-[linear-gradient(100deg,#9ad76c_0%,#85d35e_52%,#62b843_100%)] [clip-path:polygon(0_0,100%_18%,100%_82%,0_100%)]" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-white/[0.08] pt-3 text-xs">
        <div><p className="text-[#9aa4aa]">Taxa de conversão geral</p><p className="font-heading text-xl leading-none text-[#6cff2f]">{totalRate}</p></div>
        <div><p className="text-[#9aa4aa]">Meta geral</p><p className="font-heading text-xl leading-none text-[#f4f7f8]">{metaRate}</p></div>
        <div><p className="text-[#9aa4aa]">Vs mês passado</p><p className="font-heading text-xl leading-none text-[#6cff2f]">{previousRate}</p></div>
      </div>
    </PremiumPanel>
  );
}

function ChannelSummaryTable({ rows }: {
  rows: Array<{ channel: string; investment: string; leads: string; cpl: string; conversion: string; status: 'Excelente' | 'Bom' | 'Neutro' | 'Alerta'; logo: ReactNode }>;
}) {
  return (
    <PremiumPanel className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Resumo por Canal</h3>
        <Info className="h-3.5 w-3.5 text-[#a7b0b6]" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.08em] text-[#9aa4aa]">
            <tr>
              <th className="py-2">Canal</th>
              <th>Investimento</th>
              <th>Leads</th>
              <th>CPL</th>
              <th>Conversão</th>
              <th className="text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.07]">
            {rows.map((row) => (
              <tr key={row.channel} className="text-[#f4f7f8]">
                <td className="py-3"><span className="flex items-center gap-2">{row.logo}{row.channel}</span></td>
                <td>{row.investment}</td>
                <td>{row.leads}</td>
                <td>{row.cpl}</td>
                <td>{row.conversion}</td>
                <td className="text-right"><StatusPill status={row.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PremiumPanel>
  );
}

function CompactCampaignTable({ campaigns, loading, platform }: {
  campaigns: CampaignPerformance[];
  loading: boolean;
  platform: AdsPlatform;
}) {
  const rows = campaigns.slice(0, 4);
  if (loading) return <div className="py-8 text-center text-sm text-[#9aa4aa]">Carregando campanhas...</div>;
  if (!rows.length) return <div className="py-8 text-center text-sm text-[#9aa4aa]">Nenhuma campanha encontrada.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-[0.08em] text-[#9aa4aa]">
          <tr>
            <th className="py-2">Campanha</th>
            <th>Investimento</th>
            <th>{platform === 'meta' ? 'Leads' : 'Cliques'}</th>
            <th>CPL</th>
            <th>{platform === 'meta' ? 'Conversão' : 'CTR'}</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {rows.map((campaign) => {
            const status: 'Excelente' | 'Bom' | 'Neutro' = campaign.leads > 20 ? 'Excelente' : campaign.leads > 0 ? 'Bom' : 'Neutro';
            return (
              <tr key={campaign.id} className="text-[#f4f7f8]">
                <td className="max-w-[220px] truncate py-3">{campaign.name}</td>
                <td>{premiumValue(campaign.spend, 'currency')}</td>
                <td>{platform === 'meta' ? premiumValue(campaign.leads) : premiumValue(campaign.clicks)}</td>
                <td>{campaign.cpl > 0 ? premiumValue(campaign.cpl, 'currency') : '—'}</td>
                <td>{premiumValue(campaign.ctr, 'percent')}</td>
                <td className="text-right"><StatusPill status={status} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CompactKeywordTable({ keywords, loading }: { keywords: GoogleKeyword[]; loading: boolean }) {
  const rows = keywords.slice(0, 5);
  if (loading) return <div className="py-8 text-center text-sm text-[#9aa4aa]">Carregando palavras-chave...</div>;
  if (!rows.length) return <div className="py-8 text-center text-sm text-[#9aa4aa]">Nenhuma palavra-chave encontrada.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-[0.08em] text-[#9aa4aa]">
          <tr>
            <th className="py-2">Palavra-chave</th>
            <th>Cliques</th>
            <th>Leads</th>
            <th>CPL</th>
            <th>Conversão</th>
            <th className="text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {rows.map((keyword, index) => {
            const rate = keyword.clicks > 0 ? (keyword.conversions / keyword.clicks) * 100 : 0;
            return (
              <tr key={`${keyword.text}-${index}`} className="text-[#f4f7f8]">
                <td className="max-w-[220px] truncate py-3"><span className="mr-2 rounded bg-[#6cff2f]/18 px-1.5 py-0.5 text-[#6cff2f]">{index + 1}</span>{keyword.text}</td>
                <td>{premiumValue(keyword.clicks)}</td>
                <td>{premiumValue(keyword.conversions)}</td>
                <td>{keyword.cpl > 0 ? premiumValue(keyword.cpl, 'currency') : '—'}</td>
                <td>{premiumValue(rate, 'percent', 0)}</td>
                <td className="text-right"><StatusPill status={rate > 20 ? 'Excelente' : rate > 0 ? 'Bom' : 'Neutro'} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function creativeObjectiveMetrics(c: TopCreative): Array<{ label: string; value: string }> {
  if (c.leads > 0) {
    return [
      { label: 'Leads', value: premiumValue(c.leads) },
      { label: 'CPL', value: c.cpl > 0 ? premiumValue(c.cpl, 'currency') : '—' },
      { label: 'CTR', value: `${c.ctr.toFixed(2)}%` },
    ];
  }
  return [
    { label: 'Cliques', value: premiumValue(c.clicks) },
    { label: 'CTR', value: `${c.ctr.toFixed(2)}%` },
    { label: 'Invest.', value: premiumValue(c.spend, 'currency') },
  ];
}

function CreativeHorizontalStrip({ creatives, loading, onPreview }: {
  creatives: TopCreative[];
  loading: boolean;
  onPreview: (creative: TopCreative) => void;
}) {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="w-[170px] shrink-0 animate-pulse rounded-xl bg-white/[0.06]" style={{ height: 260 }} />
        ))}
      </div>
    );
  }
  if (!creatives.length) {
    return <div className="py-8 text-center text-sm text-[#9aa4aa]">Nenhum criativo encontrado.</div>;
  }
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:#2a2d3a_transparent]">
      {creatives.slice(0, 10).map((creative, index) => {
        const image = creative.imageUrl || creative.thumbnailUrl;
        const metrics = creativeObjectiveMetrics(creative);
        const isVideo = creative.mediaType === 'video';
        return (
          <button
            key={creative.adId}
            type="button"
            onClick={() => onPreview(creative)}
            className="group w-[170px] shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1519] text-left transition hover:border-[#6cff2f]/40"
          >
            <div className="relative overflow-hidden bg-[#071014]" style={{ aspectRatio: '4/5' }}>
              {image
                ? <img src={image} alt={creative.adName} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                : <div className="flex h-full items-center justify-center text-[#9aa4aa]"><ImageIcon className="h-6 w-6" /></div>}
              {isVideo && (
                <span className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/70">
                  <Play className="h-2.5 w-2.5 fill-white text-white" />
                </span>
              )}
              <span className="absolute bottom-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-[10px] font-black text-white">{index + 1}</span>
              <span className="absolute right-2 top-2 rounded bg-[#6cff2f] px-1.5 py-0.5 text-[9px] font-black text-black">
                {premiumValue(creative.spend, 'currency')}
              </span>
            </div>
            <div className="p-2">
              {creative.campaignName && (
                <p className="mb-1 truncate text-[9px] font-semibold uppercase tracking-[0.05em] text-[#6cff2f]/70" title={creative.campaignName}>
                  {creative.campaignName}
                </p>
              )}
              <p className="mb-2 truncate text-[10px] font-bold text-[#dce4e8]" title={creative.adName}>{creative.adName}</p>
              <div className="grid grid-cols-3 gap-1">
                {metrics.map(m => (
                  <div key={m.label} className="rounded border border-white/[0.07] bg-white/[0.04] px-1 py-1">
                    <p className="text-[8px] font-bold uppercase tracking-wider text-[#9aa4aa]">{m.label}</p>
                    <p className="text-[10px] font-black text-[#f4f7f8]">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function GeneralDashboard() {
  const { clients } = useClients();
  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [prevMetricsByClient, setPrevMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [period, setPeriod] = useState<Period>('this_month');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [metricsByClient, setMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [planningsByClient, setPlanningsByClient] = useState<Record<string, PlanningConfig>>({});
  const [crmSummary, setCrmSummary] = useState<Record<string, ClientSheetsSummary>>({});
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [keywords, setKeywords] = useState<GoogleKeyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
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
  const [dataCacheAge, setDataCacheAge] = useState<number | null>(null);
  const editMode = true;
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPrefs>(DEFAULT_DASHBOARD_PREFS);
  const [metaKpiLayout, setMetaKpiLayout] = useState<RglLayout[]>(DEFAULT_META_KPI_LAYOUT);
  const [googleKpiLayout, setGoogleKpiLayout] = useState<RglLayout[]>(DEFAULT_GOOGLE_KPI_LAYOUT);
  const [generalLayout, setGeneralLayout] = useState<RglLayout[]>(DEFAULT_GENERAL_LAYOUT);
  const [metaPanelsLayout, setMetaPanelsLayout] = useState<RglLayout[]>(DEFAULT_META_PANELS_LAYOUT);
  const [googlePanelsLayout, setGooglePanelsLayout] = useState<RglLayout[]>(DEFAULT_GOOGLE_PANELS_LAYOUT);
  const [socialKpiLayout, setSocialKpiLayout] = useState<RglLayout[]>(DEFAULT_SOCIAL_KPI_LAYOUT);
  const [pageInsights, setPageInsights] = useState<PageInsightsResult[]>([]);
  const [prevPageInsights, setPrevPageInsights] = useState<PageInsightsResult[]>([]);
  const [pageInsightsLoading, setPageInsightsLoading] = useState(false);
  const [igPosts, setIgPosts] = useState<IgPost[]>([]);
  const [igPostsLoading, setIgPostsLoading] = useState(false);
  const [igSortBy, setIgSortBy] = useState<IgSortKey>('reach');
  // Stable string key derived from selectedIds — used as useEffect dependency
  const selectedKey = [...selectedIds].sort().join(',');
  // Ref always points to the suffix currently in use (updated synchronously in load effect)
  const currentLsSuffixRef = useRef('');
  // Track last auto-resize key per panel group to avoid fighting user manual resizes within a session
  const metaPanelsResizeKeyRef = useRef('');
  const googlePanelsResizeKeyRef = useRef('');
  const socialResizeKeyRef = useRef('');
  // Track when each fetch has actually started (to ignore the initial mount where loading=false)
  const campaignsFetchStartedRef = useRef('');
  const creativesFetchStartedRef = useRef('');
  const keywordsFetchStartedRef = useRef('');
  const igPostsFetchStartedRef = useRef('');
  const [alertsCollapsed, setAlertsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('dashboard:alerts:collapsed') === '1';
  });

  function toggleAlertsCollapsed() {
    setAlertsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('dashboard:alerts:collapsed', next ? '1' : '0');
      return next;
    });
  }

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('dashboard:sections:collapsed');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
  });

  function toggleSection(id: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('dashboard:sections:collapsed', JSON.stringify([...next]));
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setDashboardPrefs(prev => {
        const order = prev.sectionOrder;
        const oldIndex = order.indexOf(String(active.id));
        const newIndex = order.indexOf(String(over.id));
        if (oldIndex === -1 || newIndex === -1) return prev;
        return { ...prev, sectionOrder: arrayMove(order, oldIndex, newIndex) };
      });
    }
  }

  function handleCardDragEnd(groupIds: DashboardCardId[]) {
    return (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const sorted = [...groupIds].sort((a, b) =>
        (dashboardPrefs.cards[a]?.order ?? groupIds.indexOf(a)) -
        (dashboardPrefs.cards[b]?.order ?? groupIds.indexOf(b))
      );
      const visible = sorted.filter(id => dashboardPrefs.cards[id]?.visible !== false);
      const oldIdx = visible.indexOf(active.id as DashboardCardId);
      const newIdx = visible.indexOf(over.id as DashboardCardId);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(visible, oldIdx, newIdx);
      const cards = { ...dashboardPrefs.cards };
      reordered.forEach((id, i) => { cards[id] = { ...cards[id], order: i }; });
      sorted.filter(id => dashboardPrefs.cards[id]?.visible === false)
        .forEach((id, i) => { cards[id] = { ...cards[id], order: reordered.length + i }; });
      setDashboardPrefs(prev => ({ ...prev, cards }));
    };
  }

  function hideCard(id: DashboardCardId) {
    setDashboardPrefs(prev => ({
      ...prev,
      cards: { ...prev.cards, [id]: { ...prev.cards[id], visible: false } },
    }));
  }

  function toggleChart(id: DashboardCardId) {
    setDashboardPrefs(prev => {
      const current = prev.cards[id]?.chart ?? 'sparkline';
      return {
        ...prev,
        cards: { ...prev.cards, [id]: { ...prev.cards[id], chart: current === 'sparkline' ? 'none' : 'sparkline' } },
      };
    });
  }

  // ── Copy layout modal ──────────────────────────────────────────────────────
  const [copyLayoutOpen, setCopyLayoutOpen] = useState(false);
  const [copyLayoutDest, setCopyLayoutDest] = useState<Set<string>>(new Set());

  function openCopyLayout() {
    setCopyLayoutDest(new Set());
    setCopyLayoutOpen(true);
  }

  function copyLayoutToClients() {
    const srcId = [...selectedIds][0];
    const srcSuffix = `__${srcId}`;
    const keysToClone = [
      LS_RGL_LAYOUT,
      LS_DASHBOARD_PREFS,
    ];
    for (const destId of copyLayoutDest) {
      const destSuffix = `__${destId}`;
      for (const key of keysToClone) {
        const val = localStorage.getItem(key + srcSuffix);
        if (val !== null) localStorage.setItem(key + destSuffix, val);
      }
    }
    setCopyLayoutOpen(false);
  }

  // Load preferences from localStorage — re-runs whenever the selected client changes
  useEffect(() => {
    if (selectedIds.size === 0) return;
    const suffix = lsClientSuffix(selectedIds);
    currentLsSuffixRef.current = suffix;

    // Reset to defaults first so switching clients never leaks one client's state into another
    setDashboardPrefs(DEFAULT_DASHBOARD_PREFS);
    setMetaKpiLayout(DEFAULT_META_KPI_LAYOUT);
    setGoogleKpiLayout(DEFAULT_GOOGLE_KPI_LAYOUT);
    setGeneralLayout(DEFAULT_GENERAL_LAYOUT);
    setMetaPanelsLayout(DEFAULT_META_PANELS_LAYOUT);
    setGooglePanelsLayout(DEFAULT_GOOGLE_PANELS_LAYOUT);
    setSocialKpiLayout(DEFAULT_SOCIAL_KPI_LAYOUT);


    try {
      const stored = localStorage.getItem(LS_DASHBOARD_PREFS + suffix);
      if (stored) setDashboardPrefs(mergeDashboardPrefs(JSON.parse(stored)));
    } catch {}

    try {
      const stored = localStorage.getItem(LS_RGL_LAYOUT + suffix);
      if (stored) {
        const parsed = JSON.parse(stored) as { meta?: RglLayout[]; google?: RglLayout[]; general?: RglLayout[]; metaPanels?: RglLayout[]; googlePanels?: RglLayout[]; social?: RglLayout[] };
        const merge = (setter: React.Dispatch<React.SetStateAction<RglLayout[]>>, saved?: RglLayout[]) => {
          if (saved) setter(prev => prev.map(item => {
            const s = saved.find(l => l.i === item.i);
            return s ? { ...item, x: s.x, y: s.y, w: s.w, h: s.h } : item;
          }));
        };
        merge(setMetaKpiLayout, parsed.meta);
        merge(setGoogleKpiLayout, parsed.google);
        merge(setGeneralLayout, parsed.general);
        merge(setMetaPanelsLayout, parsed.metaPanels);
        merge(setGooglePanelsLayout, parsed.googlePanels);
        merge(setSocialKpiLayout, parsed.social);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // Save — always write to the key that was active when this client was loaded
  useEffect(() => {
    if (!currentLsSuffixRef.current && selectedIds.size === 0) return;
    localStorage.setItem(LS_DASHBOARD_PREFS + currentLsSuffixRef.current, JSON.stringify(dashboardPrefs));
  }, [dashboardPrefs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!currentLsSuffixRef.current && selectedIds.size === 0) return;
    try {
      localStorage.setItem(LS_RGL_LAYOUT + currentLsSuffixRef.current, JSON.stringify({ meta: metaKpiLayout, google: googleKpiLayout, general: generalLayout, metaPanels: metaPanelsLayout, googlePanels: googlePanelsLayout, social: socialKpiLayout }));
    } catch {}
  }, [metaKpiLayout, googleKpiLayout, generalLayout, metaPanelsLayout, googlePanelsLayout, socialKpiLayout]); // eslint-disable-line react-hooks/exhaustive-deps
  // customizerOpen available to all users

  // Initialize: pre-select from ?client=ID param, otherwise start empty (force client picker)
  useEffect(() => {
    if (clients.length === 0) return;
    const clientIds = new Set(clients.map(c => c.id));
    const preselect = new URLSearchParams(window.location.search).get('client');
    setSelectedIds((current) => {
      if (preselect && clientIds.has(preselect)) return new Set([preselect]);
      const valid = [...current].filter((id) => clientIds.has(id));
      return new Set(valid);
    });
  }, [clients]);

  // Load goals + planning: localStorage fallback, then DB as source of truth
  useEffect(() => {
    if (clients.length === 0) return;
    const g: Record<string, GoalConfig | null> = {};
    const p: Record<string, PlanningConfig> = {};
    for (const c of clients) {
      g[c.id] = readGoalFromStorage(c.id);
      p[c.id] = readPlanningFromStorage(c.id);
    }
    setGoalsByClient(g);
    setPlanningsByClient(p);

    const ids = clients.map(c => c.id).join(',');
    fetch(`/api/clients/bulk-settings?clientIds=${ids}`)
      .then(r => r.json())
      .then((data: { goals: Record<string, GoalConfig>; planning: Record<string, { tkm: number; cplMeta: number; stages: FunnelStage[] }> }) => {
        if (Object.keys(data.goals).length > 0) {
          setGoalsByClient(prev => ({ ...prev, ...data.goals }));
        }
        if (Object.keys(data.planning).length > 0) {
          const dbPlanning: Record<string, PlanningConfig> = {};
          for (const [id, raw] of Object.entries(data.planning)) {
            dbPlanning[id] = {
              tkm: raw.tkm || DEFAULT_PLANNING.tkm,
              cplMeta: raw.cplMeta || DEFAULT_PLANNING.cplMeta,
              stages: Array.isArray(raw.stages) && raw.stages.length >= 2 ? raw.stages : DEFAULT_STAGES,
            };
          }
          setPlanningsByClient(prev => ({ ...prev, ...dbPlanning }));
        }
      })
      .catch(() => {});
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
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null, crm: null };
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

  // Fetch previous period metrics for comparison
  useEffect(() => {
    let cancelled = false;
    setPrevMetricsByClient({});
    if (selectedIds.size === 0 || !customReady) return () => { cancelled = true; };
    const { from, to } = periodToDateRange(period, customDateFrom, customDateTo);
    const durationMs = to.getTime() - from.getTime() + 86400000;
    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - durationMs + 86400000);
    const prevParams = `period=custom&dateFrom=${prevFrom.toISOString().split('T')[0]}&dateTo=${prevTo.toISOString().split('T')[0]}`;
    const ids = [...selectedIds];
    Promise.allSettled(
      ids.map(async (id) => {
        const res = await fetch(`/api/clients/${id}/metrics?${prevParams}`);
        if (cancelled) return null;
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null, crm: null };
        return [id, data] as const;
      })
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, ApiMetrics> = {};
      for (const r of results) if (r.status === 'fulfilled' && r.value !== null) map[r.value[0]] = r.value[1];
      setPrevMetricsByClient(map);
    });
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

  // Fetch top keywords (Google Ads)
  useEffect(() => {
    let cancelled = false;
    setKeywordsLoading(true);
    setKeywords([]);
    if (selectedIds.size === 0 || !customReady) {
      setKeywordsLoading(false);
      return () => { cancelled = true; };
    }
    const params = buildPeriodParams({ limit: '30', clientIds: [...selectedIds].join(',') });
    fetch(`/api/google/keywords?${params.toString()}`)
      .then(res => res.ok ? res.json() as Promise<GoogleKeyword[]> : [])
      .then(data => { if (!cancelled) setKeywords(data); })
      .catch(() => { if (!cancelled) setKeywords([]); })
      .finally(() => { if (!cancelled) setKeywordsLoading(false); });
    return () => { cancelled = true; };
  }, [period, selectedIds, customDateFrom, customDateTo, customReady]);

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
        const age = googleRes.headers.get('X-Cache-Age');
        if (age !== null) setDataCacheAge(Number(age));
      })
      .catch(() => {
        setBalances([]);
        setClientLinks([]);
      })
      .finally(() => setBalancesLoading(false));
  }, []);

  useEffect(() => {
    const { from, to } = periodToDateRange(period, customDateFrom, customDateTo);
    const params = new URLSearchParams({ from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] });
    fetch(`/api/crm/summary?${params}`)
      .then(r => r.ok ? r.json() as Promise<{ clientId: string; entries: FunnelEntry[]; stages: string[] }[]> : [])
      .then(data => {
        const map: Record<string, ClientSheetsSummary> = {};
        for (const item of data) map[item.clientId] = { entries: item.entries, stages: item.stages };
        setCrmSummary(map);
      })
      .catch(() => setCrmSummary({}));
  }, [period, customDateFrom, customDateTo]);

  // Load saved AI insights when clients/period change
  useEffect(() => {
    if (selectedIds.size === 0 || !customReady) { setAiInsights([]); return; }
    const params = new URLSearchParams({ clientIds: [...selectedIds].join(','), period });
    if (period === 'custom' && customDateFrom && customDateTo) {
      params.set('period', `custom:${customDateFrom}:${customDateTo}`);
    }
    fetch(`/api/ai/insights?${params}`)
      .then(r => r.ok ? r.json() as Promise<AiInsight[]> : [])
      .then(setAiInsights)
      .catch(() => setAiInsights([]));
  }, [selectedIds, period, customDateFrom, customDateTo, customReady]);

  // Fetch page/profile insights (Facebook Page + Instagram organic)
  useEffect(() => {
    let cancelled = false;
    setPageInsightsLoading(true);
    setPageInsights([]);
    setPrevPageInsights([]);
    if (selectedIds.size === 0 || !customReady) {
      setPageInsightsLoading(false);
      return () => { cancelled = true; };
    }
    const { from, to } = periodToDateRange(period, customDateFrom, customDateTo);
    const durationMs = to.getTime() - from.getTime() + 86400000;
    const prevTo = new Date(from.getTime() - 86400000);
    const prevFrom = new Date(prevTo.getTime() - durationMs + 86400000);
    const params = new URLSearchParams({
      clientIds: [...selectedIds].join(','),
      from: from.toISOString().split('T')[0],
      to: to.toISOString().split('T')[0],
    });
    const prevParams = new URLSearchParams({
      clientIds: [...selectedIds].join(','),
      from: prevFrom.toISOString().split('T')[0],
      to: prevTo.toISOString().split('T')[0],
    });
    Promise.all([
      fetch(`/api/meta/page-insights?${params}`).then(r => r.ok ? r.json() as Promise<PageInsightsResult[]> : []),
      fetch(`/api/meta/page-insights?${prevParams}`).then(r => r.ok ? r.json() as Promise<PageInsightsResult[]> : []),
    ]).then(([cur, prev]) => {
      console.log('[page-insights] current', cur);
      console.log('[page-insights] prev', prev);
      if (!cancelled) { setPageInsights(cur); setPrevPageInsights(prev); }
    }).catch(() => {
      if (!cancelled) { setPageInsights([]); setPrevPageInsights([]); }
    }).finally(() => { if (!cancelled) setPageInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady]);

  // Fetch Instagram top posts
  useEffect(() => {
    if (selectedIds.size === 0 || !customReady) { setIgPosts([]); return; }
    setIgPostsLoading(true);
    const params = buildPeriodParams({ clientIds: [...selectedIds].join(','), limit: '24', sortBy: igSortBy });
    fetch(`/api/meta/ig-posts?${params}`)
      .then(r => r.ok ? r.json() as Promise<IgPost[]> : [])
      .then(data => setIgPosts(data))
      .catch(() => setIgPosts([]))
      .finally(() => setIgPostsLoading(false));
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, igSortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-fit panel heights to content ────────────────────────────────────
  // Each effect fires once per (client × period) context. User can expand manually within that session;
  // switching client or period resets to content-snug height.
  // The "FetchStarted" refs guard against the initial-mount false-positive where loading=false
  // but data hasn't been fetched yet — we only auto-resize after a real fetch cycle completes.
  useEffect(() => {
    const key = `${selectedKey}:${period}:${customDateFrom}:${customDateTo}`;
    if (campaignsLoading) campaignsFetchStartedRef.current = key;
    if (creativesLoading) creativesFetchStartedRef.current = key;
    if (campaignsLoading || creativesLoading || selectedIds.size === 0) return;
    if (campaignsFetchStartedRef.current !== key || creativesFetchStartedRef.current !== key) return;
    if (metaPanelsResizeKeyRef.current === key) return;
    metaPanelsResizeKeyRef.current = key;
    const mCount = campaigns.filter(c => c.platform === 'meta').length;
    const cCount = creatives.length;
    setMetaPanelsLayout(prev => prev.map(item => {
      const minH = item.minH ?? 2;
      if (item.i === 'meta-campaigns')        return { ...item, h: tableAutoH(mCount, minH) };
      if (item.i === 'meta-creative-preview') return { ...item, h: creativesGridAutoH(cCount, minH) };
      return item;
    }));
  }, [campaignsLoading, creativesLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = `${selectedKey}:${period}:${customDateFrom}:${customDateTo}`;
    if (campaignsLoading) campaignsFetchStartedRef.current = key;
    if (keywordsLoading) keywordsFetchStartedRef.current = key;
    if (campaignsLoading || keywordsLoading || selectedIds.size === 0) return;
    if (campaignsFetchStartedRef.current !== key || keywordsFetchStartedRef.current !== key) return;
    if (googlePanelsResizeKeyRef.current === key) return;
    googlePanelsResizeKeyRef.current = key;
    const gCount = campaigns.filter(c => c.platform === 'google').length;
    const kCount = keywords.length;
    setGooglePanelsLayout(prev => prev.map(item => {
      const minH = item.minH ?? 2;
      if (item.i === 'google-campaigns') return { ...item, h: tableAutoH(gCount, minH) };
      if (item.i === 'google-keywords')  return { ...item, h: kwAutoH(kCount, minH) };
      return item;
    }));
  }, [campaignsLoading, keywordsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = `${selectedKey}:${period}:${customDateFrom}:${customDateTo}`;
    if (igPostsLoading) igPostsFetchStartedRef.current = key;
    if (igPostsLoading || selectedIds.size === 0) return;
    if (igPostsFetchStartedRef.current !== key) return;
    if (socialResizeKeyRef.current === key) return;
    socialResizeKeyRef.current = key;
    setSocialKpiLayout(prev => prev.map(item => {
      const minH = item.minH ?? 3;
      if (item.i === 'social-ig-top-posts') return { ...item, h: igPostsGridAutoH(igPosts.length, minH) };
      return item;
    }));
  }, [igPostsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Aggregate metrics ────────────────────────────────────────────────────
  let metaLeads = 0, metaFormLeads = 0, metaSiteLeads = 0, metaConversations = 0, metaSpend = 0, metaReach = 0, metaImpressions = 0, metaClicks = 0;
  let googleConv = 0, googleCost = 0;

  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.meta) {
      metaLeads += m.meta.leads;
      metaFormLeads += m.meta.formLeads ?? 0;
      metaSiteLeads += m.meta.siteLeads ?? 0;
      metaConversations += m.meta.conversations ?? 0;
      metaSpend += m.meta.spend;
      metaReach += m.meta.reach ?? 0;
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
  const ctrPlatformCount = (metaCtr > 0 ? 1 : 0) + (googleCtrValue > 0 ? 1 : 0);
  const avgCtr = ctrPlatformCount > 0 ? (metaCtr + googleCtrValue) / ctrPlatformCount : 0;
  const selectedRange = periodToDateRange(period, customDateFrom, customDateTo);
  const selectedDateKeys = dateKeysInRange(selectedRange.from, selectedRange.to);
  const dailySeries = aggregateDailySeries(metricsByClient, selectedIds, selectedDateKeys);
  const metaSpendSeries = cumulative(dailySeries.map((row) => row.meta?.spend ?? 0));
  const metaReachSeries = cumulative(dailySeries.map((row) => row.meta?.reach ?? 0));
  const metaImpressionsSeries = cumulative(dailySeries.map((row) => row.meta?.impressions ?? 0));
  const metaClicksSeries = cumulative(dailySeries.map((row) => row.meta?.clicks ?? 0));
  const metaLeadsSeries = cumulative(dailySeries.map((row) => row.meta?.leads ?? 0));
  const metaCplSeries = ratioSeries(
    dailySeries.map((row) => row.meta?.spend ?? 0),
    dailySeries.map((row) => row.meta?.leads ?? 0),
  );
  const metaCtrSeries = ratioSeries(
    dailySeries.map((row) => row.meta?.clicks ?? 0),
    dailySeries.map((row) => row.meta?.impressions ?? 0),
    100,
  );
  const googleCostSeries = cumulative(dailySeries.map((row) => row.google?.cost ?? 0));
  const googleImpressionsSeries = cumulative(dailySeries.map((row) => row.google?.impressions ?? 0));
  const googleClicksSeries = cumulative(dailySeries.map((row) => row.google?.clicks ?? 0));
  const googleConversionsSeries = cumulative(dailySeries.map((row) => row.google?.conversions ?? 0));
  const googleCpaSeries = ratioSeries(
    dailySeries.map((row) => row.google?.cost ?? 0),
    dailySeries.map((row) => row.google?.conversions ?? 0),
  );
  const googleCtrSeries = ratioSeries(
    dailySeries.map((row) => row.google?.clicks ?? 0),
    dailySeries.map((row) => row.google?.impressions ?? 0),
    100,
  );
  const googleCpcSeries = ratioSeries(
    dailySeries.map((row) => row.google?.cost ?? 0),
    dailySeries.map((row) => row.google?.clicks ?? 0),
  );
  const revenueSeries = cumulative(dailySeries.map((row) => row.crm?.revenue ?? 0));
  const totalLeadsSeries = dailySeries.map((_, index) => (metaLeadsSeries[index] ?? 0) + (googleConversionsSeries[index] ?? 0));
  const totalSpendSeries = dailySeries.map((_, index) => (metaSpendSeries[index] ?? 0) + (googleCostSeries[index] ?? 0));
  const cplSeries = totalSpendSeries.map((spend, index) => (totalLeadsSeries[index] ?? 0) > 0 ? spend / totalLeadsSeries[index] : 0);
  const roiSeries = totalSpendSeries.map((spend, index) => spend > 0 ? (revenueSeries[index] ?? 0) / spend : 0);
  const avgCtrSeries = dailySeries.map((_, index) => {
    const values = [metaCtrSeries[index] ?? 0, googleCtrSeries[index] ?? 0].filter(value => value > 0);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  });
  const seriesOrPacing = (series: number[], total: number) => series.some(value => value > 0) ? series : pacingSeries(total, Math.max(2, selectedDateKeys.length || 2));

  // ── Aggregate planning ───────────────────────────────────────────────────
  let leadsGoal = 0;
  let plannedInvestment = 0;
  let revenueGoal = 0;
  let plannedRevenue = 0;
  // CRM data (already filtered by period from the server)
  const summaryRevenue = [...selectedIds].reduce((sum, id) =>
    sum + (crmSummary[id]?.entries ?? []).reduce((s, e) => s + (e.amount ?? 0), 0), 0);
  const metricsRevenue = [...selectedIds].reduce((sum, id) => sum + (metricsByClient[id]?.crm?.revenue ?? 0), 0);
  const revenue = metricsRevenue > 0 ? metricsRevenue : summaryRevenue;

  const FUNNEL_ORDER = ['Atendimento', 'Agendamento', 'Comparecimento', 'Fechamento'];
  const funnelCounts: Record<string, number> = {};
  for (const id of selectedIds) {
    for (const entry of crmSummary[id]?.entries ?? []) {
      funnelCounts[entry.stage] = (funnelCounts[entry.stage] ?? 0) + 1;
    }
  }
  const funnelStages = FUNNEL_ORDER.filter(s => funnelCounts[s] !== undefined);
  const hasFunnelData = funnelStages.length > 0;

  let plannedSalesTotal = 0;
  for (const id of selectedIds) {
    const goal = goalsByClient[id];
    const planning = planningsByClient[id] ?? readPlanningFromStorage(id);
    const plannedFunnel = plannedFunnelFromGoal(goal, planning);
    const topVolume = plannedFunnel[0] ?? 0;
    leadsGoal += topVolume;
    plannedInvestment += topVolume * planning.cplMeta;
    const plannedSales = plannedFunnel[plannedFunnel.length - 1] ?? 0;
    plannedSalesTotal += plannedSales;
    const clientRevenueGoal = goal?.type === 'revenue' ? goal.target : plannedSales * planning.tkm;
    plannedRevenue += clientRevenueGoal;
    if (goal?.type === 'revenue') revenueGoal += goal.target;
  }
  const crmSales = [...selectedIds].reduce((s, id) => s + (metricsByClient[id]?.crm?.sales ?? 0), 0);
  const crmLeads = [...selectedIds].reduce((s, id) => s + (metricsByClient[id]?.crm?.leads ?? 0), 0);
  const avgCrmTicket = crmSales > 0 ? revenue / crmSales : 0;
  const plannedSalesPartial = autoPartial(plannedSalesTotal, period);
  const effectiveSalesGoal = plannedSalesPartial > 0 ? plannedSalesPartial : plannedSalesTotal;

  const revenuePartial = autoPartial(plannedRevenue, period);
  const leadsPartial = autoPartial(leadsGoal, period);
  const effectiveRevenueGoal = revenuePartial > 0 ? revenuePartial : plannedRevenue;
  const effectiveLeadsGoal = leadsPartial > 0 ? leadsPartial : leadsGoal;
  const cplGoal = leadsGoal > 0 ? plannedInvestment / leadsGoal : 0;
  const roiGoal = plannedInvestment > 0 && plannedRevenue > 0 ? plannedRevenue / plannedInvestment : 10;
  const roi = totalSpend > 0 ? revenue / totalSpend : 0;

  // Período anterior
  let prevMetaLeads = 0, prevMetaSpend = 0, prevGoogleConv = 0, prevGoogleCost = 0;
  for (const id of selectedIds) {
    const m = prevMetricsByClient[id];
    if (m?.meta) { prevMetaLeads += m.meta.leads; prevMetaSpend += m.meta.spend; }
    if (m?.google) { prevGoogleConv += m.google.conversions; prevGoogleCost += m.google.cost; }
  }
  const prevTotalLeads = prevMetaLeads + prevGoogleConv;
  const prevTotalSpend = prevMetaSpend + prevGoogleCost;
  const prevCpl = prevTotalLeads > 0 ? prevTotalSpend / prevTotalLeads : 0;
  const prevRoi = prevTotalSpend > 0 ? 0 / prevTotalSpend : 0;

  // Receita efetiva: usa CRM se disponível, senão estima via fechamentos × TKM médio
  let totalTkm = 0, tkmCount = 0;
  for (const id of selectedIds) {
    const planning = planningsByClient[id] ?? readPlanningFromStorage(id);
    if (planning.tkm > 0) { totalTkm += planning.tkm; tkmCount++; }
  }
  const avgTkm = tkmCount > 0 ? totalTkm / tkmCount : DEFAULT_PLANNING.tkm;
  const closings = funnelCounts['Fechamento'] ?? 0;
  const effectiveRevenue = revenue > 0 ? revenue : closings > 0 ? closings * avgTkm : 0;

  // Índice de qualidade (ROI / meta 10x) por plataforma
  const metaShare = totalLeads > 0 ? metaLeads / totalLeads : (metaSpend > 0 ? 1 : 0);
  const metaRevenue = effectiveRevenue * metaShare;
  const googleRevenue = effectiveRevenue * (1 - metaShare);
  const metaRoi = metaSpend > 0 ? metaRevenue / metaSpend : 0;
  const googleRoi = googleCost > 0 ? googleRevenue / googleCost : 0;
  const metaQuality = Math.min(Math.round((metaRoi / 10) * 100), 100);
  const googleQuality = googleCost > 0 ? Math.min(Math.round((googleRoi / 10) * 100), 100) : 0;

  function pctChange(current: number, prev: number): number | null {
    if (prev <= 0) return null;
    return ((current - prev) / prev) * 100;
  }
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
    const planning = planningsByClient[id] ?? readPlanningFromStorage(id);
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
  const metaCampaignSpend = metaCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  const googleCampaignSpend = googleCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  const activeMetaCampaigns = metaCampaigns.filter((campaign) => campaign.status === 'ACTIVE' || campaign.status === 'ENABLED').length;
  const activeGoogleCampaigns = googleCampaigns.filter((campaign) => campaign.status === 'ACTIVE' || campaign.status === 'ENABLED').length;
  const metaCreativeCount = creatives.length;
  const hasVisibleGeneralCards = CARD_GROUPS[0].ids.some(id => dashboardPrefs.cards[id]?.visible !== false);
  const hasVisibleMetaCards = CARD_GROUPS[1].ids.some(id => dashboardPrefs.cards[id]?.visible !== false);
  const hasVisibleGoogleCards = CARD_GROUPS[2].ids.some(id => dashboardPrefs.cards[id]?.visible !== false);
  const hasVisibleSocialCards = CARD_GROUPS[3].ids.some(id => dashboardPrefs.cards[id]?.visible !== false);
  const hasVisibleCrmCards = CARD_GROUPS[4].ids.some(id => dashboardPrefs.cards[id]?.visible !== false);
  const shouldRenderSocialSection = (pageInsightsLoading || pageInsights.some(p => p.facebook ?? p.instagram)) && hasVisibleSocialCards;
  const shouldRenderCrmSection = dashboardPrefs.showCrmPanel && selectedIds.size > 0 && hasVisibleCrmCards;

  async function analyzeWithAI() {
    if (selectedIds.size === 0) return;
    setAiLoading(true);
    setAiError('');
    try {
      const effectivePeriod = period === 'custom' && customDateFrom && customDateTo
        ? `custom:${customDateFrom}:${customDateTo}`
        : period;

      const metaPayload = metaSpend > 0 ? {
        spend: metaSpend, impressions: metaImpressions, clicks: metaClicks,
        leads: metaLeads, ctr: metaCtr, cpc: metaCpc, cpl: avgCpl,
      } : null;

      const googlePayload = googleCost > 0 ? {
        cost: googleCost, impressions: googleImpressions, clicks: googleClicks,
        conversions: googleConv, ctr: googleCtrValue, cpc: googleCpc, cpa: avgCpa,
      } : null;

      const res = await fetch('/api/ai/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientIds: [...selectedIds],
          clientNames: selectedClients.map(c => c.name),
          period: effectivePeriod,
          meta: metaPayload,
          google: googlePayload,
          topCreatives: creatives.slice(0, 5).map(c => ({
            name: c.adName ?? '',
            spend: c.spend ?? 0,
            leads: c.leads ?? 0,
            cpl: c.cpl ?? 0,
            impressions: c.impressions ?? 0,
          })),
        }),
      });
      const data = await res.json() as AiInsight[] | { error: string };
      if (!res.ok) { setAiError((data as { error: string }).error); return; }
      setAiInsights(data as AiInsight[]);
    } catch (e) {
      setAiError(String(e));
    } finally {
      setAiLoading(false);
    }
  }

  async function dismissInsight(id: string) {
    setAiInsights(prev => prev.filter(i => i.id !== id));
    await fetch('/api/ai/insights', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'dismissed' }),
    });
  }

  async function acceptInsight(id: string) {
    setAiInsights(prev => prev.map(i => i.id === id ? { ...i, status: 'accepted' } : i));
    await fetch('/api/ai/insights', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'accepted' }),
    });
  }

  const qualified = funnelCounts['Atendimento'] ?? 0;
  const appointments = funnelCounts['Agendamento'] ?? 0;
  const showUps = funnelCounts['Comparecimento'] ?? 0;
  const conversions = crmSales || funnelCounts['Fechamento'] || googleConv;
  const funnelVisitors = Math.max(metaReach + googleImpressions, totalLeads, conversions);
  const conversionRate = funnelVisitors > 0 ? (conversions / funnelVisitors) * 100 : 0;
  const previousConversionRate = prevTotalLeads > 0 ? ((conversions || totalLeads) / Math.max(prevTotalLeads, 1)) * 100 : null;
  const quickMetrics = [
    { title: 'Investimento Total', value: premiumValue(totalSpend, 'currency'), change: pctChange(totalSpend, prevTotalSpend), icon: CreditCard },
    { title: 'CPL Médio', value: totalCostPerLead > 0 ? premiumValue(totalCostPerLead, 'currency') : '—', change: pctChange(totalCostPerLead, prevCpl), icon: Tag },
    { title: 'Conversas', value: premiumValue(metaConversations || metaSiteLeads || 0), change: null, icon: MessageCircle },
    { title: 'Agendamentos', value: premiumValue(appointments), change: null, icon: Calendar },
    { title: 'ROI', value: roi > 0 ? premiumValue(roi, 'times') : '—', change: pctChange(roi, prevRoi), icon: TrendingUp },
    { title: 'Conversão Geral', value: conversionRate > 0 ? premiumValue(conversionRate, 'percent') : '—', change: previousConversionRate !== null ? pctChange(conversionRate, previousConversionRate) : null, icon: Target },
  ];
  const funnelSteps = [
    { label: 'Investimento', value: premiumValue(totalSpend, 'currency'), percent: '100%' },
    { label: 'Leads', value: premiumValue(totalLeads), percent: funnelVisitors > 0 ? premiumValue((totalLeads / funnelVisitors) * 100, 'percent') : '—' },
    { label: 'Qualificações', value: premiumValue(qualified), percent: totalLeads > 0 ? premiumValue((qualified / totalLeads) * 100, 'percent') : '—' },
    { label: 'Agendamentos', value: premiumValue(appointments), percent: qualified > 0 ? premiumValue((appointments / qualified) * 100, 'percent') : '—' },
    { label: 'Comparecimentos', value: premiumValue(showUps), percent: appointments > 0 ? premiumValue((showUps / appointments) * 100, 'percent') : '—' },
    { label: 'Conversões', value: premiumValue(conversions), percent: showUps > 0 ? premiumValue((conversions / showUps) * 100, 'percent') : '—' },
  ];
  const channelRows = [
    {
      channel: 'Meta Ads',
      investment: premiumValue(metaSpend, 'currency'),
      leads: premiumValue(metaLeads),
      cpl: avgCpl > 0 ? premiumValue(avgCpl, 'currency') : '—',
      conversion: metaReach > 0 ? premiumValue((metaLeads / metaReach) * 100, 'percent') : '—',
      status: metaLeads > 100 ? 'Excelente' as const : metaLeads > 0 ? 'Bom' as const : 'Neutro' as const,
      logo: <MetaAdsMark className="h-4 w-4 text-[#168BFF]" />,
    },
    {
      channel: 'Google Ads',
      investment: premiumValue(googleCost, 'currency'),
      leads: premiumValue(googleConv),
      cpl: avgCpa > 0 ? premiumValue(avgCpa, 'currency') : '—',
      conversion: googleClicks > 0 ? premiumValue((googleConv / googleClicks) * 100, 'percent') : '—',
      status: googleConv > 50 ? 'Excelente' as const : googleConv > 0 ? 'Bom' as const : 'Neutro' as const,
      logo: <GoogleAdsMark className="h-4 w-4" />,
    },
    {
      channel: 'Instagram Ads',
      investment: '—',
      leads: '—',
      cpl: '—',
      conversion: '—',
      status: 'Neutro' as const,
      logo: <span className="flex h-4 w-4 items-center justify-center rounded bg-pink-500/20 text-[9px] text-pink-300">IG</span>,
    },
    {
      channel: 'CRM / Orgânico',
      investment: '—',
      leads: premiumValue(crmLeads),
      cpl: '—',
      conversion: crmLeads > 0 ? premiumValue((crmSales / crmLeads) * 100, 'percent') : '—',
      status: crmLeads > 0 ? 'Bom' as const : 'Neutro' as const,
      logo: <span className="flex h-4 w-4 items-center justify-center rounded bg-[#6cff2f]/15 text-[9px] text-[#6cff2f]">CRM</span>,
    },
  ];

  return (
    <div className="-m-3 min-h-full bg-[#05090B] text-[#f4f7f8] sm:-m-6">
      {customizerOpen && (
        <MetricConfigPanel
          prefs={dashboardPrefs}
          onPrefsChange={setDashboardPrefs}
          onClose={() => setCustomizerOpen(false)}
        />
      )}

      <div className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#060a0d]/92 px-4 py-3 backdrop-blur-xl xl:px-6">
        <div className="flex items-center gap-3 overflow-x-auto">
          <ClientSelector clients={clients} selected={selectedIds} onChange={setSelectedIds} />
          <div className="flex items-center rounded-[10px] border border-white/[0.08] bg-[#0b1216] p-1">
            {PERIODS.filter(p => p.value !== 'yesterday').map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'rounded-md px-3 py-2 text-xs font-bold transition-colors',
                  period === p.value ? 'bg-[#6cff2f] text-black' : 'text-[#a7b0b6] hover:text-white'
                )}
              >
                {p.value === 'custom' ? <Calendar className="inline h-3.5 w-3.5" /> : p.label}
              </button>
            ))}
          </div>
          <span className="ml-auto inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#0b1216] px-3 py-2 text-xs font-semibold text-[#dce4e8]">
            <span className="h-2 w-2 rounded-full bg-[#6cff2f]" /> Ao vivo
          </span>
          <div className="relative hidden w-[240px] shrink-0 2xl:block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa4aa]" />
            <Input className="h-10 rounded-[10px] border-white/[0.08] bg-[#0b1216] pl-10 text-xs text-[#f4f7f8] placeholder:text-[#9aa4aa]" placeholder="Buscar clientes, relatórios..." />
          </div>
          <button type="button" className="rounded-[10px] border border-white/[0.08] bg-[#0b1216] px-4 py-2 text-xs font-bold text-[#f4f7f8] hover:border-[#6cff2f]/35">
            Exportar
          </button>
          <button type="button" className="relative rounded-full p-2 text-[#f4f7f8] hover:bg-white/[0.06]">
            <Bell className="h-5 w-5" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#6cff2f]" />
          </button>
          <Avatar className="h-9 w-9 border border-white/[0.08]">
            <AvatarFallback className="bg-[#78d957] text-sm font-black text-black">
              {(session?.name ?? 'M').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        {period === 'custom' && (
          <div className="mt-3 flex items-center gap-3">
            <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} className="h-9 rounded-lg border border-white/[0.08] bg-[#0b1216] px-3 text-xs text-[#f4f7f8] outline-none focus:border-[#6cff2f]" />
            <span className="text-xs text-[#9aa4aa]">até</span>
            <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} className="h-9 rounded-lg border border-white/[0.08] bg-[#0b1216] px-3 text-xs text-[#f4f7f8] outline-none focus:border-[#6cff2f]" />
          </div>
        )}
      </div>

      <div className="px-5 py-6 xl:px-8">
        {selectedIds.size === 0 && clients.length > 0 ? (
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-8 py-16">
            <div className="text-center">
              <h2 className="text-2xl font-black text-[#f4f7f8]">Escolha um cliente</h2>
              <p className="mt-2 text-sm text-[#9aa4aa]">Selecione para abrir o dashboard executivo.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {clients.map(c => (
                <button key={c.id} type="button" onClick={() => setSelectedIds(new Set([c.id]))} className="rounded-[14px] border border-white/[0.08] bg-[#0d1519] px-4 py-6 text-center transition hover:border-[#6cff2f]/45 hover:bg-[#102018]">
                  <ClientAvatar clientId={c.id} name={c.name} size="lg" />
                  <p className="mt-3 truncate text-sm font-black text-[#f4f7f8]">{c.name}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {aiError && <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">{aiError}</div>}
            {!metricsLoading && alerts.length > 0 && (
              <div className="rounded-xl border border-amber-400/20 bg-amber-400/8 px-4 py-3 text-xs text-amber-200">
                {alerts.length} alerta{alerts.length > 1 ? 's' : ''} fora do padrão neste período.
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-2">
              <GoalProgressCard title="Faturamento" icon={DollarSign} target={plannedRevenue} partial={effectiveRevenueGoal} value={revenue} format="currency" />
              <GoalProgressCard title="Leads" icon={Users} target={leadsGoal} partial={effectiveLeadsGoal} value={totalLeads} />
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {quickMetrics.map((metric) => <QuickMetricCard key={metric.title} {...metric} />)}
            </div>

            <PremiumPanel className="p-4">
              <h3 className="mb-4 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Saldos e Métricas de Alcance</h3>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.06em] text-[#f4f7f8]"><MetaAdsMark className="h-5 w-5 text-[#168BFF]" /> Meta Ads</div>
                  <div className="grid gap-2 sm:grid-cols-5">
                    <MiniPlatformMetric label="Saldo Meta Ads" value={metaBalance > 0 ? premiumValue(metaBalance, 'currency') : '—'} logo={<MetaAdsMark className="h-4 w-4 text-[#168BFF]" />} sub="Saldo disponível" />
                    <MiniPlatformMetric label="Alcance Meta" value={premiumValue(metaReach)} icon={Users} />
                    <MiniPlatformMetric label="Impressões Meta" value={premiumValue(metaImpressions)} icon={BarChart3} />
                    <MiniPlatformMetric label="CTR Meta" value={premiumValue(metaCtr, 'percent')} icon={MousePointerClick} />
                    <MiniPlatformMetric label="CPL Meta" value={avgCpl > 0 ? premiumValue(avgCpl, 'currency') : '—'} icon={Tag} />
                  </div>
                </div>
                <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.06em] text-[#f4f7f8]"><GoogleAdsMark className="h-5 w-5" /> Google Ads</div>
                  <div className="grid gap-2 sm:grid-cols-5">
                    <MiniPlatformMetric label="Saldo Google Ads" value={googleBalance > 0 ? premiumValue(googleBalance, 'currency') : '—'} logo={<GoogleAdsMark className="h-4 w-4" />} sub="Saldo disponível" />
                    <MiniPlatformMetric label="Alcance Google" value="—" icon={Users} />
                    <MiniPlatformMetric label="Impressões Google" value={premiumValue(googleImpressions)} icon={BarChart3} />
                    <MiniPlatformMetric label="Cliques Google" value={premiumValue(googleClicks)} icon={MousePointerClick} />
                    <MiniPlatformMetric label="CTR Google" value={premiumValue(googleCtrValue, 'percent')} icon={Target} />
                  </div>
                </div>
              </div>
            </PremiumPanel>

            <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
              <SimpleFunnel steps={funnelSteps} totalRate={conversionRate > 0 ? premiumValue(conversionRate, 'percent') : '—'} metaRate={roiGoal > 0 ? premiumValue(Math.min(100, roiGoal), 'percent') : '—'} previousRate={previousConversionRate !== null ? premiumValue(Math.abs(previousConversionRate), 'percent') : '—'} />
              <ChannelSummaryTable rows={channelRows} />
            </div>

            {/* ── Meta Ads: criativos + campanhas com veiculação ── */}
            <PremiumPanel className="border-[#168BFF]/28 shadow-[0_0_40px_rgba(22,139,255,0.12)]">
              <div className="flex items-center justify-between px-4 pt-4 pb-3">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">
                  <MetaAdsMark className="h-5 w-5 text-[#168BFF]" /> Meta Ads
                </h3>
                <Link href="/resultados" className="text-xs font-black text-[#6cff2f] hover:text-[#8bff50] transition-colors">Ver todas</Link>
              </div>

              {/* Melhores Criativos — scroll horizontal, full-width */}
              <div className="px-4 pb-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
                  Melhores Criativos <Info className="h-3.5 w-3.5 text-[#9aa4aa]" />
                </div>
                <CreativeHorizontalStrip creatives={creatives} loading={creativesLoading} onPreview={setPreviewCreative} />
              </div>

              {/* Campanhas com Veiculação — abaixo dos criativos */}
              <div className="border-t border-white/[0.06] px-4 py-4">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
                  Campanhas com Veiculação
                </div>
                <CompactCampaignTable campaigns={metaCampaigns} loading={campaignsLoading} platform="meta" />
              </div>
            </PremiumPanel>

            {/* ── Google Ads: campanhas + keywords ── */}
            <PremiumPanel className="border-[#4285F4]/24 p-4 shadow-[0_0_40px_rgba(66,133,244,0.10)]">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">
                  <GoogleAdsMark className="h-5 w-5" /> Google Ads
                </h3>
                <Link href="/resultados" className="text-xs font-black text-[#6cff2f] hover:text-[#8bff50] transition-colors">Ver todas</Link>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-3 flex items-center justify-between text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
                    <span>Top Campanhas Google</span>
                  </div>
                  <CompactCampaignTable campaigns={googleCampaigns} loading={campaignsLoading} platform="google" />
                </div>
                <div>
                  <div className="mb-3 flex items-center justify-between text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">
                    <span>Top Palavras-chave</span>
                  </div>
                  <CompactKeywordTable keywords={keywords} loading={keywordsLoading} />
                </div>
              </div>
            </PremiumPanel>

            {selectedClients.length > 1 && (
              <PremiumPanel className="p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]">Resumo por cliente</p>
                <div className="divide-y divide-white/[0.07]">
                  {selectedClients.map(client => {
                    const m = metricsByClient[client.id];
                    const leads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
                    const spend = (m?.meta?.spend ?? 0) + (m?.google?.cost ?? 0);
                    return (
                      <div key={client.id} className="flex items-center justify-between gap-4 py-3 text-xs text-[#a7b0b6]">
                        <Link href={`/clientes/${client.id}`} className="font-black text-[#f4f7f8] hover:text-[#6cff2f]">{client.name}</Link>
                        <span>{premiumValue(leads)} leads</span>
                        <span>{spend > 0 ? premiumValue(spend, 'currency') : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </PremiumPanel>
            )}
          </div>
        )}
      </div>

      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />
    </div>
  );

  return (
    <div className="space-y-6 pb-10">
      {customizerOpen && (
        <MetricConfigPanel
          prefs={dashboardPrefs}
          onPrefsChange={setDashboardPrefs}
          onClose={() => setCustomizerOpen(false)}
        />
      )}

      {/* Copy layout modal */}
      {copyLayoutOpen && selectedIds.size === 1 && (() => {
        const srcClient = clients.find(c => selectedIds.has(c.id));
        const otherClients = clients.filter(c => !selectedIds.has(c.id));
        const allSelected = copyLayoutDest.size === otherClients.length;
        return createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]">
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
                <div>
                  <h2 className="text-sm font-bold">Copiar layout</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    De <span className="font-semibold text-foreground">{srcClient?.name}</span> para:
                  </p>
                </div>
                <button onClick={() => setCopyLayoutOpen(false)} className="text-muted-foreground hover:text-foreground p-1">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-5 pt-3 pb-2 border-b border-border shrink-0 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">{copyLayoutDest.size} de {otherClients.length} selecionado{copyLayoutDest.size !== 1 ? 's' : ''}</span>
                <button
                  onClick={() => setCopyLayoutDest(allSelected ? new Set() : new Set(otherClients.map(c => c.id)))}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  {allSelected ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1 min-h-0">
                {otherClients.map(c => {
                  const checked = copyLayoutDest.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCopyLayoutDest(prev => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
                        checked ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/40 border border-transparent'
                      )}
                    >
                      <div className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0', checked ? 'bg-primary border-primary' : 'border-border')}>
                        {checked && <Check className="h-3 w-3 text-black" />}
                      </div>
                      <ClientAvatar clientId={c.id} name={c.name} size="sm" />
                      <span className="font-medium truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>

              <div className="px-5 pb-5 pt-3 border-t border-border shrink-0 flex gap-2 justify-end">
                <button
                  onClick={() => setCopyLayoutOpen(false)}
                  className="px-4 py-2 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={copyLayoutToClients}
                  disabled={copyLayoutDest.size === 0}
                  className="px-4 py-2 rounded-xl bg-primary text-black text-sm font-bold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  Copiar para {copyLayoutDest.size > 0 ? `${copyLayoutDest.size} cliente${copyLayoutDest.size !== 1 ? 's' : ''}` : 'clientes'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* UNIFIED TOP BAR */}
      <div className="sticky top-0 z-20 -mx-6 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-1.5 px-4 h-14 overflow-x-auto">
          <BackButton />
          {/* Client selector */}
          <ClientSelector clients={clients} selected={selectedIds} onChange={setSelectedIds} />

          {/* Period buttons */}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1">
            {PERIODS.filter(p => p.value !== 'yesterday').map(p => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all',
                  period === p.value ? 'bg-primary text-black shadow-[0_0_10px_rgba(85,245,47,0.35)]' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.value === 'custom' && <Calendar className="h-3 w-3" />}
                {p.label}
              </button>
            ))}
          </div>

          {metricsLoading && <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}

          {!metricsLoading && dataCacheAge !== null && (
            <span
              title={dataCacheAge === 0 ? 'Dados recém-buscados da API' : `Dados em cache — buscados há ${Math.round((dataCacheAge ?? 0) / 60)} min. Atualizados automaticamente a cada 15 min.`}
              className="flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground cursor-default"
            >
              <Clock className="h-3 w-3" />
              {dataCacheAge === 0 ? 'Ao vivo' : `Cache · ${Math.round((dataCacheAge ?? 0) / 60)} min`}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <div className="relative hidden lg:block w-44 xl:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="Buscar clientes, relatórios..."
              className="pl-9 bg-muted/50 border-transparent focus-visible:ring-primary text-xs h-9"
            />
          </div>

          {/* AI button */}
          <button
            type="button"
            onClick={analyzeWithAI}
            disabled={aiLoading || selectedIds.size === 0 || metricsLoading}
            className="flex items-center gap-1.5 rounded-xl border border-violet-500/40 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-400 hover:bg-violet-500/25 transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {aiLoading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{aiLoading ? 'Analisando...' : 'Analisar com IA'}</span>
          </button>


          {/* Copy layout */}
          {selectedIds.size === 1 && (
            <button
              type="button"
              onClick={openCopyLayout}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors whitespace-nowrap"
              title="Copiar layout para outros clientes"
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Copiar layout</span>
            </button>
          )}

          {/* Metric customizer */}
          <button
            type="button"
            onClick={() => setCustomizerOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors whitespace-nowrap"
            title="Configurar métricas visíveis"
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Métricas</span>
          </button>

          {/* Theme + bell + user */}
          <ThemeToggle />
          <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="h-5 w-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
          </button>
          <div className="flex items-center gap-2.5 border-l border-border pl-3">
            <div className="hidden md:flex flex-col items-end leading-none gap-0.5">
              <span className="text-sm font-medium">{session?.name ?? 'Usuário'}</span>
              <span className="text-[11px] text-muted-foreground">{session?.role ?? ''}</span>
            </div>
            <Avatar className="h-8 w-8 border border-border">
              <AvatarImage src="" alt="User" />
              <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">
                {(session?.name ?? 'ON').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-3 px-6 pb-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Período</span>
            <input type="date" value={customDateFrom} onChange={e => setCustomDateFrom(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary" />
            <span className="text-xs text-muted-foreground">→</span>
            <input type="date" value={customDateTo} onChange={e => setCustomDateTo(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary" />
            {customReady && customDateFrom && customDateTo && <span className="text-[11px] font-semibold text-primary">Aplicado</span>}
          </div>
        )}
      </div>

      {/* ── CLIENT PICKER EMPTY STATE ── */}
      {selectedIds.size === 0 && clients.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-8">
          <div className="text-center">
            <h2 className="font-heading font-normal text-xl uppercase tracking-wide text-foreground">Escolha um cliente</h2>
            <p className="mt-2 text-sm text-muted-foreground">Selecione para abrir o dashboard</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-3xl w-full">
            {clients.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedIds(new Set([c.id]))}
                className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-6 hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <ClientAvatar clientId={c.id} name={c.name} size="lg" />
                <div className="text-center">
                  <p className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">{c.name}</p>
                  {(c.category_name ?? c.segment) && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">{c.category_name ?? c.segment}</p>
                  )}
                  {c.dashboard_type && (
                    <span className={cn(
                      'mt-1.5 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full uppercase',
                      c.dashboard_type === 'leads' ? 'text-violet-400 bg-violet-500/15' :
                      c.dashboard_type === 'branding' ? 'text-blue-400 bg-blue-500/15' :
                      'text-emerald-400 bg-emerald-500/15'
                    )}>
                      {c.dashboard_type === 'leads' ? 'Leads' : c.dashboard_type === 'branding' ? 'Branding' : 'Conversão'}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedIds.size > 0 && <DashboardEditCtx.Provider value={{ editMode, hideCard, toggleChart }}>

      {/* AI RECOMMENDATIONS */}
      <AiRecommendationsBox insights={aiInsights} loading={aiLoading} onAnalyze={analyzeWithAI} />

      {/* AI ERROR */}
      {aiError && (
        <div className="rounded-xl border border-red-400/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{aiError}</div>
      )}

      {/* ALERTS (sem IA) */}
      {!metricsLoading && alerts.length > 0 && !aiInsights.length && (
        <div className="rounded-xl border border-orange-400/30 bg-orange-500/5 overflow-hidden">
          <button type="button" onClick={toggleAlertsCollapsed} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-orange-500/5 transition-colors">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-400 shrink-0" />
              <p className="text-sm font-bold text-orange-400">{alerts.length} alerta{alerts.length > 1 ? 's' : ''} fora do padrão</p>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-orange-400/60 shrink-0 transition-transform', alertsCollapsed && '-rotate-90')} />
          </button>
          {!alertsCollapsed && (
            <div className="border-t border-orange-400/15 px-4 pb-3 pt-2 space-y-1.5">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', a.severity === 'critical' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-orange-500/15 text-orange-400 border-orange-500/30')}>
                    {a.severity === 'critical' ? 'Crítico' : 'Atenção'}
                  </span>
                  <div className="text-xs">
                    <Link href={`/clientes/${a.clientId}`} className="font-bold hover:text-primary transition-colors">{a.clientName}</Link>
                    <span className="text-muted-foreground"> — {a.msg}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={dashboardPrefs.sectionOrder} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-6">

      {/* 1. MÉTRICAS GERAIS */}
      {hasVisibleGeneralCards && <SortableSection id="geral" editMode={editMode} orderIndex={dashboardPrefs.sectionOrder.indexOf('geral')}>
      <section className="relative overflow-hidden rounded-2xl border border-[#55F52F]/55 bg-[#050C0A] p-5 shadow-[0_0_56px_rgba(85,245,47,0.22)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(85,245,47,0.16),transparent_38%),radial-gradient(circle_at_92%_8%,rgba(85,245,47,0.28),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#55F52F,transparent)]" />
        <div className="relative mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#55F52F]/70 bg-[#55F52F]/25 text-primary shadow-[0_0_24px_rgba(85,245,47,0.65)]">
              <LayoutDashboard className="h-[18px] w-[18px]" />
            </span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Métricas Gerais</h2>
              <p className="text-[11px] text-foreground/60">Consolidado do período antes da leitura por canal.</p>
            </div>
          </div>
          <button type="button" onClick={() => toggleSection('geral')} className="flex items-center gap-1 rounded-lg border border-[#55F52F]/30 bg-[#55F52F]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#55F52F]/80 hover:bg-[#55F52F]/20 transition-colors">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsedSections.has('geral') && '-rotate-90')} />
            {collapsedSections.has('geral') ? 'Expandir' : 'Recolher'}
          </button>
        </div>
        {!collapsedSections.has('geral') && (() => {
          const generalCards: Record<string, ReactNode> = {
            'general-revenue': <TargetSummaryCard title="Faturamento" value={revenue} partial={effectiveRevenueGoal} target={plannedRevenue} format="currency" accent="#22c55e" icon={DollarSign} />,
            'general-leads':   <TargetSummaryCard title="Leads" value={totalLeads} partial={effectiveLeadsGoal} target={leadsGoal} format="number" accent="#22c55e" icon={Users} />,
            'general-roi':     <KpiCard title="ROI" value={roi} prevValue={prevRoi > 0 ? prevRoi : undefined} goalValue={roiGoal > 0 ? roiGoal : undefined} format="times" icon={TrendingUp} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} chart={dashboardPrefs.cards['general-roi'].chart} series={seriesOrPacing(roiSeries, roi)} />,
            'general-cpl':     <KpiCard title="CPL Geral" value={totalCostPerLead} prevValue={prevCpl > 0 ? prevCpl : undefined} goalValue={cplGoal > 0 ? cplGoal : undefined} format="currency" icon={Tag} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} inverseGoal inverseChange chart={dashboardPrefs.cards['general-cpl'].chart} series={seriesOrPacing(cplSeries, totalCostPerLead)} />,
            'general-ctr':     <KpiCard title="CTR Geral" value={avgCtr} format="percent" icon={MousePointerClick} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} chart={dashboardPrefs.cards['general-ctr'].chart} series={seriesOrPacing(avgCtrSeries, avgCtr)} />,
            'general-spend':   <KpiCard title="Valor Investido" value={totalSpend} format="currency" icon={CreditCard} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={metricsLoading} chart={dashboardPrefs.cards['general-spend'].chart} series={seriesOrPacing(totalSpendSeries, totalSpend)} />,
            'general-crm': <CrmResultCard
              revenue={revenue}
              revenueGoal={plannedRevenue}
              revenuePartial={effectiveRevenueGoal}
              sales={crmSales}
              salesGoal={plannedSalesTotal}
              salesPartial={effectiveSalesGoal}
              ticket={avgCrmTicket}
            />,
            'general-funnel':
            (() => {
              const crmValues = [
                totalLeads,
                funnelCounts[FUNNEL_ORDER[0]] ?? 0,
                funnelCounts[FUNNEL_ORDER[1]] ?? 0,
                funnelCounts[FUNNEL_ORDER[2]] ?? 0,
                funnelCounts[FUNNEL_ORDER[3]] ?? 0,
              ];
              const labels = ['VISITANTES', 'LEADS', 'QUALIFICADOS', 'AGENDAMENTOS', 'COMPARECIMENTOS'];
              const values = [
                Math.max((metaReach || metaImpressions) + googleImpressions, totalLeads),
                totalLeads,
                ...crmValues.slice(1),
              ];
              const colors = ['#14B8FF', '#9B5CFF', '#F03A9C', '#FF7A00', '#35E84B'];
              const icons = [Users, UserPlus, CheckCircle2, Calendar, Users];
              const rows = labels.slice(0, 5).map((label, index) => ({
                label,
                value: values[index] ?? 0,
                color: colors[index],
                Icon: icons[index],
              }));

              return (
                <DashboardPerformanceFunnel
                  periodLabel={PERIODS.find(p => p.value === period)?.label ?? period}
                  rows={rows}
                />
              );
            })(),
          };
          const visibleLayout = generalLayout.filter(l => dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false);
          return (
            <RglGrid
              layout={visibleLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setGeneralLayout(prev => prev.map(item => { const u = nl.find(l => l.i === item.i); return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item; }))}
            >
              {visibleLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {generalCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>
          );
        })()}

      </section>
      </SortableSection>}

      {/* 2. META ADS */}
      {hasVisibleMetaCards && <SortableSection id="meta" editMode={editMode} orderIndex={dashboardPrefs.sectionOrder.indexOf('meta')}>
      <section className="relative overflow-hidden rounded-2xl border border-[#0B84FF]/70 bg-[#050A16] p-5 shadow-[0_0_64px_rgba(11,132,255,0.28)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(11,132,255,0.20),transparent_42%),radial-gradient(circle_at_92%_0%,rgba(0,194,255,0.30),transparent_36%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#00C2FF,#0B84FF,transparent)]" />
        <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#0B84FF]/70 bg-[#0B84FF]/20 text-white shadow-[0_0_24px_rgba(11,132,255,0.55)]">
              <MetaAdsMark className="h-[18px] w-[18px] translate-y-px text-white" />
            </span>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              Meta Ads
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-foreground/60">{metaFormLeads.toLocaleString('pt-BR')} formulários + {metaConversations.toLocaleString('pt-BR')} conversas no período</p>
            <button type="button" onClick={() => toggleSection('meta')} className="flex items-center gap-1 rounded-lg border border-[#0B84FF]/30 bg-[#0B84FF]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#0B84FF]/80 hover:bg-[#0B84FF]/20 transition-colors whitespace-nowrap">
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsedSections.has('meta') && '-rotate-90')} />
              {collapsedSections.has('meta') ? 'Expandir' : 'Recolher'}
            </button>
          </div>
        </div>

        {!collapsedSections.has('meta') && (() => {
          const metaCards: Record<string, ReactNode> = {
            'meta-reach':            <KpiCard title="Alcance Meta" value={metaReach} format="number" icon={Users} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-reach'].chart} series={seriesOrPacing(metaReachSeries, metaReach)} />,
            'meta-impressions':      <KpiCard title="Impressões Meta" value={metaImpressions} format="number" icon={BarChart3} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-impressions'].chart} series={seriesOrPacing(metaImpressionsSeries, metaImpressions)} />,
            'meta-leads':            <KpiCard title="Leads Meta Ads" value={metaLeads} prevValue={prevMetaLeads > 0 ? prevMetaLeads : undefined} format="number" icon={Target} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-leads'].chart} series={seriesOrPacing(metaLeadsSeries, metaLeads)} />,
            'meta-cpl':              <KpiCard title="CPL Meta Ads" value={avgCpl} format="currency" icon={Zap} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} inverseGoal inverseChange logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-cpl'].chart} series={seriesOrPacing(metaCplSeries, avgCpl)} />,
            'meta-spend':            <KpiCard title="Valor Investido Meta" value={metaSpend} format="currency" icon={Wallet} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={metricsLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-spend'].chart} series={seriesOrPacing(metaSpendSeries, metaSpend)} />,
            'meta-ctr':              <KpiCard title="CTR Meta Ads" value={metaCtr} format="percent" icon={MousePointerClick} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-ctr'].chart} series={seriesOrPacing(metaCtrSeries, metaCtr)} />,
            'meta-total-spend':      <KpiCard title="Total Investido Meta" value={metaCampaignSpend || metaSpend} format="currency" icon={CreditCard} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={campaignsLoading || metricsLoading} chart={dashboardPrefs.cards['meta-total-spend'].chart} series={seriesOrPacing(metaSpendSeries, metaCampaignSpend || metaSpend)} />,
            'meta-balance':          <KpiCard title="Saldo da Conta Meta" value={metaBalance} format="currency" icon={PiggyBank} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={balancesLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-balance'].chart} series={pacingSeries(metaBalance, Math.max(2, selectedDateKeys.length || 2))} />,
            'meta-active-campaigns': <CompactInfoCard title="Campanhas Ativas" value={activeMetaCampaigns} icon={Briefcase} color="#0668E1" />,
            'meta-adsets':           <CompactInfoCard title="Conjuntos" value="Ver na tabela" icon={LayoutDashboard} color="#0668E1" helper="Expanda uma campanha para visualizar conjuntos e anúncios." />,
            'meta-creatives':        <CompactInfoCard title="Criativos" value={metaCreativeCount} icon={ImageIcon} color="#0668E1" helper="Com preview no carrossel abaixo." />,
            'meta-clicks':           <KpiCard title="Cliques Meta" value={metaClicks} format="number" icon={MousePointerClick} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-clicks'].chart} series={seriesOrPacing(metaClicksSeries, metaClicks)} />,
          };
          const visibleLayout = metaKpiLayout.filter(l => dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false);
          return (
            <RglGrid
              layout={visibleLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setMetaKpiLayout(prev => prev.map(item => {
                const u = nl.find(l => l.i === item.i);
                return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item;
              }))}
            >
              {visibleLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {metaCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>
          );
        })()}

        {!collapsedSections.has('meta') && <div className="mt-5" />}

        {!collapsedSections.has('meta') && (() => {
          const metaPanelCards: Record<string, ReactNode> = {
            'meta-campaigns': (
              <div className="rounded-xl border border-[#0B84FF]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(11,132,255,0.10),0_0_28px_rgba(11,132,255,0.16)] h-full flex flex-col">
                <div className="mb-3 shrink-0 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/75">Campanhas Meta Ads</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/55">Ordenar por</span>
                    <div className="flex overflow-hidden rounded-lg border border-[#0B84FF]/30 bg-black/45">
                      {SORT_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setCampaignSortBy(opt.value)}
                          className={cn('px-3 py-1.5 text-[11px] font-semibold transition-colors', campaignSortBy === opt.value ? 'bg-primary text-black shadow-[0_0_10px_rgba(85,245,47,0.28)]' : 'text-muted-foreground hover:text-foreground')}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {campaignsLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <CampaignPerformanceTable campaigns={metaCampaigns} loading={campaignsLoading} period={period} dateFrom={customDateFrom} dateTo={customDateTo} />
                </div>
              </div>
            ),
            'meta-audience': <AudiencePlatformBlock title="Meta Ads" description="Recortes por idade, gênero, plataforma e dispositivo." color="#0B84FF" colors={META_AUDIENCE_COLORS} data={audience.meta} chartVariant={dashboardPrefs.metaAudienceChart} />,
            'meta-creative-preview': (
              <div className="rounded-xl border border-[#0B84FF]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(11,132,255,0.10),0_0_28px_rgba(11,132,255,0.16)] h-full flex flex-col overflow-hidden">
                <div className="flex-none flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/75">Criativos Meta Ads</p>
                    <p className="mt-0.5 text-[11px] text-foreground/55">Anúncios e previews com melhor desempenho no período selecionado.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/55">Ordenar por</span>
                    <div className="flex overflow-hidden rounded-lg border border-[#0B84FF]/30 bg-black/45">
                      {([{ value: 'spend' as SortKey, label: 'Investimento' }, { value: 'leads' as SortKey, label: 'Leads' }, { value: 'cpl' as SortKey, label: 'CPL' }, { value: 'ctr' as SortKey, label: 'CTR' }]).map(opt => (
                        <button key={opt.value} onClick={() => setSortBy(opt.value)}
                          className={cn('px-3 py-1.5 text-[11px] font-semibold transition-colors', sortBy === opt.value ? 'bg-primary text-black shadow-[0_0_14px_rgba(85,245,47,0.42)]' : 'text-foreground/60 hover:bg-white/10 hover:text-foreground')}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {creativesLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="mt-4 flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                  {creativesLoading ? (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))' }}>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="animate-pulse rounded-xl border border-border bg-muted/10">
                          <div className="bg-muted/30 rounded-t-xl" style={{ aspectRatio: '9/16' }} />
                          <div className="p-2.5 space-y-2"><div className="h-3 bg-muted/40 rounded w-3/4" /></div>
                        </div>
                      ))}
                    </div>
                  ) : creatives.length === 0 ? (
                    <div className="py-10 text-center">
                      <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">Nenhum criativo encontrado.</p>
                      <p className="mt-1 text-xs text-muted-foreground/60">Conecte uma conta Meta Ads em Integrações.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 pb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))' }}>
                      {creatives.map((c, idx) => (
                        <CreativeCarouselCard key={c.adId} creative={c} idx={idx} sortBy={sortBy} onPreview={setPreviewCreative} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ),
          };
          const visibleLayout = metaPanelsLayout.filter(l => dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false);
          return (
            <RglGrid
              layout={visibleLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setMetaPanelsLayout(prev => prev.map(item => { const u = nl.find(l => l.i === item.i); return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item; }))}
            >
              {visibleLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {metaPanelCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>
          );
        })()}
      </section>
      </SortableSection>}

      {/* 3. GOOGLE ADS */}
      {hasVisibleGoogleCards && <SortableSection id="google" editMode={editMode} orderIndex={dashboardPrefs.sectionOrder.indexOf('google')}>
      <section className="relative overflow-hidden rounded-2xl border border-[#EA4335]/75 bg-[#120607] p-5 shadow-[0_0_64px_rgba(234,67,53,0.30)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(234,67,53,0.22),transparent_42%),radial-gradient(circle_at_92%_0%,rgba(251,188,5,0.24),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#EA4335,#FBBC05,transparent)]" />
        <div className="relative mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EA4335]/75 bg-[#EA4335]/25 shadow-[0_0_26px_rgba(234,67,53,0.70)]">
              <GoogleAdsMark className="h-5 w-5" />
            </span>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
              Google Ads
            </h2>
          </div>
          <button type="button" onClick={() => toggleSection('google')} className="flex items-center gap-1 rounded-lg border border-[#EA4335]/30 bg-[#EA4335]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#EA4335]/80 hover:bg-[#EA4335]/20 transition-colors whitespace-nowrap">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsedSections.has('google') && '-rotate-90')} />
            {collapsedSections.has('google') ? 'Expandir' : 'Recolher'}
          </button>
        </div>

        {!collapsedSections.has('google') && (() => {
          const googleCards: Record<string, ReactNode> = {
            'google-impressions':      <KpiCard title="Impressões Google" value={googleImpressions} format="number" icon={BarChart3} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} chart={dashboardPrefs.cards['google-impressions'].chart} series={seriesOrPacing(googleImpressionsSeries, googleImpressions)} />,
            'google-conversions':      <KpiCard title="Conversões Google" value={googleConv} prevValue={prevGoogleConv > 0 ? prevGoogleConv : undefined} format="number" icon={BarChart3} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-conversions'].chart} series={seriesOrPacing(googleConversionsSeries, googleConv)} />,
            'google-cpa':              <KpiCard title="Custo por Conversão" value={avgCpa} format="currency" icon={Briefcase} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} inverseGoal inverseChange logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-cpa'].chart} series={seriesOrPacing(googleCpaSeries, avgCpa)} />,
            'google-spend':            <KpiCard title="Valor Investido Google" value={googleCost} format="currency" icon={CreditCard} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={metricsLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-spend'].chart} series={seriesOrPacing(googleCostSeries, googleCost)} />,
            'google-ctr':              <KpiCard title="CTR Google Ads" value={googleCtrValue} format="percent" icon={MousePointerClick} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} chart={dashboardPrefs.cards['google-ctr'].chart} series={seriesOrPacing(googleCtrSeries, googleCtrValue)} />,
            'google-total-spend':      <KpiCard title="Total Investido Google" value={googleCampaignSpend || googleCost} format="currency" icon={Wallet} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={campaignsLoading || metricsLoading} chart={dashboardPrefs.cards['google-total-spend'].chart} series={seriesOrPacing(googleCostSeries, googleCampaignSpend || googleCost)} />,
            'google-balance':          <KpiCard title="Saldo da Conta Google" value={googleBalance} format="currency" icon={Wallet} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={balancesLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-balance'].chart} series={pacingSeries(googleBalance, Math.max(2, selectedDateKeys.length || 2))} />,
            'google-active-campaigns': <CompactInfoCard title="Campanhas Ativas" value={activeGoogleCampaigns} icon={Briefcase} color="#EA4335" />,
            'google-keyword-count':    <CompactInfoCard title="Top Palavras-chave" value={keywords.length} icon={Search} color="#EA4335" helper="Lista ordenada abaixo." />,
            'google-clicks':           <KpiCard title="Cliques Google" value={googleClicks} format="number" icon={MousePointerClick} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} chart={dashboardPrefs.cards['google-clicks'].chart} series={seriesOrPacing(googleClicksSeries, googleClicks)} />,
            'google-cpc':              <KpiCard title="CPC Google" value={googleCpc} format="currency" icon={CreditCard} iconColor="#e2e8f0" iconBg="#e2e8f0" loading={metricsLoading} inverseGoal inverseChange logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-cpc'].chart} series={seriesOrPacing(googleCpcSeries, googleCpc)} />,
          };
          const visibleLayout = googleKpiLayout.filter(l => dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false);
          return (
            <RglGrid
              layout={visibleLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setGoogleKpiLayout(prev => prev.map(item => {
                const u = nl.find(l => l.i === item.i);
                return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item;
              }))}
            >
              {visibleLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {googleCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>
          );
        })()}

        {!collapsedSections.has('google') && <div className="mt-5" />}

        {!collapsedSections.has('google') && (() => {
          const googlePanelCards: Record<string, ReactNode> = {
            'google-campaigns': (
              <div className="rounded-xl border border-[#EA4335]/40 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(234,67,53,0.10),0_0_28px_rgba(234,67,53,0.18)] h-full flex flex-col">
                <div className="mb-3 shrink-0 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/75">Campanhas Google Ads</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-foreground/55">Ordenar por</span>
                    <div className="flex overflow-hidden rounded-lg border border-[#EA4335]/35 bg-black/45">
                      {SORT_OPTIONS.map(opt => (
                        <button key={opt.value} onClick={() => setCampaignSortBy(opt.value)}
                          className={cn('px-3 py-1.5 text-[11px] font-semibold transition-colors', campaignSortBy === opt.value ? 'bg-primary text-black shadow-[0_0_10px_rgba(85,245,47,0.28)]' : 'text-muted-foreground hover:text-foreground')}>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {campaignsLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <CampaignPerformanceTable campaigns={googleCampaigns} loading={campaignsLoading} period={period} dateFrom={customDateFrom} dateTo={customDateTo} />
                </div>
              </div>
            ),
            'google-keywords': (
              <div className="h-full">
                <TopKeywordsTable keywords={keywords} loading={keywordsLoading} />
              </div>
            ),
            'google-audience': <AudiencePlatformBlock title="Google Ads" description="Recortes por gênero e dispositivo." color="#EA4335" colors={GOOGLE_AUDIENCE_COLORS} data={audience.google} keys={['gender', 'device']} chartVariant={dashboardPrefs.googleAudienceChart} />,
          };
          const visibleLayout = googlePanelsLayout.filter(l => dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false);
          return (
            <RglGrid
              layout={visibleLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setGooglePanelsLayout(prev => prev.map(item => { const u = nl.find(l => l.i === item.i); return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item; }))}
            >
              {visibleLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {googlePanelCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>
          );
        })()}
      </section>
      </SortableSection>}

      {/* 4. PÁGINAS SOCIAIS */}
      {shouldRenderSocialSection && <SortableSection id="social" editMode={editMode} orderIndex={dashboardPrefs.sectionOrder.indexOf('social')}>
      {(() => {
        const allFbData = pageInsights.filter(p => p.facebook).map(p => p.facebook!);
        const allIgData = pageInsights.filter(p => p.instagram).map(p => p.instagram!);
        const prevFbData = prevPageInsights.filter(p => p.facebook).map(p => p.facebook!);
        const prevIgData = prevPageInsights.filter(p => p.instagram).map(p => p.instagram!);
        const hasFb = allFbData.length > 0;
        const hasIg = allIgData.length > 0;
        const fbFans    = allFbData.reduce((s, d) => s + d.fans, 0);
        const fbAdds    = allFbData.reduce((s, d) => s + d.fanAdds, 0);
        const fbReach   = allFbData.reduce((s, d) => s + d.reach, 0);
        const fbImpr    = allFbData.reduce((s, d) => s + d.impressions, 0);
        const fbEngage  = allFbData.reduce((s, d) => s + d.engagements, 0);
        const fbViews   = allFbData.reduce((s, d) => s + d.pageViews, 0);
        const igFollow   = allIgData.reduce((s, d) => s + d.followers, 0);
        const igReach    = allIgData.reduce((s, d) => s + d.reach, 0);
        const igViews    = allIgData.reduce((s, d) => s + d.views, 0);
        const igPViews   = allIgData.reduce((s, d) => s + d.profileViews, 0);
        const igClicks   = allIgData.reduce((s, d) => s + d.websiteClicks, 0);
        const igEngaged  = allIgData.reduce((s, d) => s + d.accountsEngaged, 0);
        const igInteract = allIgData.reduce((s, d) => s + d.totalInteractions, 0);
        const igLikes    = allIgData.reduce((s, d) => s + d.likes, 0);
        const igSaves    = allIgData.reduce((s, d) => s + d.saves, 0);
        // Previous period aggregates
        const prevFbFans    = prevFbData.reduce((s, d) => s + d.fans, 0);
        const prevFbAdds    = prevFbData.reduce((s, d) => s + d.fanAdds, 0);
        const prevFbReach   = prevFbData.reduce((s, d) => s + d.reach, 0);
        const prevFbImpr    = prevFbData.reduce((s, d) => s + d.impressions, 0);
        const prevFbEngage  = prevFbData.reduce((s, d) => s + d.engagements, 0);
        const prevFbViews   = prevFbData.reduce((s, d) => s + d.pageViews, 0);
        const prevIgFollow  = prevIgData.reduce((s, d) => s + d.followers, 0);
        const prevIgReach   = prevIgData.reduce((s, d) => s + d.reach, 0);
        const prevIgViews   = prevIgData.reduce((s, d) => s + d.views, 0);
        const prevIgPViews  = prevIgData.reduce((s, d) => s + d.profileViews, 0);
        const prevIgClicks  = prevIgData.reduce((s, d) => s + d.websiteClicks, 0);
        const prevIgEngaged = prevIgData.reduce((s, d) => s + d.accountsEngaged, 0);
        const prevIgInteract= prevIgData.reduce((s, d) => s + d.totalInteractions, 0);
        const prevIgLikes   = prevIgData.reduce((s, d) => s + d.likes, 0);
        const prevIgSaves   = prevIgData.reduce((s, d) => s + d.saves, 0);

        // Daily sparkline series — aggregated across all linked accounts
        const fbReachSeries   = aggPageSeries(allFbData.map(d => d.dailySeries), 'reach');
        const fbImprSeries    = aggPageSeries(allFbData.map(d => d.dailySeries), 'impressions');
        const fbEngageSeries  = aggPageSeries(allFbData.map(d => d.dailySeries), 'engagements');
        const fbViewsSeries   = aggPageSeries(allFbData.map(d => d.dailySeries), 'pageViews');
        const fbAddsSeries    = aggPageSeries(allFbData.map(d => d.dailySeries), 'fanAdds');
        const igReachSeries        = aggPageSeries(allIgData.map(d => d.dailySeries), 'reach');
        const igViewsSeries        = aggPageSeries(allIgData.map(d => d.dailySeries), 'views');
        const igPViewsSeries       = aggPageSeries(allIgData.map(d => d.dailySeries), 'profileViews');
        const igClicksSeries       = aggPageSeries(allIgData.map(d => d.dailySeries), 'websiteClicks');
        const igEngagedSeries      = aggPageSeries(allIgData.map(d => d.dailySeries), 'accountsEngaged');
        const igInteractSeries     = aggPageSeries(allIgData.map(d => d.dailySeries), 'totalInteractions');
        const igLikesSeries        = aggPageSeries(allIgData.map(d => d.dailySeries), 'likes');
        const igSavesSeries        = aggPageSeries(allIgData.map(d => d.dailySeries), 'saves');

        const socialCards: Record<string, ReactNode> = {
          'social-fb-fans':            <KpiCard title="Curtidas / Seg."   value={fbFans}    prevValue={prevFbFans}    format="number" icon={Users}         iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-fans']?.chart ?? 'sparkline'}       series={socialSeriesOrSlope([], prevFbFans, fbFans)} />,
          'social-fb-fan-adds':        <KpiCard title="Novas curtidas"    value={fbAdds}    prevValue={prevFbAdds}    format="number" icon={UserPlus}      iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-fan-adds']?.chart ?? 'sparkline'}   series={socialSeriesOrSlope(fbAddsSeries, prevFbAdds, fbAdds)} />,
          'social-fb-reach':           <KpiCard title="Alcance FB"        value={fbReach}   prevValue={prevFbReach}   format="number" icon={Eye}           iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-reach']?.chart ?? 'sparkline'}      series={socialSeriesOrSlope(fbReachSeries, prevFbReach, fbReach)} />,
          'social-fb-impressions':     <KpiCard title="Impressões FB"     value={fbImpr}    prevValue={prevFbImpr}    format="number" icon={BarChart3}     iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-impressions']?.chart ?? 'sparkline'} series={socialSeriesOrSlope(fbImprSeries, prevFbImpr, fbImpr)} />,
          'social-fb-engagements':     <KpiCard title="Engajamentos FB"   value={fbEngage}  prevValue={prevFbEngage}  format="number" icon={Heart}         iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-engagements']?.chart ?? 'sparkline'} series={socialSeriesOrSlope(fbEngageSeries, prevFbEngage, fbEngage)} />,
          'social-fb-views':           <KpiCard title="Visitas à página"  value={fbViews}   prevValue={prevFbViews}   format="number" icon={Monitor}       iconColor="#1877F2" iconBg="#1877F2" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-fb-views']?.chart ?? 'sparkline'}      series={socialSeriesOrSlope(fbViewsSeries, prevFbViews, fbViews)} />,
          'social-ig-followers':       <KpiCard title="Seguidores IG"     value={igFollow}  prevValue={prevIgFollow}  format="number" icon={Users}         iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-followers']?.chart ?? 'sparkline'}   series={socialSeriesOrSlope([], prevIgFollow, igFollow)} />,
          'social-ig-reach':           <KpiCard title="Alcance IG"        value={igReach}   prevValue={prevIgReach}   format="number" icon={Eye}           iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-reach']?.chart ?? 'sparkline'}        series={socialSeriesOrSlope(igReachSeries, prevIgReach, igReach)} />,
          'social-ig-views':           <KpiCard title="Visualizações IG"  value={igViews}   prevValue={prevIgViews}   format="number" icon={BarChart3}     iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-views']?.chart ?? 'sparkline'}        series={socialSeriesOrSlope(igViewsSeries, prevIgViews, igViews)} />,
          'social-ig-profile-views':   <KpiCard title="Visitas ao perfil" value={igPViews}  prevValue={prevIgPViews}  format="number" icon={Monitor}       iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-profile-views']?.chart ?? 'sparkline'}  series={socialSeriesOrSlope(igPViewsSeries, prevIgPViews, igPViews)} />,
          'social-ig-website-clicks':  <KpiCard title="Cliques no site"   value={igClicks}  prevValue={prevIgClicks}  format="number" icon={ExternalLink}  iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-website-clicks']?.chart ?? 'sparkline'} series={socialSeriesOrSlope(igClicksSeries, prevIgClicks, igClicks)} />,
          'social-ig-engaged':         <KpiCard title="Contas engajadas"  value={igEngaged} prevValue={prevIgEngaged} format="number" icon={Heart}         iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-engaged']?.chart ?? 'sparkline'}       series={socialSeriesOrSlope(igEngagedSeries, prevIgEngaged, igEngaged)} />,
          'social-ig-interactions':    <KpiCard title="Interações IG"     value={igInteract}prevValue={prevIgInteract}format="number" icon={Zap}           iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-interactions']?.chart ?? 'sparkline'}   series={socialSeriesOrSlope(igInteractSeries, prevIgInteract, igInteract)} />,
          'social-ig-likes':           <KpiCard title="Curtidas IG"       value={igLikes}   prevValue={prevIgLikes}   format="number" icon={Heart}         iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-likes']?.chart ?? 'sparkline'}         series={socialSeriesOrSlope(igLikesSeries, prevIgLikes, igLikes)} />,
          'social-ig-saves':           <KpiCard title="Salvamentos IG"    value={igSaves}   prevValue={prevIgSaves}   format="number" icon={Bookmark}      iconColor="#E1306C" iconBg="#E1306C" loading={pageInsightsLoading} hideGoal chart={dashboardPrefs.cards['social-ig-saves']?.chart ?? 'sparkline'}         series={socialSeriesOrSlope(igSavesSeries, prevIgSaves, igSaves)} />,
          'social-ig-top-posts':       <IgTopPostsCard posts={igPosts} loading={igPostsLoading} sortBy={igSortBy} onSortChange={setIgSortBy} periodFrom={selectedRange.from.toISOString().split('T')[0]} periodTo={selectedRange.to.toISOString().split('T')[0]} />,
        };

        const visibleSocialLayout = socialKpiLayout.filter(l => {
          if (l.i.startsWith('social-fb-') && !hasFb && !pageInsightsLoading) return false;
          if (l.i.startsWith('social-ig-') && !hasIg && !pageInsightsLoading) return false;
          return dashboardPrefs.cards[l.i as DashboardCardId]?.visible !== false;
        });

        return (
          <section className="relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ background: 'linear-gradient(90deg,#1877F2,#E1306C)' }} />
            <div className="pointer-events-none absolute top-0 left-0 h-3 w-3 bg-[#1877F2]" />
            <div className="relative mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#E1306C]"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" /></svg>
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Páginas &amp; Perfis Sociais</h2>
                  {pageInsightsLoading && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
                </div>
                {/* Account chips */}
                <div className="flex flex-wrap gap-2">
                {pageInsights.map(({ clientId, facebook, instagram }) => (
                  <span key={clientId} className="flex items-center gap-2">
                    {facebook && (
                      <span className="flex items-center gap-1 rounded-[var(--radius)] border border-[#1877F2]/30 bg-[#1877F2]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1877F2]">
                        {facebook.picture && <img src={facebook.picture} alt="" className="h-4 w-4 rounded-full" />}
                        {facebook.pageName}
                      </span>
                    )}
                    {instagram && (
                      <span className="flex items-center gap-1 rounded-[var(--radius)] border border-[#E1306C]/30 bg-[#E1306C]/10 px-2 py-0.5 text-[10px] font-semibold text-[#E1306C]">
                        {instagram.picture && <img src={instagram.picture} alt="" className="h-4 w-4 rounded-full" />}
                        @{instagram.username}
                      </span>
                    )}
                  </span>
                ))}
                </div>
              </div>
              <button type="button" onClick={() => toggleSection('social')} className="flex items-center gap-1 rounded-lg border border-[#E1306C]/30 bg-[#E1306C]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#E1306C]/80 hover:bg-[#E1306C]/20 transition-colors whitespace-nowrap">
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsedSections.has('social') && '-rotate-90')} />
                {collapsedSections.has('social') ? 'Expandir' : 'Recolher'}
              </button>
            </div>

            {!collapsedSections.has('social') && <RglGrid
              layout={visibleSocialLayout}
              cols={RGL_COLS}
              rowHeight={RGL_ROW_H}
              margin={RGL_MARGIN}
              containerPadding={[0, 0]}
              isDraggable
              isResizable
              draggableHandle=".drag-handle"
              compactType="vertical"
              onLayoutChange={nl => setSocialKpiLayout(prev => prev.map(item => { const u = nl.find(l => l.i === item.i); return u ? { ...item, x: u.x, y: u.y, w: u.w, h: u.h } : item; }))}
            >
              {visibleSocialLayout.map(l => (
                <div key={l.i} className="h-full">
                  <RglCardShell id={l.i as DashboardCardId} prefs={dashboardPrefs}>
                    {socialCards[l.i]}
                  </RglCardShell>
                </div>
              ))}
            </RglGrid>}
          </section>
        );
      })()}

      {/* Resumo por cliente */}
      {selectedClients.length > 1 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Resumo por cliente</p>
          <div className="divide-y divide-border">
            {selectedClients.map(client => {
              const m = metricsByClient[client.id];
              const leads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
              const spend = (m?.meta?.spend ?? 0) + (m?.google?.cost ?? 0);
              const goal = goalsByClient[client.id];
              const clientLeadsGoal = plannedFunnelFromGoal(goal, planningsByClient[client.id] ?? readPlanningFromStorage(client.id))[0] ?? 0;
              const pct = clientLeadsGoal > 0 ? Math.min(100, Math.round(leads / clientLeadsGoal * 100)) : null;
              return (
                <div key={client.id} className="flex items-center gap-4 py-2.5">
                  <Link href={`/clientes/${client.id}`} className="w-40 shrink-0 truncate text-sm font-bold hover:text-primary transition-colors">{client.name}</Link>
                  <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    {pct !== null && <div className={cn('h-full rounded-full', pct >= 75 ? 'bg-emerald-500' : pct >= 40 ? 'bg-orange-400' : 'bg-red-500')} style={{ width: `${pct}%` }} />}
                  </div>
                  <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                    <span>{leads > 0 ? `${leads} leads` : metricsLoading ? '…' : '— leads'}</span>
                    <span>{spend > 0 ? formatCurrencyBRL(spend) : metricsLoading ? '…' : '—'}</span>
                    {pct !== null && <span className={cn('font-bold', pct >= 75 ? 'text-emerald-400' : pct >= 40 ? 'text-orange-400' : 'text-red-400')}>{pct}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </SortableSection>}

      {/* ── 5. CRM LEADS PANEL (opt-in) ── */}
      {shouldRenderCrmSection && <SortableSection id="crm" editMode={editMode} orderIndex={dashboardPrefs.sectionOrder.indexOf('crm')}>
      <section className="relative overflow-hidden rounded-2xl border border-violet-500/40 bg-violet-950/20 p-5 space-y-1">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.12),transparent_50%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(139,92,246,0.6),transparent)]" />
        <div className="relative mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/40 bg-violet-500/15 shadow-[0_0_20px_rgba(139,92,246,0.4)]">
              <UserPlus className="h-4 w-4 text-violet-400" />
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Leads CRM</h2>
          </div>
          <button type="button" onClick={() => toggleSection('crm-leads')} className="flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-400/80 hover:bg-violet-500/20 transition-colors whitespace-nowrap">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', collapsedSections.has('crm-leads') && '-rotate-90')} />
            {collapsedSections.has('crm-leads') ? 'Expandir' : 'Recolher'}
          </button>
        </div>
        {!collapsedSections.has('crm-leads') && (
          <div className="relative">
            <CrmDashboardPanel clientIds={selectedIds} prefs={dashboardPrefs} />
          </div>
        )}
      </section>
      </SortableSection>}

      </div>
      </SortableContext>
      </DndContext>

      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />

      </DashboardEditCtx.Provider>}
    </div>
  );
}
