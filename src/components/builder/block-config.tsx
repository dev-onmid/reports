"use client";

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ALL_UNIFIED_METRICS, METRIC_BY_KEY, METRIC_GROUPS, SOURCE_COLORS,
  type UnifiedMetric,
} from '@/lib/metrics-registry';
import {
  type DashBlock, type Level, type Comparativo, type BlockSize,
  LEVEL_LABELS, COMP_LABELS, getCompatViz, getDefaultSize,
} from './types';
import { VizSelector } from './viz-selector';

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEVELS: Level[]       = ['conta', 'campanha', 'conjunto'];
const COMPS:  Comparativo[] = ['none', 'mes-anterior', 'mesmo-periodo'];
const SIZES: { v: BlockSize; label: string }[] = [
  { v: 1, label: '1 col' }, { v: 2, label: '2 col' },
  { v: 3, label: '3 col' }, { v: 4, label: 'Full' },
];

// ── Metric picker (compact list) ──────────────────────────────────────────────

function MetricPicker({
  selected, onChange,
}: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();

  const groups = METRIC_GROUPS.map(g => ({
    g,
    metrics: ALL_UNIFIED_METRICS.filter(m =>
      m.group === g && (!q || m.label.toLowerCase().includes(q))
    ),
  })).filter(x => x.metrics.length > 0);

  function toggle(key: string) {
    if (selected.includes(key)) {
      onChange(selected.filter(k => k !== key));
    } else if (selected.length < 3) {
      onChange([...selected, key]);
    }
  }

  return (
    <div className="space-y-2">
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(k => {
            const m = METRIC_BY_KEY[k];
            if (!m) return null;
            return (
              <span key={k} className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border font-medium"
                style={{ borderColor: `${m.color}66`, color: m.color, backgroundColor: `${m.color}18` }}>
                {m.shortLabel}
                <button onClick={() => toggle(k)}>×</button>
              </span>
            );
          })}
        </div>
      )}

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar métrica..."
        className="w-full h-7 px-2.5 rounded border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {/* List */}
      <div className="max-h-44 overflow-y-auto space-y-2 pr-0.5">
        {groups.map(({ g, metrics }) => {
          const color = SOURCE_COLORS[metrics[0]?.source as keyof typeof SOURCE_COLORS] ?? '#888';
          return (
            <div key={g}>
              <p className="text-[9px] uppercase tracking-widest font-bold mb-1 px-0.5" style={{ color }}>{g}</p>
              <div className="grid grid-cols-2 gap-1">
                {metrics.map(m => {
                  const isSel = selected.includes(m.key);
                  const isDisabled = !isSel && selected.length >= 3;
                  return (
                    <button key={m.key} onClick={() => !isDisabled && toggle(m.key)} disabled={isDisabled}
                      className={cn(
                        'text-left text-[10px] px-2 py-1 rounded border transition-colors truncate',
                        isSel    ? 'border-primary/60 bg-primary/10 text-primary'
                          : isDisabled ? 'border-border/30 text-muted-foreground/30 cursor-not-allowed'
                          : 'border-border bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground',
                      )}>
                      {m.shortLabel}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BlockConfig panel ─────────────────────────────────────────────────────────

type Props = {
  block:    DashBlock;
  onSave:   (updated: DashBlock) => void;
  onClose:  () => void;
};

export function BlockConfig({ block, onSave, onClose }: Props) {
  const [metrics,   setMetrics]   = useState(block.metricKeys);
  const [vizType,   setVizType]   = useState(block.vizType);
  const [level,     setLevel]     = useState(block.level);
  const [comp,      setComp]      = useState(block.comparativo);
  const [meta,      setMeta]      = useState(block.meta !== null ? String(block.meta) : '');
  const [size,      setSize]      = useState(block.size);
  const [title,     setTitle]     = useState(block.customTitle ?? '');

  const metricObjects = metrics.map(k => METRIC_BY_KEY[k]).filter((m): m is UnifiedMetric => !!m);
  const compatViz = getCompatViz(metricObjects, level);

  // If current vizType is no longer compatible after level change, reset
  function handleLevelChange(l: Level) {
    setLevel(l);
    const compat = getCompatViz(metricObjects, l);
    if (!compat.includes(vizType)) setVizType(compat[0] ?? 'kpi');
  }

  function handleSave() {
    const metaVal = meta !== '' && !isNaN(Number(meta)) ? Number(meta) : null;
    onSave({
      ...block,
      metricKeys:  metrics,
      vizType,
      level,
      comparativo: comp,
      meta:        metaVal,
      size,
      customTitle: title.trim() || undefined,
    });
    onClose();
  }

  return (
    <div className="border border-border rounded-xl bg-card shadow-2xl p-4 space-y-4 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Configurar bloco
        </p>
        <button onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Title */}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Título (opcional)</p>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Deixe em branco para automático"
          className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Metrics */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Métricas <span className="normal-case font-normal text-muted-foreground/50">(até 3)</span>
        </p>
        <MetricPicker selected={metrics} onChange={setMetrics} />
      </div>

      {/* Level */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Nível do dado</p>
        <div className="flex gap-1.5">
          {LEVELS.map(l => (
            <button key={l} onClick={() => handleLevelChange(l)}
              className={cn('flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                level === l
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
              {LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </div>

      {/* Viz type */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Visualização</p>
        <VizSelector
          current={vizType}
          available={compatViz}
          onChange={v => setVizType(v)}
        />
      </div>

      {/* Size */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Largura</p>
        <div className="flex gap-1.5">
          {SIZES.map(s => (
            <button key={s.v} onClick={() => setSize(s.v)}
              className={cn('flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                size === s.v
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Comparativo */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Comparativo</p>
        <div className="flex flex-col gap-1">
          {COMPS.map(c => (
            <button key={c} onClick={() => setComp(c)}
              className={cn('flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors',
                comp === c
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground')}>
              <div className={cn('w-1.5 h-1.5 rounded-full', comp === c ? 'bg-primary' : 'bg-muted-foreground/30')} />
              {COMP_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Meta */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Meta (opcional)</p>
        <input
          type="number"
          value={meta}
          onChange={e => setMeta(e.target.value)}
          placeholder="Ex: 100"
          className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {meta !== '' && (
          <p className="text-[10px] text-muted-foreground/60">
            Exibe barra de progresso em tipos compatíveis.
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button onClick={onClose}
          className="flex-1 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
          Cancelar
        </button>
        <button onClick={handleSave} disabled={metrics.length === 0}
          className="flex-1 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
          Salvar
        </button>
      </div>
    </div>
  );
}
