"use client";

import type { ComponentType } from 'react';
import {
  Hash, Target, BarChart2, TrendingUp, Layers,
  BarChartHorizontal, PieChart, Gauge, Table2, CircleDot,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VizType } from './types';
import { VIZ_LABELS } from './types';
import type { LucideProps } from 'lucide-react';

// ── Icon map ──────────────────────────────────────────────────────────────────

const VIZ_ICONS: Record<VizType, ComponentType<LucideProps>> = {
  kpi:               Hash,
  'box-meta':        Target,
  bar:               BarChart2,
  line:              TrendingUp,
  area:              Layers,
  'barra-horizontal':BarChartHorizontal,
  pizza:             PieChart,
  donut:             CircleDot,
  gauge:             Gauge,
  tabela:            Table2,
};

export function VizIcon({ type, size = 14 }: { type: VizType; size?: number }) {
  const Icon = VIZ_ICONS[type];
  return <Icon width={size} height={size} />;
}

// ── Selector grid ─────────────────────────────────────────────────────────────

type Props = {
  current:    VizType;
  available:  VizType[];
  unavailable?: VizType[];
  onChange:   (v: VizType) => void;
};

export function VizSelector({ current, available, unavailable = [], onChange }: Props) {
  const ALL_TYPES: VizType[] = [
    'kpi','box-meta','bar','line','area','barra-horizontal','pizza','donut','gauge','tabela',
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_TYPES.map(v => {
        const isActive = v === current;
        const isAvail  = available.includes(v);
        const isUnavail = unavailable.includes(v);
        const Icon = VIZ_ICONS[v];

        return (
          <button
            key={v}
            onClick={() => isAvail && onChange(v)}
            disabled={!isAvail}
            title={isUnavail ? `${VIZ_LABELS[v]} — não disponível neste nível` : VIZ_LABELS[v]}
            className={cn(
              'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg border text-[10px] font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary/10 text-primary'
                : isAvail
                  ? 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  : 'border-border/40 bg-muted/20 text-muted-foreground/30 cursor-not-allowed',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {VIZ_LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}
