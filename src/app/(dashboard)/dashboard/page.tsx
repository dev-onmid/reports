"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ChevronDown, ChevronUp, ChevronRight, GripVertical, ImageIcon,
  LayoutDashboard, Play, RefreshCw, Search, Sparkles, Check, X,
  Pause, CircleDot, Pencil, Settings2, Users, Copy,
  Bell, DollarSign, Tag, TrendingUp, Calendar, BarChart3, Zap, Target, Briefcase,
  Wallet, MousePointerClick, CreditCard, PiggyBank, Clock,
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
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import { ClientAvatar } from '@/components/client-avatar';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
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
function KpiCard({ title, value, prevValue, goalValue, format = 'number', icon: Icon, iconColor, iconBg, loading = false, inverseGoal = false, inverseChange = false, footer, logo, chart = 'sparkline', series }: {
  title: string; value: number; prevValue?: number; goalValue?: number;
  format?: 'currency' | 'number' | 'percent' | 'times';
  icon: React.ElementType; iconColor: string; iconBg: string; loading?: boolean; inverseGoal?: boolean; inverseChange?: boolean;
  footer?: React.ReactNode;
  logo?: React.ReactNode;
  chart?: 'sparkline' | 'none';
  series?: number[];
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
    <div
      className="relative h-full overflow-hidden rounded-2xl border bg-[#070B14] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.38)]"
      style={{ borderColor: `${iconBg}66`, boxShadow: `0 0 34px ${iconBg}24, 0 22px 70px rgba(0,0,0,0.38)` }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${iconBg}24, transparent 42%), radial-gradient(circle at 86% 14%, ${iconBg}44, transparent 42%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${iconBg}, transparent)` }} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-foreground/90">{title}</p>
        {logo ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15" style={{ background: `${iconBg}2B`, boxShadow: `0 0 22px ${iconBg}55` }}>
            {logo}
          </span>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15" style={{ background: `${iconBg}30`, boxShadow: `0 0 22px ${iconBg}55` }}>
            <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted/30" />
      ) : (
        <>
          <p className="mt-3 font-heading font-normal text-3xl leading-none text-foreground">{fmt(value)}</p>
          {change !== null ? (
            <p className={cn('mt-1.5 flex items-center gap-0.5 text-xs font-semibold', isPositive ? 'text-emerald-400' : 'text-red-400')}>
              {change >= 0 ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs mês passado
            </p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">— vs mês passado</p>
          )}
          {goalProgress !== null ? (
            <p className={cn('mt-1 flex items-center gap-1 text-[11px] font-semibold', goalGood ? 'text-emerald-400' : 'text-amber-400')}>
              <CircleDot className="h-2.5 w-2.5" />
              {goalProgress.toFixed(0)}% vs meta
              <span className="text-muted-foreground/70">({fmt(goalValue!)})</span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground/70">— vs meta</p>
          )}
          {chart === 'sparkline' && (
            <div className="mt-3 -mx-1">
              <MiniTrendLine
                color={change === null ? iconColor : isPositive ? '#34d399' : '#f87171'}
                trend={change === null ? 'up' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}
                values={series}
              />
            </div>
          )}
          {footer && <div className="mt-2 border-t border-white/10 pt-2">{footer}</div>}
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
  const targetPct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const progress = Math.max(0, Math.min(100, targetPct));
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
          { label: 'Meta', val: target, pct: targetPct },
          { label: 'Meta Parcial', val: partial, pct: partial > 0 ? Math.round((value / partial) * 100) : 0 },
          { label: 'Realizado', val: value, pct: targetPct },
        ].map(item => (
          <div key={item.label} className="min-w-0">
            <p className="truncate text-base font-semibold text-foreground">{item.val > 0 ? fmt(item.val) : '—'}</p>
            <p className="mt-1 text-xs font-semibold text-foreground/65">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="relative mt-5 h-8 overflow-hidden rounded-lg border" style={{ borderColor: `${accent}99`, background: `${accent}18`, boxShadow: `inset 0 0 18px ${accent}20` }}>
        <div
          className="flex h-full items-center justify-center rounded-md text-sm font-black text-black transition-all"
          style={{
            width: `${progress}%`,
            minWidth: progress > 0 ? '64px' : '0',
            background: `repeating-linear-gradient(45deg, ${accent}, ${accent} 14px, color-mix(in srgb, ${accent} 78%, white) 14px, color-mix(in srgb, ${accent} 78%, white) 28px)`,
            boxShadow: `0 0 22px ${accent}66`,
          }}
        >
          {progress > 0 ? `${targetPct.toFixed(2)}%` : ''}
        </div>
      </div>
      <button type="button" className="relative mt-4 flex items-center gap-1.5 text-xs font-bold" style={{ color: accent }}>
        Ver detalhes <ChevronRight className="h-3.5 w-3.5" />
      </button>
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
    <div className="relative overflow-hidden rounded-xl border bg-[#070B14] p-4" style={{ borderColor: `${color}66`, boxShadow: `0 0 28px ${color}1F` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 86% 12%, ${color}40, transparent 44%)` }} />
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/75">{title}</p>
          <p className="mt-2 font-heading text-2xl leading-none text-foreground">{typeof value === 'number' ? value.toLocaleString('pt-BR') : value}</p>
        </div>
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15" style={{ background: `${color}35`, color, boxShadow: `0 0 22px ${color}66` }}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      {helper && <p className="relative mt-2 text-[10px] text-foreground/55">{helper}</p>}
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
    <svg viewBox="0 0 320 92" className="h-20 w-full overflow-visible" aria-hidden="true">
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
      <p className="mt-6 font-heading font-normal text-4xl leading-none" style={{ color }}>
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
            <p className="mt-2 font-heading font-normal text-4xl leading-none text-foreground">{formatted}</p>
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
          <h3 className="flex items-center gap-3 font-heading font-normal text-3xl uppercase tracking-wide text-foreground">
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
    <section className="relative overflow-hidden rounded-2xl border bg-[#050914] p-5" style={{ borderColor: `${accent}66`, boxShadow: `0 0 48px ${accent}22` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${accent}20, transparent 44%), radial-gradient(circle at 92% 0%, ${accent}4D, transparent 36%)` }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <div className="relative mb-5 flex items-end justify-between gap-4">
        {title && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            <PlatformMarkForText text={title} />
            <span>{title}</span>
          </h2>
          {description && <p className="mt-0.5 text-[11px] text-foreground/60">{description}</p>}
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
        <p className="flex items-center gap-2 text-lg font-bold text-foreground">
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
                  <p className="font-heading font-normal text-2xl leading-none text-foreground">{meta > 0 ? fmt(meta) : 'Sem meta'}</p>
                  <p className="mt-2 text-sm font-bold text-foreground/60">Meta</p>
                </div>
              )}
              {partial !== undefined && (
                <div>
                  <p className="font-heading font-normal text-2xl leading-none text-foreground">{partial > 0 ? fmt(partial) : '—'}</p>
                  <p className="mt-2 text-sm font-bold text-foreground/60">Meta Parcial</p>
                </div>
              )}
              <div>
                <p className="font-heading font-normal text-2xl leading-none text-foreground">{fmt(value)}</p>
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
                    <span className="rounded bg-black/70 px-3 py-0.5 text-base font-bold text-white shadow-[0_0_16px_rgba(255,255,255,0.14)]">{progressLabel}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-8 flex flex-1 items-center rounded-lg border border-white/15 bg-black/35 p-7">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Realizado</p>
              <p className="mt-3 font-heading font-normal text-4xl leading-none" style={{ color: accent }}>
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
        {selected.size === 1 && (() => { const c = clients.find(cl => selected.has(cl.id)); return c ? <ClientAvatar clientId={c.id} name={c.name} size="sm" /> : null; })()}
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
                <ClientAvatar clientId={c.id} name={c.name} size="sm" />
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
      <div className="mx-auto grid h-full max-w-7xl items-center justify-center gap-6 px-4 py-8 lg:grid-cols-[minmax(360px,560px)_360px]">
        <div
          className="flex h-[min(78vh,760px)] w-[min(82vw,560px)] items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_0_60px_rgba(11,132,255,0.18)]"
          onClick={(event) => event.stopPropagation()}
        >
          {creative.videoUrl ? (
            <video
              src={creative.videoUrl}
              poster={imgUrl}
              controls
              autoPlay
              className="h-full w-full bg-black object-contain"
            />
          ) : imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imgUrl}
              alt={creative.adName}
              className="h-full w-full bg-black object-contain"
              style={{ imageRendering: 'auto' }}
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5">
              <ImageIcon className="h-10 w-10 text-white/30" />
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
          <p className="mt-4 text-xs text-white/40">{creative.accountName}</p>
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
    { key: 'spend', label: 'Gasto' },
    { key: 'conversions', label: 'Conv.' },
    { key: 'cpl', label: 'CPL' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-[#EA4335]/40 bg-black/35 shadow-[0_0_30px_rgba(234,67,53,0.18)]">
      <div className="flex items-center justify-between border-b border-[#EA4335]/25 bg-[#EA4335]/10 px-4 py-3">
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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead className="border-b border-[#EA4335]/25 bg-black/35">
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
          <span className="text-muted-foreground">Gasto <strong className="text-foreground">{formatCurrencyBRL(ad.spend)}</strong></span>
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
        <p className="mt-1 text-xs text-muted-foreground">Quando houver gasto nas contas vinculadas, as campanhas aparecem aqui com métricas e ações rápidas.</p>
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
      <div className="overflow-hidden rounded-xl border border-white/15 bg-black/35 shadow-[0_0_28px_rgba(255,255,255,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left">
            <thead className="border-b border-white/15 bg-white/[0.06]">
              <tr className="text-[10px] font-bold uppercase tracking-widest text-foreground/62">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3 text-center">Plataforma</th>
                <th className="px-4 py-3 text-right">Verba/dia</th>
                <th className="px-4 py-3 text-right">Gasto</th>
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
    <div className="flex min-h-[360px] flex-col rounded-xl border border-white/15 bg-black/35 p-4 shadow-[inset_0_0_24px_rgba(255,255,255,0.05)]">
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-foreground">{title}</h4>
        <p className="mt-0.5 text-[11px] text-foreground/55">{total.toLocaleString('pt-BR')} pessoas/imp.</p>
      </div>
      {variant === 'donut' && (
        <div className="mt-3 flex justify-center">
          {slices.length > 0 ? (
          <svg viewBox="0 0 240 240" className="h-44 w-44 overflow-visible" role="img" aria-label={`Gráfico de ${title}`}>
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
            <div className="relative h-44 w-44 rounded-full bg-muted/20">
              <div className="absolute inset-8 rounded-full bg-card" />
            </div>
          )}
        </div>
      )}
      <div className="mt-4 grid flex-1 content-start gap-1.5 sm:grid-cols-2">
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
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border bg-black/35 p-4" style={{ borderColor: `${color}66`, boxShadow: `0 0 34px ${color}1F, inset 0 0 28px ${color}10` }}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(135deg, ${color}18, transparent 44%), radial-gradient(circle at 8% 0%, ${color}3D, transparent 34%)` }} />
      <div className="relative flex items-start gap-2">
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
  | 'general-revenue' | 'general-leads' | 'general-roi' | 'general-cpl' | 'general-spend' | 'general-ctr' | 'general-funnel'
  | 'meta-reach' | 'meta-impressions' | 'meta-leads' | 'meta-cpl' | 'meta-spend' | 'meta-ctr' | 'meta-total-spend' | 'meta-balance' | 'meta-active-campaigns' | 'meta-adsets' | 'meta-creatives' | 'meta-clicks' | 'meta-campaigns' | 'meta-audience' | 'meta-creative-preview'
  | 'google-impressions' | 'google-conversions' | 'google-cpa' | 'google-spend' | 'google-ctr' | 'google-total-spend' | 'google-balance' | 'google-active-campaigns' | 'google-keyword-count' | 'google-campaigns' | 'google-keywords' | 'google-audience';

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
};

