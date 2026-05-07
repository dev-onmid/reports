"use client";

import type React from 'react';
import { useMemo, useState } from 'react';
import { Plus, X, BarChart2, TrendingUp, Layers, Hash, Check, Search } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ALL_UNIFIED_METRICS,
  METRIC_BY_KEY,
  METRIC_GROUPS,
  SOURCE_LABELS,
  SOURCE_COLORS,
  generateMockSeries,
  computeMockKpi,
  formatMetricValue,
  type UnifiedMetric,
  type MockPoint,
} from '@/lib/metrics-registry';

// ── Types ─────────────────────────────────────────────────────────────────────
type ChartType = 'kpi' | 'bar' | 'line' | 'area';
type Period = '7d' | '30d' | '90d';
type WidgetSize = 1 | 2 | 3;

type Widget = {
  id: string;
  title: string;
  metrics: string[];
  chartType: ChartType;
  size: WidgetSize;
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const TOOLTIP_STYLE = { backgroundColor: '#1B1D24', borderColor: '#2A2D3A', borderRadius: '8px', color: '#F5F5F5', fontSize: '12px' };
const AXIS_TICK = { fill: '#A0AEC0', fontSize: 11 };

function autoTitle(keys: string[]): string {
  if (keys.length === 0) return 'Novo Bloco';
  return keys.map((k) => METRIC_BY_KEY[k]?.shortLabel ?? k).join(' vs. ');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tooltipFormatter(series: UnifiedMetric[]): (...args: any[]) => any {
  return (value: unknown, _name: unknown, item: { dataKey?: string | number }) => {
    const metric = series.find((m) => m.key === item?.dataKey);
    const n = typeof value === 'number' ? value : Number(value ?? 0);
    return [Number.isFinite(n) ? formatMetricValue(n, metric?.format ?? 'number') : String(value ?? ''), metric?.shortLabel ?? _name];
  };
}

function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    meta_ads:  'bg-blue-500/20 text-blue-400',
    google_ads:'bg-violet-500/20 text-violet-400',
    facebook:  'bg-blue-600/20 text-blue-300',
    instagram: 'bg-pink-500/20 text-pink-400',
    crm:       'bg-emerald-500/20 text-emerald-400',
  };
  return map[source] ?? 'bg-muted text-muted-foreground';
}

