"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  DndContext, DragOverlay, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import {
  ChevronDown, Check, RefreshCw, Save, Loader2, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { generateMockSeries, SOURCE_COLORS, SOURCE_LABELS, METRIC_BY_KEY, type MetricSource } from '@/lib/metrics-registry';
import { type DashBlock as DashBlockType } from '@/components/builder/types';
import { DashBlock } from '@/components/builder/dash-block';
import { buildDefaultDashboard } from '@/lib/default-dashboard';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';
type Client = { id: string; name: string };

const SOURCE_ORDER: MetricSource[] = ['meta_ads', 'google_ads', 'facebook', 'instagram', 'crm'];

// ── Client selector ───────────────────────────────────────────────────────────

function ClientSelector({
  clients, selected, onSelect,
}: { clients: Client[]; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = clients.find(c => c.id === selected);

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-lg border border-border bg-card text-sm font-medium hover:border-primary/40 transition-colors">
        <span className="max-w-[180px] truncate">{current?.name ?? 'Selecionar cliente'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[240px] rounded-xl border border-border bg-popover shadow-xl py-1 max-h-72 overflow-y-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Cliente</p>
          {clients.map(c => (
            <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); }}
              className={cn('flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                c.id === selected && 'text-primary')}>
              {c.id === selected
                ? <Check className="w-3.5 h-3.5 shrink-0" />
                : <span className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Source section header ─────────────────────────────────────────────────────

function SourceHeader({ source }: { source: MetricSource }) {
  const color = SOURCE_COLORS[source];
  const label = SOURCE_LABELS[source];
  return (
    <div className="col-span-full flex items-center gap-3 pt-2 pb-1">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs font-bold uppercase tracking-widest" style={{ color }}>
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [period,     setPeriod]     = useState<Period>('30d');
  const [clients,    setClients]    = useState<Client[]>([]);
  const [selectedId, setSelectedId] = useState(searchParams.get('client') ?? '');
  const [blocks,     setBlocks]     = useState<DashBlockType[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [savedAt,    setSavedAt]    = useState<string | null>(null);
  const [isDirty,    setIsDirty]    = useState(false);

  const data = useMemo(() => generateMockSeries(period), [period]);

  // ── Load clients ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() as Promise<Client[]> : [])
      .then(list => {
        setClients(list);
        if (!selectedId && list.length > 0) setSelectedId(list[0].id);
      })
      .catch(() => {});
  }, [selectedId]);

  // ── Load blocks ───────────────────────────────────────────────────────────

  const loadBlocks = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard-configs?clientId=${clientId}`);
      if (!res.ok) { setBlocks(buildDefaultDashboard()); return; }
      const d = await res.json() as { blocks: DashBlockType[]; updatedAt: string | null };
      if (Array.isArray(d.blocks) && d.blocks.length > 0) {
        setBlocks(d.blocks);
        setSavedAt(d.updatedAt);
      } else {
        setBlocks(buildDefaultDashboard());
        setSavedAt(null);
      }
      setIsDirty(false);
    } catch {
      setBlocks(buildDefaultDashboard());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      void loadBlocks(selectedId);
      router.replace(`/dashboard?client=${selectedId}`, { scroll: false });
    }
  }, [selectedId, loadBlocks, router]);

  // ── Save ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard-configs?clientId=${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks }),
      });
      if (res.ok) {
        const d = await res.json() as { updatedAt: string };
        setSavedAt(d.updatedAt);
        setIsDirty(false);
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Reset to full default ─────────────────────────────────────────────────

  function handleReset() {
    setBlocks(buildDefaultDashboard());
    setIsDirty(true);
  }

  // ── Remove block ──────────────────────────────────────────────────────────

  function removeBlock(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id));
    setIsDirty(true);
  }

  function updateBlock(updated: DashBlockType) {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
    setIsDirty(true);
  }

  // ── DnD reorder ───────────────────────────────────────────────────────────

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === active.id);
        const to   = prev.findIndex(b => b.id === over.id);
        if (from === -1 || to === -1) return prev;
        return arrayMove(prev, from, to).map((b, i) => ({ ...b, position: i }));
      });
      setIsDirty(true);
    }
  }

  // ── Group blocks by source ────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<MetricSource, DashBlockType[]>();
    for (const src of SOURCE_ORDER) map.set(src, []);
    for (const b of blocks) {
      const src = (METRIC_BY_KEY[b.metricKeys[0]]?.source ?? 'meta_ads') as MetricSource;
      map.get(src)?.push(b);
    }
    return map;
  }, [blocks]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-full -mx-6 -mt-4 overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-6 py-4 border-b border-border shrink-0">
          <div>
            <h1 className="font-heading font-normal text-3xl uppercase leading-none tracking-wide">Dashboard</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-muted-foreground">
                {loading ? 'Carregando...' : `${blocks.length} métricas`}
              </p>
              {savedAt && !isDirty && (
                <span className="text-[10px] text-muted-foreground/50">
                  · salvo {new Date(savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {isDirty && (
                <span className="text-[10px] text-amber-500">· não salvo</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <ClientSelector clients={clients} selected={selectedId} onSelect={setSelectedId} />

            {/* Period */}
            <div className="flex rounded-lg border border-border bg-card overflow-hidden">
              {(['7d', '30d', '90d'] as Period[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={cn('px-3 py-1.5 text-sm font-semibold transition-colors',
                    period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {p}
                </button>
              ))}
            </div>

            {/* Reload */}
            <button onClick={() => selectedId && void loadBlocks(selectedId)}
              className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
              title="Recarregar">
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>

            {/* Reset to default */}
            <button onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="Restaurar todas as métricas">
              <RotateCcw className="w-3.5 h-3.5" /> Restaurar
            </button>

            {/* Save */}
            <button onClick={() => void handleSave()} disabled={!selectedId || saving || !isDirty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando</>
                : <><Save className="w-3.5 h-3.5" /> Salvar</>}
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-sm text-muted-foreground gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Carregando...
            </div>
          ) : (
            <SortableContext items={blocks.map(b => b.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                {SOURCE_ORDER.map(src => {
                  const srcBlocks = grouped.get(src) ?? [];
                  if (srcBlocks.length === 0) return null;
                  return (
                    <>
                      <SourceHeader key={`hdr-${src}`} source={src} />
                      {srcBlocks.map(block => (
                        <DashBlock
                          key={block.id}
                          block={block}
                          data={data}
                          onUpdate={updateBlock}
                          onRemove={() => removeBlock(block.id)}
                          openConfig={false}
                        />
                      ))}
                    </>
                  );
                })}
              </div>
            </SortableContext>
          )}
        </div>
      </div>

      <DragOverlay />
    </DndContext>
  );
}