const CARD_LABELS: Record<DashboardCardId, string> = {
  'general-revenue': 'Faturamento / Resultado',
  'general-leads': 'Leads total / parcial / meta',
  'general-roi': 'ROI',
  'general-cpl': 'CPL geral',
  'general-spend': 'Valor gasto',
  'general-ctr': 'CTR geral',
  'general-funnel': 'Funil de vendas',
  'meta-reach': 'Meta: Alcance',
  'meta-impressions': 'Meta: Impressões',
  'meta-leads': 'Meta: Leads',
  'meta-cpl': 'Meta: CPL',
  'meta-spend': 'Meta: Valor gasto',
  'meta-ctr': 'Meta: CTR',
  'meta-total-spend': 'Meta: Total gasto',
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
  'google-spend': 'Google: Valor gasto',
  'google-ctr': 'Google: CTR',
  'google-total-spend': 'Google: Total gasto',
  'google-balance': 'Google: Saldo da conta',
  'google-active-campaigns': 'Google: Campanhas ativas',
  'google-keyword-count': 'Google: Contador top palavras-chave',
  'google-campaigns': 'Google: Tabela de campanhas',
  'google-keywords': 'Google: Top palavras-chave',
  'google-audience': 'Google: Recortes por gênero/dispositivo',
};