// ── Widget chart ──────────────────────────────────────────────────────────────
function WidgetChart({ widget, data }: { widget: Widget; data: MockPoint[] }) {
  const metrics = widget.metrics.map((k) => METRIC_BY_KEY[k]).filter((m): m is UnifiedMetric => !!m);
  const series  = metrics.filter((m) => m.hasTimeSeries);
  const h = widget.size === 1 ? 120 : 160;
  const allCurrency = series.length > 0 && series.every((m) => m.format === 'currency');
  const yFmt = allCurrency ? (v: number) => formatMetricValue(v, 'currency') : undefined;

  if (widget.chartType === 'kpi') {
    return (
      <div className={cn('flex py-4', metrics.length === 1 ? 'flex-col items-center justify-center gap-2' : 'flex-row items-center justify-around gap-4 flex-wrap')}>
        {metrics.map((m) => {
          const value = computeMockKpi(m, data);
          return (
            <div key={m.key} className="flex flex-col items-center gap-0.5 text-center">
              <div className="w-2 h-2 rounded-full mb-1" style={{ backgroundColor: m.color }} />
              <p className={cn('font-bold font-heading', metrics.length === 1 ? 'text-4xl' : 'text-2xl')} style={{ color: m.color }}>
                {formatMetricValue(value, m.format)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">{m.label}</p>
            </div>
          );
        })}
      </div>
    );
  }

  if (series.length === 0) return (
    <p className="py-6 text-center text-xs text-muted-foreground">Métricas calculadas só exibem como número (KPI).</p>
  );

  if (widget.chartType === 'bar') return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(series)} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map((m) => <Bar key={m.key} dataKey={m.key} fill={m.color} radius={[4, 4, 0, 0]} name={m.shortLabel} />)}
      </BarChart>
    </ResponsiveContainer>
  );

  if (widget.chartType === 'line') return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(series)} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map((m) => <Line key={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2} dot={false} name={m.shortLabel} />)}
      </LineChart>
    </ResponsiveContainer>
  );

  if (widget.chartType === 'area') return (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
        <defs>
          {series.map((m) => (
            <linearGradient key={m.key} id={`g-${widget.id}-${m.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={m.color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={m.color} stopOpacity={0}   />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter(series)} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map((m) => (
          <Area key={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2}
            fillOpacity={1} fill={`url(#g-${widget.id}-${m.key})`} name={m.shortLabel} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  return null;
}

// ── Widget card ───────────────────────────────────────────────────────────────
function WidgetCard({ widget, data, onRemove }: { widget: Widget; data: MockPoint[]; onRemove: () => void }) {
  const metrics = widget.metrics.map((k) => METRIC_BY_KEY[k]).filter((m): m is UnifiedMetric => !!m);
  const primarySource = metrics[0]?.source ?? 'meta_ads';
  const hasMixed = metrics.some((m) => m.source !== primarySource);

  return (
    <div className={cn(
      'bg-card border border-border rounded-xl overflow-hidden',
      widget.size === 1 && 'col-span-1',
      widget.size === 2 && 'col-span-1 md:col-span-2',
      widget.size === 3 && 'col-span-1 md:col-span-3',
    )}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-semibold text-sm truncate">{widget.title}</span>
          {hasMixed ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0 bg-violet-500/20 text-violet-400">Cruzado</span>
          ) : (
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shrink-0', sourceBadgeClass(primarySource))}>
              {SOURCE_LABELS[primarySource as keyof typeof SOURCE_LABELS] ?? primarySource}
            </span>
          )}
        </div>
        <button onClick={onRemove} className="ml-2 shrink-0 text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-4">
        <WidgetChart widget={widget} data={data} />
      </div>
    </div>
  );
}

// ── Add widget dialog ─────────────────────────────────────────────────────────
const CHART_TYPE_OPTIONS: { key: ChartType; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'kpi',  label: 'Número(s)', Icon: Hash      },
  { key: 'bar',  label: 'Barras',    Icon: BarChart2  },
  { key: 'line', label: 'Linha',     Icon: TrendingUp },
  { key: 'area', label: 'Área',      Icon: Layers     },
];

function AddWidgetDialog({ open, onClose, onAdd }: {
  open: boolean; onClose: () => void; onAdd: (w: Omit<Widget, 'id'>) => void;
}) {
  const [selected,    setSelected]    = useState<string[]>([]);
  const [chart,       setChart]       = useState<ChartType>('bar');
  const [size,        setSize]        = useState<WidgetSize>(2);
  const [customTitle, setCustomTitle] = useState('');
  const [search,      setSearch]      = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const filteredMetrics = useMemo(() => {
    const q = search.toLowerCase();
    return ALL_UNIFIED_METRICS.filter((m) => {
      const matchGroup = !activeGroup || m.group === activeGroup;
      const matchSearch = !q || m.label.toLowerCase().includes(q) || m.shortLabel.toLowerCase().includes(q) || m.description.toLowerCase().includes(q);
      return matchGroup && matchSearch;
    });
  }, [search, activeGroup]);

  const groupsInView = useMemo(() => {
    return METRIC_GROUPS.filter((g) => filteredMetrics.some((m) => m.group === g));
  }, [filteredMetrics]);

  const allHaveTimeSeries = selected.length > 0 && selected.every((k) => METRIC_BY_KEY[k]?.hasTimeSeries);
  const availableCharts: ChartType[] = allHaveTimeSeries ? ['kpi', 'bar', 'line', 'area'] : ['kpi'];

  function toggle(key: string) {
    if (selected.includes(key)) {
      const next = selected.filter((k) => k !== key);
      setSelected(next);
      const nextAllTime = next.length > 0 && next.every((k) => METRIC_BY_KEY[k]?.hasTimeSeries);
      if (!nextAllTime && chart !== 'kpi') setChart('kpi');
    } else {
      if (selected.length >= 3) return;
      setSelected([...selected, key]);
      if (!METRIC_BY_KEY[key]?.hasTimeSeries && chart !== 'kpi') setChart('kpi');
    }
  }

  function handleClose() {
    setSelected([]); setChart('bar'); setSize(2); setCustomTitle(''); setSearch(''); setActiveGroup(null);
    onClose();
  }

  function handleAdd() {
    if (selected.length === 0) return;
    onAdd({ title: customTitle.trim() || autoTitle(selected), metrics: selected, chartType: chart, size });
    handleClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Adicionar Bloco ao Dashboard</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1 max-h-[65vh] overflow-y-auto pr-1">

          {/* Selected chips */}
          {selected.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/40 rounded-lg">
              <span className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider">Comparando:</span>
              {selected.map((k) => {
                const m = METRIC_BY_KEY[k];
                return (
                  <span key={k} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium"
                    style={{ borderColor: `${m?.color}66`, color: m?.color, backgroundColor: `${m?.color}18` }}>
                    {m?.shortLabel ?? k}
                    <button onClick={() => toggle(k)} className="opacity-60 hover:opacity-100 ml-0.5">×</button>
                  </span>
                );
              })}
              {selected.length < 3 && (
                <span className="text-[11px] text-muted-foreground/50">+ até {3 - selected.length} mais</span>
              )}
            </div>
          )}

          {/* 1 — Metrics */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
              1. Selecione as Métricas <span className="normal-case font-normal text-muted-foreground/50">(até 3 para comparar / cruzar)</span>
            </p>

            {/* Search */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar métrica..."
                className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Platform filter pills */}
            <div className="flex gap-1.5 flex-wrap mb-3">
              <button
                onClick={() => setActiveGroup(null)}
                className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors',
                  !activeGroup ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/50')}
              >
                Todas
              </button>
              {METRIC_GROUPS.map((g) => {
                const src = ALL_UNIFIED_METRICS.find((m) => m.group === g)?.source;
                const color = src ? SOURCE_COLORS[src as keyof typeof SOURCE_COLORS] : '#888';
                return (
                  <button key={g} onClick={() => setActiveGroup(activeGroup === g ? null : g)}
                    className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors',
                      activeGroup === g ? 'text-white border-transparent' : 'border-border text-muted-foreground hover:border-primary/50')}
                    style={activeGroup === g ? { backgroundColor: color, borderColor: color } : {}}>
                    {g}
                  </button>
                );
              })}
            </div>

            {/* Metric list grouped */}
            {groupsInView.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma métrica encontrada.</p>
            ) : groupsInView.map((group) => {
              const groupMetrics = filteredMetrics.filter((m) => m.group === group);
              const src = groupMetrics[0]?.source;
              const color = src ? SOURCE_COLORS[src as keyof typeof SOURCE_COLORS] : '#888';
              return (
                <div key={group} className="mb-4">
                  <p className="text-[10px] uppercase tracking-widest font-bold mb-2 px-0.5" style={{ color }}>
                    {group}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {groupMetrics.map((m) => {
                      const isSelected = selected.includes(m.key);
                      const isDisabled = !isSelected && selected.length >= 3;
                      return (
                        <button
                          key={m.key}
                          onClick={() => !isDisabled && toggle(m.key)}
                          disabled={isDisabled}
                          title={m.description}
                          className={cn(
                            'flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors',
                            isSelected  ? 'border-primary/60 bg-primary/10' : 'border-border bg-card',
                            isDisabled  ? 'opacity-30 cursor-not-allowed' : 'hover:bg-muted/50',
                          )}
                        >
                          <div
                            className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                            style={isSelected ? { backgroundColor: m.color, borderColor: m.color } : { borderColor: '#4B5563' }}
                          >
                            {isSelected && <Check className="w-2.5 h-2.5 text-black" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-xs leading-tight truncate">{m.label}</p>
                            {!m.hasTimeSeries && (
                              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Só KPI</p>
                            )}
                          </div>
                          <div className="w-2 h-2 rounded-full shrink-0 mt-1" style={{ backgroundColor: m.color }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 2 — Chart type */}
          {selected.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">2. Visualização</p>
              <div className="flex gap-2 flex-wrap">
                {CHART_TYPE_OPTIONS.filter((o) => availableCharts.includes(o.key)).map(({ key, label, Icon }) => (
                  <button key={key} onClick={() => setChart(key)}
                    className={cn('flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors',
                      chart === key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                    )}>
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
              {!allHaveTimeSeries && (
                <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                  Métricas calculadas (CPL, CTR, ROI…) só exibem como número.
                </p>
              )}
            </div>
          )}

          {/* 3 — Title */}
          {selected.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">3. Título (opcional)</p>
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder={autoTitle(selected)}
                className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {/* 4 — Size */}
          {selected.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">4. Tamanho</p>
              <div className="flex gap-2">
                {([
                  { key: 1 as WidgetSize, label: '1 Coluna',  sub: 'Compacto' },
                  { key: 2 as WidgetSize, label: '2 Colunas', sub: 'Médio'    },
                  { key: 3 as WidgetSize, label: '3 Colunas', sub: 'Largo'    },
                ]).map((s) => (
                  <button key={s.key} onClick={() => setSize(s.key)}
                    className={cn('flex-1 p-2 rounded-lg border text-center transition-colors',
                      size === s.key ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                    )}>
                    <p className="font-semibold text-xs">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground">{s.sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancelar</Button>
          <Button onClick={handleAdd} disabled={selected.length === 0} className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
            <Plus className="w-4 h-4 mr-1" />
            Adicionar Bloco
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Default widgets ───────────────────────────────────────────────────────────
const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w1', title: 'Leads Meta vs. Qualificados CRM',    metrics: ['meta_leads', 'crm_qualified'],                chartType: 'bar',  size: 2 },
  { id: 'w2', title: 'Receita',                             metrics: ['crm_revenue'],                               chartType: 'kpi',  size: 1 },
  { id: 'w3', title: 'Leads → Agendamentos → Vendas',       metrics: ['crm_leads', 'crm_appointments', 'crm_sales'], chartType: 'line', size: 3 },
  { id: 'w4', title: 'CPL + ROI',                          metrics: ['meta_cpl', 'crm_roi'],                        chartType: 'kpi',  size: 1 },
  { id: 'w5', title: 'Investimento Meta vs. Google',        metrics: ['meta_spend', 'google_spend'],                 chartType: 'bar',  size: 2 },
  { id: 'w6', title: 'Alcance Instagram vs. Facebook',      metrics: ['ig_reach', 'fb_page_reach'],                  chartType: 'area', size: 2 },
];

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ConstruitorPage() {
  const [period,     setPeriod]     = useState<Period>('30d');
  const [widgets,    setWidgets]    = useState<Widget[]>(DEFAULT_WIDGETS);
  const [dialogOpen, setDialogOpen] = useState(false);

  const data = useMemo(() => generateMockSeries(period), [period]);

  function addWidget(config: Omit<Widget, 'id'>) {
    setWidgets((prev) => [...prev, { ...config, id: `w${Date.now()}` }]);
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-heading tracking-wider uppercase">Construtor de Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            60+ métricas de Meta Ads, Google Ads, Facebook, Instagram e CRM. Cruze qualquer combinação.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex rounded-lg border border-border bg-card overflow-hidden">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={cn('px-4 py-2 text-sm font-semibold transition-colors',
                  period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}>
                {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : '90 dias'}
              </button>
            ))}
          </div>
          <Button onClick={() => setDialogOpen(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="w-4 h-4 mr-2" />
            Adicionar Bloco
          </Button>
        </div>
      </div>

      {widgets.length === 0 ? (
        <button onClick={() => setDialogOpen(true)}
          className="w-full flex flex-col items-center justify-center py-24 border border-dashed border-border rounded-xl hover:border-primary/40 transition-colors">
          <Plus className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="font-semibold text-muted-foreground">Nenhum bloco adicionado</p>
          <p className="text-sm text-muted-foreground/60 mt-1">Clique para montar seu painel</p>
        </button>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {widgets.map((w) => (
            <WidgetCard key={w.id} widget={w} data={data} onRemove={() => removeWidget(w.id)} />
          ))}
        </div>
      )}

      <AddWidgetDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onAdd={addWidget} />
    </div>
  );
}
