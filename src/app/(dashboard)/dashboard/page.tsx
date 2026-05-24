"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  DndContext, DragOverlay, closestCenter, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import {
  LayoutDashboard, Plus, Settings2, ChevronDown, Check, RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { METRIC_BY_KEY, generateMockSeries } from '@/lib/metrics-registry';
import {
  type DashBlock as DashBlockType,
  getDefaultViz, getDefaultSize,
} from '@/components/builder/types';
import { BlockLibrary, LibraryDragPreview } from '@/components/builder/block-library';
import { DashBlock } from '@/components/builder/dash-block';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = '7d' | '30d' | '90d';
type Client = { id: string; name: string };

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

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ children, isEmpty }: { children: React.ReactNode; isEmpty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'dash-drop-zone' });
  return (
    <div ref={setNodeRef} className={cn('min-h-[200px] rounded-xl transition-all', isOver && 'ring-2 ring-primary/40 bg-primary/5')}>
      {isEmpty ? (
        <div className={cn('flex flex-col items-center justify-center py-32 border-2 border-dashed rounded-xl transition-all',
          isOver ? 'border-primary/60 bg-primary/5' : 'border-border/40')}>
          <LayoutDashboard className={cn('w-12 h-12 mb-4', isOver ? 'text-primary' : 'text-muted-foreground/30')} />
          <p className={cn('font-semibold text-sm', isOver ? 'text-primary' : 'text-muted-foreground/50')}>
            {isOver ? 'Solte para adicionar' : 'Dashboard vazio'}
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1 mb-5">
            {isOver ? '' : 'Arraste métricas da biblioteca ou vá ao Construtor'}
          </p>
          {!isOver && (
            <Link href="/construtor"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
              <Settings2 className="w-4 h-4" /> Ir para o Construtor
            </Link>
          )}
        </div>
      ) : children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const searchParams  = useSearchParams();
  const router        = useRouter();

  const [period,       setPeriod]       = useState<Period>('30d');
  const [clients,      setClients]      = useState<Client[]>([]);
  const [selectedId,   setSelectedId]   = useState(searchParams.get('client') ?? '');
  const [blocks,       setBlocks]       = useState<DashBlockType[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [libCollapsed, setLibCollapsed] = useState(true);
  const [newBlockId,   setNewBlockId]   = useState<string | null>(null);
  const [dragLibKey,   setDragLibKey]   = useState<string | null>(null);

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

  // ── Load blocks when client changes ───────────────────────────────────────

  const loadBlocks = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard-configs?clientId=${clientId}`);
      if (!res.ok) { setBlocks([]); return; }
      const d = await res.json() as { blocks: DashBlockType[] };
      setBlocks(Array.isArray(d.blocks) ? d.blocks : []);
    } catch {
      setBlocks([]);
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

  // ── Auto-save on block changes ────────────────────────────────────────────

  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleAutoSave(updated: DashBlockType[]) {
    if (!selectedId) return;
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      void fetch(`/api/dashboard-configs?clientId=${selectedId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: updated }),
      });
    }, 1500);
  }

  // ── DnD ──────────────────────────────────────────────────────────────────

  function handleDragStart(e: DragStartEvent) {
    const d = e.active.data.current;
    setDragLibKey(d?.type === 'library' ? (d.metricKey as string) : null);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setDragLibKey(null);
    const d = active.data.current;

    if (d?.type === 'library') {
      if (!over) return;
      const metric = METRIC_BY_KEY[d.metricKey as string];
      if (!metric) return;
      const viz  = getDefaultViz(metric);
      const size = getDefaultSize(metric, viz);
      const id   = `b${Date.now()}`;
      const next = [...blocks, {
        id, metricKeys: [d.metricKey as string], vizType: viz, size,
        level: 'conta' as const, comparativo: 'none' as const, meta: null, position: blocks.length,
      }];
      setBlocks(next);
      setNewBlockId(id);
      scheduleAutoSave(next);
      return;
    }

    if (over && active.id !== over.id) {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === active.id);
        const to   = prev.findIndex(b => b.id === over.id);
        if (from === -1 || to === -1) return prev;
        const next = arrayMove(prev, from, to).map((b, i) => ({ ...b, position: i }));
        scheduleAutoSave(next);
        return next;
      });
    }
  }

  function updateBlock(updated: DashBlockType) {
    const next = blocks.map(b => b.id === updated.id ? updated : b);
    setBlocks(next);
    scheduleAutoSave(next);
    if (newBlockId === updated.id) setNewBlockId(null);
  }

  function removeBlock(id: string) {
    const next = blocks.filter(b => b.id !== id);
    setBlocks(next);
    scheduleAutoSave(next);
    if (newBlockId === id) setNewBlockId(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-0 -mx-6 -mt-4">

        {/* Sidebar biblioteca */}
        <BlockLibrary collapsed={libCollapsed} onToggle={() => setLibCollapsed(p => !p)} />

        {/* Conteúdo */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3 px-6 py-4 border-b border-border">
            <div>
              <h1 className="font-heading font-normal text-3xl uppercase leading-none tracking-wide">Dashboard</h1>
              <p className="text-xs text-muted-foreground mt-1">
                {loading ? 'Carregando...' : `${blocks.length} bloco${blocks.length !== 1 ? 's' : ''}`}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <ClientSelector clients={clients} selected={selectedId} onSelect={setSelectedId} />

              {/* Period */}
              <div className="flex rounded-lg border border-border bg-card overflow-hidden">
                {(['7d', '30d', '90d'] as Period[]).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={cn('px-3 py-1.5 text-sm font-semibold transition-colors',
                      period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                    {p === '7d' ? '7d' : p === '30d' ? '30d' : '90d'}
                  </button>
                ))}
              </div>

              {/* Reload */}
              <button onClick={() => selectedId && void loadBlocks(selectedId)}
                className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
                title="Recarregar">
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
              </button>

              {/* Link ao Construtor */}
              <Link href={`/construtor${selectedId ? `?client=${selectedId}` : ''}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                <Settings2 className="w-3.5 h-3.5" /> Construtor
              </Link>

              {/* Adicionar bloco rápido */}
              <button onClick={() => {
                const metric = METRIC_BY_KEY['meta_leads'];
                if (!metric) return;
                const id = `b${Date.now()}`;
                const next = [...blocks, {
                  id, metricKeys: ['meta_leads'], vizType: getDefaultViz(metric), size: 2 as const,
                  level: 'conta' as const, comparativo: 'none' as const, meta: null, position: blocks.length,
                }];
                setBlocks(next);
                setNewBlockId(id);
                scheduleAutoSave(next);
              }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Bloco
              </button>
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading ? (
              <div className="flex items-center justify-center py-24 text-sm text-muted-foreground gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando dashboard...
              </div>
            ) : (
              <SortableContext items={blocks.map(b => b.id)} strategy={rectSortingStrategy}>
                <DropZone isEmpty={blocks.length === 0}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                    {blocks.map(block => (
                      <DashBlock
                        key={block.id}
                        block={block}
                        data={data}
                        onUpdate={updateBlock}
                        onRemove={() => removeBlock(block.id)}
                        openConfig={newBlockId === block.id}
                      />
                    ))}
                  </div>
                </DropZone>
              </SortableContext>
            )}
          </div>
        </div>
      </div>

      <DragOverlay>
        {dragLibKey && <LibraryDragPreview metricKey={dragLibKey} />}
      </DragOverlay>
    </DndContext>
  );
}
