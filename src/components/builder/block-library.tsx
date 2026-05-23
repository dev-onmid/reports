"use client";

import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Search, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ALL_UNIFIED_METRICS, METRIC_BY_KEY, METRIC_GROUPS,
  SOURCE_COLORS, SOURCE_LABELS, type UnifiedMetric,
} from '@/lib/metrics-registry';
import { getDefaultViz, VIZ_LABELS } from './types';
import { VizIcon } from './viz-selector';

// ── Draggable metric item ─────────────────────────────────────────────────────

function LibraryItem({ metric }: { metric: UnifiedMetric }) {
  const defaultViz = getDefaultViz(metric);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `lib-${metric.key}`,
    data: { type: 'library', metricKey: metric.key },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2',
        'cursor-grab active:cursor-grabbing select-none',
        'hover:border-primary/40 hover:bg-primary/5 transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: metric.color }} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-tight truncate">{metric.label}</p>
      </div>
      <div className="shrink-0 text-muted-foreground/50" title={VIZ_LABELS[defaultViz]}>
        <VizIcon type={defaultViz} size={12} />
      </div>
    </div>
  );
}

// ── Block Library sidebar ─────────────────────────────────────────────────────

type Props = {
  collapsed:  boolean;
  onToggle:   () => void;
};

export function BlockLibrary({ collapsed, onToggle }: Props) {
  const [search,         setSearch]         = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  function toggleGroup(g: string) {
    setCollapsedGroups(prev => {
      const s = new Set(prev);
      s.has(g) ? s.delete(g) : s.add(g);
      return s;
    });
  }

  const q = search.toLowerCase();
  const filteredGroups = METRIC_GROUPS.map(group => ({
    group,
    metrics: ALL_UNIFIED_METRICS.filter(m =>
      m.group === group &&
      (!q || m.label.toLowerCase().includes(q) || m.shortLabel.toLowerCase().includes(q))
    ),
  })).filter(g => g.metrics.length > 0);

  const primarySource = (group: string) =>
    ALL_UNIFIED_METRICS.find(m => m.group === group)?.source ?? 'meta_ads';

  if (collapsed) {
    return (
      <aside className="flex flex-col items-center gap-2 w-10 shrink-0 pt-2">
        <button
          onClick={onToggle}
          title="Expandir biblioteca"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
        {METRIC_GROUPS.slice(0, 5).map(g => {
          const src = primarySource(g);
          const color = SOURCE_COLORS[src as keyof typeof SOURCE_COLORS] ?? '#888';
          return (
            <div key={g} className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}
              title={SOURCE_LABELS[src as keyof typeof SOURCE_LABELS] ?? g} />
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="flex flex-col w-72 shrink-0 border-r border-border bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Métricas</p>
        <button onClick={onToggle}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar métrica..."
            className="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center">
          Arraste uma métrica para o painel
        </p>
      </div>

      {/* Groups */}
      <div className="flex-1 overflow-y-auto py-2">
        {filteredGroups.map(({ group, metrics }) => {
          const src   = primarySource(group);
          const color = SOURCE_COLORS[src as keyof typeof SOURCE_COLORS] ?? '#888';
          const isCollapsed = collapsedGroups.has(group);
          return (
            <div key={group} className="mb-1">
              <button
                onClick={() => toggleGroup(group)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors"
              >
                {isCollapsed
                  ? <ChevronRight className="w-3 h-3 text-muted-foreground/60" />
                  : <ChevronDown  className="w-3 h-3 text-muted-foreground/60" />
                }
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
                  {group}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground/40">{metrics.length}</span>
              </button>

              {!isCollapsed && (
                <div className="px-3 pb-2 space-y-1">
                  {metrics.map(m => <LibraryItem key={m.key} metric={m} />)}
                </div>
              )}
            </div>
          );
        })}

        {filteredGroups.length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Nenhuma métrica encontrada.
          </p>
        )}
      </div>
    </aside>
  );
}

// ── Drag preview (DragOverlay content) ───────────────────────────────────────

export function LibraryDragPreview({ metricKey }: { metricKey: string }) {
  const metric = METRIC_BY_KEY[metricKey];
  if (!metric) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-primary/60 bg-primary/10 px-2.5 py-2 shadow-xl text-xs font-medium w-52">
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: metric.color }} />
      <span className="truncate">{metric.label}</span>
    </div>
  );
}
