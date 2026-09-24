"use client";

import RGL, { WidthProvider } from 'react-grid-layout';
import type { Layout as RglLayout } from 'react-grid-layout';
import { useIsMobile } from '@/lib/use-is-mobile';
const RglBase = WidthProvider(RGL);

// No mobile o grid arrastável vira uma pilha de cards de largura total: mesmo RGL
// (mantém alturas via rowHeight), layout forçado em 1 coluna, sem drag/resize e sem
// onLayoutChange — senão o empilhamento sobrescreveria o layout desktop salvo.
function RglGrid(props: React.ComponentProps<typeof RglBase>) {
  const isMobile = useIsMobile();
  if (!isMobile) return <RglBase {...props} />;
  const cols = props.cols ?? 12;
  let y = 0;
  const stacked = [...(props.layout ?? [])]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(l => {
      const item = { ...l, x: 0, y, w: cols };
      y += l.h;
      return item;
    });
  return (
    <RglBase
      {...props}
      layout={stacked}
      isDraggable={false}
      isResizable={false}
      onLayoutChange={undefined}
    />
  );
}
import React, { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ChevronDown, ChevronUp, ChevronRight, GripVertical, ImageIcon,
  LayoutDashboard, LayoutTemplate, Play, RefreshCw, Search, Check, X,
  CircleDot,   Users,
  Bell, DollarSign, Tag, TrendingUp, Calendar, BarChart3, Zap, Target, Briefcase,
  Wallet, MousePointerClick, CreditCard, PiggyBank, Clock, Info, Lightbulb, UserPlus, CheckCircle2, Receipt,
  Eye, Heart, Monitor, ExternalLink, Bookmark, MessageCircle, Repeat,
} from 'lucide-react';
import { getAuthSession } from '@/lib/auth-store';
import type { AdSetWithMetrics } from '@/app/api/meta/campaigns/[id]/adsets/route';
import type { MetaAdWithMetrics } from '@/app/api/meta/adsets/[id]/ads/route';
import type { GoogleAdGroup } from '@/app/api/google/campaigns/[id]/adgroups/route';
import type { GoogleAd } from '@/app/api/google/adgroups/[id]/ads/route';
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
import { T } from '@/lib/dashboard-tipografia';
import { ClientAvatar } from '@/components/client-avatar';
import { CreativeRevenueStrip, type CriativoReceita } from '@/components/dashboard/creative-revenue-strip';
import { VendedoresCard, CategoriasCard, type LinhaVendedor, type LinhaCategoria } from '@/components/dashboard/desempenho-comercial';
import type { TopCreative } from '@/app/api/meta/top-creatives/route';
import type { PageInsightsResult, InstagramPageData } from '@/app/api/meta/page-insights/route';
import type { FaturamentoPorOrigem, LeadsPorCanal } from '@/app/api/crm/por-canal/route';
import { progressoVisual } from '@/lib/progresso-cor';
import { montarTabelaRegioes, regiaoDaCampanha, type LinhaTabelaRegiao, type FunilRegiao } from '@/lib/regiao-recorte';
import type { RegiaoCampanhas, RegiaoCampanhasResposta } from '@/app/api/meta/regiao-campanhas/route';
import type { PorRegiaoResposta } from '@/app/api/crm/por-regiao/route';
import type { FunilPorCanalResposta, LinhaCanal as LinhaFunilCanal } from '@/app/api/crm/por-canal-funil/route';
import type { CampaignPerformance } from '@/app/api/campaigns/route';
import type { GoogleKeyword } from '@/app/api/google/keywords/route';
import type { AudienceBreakdowns, AudienceResponse, AudienceSlice } from '@/app/api/audience/route';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { APP_VERSION } from '@/lib/app-version';
import { BackButton } from '@/components/layout/back-button';
import { MetaAdsMark, GoogleAdsMark } from '@/components/platform-logos';
import {
  FUNIL_VAZIO, somarFunis, resolverTopoFunil, rotuloFonteTopo, normalizarFonteTopo,
  ETAPAS_FUNIL,
  type ContagemFunil, type EtapaFunil, type FunilPorStage,
} from '@/lib/funil-etapas';
import { FunilLeadsModal } from '@/components/funil-leads-modal';
import { normalizarSegmento, perfilDaSelecao } from '@/lib/dashboard-segmento';
import { Chapter } from '@/components/dashboard';
import { elementosDelivery } from '@/components/dashboard/delivery-view';
import { ModeloEditor, useModelo } from '@/components/dashboard/modelo-editor';
import { iconePorNome } from '@/components/dashboard/controles-elemento';
import { estiloDe, styleTexto, styleValor, type EstiloElemento } from '@/lib/dashboard-elementos';
import { useDadosDelivery } from '@/components/dashboard/use-dados-delivery';
import { Ga4LandingPanel } from '@/components/dashboard/ga4-landing-panel';
import type { Ga4Consolidado } from '@/lib/ga4-landing';
import {
  formatarMetrica, custoPorPedido, roas as roasFood,
} from '@/lib/metricas-food';
import {
  faixaAtual, faixaAnterior, rotuloComparacao, metaParcialDoPeriodo, rotuloMetaParcial, diasNoMes, datasDaFaixa, fimDoMesIso,
} from '@/lib/dashboard-periodo';
import { statusCpl, statusCplComGasto, ROTULO_STATUS_CPL, CLASSE_STATUS_CPL, TEXTO_STATUS_CPL, type StatusCpl } from '@/lib/dashboard-metas';
import { Donut } from '@/components/dashboard/donut';
import { BulletMetaCard } from '@/components/dashboard/bullet-meta';
import { RitmoMesChart, CplDiarioChart } from '@/components/dashboard/ritmo-chart';
import { SUPERFICIE, Superficie } from '@/components/dashboard/superficie';
import { IndicadorCard, IndicadorMini, FaixaIndicadores } from '@/components/dashboard/indicador-card';

