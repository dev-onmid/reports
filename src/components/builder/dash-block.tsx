"use client";

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical, Pencil, X, Maximize2, Minimize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { METRIC_BY_KEY, SOURCE_COLORS, SOURCE_LABELS, type MockPoint } from '@/lib/metrics-registry';
import { type DashBlock as DashBlockType, VIZ_LABELS, LEVEL_LABELS } from './types';
import { ChartRenderer } from './chart-renderer';
import { BlockConfig } from './block-config';
import { VizIcon } from './viz-selector';

// ── Source badge color ────────────────────────────────────────────────────────

function sourceBadgeStyle(source: string) {
  const color = SOURCE_COLORS[source as keyof typeof SOURCE_COLORS];
  if (!color) return { className: 'bg-muted/40 text-muted-foreground', color: '#888' };
  return {
    className: '',
    style: { backgroundColor: `${color}22`, color, border: `1px solid ${color}44` },
  };
}

// ── Block title ───────────────────────────────────────────────────────────────

function blockTitle(block: DashBlockType): string {
  if (block.customTitle) return block.customTitle;
  const metrics = block.metricKeys.map(k => METRIC_BY_KEY[k]).filter(Boolean);
  if (metrics.length === 0) return 'Bloco';
  return metrics.map(m => m!.shortLabel).join(' vs. ');
}

// ── DashBlock ─────────────────────────────────────────────────────────────────

type Props = {
  block:     DashBlockType;
  data:      MockPoint[];
  onUpdate:  (updated: DashBlockType) => void;
  onRemove:  () => void;
  openConfig?: boolean;
};

export function DashBlock({ block, data, onUpdate, onRemove, openConfig }: Props) {
  const [configOpen, setConfigOpen] = useState(openConfig ?? false);

  const primaryMetric = METRIC_BY_KEY[block.metricKeys[0]];
  const source = primaryMetric?.source ?? 'meta_ads';
  const badge  = sourceBadgeStyle(source);

  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: block.id, data: { type: 'block' } });

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging ? 0.4 : 1,
  };

  // Column span classes (4-col grid)
  const colSpan = {
    1: 'col-span-1',
    2: 'col-span-1 sm:col-span-2',
    3: 'col-span-1 sm:col-span-2 lg:col-span-3',
    4: 'col-span-1 sm:col-span-2 lg:col-span-4',
  }[block.size];

  function handleSizeToggle() {
    const next: Record<number, DashBlockType['size']> = { 1: 2, 2: 3, 3: 4, 4: 1 };
    onUpdate({ ...block, size: next[block.size] });
  }

  return (
    <div ref={setNodeRef} style={style} className={cn('flex flex-col', colSpan)}>
      <div className={cn(
        'bg-card border border-border rounded-xl overflow-hidden transition-all',
        isDragging && 'shadow-2xl ring-1 ring-primary/30',
      )}>
        {/* Header */}
        <div className="group flex items-center gap-2 px-3 py-2.5 border-b border-border">
          {/* Drag handle */}
          <button
            {...listeners}
            {...attributes}
            className="shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>

          {/* Source badge */}
          <span className={cn('shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded', badge.className)}
            style={(badge as { style?: CSSProperties }).style}>
            {SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source}
          </span>

          {/* Title */}
          <span className="flex-1 min-w-0 text-xs font-semibold truncate">
            {blockTitle(block)}
          </span>

          {/* Level badge */}
          <span className="shrink-0 text-[9px] text-muted-foreground/60 border border-border px-1.5 py-0.5 rounded">
            {LEVEL_LABELS[block.level]}
          </span>

          {/* Viz type badge */}
          <span className="shrink-0 text-muted-foreground/50" title={VIZ_LABELS[block.vizType]}>
            <VizIcon type={block.vizType} size={12} />
          </span>

          {/* Actions — revealed on hover */}
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={handleSizeToggle}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
              title="Alternar tamanho">
              {block.size < 4 ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
            <button onClick={() => setConfigOpen(o => !o)}
              className={cn('p-1 rounded transition-colors',
                configOpen
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              <Pencil className="w-3 h-3" />
            </button>
            <button onClick={onRemove}
              className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Config panel (inline, collapses) */}
        {configOpen && (
          <div className="border-b border-border p-3">
            <BlockConfig
              block={block}
              onSave={updated => { onUpdate(updated); setConfigOpen(false); }}
              onClose={() => setConfigOpen(false)}
            />
          </div>
        )}

        {/* Chart body */}
        <div className={cn('px-4 py-3', configOpen && 'hidden')}>
          <ChartRenderer
            metricKeys={block.metricKeys}
            vizType={block.vizType}
            data={data}
            meta={block.meta}
            compact={block.size === 1}
          />
        </div>
      </div>
    </div>
  );
}