const CARD_GROUPS: Array<{ title: string; ids: DashboardCardId[] }> = [
  { title: 'Métricas Gerais', ids: ['general-revenue', 'general-leads', 'general-roi', 'general-cpl', 'general-spend', 'general-ctr', 'general-funnel'] },
  { title: 'Meta Ads', ids: ['meta-reach', 'meta-impressions', 'meta-leads', 'meta-cpl', 'meta-spend', 'meta-ctr', 'meta-total-spend', 'meta-balance', 'meta-active-campaigns', 'meta-adsets', 'meta-creatives', 'meta-clicks', 'meta-campaigns', 'meta-audience', 'meta-creative-preview'] },
  { title: 'Google Ads', ids: ['google-impressions', 'google-conversions', 'google-cpa', 'google-spend', 'google-ctr', 'google-total-spend', 'google-balance', 'google-active-campaigns', 'google-keyword-count', 'google-campaigns', 'google-keywords', 'google-audience'] },
];

const DEFAULT_CARD_OVERRIDES: Partial<Record<DashboardCardId, Partial<DashboardCardConfig>>> = {
  'general-revenue': { size: 'lg', chart: 'none' },
  'general-leads': { size: 'lg', chart: 'none' },
  'general-funnel': { size: 'lg', chart: 'none' },
  'meta-campaigns': { size: 'lg', chart: 'none' },
  'meta-audience': { size: 'lg', chart: 'none' },
  'meta-creative-preview': { size: 'lg', chart: 'none' },
  'google-campaigns': { size: 'lg', chart: 'none' },
  'google-keywords': { size: 'md', chart: 'none' },
  'google-audience': { size: 'md', chart: 'none' },
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
  };
}

function gridSpan(size: DashboardWidgetSize) {
  return size === 'lg' ? 'xl:col-span-4' : size === 'md' ? 'xl:col-span-2' : 'xl:col-span-1';
}

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
  const cfg = prefs.cards[id] ?? DEFAULT_DASHBOARD_PREFS.cards[id];
  if (!cfg.visible) return null;
  return (
    <div
      className={cn('min-w-0 [&>*]:h-full', !ignoreSpan && gridSpan(cfg.size), className)}
      style={{ order: ignoreSpan ? undefined : cfg.order, minHeight: cfg.height ? `${cfg.height}px` : undefined }}
    >
      {children}
    </div>
  );
}