type Period = 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'last_3m' | 'last_6m' | 'this_year' | 'all_time' | 'custom';
type VendasCohort = { periodo: number; anteriores: number; semData: number };
type ClientSheetsSummary = { leads: number; funil: ContagemFunil; total: number; funilStages: FunilPorStage | null; conversasFora: number; leadsValidados: number; vendasCohort: VendasCohort | null };
type ApiMetrics = {
  meta: { spend: number; reach?: number; impressions: number; clicks: number; leads: number; formLeads?: number; siteLeads?: number; conversations?: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number;
  searchImprShare?: number; searchBudgetLostIS?: number; searchRankLostIS?: number; searchAbsTopIS?: number; searchTopIS?: number; } | null;
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
  // Janelas longas (pedido do Matheus, 2026-09-23). "Todo período" = 36 meses,
  // limite de retroatividade da API da Meta — ver MESES_TODO_PERIODO.
  { value: 'last_3m', label: '3 meses' },
  { value: 'last_6m', label: '6 meses' },
  { value: 'this_year', label: 'Este ano' },
  { value: 'all_time', label: 'Todo período' },
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

/**
 * Lê 'YYYY-MM-DD' como data LOCAL.
 *
 * ⚠️ `new Date('2026-08-01')` é meia-noite UTC, enquanto os presets montam
 * meia-noite LOCAL — e `dateKeysInRange` normaliza com `setHours(0,0,0,0)`,
 * que é local. No Brasil (UTC-3) a mistura jogava a série do período
 * personalizado UM DIA PARA TRÁS: pedir 01/08–05/08 devolvia 31/07–04/08.
 */
function parseLocalDate(iso?: string): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Formata uma Date para o `value` de um <input type="date">, sem passar por UTC. */
function toInputDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Faixa do período como Date LOCAL (meia-noite) — derivada de `faixaAtual`,
 * que espelha a semântica do servidor (period-utils: fuso America/Sao_Paulo,
 * "Este mês" = dia 1..hoje, últimos N dias terminando ONTEM). Antes o cliente
 * montava a própria régua e "Este mês" ia até o fim do mês.
 */
function periodToDateRange(
  period: Period,
  customFrom?: string,
  customTo?: string,
): { from: Date; to: Date } {
  const f = faixaAtual(period, customFrom, customTo);
  return { from: parseLocalDate(f.from)!, to: parseLocalDate(f.to)! };
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

/**
 * Meta parcial da janela. Mês corrente = pró-rata até hoje; mês passado = meta
 * inteira; 7/14/30 dias e personalizado = meta × dias da janela ÷ dias do mês.
 * ⚠️ Antes devolvia 0 fora do mês corrente e o card comparava a meta MENSAL
 * inteira com 7 dias de resultado.
 */
function autoPartial(target: number, period: Period, faixa: { from: string; to: string }): number {
  return metaParcialDoPeriodo(target, period, faixa);
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
          <div
            key={c.id}
            className={cn('w-full flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
              selected.has(c.id) ? 'bg-primary/10' : 'hover:bg-muted/50'
            )}
          >
            {/* Checkbox — multi-select */}
            <button
              type="button"
              onClick={() => toggle(c.id)}
              className={cn('w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0 transition-colors',
                selected.has(c.id) ? 'bg-primary border-primary text-black' : 'border-border hover:border-primary/60'
              )}
            >{selected.has(c.id) && '✓'}</button>
            {/* Avatar + nome — single select */}
            <button
              type="button"
              onClick={() => { onChange(new Set([c.id])); setOpen(false); }}
              className="flex items-center gap-2 min-w-0 flex-1 text-left"
            >
              <ClientAvatar clientId={c.id} name={c.name} size="sm" />
              <span className="truncate">{c.name}</span>
            </button>
          </div>
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
  const st = creativeStatusInfo(creative.status);

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
        {/* Selo Ativo/Pausado */}
        {st && (
          <span className={cn('absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide backdrop-blur-sm', st.pill)} title={st.titulo}>
            <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} /> {st.label}
          </span>
        )}
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
  const [imgStage, setImgStage] = useState<'primary' | 'thumb' | 'error'>('primary');

  // Reset state whenever a different creative is opened
  const prevAdId = useRef<string | null>(null);
  if (creative && prevAdId.current !== creative.adId) {
    prevAdId.current = creative.adId;
    setVideoFailed(false);
    setImgStage('primary');
  }

  if (!creative) return null;

  const primaryImgUrl = creative.imageUrl ?? creative.thumbnailUrl;
  const thumbImgUrl = creative.thumbnailUrl;
  const resolvedImgUrl =
    imgStage === 'primary' ? primaryImgUrl
    : imgStage === 'thumb' ? thumbImgUrl
    : undefined;

  function handleImgError() {
    if (imgStage === 'primary' && primaryImgUrl && thumbImgUrl && thumbImgUrl !== primaryImgUrl) {
      setImgStage('thumb');
    } else {
      setImgStage('error');
    }
  }

  const showVideo = !!creative.videoUrl && !videoFailed;
  const showImg = !!resolvedImgUrl && imgStage !== 'error';
  const isVideo = creative.mediaType === 'video';

  // Build iframe embed URL for Meta/Instagram video when direct CDN fails
  const iframeEmbedUrl = (() => {
    if (!creative.permalink) return null;
    if (creative.permalink.includes('instagram.com')) {
      // Extract shortcode from https://www.instagram.com/p/SHORTCODE/
      const match = creative.permalink.match(/instagram\.com\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
      if (match) return `https://www.instagram.com/p/${match[1]}/embed/`;
    }
    // Facebook video embed
    return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(creative.permalink)}&width=500&show_text=false&appId`;
  })();

  const showEmbed = isVideo && (videoFailed || !creative.videoUrl) && !!iframeEmbedUrl;

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
          className="relative flex h-[min(78vh,760px)] w-[min(82vw,560px)] items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black shadow-[0_0_60px_rgba(11,132,255,0.18)]"
          onClick={(event) => event.stopPropagation()}
        >
          {showVideo ? (
            <video
              src={creative.videoUrl}
              poster={resolvedImgUrl}
              controls
              autoPlay
              className="h-full w-full bg-black object-contain"
              onError={() => setVideoFailed(true)}
            />
          ) : showEmbed ? (
            // iframe embed — reliable playback via Meta/Instagram player when CDN URL fails.
            // ⚠️ O embed dimensiona a MÍDIA pela LARGURA do iframe e ainda põe
            // cabeçalho (perfil) + rodapé (~120px) em cima e embaixo. Um reel 9:16 a
            // 560px de largura precisa de ~1.100px de altura e a caixa tem 760px —
            // era isso que cortava o vídeo. A largura é derivada da ALTURA
            // disponível (altura da caixa − chrome) × 9/16, então o reel inteiro cabe.
            <iframe
              src={iframeEmbedUrl!}
              className="h-full border-0 bg-black"
              style={{ width: 'calc((min(78vh, 760px) - 120px) * 9 / 16)', maxWidth: '100%' }}
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
              allowFullScreen
            />
          ) : showImg ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedImgUrl}
              alt={creative.adName}
              className="h-full w-full bg-black object-contain"
              style={{ imageRendering: 'auto' }}
              loading="eager"
              onError={handleImgError}
            />
          ) : creative.permalink ? (
            /* Video creative with no playable source or thumbnail — link to original */
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

          {/* When using CDN video with a permalink — offer embed as fallback */}
          {isVideo && videoFailed && !iframeEmbedUrl && creative.permalink && showImg && (
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
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-widest text-white/50">Criativo</p>
            {(() => {
              const st = creativeStatusInfo(creative.status);
              return st ? (
                <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide', st.pill)} title={st.titulo}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} /> {st.label}
                </span>
              ) : null;
            })()}
          </div>
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

/** "agora" / "5 min" / "3 h" / "2 dias" — a partir de segundos de idade. */
function idadeCurta(segundos: number): string {
  if (!Number.isFinite(segundos) || segundos < 0) return '—';
  if (segundos < 60) return 'agora';
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  const h = Math.round(segundos / 3600);
  if (h < 24) return `${h} h`;
  const d = Math.round(segundos / 86400);
  return `${d} ${d === 1 ? 'dia' : 'dias'}`;
}

/**
 * Selo Ativo/Pausado do criativo a partir do effective_status do Meta.
 * Cor + rótulo (nunca cor sozinha): verde = rodando, âmbar = pausado,
 * cinza = arquivado/desconhecido, vermelho = com restrição/reprovado.
 * `null` quando o status não veio (não inventa "Ativo").
 */
function creativeStatusInfo(status?: string): { label: string; dot: string; pill: string; titulo: string } | null {
  if (!status) return null;
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return { label: 'Ativo', dot: 'bg-emerald-400', pill: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300', titulo: 'Anúncio ativo' };
  if (s === 'PAUSED' || s === 'ADSET_PAUSED' || s === 'CAMPAIGN_PAUSED')
    return { label: 'Pausado', dot: 'bg-amber-400', pill: 'border-amber-400/30 bg-amber-400/15 text-amber-300', titulo: `Pausado (${s})` };
  if (s === 'DISAPPROVED' || s === 'WITH_ISSUES')
    return { label: 'Com restrição', dot: 'bg-red-400', pill: 'border-red-400/30 bg-red-400/15 text-red-300', titulo: `Com restrição no Meta (${s})` };
  if (s === 'PENDING_REVIEW' || s === 'IN_PROCESS' || s === 'PENDING_BILLING_INFO' || s === 'PREAPPROVED')
    return { label: 'Em análise', dot: 'bg-sky-400', pill: 'border-sky-400/30 bg-sky-400/15 text-sky-300', titulo: `Em análise (${s})` };
  return { label: 'Inativo', dot: 'bg-[#9aa4aa]', pill: 'border-white/15 bg-white/[0.08] text-[#c3ccd1]', titulo: `Inativo (${s})` };
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

// ─── Campaign Performance Table ───────────────────────────────────────────────

type ChildState = { loading: boolean; data: unknown[] };


type ExpandableRow =
  | { kind: 'campaign'; key: string; fetchUrl: string; data: CampaignPerformance; level: 0; colorIdx: number }
  | { kind: 'adset'; key: string; fetchUrl: string; data: AdSetWithMetrics; campaign: CampaignPerformance; level: 1; colorIdx: number }
  | { kind: 'meta-ad'; key: string; data: MetaAdWithMetrics; adset: AdSetWithMetrics; campaign: CampaignPerformance; level: 2; colorIdx: number }
  | { kind: 'adgroup'; key: string; fetchUrl: string; data: GoogleAdGroup; campaign: CampaignPerformance; level: 1; colorIdx: number }
  | { kind: 'google-ad'; key: string; data: GoogleAd; adgroup: GoogleAdGroup; campaign: CampaignPerformance; level: 2; colorIdx: number }
  | { kind: 'loading'; key: string; level: 1 | 2; colorIdx: number };

function canExpand(r: ExpandableRow): r is Extract<ExpandableRow, { fetchUrl: string }> {
  return 'fetchUrl' in r;
}

/** URL dos filhos de uma campanha (conjuntos na Meta, grupos no Google). */
function urlFilhosCampanha(c: CampaignPerformance, periodParams: string): string {
  return c.platform === 'meta'
    ? `/api/meta/campaigns/${c.id}/adsets?connectionId=${c.connectionId}&${periodParams}`
    : `/api/google/campaigns/${c.id}/adgroups?connectionId=${c.connectionId}&accountId=${c.accountId}${c.loginCustomerId ? `&loginCustomerId=${c.loginCustomerId}` : ''}&${periodParams}`;
}

/** URL dos anúncios de um conjunto da Meta. */
function urlAnunciosConjunto(adsetId: string, c: CampaignPerformance, periodParams: string): string {
  return `/api/meta/adsets/${adsetId}/ads?connectionId=${c.connectionId}&${periodParams}`;
}

const INDENT = ['pl-2', 'pl-8', 'pl-14'] as const;

const CAMPAIGN_ROW_COLORS = [
  '#6cff2f', // verde onmid
  '#0ea5e9', // azul
  '#7b2cff', // roxo
  '#f97316', // laranja
  '#ec4899', // pink
  '#f59e0b', // amarelo
  '#06b6d4', // ciano
  '#84cc16', // lima
];

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
  metaCpl = 0,
  abrirTudo = false,
  preencher = false,
}: {
  campaigns: CampaignPerformance[];
  loading: boolean;
  period: string;
  dateFrom: string;
  dateTo: string;
  /** Meta de CPL do planejamento — pinta a célula de CPL (0 = neutro). */
  metaCpl?: number;
  /** Abre sozinho campanhas → conjuntos → anúncios (Meta; pedido do Matheus, 2026-09-24). */
  abrirTudo?: boolean;
  /** Em tela larga ocupa a altura do card vizinho, com rolagem interna, sem esticar a linha. */
  preencher?: boolean;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  // IS%/IS Orç./Topo Abs. só existem no Google Search: numa tabela só de Meta
  // eram três colunas de "—" empurrando as ações para fora da tela.
  const mostrarIS = campaigns.some(c => c.platform === 'google');
  // Tabela de UMA plataforma (o logo já está no título do card): a coluna
  // "Plataforma" só repetia o mesmo ícone em todas as linhas.
  const mostrarPlataforma = new Set(campaigns.map(c => c.platform)).size > 1;
  // Só CONSULTA (pedido do Matheus, 2026-09-24): pausar/ativar, editar verba e
  // otimizar saíram da dashboard — ação em campanha é no gerenciador/CRM, não
  // num painel de leitura onde um clique errado pausa a conta do cliente.
  const totalColunas = (mostrarIS ? 10 : 7) + (mostrarPlataforma ? 1 : 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, ChildState>>({});
  const [adPreview, setAdPreview] = useState<{ ad: MetaAdWithMetrics; x: number; y: number } | null>(null);
  const adPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tableExpanded, setTableExpanded] = useState(false);

  useEffect(() => { setCampaigns(initialCampaigns); }, [initialCampaigns]);

  const periodParams = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params.toString();
  }, [period, dateFrom, dateTo]);

  // Abrir tudo: busca os conjuntos de TODAS as campanhas e, em seguida, os
  // anúncios de todos os conjuntos, e marca tudo como expandido. Refaz quando
  // muda o conjunto de campanhas ou o período (senão ficariam números velhos
  // nas linhas filhas). O usuário ainda pode recolher à mão.
  // ⚠️ Sem cleanup de efeito: `campaigns` troca de referência a cada
  // re-render do pai (setCampaigns(initialCampaigns)) e o cleanup marcava a
  // busca em voo como cancelada ANTES de a nova rodada ver que a assinatura
  // era a mesma e sair — a tabela nunca abria em produção (24/09). Agora só uma
  // rodada com assinatura NOVA cancela a anterior.
  const vooAbrirTudo = useRef<{ assinatura: string; cancelado: boolean } | null>(null);
  useEffect(() => {
    if (!abrirTudo || campaigns.length === 0) return;
    const assinatura = `${campaigns.map(c => c.id).join(',')}|${periodParams}`;
    if (vooAbrirTudo.current?.assinatura === assinatura) return;
    if (vooAbrirTudo.current) vooAbrirTudo.current.cancelado = true;
    const voo = { assinatura, cancelado: false };
    vooAbrirTudo.current = voo;
    const buscar = async (url: string): Promise<unknown[]> => {
      try { const r = await fetch(url); const d = await r.json(); return Array.isArray(d) ? d : []; } catch { return []; }
    };
    void (async () => {
      const filhos = await Promise.all(campaigns.map(c => buscar(urlFilhosCampanha(c, periodParams))));
      if (voo.cancelado) return;
      const mapa: Record<string, ChildState> = {};
      const abertos = new Set<string>();
      const conjuntos: Array<{ key: string; url: string }> = [];
      campaigns.forEach((c, i) => {
        mapa[c.id] = { loading: false, data: filhos[i] as ChildState['data'] };
        abertos.add(c.id);
        if (c.platform !== 'meta') return;
        for (const a of filhos[i] as AdSetWithMetrics[]) {
          const key = `${c.id}:${a.id}`;
          mapa[key] = { loading: true, data: [] };
          abertos.add(key);
          conjuntos.push({ key, url: urlAnunciosConjunto(a.id, c, periodParams) });
        }
      });
      setChildrenMap(mapa);
      setExpanded(abertos);
      const anuncios = await Promise.all(conjuntos.map(x => buscar(x.url)));
      if (voo.cancelado) return;
      setChildrenMap(prev => {
        const next = { ...prev };
        conjuntos.forEach((x, i) => { next[x.key] = { loading: false, data: anuncios[i] as ChildState['data'] }; });
        return next;
      });
    })();
  }, [abrirTudo, campaigns, periodParams]);

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
    let campaignIdx = 0;
    for (const campaign of campaigns) {
      const campKey = campaign.id;
      const colorIdx = campaignIdx++ % CAMPAIGN_ROW_COLORS.length;
      const campUrl = urlFilhosCampanha(campaign, periodParams);

      result.push({ kind: 'campaign', key: campKey, fetchUrl: campUrl, data: campaign, level: 0, colorIdx });

      if (expanded.has(campKey)) {
        const campChildren = childrenMap[campKey];
        if (campChildren?.loading) {
          result.push({ kind: 'loading', key: `${campKey}:loading`, level: 1, colorIdx });
        } else {
          for (const child of campChildren?.data ?? []) {
            if (campaign.platform === 'meta') {
              const adset = child as AdSetWithMetrics;
              const adsetKey = `${campKey}:${adset.id}`;
              const adsetUrl = urlAnunciosConjunto(adset.id, campaign, periodParams);
              result.push({ kind: 'adset', key: adsetKey, fetchUrl: adsetUrl, data: adset, campaign, level: 1, colorIdx });
              if (expanded.has(adsetKey)) {
                const adChildren = childrenMap[adsetKey];
                if (adChildren?.loading) {
                  result.push({ kind: 'loading', key: `${adsetKey}:loading`, level: 2, colorIdx });
                } else {
                  for (const ad of (adChildren?.data ?? []) as MetaAdWithMetrics[]) {
                    result.push({ kind: 'meta-ad', key: `${adsetKey}:${ad.id}`, data: ad, adset, campaign, level: 2, colorIdx });
                  }
                }
              }
            } else {
              const adgroup = child as GoogleAdGroup;
              const adgroupKey = `${campKey}:${adgroup.id}`;
              const adgroupUrl = `/api/google/adgroups/${adgroup.id}/ads?connectionId=${campaign.connectionId}&accountId=${campaign.accountId}${campaign.loginCustomerId ? `&loginCustomerId=${campaign.loginCustomerId}` : ''}&${periodParams}`;
              result.push({ kind: 'adgroup', key: adgroupKey, fetchUrl: adgroupUrl, data: adgroup, campaign, level: 1, colorIdx });
              if (expanded.has(adgroupKey)) {
                const adChildren = childrenMap[adgroupKey];
                if (adChildren?.loading) {
                  result.push({ kind: 'loading', key: `${adgroupKey}:loading`, level: 2, colorIdx });
                } else {
                  for (const ad of (adChildren?.data ?? []) as GoogleAd[]) {
                    result.push({ kind: 'google-ad', key: `${adgroupKey}:${ad.id}`, data: ad, adgroup, campaign, level: 2, colorIdx });
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

  if (loading) {
    return (
      <div className="py-6">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" /> Carregando campanhas do período...
        </div>
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <div className="py-6">
        <p className="text-sm font-semibold text-foreground">Nenhuma campanha ativa no período.</p>
        <p className="mt-1 text-xs text-muted-foreground">Quando houver investido nas contas vinculadas, as campanhas aparecem aqui com as métricas do período.</p>
      </div>
    );
  }

  function renderRow(row: ExpandableRow) {
    if (row.kind === 'loading') {
      return (
        <tr key={row.key} className="border-t border-border/50">
          <td colSpan={totalColunas} className={cn('px-4 py-2', INDENT[row.level])}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" /> Carregando...
            </div>
          </td>
        </tr>
      );
    }

    const isExpanded = 'fetchUrl' in row && expanded.has(row.key);
    const expandable = canExpand(row);

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
      displayStatus = row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
      dailyBudget = row.data.daily_budget;
    } else if (row.kind === 'meta-ad') {
      displayStatus = row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
    } else if (row.kind === 'adgroup') {
      displayStatus = row.data.status;
      displayName = row.data.name;
      spend = row.data.spend;
      impressions = row.data.impressions;
      clicks = row.data.clicks;
      leads = row.data.leads;
      ctr = row.data.ctr;
      cpl = row.data.cpl;
    } else {
      // google-ad
      displayStatus = row.data.status;
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
    const rowColor = CAMPAIGN_ROW_COLORS[row.colorIdx % CAMPAIGN_ROW_COLORS.length];

    const isMetaAd = row.kind === 'meta-ad';
    // Campanha que gastou 2× a meta de CPL sem nenhum lead. Fica fora quem tem
    // objetivo que não busca lead (tráfego/alcance/vídeo): ali 0 lead é esperado.
    const objetivoCampanha = row.kind === 'campaign' ? String(row.data.objective ?? '') : '';
    const semLeadQueimando = row.kind === 'campaign' && !(leads > 0) && metaCpl > 0 && spend >= metaCpl * 2
      && !/TRAFFIC|AWARENESS|REACH|VIDEO/i.test(objetivoCampanha);

    return (
      <tr
        key={row.key}
        className={cn('border-t border-white/[0.07] transition-colors hover:bg-white/[0.07]', !isActive && 'opacity-60', levelBg)}
      >
        {/* Name column — whole name area is clickable when expandable */}
        <td
          className="w-full max-w-0 px-2 py-0"
          style={{ borderLeft: `2px solid ${row.level === 0 ? rowColor + '99' : rowColor + '40'}` }}
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
              <p className={cn('truncate font-semibold', row.level === 0 ? 'text-xs font-bold' : row.level === 1 ? 'text-xs' : 'text-[11px] text-foreground/55')} title={displayName}>
                {displayName}
              </p>
              {row.kind === 'campaign' && (
                <p className="truncate text-[11px] text-foreground/45">{row.data.accountName}</p>
              )}
              {row.kind === 'adset' && (row.data.targeting?.geo_locations?.countries?.length ?? 0) > 0 && (
                <p className="truncate text-[10px] text-foreground/45">{(row.data.targeting.geo_locations?.countries ?? []).join(', ')}</p>
              )}
            </div>
          </div>
        </td>

        {mostrarPlataforma && (
          <td className="px-2 py-2.5 text-center">
            {row.kind === 'campaign' ? (
              <PlatformTableIcon platform={row.data.platform} />
            ) : (
              <span className="text-xs text-muted-foreground/30">—</span>
            )}
          </td>
        )}

        {/* Verba/dia — só leitura */}
        <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-semibold">
          {dailyBudget != null ? formatCurrencyBRL(dailyBudget) : <span className="text-muted-foreground/40">—</span>}
        </td>

        {/* Metrics */}
        <td className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-bold text-primary">{formatCurrencyBRL(spend)}</td>
        <td className="px-2 py-2.5 text-right text-xs font-semibold">{leads > 0 ? Math.round(leads).toLocaleString('pt-BR') : <span className="text-muted-foreground/40">—</span>}</td>
        <td
          className={cn('whitespace-nowrap px-2 py-2.5 text-right text-xs font-semibold', cpl > 0 && TEXTO_STATUS_CPL[statusCpl(cpl, metaCpl)])}
          title={cpl > 0 && metaCpl > 0 ? `${(cpl / metaCpl).toFixed(2).replace('.', ',')}× a meta de CPL (${formatCurrencyBRL(metaCpl)})` : undefined}
        >{cpl > 0 ? formatCurrencyBRL(cpl) : semLeadQueimando ? (
          <span className="rounded border border-[#e52020]/40 bg-[#e52020]/14 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#ff6b6b]" title={`Gastou ${formatCurrencyBRL(spend)} sem nenhum lead — mais de 2× a meta de CPL (${formatCurrencyBRL(metaCpl)})`}>Sem lead</span>
        ) : <span className="text-muted-foreground/40">—</span>}</td>
        <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">{impressions > 0 ? impressions.toLocaleString('pt-BR') : <span className="opacity-40">—</span>}</td>
        <td className="px-2 py-2.5 text-right text-xs text-muted-foreground">{ctr > 0 ? `${ctr.toFixed(2).replace('.', ',')}%` : <span className="opacity-40">—</span>}</td>

        {/* IS metrics — Google Search campaigns only */}
        {mostrarIS && (() => {
          const isGoogleCampaign = row.kind === 'campaign' && row.data.platform === 'google';
          const imprShare = isGoogleCampaign ? (row.data as CampaignPerformance).searchImprShare : undefined;
          const budgetLostIS = isGoogleCampaign ? (row.data as CampaignPerformance).searchBudgetLostIS : undefined;
          const absTopIS = isGoogleCampaign ? (row.data as CampaignPerformance).searchAbsTopIS : undefined;
          return (
            <>
              <td className="px-2 py-2.5 text-right text-xs font-semibold">
                {imprShare != null ? <span className="text-[#6cff2f]">{imprShare.toFixed(1).replace('.', ',')}%</span> : <span className="opacity-40">—</span>}
              </td>
              <td className="px-2 py-2.5 text-right text-xs font-semibold">
                {budgetLostIS != null ? <span className={budgetLostIS > 20 ? 'text-red-400' : 'text-muted-foreground'}>{budgetLostIS.toFixed(1).replace('.', ',')}%</span> : <span className="opacity-40">—</span>}
              </td>
              <td className="px-2 py-2.5 text-right text-xs font-semibold">
                {absTopIS != null ? <span className="text-[#6cff2f]">{absTopIS.toFixed(1).replace('.', ',')}%</span> : <span className="opacity-40">—</span>}
              </td>
            </>
          );
        })()}

      </tr>
    );
  }

  const campaignCount = campaigns.length;

  return (
    <>
      {adPreview && <AdCreativePreview ad={adPreview.ad} x={adPreview.x} y={adPreview.y} />}
      <div className={cn('-mx-2', preencher && '2xl:relative 2xl:min-h-[220px] 2xl:flex-1')}>
        <div
          className={cn('overflow-auto transition-all duration-300', preencher && 'max-h-[560px] 2xl:absolute 2xl:inset-0 2xl:max-h-none')}
          style={preencher ? undefined : { maxHeight: tableExpanded ? '9999px' : '288px' }}
        >
          {/* Cabeçalhos curtos e sem min-width largo: a tabela do Google tinha
              12 colunas e passava de 1080px — IS/Perda orç./Topo sumiam à
              direita num notebook de 1440px. O nome da campanha absorve a
              sobra (w-full max-w-0) e trunca com o nome inteiro no title. */}
          <table className={cn('w-full text-left', mostrarIS ? 'min-w-[760px]' : 'min-w-[560px]')}>
            <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#0d1519]">
              <tr className={T.tabelaCab}>
                <th className="px-2 py-2.5">Nome</th>
                {mostrarPlataforma && <th className="px-2 py-2.5 text-center">Plat.</th>}
                <th className="whitespace-nowrap px-2 py-2.5 text-right">Verba/dia</th>
                <th className="px-2 py-2.5 text-right">Investido</th>
                <th className="px-2 py-2.5 text-right">Result.</th>
                <th className="px-2 py-2.5 text-right">CPL</th>
                <th className="px-2 py-2.5 text-right">Impr.</th>
                <th className="px-2 py-2.5 text-right">CTR</th>
                {mostrarIS && (
                  <>
                    <th className="px-2 py-2.5 text-right" title="Parcela de impressões na Rede de Pesquisa">IS</th>
                    <th className="whitespace-nowrap px-2 py-2.5 text-right" title="Parcela de impressões perdida por orçamento">Perda orç.</th>
                    <th className="px-2 py-2.5 text-right" title="Parcela de impressões no topo absoluto">Topo</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(renderRow)}
            </tbody>
          </table>
        </div>
        {!preencher && campaignCount > 4 && (
          <button
            type="button"
            onClick={() => setTableExpanded(prev => !prev)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.06] py-2 text-[11px] font-semibold text-foreground/50 transition-colors hover:bg-white/[0.04] hover:text-foreground/80"
          >
            {tableExpanded ? (
              <><ChevronUp className="h-3.5 w-3.5" /> Recolher</>
            ) : (
              <><ChevronDown className="h-3.5 w-3.5" /> Ver todas {campaignCount} campanhas</>
            )}
          </button>
        )}
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
                    className="max-md:opacity-100 w-5 shrink-0 flex items-center justify-center text-muted-foreground/30 hover:text-[#E1306C] transition-colors opacity-0 group-hover:opacity-100"
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
  // ⚠️ Arredonda: o formato 'number' desta tela é sempre CONTAGEM (leads,
  // cliques, impressões, alcance, pedidos) e contagem não tem casa decimal.
  //
  // O Google Ads devolve `metrics.conversions` como DOUBLE de propósito —
  // atribuição não-último-clique divide o crédito de uma conversão entre os
  // pontos de contato, então uma campanha fica com uma fração dela. Medido em
  // produção na Londrigifts: 253,998318 + 139,166666 + 6 + 26,331404 + 2 =
  // 427,496388. Somado ao Meta, o card de Leads mostrava "376,998" como se
  // fosse gente. O número é REAL; o que não fazia sentido era exibi-lo assim.
  // A precisão continua inteira em tudo que é conta (CPL, taxas, séries).
  return Math.round(value).toLocaleString('pt-BR');
}

function PremiumPanel({ children, className = '', style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={cn(SUPERFICIE, className)} style={style}>
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

/**
 * Estilo por elemento nos cards da própria página.
 *
 * ⚠️ Sem isto o hero e a faixa de KPIs seriam os ÚNICOS pedaços do dashboard de
 * food não editáveis — e são justamente os que o Matheus citou ("quero deixar só
 * faturamento", "mudar a cor", "deixar o ícone maior"). O `estilo` chega do
 * modelo por segmento; ausente, tudo fica exatamente como era.
 */
const ESTILO_VAZIO: EstiloElemento = {};

function GoalProgressCard({
  title, icon: Icon, target, partial, value, format = 'number', estilo = ESTILO_VAZIO, className,
}: {
  title: string;
  icon: React.ElementType;
  target: number;
  partial: number;
  value: number;
  format?: PremiumMetricFormat;
  estilo?: EstiloElemento;
  className?: string;
}) {
  const base = partial > 0 ? partial : target;
  // rawProgress é o número VERDADEIRO (pode passar de 100%); o clamp é só da
  // largura da barra — clampar o rótulo travava "100,00%" pra quem fez 250%.
  const rawProgress = base > 0 ? Math.max(0, (value / base) * 100) : 0;
  const progress = Math.min(100, rawProgress);
  // Cor por faixa: vermelho → amarelo → azul → verde, com degradê na troca.
  const visual = progressoVisual(rawProgress);
  // O rótulo fica centrado: só está por cima da barra quando ela passa da
  // metade. Antes disso está sobre o fundo escuro e precisa de texto claro.
  const escuro = progress >= 52 && visual.textoEscuro;
  const iconSize = estilo.tamanhoIcone ?? 40;
  return (
    <PremiumPanel className={cn('relative overflow-hidden p-5', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(108,255,47,0.16),transparent_32%),linear-gradient(135deg,rgba(108,255,47,0.05),rgba(22,139,255,0.02))]" />
      <div className="relative flex items-start gap-4">
        <span
          className={cn('flex shrink-0 items-center justify-center rounded-full border border-current/20 bg-current/10', !estilo.corIcone && 'text-[#6cff2f]')}
          style={{ width: iconSize, height: iconSize, ...(estilo.corIcone ? { color: estilo.corIcone } : {}) }}
        >
          <Icon style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]" style={styleTexto(estilo)}>{estilo.texto ?? title}</h2>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              ['Meta', target],
              ['Meta Parcial', partial],
              ['Realizado', value],
            ].map(([label, amount]) => (
              <div key={String(label)} className="min-w-0">
                <p className="truncate font-heading text-2xl leading-none text-[#f4f7f8]" style={styleValor(estilo)}>{Number(amount) > 0 ? premiumValue(Number(amount), format) : '—'}</p>
                <p className="mt-1.5 text-xs font-medium text-[#a7b0b6]">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-5">
            <div className="relative h-7 overflow-hidden rounded-md border border-white/10 bg-[#081014]">
              <div
                className={cn('absolute inset-y-0 left-0 rounded-md', visual.estourou && 'meta-estourada')}
                style={{
                  width: `${progress}%`,
                  backgroundColor: visual.cor,
                  backgroundImage: 'repeating-linear-gradient(45deg,rgba(255,255,255,0.12) 0 12px,transparent 12px 24px)',
                  // Glow da PRÓPRIA cor da barra — fixo em verde, o vermelho
                  // ganhava um halo verde e a faixa deixava de comunicar risco.
                  ...(visual.estourou ? {} : { boxShadow: `0 0 16px ${visual.cor}8c` }),
                  // ⚠️ É daqui que vem o "degradê na hora de trocar": a cor é
                  // ANIMADA entre uma faixa e outra, em vez de saltar. A rampa
                  // por percentual sozinha não bastaria — amarelo e azul são
                  // quase opostos e não têm meio-termo honesto.
                  transition: 'width 600ms ease, background-color 700ms ease, box-shadow 700ms ease',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                {/* Cor do rótulo decidida pela luminância da barra: preto sobre
                    o azul ou o vermelho é ilegível, e com progresso baixo o
                    rótulo nem está por cima da barra. */}
                <span
                  className={cn('text-sm font-black', escuro ? 'text-black' : 'text-[#f4f7f8]')}
                  // Contorno na cor oposta: no meio da barra o rótulo fica em
                  // cima da parte preenchida E da vazia ao mesmo tempo, então
                  // uma cor só sempre some numa das duas metades.
                  style={{ textShadow: escuro ? '0 1px 2px rgba(255,255,255,0.45)' : '0 1px 3px rgba(0,0,0,0.9)' }}
                >
                  {rawProgress > 0 ? premiumValue(rawProgress, 'percent') : '—'}
                </span>
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

// Hero grande sem meta — o par do GoalProgressCard para métrica que não é alvo
// (ex.: Ticket médio no food). Mesma moldura premium; mostra valor + variação.
function HeroStatCard({ title, icon: Icon, value, change, sub, estilo = ESTILO_VAZIO, className }: {
  title: string;
  icon: React.ElementType;
  value: string;
  change?: number | null;
  sub?: string;
  estilo?: EstiloElemento;
  className?: string;
}) {
  const hasChange = change !== null && change !== undefined && Number.isFinite(change);
  const positive = hasChange && change >= 0;
  const iconSize = estilo.tamanhoIcone ?? 40;
  return (
    <PremiumPanel className={cn('relative overflow-hidden p-5', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(108,255,47,0.16),transparent_32%),linear-gradient(135deg,rgba(108,255,47,0.05),rgba(22,139,255,0.02))]" />
      <div className="relative flex items-start gap-4">
        <span
          className={cn('flex shrink-0 items-center justify-center rounded-full border border-current/20 bg-current/10', !estilo.corIcone && 'text-[#6cff2f]')}
          style={{ width: iconSize, height: iconSize, ...(estilo.corIcone ? { color: estilo.corIcone } : {}) }}
        >
          <Icon style={{ width: iconSize * 0.5, height: iconSize * 0.5 }} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]" style={styleTexto(estilo)}>{estilo.texto ?? title}</h2>
          <p className="mt-5 font-heading text-4xl leading-none text-[#f4f7f8]" style={styleValor(estilo)}>{value}</p>
          <p className={cn('mt-3 text-sm font-bold', !hasChange ? 'text-[#7c868c]' : positive ? 'text-[#6cff2f]' : 'text-red-400')}>
            {hasChange ? `${change >= 0 ? '+' : ''}${change.toFixed(1).replace('.', ',')}%` : '—'}{' '}
            <span className="font-medium text-[#a7b0b6]">vs período anterior</span>
          </p>
          {sub && <p className="mt-1.5 text-xs text-[#a7b0b6]">{sub}</p>}
        </div>
      </div>
    </PremiumPanel>
  );
}

function QuickMetricCard({ title, value, change, icon: Icon, inverseChange, neutralChange, estilo = ESTILO_VAZIO, className, comparacao = 'vs período anterior', serie, dica, nota, notaRuim }: {
  title: string;
  /** Métrica sem direção boa/ruim (ex.: investimento): variação em cinza. */
  neutralChange?: boolean;
  value: string;
  change?: number | null;
  icon: React.ElementType;
  inverseChange?: boolean;
  estilo?: EstiloElemento;
  className?: string;
  /** Rótulo do comparativo ("vs 1–22/ago", "vs 7 dias anteriores"). */
  comparacao?: string;
  /** Série diária para a sparkline (omitida = sem gráfico). */
  serie?: number[];
  /** Tooltip do título (ex.: como o número é calculado). */
  dica?: string;
  /** Linha sob o valor — usada para a META do planejamento ("meta R$ 30,00"). */
  nota?: ReactNode;
  /** Pinta a nota de vermelho (estourou a meta). */
  notaRuim?: boolean;
}) {
  // Delegado ao IndicadorCard — o MESMO card de KPI da Landing page e do
  // Instagram. O `estilo` (modelo por segmento, food) vira overrides dele.
  return (
    <IndicadorCard
      rotulo={estilo.texto ?? title}
      valor={value}
      icone={Icon}
      cor={estilo.corIcone ?? undefined}
      tamanhoIcone={estilo.tamanhoIcone ?? undefined}
      variacao={change ?? null}
      inverso={inverseChange}
      neutro={neutralChange}
      comparacao={comparacao}
      serie={serie}
      dica={dica}
      nota={nota}
      notaRuim={notaRuim}
      estiloRotulo={styleTexto(estilo)}
      estiloValor={styleValor(estilo)}
      className={className}
      style={estilo.corFundo ? { backgroundColor: estilo.corFundo } : undefined}
    />
  );
}

/**
 * Paleta categórica do donut.
 *
 * ⚠️ Não é escolha de gosto: são os 8 tons validados contra a superfície do
 * painel (#0d1519) — banda de luminosidade, piso de croma, separação sob
 * daltonismo (pior par ΔE 8,4) e contraste ≥ 3:1. Gerar um 9º tom quebraria
 * a separação, então o 9º canal em diante vira "Outros".
 */
const CORES_CANAL = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
/** Cinza reservado: "Outros" e "sem canal" não são um canal, não ganham hue. */
const CINZA_CANAL = '#6b7478';
const MAX_FATIAS = 7;

/** Não são canal: ficam em cinza e não consomem tom da paleta. */
function canalNeutro(label: string): boolean {
  return label.startsWith('Outros') || label === 'Canal não informado';
}

/**
 * Marcas com COR e LOGO fixos na legenda (pedido do Matheus: azul p/ Facebook,
 * rosa p/ Instagram, vermelho p/ Google; WhatsApp entra junto por consistência,
 * é o canal dominante da base). Cor fixa por marca deixa a leitura instantânea e
 * estável entre períodos, e o logo na legenda remove qualquer ambiguidade com um
 * tom parecido da paleta.
 *
 * ⚠️ A ordem importa: canal composto ("Facebook - WhatsApp") é atribuído pela
 * PLATAFORMA de mídia — a origem do anúncio é o que informa —, não pelo destino.
 * WhatsApp/Chatwoot puros caem no verde.
 */
function LogoInstagram() {
  return <IgMark className="h-4 w-4" />;
}
function LogoFacebook() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <rect width="20" height="20" rx="5" fill="#1877F2" />
      <path d="M11 5H9.5C8.7 5 8 5.7 8 6.5V8H6v2.5h2V17h3v-6.5h2.5L14 8h-3V6.5c0-.3.2-.5.5-.5H14V5h-3z" fill="#fff" />
    </svg>
  );
}
function LogoGoogle() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.29h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.64z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.26a12 12 0 0 0 0 10.75l4.01-3.11z" />
      <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.62l4.01 3.11C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}
function LogoWhatsApp() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.53 15.2L2 22l4.94-1.4A10 10 0 1 0 12 2z" />
      <path fill="#fff" d="M9.1 7.3c-.2-.45-.4-.46-.6-.47l-.5-.01c-.17 0-.45.06-.68.32-.23.25-.9.87-.9 2.12s.92 2.46 1.05 2.63c.13.17 1.8 2.88 4.45 3.92 2.2.87 2.65.7 3.13.65.48-.04 1.55-.63 1.77-1.25.22-.62.22-1.15.15-1.26-.07-.11-.24-.17-.5-.3-.26-.13-1.55-.76-1.79-.85-.24-.09-.41-.13-.59.13-.17.26-.67.85-.82 1.02-.15.17-.3.19-.56.06-.26-.13-1.1-.4-2.1-1.29-.78-.69-1.3-1.55-1.46-1.81-.15-.26-.01-.4.12-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.43.09-.17.05-.32-.01-.45-.07-.13-.58-1.42-.79-1.94z" />
    </svg>
  );
}

type MarcaCanal = { cor: string; logo: ReactNode };
const MARCAS_CANAL: { teste: RegExp; cor: string; Logo: () => React.ReactElement }[] = [
  { teste: /instagram/, cor: '#E1306C', Logo: LogoInstagram },
  { teste: /facebook/, cor: '#1877F2', Logo: LogoFacebook },
  { teste: /google/, cor: '#EA4335', Logo: LogoGoogle },
  { teste: /whats|chatwoot/, cor: '#25D366', Logo: LogoWhatsApp },
];

/** Cor+logo fixos da marca do canal, ou null quando é canal genérico/neutro. */
function marcaDoCanal(label: string): MarcaCanal | null {
  if (canalNeutro(label)) return null;
  // Marca casa por palavra ASCII (instagram/facebook/google/whats) — sem acento a tratar.
  const n = label.toLowerCase();
  const m = MARCAS_CANAL.find((x) => x.teste.test(n));
  return m ? { cor: m.cor, logo: <m.Logo /> } : null;
}

/**
 * Cor por NOME do canal, não por posição no ranking.
 *
 * Trocar o período reordena a lista; se a cor viesse do rank, "Indicação"
 * mudaria de cor a cada filtro e comparar dois períodos seria impossível.
 *
 * ⚠️ A atribuição percorre os rótulos em ordem ALFABÉTICA, não na ordem em que
 * chegaram. O hash escolhe o tom preferido, mas colisão cai no próximo livre —
 * e resolver isso na ordem do ranking fazia a cor depender do ranking de novo,
 * pela porta dos fundos: nos dois donuts lado a lado o mesmo "Facebook" saía
 * violeta num e salmão no outro.
 */
function coresPorCanal(labels: string[]): Record<string, string> {
  const usados = new Set<number>();
  const out: Record<string, string> = {};
  // Marca com cor fixa (Instagram/Facebook/Google/WhatsApp) não entra no rodízio
  // da paleta — senão gastaria um tom e poderia mudar a cor de um canal genérico.
  for (const label of [...labels].filter(l => !canalNeutro(l) && !marcaDoCanal(l)).sort()) {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    let slot = h % CORES_CANAL.length;
    for (let t = 0; t < CORES_CANAL.length && usados.has(slot); t++) slot = (slot + 1) % CORES_CANAL.length;
    usados.add(slot);
    out[label] = CORES_CANAL[slot];
  }
  return out;
}

type FatiaCanal = { label: string; valor: number; nota?: string };

/**
 * Donut de composição por canal. Serve tanto ao faturamento quanto aos leads:
 * a diferença entre os dois é só o que se soma — a leitura, a paleta e o
 * tratamento do "sem canal" são os mesmos, e duplicar o componente faria os
 * dois divergirem na primeira mudança.
 */
function CanalDonutCard({ titulo, fatiasBrutas, total, semCanal, formato, aviso }: {
  titulo: string;
  fatiasBrutas: FatiaCanal[];
  total: number;
  semCanal: number;
  formato: PremiumMetricFormat;
  /** Texto do rodapé quando a fatia sem canal é grande. */
  aviso: string;
}) {
  const pctSemCanal = total > 0 ? (semCanal / total) * 100 : 0;
  // Lista de barras horizontais ORDENADA no lugar do donut: comparar ângulos de
  // 8 fatias é chute; comparar comprimentos alinhados na mesma base é leitura.
  // Top 7 + "Outros".
  //
  // ⚠️ E "Outros" ABSORVE a diferença para o total: o total vem de uma query
  // própria, sem LIMIT, enquanto a lista de canais é limitada. Sem esta
  // reconciliação a soma das linhas não fechava com o total do cabeçalho —
  // medido na Sorrifácil Londrina: 350 nas fatias contra 355 no total.
  const fatias = (() => {
    const ordenadas = [...fatiasBrutas].sort((x, y) => y.valor - x.valor);
    const cabeca = ordenadas.slice(0, MAX_FATIAS);
    const cauda = ordenadas.slice(MAX_FATIAS);
    const somaCabeca = cabeca.reduce((acc, o) => acc + o.valor, 0);
    const resto = Math.max(0, total - somaCabeca);
    if (resto <= 0) return cabeca;
    const nomes = cauda.length > 0 ? ` (${cauda.length}+)` : '';
    return [...cabeca, { label: `Outros${nomes}`, valor: resto }];
  })();
  const cores = coresPorCanal(fatias.map(f => f.label));
  const corDe = (label: string) => marcaDoCanal(label)?.cor ?? (canalNeutro(label) ? CINZA_CANAL : cores[label]);
  // Donut: só as 5 maiores fatias + "Outros" (acima disso o ângulo vira chute);
  // a lista ao lado continua com todos os canais e o valor exato.
  const DONUT_MAX = 5;
  const fatiasDonut = (() => {
    const cab = fatias.slice(0, DONUT_MAX);
    const resto = fatias.slice(DONUT_MAX).reduce((acc, f) => acc + f.valor, 0);
    const lista = cab.map(f => ({ label: f.label, valor: f.valor, cor: corDe(f.label) }));
    return resto > 0 ? [...lista, { label: 'Outros', valor: resto, cor: CINZA_CANAL }] : lista;
  })();

  return (
    <PremiumPanel className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className={cn('flex items-center gap-2', T.cardTitulo)}>
          <DollarSign className="h-4 w-4 text-[#6cff2f]" /> {titulo}
        </h3>
        {total > 0 && (
          <span className={T.cardSub}>
            {fatias.length} {fatias.length === 1 ? 'canal' : 'canais'}
          </span>
        )}
      </div>
      {fatias.length === 0 ? (
        <p className={cn('py-6 text-center', T.cardSub)}>Sem dado no período.</p>
      ) : (
        <div className="grid items-center gap-4 md:grid-cols-[170px_1fr]">
        <Donut fatias={fatiasDonut} centroValor={premiumValue(total, formato)} formatar={(n) => premiumValue(n, formato)} />
        <div className="min-w-0 space-y-2">
          {fatias.map((o) => {
            const marca = marcaDoCanal(o.label);
            const cor = corDe(o.label);
            const pctTotal = total > 0 ? (o.valor / total) * 100 : 0;
            return (
              <div key={o.label} className="min-w-0" title={o.nota ? `${o.label} · ${o.nota}` : o.label}>
                <div className="flex items-baseline gap-2">
                  {marca ? (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center self-center">{marca.logo}</span>
                  ) : (
                    <span className="h-2.5 w-2.5 shrink-0 self-center rounded-sm" style={{ backgroundColor: cor }} />
                  )}
                  <span className={cn('min-w-0 flex-1 truncate', T.listaRotulo)}>{o.label}</span>
                  <span className={cn('w-12 shrink-0 text-right tabular-nums', T.nota)}>{pctTotal.toFixed(1).replace('.', ',')}%</span>
                  <span className="shrink-0 whitespace-nowrap text-right text-xs font-bold tabular-nums text-[#f4f7f8]">{premiumValue(o.valor, formato)}</span>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}
      {/* ⚠️ Sem este aviso a linha cinza seria lida como um canal chamado
          "não informado". A verdade é que o CRM não registrou de onde veio —
          é lacuna de cadastro, não canal. */}
      {fatias.length > 0 && pctSemCanal >= 20 && (
        <p className="mt-3 border-t border-white/[0.07] pt-2.5 text-[11px] leading-snug text-amber-300/80">
          {pctSemCanal >= 99.5 ? 'Tudo' : `${pctSemCanal.toFixed(0)}%`} do período está{' '}
          <strong>sem canal registrado</strong> no CRM. {aviso}
        </p>
      )}
    </PremiumPanel>
  );
}

function MiniPlatformMetric({ label, value, sub, subRuim, icon: Icon, logo, change, inverseChange, comparacao }: {
  label: string;
  value: string;
  sub?: string;
  /** Pinta o `sub` de vermelho. Sem isto, perder seguidores no período sairia em verde. */
  subRuim?: boolean;
  icon?: React.ElementType;
  logo?: ReactNode;
  change?: number | null;
  inverseChange?: boolean;
  /** Rótulo do comparativo, ao lado do %. */
  comparacao?: string;
}) {
  const isPositive = change != null && (inverseChange ? change <= 0 : change >= 0);
  return (
    <div className="rounded-[10px] border border-white/[0.07] bg-[#111a20]/80 p-3">
      <div className="mb-3 flex items-center gap-2">
        {logo ?? (Icon ? <Icon className="h-4 w-4 text-[#6cff2f]" /> : null)}
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#a7b0b6]">{label}</span>
      </div>
      <p className="font-heading text-xl leading-none text-[#f4f7f8]">{value}</p>
      {sub && <p className={cn('mt-1 text-xs font-semibold', subRuim ? 'text-red-400' : 'text-[#78d957]')}>{sub}</p>}
      {change != null && (
        <p className={cn('mt-1 text-[10px] font-bold', isPositive ? 'text-[#6cff2f]' : 'text-red-400')}>
          {change >= 0 ? '+' : ''}{change.toFixed(1).replace('.', ',')}%
          {comparacao && <span className="ml-1 font-medium text-[#7c868c]">{comparacao}</span>}
        </p>
      )}
    </div>
  );
}

function IgMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F77737" />
          <stop offset="0.4" stopColor="#E1306C" />
          <stop offset="1" stopColor="#833AB4" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="6" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="url(#ig-grad)" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1" fill="#E1306C" />
    </svg>
  );
}

// ── Instagram: o MESMO IndicadorCard/IndicadorMini do resto da página, só
// com o ícone em rosa (cor da seção). Antes era um modelo próprio (IgKpi),
// dentro de uma moldura rosa com brilho.
const ROSA_IG = '#ff5c93';

function IgKpi({ label, icon, valor, variacao, comparacao, sub, subRuim }: {
  label: string; icon: React.ElementType; valor: string; variacao: number | null;
  comparacao?: string; sub?: string; subRuim?: boolean;
}) {
  return (
    <IndicadorCard rotulo={label} icone={icon} cor={ROSA_IG} valor={valor} variacao={variacao}
      comparacao={comparacao} nota={sub} notaRuim={subRuim} />
  );
}

function IgMini({ label, icon, valor, variacao }: {
  label: string; icon: React.ElementType; valor: string; variacao: number | null;
}) {
  return <IndicadorMini rotulo={label} icone={icon} cor={ROSA_IG} valor={valor} variacao={variacao} />;
}

const FUNNEL_STEP_COLORS = ['#6cff2f', '#0ea5e9', '#7b2cff', '#f97316', '#ec4899', '#f59e0b', '#84cc16'];

/**
 * Semi-degrau entre duas faixas do funil — as linhas cinza da planilha do
 * Matheus (Perca · Em atendimento · Não compareceram · Faltam comparecer):
 * quem saiu ou ficou parado entre o degrau `apos` e o seguinte. O % é a fatia
 * do degrau de cima, para ler "40 dos 121 leads se perderam" de relance.
 */
type SemiDegrau = { apos: number; rotulo: string; valor: number; tom: 'ruim' | 'neutro' | 'bom' };

function SimpleFunnel({ steps, totalRate, fonteLabel, onStageClick, todosClicaveis, semiDegraus }: {
  steps: Array<{
    label: string; actual: number; planned: number; color: string;
    /** Quebra explicativa sob o número (ex: quantos ainda vêm × quantos furaram). */
    detalhes?: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }>;
  }>;
  /** Linhas intermediárias (planilha) — renderizadas logo abaixo do degrau `apos`. */
  semiDegraus?: SemiDegrau[];
  totalRate: string;
  /** De onde vem o topo ("fonte: CRM" / "estimado por anúncios" / mistas). */
  fonteLabel?: string;
  /** Abre a lista de leads do degrau. Índice mapeia em ETAPAS_FUNIL (0=contato…4=fechamento). */
  onStageClick?: (index: number) => void;
  /** Funil personalizado pelo Kanban: TODOS os degraus são clicáveis (não só os 5 semânticos). */
  todosClicaveis?: boolean;
}) {
  // No funil por etapa real, cada degrau tem lista própria; no semântico, só os
  // índices que existem em ETAPAS_FUNIL abrem modal.
  const podeClicar = (i: number) => !!onStageClick && (todosClicaveis || !!ETAPAS_FUNIL[i]);
  if (!steps.length) return null;
  // Funil de verdade: faixas CENTRALIZADAS e empilhadas, cada uma um trapézio
  // cuja borda de cima tem a largura do degrau e a de baixo a do próximo — o
  // contorno é o funil, e a largura continua proporcional ao volume (com um
  // piso visual para o rótulo caber; o número real está sempre escrito).
  const topo = Math.max(...steps.map(st => st.actual), 0);
  const PISO = 26;
  const larguraDe = (v: number) => (topo > 0 ? Math.max(PISO, (v / topo) * 100) : PISO);

  return (
    <PremiumPanel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className={T.cardTitulo}>Funil de Performance</h3>
          {fonteLabel && <span className={T.cardSub}>· {fonteLabel}</span>}
        </div>
        <span className={T.cardSub} title="Fechamentos ÷ contatos do funil">
          Conversão geral: <span className="font-black text-[#6cff2f]">{totalRate}</span>
        </span>
      </div>

      <div className="space-y-1">
        {steps.map((step, i) => {
          const prev = steps[i - 1];
          const next = steps[i + 1];
          const actualPct = i === 0 ? null : prev && prev.actual > 0 ? (step.actual / prev.actual) * 100 : 0;
          const plannedPct = i === 0 ? null : prev && prev.planned > 0 ? (step.planned / prev.planned) * 100 : 0;
          const isBottleneck = actualPct !== null && plannedPct !== null && plannedPct > 0 && actualPct < plannedPct * 0.85;
          const clicavel = podeClicar(i);
          const cima = larguraDe(step.actual);
          const baixo = next ? larguraDe(next.actual) : Math.max(PISO * 0.8, cima * 0.82);
          const cor = step.color || FUNNEL_STEP_COLORS[i % FUNNEL_STEP_COLORS.length];
          const clip = `polygon(${50 - cima / 2}% 0, ${50 + cima / 2}% 0, ${50 + baixo / 2}% 100%, ${50 - baixo / 2}% 100%)`;
          const semis = (semiDegraus ?? []).filter(sd => sd.apos === i);
          return (
            <Fragment key={step.label}>
            <div
              onClick={clicavel ? () => onStageClick!(i) : undefined}
              role={clicavel ? 'button' : undefined}
              tabIndex={clicavel ? 0 : undefined}
              onKeyDown={clicavel ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStageClick!(i); }
              } : undefined}
              title={clicavel ? `Ver os leads de ${step.label.toLowerCase()}` : undefined}
              className={cn(
                'group grid grid-cols-[1fr_150px] items-center gap-3 sm:grid-cols-[1fr_190px]',
                clicavel && 'cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[#6cff2f]',
              )}
            >
              {/* Faixa do funil */}
              <div className="relative h-[54px]">
                <div
                  className={cn('absolute inset-0 transition-[filter] duration-200', clicavel && 'group-hover:brightness-125')}
                  style={{
                    clipPath: clip,
                    background: `linear-gradient(180deg, ${cor}, ${cor}bf)`,
                    boxShadow: `0 0 18px ${cor}55`,
                  }}
                />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none">
                  <span className="font-heading text-xl text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
                    {Math.round(step.actual).toLocaleString('pt-BR')}
                  </span>
                  <span className="mt-0.5 text-[10px] font-black uppercase tracking-[0.06em] text-white/90" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.7)' }}>
                    {step.label}
                  </span>
                </div>
              </div>

              {/* Conversão do degrau + meta + quebra */}
              <div className="min-w-0">
                {actualPct !== null ? (
                  <p className="whitespace-nowrap text-xs">
                    <span className={cn(T.miniValor, isBottleneck ? 'text-red-400' : 'text-[#6cff2f]')} title="Conversão do degrau anterior para este">
                      {actualPct.toFixed(1).replace('.', ',')}%
                    </span>
                    {plannedPct !== null && plannedPct > 0 && (
                      <span className={cn('ml-1.5', T.nota)} title={`Conversão planejada para este degrau${step.planned > 0 ? ` — meta de ${Math.round(step.planned).toLocaleString('pt-BR')} no período` : ''}`}>
                        meta {plannedPct.toFixed(0)}%{step.planned > 0 && <> · {Math.round(step.planned).toLocaleString('pt-BR')}</>}
                      </span>
                    )}
                    {isBottleneck && <span className="ml-1 text-[11px] font-black text-red-400" title="Gargalo: abaixo de 85% da conversão planejada">⚠ gargalo</span>}
                  </p>
                ) : (
                  <p className={T.miniRotulo}>topo do funil</p>
                )}
                {step.detalhes && step.detalhes.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {step.detalhes.map((d) => (
                      <span
                        key={d.texto}
                        className={cn(
                          'rounded px-1 py-px text-[9px] font-bold leading-tight',
                          d.tom === 'bom' ? 'bg-[#6cff2f]/12 text-[#6cff2f]'
                            : d.tom === 'ruim' ? 'bg-red-400/12 text-red-400'
                            : 'bg-white/[0.06] text-[#9aa4aa]',
                        )}
                      >
                        {d.texto}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* Semi-degraus (linhas cinza da planilha): faixa estreita e neutra entre
                as duas faixas coloridas, com a fatia do degrau de cima à direita. */}
            {semis.map(sd => {
              const fatia = step.actual > 0 ? (sd.valor / step.actual) * 100 : 0;
              const larg = Math.max(PISO * 0.9, Math.min(cima, baixo));
              return (
                <div key={sd.rotulo} className="grid grid-cols-[1fr_150px] items-center gap-3 sm:grid-cols-[1fr_190px]">
                  <div className="relative h-[26px]">
                    <div className="absolute inset-y-0 rounded-sm bg-white/[0.05] ring-1 ring-inset ring-white/[0.08]" style={{ left: `${50 - larg / 2}%`, width: `${larg}%` }} />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 leading-none">
                      <span className={cn('font-heading text-sm', sd.tom === 'ruim' ? 'text-red-300' : sd.tom === 'bom' ? 'text-[#6cff2f]' : 'text-[#c3ccd1]')}>{Math.round(sd.valor).toLocaleString('pt-BR')}</span>
                      <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#9aa4aa]">{sd.rotulo}</span>
                    </div>
                  </div>
                  <p className="whitespace-nowrap text-[11px] text-[#9aa4aa]" title={`${sd.rotulo}: ${Math.round(sd.valor)} de ${Math.round(step.actual)} (${step.label.toLowerCase()})`}>
                    {step.actual > 0 ? <span className={cn('font-bold', sd.tom === 'ruim' ? 'text-red-300' : sd.tom === 'bom' ? 'text-[#6cff2f]' : 'text-[#c3ccd1]')}>{fatia.toFixed(0)}%</span> : '—'}
                    <span className="ml-1">de {step.label.toLowerCase()}</span>
                  </p>
                </div>
              );
            })}
            </Fragment>
          );
        })}
      </div>
    </PremiumPanel>
  );
}

// ── Resumo de delivery (substitui o funil pra cliente de cardápio digital) ──
// O funil de CRM não descreve o negócio de um delivery: a "recorrência" é o
// funil deles, e a receita vive nos pedidos (Cardápio Web / Anota AI), não em
// crm_leads. Mesma fonte da aba Delivery do cliente — /api/clients/[id]/cardapioweb.

const DELIVERY_ETAPAS = ['novo', 'recorrente', 'reconquistado', 'em_risco', 'inativo'] as const;
const DELIVERY_ETAPA_LABEL: Record<string, string> = {
  novo: 'Novos', recorrente: 'Recorrentes', reconquistado: 'Reconquistados',
  em_risco: 'Em risco', inativo: 'Inativos',
};
const DELIVERY_ETAPA_COLOR: Record<string, string> = {
  novo: '#14B8FF', recorrente: '#35E84B', reconquistado: '#9B5CFF',
  em_risco: '#FF7A00', inativo: '#71717a',
};

type DeliveryResumo = {
  conectado: boolean;
  kpis?: {
    atual: { receita: number; pedidos: number; ticketMedio: number; clientesUnicos: number; clientesNovos: number };
    variacao: { receita: number | null; pedidos: number | null; ticketMedio: number | null };
  };
  funil?: { periodo: Record<string, number> };
};

function DeliveryResumoCard({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const [data, setData] = useState<DeliveryResumo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    fetch(`/api/clients/${clientId}/cardapioweb?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() as Promise<DeliveryResumo> : null)
      .then(d => { if (vivo) setData(d); })
      .catch(() => { if (vivo) setData(null); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [clientId, from, to]);

  const varPct = (v: number | null | undefined) => {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return v;
  };

  const kpis = data?.kpis;
  const funil = data?.funil?.periodo ?? {};
  const totalFunil = DELIVERY_ETAPAS.reduce((s, e) => s + (funil[e] ?? 0), 0);

  return (
    <PremiumPanel className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Delivery — Resultado</h3>
          <span className="text-[10px] text-[#9aa4aa]">· cardápio digital</span>
        </div>
        <Link href={`/clientes/${clientId}?tab=delivery`} className="text-[10px] font-black uppercase text-[#6cff2f] hover:underline">
          Ver painel completo →
        </Link>
      </div>

      {loading ? (
        <p className="py-8 text-center text-xs text-[#9aa4aa]">Carregando pedidos…</p>
      ) : !data?.conectado || !kpis ? (
        <p className="py-8 text-center text-xs text-[#9aa4aa]">
          Sem loja conectada — conecte o Cardápio Web ou Anota AI na aba Delivery do cliente.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {([
              ['Receita', premiumValue(kpis.atual.receita, 'currency'), varPct(kpis.variacao.receita)],
              ['Pedidos', premiumValue(kpis.atual.pedidos), varPct(kpis.variacao.pedidos)],
              ['Ticket médio', premiumValue(kpis.atual.ticketMedio, 'currency'), varPct(kpis.variacao.ticketMedio)],
            ] as const).map(([label, valor, delta]) => (
              <div key={label} className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[9px] font-black uppercase tracking-wider text-[#9aa4aa]">{label}</p>
                <p className="mt-1 font-heading text-lg leading-none text-[#f4f7f8]">{valor}</p>
                {delta !== null && (
                  <p className={cn('mt-1 text-[10px] font-black', delta >= 0 ? 'text-[#6cff2f]' : 'text-red-400')}>
                    {/* `variacao` da rota já vem em PONTOS PERCENTUAIS (cardapioweb-recorrencia) — ×100 de novo mostrava +12% como 1200%. */}
                    {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1).replace('.', ',')}% vs anterior
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[9px] font-black uppercase tracking-wider text-[#9aa4aa]">
              Recorrência de clientes no período
            </p>
            <div className="space-y-1.5">
              {DELIVERY_ETAPAS.map(etapa => {
                const v = funil[etapa] ?? 0;
                const pct = totalFunil > 0 ? (v / totalFunil) * 100 : 0;
                return (
                  <div key={etapa} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 truncate text-[10px] text-[#9aa4aa]">{DELIVERY_ETAPA_LABEL[etapa]}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: DELIVERY_ETAPA_COLOR[etapa] }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-[10px] font-black text-[#f4f7f8]">{v.toLocaleString('pt-BR')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </PremiumPanel>
  );
}

/** Selo de CPL contra a meta (régua única: dashboard-metas.ts). */
function StatusCplPill({ status, titulo }: { status: StatusCpl; titulo?: string }) {
  return (
    <span className={cn('whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-[0.04em]', CLASSE_STATUS_CPL[status])} title={titulo}>
      {ROTULO_STATUS_CPL[status]}
    </span>
  );
}

type LinhaCanal = {
  channel: string; logo: ReactNode;
  investment: string; impressions: string; clicks: string; ctr: string; cpc: string; cpm: string;
  leads: string; cpl: string; cplNum: number; status: StatusCpl;
};

/**
 * Resumo por Canal — TRANSPOSTO: métricas nas linhas, canais (+ Total) nas
 * colunas. Fica ao lado do funil, que é alto e estreito; com canais nas linhas
 * eram 2 linhas e um vazio enorme embaixo. Assim o card cabe na mesma coluna
 * estreita, tem a mesma altura do funil e ganhou impressões, cliques, CTR e CPC.
 */
function ChannelSummaryTable({ rows, total, metaCpl }: {
  rows: LinhaCanal[];
  total: LinhaCanal;
  metaCpl: number;
}) {
  // ⚠️ A linha "Conversão" saiu: dividia leads do Meta pelo ALCANCE e
  // conversões do Google pelos CLIQUES — duas taxas sem relação lado a lado.
  const colunas = [...rows, total];
  const metricas: Array<{ rotulo: string; valor: (l: LinhaCanal) => ReactNode; destaque?: boolean }> = [
    { rotulo: 'Investimento', valor: l => l.investment, destaque: true },
    { rotulo: 'Impressões', valor: l => l.impressions },
    { rotulo: 'Cliques', valor: l => l.clicks },
    { rotulo: 'CTR', valor: l => l.ctr },
    { rotulo: 'CPC', valor: l => l.cpc },
    // CPM logo acima de Leads (pedido do Matheus, 2026-09-24 — veio da tabela
    // "Resumo de Tráfego", que saiu): CPL subindo com CPM estável é criativo;
    // com CPM subindo é leilão.
    { rotulo: 'CPM', valor: l => l.cpm },
    { rotulo: 'Leads', valor: l => l.leads, destaque: true },
    { rotulo: 'CPL', valor: l => <span className={cn('font-bold', TEXTO_STATUS_CPL[l.status])}>{l.cpl}</span> },
  ];
  return (
    <Superficie
      titulo="Resumo por Canal"
      direita={(
        <span title="Status compara o CPL de cada canal com a meta de CPL do planejamento: até a meta = Na meta; até 1,5× = Atenção; acima = Acima.">
          <Info className="h-3.5 w-3.5 text-[#a7b0b6]" />
        </span>
      )}
    >
      <div className="overflow-x-auto">
        <table className={cn('w-full min-w-[380px] text-left tabular-nums', T.tabelaCel)}>
          <thead className={T.tabelaCab}>
            <tr>
              <th className="py-2 pr-2">Métrica</th>
              {colunas.map((c, i) => (
                <th key={c.channel} className={cn('py-2 pl-3 text-right', i === colunas.length - 1 && 'text-[#dce4e8]')}>
                  <span className="inline-flex items-center justify-end gap-1.5">{c.logo}{c.channel}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.07]">
            {metricas.map(m => (
              <tr key={m.rotulo} className="text-[#f4f7f8]">
                <td className={cn('py-2.5 pr-2', T.miniRotulo)}>{m.rotulo}</td>
                {colunas.map((c, i) => (
                  <td key={c.channel} className={cn('whitespace-nowrap py-2.5 pl-3 text-right', m.destaque && 'font-bold', i === colunas.length - 1 && 'bg-white/[0.02]')}>
                    {m.valor(c)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td className={cn('py-2.5 pr-2', T.miniRotulo)}>vs meta de CPL{metaCpl > 0 ? <span className="block normal-case tracking-normal text-[#7c868c]">{premiumValue(metaCpl, 'currency')}</span> : null}</td>
              {colunas.map((c, i) => (
                <td key={c.channel} className={cn('py-2.5 pl-3 text-right', i === colunas.length - 1 && 'bg-white/[0.02]')}>
                  <StatusCplPill
                    status={c.status}
                    titulo={metaCpl > 0 && c.cplNum > 0 ? `${(c.cplNum / metaCpl).toFixed(2).replace('.', ',')}× a meta` : undefined}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Superficie>
  );
}

function CompactCampaignTable({ campaigns, loading, platform }: {
  campaigns: CampaignPerformance[];
  loading: boolean;
  platform: AdsPlatform;
}) {
  const rows = campaigns.slice(0, 4);
  if (loading) return <div className="py-8 text-center text-xs text-[#9aa4aa]">Carregando campanhas...</div>;
  if (!rows.length) return <div className="py-8 text-center text-xs text-[#9aa4aa]">Nenhuma campanha encontrada.</div>;
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full min-w-[560px] text-left tabular-nums', T.tabelaCel)}>
        <thead className={T.tabelaCab}>
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

function CompactKeywordTable({ keywords, loading, metaCpl }: { keywords: GoogleKeyword[]; loading: boolean; metaCpl: number }) {
  // Ordena pelo que custa: a API devolve por impressões, e o top 5 por
  // impressão escondia justamente a keyword que queima verba sem lead.
  const temCusto = keywords.some(k => (k.spend ?? 0) > 0);
  const rows = [...keywords]
    .sort((a, b) => temCusto ? (b.spend ?? 0) - (a.spend ?? 0) : (b.conversions ?? 0) - (a.conversions ?? 0))
    .slice(0, 5);
  const temCtr = rows.some(k => (k.ctr ?? 0) > 0);
  if (loading) return <div className="py-8 text-center text-xs text-[#9aa4aa]">Carregando palavras-chave...</div>;
  if (!rows.length) return <div className="py-8 text-center text-xs text-[#9aa4aa]">Nenhuma palavra-chave encontrada.</div>;
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full min-w-[500px] text-left tabular-nums', T.tabelaCel)}>
        <thead className={T.tabelaCab}>
          <tr>
            <th className="py-2">Palavra-chave</th>
            <th className="text-right">Investimento</th>
            <th className="text-right">Cliques</th>
            {temCtr && <th className="text-right">CTR</th>}
            <th className="text-right">Leads</th>
            <th className="text-right">CPL</th>
            <th className="text-right">vs meta de CPL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {rows.map((keyword, index) => {
            const gasto = keyword.spend ?? 0;
            const leads = keyword.conversions ?? 0;
            const cpl = leads > 0 ? (keyword.cpl > 0 ? keyword.cpl : gasto / leads) : 0;
            const status: StatusCpl = leads > 0
              ? statusCpl(cpl, metaCpl)
              : keyword.clicks > 0 ? statusCplComGasto(gasto, 0, metaCpl) : 'sem_dado';
            return (
              <tr key={`${keyword.text}-${index}`} className="text-[#f4f7f8]">
                <td className="max-w-[220px] truncate py-3" title={keyword.text}><span className="mr-2 rounded bg-[#6cff2f]/18 px-1.5 py-0.5 font-bold text-[#6cff2f]">{index + 1}</span>{keyword.text}</td>
                <td className="whitespace-nowrap text-right">{gasto > 0 ? premiumValue(gasto, 'currency') : '—'}</td>
                <td className="text-right">{premiumValue(keyword.clicks)}</td>
                {temCtr && <td className="whitespace-nowrap text-right">{keyword.ctr > 0 ? premiumValue(keyword.ctr, 'percent') : '—'}</td>}
                <td className="text-right">{premiumValue(leads)}</td>
                <td className={cn('whitespace-nowrap text-right font-bold', TEXTO_STATUS_CPL[status])}>{cpl > 0 ? premiumValue(cpl, 'currency') : '—'}</td>
                <td className="text-right">
                  <StatusCplPill
                    status={status}
                    titulo={status === 'sem_lead' ? 'Cliques e nenhum lead, com gasto de 2× a meta de CPL ou mais'
                      : status === 'sem_lead_baixo' ? 'Cliques e nenhum lead, mas o gasto ainda é pequeno para concluir' : undefined}
                  />
                </td>
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

function HorizontalCreativeCard({ creative, index, onPreview, fluido = false }: {
  /** Ocupa a largura da célula da grade (em vez dos 220px fixos da faixa). */
  fluido?: boolean;
  creative: TopCreative;
  index: number;
  onPreview: (c: TopCreative) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const [imgStage, setImgStage] = useState<'primary' | 'thumb' | 'error'>('primary');

  const primaryUrl = creative.imageUrl;
  const thumbUrl = creative.thumbnailUrl;
  const imgUrl = imgStage === 'primary' ? (primaryUrl ?? thumbUrl) : imgStage === 'thumb' ? thumbUrl : undefined;
  const hasVideo = !!creative.videoUrl;
  const metrics = creativeObjectiveMetrics(creative);
  const st = creativeStatusInfo(creative.status);

  function handleImgError() {
    if (imgStage === 'primary' && primaryUrl && thumbUrl && thumbUrl !== primaryUrl) {
      setImgStage('thumb');
    } else {
      setImgStage('error');
    }
  }

  const showImage = !!imgUrl && imgStage !== 'error' && !imgFailed;

  return (
    <button
      type="button"
      onClick={() => onPreview(creative)}
      className={cn('group overflow-hidden rounded-xl bg-white/[0.03] text-left ring-1 ring-white/[0.05] transition hover:ring-[#6cff2f]/40', fluido ? 'w-full' : 'w-[220px] shrink-0')}
    >
      <div className="relative overflow-hidden bg-[#071014]" style={{ aspectRatio: '4/5' }}>
        {showImage ? (
          <img
            src={imgUrl}
            alt={creative.adName}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={handleImgError}
          />
        ) : creative.permalink ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 bg-black/30">
            <ExternalLink className="h-5 w-5 text-white/40" />
            <span className="text-[9px] text-white/30">Ver publicação</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <ImageIcon className="h-6 w-6 text-[#9aa4aa]/40" />
          </div>
        )}
        {/* Play centralizado — só quando há vídeo (confirma que toca no modal) */}
        {hasVideo && showImage && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/30 backdrop-blur-sm">
              <Play className="h-3.5 w-3.5 fill-white text-white" />
            </span>
          </span>
        )}
        {/* Selo Ativo/Pausado — leitura instantânea do status do anúncio */}
        {st && (
          <span className={cn('absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide backdrop-blur-sm', st.pill)} title={st.titulo}>
            <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} /> {st.label}
          </span>
        )}
        <span className="absolute bottom-2 left-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/85 text-[10px] font-black text-white">{index + 1}</span>
        <span className="absolute right-2 top-2 rounded bg-[#6cff2f] px-1.5 py-0.5 text-[9px] font-black text-black">
          {premiumValue(creative.spend, 'currency')}
        </span>
      </div>
      <div className="p-2.5">
        {creative.campaignName && (
          <p className="mb-1 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-[#6cff2f]/70" title={creative.campaignName}>
            {creative.campaignName}
          </p>
        )}
        <p className={cn('mb-2 truncate', T.listaRotulo)} title={creative.adName}>{creative.adName}</p>
        {/* Rótulo/valor em LINHAS: três caixinhas lado a lado em 170px
            cortavam o CPL em "R$ 4…". */}
        <dl className="space-y-1 text-[11px]">
          {metrics.map(m => (
            <div key={m.label} className="flex items-baseline justify-between gap-2">
              <dt className="font-black uppercase tracking-[0.06em] text-[#9aa4aa]">{m.label}</dt>
              <dd className="whitespace-nowrap font-black tabular-nums text-[#f4f7f8]">{m.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </button>
  );
}

function CreativeHorizontalStrip({ creatives, loading, onPreview, grade = false }: {
  creatives: TopCreative[];
  loading: boolean;
  onPreview: (creative: TopCreative) => void;
  /** Grade que quebra linha (ao lado da tabela de campanhas) em vez da faixa com rolagem. */
  grade?: boolean;
}) {
  if (loading) {
    return (
      <div className={grade ? 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3' : 'flex gap-3 overflow-x-auto pb-2'}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn('animate-pulse rounded-xl bg-white/[0.06]', !grade && 'w-[220px] shrink-0')} style={{ height: 345 }} />
        ))}
      </div>
    );
  }
  if (!creatives.length) {
    return <div className="py-8 text-center text-xs text-[#9aa4aa]">Nenhum criativo encontrado.</div>;
  }
  // "Melhores" = mais leads e, no empate, menor CPL. A API ordena por gasto —
  // que mostra o que mais CUSTOU, não o que mais rendeu. Sem nenhum lead no
  // período (campanha de tráfego/engajamento), fica a ordem por gasto.
  const ordenados = creatives.some(c => c.leads > 0)
    ? [...creatives].sort((a, b) =>
      (b.leads - a.leads)
      || ((a.cpl > 0 ? a.cpl : Infinity) - (b.cpl > 0 ? b.cpl : Infinity))
      || (b.spend - a.spend))
    : creatives;
  return (
    <div className={grade ? 'grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3' : 'flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:#2a2d3a_transparent]'}>
      {ordenados.slice(0, grade ? 6 : 10).map((creative, index) => (
        <HorizontalCreativeCard key={creative.adId} creative={creative} index={index} onPreview={onPreview} fluido={grade} />
      ))}
    </div>
  );
}


// ── Desempenho por região ─────────────────────────────────────────────────────
// Uma linha por região: o que a campanha da região custou/trouxe (mídia, pelo
// NOME da campanha) × o funil dos leads com DDD/cidade daquela região (CRM).
// Pedido do Matheus (CondoStore): "medir o que veio da campanha da região
// comparado com os leads que chegaram" — com reuniões, vendas, CAC e faturamento.
// A campanha NACIONAL (sem região no nome) não fica opaca: a Meta sabe em que
// estado cada resultado foi gerado (breakdowns=region), então ela abre em
// sub-linhas por UF.
type ChaveOrdem = 'investimento' | 'leadsPlataforma' | 'leads' | 'cpl' | 'agendamentos' | 'comparecimentos' | 'custoReuniao' | 'fechamentos' | 'cac' | 'receita';

// ── Funil por canal ─────────────────────────────────────────────────────────
// A tabela "funil por canal" da planilha do Matheus (2026-09-24): por canal de
// origem do lead, Leads → Engajados → Agendamentos → Comparecimentos → Vendas,
// % de conversão e faturamento. Investimento só existe para os canais pagos
// (Meta Ads / Google Ads — o gasto das plataformas no período); os demais
// mostram "—" em CPL/CAC em vez de um zero que pareceria "de graça".
type ChaveOrdemCanal = 'investimento' | 'leads' | 'engajados' | 'agendamentos' | 'comparecimentos' | 'fechamentos' | 'conversao' | 'cpl' | 'cac' | 'receita';

/** Célula numérica das tabelas de funil (módulo, não dentro do render — a regra do compiler). */
const CelFunil = ({ children, forte, className }: { children: ReactNode; forte?: boolean; className?: string }) => (
  <td className={cn('whitespace-nowrap py-2.5 pr-2 text-right', forte ? 'font-bold text-[#f4f7f8]' : 'text-[#c3ccd1]', className)}>{children}</td>
);
/** Cabeçalho ordenável da tabela "Funil por canal". */
function CabFunil({ chave, rotulo, dica, ordem, onOrdenar }: {
  chave: ChaveOrdemCanal; rotulo: string; dica: string;
  ordem: { chave: ChaveOrdemCanal; desc: boolean };
  onOrdenar: React.Dispatch<React.SetStateAction<{ chave: ChaveOrdemCanal; desc: boolean }>>;
}) {
  const ativa = ordem.chave === chave;
  return (
    <th className="pr-2 text-right">
      <button type="button" title={`${dica} — clique para ordenar`}
        onClick={() => onOrdenar(o => ({ chave, desc: o.chave === chave ? !o.desc : true }))}
        className={cn('inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-[#dce4e8]', ativa && 'text-[#6cff2f]')}>
        {rotulo}
        <span className={cn('text-[9px]', !ativa && 'opacity-30')}>{ativa ? (ordem.desc ? '▼' : '▲') : '▼'}</span>
      </button>
    </th>
  );
}

function TabelaFunilCanal({ linhas, investimento }: {
  linhas: LinhaFunilCanal[];
  /** Gasto do período por canal pago (chave = rótulo do canal como o CRM devolve). */
  investimento: Record<string, number>;
}) {
  const [ordem, setOrdem] = useState<{ chave: ChaveOrdemCanal; desc: boolean }>({ chave: 'leads', desc: true });
  const [expandido, setExpandido] = useState(false);
  const LIMITE = 6;

  const invDe = (l: LinhaFunilCanal): number | null => (l.semCanal ? null : investimento[l.canal] ?? null);
  const razaoNum = (inv: number | null, den: number) => (inv !== null && inv > 0 && den > 0 ? inv / den : 0);
  const valorDe = (l: LinhaFunilCanal, k: ChaveOrdemCanal): number => {
    switch (k) {
      case 'investimento': return invDe(l) ?? 0;
      case 'leads': return l.leads;
      case 'engajados': return l.engajados;
      case 'agendamentos': return l.agendamentos;
      case 'comparecimentos': return l.comparecimentos;
      case 'fechamentos': return l.fechamentos;
      case 'conversao': return l.leads > 0 ? l.fechamentos / l.leads : 0;
      case 'cpl': return razaoNum(invDe(l), l.leads);
      case 'cac': return razaoNum(invDe(l), l.fechamentos);
      case 'receita': return l.receita;
    }
  };
  // Mesma régua da tabela de regiões: "—" (zero) vai sempre pro fim, e a linha
  // "Canal não informado" também — é lacuna, não canal, não disputa ranking.
  const ordenadas = [...linhas].sort((a, b) => {
    if (a.semCanal !== b.semCanal) return a.semCanal ? 1 : -1;
    const va = valorDe(a, ordem.chave), vb = valorDe(b, ordem.chave);
    if (va === 0 && vb !== 0) return 1;
    if (vb === 0 && va !== 0) return -1;
    return ordem.desc ? vb - va : va - vb;
  });
  const visiveis = expandido ? ordenadas : ordenadas.slice(0, LIMITE);
  const soma = linhas.reduce((a, l) => ({
    investimento: a.investimento + (invDe(l) ?? 0), leads: a.leads + l.leads, engajados: a.engajados + l.engajados,
    agendamentos: a.agendamentos + l.agendamentos, comparecimentos: a.comparecimentos + l.comparecimentos,
    fechamentos: a.fechamentos + l.fechamentos, receita: a.receita + l.receita,
  }), { investimento: 0, leads: 0, engajados: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0, receita: 0 });
  const semCanal = linhas.find(l => l.semCanal)?.leads ?? 0;

  const n = (v: number) => premiumValue(v);
  const moeda = (v: number | null) => (v !== null && v > 0 ? premiumValue(v, 'currency') : '—');
  const razao = (inv: number | null, den: number) => (inv !== null && inv > 0 && den > 0 ? premiumValue(inv / den, 'currency') : '—');
  const pct = (num: number, den: number) => (den > 0 ? premiumValue((num / den) * 100, 'percent') : '—');

  return (
    <PremiumPanel className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={T.cardTitulo}>Funil por canal</h3>
        <span className={T.cardSub}>canal de origem do lead no CRM · investimento só nos canais pagos · clique no cabeçalho para ordenar</span>
      </div>
      <div className="-mx-2">
        <div className="overflow-auto transition-all duration-300" style={{ maxHeight: expandido ? '9999px' : '330px' }}>
          <table className={cn('w-full min-w-[980px] text-left tabular-nums', T.tabelaCel)}>
            <thead className={cn('sticky top-0 z-10 bg-[#0d1519]', T.tabelaCab)}>
              <tr>
                <th className="py-2 pl-2">Canal</th>
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="investimento" rotulo="Investimento" dica="Gasto do período na plataforma (só Meta Ads e Google Ads)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="leads" rotulo="Leads" dica="Leads que contam na dashboard, por canal de origem" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="engajados" rotulo="Engajados" dica="Responderam ou interagiram (posto 1 do funil)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="agendamentos" rotulo="Agendamentos" dica="Agendamento / proposta (posto 2)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="comparecimentos" rotulo="Comparecimentos" dica="Comparecimento / reunião realizada (posto 3)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="fechamentos" rotulo="Vendas" dica="Fechamentos no CRM" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="conversao" rotulo="% Conv." dica="Vendas ÷ leads do canal" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="cpl" rotulo="CPL" dica="Investimento ÷ leads (canais pagos)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="cac" rotulo="CAC" dica="Investimento ÷ vendas (canais pagos)" />
                <CabFunil ordem={ordem} onOrdenar={setOrdem} chave="receita" rotulo="Faturamento" dica="Receita das vendas do canal" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {visiveis.map(l => {
                const temVenda = l.fechamentos > 0;
                const inv = invDe(l);
                return (
                  <tr key={l.canal} className={cn(l.semCanal && 'text-[#9aa4aa]', temVenda && !l.semCanal && 'bg-[#6cff2f]/[0.08]')}>
                    <td className="py-2.5 pl-2 pr-3">
                      <span className={cn('font-bold', l.semCanal ? 'text-[#9aa4aa]' : temVenda ? 'text-[#6cff2f]' : 'text-[#f4f7f8]')}>{l.canal}</span>
                    </td>
                    <CelFunil forte>{moeda(inv)}</CelFunil>
                    <CelFunil forte>{n(l.leads)}</CelFunil>
                    <CelFunil>{n(l.engajados)}</CelFunil>
                    <CelFunil>{n(l.agendamentos)}</CelFunil>
                    <CelFunil>{n(l.comparecimentos)}</CelFunil>
                    <CelFunil forte>{n(l.fechamentos)}</CelFunil>
                    <CelFunil>{pct(l.fechamentos, l.leads)}</CelFunil>
                    <CelFunil>{razao(inv, l.leads)}</CelFunil>
                    <CelFunil forte>{razao(inv, l.fechamentos)}</CelFunil>
                    <CelFunil forte className={cn(temVenda && 'text-[#6cff2f]')}>{moeda(l.receita)}</CelFunil>
                  </tr>
                );
              })}
              {linhas.length > 1 && (expandido || linhas.length <= LIMITE) && (
                <tr className="border-t border-white/[0.12] text-[#f4f7f8]">
                  <td className="py-2.5 pl-2 pr-3 font-black">Total</td>
                  <CelFunil forte>{moeda(soma.investimento)}</CelFunil>
                  <CelFunil forte>{n(soma.leads)}</CelFunil>
                  <CelFunil forte>{n(soma.engajados)}</CelFunil>
                  <CelFunil forte>{n(soma.agendamentos)}</CelFunil>
                  <CelFunil forte>{n(soma.comparecimentos)}</CelFunil>
                  <CelFunil forte>{n(soma.fechamentos)}</CelFunil>
                  <CelFunil forte>{pct(soma.fechamentos, soma.leads)}</CelFunil>
                  <CelFunil forte>{razao(soma.investimento, soma.leads)}</CelFunil>
                  <CelFunil forte>{razao(soma.investimento, soma.fechamentos)}</CelFunil>
                  <CelFunil forte className={cn(soma.receita > 0 && 'text-[#6cff2f]')}>{moeda(soma.receita)}</CelFunil>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2">
          {/* Soma das linhas, não o `total` da rota — aquele inclui os lançamentos
              de faturamento (tipo 'venda'), que não são lead. */}
          <span className={T.cardSub}>
            {n(soma.leads)} leads no período
            {semCanal > 0 && <> · <span className="text-[#9aa4aa]">{n(semCanal)} sem canal registrado</span></>}
          </span>
          {linhas.length > LIMITE && (
            <button type="button" onClick={() => setExpandido(v => !v)} className="text-[11px] font-bold uppercase tracking-wider text-[#6cff2f] hover:underline">
              {expandido ? 'Ver menos' : `Ver todos (${linhas.length})`}
            </button>
          )}
        </div>
      </div>
    </PremiumPanel>
  );
}

function TabelaRegioes({ linhas, semRegiao, total, nacionalPorUf, ufs }: {
  linhas: LinhaTabelaRegiao[];
  semRegiao: number;
  total: number;
  /** Breakdown por UF das campanhas nacionais/sem região (Meta). null = não carregou. */
  nacionalPorUf: RegiaoCampanhas[] | null;
  /** Funil do CRM por UF — CRM das sub-linhas nacionais. */
  ufs: FunilRegiao[];
}) {
  const [ordem, setOrdem] = useState<{ chave: ChaveOrdem; desc: boolean }>({ chave: 'investimento', desc: true });
  const [expandido, setExpandido] = useState(false);
  const LIMITE = 6;

  const regionais = linhas.filter(l => l.tipo !== 'nacional');
  const nacional = linhas.find(l => l.tipo === 'nacional') ?? null;
  const temUfECidade = regionais.some(l => l.tipo === 'uf') && regionais.some(l => l.tipo === 'cidade');
  const razaoNum = (inv: number, den: number) => (inv > 0 && den > 0 ? inv / den : 0);
  const valorDe = (l: LinhaTabelaRegiao, k: ChaveOrdem): number => {
    const c = l.crm;
    switch (k) {
      case 'investimento': return l.investimento;
      case 'leadsPlataforma': return l.leadsPlataforma;
      case 'leads': return c?.leads ?? 0;
      case 'cpl': return razaoNum(l.investimento, c?.leads ?? 0);
      case 'agendamentos': return c?.agendamentos ?? 0;
      case 'comparecimentos': return c?.comparecimentos ?? 0;
      case 'custoReuniao': return razaoNum(l.investimento, c?.comparecimentos ?? 0);
      case 'fechamentos': return c?.fechamentos ?? 0;
      case 'cac': return razaoNum(l.investimento, c?.fechamentos ?? 0);
      case 'receita': return c?.receita ?? 0;
    }
  };
  // Ordenação pela coluna escolhida; "—" (zero) vai sempre pro fim, nas duas
  // direções — senão ordenar por CAC crescente listaria quem não vendeu primeiro.
  const ordenadas = [...regionais].sort((a, b) => {
    const va = valorDe(a, ordem.chave), vb = valorDe(b, ordem.chave);
    if (va === 0 && vb !== 0) return 1;
    if (vb === 0 && va !== 0) return -1;
    return ordem.desc ? vb - va : va - vb;
  });
  const visiveis = expandido ? ordenadas : ordenadas.slice(0, LIMITE);
  const soma = regionais.reduce((a, l) => ({
    investimento: a.investimento + l.investimento, campanhas: a.campanhas + l.campanhas, leadsPlataforma: a.leadsPlataforma + l.leadsPlataforma,
    leads: a.leads + (l.crm?.leads ?? 0), agendamentos: a.agendamentos + (l.crm?.agendamentos ?? 0),
    comparecimentos: a.comparecimentos + (l.crm?.comparecimentos ?? 0), fechamentos: a.fechamentos + (l.crm?.fechamentos ?? 0),
    receita: a.receita + (l.crm?.receita ?? 0),
  }), { investimento: 0, campanhas: 0, leadsPlataforma: 0, leads: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0, receita: 0 });
  const razao = (inv: number, den: number) => (inv > 0 && den > 0 ? premiumValue(inv / den, 'currency') : '—');
  const n = (v: number | undefined | null) => (v === null || v === undefined ? '—' : premiumValue(v));
  const moeda = (v: number) => (v > 0 ? premiumValue(v, 'currency') : '—');
  const ufPorSigla = new Map(ufs.map(u => [u.regiao.toUpperCase(), u]));

  const Cel = ({ children, forte, className }: { children: ReactNode; forte?: boolean; className?: string }) => (
    <td className={cn('whitespace-nowrap py-2.5 pr-2 text-right', forte ? 'font-bold text-[#f4f7f8]' : 'text-[#c3ccd1]', className)}>{children}</td>
  );
  /** Uma linha completa (regional ou sub-linha de UF do nacional). */
  const LinhaCompleta = ({ rotulo, sub, investimento, campanhas, leadsPlataforma, crm, indent, tom }: {
    rotulo: string; sub?: string; investimento: number; campanhas?: number; leadsPlataforma: number | null;
    crm: FunilRegiao | null; indent?: boolean; tom?: 'nacional';
  }) => {
    const temVenda = (crm?.fechamentos ?? 0) > 0;
    const nac = tom === 'nacional';
    return (
      <tr className={cn(nac && 'text-[#9aa4aa]', temVenda && !nac && 'bg-[#6cff2f]/[0.08]')}>
        <td className={cn('py-2.5 pr-3', indent ? 'pl-6' : 'pl-2')}>
          {indent && <span className="mr-1 text-[#6c767c]">↳</span>}
          <span className={cn('font-bold', nac ? 'text-[#9aa4aa]' : temVenda ? 'text-[#6cff2f]' : indent ? 'text-[#dce4e8]' : 'text-[#f4f7f8]')}>{rotulo}</span>
          {sub && <span className="ml-1.5 text-[10px] text-[#6c767c]">{sub}</span>}
        </td>
        <Cel forte>{moeda(investimento)}</Cel>
        <Cel>{leadsPlataforma === null ? '—' : n(leadsPlataforma)}</Cel>
        <Cel forte>{crm ? n(crm.leads) : '—'}</Cel>
        <Cel>{crm ? razao(investimento, crm.leads) : '—'}</Cel>
        <Cel>{crm ? n(crm.agendamentos) : '—'}</Cel>
        <Cel>{crm ? n(crm.comparecimentos) : '—'}</Cel>
        <Cel>{crm ? razao(investimento, crm.comparecimentos) : '—'}</Cel>
        <Cel forte>{crm ? n(crm.fechamentos) : '—'}</Cel>
        <Cel forte>{crm ? razao(investimento, crm.fechamentos) : '—'}</Cel>
        <Cel forte className={cn(temVenda && 'text-[#6cff2f]')}>{crm && crm.receita > 0 ? premiumValue(crm.receita, 'currency') : '—'}</Cel>
      </tr>
    );
  };
  const Cab = ({ chave, rotulo, dica }: { chave: ChaveOrdem; rotulo: string; dica: string }) => {
    const ativa = ordem.chave === chave;
    return (
      <th className="pr-2 text-right">
        <button type="button" title={`${dica} — clique para ordenar`}
          onClick={() => setOrdem(o => ({ chave, desc: o.chave === chave ? !o.desc : true }))}
          className={cn('inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-[#dce4e8]', ativa && 'text-[#6cff2f]')}>
          {rotulo}
          <span className={cn('text-[9px]', !ativa && 'opacity-30')}>{ativa ? (ordem.desc ? '▼' : '▲') : '▼'}</span>
        </button>
      </th>
    );
  };
  // Sub-linhas do nacional: só UFs com gasto; CRM = funil da UF inteira.
  const subNacional = (nacionalPorUf ?? []).filter(u => u.spend > 0).sort((a, b) => b.spend - a.spend);
  const nacionalCoberto = subNacional.reduce((s, u) => s + u.spend, 0);

  return (
    <PremiumPanel className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={T.cardTitulo}>Desempenho por região</h3>
        <span className={T.cardSub}>campanha com a região no nome × leads com DDD/cidade da região · clique no cabeçalho para ordenar</span>
      </div>
      <div className="-mx-2">
        {/* Rolagem interna (roda do mouse) + "Ver todas", igual à tabela de campanhas. */}
        <div className="overflow-auto transition-all duration-300" style={{ maxHeight: expandido ? '9999px' : '330px' }}>
          <table className={cn('w-full min-w-[1080px] text-left tabular-nums', T.tabelaCel)}>
            <thead className={cn('sticky top-0 z-10 bg-[#0d1519]', T.tabelaCab)}>
              <tr>
                <th className="py-2 pl-2">Região</th>
                <Cab chave="investimento" rotulo="Investimento" dica="Gasto das campanhas com a região no nome" />
                <Cab chave="leadsPlataforma" rotulo="Leads camp." dica="Leads/conversões que a plataforma reportou para essas campanhas" />
                <Cab chave="leads" rotulo="Leads CRM" dica="Leads no CRM com DDD/cidade da região" />
                <Cab chave="cpl" rotulo="CPL real" dica="Investimento ÷ leads do CRM da região" />
                <Cab chave="agendamentos" rotulo="Reuniões agend." dica="Agendamento / proposta (posto 2 do funil)" />
                <Cab chave="comparecimentos" rotulo="Reuniões feitas" dica="Comparecimento / reunião realizada (posto 3)" />
                <Cab chave="custoReuniao" rotulo="Custo/reunião" dica="Investimento ÷ reuniões feitas" />
                <Cab chave="fechamentos" rotulo="Vendas" dica="Fechamentos no CRM" />
                <Cab chave="cac" rotulo="CAC" dica="Investimento ÷ vendas" />
                <Cab chave="receita" rotulo="Faturamento" dica="Receita das vendas no CRM da região" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {visiveis.map(l => (
                <LinhaCompleta key={l.key} rotulo={l.rotulo} sub={l.campanhas > 0 ? `${l.campanhas} camp.` : undefined}
                  investimento={l.investimento} leadsPlataforma={l.campanhas > 0 ? l.leadsPlataforma : null} crm={l.crm} />
              ))}
              {regionais.length > 1 && (expandido || regionais.length <= LIMITE) && (
                <tr className="border-t border-white/[0.12] text-[#f4f7f8]">
                  <td className="py-2.5 pl-2 pr-3 font-black">Total regional</td>
                  <Cel forte>{moeda(soma.investimento)}</Cel>
                  <Cel forte>{soma.campanhas > 0 ? n(soma.leadsPlataforma) : '—'}</Cel>
                  <Cel forte>{n(soma.leads)}</Cel>
                  <Cel forte>{razao(soma.investimento, soma.leads)}</Cel>
                  <Cel forte>{n(soma.agendamentos)}</Cel>
                  <Cel forte>{n(soma.comparecimentos)}</Cel>
                  <Cel forte>{razao(soma.investimento, soma.comparecimentos)}</Cel>
                  <Cel forte>{n(soma.fechamentos)}</Cel>
                  <Cel forte>{razao(soma.investimento, soma.fechamentos)}</Cel>
                  <Cel forte className={cn(soma.receita > 0 && 'text-[#6cff2f]')}>{moeda(soma.receita)}</Cel>
                </tr>
              )}
              {nacional && (expandido || regionais.length <= LIMITE) && (
                <>
                  <LinhaCompleta rotulo={nacional.rotulo} sub={`${nacional.campanhas} camp.`} investimento={nacional.investimento}
                    leadsPlataforma={nacional.leadsPlataforma} crm={null} tom="nacional" />
                  {subNacional.map(u => (
                    <LinhaCompleta key={`nac-${u.uf}`} rotulo={u.uf} sub="onde a Meta gerou o resultado" indent
                      investimento={u.spend} leadsPlataforma={u.leads} crm={ufPorSigla.get(u.uf) ?? null} />
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
        {(regionais.length > LIMITE) && (
          <button type="button" onClick={() => setExpandido(v => !v)}
            className="flex w-full items-center justify-center gap-1.5 border-t border-white/[0.06] py-2 text-[11px] font-semibold text-foreground/50 transition-colors hover:bg-white/[0.04] hover:text-foreground/80">
            {expandido ? <><ChevronUp className="h-3.5 w-3.5" /> Recolher</> : <><ChevronDown className="h-3.5 w-3.5" /> Ver todas as {regionais.length} regiões{nacional ? ' + nacional' : ''}</>}
          </button>
        )}
      </div>
      <p className="mt-3 text-[10px] leading-snug text-[#7c868c]">
        Região do lead vem do DDD do telefone (ou da cidade do formulário) — é de onde a pessoa é, não onde o anúncio rodou.
        {temUfECidade && ' Linha de UF inclui as cidades dela — não somar as duas.'}
        {nacional && subNacional.length > 0 && ` As sub-linhas do nacional mostram em que estado a Meta gerou cada resultado (${premiumValue(nacionalCoberto, 'currency')} dos ${premiumValue(nacional.investimento, 'currency')}; o resto é Google ou sem estado informado) e o CRM da UF inteira, que inclui as cidades acima.`}
        {semRegiao > 0 && ` ${premiumValue(semRegiao)} de ${premiumValue(total)} leads do período não têm região e ficam fora da tabela.`}
      </p>
    </PremiumPanel>
  );
}

/** Título de seção da página única (substitui as abas). */
function TituloSecao({ titulo, sub, direita }: { titulo: string; sub?: string; direita?: ReactNode }) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <span className="h-4 w-1 rounded-full bg-[#6cff2f]" />
      <h2 className={T.secao}>{titulo}</h2>
      {sub && <span className={T.cardSub}>{sub}</span>}
      <span className="h-px flex-1 bg-white/[0.08]" />
      {direita}
    </div>
  );
}

/** "1 de set. de 2026" a partir de 'YYYY-MM-DD' (data local — nunca UTC, ver period-utils). */
function dataLonga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function GeneralDashboard() {
  const { clients } = useClients();
  const session = getAuthSession();
  const isAdmin = session?.role === 'Administrador';

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('dashboard-selected-clients');
      if (stored) return new Set(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
    return new Set();
  });
  const [prevMetricsByClient, setPrevMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [period, setPeriod] = useState<Period>('this_month');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [metricsByClient, setMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  // Landing page (GA4) por cliente — null = sem propriedade vinculada
  const [ga4ByClient, setGa4ByClient] = useState<Record<string, { ga4: Ga4Consolidado | null; aviso?: string }>>({});
  const [ga4Loading, setGa4Loading] = useState(false);
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [planningsByClient, setPlanningsByClient] = useState<Record<string, PlanningConfig>>({});
  const [crmSummary, setCrmSummary] = useState<Record<string, ClientSheetsSummary>>({});
  // Clientes com loja de delivery conectada (Cardápio Web/Anota AI) — quando o
  // cliente selecionado é um deles, o Funil de Performance dá lugar ao resumo
  // de delivery (decisão do Matheus; o funil de CRM não descreve esse negócio).
  const [deliveryFlags, setDeliveryFlags] = useState<Record<string, true>>({});
  useEffect(() => {
    fetch('/api/clients/delivery-flags')
      .then(r => r.ok ? r.json() as Promise<Record<string, true>> : {})
      .then(setDeliveryFlags)
      .catch(() => setDeliveryFlags({}));
  }, []);
  /** Clientes com integração de leads via SULTS — só eles veem "Desempenho por região". */
  const [sultsFlags, setSultsFlags] = useState<Record<string, true>>({});
  useEffect(() => {
    fetch('/api/clients/sults-flags')
      .then(r => r.ok ? r.json() as Promise<Record<string, true>> : {})
      .then(setSultsFlags)
      .catch(() => setSultsFlags({}));
  }, []);
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [keywords, setKeywords] = useState<GoogleKeyword[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [creatives, setCreatives] = useState<TopCreative[]>([]);
  const [audience, setAudience] = useState<AudienceResponse>(EMPTY_AUDIENCE);
  const [balances, setBalances] = useState<AdAccountBalance[]>([]);
  const [clientLinks, setClientLinks] = useState<ClientAccountLink[]>([]);
  const [previewCreative, setPreviewCreative] = useState<TopCreative | null>(null);
  /** Faturamento por criativo no período — vem do CRM, não do Meta. */
  const [criativosReceita, setCriativosReceita] = useState<CriativoReceita[]>([]);
  const [criativosReceitaLoading, setCriativosReceitaLoading] = useState(false);
  /** Receita atribuída a TODOS os criativos do período (a faixa mostra só os 12 maiores). */
  const [criativosReceitaTotal, setCriativosReceitaTotal] = useState(0);
  /** Quem vendeu mais e o que mais se vendeu — CRM externo (Agendor). */
  const [vendedores, setVendedores] = useState<LinhaVendedor[]>([]);
  const [categorias, setCategorias] = useState<LinhaCategoria[]>([]);
  const [desempenhoLoading, setDesempenhoLoading] = useState(false);
  /** Degrau do Funil de Performance aberto no modal de leads (índice em ETAPAS_FUNIL). */
  const [funilStageIdx, setFunilStageIdx] = useState<number | null>(null);
  const [campaignSortBy, setCampaignSortBy] = useState<SortKey>('spend');
  const [sortBy, setSortBy] = useState<SortKey>('spend');
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [dataCacheAge, setDataCacheAge] = useState<number | null>(null);
  /** Frescor por fonte (selo discreto no topo): idade em segundos do cache das
   *  métricas Meta/Google (X-Cache-Age da rota de metrics — as duas plataformas
   *  vêm na MESMA chamada, então têm a mesma idade) e ISO da última entrada
   *  de lead no CRM (não é idade de cache: é quando o dado chegou). */
  const [metricsCacheAge, setMetricsCacheAge] = useState<number | null>(null);
  const [crmUltimaPorCliente, setCrmUltimaPorCliente] = useState<{ porCliente: Record<string, string>; em: number }>({ porCliente: {}, em: 0 });
  const editMode = true;
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [dashboardPrefs, setDashboardPrefs] = useState<DashboardPrefs>(DEFAULT_DASHBOARD_PREFS);
  const [metaKpiLayout, setMetaKpiLayout] = useState<RglLayout[]>(DEFAULT_META_KPI_LAYOUT);
  const [googleKpiLayout, setGoogleKpiLayout] = useState<RglLayout[]>(DEFAULT_GOOGLE_KPI_LAYOUT);
  const [generalLayout, setGeneralLayout] = useState<RglLayout[]>(DEFAULT_GENERAL_LAYOUT);
  const [metaPanelsLayout, setMetaPanelsLayout] = useState<RglLayout[]>(DEFAULT_META_PANELS_LAYOUT);
  const [googlePanelsLayout, setGooglePanelsLayout] = useState<RglLayout[]>(DEFAULT_GOOGLE_PANELS_LAYOUT);
  const [socialKpiLayout, setSocialKpiLayout] = useState<RglLayout[]>(DEFAULT_SOCIAL_KPI_LAYOUT);
  /** Funil do CRM por região (cidade/UF) — tabela "Desempenho por região". */
  const [porRegiao, setPorRegiao] = useState<PorRegiaoResposta | null>(null);
  /** Funil do CRM por canal do lead — tabela "Funil por canal" (a planilha do Matheus). */
  const [funilCanal, setFunilCanal] = useState<FunilPorCanalResposta | null>(null);
  /** Campanhas nacionais/sem região da Meta abertas por UF (breakdowns=region). */
  const [nacionalPorUf, setNacionalPorUf] = useState<RegiaoCampanhas[] | null>(null);
  const [porCanal, setPorCanal] = useState<{
    origens: FaturamentoPorOrigem[]; total: number; semAtribuicao: number;
    leads: LeadsPorCanal[]; leadsTotal: number; leadsSemCanal: number;
  }>({ origens: [], total: 0, semAtribuicao: 0, leads: [], leadsTotal: 0, leadsSemCanal: 0 });
  const [pageInsights, setPageInsights] = useState<PageInsightsResult[]>([]);
  const [prevPageInsights, setPrevPageInsights] = useState<PageInsightsResult[]>([]);
  const [pageInsightsLoading, setPageInsightsLoading] = useState(false);
  const [igPosts, setIgPosts] = useState<IgPost[]>([]);
  const [igPostsLoading, setIgPostsLoading] = useState(false);
  const [igSortBy, setIgSortBy] = useState<IgSortKey>('reach');
  // Persist selected clients across page refreshes
  useEffect(() => {
    try {
      localStorage.setItem('dashboard-selected-clients', JSON.stringify([...selectedIds]));
    } catch { /* ignore */ }
  }, [[...selectedIds].sort().join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Janela atual e de comparação — mesma régua do servidor (dashboard-periodo.ts).
  const faixaSel = faixaAtual(period, customDateFrom, customDateTo);
  const faixaPrev = faixaAnterior(period, faixaSel);
  const rotuloComp = rotuloComparacao(period, faixaPrev);

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
        const age = res.headers.get('X-Cache-Age');
        return [id, data, age === null ? null : Number(age)] as const;
      })
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, ApiMetrics> = {};
      // Com vários clientes, o selo mostra o MAIS VELHO — é o que responde
      // "há quanto tempo o dado mais antigo desta tela foi buscado".
      let maisVelho: number | null = null;
      for (const r of results) if (r.status === 'fulfilled' && r.value !== null) {
        map[r.value[0]] = r.value[1];
        const a = r.value[2];
        if (a !== null && Number.isFinite(a)) maisVelho = maisVelho === null ? a : Math.max(maisVelho, a);
      }
      setMetricsByClient(map);
      setMetricsCacheAge(maisVelho);
    }).finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady]);

  // Landing page (GA4): mesma régua de período do metrics; cliente sem vínculo devolve ga4:null
  useEffect(() => {
    let cancelled = false;
    setGa4ByClient({});
    if (selectedIds.size === 0 || !customReady) { setGa4Loading(false); return () => { cancelled = true; }; }
    setGa4Loading(true);
    const periodParams = period === 'custom' && customDateFrom && customDateTo
      ? `period=${period}&dateFrom=${customDateFrom}&dateTo=${customDateTo}`
      : `period=${period}`;
    Promise.allSettled(
      [...selectedIds].map(async (id) => {
        const res = await fetch(`/api/clients/${id}/ga4?${periodParams}`);
        if (cancelled) return null;
        const data = res.ok ? await res.json() as { ga4: Ga4Consolidado | null; aviso?: string } : { ga4: null };
        return [id, data] as const;
      })
    ).then(results => {
      if (cancelled) return;
      const map: Record<string, { ga4: Ga4Consolidado | null; aviso?: string }> = {};
      for (const r of results) if (r.status === 'fulfilled' && r.value !== null) map[r.value[0]] = r.value[1];
      setGa4ByClient(map);
    }).finally(() => { if (!cancelled) setGa4Loading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady]);

  // Fetch previous period metrics for comparison
  useEffect(() => {
    let cancelled = false;
    setPrevMetricsByClient({});
    // "Todo período" não tem antes (faixaPrev null): sem busca, prev fica vazio
    // e todo delta "vs anterior" some sozinho em vez de comparar com uma base inventada.
    if (selectedIds.size === 0 || !customReady || !faixaPrev) return () => { cancelled = true; };
    // Mês corrente compara com o MESMO trecho do mês anterior (1..dia de hoje);
    // últimos N dias com os N dias imediatamente antes, sem sobreposição.
    const prevParams = `period=custom&dateFrom=${faixaPrev.from}&dateTo=${faixaPrev.to}`;
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
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, faixaPrev?.from, faixaPrev?.to]);

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
    const params = new URLSearchParams({ from: faixaSel.from, to: faixaSel.to });
    fetch(`/api/crm/summary?${params}`)
      .then(r => r.ok ? r.json() as Promise<{ clientId: string; leads: number; funil: ContagemFunil; total: number; funilStages: FunilPorStage | null; ultimaAtualizacao?: string | null; conversasFora?: number; leadsValidados?: number; vendasCohort?: VendasCohort | null }[]> : [])
      .then(data => {
        const map: Record<string, ClientSheetsSummary> = {};
        // Guarda a última entrada de lead POR cliente: o selo de frescor deriva
        // o mais recente entre os selecionados na hora de renderizar, sem
        // refazer este fetch (que já é da carteira inteira) ao trocar de cliente.
        const ultimas: Record<string, string> = {};
        for (const item of data) {
          map[item.clientId] = { leads: item.leads, funil: item.funil, total: item.total, funilStages: item.funilStages ?? null, conversasFora: item.conversasFora ?? 0, leadsValidados: item.leadsValidados ?? 0, vendasCohort: item.vendasCohort ?? null };
          if (item.ultimaAtualizacao) ultimas[item.clientId] = item.ultimaAtualizacao;
        }
        setCrmSummary(map);
        // "agora" capturado AQUI (no efeito), não no render: a idade do CRM não
        // precisa ticar e Date.now() em render é impuro (regra do compilador).
        setCrmUltimaPorCliente({ porCliente: ultimas, em: Date.now() });
      })
      .catch(() => { setCrmSummary({}); setCrmUltimaPorCliente({ porCliente: {}, em: 0 }); });
  }, [period, customDateFrom, customDateTo, faixaSel.from, faixaSel.to]);

  // Faturamento e leads por canal — de onde vem o dinheiro e de onde vem o lead.
  useEffect(() => {
    let cancelado = false;
    const vazio = { origens: [], total: 0, semAtribuicao: 0, leads: [], leadsTotal: 0, leadsSemCanal: 0 };
    if (selectedIds.size === 0 || !customReady) { setPorCanal(vazio); return () => { cancelado = true; }; }
    const params = new URLSearchParams({
      clientIds: [...selectedIds].join(','),
      from: faixaSel.from,
      to: faixaSel.to,
    });
    fetch(`/api/crm/por-canal?${params}`)
      .then(r => (r.ok ? r.json() as Promise<typeof vazio> : vazio))
      .then(j => {
        if (cancelado) return;
        setPorCanal({
          origens: j.origens ?? [], total: j.total ?? 0, semAtribuicao: j.semAtribuicao ?? 0,
          leads: j.leads ?? [], leadsTotal: j.leadsTotal ?? 0, leadsSemCanal: j.leadsSemCanal ?? 0,
        });
      })
      .catch(() => { if (!cancelado) setPorCanal(vazio); });
    return () => { cancelado = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, faixaSel.from, faixaSel.to]);

  // Funil por região do lead — irmã do summary (mesma régua). Cliente sem
  // região nos leads devolve listas vazias e a tabela nem aparece.
  useEffect(() => {
    let cancelado = false;
    // Só para cliente com SULTS (mesma regra da tabela) — sem isso, nem busca.
    const todosSults = selectedIds.size > 0 && [...selectedIds].every(id => sultsFlags[id]);
    if (!todosSults || !customReady) { setPorRegiao(null); return () => { cancelado = true; }; }
    const params = new URLSearchParams({ clientIds: [...selectedIds].join(','), from: faixaSel.from, to: faixaSel.to });
    fetch(`/api/crm/por-regiao?${params}`)
      .then(r => (r.ok ? r.json() as Promise<PorRegiaoResposta> : null))
      .then(j => { if (!cancelado) setPorRegiao(j); })
      .catch(() => { if (!cancelado) setPorRegiao(null); });
    return () => { cancelado = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, faixaSel.from, faixaSel.to, sultsFlags]);

  // Funil por CANAL do lead — irmã do summary (mesma régua e mesma lei). Vale
  // para qualquer cliente com CRM: sem lead no período, a lista vem vazia e a
  // tabela não aparece.
  useEffect(() => {
    let cancelado = false;
    if (selectedIds.size === 0 || !customReady) { setFunilCanal(null); return () => { cancelado = true; }; }
    const params = new URLSearchParams({ clientIds: [...selectedIds].join(','), from: faixaSel.from, to: faixaSel.to });
    fetch(`/api/crm/por-canal-funil?${params}`)
      .then(r => (r.ok ? r.json() as Promise<FunilPorCanalResposta> : null))
      .then(j => { if (!cancelado) setFunilCanal(j); })
      .catch(() => { if (!cancelado) setFunilCanal(null); });
    return () => { cancelado = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, faixaSel.from, faixaSel.to]);

  // Campanhas NACIONAIS/sem região da Meta abertas por estado. Só depois das
  // campanhas carregarem (precisa dos ids); sem nacional, nem chama.
  useEffect(() => {
    let cancelado = false;
    const ids = campaigns
      .filter(c => c.platform === 'meta' && (() => { const r = regiaoDaCampanha(c.name); return !r || r.tipo === 'nacional'; })())
      .map(c => c.id);
    const todosSults = selectedIds.size > 0 && [...selectedIds].every(id => sultsFlags[id]);
    if (!todosSults || !customReady || campaignsLoading || ids.length === 0) { setNacionalPorUf(null); return () => { cancelado = true; }; }
    const params = new URLSearchParams({ clientIds: [...selectedIds].join(','), campaignIds: ids.join(','), period });
    if (period === 'custom' && customDateFrom && customDateTo) { params.set('dateFrom', customDateFrom); params.set('dateTo', customDateTo); }
    fetch(`/api/meta/regiao-campanhas?${params}`)
      .then(r => (r.ok ? r.json() as Promise<RegiaoCampanhasResposta> : null))
      .then(j => { if (!cancelado) setNacionalPorUf(j?.ok ? j.porUf : null); })
      .catch(() => { if (!cancelado) setNacionalPorUf(null); });
    return () => { cancelado = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `campaigns` entra pelo join de ids (evita refetch a cada render)
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, campaignsLoading, campaigns.map(c => c.id).join(','), sultsFlags]);

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
    const params = new URLSearchParams({
      clientIds: [...selectedIds].join(','),
      from: faixaSel.from,
      to: faixaSel.to,
    });
    const prevParams = faixaPrev ? new URLSearchParams({
      clientIds: [...selectedIds].join(','),
      from: faixaPrev.from,
      to: faixaPrev.to,
    }) : null;
    Promise.all([
      fetch(`/api/meta/page-insights?${params}`).then(r => r.ok ? r.json() as Promise<PageInsightsResult[]> : []),
      // Sem faixa anterior (todo período) não há o que comparar.
      prevParams ? fetch(`/api/meta/page-insights?${prevParams}`).then(r => r.ok ? r.json() as Promise<PageInsightsResult[]> : []) : Promise.resolve([] as PageInsightsResult[]),
    ]).then(([cur, prev]) => {
      if (!cancelled) { setPageInsights(cur); setPrevPageInsights(prev); }
    }).catch(() => {
      if (!cancelled) { setPageInsights([]); setPrevPageInsights([]); }
    }).finally(() => { if (!cancelled) setPageInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedIds, period, customDateFrom, customDateTo, customReady, faixaSel.from, faixaSel.to, faixaPrev?.from, faixaPrev?.to]);

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
  // Pre-compute Google campaign totals for use as fallback when metrics API returns no data
  const googleCampaignsTotals = campaigns
    .filter(c => c.platform === 'google')
    .reduce((a, c) => ({ spend: a.spend + c.spend, leads: a.leads + c.leads, impressions: a.impressions + c.impressions, clicks: a.clicks + c.clicks }),
      { spend: 0, leads: 0, impressions: 0, clicks: 0 });

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
  // Fallback: metrics API returned no Google data — use campaign totals (same source as the campaign table)
  const hasGoogleMetrics = googleCost > 0 || googleConv > 0;
  if (!hasGoogleMetrics && !campaignsLoading && googleCampaignsTotals.spend > 0) {
    googleCost = googleCampaignsTotals.spend;
    googleConv = googleCampaignsTotals.leads;
  }

  const totalLeads = metaLeads + googleConv;
  const totalSpend = metaSpend + googleCost;
  const totalCostPerLead = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const avgCpl = metaLeads > 0 ? metaSpend / metaLeads : 0;
  const metaCtr = metaImpressions > 0 ? (metaClicks / metaImpressions) * 100 : 0;
  // CPM = quanto pagamos para APARECER (custo por mil impressões). Pedido do
  // Matheus: ler o preço do leilão do mercado, separado do CPL — CPL subindo com
  // CPM estável é criativo/segmentação; CPL subindo com CPM subindo é o leilão.
  const metaCpm = metaImpressions > 0 ? (metaSpend / metaImpressions) * 1000 : 0;
  let googleImpressions = 0, googleClicks = 0;
  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.google) {
      googleImpressions += m.google.impressions;
      googleClicks += m.google.clicks;
    }
  }
  if (!hasGoogleMetrics && !campaignsLoading && googleCampaignsTotals.spend > 0) {
    googleImpressions = googleCampaignsTotals.impressions;
    googleClicks = googleCampaignsTotals.clicks;
  }
  const hasGoogleData = [...selectedIds].some(id => metricsByClient[id]?.google != null) || (!campaignsLoading && googleCampaignsTotals.spend > 0);
  const hasGoogleLink = clientLinks.some(l => selectedIds.has(l.clientId) && l.platform === 'google_ads');
  const googleCpc = googleClicks > 0 ? googleCost / googleClicks : 0;
  const googleCpm = googleImpressions > 0 ? (googleCost / googleImpressions) * 1000 : 0;
  let googleSearchImprShare = 0, googleSearchBudgetLostIS = 0, googleSearchRankLostIS = 0, googleSearchAbsTopIS = 0, googleSearchTopIS = 0;
  let googleCompetitiveCount = 0;
  for (const id of selectedIds) {
    const m = metricsByClient[id];
    if (m?.google?.searchImprShare != null && m.google.searchImprShare > 0) {
      googleSearchImprShare += m.google.searchImprShare;
      googleSearchBudgetLostIS += m.google.searchBudgetLostIS ?? 0;
      googleSearchRankLostIS += m.google.searchRankLostIS ?? 0;
      googleSearchAbsTopIS += m.google.searchAbsTopIS ?? 0;
      googleSearchTopIS += m.google.searchTopIS ?? 0;
      googleCompetitiveCount++;
    }
  }
  if (googleCompetitiveCount > 1) {
    googleSearchImprShare /= googleCompetitiveCount;
    googleSearchBudgetLostIS /= googleCompetitiveCount;
    googleSearchRankLostIS /= googleCompetitiveCount;
    googleSearchAbsTopIS /= googleCompetitiveCount;
    googleSearchTopIS /= googleCompetitiveCount;
  }
  // CTR combinado PONDERADO por impressões — média simples fazia uma conta com
  // 100 impressões pesar igual a outra com 1 milhão.
  const totalImpr = metaImpressions + googleImpressions;
  const avgCtr = totalImpr > 0 ? ((metaClicks + googleClicks) / totalImpr) * 100 : 0;
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
  const summaryRevenue = [...selectedIds].reduce((sum, id) => sum + (crmSummary[id]?.total ?? 0), 0);
  const metricsRevenue = [...selectedIds].reduce((sum, id) => sum + (metricsByClient[id]?.crm?.revenue ?? 0), 0);
  const revenue = metricsRevenue > 0 ? metricsRevenue : summaryRevenue;

  // Funil CUMULATIVO por etapa semântica, somado sobre os clientes selecionados.
  // A contagem por rótulo hardcoded (FUNNEL_ORDER/'Atendimento'…) morreu junto
  // com o getStage antigo — agora /api/crm/summary devolve o funil pronto,
  // calculado do mapeamento de etapas do PRÓPRIO cliente (funil-etapas.ts).
  const funilCrm = somarFunis([...selectedIds].map(id => crmSummary[id]?.funil ?? FUNIL_VAZIO));

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
  const plannedSalesPartial = autoPartial(plannedSalesTotal, period, faixaSel);
  const effectiveSalesGoal = plannedSalesPartial > 0 ? plannedSalesPartial : plannedSalesTotal;

  const revenuePartial = autoPartial(plannedRevenue, period, faixaSel);
  const leadsPartial = autoPartial(leadsGoal, period, faixaSel);
  const effectiveRevenueGoal = revenuePartial > 0 ? revenuePartial : plannedRevenue;
  const effectiveLeadsGoal = leadsPartial > 0 ? leadsPartial : leadsGoal;
  const cplGoal = leadsGoal > 0 ? plannedInvestment / leadsGoal : 0;
  const roiGoal = plannedInvestment > 0 && plannedRevenue > 0 ? plannedRevenue / plannedInvestment : 10;
  const roi = totalSpend > 0 ? revenue / totalSpend : 0;

  // Período anterior
  let prevMetaLeads = 0, prevMetaSpend = 0, prevGoogleConv = 0, prevGoogleCost = 0;
  let prevMetaReach = 0, prevMetaImpressions = 0, prevMetaClicks = 0;
  let prevGoogleImpressions = 0, prevGoogleClicks = 0;
  let prevRevenue = 0, prevCrmSales = 0;
  for (const id of selectedIds) {
    const m = prevMetricsByClient[id];
    if (m?.meta) {
      prevMetaLeads += m.meta.leads; prevMetaSpend += m.meta.spend;
      prevMetaReach += m.meta.reach ?? 0; prevMetaImpressions += m.meta.impressions; prevMetaClicks += m.meta.clicks;
    }
    if (m?.google) {
      prevGoogleConv += m.google.conversions; prevGoogleCost += m.google.cost;
      prevGoogleImpressions += m.google.impressions; prevGoogleClicks += m.google.clicks;
    }
    if (m?.crm) { prevRevenue += m.crm.revenue ?? 0; prevCrmSales += m.crm.sales ?? 0; }
  }
  const prevTotalLeads = prevMetaLeads + prevGoogleConv;
  const prevTotalSpend = prevMetaSpend + prevGoogleCost;
  const prevCpl = prevTotalLeads > 0 ? prevTotalSpend / prevTotalLeads : 0;
  const prevRoi = prevTotalSpend > 0 ? prevRevenue / prevTotalSpend : 0;
  const prevTicket = prevCrmSales > 0 ? prevRevenue / prevCrmSales : 0;
  const prevMetaCtr = prevMetaImpressions > 0 ? (prevMetaClicks / prevMetaImpressions) * 100 : 0;
  const prevMetaCpm = prevMetaImpressions > 0 ? (prevMetaSpend / prevMetaImpressions) * 1000 : 0;
  const prevAvgCpl = prevMetaLeads > 0 ? prevMetaSpend / prevMetaLeads : 0;
  const prevGoogleCpc = prevGoogleClicks > 0 ? prevGoogleCost / prevGoogleClicks : 0;
  const prevGoogleCpm = prevGoogleImpressions > 0 ? (prevGoogleCost / prevGoogleImpressions) * 1000 : 0;
  const pct = (cur: number, prev: number): number | null => prev > 0 ? ((cur - prev) / prev) * 100 : null;

  // Receita efetiva: usa CRM se disponível, senão estima via fechamentos × TKM médio
  let totalTkm = 0, tkmCount = 0;
  for (const id of selectedIds) {
    const planning = planningsByClient[id] ?? readPlanningFromStorage(id);
    if (planning.tkm > 0) { totalTkm += planning.tkm; tkmCount++; }
  }
  const avgTkm = tkmCount > 0 ? totalTkm / tkmCount : DEFAULT_PLANNING.tkm;
  const closings = funilCrm.fechamentos;
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
    const clientLeadsPartial = autoPartial(clientPlannedLeads, period, faixaSel);
    const clientCpl = m?.meta?.cpl ?? 0;
    const clientCplGoal = planning.cplMeta;

    // O texto do alerta é o que aparece na faixa — precisa dizer o QUÊ, não só
    // que "há N alertas".
    const esperadoTxt = period === 'this_month' ? 'esperado até hoje' : 'esperado no período';
    const abaixoPct = clientLeadsPartial > 0 ? Math.round((1 - clientLeads / clientLeadsPartial) * 100) : 0;
    if (clientLeadsPartial > 0 && clientLeads < clientLeadsPartial * 0.5) {
      alerts.push({ clientId: id, clientName: client.name, msg: `Leads ${abaixoPct}% abaixo do ${esperadoTxt} (${premiumValue(clientLeads)} de ${premiumValue(clientLeadsPartial)})`, severity: 'critical' });
    } else if (clientLeadsPartial > 0 && clientLeads < clientLeadsPartial * 0.75) {
      alerts.push({ clientId: id, clientName: client.name, msg: `Leads ${abaixoPct}% abaixo do ${esperadoTxt} (${premiumValue(clientLeads)} de ${premiumValue(clientLeadsPartial)})`, severity: 'warning' });
    }
    if (clientCplGoal > 0 && clientCpl > clientCplGoal * 1.5) {
      alerts.push({ clientId: id, clientName: client.name, msg: `CPL Meta ${(clientCpl / clientCplGoal).toFixed(1).replace('.', ',')}× acima da meta (${formatCurrencyBRL(clientCpl)} / meta ${formatCurrencyBRL(clientCplGoal)})`, severity: 'critical' });
    }
  }

  const selectedClients = clients.filter(c => selectedIds.has(c.id));
  const linhasRegiao = montarTabelaRegioes(
    campaigns.map(c => ({ name: c.name, platform: c.platform, spend: c.spend, leads: c.leads })),
    porRegiao?.cidades ?? [], porRegiao?.ufs ?? [],
  );
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

  const qualified = funilCrm.qualificados;
  const appointments = funilCrm.agendamentos;
  const showUps = funilCrm.comparecimentos;
  const conversions = funilCrm.fechamentos || crmSales || googleConv;
  // Build dynamic funnel steps from first selected client's planning stages
  const firstClientIdForFunnel = [...selectedIds][0];
  const firstPlanningForFunnel = firstClientIdForFunnel
    ? (planningsByClient[firstClientIdForFunnel] ?? readPlanningFromStorage(firstClientIdForFunnel))
    : DEFAULT_PLANNING;
  const cleanFunnelLabel = (name: string) => name.replace(/^\d+[ºo]?\s*[—–-]\s*/i, '').trim();
  // Aggregate planned volumes across selected clients (aligned to first client's stage count)
  const plannedFunnelAgg: number[] = [];
  for (const id of selectedIds) {
    const pf = plannedFunnelFromGoal(goalsByClient[id], planningsByClient[id] ?? readPlanningFromStorage(id));
    pf.forEach((v, i) => { plannedFunnelAgg[i] = (plannedFunnelAgg[i] ?? 0) + v; });
  }
  // Actual volumes per stage index (maps to planning stage order)
  // Topo do funil resolvido POR CLIENTE conforme `funil_fonte_topo` ('auto' =
  // CRM quando há leads lá, senão anúncios). Nunca em silêncio: a fonte usada
  // vira rótulo no card ("fonte: CRM" / "estimado por anúncios" / mistas).
  // `totalLeads` segue intocado no CPL, no share por canal e nas séries, onde
  // métrica de anúncio é o número certo.
  const fontesTopo: ('crm' | 'anuncios')[] = [];
  let funnelTopo = 0;
  for (const id of selectedIds) {
    // Lei 3 (lead-contagem.ts): sem NENHUM lead de porta validada (planilha/
    // CRM externo/formulário) na janela, o CRM não manda no topo — só chat com
    // rastro não sustenta contagem (WhatsApp desconecta, form não chega). Cai
    // nas plataformas.
    const validados = crmSummary[id]?.leadsValidados ?? 0;
    const crmLeads = validados > 0 ? (crmSummary[id]?.leads ?? 0) : 0;
    const m = metricsByClient[id];
    const adsLeads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
    const fonte = normalizarFonteTopo(clients.find(c => c.id === id)?.funil_fonte_topo);
    const r = resolverTopoFunil(fonte, crmLeads, adsLeads);
    funnelTopo += r.topo;
    if (crmLeads > 0 || adsLeads > 0) fontesTopo.push(r.fonte);
  }
  // O que a lei deixou fora (chat sem rastro + manuais) e a quebra de vendas
  // por coorte (Lei 5), somados dos clientes selecionados.
  const conversasFora = [...selectedIds].reduce((s, id) => s + (crmSummary[id]?.conversasFora ?? 0), 0);
  const vendasCohort = [...selectedIds].reduce<VendasCohort>((a, id) => {
    const v = crmSummary[id]?.vendasCohort; if (!v) return a;
    return { periodo: a.periodo + v.periodo, anteriores: a.anteriores + v.anteriores, semData: a.semData + v.semData };
  }, { periodo: 0, anteriores: 0, semData: 0 });
  const detalhesVendas: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }> = [];
  if (vendasCohort.periodo + vendasCohort.anteriores + vendasCohort.semData > 0) {
    detalhesVendas.push({ texto: `${vendasCohort.periodo} de leads do período`, tom: 'bom' });
    if (vendasCohort.anteriores > 0) detalhesVendas.push({ texto: `${vendasCohort.anteriores} de leads anteriores`, tom: 'neutro' });
    if (vendasCohort.semData > 0) detalhesVendas.push({ texto: `${vendasCohort.semData} sem data de fechamento`, tom: 'neutro' });
  }
  const fonteTopoLabel = rotuloFonteTopo(fontesTopo) + (conversasFora > 0 ? ` · ${premiumValue(conversasFora)} conversas do WhatsApp sem rastro de anúncio ficaram fora` : '');
  const topoEhCrm = fontesTopo.length > 0 && fontesTopo.every(f => f === 'crm');
  // Cliente ÚNICO de delivery selecionado → swap do funil pelo resumo de
  // delivery. Seleção múltipla mantém o funil normal (misturar recorrência de
  // pedidos com funil de leads num agregado não faz sentido).
  const deliverySoloId = selectedIds.size === 1 && deliveryFlags[[...selectedIds][0]]
    ? [...selectedIds][0] : null;

  // Período em ISO — usado pelo resumo de delivery E pelo modal de leads do
  // funil. ⚠️ O modal PRECISA usar exatamente esta janela: é a mesma que
  // alimenta /api/crm/summary (o número do card), então divergir aqui faria a
  // lista abrir com um total diferente do que foi clicado.
  const periodoISO = { from: faixaSel.from, to: faixaSel.to };
  const deliveryRange = periodoISO;

  // ── Desempenho comercial: vendedores e categorias ─────────────────────────
  useEffect(() => {
    let cancelado = false;
    const ids = [...selectedIds];
    if (ids.length === 0) { setVendedores([]); setCategorias([]); return () => { cancelado = true; }; }
    setDesempenhoLoading(true);
    const qs = new URLSearchParams({ clientIds: ids.join(','), from: periodoISO.from, to: periodoISO.to });
    fetch(`/api/crm/desempenho?${qs}`)
      .then(r => r.ok ? r.json() as Promise<{ vendedores?: LinhaVendedor[]; categorias?: LinhaCategoria[] }> : null)
      .then(j => {
        if (cancelado) return;
        setVendedores(j?.vendedores ?? []);
        setCategorias(j?.categorias ?? []);
      })
      .catch(() => { if (!cancelado) { setVendedores([]); setCategorias([]); } })
      .finally(() => { if (!cancelado) setDesempenhoLoading(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, periodoISO.from, periodoISO.to]);

  // ── Faturamento por criativo (CRM) ────────────────────────────────────────
  // Uma busca por cliente selecionado — a rota da biblioteca é por cliente, e
  // pedir sem cliente traria a carteira inteira só pra descartar quase tudo.
  useEffect(() => {
    let cancelado = false;
    const ids = [...selectedIds];
    if (ids.length === 0) { setCriativosReceita([]); return () => { cancelado = true; }; }
    setCriativosReceitaLoading(true);
    // Zera na troca de período/cliente: sem isso a faixa mostra o recorte
    // anterior enquanto o novo carrega.
    setCriativosReceita([]);
    setCriativosReceitaTotal(0);
    const dias = Math.max(1, Math.round(
      (new Date(periodoISO.to).getTime() - new Date(periodoISO.from).getTime()) / 86400000) + 1);

    (async () => {
      type Linha = {
        client_id: string; client_name: string | null; ad_key: string; source_id: string | null;
        ad_name: string | null; creative_name: string | null; campaign_name: string | null;
        leads: number; vendas: number; receita: number;
      };
      const lotes = await Promise.all(ids.map(async id => {
        const qs = new URLSearchParams({ clientId: id, from: periodoISO.from, to: periodoISO.to });
        const r = await fetch(`/api/creative-library?${qs}`).catch(() => null);
        if (!r?.ok) return [] as Linha[];
        const j = await r.json().catch(() => null) as { creatives?: Linha[] } | null;
        return j?.creatives ?? [];
      }));
      if (cancelado) return;

      const comReceita = lotes.flat().filter(l => Number(l.receita) > 0);
      setCriativosReceitaTotal(comReceita.reduce((s, l) => s + (Number(l.receita) || 0), 0));
      const linhas = comReceita
        .sort((a, b) => Number(b.receita) - Number(a.receita))
        .slice(0, 12);

      const monta = (thumbs: Record<string, { thumbnail_url: string | null }>): CriativoReceita[] =>
        linhas.map(l => ({
          adKey: `${l.client_id}:${l.ad_key}`,
          adId: l.source_id,
          adName: l.ad_name || l.creative_name || 'Criativo sem nome',
          campaignName: l.campaign_name,
          clientName: ids.length > 1 ? l.client_name : null,
          leads: Number(l.leads) || 0,
          vendas: Number(l.vendas) || 0,
          receita: Number(l.receita) || 0,
          thumbnail: l.source_id ? thumbs[l.source_id]?.thumbnail_url ?? null : null,
        }));

      setCriativosReceita(monta({}));
      setCriativosReceitaLoading(false);

      // Thumbnail vem da Graph, depois da lista — best-effort, não segura a faixa.
      const porCliente = new Map<string, string[]>();
      for (const l of linhas) {
        if (!l.source_id) continue;
        const atual = porCliente.get(l.client_id) ?? [];
        atual.push(l.source_id);
        porCliente.set(l.client_id, atual);
      }
      if (porCliente.size === 0) return;
      const e = await fetch('/api/creative-library/enrich', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          days: dias,
          items: [...porCliente.entries()].map(([cid, adIds]) => ({ clientId: cid, adIds })),
        }),
      }).catch(() => null);
      if (cancelado || !e?.ok) return;
      const j = await e.json().catch(() => null) as { enrich?: Record<string, { thumbnail_url: string | null }> } | null;
      if (!cancelado && j?.enrich) setCriativosReceita(monta(j.enrich));
    })().catch(() => { if (!cancelado) setCriativosReceitaLoading(false); });

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, periodoISO.from, periodoISO.to]);

  // ── Modo Food / Delivery ──────────────────────────────────────────────────
  // O segmento vem de `clients.dashboard_type` (coluna que já existia). O perfil
  // decide KPIs, rótulos e blocos — a tela é a MESMA, só troca de configuração.
  // Seleção mista (food + lead-gen) cai em lead-gen de propósito: ver
  // `perfilDaSelecao` em src/lib/dashboard-segmento.ts.
  const perfilAtivo = perfilDaSelecao(selectedClients.map(c => normalizarSegmento(c.dashboard_type)));
  const modoFood = perfilAtivo.segmento === 'food';
  // Cliente único é a condição para os blocos de food: somar recorrência e mix
  // de produtos de estabelecimentos diferentes produz um agregado sem sentido.
  const foodSoloId = modoFood && selectedIds.size === 1 ? [...selectedIds][0] : null;
  // Instagram orgânico agregado — mesma fonte do painel de Instagram, computado
  // aqui porque o adaptador de delivery roda antes do bloco que monta aquele
  // painel. `null` quando não há conta vinculada (a DeliveryView mostra "—").
  const igFood = (() => {
    const cur = pageInsights.filter(p => p.instagram).map(p => p.instagram!);
    if (cur.length === 0) return null;
    const s = (k: 'followers' | 'followersGained' | 'reach' | 'totalInteractions' | 'saves' | 'profileViews') =>
      cur.reduce((acc, d) => acc + (d[k] ?? 0), 0);
    const alcance = s('reach');
    const interacoes = s('totalInteractions');
    const ganho = s('followersGained');
    return {
      seguidores: s('followers') || null,
      // Ganho do período (follower_count). Zero fica `null` porque não dá para
      // distinguir "nenhum seguidor novo" de "conta sem a métrica".
      novosSeguidores: ganho || null,
      alcance: alcance || null,
      interacoes: interacoes || null,
      salvamentos: s('saves') || null,
      visitasPerfil: s('profileViews') || null,
      engajamento: alcance > 0 ? interacoes / alcance : null,
    };
  })();
  const dadosFood = useDadosDelivery(foodSoloId, periodoISO.from, periodoISO.to, {
    metaSpend, metaImpressions, metaClicks,
    googleCost, googleImpressions, googleClicks,
    metaSaldo: metaBalance > 0 ? metaBalance : null,
    googleSaldo: googleBalance > 0 ? googleBalance : null,
    instagram: igFood ?? {
      seguidores: null, novosSeguidores: null, alcance: null, interacoes: null,
      salvamentos: null, visitasPerfil: null, engajamento: null,
    },
  });

  // Faixa de eficiência do food. Fica no topo porque responde "o anúncio está
  // pagando?", que a DeliveryView (focada em vendas e base) não responde.
  // Agendamentos e CPL somem: não existem em delivery.
  // Modelo editável do segmento — decide posição, tamanho, ordem, visibilidade
  // e título de cada bloco. É por SEGMENTO: salvar muda o painel de todos os
  // clientes de food.
  const { modelo: modeloFood, setModelo: setModeloFood } = useModelo('food');
  const [editandoModelo, setEditandoModelo] = useState(false);

  const quickMetricsFood = dadosFood ? (() => {
    // Comparativos que dão pra fechar com o período anterior: custo por pedido
    // (investimento ÷ pedidos) e ROAS (receita ÷ investimento). `null` quando
    // não há base anterior — nunca "+∞%".
    const cppAtual = custoPorPedido(totalSpend, dadosFood.vendas.pedidos);
    const cppPrev = dadosFood.anterior ? custoPorPedido(prevTotalSpend, dadosFood.anterior.pedidos) : null;
    const roasAtual = roasFood(dadosFood.vendas.receita, totalSpend);
    const roasPrev = dadosFood.anterior ? roasFood(dadosFood.anterior.receita, prevTotalSpend) : null;
    return [
      { title: 'Investimento Total', value: premiumValue(totalSpend, 'currency'), change: pctChange(totalSpend, prevTotalSpend), icon: CreditCard, neutralChange: true },
      { title: 'Custo por pedido', value: formatarMetrica(cppAtual, 'moeda'), change: cppAtual !== null && cppPrev !== null && cppPrev > 0 ? pctChange(cppAtual, cppPrev) : null, icon: Tag, inverseChange: true },
      { title: 'ROAS', value: formatarMetrica(roasAtual, 'multiplicador'), change: roasAtual !== null && roasPrev !== null && roasPrev > 0 ? pctChange(roasAtual, roasPrev) : null, icon: TrendingUp },
      { title: 'Ticket médio', value: formatarMetrica(dadosFood.vendas.ticket, 'moeda'), change: dadosFood.variacao.ticket, icon: Receipt },
      { title: 'Recorrência', value: formatarMetrica(dadosFood.clientes.taxaRecorrencia, 'percentual'), change: null, icon: Repeat },
    ];
  })() : [];
  // Taxa do FUNIL = fechamentos sobre o topo DELE. A antiga `conversionRate` global usava
  // `funnelVisitors` (impressões + cliques), o que dava "0,13%" ao lado de um
  // funil que começa em contatos — dois números sem relação na mesma caixa.
  const funnelTaxa = funnelTopo > 0 ? (conversions / funnelTopo) * 100 : 0;

  // ── Meta de CPL da seleção ────────────────────────────────────────────────
  // Um cliente: o cplMeta dele. Vários: CPL planejado ponderado pelos leads
  // planejados (investimento planejado ÷ leads planejados); sem meta de leads,
  // média simples dos cplMeta.
  const cplMetaSel = (() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return 0;
    if (ids.length === 1) return (planningsByClient[ids[0]] ?? readPlanningFromStorage(ids[0])).cplMeta || 0;
    if (cplGoal > 0) return cplGoal;
    const metas = ids.map(id => (planningsByClient[id] ?? readPlanningFromStorage(id)).cplMeta).filter(v => v > 0);
    return metas.length > 0 ? metas.reduce((acc, v) => acc + v, 0) / metas.length : 0;
  })();

  // ── Séries diárias (por dia, não acumuladas) ──────────────────────────────
  const dailyPorData = new Map(dailySeries.map(r => [r.date, r]));
  const diasSel = datasDaFaixa(faixaSel);
  const gastoDia = diasSel.map(d => (dailyPorData.get(d)?.meta?.spend ?? 0) + (dailyPorData.get(d)?.google?.cost ?? 0));
  const leadsDia = diasSel.map(d => (dailyPorData.get(d)?.meta?.leads ?? 0) + (dailyPorData.get(d)?.google?.conversions ?? 0));
  const receitaDia = diasSel.map(d => dailyPorData.get(d)?.crm?.revenue ?? 0);
  const temSerieGasto = gastoDia.some(v => v > 0);

  // CPL / CAC / %FAT com a META do planejamento embaixo — as três colunas de
  // custo da planilha do Matheus. Meta de CAC = investimento planejado ÷ vendas
  // planejadas; meta de %FAT = investimento planejado ÷ faturamento planejado
  // (ambos saem do CPL-meta × funil planejado do cliente). Sem planejamento,
  // sem nota — nunca "meta R$ 0".
  const cac = totalSpend > 0 && crmSales > 0 ? totalSpend / crmSales : 0;
  const prevCac = prevTotalSpend > 0 && prevCrmSales > 0 ? prevTotalSpend / prevCrmSales : 0;
  const metaCac = plannedInvestment > 0 && plannedSalesTotal > 0 ? plannedInvestment / plannedSalesTotal : 0;
  const fatPct = totalSpend > 0 && revenue > 0 ? (totalSpend / revenue) * 100 : 0;
  const prevFatPct = prevTotalSpend > 0 && prevRevenue > 0 ? (prevTotalSpend / prevRevenue) * 100 : 0;
  const metaFatPct = plannedInvestment > 0 && plannedRevenue > 0 ? (plannedInvestment / plannedRevenue) * 100 : 0;
  const notaMeta = (meta: number, formato: 'currency' | 'percent') => (meta > 0 ? `meta ${premiumValue(meta, formato)}` : undefined);
  const estourou = (real: number, meta: number) => real > 0 && meta > 0 && real > meta;

  const quickMetrics = [
    { title: 'Investimento Total', value: premiumValue(totalSpend, 'currency'), change: pctChange(totalSpend, prevTotalSpend), icon: CreditCard, neutralChange: true, serie: temSerieGasto ? gastoDia : undefined },
    { title: 'CPL Médio', value: totalCostPerLead > 0 ? premiumValue(totalCostPerLead, 'currency') : '—', change: pctChange(totalCostPerLead, prevCpl), icon: Tag, inverseChange: true, serie: temSerieGasto && leadsDia.some(v => v > 0) ? cplSeries : undefined, dica: 'Investimento Meta + Google ÷ leads reportados pelas plataformas · linha = CPL acumulado dia a dia', nota: notaMeta(cplMetaSel, 'currency'), notaRuim: estourou(totalCostPerLead, cplMetaSel) },
    { title: 'CAC', value: cac > 0 ? premiumValue(cac, 'currency') : '—', change: cac > 0 && prevCac > 0 ? pctChange(cac, prevCac) : null, icon: Wallet, inverseChange: true, dica: 'Investimento Meta + Google ÷ vendas do CRM no período', nota: notaMeta(metaCac, 'currency'), notaRuim: estourou(cac, metaCac) },
    { title: '% FAT', value: fatPct > 0 ? premiumValue(fatPct, 'percent') : '—', change: fatPct > 0 && prevFatPct > 0 ? pctChange(fatPct, prevFatPct) : null, icon: PiggyBank, inverseChange: true, dica: 'Investimento em mídia ÷ faturamento do CRM — quanto do que entrou foi gasto em anúncio', nota: notaMeta(metaFatPct, 'percent'), notaRuim: estourou(fatPct, metaFatPct) },
    // Ticket médio = faturamento ÷ VENDAS do CRM (não ÷ conversions, que cai em
    // fallback de funil/Google e daria um ticket calculado sobre um denominador
    // que não é o mesmo que gerou a receita). 0 vendas → "—", nunca R$ 0,00.
    { title: 'Ticket Médio', value: avgCrmTicket > 0 ? premiumValue(avgCrmTicket, 'currency') : '—', change: prevTicket > 0 && avgCrmTicket > 0 ? pctChange(avgCrmTicket, prevTicket) : null, icon: Receipt },
    { title: 'Agendamentos', value: premiumValue(appointments), change: null, icon: Calendar },
    // ROAS, não ROI: é receita ÷ investimento (ROI descontaria o investimento).
    { title: 'ROAS', value: roi > 0 ? premiumValue(roi, 'times') : '—', change: pctChange(roi, prevRoi), icon: TrendingUp, dica: 'Receita do CRM ÷ investimento em mídia (Meta + Google)', serie: temSerieGasto && receitaDia.some(v => v > 0) ? roiSeries : undefined },
    // Mesma taxa que o funil mostra como "Conversão geral" (fechamentos ÷
    // contatos). A antiga "Conversão Geral" dividia por alcance + impressões e
    // dava 0,02% — número sem leitura possível. Sem funil do período anterior
    // carregado, fica sem variação em vez de inventar uma.
    { title: 'Conversão do funil', value: funnelTaxa > 0 ? premiumValue(funnelTaxa, 'percent') : '—', change: null, icon: Target, dica: 'Fechamentos ÷ contatos do Funil de Performance (CRM)' },
  ];
  const actualFunnelVolumes = [funnelTopo, qualified, appointments, showUps, conversions];
  // Quebra do degrau de AGENDAMENTOS (índice 2): dos agendados que ainda não
  // compareceram, quantos têm data futura e quantos furaram de fato.
  // "A comparecer" e "faltaram" viraram SEMI-DEGRAUS (linhas da planilha, abaixo);
  // aqui ficam só os chips que não têm linha própria.
  const detalhesAgendamento: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }> = [];
  if (funilCrm.agendamentoSemDesfecho > 0) {
    // Nem promessa nem falta: a data passou e o CRM não registrou o desfecho.
    detalhesAgendamento.push({ texto: `${funilCrm.agendamentoSemDesfecho} sem retorno`, tom: 'neutro' });
  }
  if (funilCrm.agendamentoSemData > 0) {
    detalhesAgendamento.push({ texto: `${funilCrm.agendamentoSemData} sem data`, tom: 'neutro' });
  }
  // Taxa de presença entre quem JÁ deveria ter vindo (compareceu ÷ (compareceu +
  // faltou)) — o "67%" da planilha do Matheus. Quem ainda vai vir fica fora.
  if (funilCrm.comparecimentos + funilCrm.faltaram > 0) {
    const presenca = (funilCrm.comparecimentos / (funilCrm.comparecimentos + funilCrm.faltaram)) * 100;
    detalhesAgendamento.push({ texto: `${presenca.toFixed(0)}% compareceram`, tom: presenca >= 50 ? 'bom' : 'ruim' });
  }
  // Linhas cinza da planilha sob Leads e sob Engajados (situação da coluna).
  const detalhesLeads: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }> = [];
  if (funilCrm.semResposta > 0) detalhesLeads.push({ texto: `${funilCrm.semResposta} sem resposta`, tom: 'neutro' });
  if (funilCrm.naoLeads > 0) detalhesLeads.push({ texto: `${funilCrm.naoLeads} não-lead (já cliente) fora`, tom: 'neutro' });
  const detalhesEngajados: Array<{ texto: string; tom: 'bom' | 'ruim' | 'neutro' }> = [];
  if (funilCrm.pararamResponder > 0) detalhesEngajados.push({ texto: `${funilCrm.pararamResponder} pararam de responder`, tom: 'ruim' });
  // Os SEMI-DEGRAUS da planilha (Perca · Em atendimento · Não compareceram ·
  // Faltam comparecer), cada um logo abaixo da faixa a que pertence. Sempre
  // presentes (zero inclusive) — a leitura da planilha é a linha existir.
  const semiDegrausSemantico = (idx: { contato: number; qualificado: number; agendamento: number; comparecimento: number }): SemiDegrau[] => ([
    { apos: idx.contato, rotulo: 'Perca', valor: funilCrm.perdidos, tom: 'ruim' },
    { apos: idx.qualificado, rotulo: 'Em atendimento', valor: funilCrm.emAtendimento, tom: 'neutro' },
    { apos: idx.agendamento, rotulo: 'Não compareceram', valor: funilCrm.faltaram, tom: 'ruim' },
    { apos: idx.comparecimento, rotulo: 'Faltam comparecer', valor: funilCrm.aComparecer, tom: 'bom' },
  ] as SemiDegrau[]).filter(sd => sd.apos >= 0);
  // Funil pelas ETAPAS REAIS do Kanban do cliente — nome, cor e nº de degraus
  // vêm do CRM dele (pedido do Matheus, 2026-09-14). Só com UM cliente
  // selecionado: Kanbans de clientes diferentes não se somam num funil só, então
  // seleção múltipla / "Todos" mantém o funil semântico de 5 degraus.
  const stageFunilSolo = selectedIds.size === 1
    ? (crmSummary[[...selectedIds][0]]?.funilStages ?? null)
    : null;
  const usaStageFunil = !!stageFunilSolo && stageFunilSolo.degraus.length > 0;

  const funnelStepsNew = usaStageFunil
    ? stageFunilSolo!.degraus.map((d, i) => {
        // A quebra "a comparecer / faltaram" vai no ÚLTIMO degrau de agendamento
        // que tenha um comparecimento depois. Os números vêm do funil semântico
        // do próprio cliente (funilCrm) — no modo 1-cliente, é a mesma base.
        const restante = stageFunilSolo!.degraus.slice(i + 1);
        const ehUltimoAgendamento = d.etapa === 'agendamento'
          && !restante.some(x => x.etapa === 'agendamento')
          && restante.some(x => x.etapa === 'comparecimento');
        const ehFechamento = d.etapa === 'fechamento' && !restante.some(x => x.etapa === 'fechamento');
        return {
          // Topo e 2º degrau com rótulo FIXO (pedido do Matheus, 2026-09-24): o topo é
          // "Leads" (o total — a 1ª coluna do Kanban, ex. "Engajado", não descreve
          // isso) e o 2º é "Engajados" (quem respondeu/interagiu). Do 3º em diante,
          // o nome real da coluna do cliente.
          label: d.etapa === 'contato' ? 'Leads' : d.etapa === 'qualificado' ? 'Engajados' : d.label,
          actual: d.alcancaram,
          planned: 0,
          color: d.color,
          detalhes: d.etapa === 'contato' && !restante.some(x => x.etapa === 'contato') && detalhesLeads.length ? detalhesLeads
            : d.etapa === 'qualificado' && !restante.some(x => x.etapa === 'qualificado') && detalhesEngajados.length ? detalhesEngajados
            : ehUltimoAgendamento ? detalhesAgendamento
            : ehFechamento && detalhesVendas.length ? detalhesVendas : undefined,
        };
      })
    : firstPlanningForFunnel.stages.map((stage, i) => ({
        // Mesmos rótulos fixos do funil real nos dois primeiros degraus.
        label: i === 0 ? 'Leads' : i === 1 ? 'Engajados' : cleanFunnelLabel(stage.name),
        actual: actualFunnelVolumes[i] ?? 0,
        planned: plannedFunnelAgg[i] ?? 0,
        color: FUNNEL_STEP_COLORS[i % FUNNEL_STEP_COLORS.length],
        // Só no degrau de agendamentos. Vale mesmo com topo estimado por anúncio:
        // agendamentos e comparecimentos vêm do CRM nos dois casos (só o TOPO muda
        // de fonte), então a quebra sempre fecha com os números exibidos.
        // Lei 5 no degrau de vendas (4): de leads do período × de leads anteriores.
        detalhes: i === 0 && detalhesLeads.length ? detalhesLeads : i === 1 && detalhesEngajados.length ? detalhesEngajados : i === 2 ? detalhesAgendamento : i === 4 && detalhesVendas.length ? detalhesVendas : undefined,
      }));
  // Semi-degraus: no funil semântico os índices são fixos (0..3); no funil real
  // do Kanban, cada linha vai sob o ÚLTIMO degrau daquela etapa (o mesmo lugar
  // dos chips) — e só existe se a etapa existir na escada.
  const ultimoIdx = (etapa: EtapaFunil): number => {
    if (!usaStageFunil) return -1;
    const ds = stageFunilSolo!.degraus;
    for (let i = ds.length - 1; i >= 0; i--) if (ds[i].etapa === etapa) return i;
    return -1;
  };
  const funnelSemiDegraus: SemiDegrau[] = deliverySoloId ? [] : usaStageFunil
    ? semiDegrausSemantico({ contato: ultimoIdx('contato'), qualificado: ultimoIdx('qualificado'), agendamento: ultimoIdx('agendamento'), comparecimento: ultimoIdx('comparecimento') })
    : semiDegrausSemantico({ contato: 0, qualificado: 1, agendamento: 2, comparecimento: 3 });
  // Conversão geral do funil real = fechamento (último degrau) sobre o topo dele.
  const funnelTaxaFinal = usaStageFunil && stageFunilSolo!.degraus.length > 1
    ? (stageFunilSolo!.degraus[stageFunilSolo!.degraus.length - 1].alcancaram
        / Math.max(stageFunilSolo!.degraus[0].alcancaram, 1)) * 100
    : funnelTaxa;
  const linhaCanal = (channel: string, logo: ReactNode, spend: number, impr: number, clicks: number, leads: number): LinhaCanal => {
    const cpl = leads > 0 ? spend / leads : 0;
    return {
      channel, logo,
      investment: premiumValue(spend, 'currency'),
      impressions: impr > 0 ? premiumValue(impr) : '—',
      clicks: clicks > 0 ? premiumValue(clicks) : '—',
      ctr: impr > 0 && clicks > 0 ? premiumValue((clicks / impr) * 100, 'percent') : '—',
      cpc: clicks > 0 && spend > 0 ? premiumValue(spend / clicks, 'currency') : '—',
      cpm: impr > 0 && spend > 0 ? premiumValue((spend / impr) * 1000, 'currency') : '—',
      leads: premiumValue(leads),
      cpl: cpl > 0 ? premiumValue(cpl, 'currency') : '—',
      cplNum: cpl,
      status: cplMetaSel > 0 ? statusCplComGasto(spend, leads, cplMetaSel) : 'sem_meta' as StatusCpl,
    };
  };
  const channelRows: LinhaCanal[] = [
    linhaCanal('Meta Ads', <MetaAdsMark className="h-4 w-4 text-[#168BFF]" />, metaSpend, metaImpressions, metaClicks, metaLeads),
    linhaCanal('Google Ads', <GoogleAdsMark className="h-4 w-4" />, googleCost, googleImpressions, googleClicks, googleConv),
  ];
  const channelTotal = linhaCanal('Total', null, totalSpend, metaImpressions + googleImpressions, metaClicks + googleClicks, totalLeads);

  // ── Ritmo do mês ──────────────────────────────────────────────────────────
  // No mês corrente o eixo vai até o FIM do mês (dias futuros = null) para a
  // projeção ter onde ser desenhada; nos demais períodos, só a janela.
  const ritmo = (() => {
    const usaReceita = receitaDia.some(v => v > 0);
    const usaLeads = !usaReceita && leadsDia.some(v => v > 0);
    if (!usaReceita && !usaLeads) return null;
    const mesCorrente = period === 'this_month';
    const eixo = mesCorrente ? datasDaFaixa({ from: faixaSel.from, to: fimDoMesIso(faixaSel.from) }) : diasSel;
    const base = usaReceita ? receitaDia : leadsDia;
    const porDia = new Map(diasSel.map((d, i) => [d, base[i] ?? 0]));
    const diario = eixo.map(d => (d <= faixaSel.to ? porDia.get(d) ?? 0 : null));
    const metaMensal = usaReceita ? plannedRevenue : leadsGoal;
    const metaParcial = usaReceita ? effectiveRevenueGoal : effectiveLeadsGoal;
    return {
      titulo: mesCorrente ? 'Ritmo do mês' : 'Ritmo do período',
      sub: usaReceita ? 'faturamento acumulado (CRM, data do ganho) vs meta linear' : 'leads acumulados (Meta + Google) vs meta linear',
      eixo, diario,
      metaTotal: mesCorrente ? metaMensal : metaParcial,
      formato: usaReceita ? 'currency' as const : 'number' as const,
      projetar: mesCorrente,
      rotuloSerie: usaReceita ? 'Faturamento acumulado' : 'Leads acumulados',
    };
  })();

  // Projeção linear de fechamento (só no mês corrente).
  const diaHoje = Number(faixaSel.to.slice(8, 10));
  const diasMes = diasNoMes(faixaSel.to);
  const projetar = (v: number) => (period === 'this_month' && diaHoje > 0 && v > 0 ? (v / diaHoje) * diasMes : null);
  const rotuloEsperado = rotuloMetaParcial(period);
  const fatorPlataformaCrm = crmLeads > 0 ? totalLeads / crmLeads : null;

  // ── Blocos da página ──────────────────────────────────────────────────────
  // Montados uma vez e posicionados conforme o modo: food mantém a página
  // única de sempre; lead-gen distribui os mesmos blocos nas abas.
  const blocoAlertas = (
    <>
      {/* A faixa lista O QUE está fora do padrão — antes só dizia "N alertas". */}
      {!metricsLoading && alerts.length > 0 && (
        <div className="rounded-[14px] border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.07em] text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" />
            {alerts.length} alerta{alerts.length > 1 ? 's' : ''} fora do padrão
          </p>
          <ul className="space-y-1">
            {alerts.map((a, i) => (
              <li key={`${a.clientId}-${i}`} className="flex items-start gap-2 text-xs text-[#dce4e8]">
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-[#e52020]' : 'bg-amber-400')} />
                <span>
                  {selectedIds.size > 1 && <span className="font-bold text-[#f4f7f8]">{a.clientName}: </span>}
                  {a.msg}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
  const blocoTrafegoAntigo = (
    <>
            <PremiumPanel className="p-4">
              <h3 className="mb-4 text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Resumo de Tráfego</h3>
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.06em] text-[#f4f7f8]"><MetaAdsMark className="h-5 w-5 text-[#168BFF]" /> Meta Ads</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MiniPlatformMetric label="Saldo Meta Ads" value={metaBalance > 0 ? premiumValue(metaBalance, 'currency') : '—'} logo={<MetaAdsMark className="h-4 w-4 text-[#168BFF]" />} sub="Saldo disponível" />
                    <MiniPlatformMetric label="Alcance" value={metaReach > 0 ? premiumValue(metaReach) : '—'} icon={Users} change={pct(metaReach, prevMetaReach)} comparacao={rotuloComp} />
                    {/* CPM: preço para aparecer. Queda é boa (inverseChange). */}
                    <MiniPlatformMetric label="CPM" value={metaCpm > 0 ? premiumValue(metaCpm, 'currency') : '—'} icon={Eye} change={metaCpm > 0 && prevMetaCpm > 0 ? pct(metaCpm, prevMetaCpm) : null} inverseChange comparacao={rotuloComp} />
                    <MiniPlatformMetric label="CTR" value={metaCtr > 0 ? premiumValue(metaCtr, 'percent') : '—'} icon={MousePointerClick} change={pct(metaCtr, prevMetaCtr)} comparacao={rotuloComp} />
                    {/* Em food o Meta ainda reporta "resultado" (conversa/lead do
                        anúncio), não pedido pago — atribuir pedido por plataforma
                        exige a UTM do catálogo, que ainda não temos. Então o rótulo
                        vira "Resultados", que é a verdade, em vez de "Pedidos". */}
                    <MiniPlatformMetric label={modoFood ? 'Resultados' : 'Leads'} value={premiumValue(metaLeads)} icon={UserPlus} change={pct(metaLeads, prevMetaLeads)} comparacao={rotuloComp} />
                    <MiniPlatformMetric label={modoFood ? 'Custo por resultado' : 'CPL'} value={avgCpl > 0 ? premiumValue(avgCpl, 'currency') : '—'} icon={Tag} change={avgCpl > 0 && prevAvgCpl > 0 ? pct(avgCpl, prevAvgCpl) : null} inverseChange comparacao={rotuloComp} />
                  </div>
                </div>
                <div className="rounded-[12px] border border-white/[0.08] bg-[#071014] p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.06em] text-[#f4f7f8]"><GoogleAdsMark className="h-5 w-5" /> Google Ads</div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <MiniPlatformMetric label="Saldo Google Ads" value={googleBalance > 0 ? premiumValue(googleBalance, 'currency') : '—'} logo={<GoogleAdsMark className="h-4 w-4" />} sub="Saldo disponível" />
                    <MiniPlatformMetric label="Impressões" value={hasGoogleData ? premiumValue(googleImpressions) : '—'} icon={BarChart3} change={hasGoogleData ? pct(googleImpressions, prevGoogleImpressions) : null} comparacao={rotuloComp} />
                    {/* CPM: preço para aparecer. Queda é boa (inverseChange). */}
                    <MiniPlatformMetric label="CPM" value={googleCpm > 0 ? premiumValue(googleCpm, 'currency') : '—'} icon={Eye} change={googleCpm > 0 && prevGoogleCpm > 0 ? pct(googleCpm, prevGoogleCpm) : null} inverseChange comparacao={rotuloComp} />
                    <MiniPlatformMetric label="Cliques" value={hasGoogleData ? premiumValue(googleClicks) : '—'} icon={MousePointerClick} change={hasGoogleData ? pct(googleClicks, prevGoogleClicks) : null} comparacao={rotuloComp} />
                    <MiniPlatformMetric label="CPC Médio" value={googleCpc > 0 ? premiumValue(googleCpc, 'currency') : '—'} icon={Tag} change={googleCpc > 0 && prevGoogleCpc > 0 ? pct(googleCpc, prevGoogleCpc) : null} inverseChange comparacao={rotuloComp} />
                    <MiniPlatformMetric label="Conversões" value={hasGoogleData ? premiumValue(googleConv) : '—'} icon={CheckCircle2} change={hasGoogleData ? pct(googleConv, prevGoogleConv) : null} comparacao={rotuloComp} />
                  </div>
                </div>
              </div>
            </PremiumPanel>
    </>
  );
  const blocoInstagram = (
    <>
            {/* ── Instagram — logo abaixo do Resumo de Tráfego ──
                Posição pedida pelo Matheus: o orgânico fica colado no pago, e a
                leitura de tráfego acontece toda junta antes de o funil começar.

                ⚠️ Vale para food TAMBÉM. Este painel já sumiu no modo food uma
                vez, sob o argumento de que o Instagram aparecia no capítulo
                Tráfego da DeliveryView — mas aquele capítulo foi REMOVIDO a
                pedido do Matheus, e a justificativa morreu junto: food ficou sem
                Instagram nenhum. É o mesmo painel do modo lead-gen. */}
            {(() => {
              const allIg = pageInsights.filter(p => p.instagram).map(p => p.instagram!);
              const prevIg = prevPageInsights.filter(p => p.instagram).map(p => p.instagram!);
              if (allIg.length === 0 && !pageInsightsLoading) return null;
              const sum = (arr: typeof allIg, key: keyof InstagramPageData & string) =>
                arr.reduce((s, d) => s + (typeof d[key] === 'number' ? (d[key] as number) : 0), 0);
              // Base anterior < 10 → sem %: "+6900%" sobre uma base de 1 não
              // diz nada. O valor absoluto do período continua visível.
              const chg = (cur: number, prev: number): number | null =>
                prev >= 10 ? ((cur - prev) / prev) * 100 : null;
              const igFollow   = sum(allIg, 'followers');
              // Seguidores GANHOS no período (metric follower_count) — o total
              // (followers_count) é snapshot e vem igual nas duas janelas.
              const igFollowGain   = sum(allIg, 'followersGained');
              const prevFollowGain = sum(prevIg, 'followersGained');
              const igReach    = sum(allIg, 'reach');
              const igClicks   = sum(allIg, 'websiteClicks');
              const igEngaged  = sum(allIg, 'accountsEngaged');
              const igViews    = sum(allIg, 'views');
              const igInteract = sum(allIg, 'totalInteractions');
              const igSaves    = sum(allIg, 'saves');
              const igPViews   = sum(allIg, 'profileViews');
              const prevReach    = sum(prevIg, 'reach');
              const prevClicks   = sum(prevIg, 'websiteClicks');
              const prevEngaged  = sum(prevIg, 'accountsEngaged');
              const prevViews    = sum(prevIg, 'views');
              const prevInteract = sum(prevIg, 'totalInteractions');
              const prevSaves    = sum(prevIg, 'saves');
              const prevPViews   = sum(prevIg, 'profileViews');
              const igHandles = allIg.map(d => d.username).filter(Boolean);
              return (
                // Sem moldura rosa: cards normais direto no fluxo da página,
                // com o logo + @ numa linha de cabeçalho leve.
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <IgMark className="h-4 w-4" />
                    <span className={T.subBloco}>Instagram</span>
                    {igHandles.length > 0 && (
                      <span className={T.cardSub}>{igHandles.map(h => `@${h}`).join(', ')}</span>
                    )}
                  </div>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                      {/* ⚠️ Seguidores: o valor grande é o TOTAL (snapshot); a
                          variação é a do GANHO no período contra o ganho anterior
                          — `followers_count` ignora a janela e volta igual nas duas. */}
                      <IgKpi
                        label="Seguidores"
                        icon={Users}
                        valor={pageInsightsLoading ? '…' : igFollow > 0 ? premiumValue(igFollow) : '—'}
                        sub={pageInsightsLoading || (igFollowGain === 0 && prevFollowGain === 0)
                          ? undefined
                          : `${igFollowGain >= 0 ? '+' : ''}${premiumValue(igFollowGain)} no período`
                            + (chg(igFollowGain, prevFollowGain) === null && prevFollowGain !== 0
                              ? ` · antes ${prevFollowGain >= 0 ? '+' : ''}${premiumValue(prevFollowGain)}`
                              : '')}
                        subRuim={igFollowGain < 0}
                        variacao={chg(igFollowGain, prevFollowGain)}
                        comparacao="ganho vs período anterior"
                      />
                      <IgKpi label="Alcance" icon={Eye} valor={pageInsightsLoading ? '…' : igReach > 0 ? premiumValue(igReach) : '—'} variacao={chg(igReach, prevReach)} comparacao={rotuloComp} sub="contas alcançadas" />
                      <IgKpi
                        label="Engajamento"
                        icon={Heart}
                        valor={pageInsightsLoading ? '…' : igEngaged > 0 ? premiumValue(igEngaged) : '—'}
                        variacao={chg(igEngaged, prevEngaged)}
                        comparacao={rotuloComp}
                        sub={igReach > 0 && igEngaged > 0 ? `${((igEngaged / igReach) * 100).toFixed(1).replace('.', ',')}% do alcance engajou` : 'contas engajadas'}
                      />
                      <IgKpi label="Visualizações" icon={BarChart3} valor={pageInsightsLoading ? '…' : igViews > 0 ? premiumValue(igViews) : '—'} variacao={chg(igViews, prevViews)} comparacao={rotuloComp} sub="vezes que o conteúdo foi visto" />
                    </div>
                    <FaixaIndicadores className="grid-cols-2 md:grid-cols-4">
                      <IgMini label="Cliques na bio" icon={ExternalLink} valor={pageInsightsLoading ? '…' : igClicks > 0 ? premiumValue(igClicks) : '—'} variacao={chg(igClicks, prevClicks)} />
                      <IgMini label="Interações" icon={Zap} valor={pageInsightsLoading ? '…' : igInteract > 0 ? premiumValue(igInteract) : '—'} variacao={chg(igInteract, prevInteract)} />
                      <IgMini label="Salvamentos" icon={Bookmark} valor={pageInsightsLoading ? '…' : igSaves > 0 ? premiumValue(igSaves) : '—'} variacao={chg(igSaves, prevSaves)} />
                      <IgMini label="Visitas ao perfil" icon={Monitor} valor={pageInsightsLoading ? '…' : igPViews > 0 ? premiumValue(igPViews) : '—'} variacao={chg(igPViews, prevPViews)} />
                    </FaixaIndicadores>
                </>
              );
            })()}
    </>
  );
  const blocoCanais = (
    <>
            {/* ── Faturamento por origem ──
                Fica ao lado do Resumo por Canal de propósito: aquele mostra o
                CUSTO por canal (investimento, leads, CPL) e este mostra o
                RETORNO. Em food só aparece quando há venda com valor no CRM —
                a receita de delivery já tem painel próprio na grade. */}
            {(!modoFood || porCanal.origens.length > 0 || porCanal.leads.length > 0) && (
              <div className="grid gap-4 xl:grid-cols-2">
                <CanalDonutCard
                  titulo="Faturamento por Canal"
                  fatiasBrutas={porCanal.origens.map(o => ({
                    label: o.label,
                    valor: o.receita,
                    nota: `${o.vendas} ${o.vendas === 1 ? 'venda' : 'vendas'}`
                      + (o.ticket !== null ? ` · ${premiumValue(o.ticket, 'currency')}` : ''),
                  }))}
                  total={porCanal.total}
                  semCanal={porCanal.semAtribuicao}
                  formato="currency"
                  aviso="Preencher a origem no cadastro do negócio (ou entrar por lead de anúncio, que já traz o canal) é o que move esse valor para uma fatia de verdade."
                />
                <CanalDonutCard
                  titulo="Leads por Canal"
                  fatiasBrutas={porCanal.leads.map(l => ({ label: l.label, valor: l.leads }))}
                  total={porCanal.leadsTotal}
                  semCanal={porCanal.leadsSemCanal}
                  formato="number"
                  aviso="São os leads do CRM contados pela data de criação — número diferente do card de Leads acima, que conta resultado de anúncio."
                />
              </div>
            )}
    </>
  );
  const blocoComercial = (
    <>
            {/* ── Desempenho comercial: quem vendeu e o que se vendeu ──
                Espelha os dois painéis do CRM externo (Agendor). Só aparece
                quando há responsável ou produto no período — sem isso seria
                uma seção vazia num cliente que não usa CRM com vendedores. */}
            {(desempenhoLoading || vendedores.length > 0 || categorias.length > 0) && (
              // Dois cards de topo, sem o painel "Performance comercial" em volta
              // (era card dentro de card). O título vem da seção "Comercial".
              <div
                className="grid items-stretch gap-4 xl:grid-cols-2"
                title="Ganhos pela data do ganho · perdidos pela data da perda · novos pela data de criação"
              >
                <VendedoresCard linhas={vendedores} loading={desempenhoLoading} />
                <CategoriasCard linhas={categorias} loading={desempenhoLoading} />
              </div>
            )}
    </>
  );
  const blocoMeta = (
    <>
            {/* ── Meta Ads: cards de topo (sem a moldura azul que embrulhava
                tabela + criativos num "painel dentro do painel"). ── */}
            {/* Campanhas e melhores criativos LADO A LADO (pedido do Matheus,
                2026-09-24): a tabela só de leitura ficou estreita e sobrava um
                vazio enorme à direita; os criativos sobem para ele, em grade. */}
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <Superficie
                className="2xl:flex 2xl:flex-col"
                titulo="Campanhas Meta Ads"
                icone={<MetaAdsMark className="h-5 w-5 text-[#168BFF]" />}
                sub="com veiculação no período · clique para abrir conjuntos e anúncios"
                vazio={!campaignsLoading && metaCampaigns.length === 0}
                avisoVazio="Nenhuma campanha Meta Ads com veiculação no período."
              >
                <CampaignPerformanceTable
                  campaigns={metaCampaigns}
                  loading={campaignsLoading}
                  period={period}
                  dateFrom={customDateFrom}
                  dateTo={customDateTo}
                  metaCpl={cplMetaSel}
                  abrirTudo
                  preencher
                />
              </Superficie>
              <Superficie
                titulo="Melhores criativos"
                icone={<MetaAdsMark className="h-5 w-5 text-[#168BFF]" />}
                sub="ordenados por leads (e menor CPL no empate); sem leads no período, por investimento"
                vazio={!creativesLoading && creatives.length === 0}
                avisoVazio="Nenhum criativo com veiculação no período."
              >
                <CreativeHorizontalStrip creatives={creatives} loading={creativesLoading} onPreview={setPreviewCreative} grade />
              </Superficie>
            </div>

            {/* Faturamento por Criativo — o que o anúncio TROUXE (CRM). Some
                quando nenhuma venda do período tem criativo identificado:
                caixa vazia aqui seria pior que ausência, porque parece número
                zerado em vez de dado que ainda não existe. */}
            {(criativosReceitaLoading || criativosReceita.length > 0) && (
              <Superficie
                titulo="Faturamento por criativo"
                icone={<MetaAdsMark className="h-5 w-5 text-[#168BFF]" />}
                sub={<>
                  Vendas do período que dá para rastrear até o anúncio que trouxe o lead
                  {criativosReceita.length > 0 && (
                    <> · total atribuído {premiumValue(criativosReceitaTotal || criativosReceita.reduce((s, c) => s + c.receita, 0), 'currency')}</>
                  )}
                </>}
                direita={(
                  <span
                    className="rounded-[4px] bg-[#172027] px-1.5 py-0.5 text-[10px] font-semibold text-[#87929B]"
                    title="Receita das vendas cujo lead foi rastreado até este anúncio"
                  >
                    CRM
                  </span>
                )}
              >
                <CreativeRevenueStrip criativos={criativosReceita} loading={criativosReceitaLoading} totalAtribuido={criativosReceitaTotal || undefined} />
              </Superficie>
            )}

    </>
  );
  const blocoGoogle = (
    <>
            {/* ── Google Ads: campanhas expansíveis + palavras-chave ──
                Fora do modo food: cliente de delivery concentra verba em Meta e
                WhatsApp, então esta lâmina vivia vazia ocupando uma seção
                inteira (o print 09 do briefing). O investimento em Google, se
                houver, aparece no capítulo Tráfego da DeliveryView. */}
            {!modoFood && (
            // Campanhas e palavras-chave LADO A LADO (pedido do Matheus,
            // 2026-09-24), no mesmo desenho do bloco da Meta.
            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <Superficie
                className="2xl:flex 2xl:flex-col"
                titulo="Campanhas Google Ads"
                icone={<GoogleAdsMark className="h-5 w-5" />}
                sub="com veiculação no período · clique para abrir grupos e anúncios"
                vazio={!campaignsLoading && googleCampaigns.length === 0}
                avisoVazio="Nenhuma campanha Google Ads com veiculação no período."
              >
                <CampaignPerformanceTable
                  campaigns={googleCampaigns}
                  loading={campaignsLoading}
                  period={period}
                  dateFrom={customDateFrom}
                  dateTo={customDateTo}
                  metaCpl={cplMetaSel}
                  preencher
                />
              </Superficie>
              <Superficie
                titulo="Palavras-chave"
                icone={<GoogleAdsMark className="h-5 w-5" />}
                sub="top 5 por investimento"
                vazio={!keywordsLoading && keywords.length === 0}
                avisoVazio="Nenhuma palavra-chave com veiculação no período."
              >
                <CompactKeywordTable keywords={keywords} loading={keywordsLoading} metaCpl={cplMetaSel} />
              </Superficie>
            </div>
            )}
    </>
  );
  const blocoGa4 = (
    <>
            {/* ── Landing page (GA4): o que acontece na LP entre o clique no
                anúncio e o WhatsApp. Só aparece para cliente com propriedade
                GA4 vinculada (Integrações → Google Analytics). Vários clientes
                selecionados: um painel por cliente com vínculo. */}
            {/* Sem PremiumPanel em volta: o Ga4LandingPanel devolve cards de
                topo que ficam direto sob o título "Landing page". Vários
                clientes: um sub-cabeçalho leve com o nome antes dos cards. */}
            {!modoFood && selectedClients.filter(c => ga4ByClient[c.id]?.ga4).map(client => (
              <Fragment key={`ga4-${client.id}`}>
                {selectedClients.length > 1 && (
                  <div className="flex items-baseline gap-2 pt-2">
                    <h3 className={T.cardTitulo}>{client.name}</h3>
                    <span className={T.cardSub}>Google Analytics 4</span>
                  </div>
                )}
                <Ga4LandingPanel dados={ga4ByClient[client.id]?.ga4 ?? null} loading={ga4Loading} aviso={ga4ByClient[client.id]?.aviso} />
              </Fragment>
            ))}
    </>
  );
  const blocoResumoCliente = (
    <>
            {selectedClients.length > 1 && (
              <PremiumPanel className="p-5">
                <h3 className={cn('mb-3', T.cardTitulo)}>Resumo por cliente</h3>
                <div className="divide-y divide-white/[0.07]">
                  {selectedClients.map(client => {
                    const m = metricsByClient[client.id];
                    const leads = (m?.meta?.leads ?? 0) + (m?.google?.conversions ?? 0);
                    const spend = (m?.meta?.spend ?? 0) + (m?.google?.cost ?? 0);
                    return (
                      <div key={client.id} className={cn('flex items-center justify-between gap-4 py-3 tabular-nums text-[#a7b0b6]', T.tabelaCel)}>
                        <Link href={`/clientes/${client.id}`} className="font-black text-[#f4f7f8] hover:text-[#6cff2f]">{client.name}</Link>
                        <span>{premiumValue(leads)} leads</span>
                        <span>{spend > 0 ? premiumValue(spend, 'currency') : '—'}</span>
                      </div>
                    );
                  })}
                </div>
              </PremiumPanel>
            )}
    </>
  );

  // ── Seções da página única (só lead-gen) — seção sem conteúdo some ────────
  const secaoVisivel = {
    midia: campaignsLoading || metricsLoading || totalSpend > 0 || campaigns.length > 0 || creatives.length > 0 || metaBalance > 0 || googleBalance > 0,
    lp: selectedClients.some(c => ga4ByClient[c.id]?.ga4),
    social: pageInsightsLoading || pageInsights.some(pi => pi.instagram),
    comercial: desempenhoLoading || vendedores.length > 0 || categorias.length > 0,
  };
  const temGraficoCpl = diasSel.length >= 2 && gastoDia.some(v => v > 0) && leadsDia.some(v => v > 0);

  return (
    <div className="-m-3 min-h-full bg-[#05090B] text-[#f4f7f8] sm:-m-6">
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

      <div className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#060a0d]/92 px-4 py-3 backdrop-blur-xl xl:px-6">
        <div className="flex items-center gap-3 overflow-x-auto">
          <ClientSelector clients={clients} selected={selectedIds} onChange={setSelectedIds} />
          <div className="flex items-center rounded-[10px] border border-white/[0.08] bg-[#0b1216] p-1">
            {PERIODS.filter(p => p.value !== 'yesterday').map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  // Entrar em "personalizado" com os campos vazios travava a tela:
                  // `customReady` só libera com as duas datas completas, então
                  // nada acontecia e parecia quebrado. Começa nos últimos 30 dias.
                  if (p.value === 'custom' && !(customDateFrom && customDateTo)) {
                    const inicial = periodToDateRange('last_30d');
                    setCustomDateFrom(toInputDate(inicial.from));
                    setCustomDateTo(toInputDate(inicial.to));
                  }
                  setPeriod(p.value);
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-bold transition-colors',
                  period === p.value ? 'bg-[#6cff2f] text-black' : 'text-[#a7b0b6] hover:text-white'
                )}
              >
                {p.value === 'custom' ? (
                  <><Calendar className="h-4 w-4" />{period === 'custom' ? 'Personalizado' : ''}</>
                ) : p.label}
              </button>
            ))}
          </div>
          {/* Bloco 1 da seção 6: header mantido, só ganha o badge do segmento ativo. */}
          {modoFood && (
            <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#6cff2f]/30 bg-[#6cff2f]/10 px-3 py-2 text-xs font-bold text-[#6cff2f]">
              Modo {perfilAtivo.rotuloSegmento}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
          {/* Frescor por fonte (pedido do Matheus): há quanto tempo a tela
              buscou Meta/Google e quando o CRM recebeu o último lead. Discreto,
              no padrão do selo de saldos ao lado. Meta e Google vêm na MESMA
              chamada, então mostram a mesma idade — é verdade, não redundância. */}
          {(() => {
            const crmIso = [...selectedIds].map(id => crmUltimaPorCliente.porCliente[id]).filter(Boolean).sort().at(-1) ?? null;
            const crmSeg = crmIso && crmUltimaPorCliente.em > 0 ? Math.max(0, (crmUltimaPorCliente.em - new Date(crmIso).getTime()) / 1000) : null;
            if (metricsCacheAge === null && crmSeg === null) return null;
            const item = (logo: ReactNode, rotulo: string, seg: number | null, dica: string) => (
              <span className="inline-flex items-center gap-1" title={dica}>
                {logo}
                <span className="text-[#9aa4aa]">{rotulo}</span>
                <span className="text-[#dce4e8]">{seg === null ? '—' : idadeCurta(seg)}</span>
              </span>
            );
            return (
              <span className="inline-flex items-center gap-3 rounded-[10px] border border-white/[0.08] bg-[#0b1216] px-3 py-2 text-[11px] font-semibold">
                {item(<MetaAdsMark className="h-3.5 w-3.5 text-[#168BFF]" />, 'Meta', metricsCacheAge, metricsCacheAge === null ? 'Sem dado do Meta nesta tela' : `Métricas do Meta buscadas há ${idadeCurta(metricsCacheAge)}`)}
                {item(<GoogleAdsMark className="h-3.5 w-3.5" />, 'Google', metricsCacheAge, metricsCacheAge === null ? 'Sem dado do Google nesta tela' : `Métricas do Google buscadas há ${idadeCurta(metricsCacheAge)}`)}
                {item(<Users className="h-3.5 w-3.5 text-[#6cff2f]" />, 'CRM', crmSeg, crmSeg === null ? 'Nenhum lead no CRM dos clientes selecionados' : `Último lead entrou ou foi atualizado no CRM há ${idadeCurta(crmSeg)}`)}
              </span>
            );
          })()}
          {/* ⚠️ O X-Cache-Age vem SÓ da rota de saldos do Google Ads — o selo
              fala dos saldos, não da tela inteira (antes dizia "Cache", como se
              todo número tivesse aquela idade). */}
          <span
            className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] bg-[#0b1216] px-3 py-2 text-xs font-semibold text-[#dce4e8]"
            title={dataCacheAge === null || dataCacheAge === 0
              ? 'Saldos das contas de anúncio recém-buscados da API'
              : `Saldos das contas de anúncio (Meta/Google) em cache — buscados há ${Math.round(dataCacheAge / 60)} min, atualizados a cada 15 min. As métricas do período não usam este cache.`}
          >
            <span className={cn('h-2 w-2 rounded-full', dataCacheAge === null || dataCacheAge === 0 ? 'bg-[#6cff2f]' : 'bg-amber-400')} />
            {dataCacheAge === null || dataCacheAge === 0 ? 'Saldos ao vivo' : `Saldos · cache ${Math.round(dataCacheAge / 60)} min`}
          </span>
          </div>
          {/* "Métricas" e "Copiar layout" saíram: configuravam componentes que
              não são mais renderizados (grades RGL antigas) — clicar não mudava
              nada na tela. Os componentes continuam no arquivo, sem botão. */}
          <Avatar className="h-9 w-9 border border-white/[0.08]">
            <AvatarFallback className="bg-[#78d957] text-sm font-black text-black">
              {(session?.name ?? 'M').slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        {period === 'custom' && (() => {
          const hoje = toInputDate(new Date());
          const faixa = periodToDateRange('custom', customDateFrom, customDateTo);
          const completo = customDateFrom.length === 10 && customDateTo.length === 10;
          const dias = Math.round((faixa.to.getTime() - faixa.from.getTime()) / 86400000) + 1;
          const br = (d: Date) => d.toLocaleDateString('pt-BR');
          // ⚠️ `[color-scheme:dark]` não é enfeite: sem ele o Chrome desenha o
          // seletor nativo em tema claro e o ícone do calendário fica quase
          // invisível sobre o fundo escuro — a razão de "não funciona direito".
          const campo = 'h-11 w-[172px] rounded-[10px] border border-white/[0.10] bg-[#0b1216] px-3 text-sm font-semibold text-[#f4f7f8] outline-none [color-scheme:dark] focus:border-[#6cff2f]';
          return (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className={T.miniRotulo}>De</span>
                <input
                  type="date"
                  value={customDateFrom}
                  max={customDateTo || hoje}
                  onChange={e => setCustomDateFrom(e.target.value)}
                  className={campo}
                />
              </label>
              <span className="pb-3 text-xs text-[#9aa4aa]">até</span>
              <label className="flex flex-col gap-1">
                <span className={T.miniRotulo}>Até</span>
                <input
                  type="date"
                  value={customDateTo}
                  min={customDateFrom || undefined}
                  max={hoje}
                  onChange={e => setCustomDateTo(e.target.value)}
                  className={campo}
                />
              </label>
              {/* Resumo legível: sem ele não dá para saber se a janela pedida é
                  a que a tela está mostrando. */}
              <span className="pb-3 text-xs text-[#9aa4aa]">
                {completo
                  ? `${br(faixa.from)} a ${br(faixa.to)} · ${dias} ${dias === 1 ? 'dia' : 'dias'}`
                  : 'preencha as duas datas para atualizar'}
              </span>
            </div>
          );
        })()}
      </div>

      <div className="px-5 py-6 xl:px-8">
        {selectedIds.size === 0 && clients.length > 0 ? (
          <div className="mx-auto flex max-w-4xl flex-col items-center justify-center gap-8 py-16">
            <div className="text-center">
              <h2 className="text-2xl font-black text-[#f4f7f8]">Escolha um cliente</h2>
              <p className="mt-2 text-sm text-[#9aa4aa]">Selecione para abrir o dashboard executivo.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {clients.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedIds(new Set([c.id]))}
                  className="group flex flex-col items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#0d1519] px-3 py-5 text-center transition-all duration-150 hover:border-[#6cff2f]/40 hover:bg-[#0e1c12] hover:shadow-[0_0_20px_rgba(108,255,47,0.08)]"
                >
                  <ClientAvatar clientId={c.id} name={c.name} size="lg" />
                  <p className="w-full text-center text-[13px] font-bold leading-snug text-[#dce4e8] line-clamp-2 group-hover:text-[#6cff2f] transition-colors">{c.name}</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          // Espaçamento único: gap-4 entre cards, mt-6 extra antes de cada
          // TituloSecao. (space-y brigava com a margem do título de seção.)
          <div className="flex flex-col gap-4">
            {modoFood ? (
              <>
                {blocoAlertas}

            {/* ── FOOD: um grid único, dirigido pelo MODELO ──
                ⚠️ A grade é por ELEMENTO: cada métrica (não cada bloco) é um
                item movível. Antes, "Vendas" era um item só e arrastá-lo levava
                junto as 4 métricas de dentro — impossível mover só o
                Faturamento, que foi o pedido do Matheus. */}
            {modoFood && dadosFood && modeloFood ? (
              <>
                <Chapter
                  icon={LayoutDashboard}
                  titulo="Resumo"
                  sub={`${periodoISO.from.split('-').reverse().join('/')} a ${periodoISO.to.split('-').reverse().join('/')} · ${dadosFood.vendas.dias} dias`}
                  right={isAdmin && !editandoModelo ? (
                    <button
                      type="button"
                      onClick={() => setEditandoModelo(true)}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    >
                      <LayoutTemplate className="h-3.5 w-3.5" /> Editar modelo
                    </button>
                  ) : undefined}
                />
                <ModeloEditor
                  modelo={modeloFood}
                  editando={editandoModelo}
                  onSair={() => setEditandoModelo(false)}
                  onSalvou={setModeloFood}
                  // Função dos estilos, não mapa fixo: é o que faz a cor
                  // escolhida no elemento aparecer na hora, sem salvar.
                  render={(estilos) => {
                    const est = (id: string) => estiloDe(estilos, id);
                    // A faixa de eficiência é montada por índice; os ids do
                    // catálogo dão a cada célula uma identidade estável, para o
                    // estilo não trocar de dono quando a lista mudar de ordem.
                    const IDS_KPI = ['kpis.investimento', 'kpis.custo_pedido', 'kpis.roas', 'kpis.ticket', 'kpis.recorrencia'];
                    const kpis = Object.fromEntries(
                      quickMetricsFood.map((metric, i) => {
                        const id = IDS_KPI[i];
                        return [id, (
                          <QuickMetricCard
                            key={id}
                            {...metric}
                            icon={iconePorNome(est(id).icone, metric.icon as never)}
                            estilo={est(id)}
                            className="h-full"
                          />
                        )];
                      }),
                    );
                    return {
                      'resultado.faturamento': (
                        <GoalProgressCard
                          title="Faturamento" icon={iconePorNome(est('resultado.faturamento').icone, DollarSign)}
                          target={plannedRevenue} partial={effectiveRevenueGoal}
                          value={dadosFood.vendas.receita} format="currency"
                          estilo={est('resultado.faturamento')} className="h-full"
                        />
                      ),
                      'resultado.ticket': (
                        <HeroStatCard
                          title="Ticket médio" icon={iconePorNome(est('resultado.ticket').icone, Receipt)}
                          value={formatarMetrica(dadosFood.vendas.ticket, 'moeda')}
                          change={dadosFood.variacao.ticket} sub="valor médio por pedido no período"
                          estilo={est('resultado.ticket')} className="h-full"
                        />
                      ),
                      ...kpis,
                      ...elementosDelivery(dadosFood, estilos),
                    };
                  }}
                />
              </>
            ) : (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  <GoalProgressCard title="Faturamento" icon={DollarSign} target={plannedRevenue} partial={effectiveRevenueGoal} value={revenue} format="currency" />
                  <GoalProgressCard title="Leads" icon={Users} target={leadsGoal} partial={effectiveLeadsGoal} value={totalLeads} />
                </div>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                  {quickMetrics.map((metric) => <QuickMetricCard key={metric.title} {...metric} />)}
                </div>
              </>
            )}

                {blocoTrafegoAntigo}
                {blocoInstagram}
                {blocoCanais}
                {/* O painel "Performance comercial" virou dois cards soltos; o
                    título vem daqui, como na página de lead-gen. */}
                {secaoVisivel.comercial && <TituloSecao titulo="Comercial" sub="CRM" />}
                {blocoComercial}
                {blocoMeta}
                {blocoResumoCliente}
              </>
            ) : (
              <>
                {/* Página única — ordem: negócio (metas, KPIs, social, funil) → mídia paga → landing page → comercial. */}
                  <>
                    <div className="grid gap-4 xl:grid-cols-2">
                      <BulletMetaCard
                        titulo="Faturamento"
                        icon={DollarSign}
                        fonte="CRM"
                        fonteTitulo="Receita das vendas do CRM, pela data do ganho"
                        metaMes={plannedRevenue}
                        esperado={effectiveRevenueGoal}
                        realizado={revenue}
                        formatar={(n) => premiumValue(n, 'currency')}
                        rotuloEsperado={rotuloEsperado}
                        projecao={projetar(revenue)}
                      />
                      <BulletMetaCard
                        titulo="Leads"
                        icon={Users}
                        // Lei 1/3 (lead-contagem.ts): com planilha/CRM externo, o número
                        // é o do CRM validado — as plataformas viram nota de rodapé.
                        fonte={topoEhCrm ? 'CRM (planilha / integração)' : 'Meta + Google (plataformas)'}
                        fonteTitulo={topoEhCrm ? 'Leads validados: planilha, CRM externo, formulário e chat com rastro de anúncio (o chat inteiro quando o cliente não tem importação) — unidos por telefone' : 'Leads do Meta Ads + conversões do Google Ads, como as plataformas reportam'}
                        metaMes={leadsGoal}
                        esperado={effectiveLeadsGoal}
                        realizado={topoEhCrm ? funnelTopo : totalLeads}
                        formatar={(n) => premiumValue(n)}
                        rotuloEsperado={rotuloEsperado}
                        projecao={projetar(topoEhCrm ? funnelTopo : totalLeads)}
                        rodape={topoEhCrm ? (
                          <span title="O que Meta Ads + Google Ads reportaram na mesma janela.">
                            plataformas reportaram <span className="font-bold text-[#f4f7f8]">{premiumValue(totalLeads)}</span>
                            {conversasFora > 0 && <> · {premiumValue(conversasFora)} conversas sem rastro fora</>}
                          </span>
                        ) : crmLeads > 0 ? (
                          <span title="Leads que contam pela lei (planilha/CRM externo/formulário + chat com rastro), na mesma janela.">
                            CRM registrou <span className="font-bold text-[#f4f7f8]">{premiumValue(crmLeads)}</span>
                            {fatorPlataformaCrm !== null && totalLeads > 0 && (
                              <> (plataformas {fatorPlataformaCrm.toFixed(1).replace('.', ',')}× o CRM)</>
                            )}
                          </span>
                        ) : undefined}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                      {quickMetrics.map((metric) => <QuickMetricCard key={metric.title} {...metric} comparacao={rotuloComp} />)}
                    </div>
                    {(ritmo || temGraficoCpl) && (
                      <div className="grid gap-4 xl:grid-cols-2">
                        {ritmo && (
                          <RitmoMesChart
                            titulo={ritmo.titulo}
                            sub={ritmo.sub}
                            dias={ritmo.eixo}
                            diario={ritmo.diario}
                            metaTotal={ritmo.metaTotal}
                            formato={ritmo.formato}
                            projetar={ritmo.projetar}
                            rotuloSerie={ritmo.rotuloSerie}
                          />
                        )}
                        {temGraficoCpl && <CplDiarioChart dias={diasSel} gasto={gastoDia} leads={leadsDia} metaCpl={cplMetaSel} />}
                      </div>
                    )}
                    {blocoAlertas}
                    {/* Social logo ACIMA do Funil de Performance (pedido do Matheus, 24/09):
                        o orgânico fica colado no bloco de negócio, antes do funil. */}
                    {secaoVisivel.social && (
                      <>
                        <TituloSecao titulo="Social" sub="Instagram orgânico" />
                        {blocoInstagram}
                      </>
                    )}
                    <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                      {deliverySoloId ? (
                        <DeliveryResumoCard clientId={deliverySoloId} from={deliveryRange.from} to={deliveryRange.to} />
                      ) : (
                        <SimpleFunnel steps={funnelStepsNew} totalRate={funnelTaxaFinal > 0 ? premiumValue(funnelTaxaFinal, 'percent') : '—'} fonteLabel={usaStageFunil ? 'fonte: CRM' : fonteTopoLabel} onStageClick={setFunilStageIdx} todosClicaveis={usaStageFunil} semiDegraus={funnelSemiDegraus} />
                      )}
                      <ChannelSummaryTable rows={channelRows} total={channelTotal} metaCpl={cplMetaSel} />
                    </div>
                    {/* Só para cliente com integração de leads via SULTS (pedido do
                        Matheus, 2026-09-24) — é onde origem e região chegam completas.
                        Com vários selecionados, TODOS precisam ter SULTS, senão a soma
                        misturaria leads sem origem. E só se há região em algum lugar. */}
                    {!modoFood && selectedIds.size > 0 && [...selectedIds].every(id => sultsFlags[id]) && linhasRegiao.length > 0 && (
                      <TabelaRegioes linhas={linhasRegiao} semRegiao={porRegiao?.semRegiao ?? 0} total={porRegiao?.total ?? 0} nacionalPorUf={nacionalPorUf} ufs={porRegiao?.ufs ?? []} />
                    )}
                    {/* A "funil por canal" da planilha: só quando há lead no CRM
                        do período — sem CRM, a tabela seria toda "—". */}
                    {!modoFood && !deliverySoloId && funilCanal && funilCanal.canais.length > 0 && (
                      <TabelaFunilCanal linhas={funilCanal.canais} investimento={{ 'Meta Ads': metaSpend, 'Google Ads': googleCost }} />
                    )}
                    {blocoCanais}
                  </>

                {secaoVisivel.midia && (
                  <>
                    <TituloSecao titulo="Mídia paga" sub="Meta Ads e Google Ads" />
                    {blocoMeta}
                    {blocoGoogle}
                  </>
                )}

                {secaoVisivel.lp && (
                  <>
                    <TituloSecao
                      titulo="Landing page"
                      sub="acompanhe o desempenho de quem chegou pelos anúncios e como eles se comportam até o contato"
                      direita={(
                        // Caixa de período do mock: o período analisado e com o que está sendo comparado.
                        <div className="flex items-center gap-3 rounded-lg border border-white/[0.1] bg-[#0d1519]/92 px-3 py-2">
                          <Calendar className="h-4 w-4 text-[#6cff2f]" />
                          <div className="leading-tight">
                            <p className="text-xs font-semibold text-[#f4f7f8]">{dataLonga(faixaSel.from)} – {dataLonga(faixaSel.to)}</p>
                            {faixaPrev && <p className="text-[11px] text-[#a7b0b6]">Comparado com {dataLonga(faixaPrev.from)} – {dataLonga(faixaPrev.to)}</p>}
                          </div>
                        </div>
                      )}
                    />
                    {blocoGa4}
                  </>
                )}
                {secaoVisivel.comercial && (
                  <>
                    <TituloSecao titulo="Comercial" sub="CRM" />
                    {blocoComercial}
                  </>
                )}
                {blocoResumoCliente}
              </>
            )}
          </div>
        )}
      </div>

      <CreativePreviewOverlay creative={previewCreative} onClose={() => setPreviewCreative(null)} />

      {/* Modo etapa REAL do Kanban: drill-down por índice do degrau (um cliente só). */}
      {usaStageFunil && funilStageIdx !== null && stageFunilSolo?.degraus[funilStageIdx] && (
        <FunilLeadsModal
          stageIndex={funilStageIdx}
          tituloEtapa={funnelStepsNew[funilStageIdx]?.label ?? ''}
          totalNoCard={funnelStepsNew[funilStageIdx]?.actual ?? 0}
          clientIds={[...selectedIds]}
          from={periodoISO.from}
          to={periodoISO.to}
          onClose={() => setFunilStageIdx(null)}
        />
      )}
      {/* Modo semântico (vários clientes / cliente sem etapas): 5 degraus fixos. */}
      {!usaStageFunil && funilStageIdx !== null && ETAPAS_FUNIL[funilStageIdx] && (
        <FunilLeadsModal
          etapa={ETAPAS_FUNIL[funilStageIdx] as EtapaFunil}
          tituloEtapa={funnelStepsNew[funilStageIdx]?.label ?? ''}
          totalNoCard={funnelStepsNew[funilStageIdx]?.actual ?? 0}
          clientIds={[...selectedIds]}
          from={periodoISO.from}
          to={periodoISO.to}
          // Sem NENHUM cliente com topo vindo do CRM, o número de contatos é
          // estimativa de anúncio — não existe lista de leads por trás dele.
          topoDeAnuncios={fontesTopo.length > 0 && !fontesTopo.includes('crm')}
          onClose={() => setFunilStageIdx(null)}
        />
      )}
    </div>
  );

}
