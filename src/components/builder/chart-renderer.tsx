"use client";

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  METRIC_BY_KEY, formatMetricValue, computeMockKpi,
  type UnifiedMetric, type MockPoint,
} from '@/lib/metrics-registry';
import type { VizType } from './types';

// ── Shared style constants ─────────────────────────────────────────────────────

const TOOLTIP_STYLE = {
  backgroundColor: '#1B1D24', borderColor: '#2A2D3A',
  borderRadius: '8px', color: '#F5F5F5', fontSize: '12px',
};
const AXIS_TICK  = { fill: '#A0AEC0', fontSize: 11 };
const CHART_H_SM = 130;
const CHART_H_MD = 170;

// ── Gauge (SVG semicircle) ─────────────────────────────────────────────────────

function GaugeChart({ value, format, color }: { value: number; format: string; color: string }) {
  const pct = format === 'percent' ? Math.min(value, 100) / 100
    : format === 'times'  ? Math.min(value, 10)  / 10
    : Math.min(value, 100) / 100;

  const cx = 80, cy = 72, R = 52;
  // Background: full semicircle (left → right, going up). sweep=0 → counterclockwise in SVG = goes above
  const bg = `M ${cx - R} ${cy} A ${R} ${R} 0 0 0 ${cx + R} ${cy}`;

  // Filled arc: from left, pct fraction of the semicircle
  const angle  = Math.PI * (1 - pct);
  const endX   = cx + R * Math.cos(angle);
  const endY   = cy - R * Math.sin(angle);
  const large  = pct > 0.5 ? 1 : 0;
  const fg     = `M ${cx - R} ${cy} A ${R} ${R} 0 ${large} 0 ${endX.toFixed(2)} ${endY.toFixed(2)}`;

  // Needle tip
  const nX = cx + (R - 6) * Math.cos(angle);
  const nY = cy - (R - 6) * Math.sin(angle);

  return (
    <div className="flex flex-col items-center py-2">
      <svg viewBox="20 18 120 68" width="140" height="72">
        <path d={bg} fill="none" stroke="#2A2D3A" strokeWidth="10" strokeLinecap="round" />
        {pct > 0 && (
          <path d={fg} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 5px ${color}88)` }} />
        )}
        <circle cx={nX.toFixed(2)} cy={nY.toFixed(2)} r="4.5" fill={color} />
        <text x={cx} y={cy + 6} textAnchor="middle" fill={color}
          style={{ fontSize: '17px', fontFamily: 'inherit', fontWeight: 700 }}>
          {formatMetricValue(value, format as never)}
        </text>
      </svg>
    </div>
  );
}

// ── Box Meta (KPI + barra de progresso) ───────────────────────────────────────

function BoxMetaChart({
  value, format, color, meta, label,
}: {
  value: number; format: string; color: string; meta: number | null; label: string;
}) {
  const pct = meta && meta > 0 ? Math.min(value / meta, 1) : null;
  return (
    <div className="flex flex-col gap-2 py-3 px-2">
      <div className="flex flex-col items-center gap-0.5">
        <p className="text-3xl font-heading" style={{ color }}>
          {formatMetricValue(value, format as never)}
        </p>
        <p className="text-[11px] text-muted-foreground">{label}</p>
      </div>
      {pct !== null && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round(pct * 100)}%`, backgroundColor: color,
                boxShadow: `0 0 6px ${color}66` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            {Math.round(pct * 100)}% da meta · objetivo: {formatMetricValue(meta!, format as never)}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Tabela ────────────────────────────────────────────────────────────────────

function TableChart({ metrics, data }: { metrics: UnifiedMetric[]; data: MockPoint[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-2 text-muted-foreground font-semibold">Período</th>
            {metrics.map(m => (
              <th key={m.key} className="text-right py-1.5 px-2 font-semibold" style={{ color: m.color }}>
                {m.shortLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
              <td className="py-1.5 px-2 text-muted-foreground">{String(row.label)}</td>
              {metrics.map(m => (
                <td key={m.key} className="text-right py-1.5 px-2 font-medium">
                  {formatMetricValue(Number(row[m.key] ?? 0), m.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main ChartRenderer ─────────────────────────────────────────────────────────

type Props = {
  metricKeys: string[];
  vizType:    VizType;
  data:       MockPoint[];
  meta:       number | null;
  compact?:   boolean;
};

export function ChartRenderer({ metricKeys, vizType, data, meta, compact }: Props) {
  const metrics = metricKeys.map(k => METRIC_BY_KEY[k]).filter((m): m is UnifiedMetric => !!m);
  if (metrics.length === 0) return (
    <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma métrica configurada.</p>
  );

  const h = compact ? CHART_H_SM : CHART_H_MD;
  const primary = metrics[0];

  // ── KPI ──────────────────────────────────────────────────────────────────────
  if (vizType === 'kpi') {
    const singleVal = computeMockKpi(primary, data);
    return (
      <div className={cn('flex py-3', metrics.length === 1
        ? 'flex-col items-center gap-1.5'
        : 'flex-row items-center justify-around flex-wrap gap-3')}>
        {metrics.map(m => {
          const v = computeMockKpi(m, data);
          return (
            <div key={m.key} className="flex flex-col items-center gap-0.5 text-center">
              <div className="w-2 h-2 rounded-full mb-0.5" style={{ backgroundColor: m.color }} />
              <p className={cn('font-heading font-normal', metrics.length === 1 ? 'text-4xl' : 'text-2xl')}
                style={{ color: m.color }}>
                {formatMetricValue(v, m.format)}
              </p>
              <p className="text-[11px] text-muted-foreground leading-tight">{m.label}</p>
            </div>
          );
        })}
  </div>
    );
  }

  // ── Box Meta ─────────────────────────────────────────────────────────────────
  if (vizType === 'box-meta') {
    const v = computeMockKpi(primary, data);
    return (
      <BoxMetaChart value={v} format={primary.format} color={primary.color}
        meta={meta} label={primary.label} />
    );
  }

  // ── Gauge ────────────────────────────────────────────────────────────────────
  if (vizType === 'gauge') {
    const v = computeMockKpi(primary, data);
    return <GaugeChart value={v} format={primary.format} color={primary.color} />;
  }

  // ── Pizza / Donut ─────────────────────────────────────────────────────────────
  if (vizType === 'pizza' || vizType === 'donut') {
    const pieData = metrics.map(m => ({
      name:  m.shortLabel,
      value: Math.abs(computeMockKpi(m, data)),
      color: m.color,
    }));
    const innerR = vizType === 'donut' ? Math.round(h * 0.28) : 0;
    const outerR = Math.round(h * 0.42);
    return (
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%"
            innerRadius={innerR} outerRadius={outerR} paddingAngle={3} dataKey="value">
            {pieData.map((e, i) => <Cell key={i} fill={e.color} strokeWidth={0} />)}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE}
            formatter={(v: number, name: string) => {
              const m = metrics.find(m => m.shortLabel === name);
              return [formatMetricValue(v, m?.format ?? 'number'), name];
            }} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // ── Tabela ────────────────────────────────────────────────────────────────────
  if (vizType === 'tabela') return <TableChart metrics={metrics} data={data} />;

  // ── Series-based charts (bar, line, area, barra-horizontal) ──────────────────
  const series = metrics.filter(m => m.hasTimeSeries);
  if (series.length === 0) {
    return <p className="py-6 text-center text-xs text-muted-foreground">
      Métricas calculadas só exibem como número ou gauge.
    </p>;
  }

  const allCurrency = series.every(m => m.format === 'currency');
  const yFmt = allCurrency ? (v: number) => formatMetricValue(v, 'currency') : undefined;
  const tooltipFmt = (value: unknown, _name: unknown, item: { dataKey?: string | number }) => {
    const m = series.find(m => m.key === item?.dataKey);
    const n = typeof value === 'number' ? value : Number(value ?? 0);
    return [Number.isFinite(n) ? formatMetricValue(n, m?.format ?? 'number') : String(value ?? ''), m?.shortLabel ?? _name];
  };

  const isHorizontal = vizType === 'barra-horizontal';
  const margin = isHorizontal
    ? { top: 5, right: 10, left: 5, bottom: 0 }
    : { top: 5, right: 5, left: -25, bottom: 0 };

  if (vizType === 'bar' || vizType === 'barra-horizontal') return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout={isHorizontal ? 'vertical' : 'horizontal'} margin={margin}>
        {isHorizontal ? (
          <>
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
          </>
        )}
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map(m => <Bar key={m.key} dataKey={m.key} fill={m.color} radius={[4,4,0,0]} name={m.shortLabel} />)}
      </BarChart>
    </ResponsiveContainer>
  );

  if (vizType === 'line') return (
    <ResponsiveContainer width="100%" height={h}>
      <LineChart data={data} margin={margin}>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map(m => <Line key={m.key} type="monotone" dataKey={m.key} stroke={m.color}
          strokeWidth={2} dot={false} name={m.shortLabel} />)}
      </LineChart>
    </ResponsiveContainer>
  );

  if (vizType === 'area') return (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={data} margin={margin}>
        <defs>
          {series.map(m => (
            <linearGradient key={m.key} id={`grad-${m.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={m.color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={m.color} stopOpacity={0}   />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={yFmt} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFmt} />
        {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />}
        {series.map(m => (
          <Area key={m.key} type="monotone" dataKey={m.key} stroke={m.color} strokeWidth={2}
            fillOpacity={1} fill={`url(#grad-${m.key})`} name={m.shortLabel} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );

  return null;
}