function DashboardCustomizer({
  prefs,
  onPrefsChange,
  onClose,
}: {
  prefs: DashboardPrefs;
  onPrefsChange: (prefs: DashboardPrefs) => void;
  onClose: () => void;
}) {
  function updateCard(id: DashboardCardId, patch: Partial<DashboardCardConfig>) {
    onPrefsChange({ ...prefs, cards: { ...prefs.cards, [id]: { ...prefs.cards[id], ...patch } } });
  }
  function moveCard(groupIds: DashboardCardId[], id: DashboardCardId, direction: -1 | 1) {
    const ordered = [...groupIds].sort((a, b) => {
      const aOrder = prefs.cards[a]?.order ?? groupIds.indexOf(a);
      const bOrder = prefs.cards[b]?.order ?? groupIds.indexOf(b);
      return aOrder - bOrder;
    });
    const currentIndex = ordered.indexOf(id);
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= ordered.length) return;
    const next = [...ordered];
    [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
    const cards = { ...prefs.cards };
    next.forEach((cardId, index) => {
      cards[cardId] = { ...cards[cardId], order: index };
    });
    onPrefsChange({ ...prefs, cards });
  }
  function reset() { onPrefsChange(DEFAULT_DASHBOARD_PREFS); }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm">
      <div className="absolute right-4 top-4 flex max-h-[calc(100vh-2rem)] w-[min(920px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-foreground">Customizar dashboard</p>
            <p className="text-[11px] text-muted-foreground">Configuração global, aplicada para todos os clientes.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="rounded-xl border border-border bg-background/50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Gráfico público Meta</span>
              <select value={prefs.metaAudienceChart} onChange={e => onPrefsChange({ ...prefs, metaAudienceChart: e.target.value as AudienceChartVariant })} className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <option value="donut">Donut</option>
                <option value="list">Lista</option>
              </select>
            </label>
            <label className="rounded-xl border border-border bg-background/50 p-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Gráfico público Google</span>
              <select value={prefs.googleAudienceChart} onChange={e => onPrefsChange({ ...prefs, googleAudienceChart: e.target.value as AudienceChartVariant })} className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <option value="donut">Donut</option>
                <option value="list">Lista</option>
              </select>
            </label>
          </div>
          <div className="space-y-5">
            {CARD_GROUPS.map(group => (
              <section key={group.title} className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{group.title}</p>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {[...group.ids].sort((a, b) => {
                    const aOrder = prefs.cards[a]?.order ?? group.ids.indexOf(a);
                    const bOrder = prefs.cards[b]?.order ?? group.ids.indexOf(b);
                    return aOrder - bOrder;
                  }).map(id => {
                    const cfg = prefs.cards[id];
                    const isPanel = id.includes('campaigns') || id.includes('audience') || id.includes('preview') || id.includes('keywords') || id === 'general-funnel';
                    return (
                      <div key={id} className="space-y-3 bg-background/35 p-3">
                        <label className="flex min-w-0 items-start gap-2 text-xs font-semibold text-foreground">
                          <input type="checkbox" checked={cfg.visible} onChange={e => updateCard(id, { visible: e.target.checked })} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
                          <span className="min-w-0 flex-1 whitespace-normal break-words leading-snug">{CARD_LABELS[id]}</span>
                          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{isPanel ? 'Painel' : 'Widget'}</span>
                        </label>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[132px_132px_112px_132px]">
                          <label className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Largura</span>
                            <select value={cfg.size} onChange={e => updateCard(id, { size: e.target.value as DashboardWidgetSize })} className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs">
                              <option value="sm">1 coluna</option>
                              <option value="md">2 colunas</option>
                              <option value="lg">4 colunas</option>
                            </select>
                          </label>
                          <label className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Altura</span>
                            <input
                              type="number"
                              min={120}
                              step={20}
                              value={cfg.height ?? ''}
                              onChange={e => updateCard(id, { height: e.target.value ? Math.max(120, Number(e.target.value)) : undefined })}
                              placeholder="Auto"
                              className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs"
                              aria-label={`Altura de ${CARD_LABELS[id]}`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Ordem</span>
                            <div className="flex overflow-hidden rounded-lg border border-border bg-card">
                              <button type="button" onClick={() => moveCard(group.ids, id, -1)} className="flex flex-1 items-center justify-center px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mover para cima">
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" onClick={() => moveCard(group.ids, id, 1)} className="flex flex-1 items-center justify-center border-l border-border px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Mover para baixo">
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </label>
                          <label className="space-y-1">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Gráfico</span>
                            <select value={cfg.chart} disabled={isPanel} onChange={e => updateCard(id, { chart: e.target.value as DashboardCardChart })} className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-xs disabled:opacity-40">
                              <option value="sparkline">Linha</option>
                              <option value="none">Sem gráfico</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <button type="button" onClick={reset} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">Restaurar padrão</button>
          <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-black">Salvar padrão global</button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard Edit Mode ──────────────────────────────────────────────────────
type WidgetId = 'general' | 'funnel' | 'meta' | 'google';

const WIDGET_INFO: Record<WidgetId, { label: string }> = {
  general: { label: 'Métricas Gerais' },
  funnel: { label: 'Funil de Vendas' },
  meta: { label: 'Meta Ads' },
  google: { label: 'Google Ads' },
};

const DEFAULT_WIDGET_ORDER: WidgetId[] = ['general', 'funnel', 'meta', 'google'];
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
function CreativeCarouselCard({ creative, idx, sortBy, onPreview }: {
  creative: TopCreative; idx: number; sortBy: SortKey; onPreview: (c: TopCreative) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const imgUrl = creative.imageUrl ?? creative.thumbnailUrl;
  const metricValue = sortBy === 'leads' ? creative.leads.toLocaleString('pt-BR')
    : sortBy === 'cpl' ? (creative.cpl > 0 ? formatCurrencyBRL(creative.cpl) : '—')
    : sortBy === 'ctr' ? `${creative.ctr.toFixed(2)}%`
    : formatCurrencyBRL(creative.spend);
  return (
    <div className="w-[175px] shrink-0 overflow-hidden rounded-xl border border-[#0B84FF]/35 bg-black/45 shadow-[0_0_24px_rgba(11,132,255,0.16)] transition-colors hover:border-[#55F52F]/65 hover:shadow-[0_0_30px_rgba(85,245,47,0.26)]">
      <div className="relative overflow-hidden bg-[#07101F]" style={{ aspectRatio: '9/16' }}>
        {imgUrl && !imgErr ? (
          <button type="button" onClick={() => onPreview(creative)} className="block h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imgUrl} alt={creative.adName} className="h-full w-full object-cover" onError={() => setImgErr(true)} />
            {creative.videoUrl && <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none" />}
          </button>
        ) : <ImageIcon className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground/30" />}
        {creative.videoUrl && (
          <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/70">
            <Play className="h-3 w-3 fill-white text-white" />
          </span>
        )}
        <span className="absolute left-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/85 text-[11px] font-bold text-white shadow-[0_0_14px_rgba(255,255,255,0.18)]">{idx + 1}</span>
        <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-black shadow-[0_0_16px_rgba(85,245,47,0.72)]">{metricValue}</span>
      </div>
      <div className="p-2.5 space-y-2">
        <p className="text-[11px] font-bold truncate">{creative.adName}</p>
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
  const [editMode, setEditMode] = useState(false);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>(DEFAULT_WIDGET_ORDER);
  const [collapsedWidgets, setCollapsedWidgets] = useState<Set<WidgetId>>(new Set());
  const [aiInsights, setAiInsights] = useState<AiInsight[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPrefs>(DEFAULT_DASHBOARD_PREFS);
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
        if (
          Array.isArray(parsed) &&
          parsed.every(id => DEFAULT_WIDGET_ORDER.includes(id)) &&
          DEFAULT_WIDGET_ORDER.every(id => parsed.includes(id))
        ) {
          setWidgetOrder(parsed);
        } else {
          setWidgetOrder(DEFAULT_WIDGET_ORDER);
        }
      }
      const collapsed = localStorage.getItem(LS_COLLAPSED);
      if (collapsed) setCollapsedWidgets(new Set(JSON.parse(collapsed) as WidgetId[]));
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem(LS_ORDER, JSON.stringify(widgetOrder)); }, [widgetOrder]);
  useEffect(() => { localStorage.setItem(LS_COLLAPSED, JSON.stringify([...collapsedWidgets])); }, [collapsedWidgets]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_DASHBOARD_PREFS);
      setDashboardPrefs(stored ? mergeDashboardPrefs(JSON.parse(stored)) : DEFAULT_DASHBOARD_PREFS);
    } catch {
      setDashboardPrefs(DEFAULT_DASHBOARD_PREFS);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(LS_DASHBOARD_PREFS, JSON.stringify(dashboardPrefs));
  }, [dashboardPrefs]);
  useEffect(() => {
    if (!isAdmin && customizerOpen) setCustomizerOpen(false);
  }, [customizerOpen, isAdmin]);

  // Initialize: all clients selected (or pre-select from ?client=ID param)
  useEffect(() => {
    if (clients.length === 0) return;
    const clientIds = new Set(clients.map(c => c.id));
    const preselect = new URLSearchParams(window.location.search).get('client');
    setSelectedIds((current) => {
      if (preselect && clientIds.has(preselect)) return new Set([preselect]);
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

  for (const id of selectedIds) {
    const goal = goalsByClient[id];
    const planning = readPlanningFromStorage(id);
    const plannedFunnel = plannedFunnelFromGoal(goal, planning);
    const topVolume = plannedFunnel[0] ?? 0;
    leadsGoal += topVolume;
    plannedInvestment += topVolume * planning.cplMeta;
    const plannedSales = plannedFunnel[plannedFunnel.length - 1] ?? 0;
    const clientRevenueGoal = goal?.type === 'revenue' ? goal.target : plannedSales * planning.tkm;
    plannedRevenue += clientRevenueGoal;
    if (goal?.type === 'revenue') revenueGoal += goal.target;
  }

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
    const planning = readPlanningFromStorage(id);
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
  const metaCampaignSpend = metaCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  const googleCampaignSpend = googleCampaigns.reduce((sum, campaign) => sum + campaign.spend, 0);
  const activeMetaCampaigns = metaCampaigns.filter((campaign) => campaign.status === 'ACTIVE' || campaign.status === 'ENABLED').length;
  const activeGoogleCampaigns = googleCampaigns.filter((campaign) => campaign.status === 'ACTIVE' || campaign.status === 'ENABLED').length;
  const metaCreativeCount = creatives.length;

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

  return (
    <div className="space-y-6 pb-10">
      {customizerOpen && isAdmin && (
        <DashboardCustomizer
          prefs={dashboardPrefs}
          onPrefsChange={setDashboardPrefs}
          onClose={() => setCustomizerOpen(false)}
        />
      )}

      {/* UNIFIED TOP BAR */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="flex items-center gap-2 px-6 h-20">
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
              title={dataCacheAge === 0 ? 'Dados recém-buscados da API' : `Dados em cache — buscados há ${Math.round(dataCacheAge / 60)} min. Atualizados automaticamente a cada 15 min.`}
              className="flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground cursor-default"
            >
              <Clock className="h-3 w-3" />
              {dataCacheAge === 0 ? 'Ao vivo' : `Cache · ${Math.round(dataCacheAge / 60)} min`}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <div className="relative w-52">
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
            {aiLoading ? 'Analisando...' : 'Analisar com IA'}
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setCustomizerOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Customizar
            </button>
          )}

          {/* Theme + bell + user */}
          <ThemeToggle />
          <button className="relative p-2 text-muted-foreground hover:text-foreground transition-colors">
            <Bell className="h-5 w-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary" />
          </button>
          <div className="flex items-center gap-2.5 border-l border-border pl-3">
            <div className="flex flex-col items-end leading-none gap-0.5">
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

      {/* 1. MÉTRICAS GERAIS */}
      <section className="relative overflow-hidden rounded-2xl border border-[#55F52F]/55 bg-[#050C0A] p-5 shadow-[0_0_56px_rgba(85,245,47,0.22)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(85,245,47,0.16),transparent_38%),radial-gradient(circle_at_92%_8%,rgba(85,245,47,0.28),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#55F52F,transparent)]" />
        <div className="relative mb-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#55F52F]/70 bg-[#55F52F]/25 text-primary shadow-[0_0_24px_rgba(85,245,47,0.65)]">
            <LayoutDashboard className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Métricas Gerais</h2>
            <p className="text-[11px] text-foreground/60">Consolidado do período antes da leitura por canal.</p>
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(480px,1.16fr)]">
          <DashboardGridItem id="general-revenue" prefs={dashboardPrefs} className="xl:col-span-2" ignoreSpan>
            <TargetSummaryCard title="Faturamento" value={revenue} partial={effectiveRevenueGoal} target={plannedRevenue} format="currency" accent="#22c55e" icon={DollarSign} />
          </DashboardGridItem>
          <DashboardGridItem id="general-leads" prefs={dashboardPrefs} className="xl:col-span-2 xl:row-start-2" ignoreSpan>
            <TargetSummaryCard title="Leads" value={totalLeads} partial={effectiveLeadsGoal} target={leadsGoal} format="number" accent="#22c55e" icon={Users} />
          </DashboardGridItem>
          <DashboardGridItem id="general-roi" prefs={dashboardPrefs} className="xl:row-start-3" ignoreSpan>
            <KpiCard title="ROI" value={roi} prevValue={prevRoi > 0 ? prevRoi : undefined} goalValue={roiGoal > 0 ? roiGoal : undefined} format="times" icon={TrendingUp} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} chart={dashboardPrefs.cards['general-roi'].chart} series={seriesOrPacing(roiSeries, roi)} />
          </DashboardGridItem>
          <DashboardGridItem id="general-cpl" prefs={dashboardPrefs} className="xl:row-start-3" ignoreSpan>
            <KpiCard title="CPL Geral" value={totalCostPerLead} prevValue={prevCpl > 0 ? prevCpl : undefined} goalValue={cplGoal > 0 ? cplGoal : undefined} format="currency" icon={Tag} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} inverseGoal inverseChange chart={dashboardPrefs.cards['general-cpl'].chart} series={seriesOrPacing(cplSeries, totalCostPerLead)} />
          </DashboardGridItem>
          <DashboardGridItem id="general-ctr" prefs={dashboardPrefs} className="xl:row-start-4" ignoreSpan>
            <KpiCard title="CTR Geral" value={avgCtr} format="percent" icon={MousePointerClick} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} chart={dashboardPrefs.cards['general-ctr'].chart} series={seriesOrPacing(avgCtrSeries, avgCtr)} />
          </DashboardGridItem>
          <DashboardGridItem id="general-spend" prefs={dashboardPrefs} className="xl:row-start-4" ignoreSpan>
            <KpiCard title="Valor Gasto" value={totalSpend} format="currency" icon={CreditCard} iconColor="#22c55e" iconBg="#22c55e" loading={metricsLoading} chart={dashboardPrefs.cards['general-spend'].chart} series={seriesOrPacing(totalSpendSeries, totalSpend)} />
          </DashboardGridItem>
          <DashboardGridItem id="general-funnel" prefs={dashboardPrefs} className="xl:col-start-3 xl:row-span-4 xl:row-start-1" ignoreSpan>
            <div className="flex h-full min-h-[680px] flex-col rounded-xl border border-[#55F52F]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(85,245,47,0.08),0_0_28px_rgba(85,245,47,0.14)] xl:min-h-[820px]">
              <p className="text-sm font-bold uppercase tracking-wider text-foreground">Funil de Performance</p>
              <p className="mt-0.5 text-[11px] text-foreground/60">Período: {PERIODS.find(p => p.value === period)?.label ?? period}</p>
              {(() => {
                const firstId = [...selectedIds][0];
                const clientPlanning = firstId ? readPlanningFromStorage(firstId) : DEFAULT_PLANNING;
                const stages = clientPlanning.stages.length >= 2 ? clientPlanning.stages : DEFAULT_PLANNING.stages;
                const crmValues = [
                  totalLeads,
                  funnelCounts[FUNNEL_ORDER[0]] ?? 0,
                  funnelCounts[FUNNEL_ORDER[1]] ?? 0,
                  funnelCounts[FUNNEL_ORDER[2]] ?? 0,
                  funnelCounts[FUNNEL_ORDER[3]] ?? 0,
                ];
                const funnelRows: { label: string; value: number }[] = [
                  { label: 'Visitantes', value: (metaReach || metaImpressions) + googleImpressions },
                  { label: 'Leads', value: totalLeads },
                  ...stages.slice(1).map((s, i) => ({ label: s.name.replace(/^\d+º\s*—\s*/, '').replace(/\s*\(.+\)/, ''), value: crmValues[i + 1] ?? 0 })),
                ];
                const maxVal = funnelRows[0]?.value || 1;
                const FUNNEL_COLORS = ['#0EA5E9', '#7C3AED', '#EC4899', '#F97316', '#22C55E'];
                const funnelHeight = 56;
                const funnelGap = 8;
                const funnelTop = 26;
                const funnelWidth = 320;
                const funnelCenter = funnelWidth / 2;
                return (
                  <div className="mt-4 grid flex-1 items-stretch gap-5">
                    <div className="relative min-h-[430px] rounded-xl border border-white/15 bg-black/45 p-4 shadow-[inset_0_0_32px_rgba(14,165,233,0.12)] xl:min-h-[520px]">
                      <svg viewBox="0 0 320 360" className="h-full w-full overflow-visible" role="img" aria-label="Funil de vendas">
                        <defs>
                          <filter id="dashboard-funnel-glow" x="-30%" y="-30%" width="160%" height="160%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge>
                              <feMergeNode in="blur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                        </defs>
                        {funnelRows.slice(0, 5).map((row, i) => {
                          const topRatio = Math.max(0.28, 1 - i * 0.14);
                          const bottomRatio = Math.max(0.22, 1 - (i + 1) * 0.14);
                          const topWidth = funnelWidth * topRatio;
                          const bottomWidth = funnelWidth * bottomRatio;
                          const y = funnelTop + i * (funnelHeight + funnelGap);
                          const color = FUNNEL_COLORS[i % FUNNEL_COLORS.length];
                          const d = [
                            `M ${funnelCenter - topWidth / 2} ${y}`,
                            `L ${funnelCenter + topWidth / 2} ${y}`,
                            `L ${funnelCenter + bottomWidth / 2} ${y + funnelHeight}`,
                            `L ${funnelCenter - bottomWidth / 2} ${y + funnelHeight}`,
                            'Z',
                          ].join(' ');
                          return <path key={row.label} d={d} fill={color} opacity={0.92} filter="url(#dashboard-funnel-glow)" />;
                        })}
                      </svg>
                    </div>
                    <div className="flex min-h-[230px] flex-col justify-between gap-2">
                      {funnelRows.slice(0, 5).map((row, i) => {
                        const pct = maxVal > 0 ? (row.value / maxVal) * 100 : 0;
                        return (
                          <div key={row.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs">
                            <span className="flex min-w-0 items-center gap-2 text-foreground/75">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: FUNNEL_COLORS[i % FUNNEL_COLORS.length], boxShadow: `0 0 14px ${FUNNEL_COLORS[i % FUNNEL_COLORS.length]}` }} />
                              <span className="truncate">{row.label}</span>
                            </span>
                            <span className="font-semibold text-foreground">{row.value.toLocaleString('pt-BR')}</span>
                            <span className="w-14 text-right font-semibold text-foreground/65">{pct.toFixed(2)}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </DashboardGridItem>
        </div>
      </section>

      {/* 2. META ADS */}
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
          <p className="text-[11px] text-foreground/60">{metaFormLeads.toLocaleString('pt-BR')} formulários + {metaConversations.toLocaleString('pt-BR')} conversas no período</p>
        </div>

        <div className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardGridItem id="meta-reach" prefs={dashboardPrefs}><KpiCard title="Alcance Meta" value={metaReach} format="number" icon={Users} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-reach'].chart} series={seriesOrPacing(metaReachSeries, metaReach)} /></DashboardGridItem>
          <DashboardGridItem id="meta-impressions" prefs={dashboardPrefs}><KpiCard title="Impressões Meta" value={metaImpressions} format="number" icon={BarChart3} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-impressions'].chart} series={seriesOrPacing(metaImpressionsSeries, metaImpressions)} /></DashboardGridItem>
          <DashboardGridItem id="meta-leads" prefs={dashboardPrefs}><KpiCard title="Leads Meta Ads" value={metaLeads} prevValue={prevMetaLeads > 0 ? prevMetaLeads : undefined} format="number" icon={Target} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-leads'].chart} series={seriesOrPacing(metaLeadsSeries, metaLeads)} /></DashboardGridItem>
          <DashboardGridItem id="meta-cpl" prefs={dashboardPrefs}><KpiCard title="CPL Meta Ads" value={avgCpl} format="currency" icon={Zap} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} inverseGoal inverseChange logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-cpl'].chart} series={seriesOrPacing(metaCplSeries, avgCpl)} /></DashboardGridItem>
          <DashboardGridItem id="meta-spend" prefs={dashboardPrefs}><KpiCard title="Valor Gasto Meta" value={metaSpend} format="currency" icon={Wallet} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-spend'].chart} series={seriesOrPacing(metaSpendSeries, metaSpend)} /></DashboardGridItem>
          <DashboardGridItem id="meta-ctr" prefs={dashboardPrefs}><KpiCard title="CTR Meta Ads" value={metaCtr} format="percent" icon={MousePointerClick} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-ctr'].chart} series={seriesOrPacing(metaCtrSeries, metaCtr)} /></DashboardGridItem>
          <DashboardGridItem id="meta-total-spend" prefs={dashboardPrefs}><KpiCard title="Total Gasto Meta" value={metaCampaignSpend || metaSpend} format="currency" icon={CreditCard} iconColor="#0668E1" iconBg="#0668E1" loading={campaignsLoading || metricsLoading} chart={dashboardPrefs.cards['meta-total-spend'].chart} series={seriesOrPacing(metaSpendSeries, metaCampaignSpend || metaSpend)} /></DashboardGridItem>
          <DashboardGridItem id="meta-balance" prefs={dashboardPrefs}><KpiCard title="Saldo da Conta Meta" value={metaBalance} format="currency" icon={PiggyBank} iconColor="#0668E1" iconBg="#0668E1" loading={balancesLoading} logo={<img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['meta-balance'].chart} series={pacingSeries(metaBalance, Math.max(2, selectedDateKeys.length || 2))} /></DashboardGridItem>
          <DashboardGridItem id="meta-active-campaigns" prefs={dashboardPrefs}><CompactInfoCard title="Campanhas Ativas" value={activeMetaCampaigns} icon={Briefcase} color="#0668E1" /></DashboardGridItem>
          <DashboardGridItem id="meta-adsets" prefs={dashboardPrefs}><CompactInfoCard title="Conjuntos" value="Ver na tabela" icon={LayoutDashboard} color="#0668E1" helper="Expanda uma campanha para visualizar conjuntos e anúncios." /></DashboardGridItem>
          <DashboardGridItem id="meta-creatives" prefs={dashboardPrefs}><CompactInfoCard title="Criativos" value={metaCreativeCount} icon={ImageIcon} color="#0668E1" helper="Com preview no carrossel abaixo." /></DashboardGridItem>
          <DashboardGridItem id="meta-clicks" prefs={dashboardPrefs}><KpiCard title="Cliques Meta" value={metaClicks} format="number" icon={MousePointerClick} iconColor="#0668E1" iconBg="#0668E1" loading={metricsLoading} chart={dashboardPrefs.cards['meta-clicks'].chart} series={seriesOrPacing(metaClicksSeries, metaClicks)} /></DashboardGridItem>
        </div>

        <div className="relative mt-4 grid gap-4 xl:grid-cols-4">
          <DashboardGridItem id="meta-campaigns" prefs={dashboardPrefs}>
          <div className="rounded-xl border border-[#0B84FF]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(11,132,255,0.10),0_0_28px_rgba(11,132,255,0.16)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
            <CampaignPerformanceTable campaigns={metaCampaigns} loading={campaignsLoading} period={period} dateFrom={customDateFrom} dateTo={customDateTo} />
          </div>
          </DashboardGridItem>
          <DashboardGridItem id="meta-audience" prefs={dashboardPrefs}>
            <AudiencePlatformBlock title="Meta Ads" description="Recortes por idade, gênero, plataforma e dispositivo." color="#0B84FF" colors={META_AUDIENCE_COLORS} data={audience.meta} chartVariant={dashboardPrefs.metaAudienceChart} />
          </DashboardGridItem>
        </div>

        <DashboardGridItem id="meta-creative-preview" prefs={dashboardPrefs}>
        <div className="relative mt-4 rounded-xl border border-[#0B84FF]/35 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(11,132,255,0.10),0_0_28px_rgba(11,132,255,0.16)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
          <div className="mt-4">
            {creativesLoading ? (
              <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-[175px] shrink-0 animate-pulse rounded-xl border border-border bg-muted/10">
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
              <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                {creatives.map((c, idx) => (
                  <CreativeCarouselCard key={c.adId} creative={c} idx={idx} sortBy={sortBy} onPreview={setPreviewCreative} />
                ))}
              </div>
            )}
          </div>
        </div>
        </DashboardGridItem>
      </section>

      {/* 3. GOOGLE ADS */}
      <section className="relative overflow-hidden rounded-2xl border border-[#EA4335]/75 bg-[#120607] p-5 shadow-[0_0_64px_rgba(234,67,53,0.30)]">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(234,67,53,0.22),transparent_42%),radial-gradient(circle_at_92%_0%,rgba(251,188,5,0.24),transparent_34%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,#EA4335,#FBBC05,transparent)]" />
        <div className="relative mb-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EA4335]/75 bg-[#EA4335]/25 shadow-[0_0_26px_rgba(234,67,53,0.70)]">
            <GoogleAdsMark className="h-5 w-5" />
          </span>
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-foreground">
            Google Ads
          </h2>
        </div>

        <div className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardGridItem id="google-impressions" prefs={dashboardPrefs}><KpiCard title="Impressões Google" value={googleImpressions} format="number" icon={BarChart3} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} chart={dashboardPrefs.cards['google-impressions'].chart} series={seriesOrPacing(googleImpressionsSeries, googleImpressions)} /></DashboardGridItem>
          <DashboardGridItem id="google-conversions" prefs={dashboardPrefs}><KpiCard title="Conversões Google" value={googleConv} prevValue={prevGoogleConv > 0 ? prevGoogleConv : undefined} format="number" icon={BarChart3} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-conversions'].chart} series={seriesOrPacing(googleConversionsSeries, googleConv)} /></DashboardGridItem>
          <DashboardGridItem id="google-cpa" prefs={dashboardPrefs}><KpiCard title="Custo por Conversão" value={avgCpa} format="currency" icon={Briefcase} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} inverseGoal inverseChange logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-cpa'].chart} series={seriesOrPacing(googleCpaSeries, avgCpa)} /></DashboardGridItem>
          <DashboardGridItem id="google-spend" prefs={dashboardPrefs}><KpiCard title="Valor Gasto Google" value={googleCost} format="currency" icon={CreditCard} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-spend'].chart} series={seriesOrPacing(googleCostSeries, googleCost)} /></DashboardGridItem>
          <DashboardGridItem id="google-ctr" prefs={dashboardPrefs}><KpiCard title="CTR Google Ads" value={googleCtrValue} format="percent" icon={MousePointerClick} iconColor="#EA4335" iconBg="#EA4335" loading={metricsLoading} chart={dashboardPrefs.cards['google-ctr'].chart} series={seriesOrPacing(googleCtrSeries, googleCtrValue)} /></DashboardGridItem>
          <DashboardGridItem id="google-total-spend" prefs={dashboardPrefs}><KpiCard title="Total Gasto Google" value={googleCampaignSpend || googleCost} format="currency" icon={Wallet} iconColor="#EA4335" iconBg="#EA4335" loading={campaignsLoading || metricsLoading} chart={dashboardPrefs.cards['google-total-spend'].chart} series={seriesOrPacing(googleCostSeries, googleCampaignSpend || googleCost)} /></DashboardGridItem>
          <DashboardGridItem id="google-balance" prefs={dashboardPrefs}><KpiCard title="Saldo da Conta Google" value={googleBalance} format="currency" icon={Wallet} iconColor="#EA4335" iconBg="#EA4335" loading={balancesLoading} logo={<img src="/brand/google-ads-logo.png" alt="Google Ads" className="h-6 w-6 object-contain" />} chart={dashboardPrefs.cards['google-balance'].chart} series={pacingSeries(googleBalance, Math.max(2, selectedDateKeys.length || 2))} /></DashboardGridItem>
          <DashboardGridItem id="google-active-campaigns" prefs={dashboardPrefs}><CompactInfoCard title="Campanhas Ativas" value={activeGoogleCampaigns} icon={Briefcase} color="#EA4335" /></DashboardGridItem>
          <DashboardGridItem id="google-keyword-count" prefs={dashboardPrefs}><CompactInfoCard title="Top Palavras-chave" value={keywords.length} icon={Search} color="#EA4335" helper="Lista ordenada abaixo." /></DashboardGridItem>
        </div>

        <div className="relative mt-4 grid gap-4 xl:grid-cols-4">
          <DashboardGridItem id="google-campaigns" prefs={dashboardPrefs}>
          <div className="rounded-xl border border-[#EA4335]/40 bg-black/35 p-4 shadow-[inset_0_0_30px_rgba(234,67,53,0.10),0_0_28px_rgba(234,67,53,0.18)]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
            <CampaignPerformanceTable campaigns={googleCampaigns} loading={campaignsLoading} period={period} dateFrom={customDateFrom} dateTo={customDateTo} />
          </div>
          </DashboardGridItem>
          <DashboardGridItem id="google-keywords" prefs={dashboardPrefs}>
          <div className="space-y-4">
            <TopKeywordsTable keywords={keywords} loading={keywordsLoading} />
          </div>
          </DashboardGridItem>
          <DashboardGridItem id="google-audience" prefs={dashboardPrefs}>
            <AudiencePlatformBlock title="Google Ads" description="Recortes por gênero e dispositivo." color="#EA4335" colors={GOOGLE_AUDIENCE_COLORS} data={audience.google} keys={['gender', 'device']} chartVariant={dashboardPrefs.googleAudienceChart} />
          </DashboardGridItem>
        </div>
      </section>

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
              const clientLeadsGoal = plannedFunnelFromGoal(goal, readPlanningFromStorage(client.id))[0] ?? 0;
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

      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />
    </div>
  );
}
