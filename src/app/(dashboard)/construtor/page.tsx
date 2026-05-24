"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, closestCenter, useDroppable,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import {
  Plus, Save, Download, Upload, Copy, ChevronDown, Check, Loader2, LayoutTemplate, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { METRIC_BY_KEY, generateMockSeries, ALL_UNIFIED_METRICS } from '@/lib/metrics-registry';
import {
  type DashBlock as DashBlockType,
  getDefaultViz, getDefaultSize,
} from '@/components/builder/types';
import { BlockLibrary, LibraryDragPreview } from '@/components/builder/block-library';
import { DashBlock } from '@/components/builder/dash-block';
import { TEMPLATES, type Template } from '@/components/builder/templates';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period  = '7d' | '30d' | '90d';
type Client  = { id: string; name: string };
type SavedConfig = { blocks: DashBlockType[]; updatedAt: string | null };

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ children, isEmpty }: { children: React.ReactNode; isEmpty: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'dashboard-drop-zone' });
  return (
    <div ref={setNodeRef} className={cn(
      'min-h-[200px] rounded-xl transition-all duration-200',
      isOver && 'ring-2 ring-primary/40 bg-primary/5',
    )}>
      {isEmpty ? (
        <div className={cn(
          'flex flex-col items-center justify-center py-24 border-2 border-dashed rounded-xl transition-all',
          isOver ? 'border-primary/60 bg-primary/5' : 'border-border/50',
        )}>
          <Plus className={cn('w-10 h-10 mb-3', isOver ? 'text-primary' : 'text-muted-foreground/40')} />
          <p className={cn('font-semibold text-sm', isOver ? 'text-primary' : 'text-muted-foreground/50')}>
            {isOver ? 'Solte para adicionar' : 'Arraste métricas da biblioteca'}
          </p>
          <p className="text-xs text-muted-foreground/40 mt-1">ou clique em + para adicionar manualmente</p>
        </div>
      ) : children}
    </div>
  );
}

// ── Client selector ───────────────────────────────────────────────────────────

function ClientSelector({
  clients, selected, onSelect,
}: { clients: Client[]; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = clients.find(c => c.id === selected);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-8 pl-3 pr-2 rounded-lg border border-border bg-card text-sm hover:border-primary/40 transition-colors"
      >
        <span className="max-w-[160px] truncate">
          {current?.name ?? 'Selecionar cliente'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 min-w-[220px] rounded-xl border border-border bg-popover shadow-xl py-1 max-h-64 overflow-y-auto">
          <p className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Cliente
          </p>
          {clients.map(c => (
            <button key={c.id} onClick={() => { onSelect(c.id); setOpen(false); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors',
                c.id === selected && 'text-primary',
              )}>
              {c.id === selected && <Check className="w-3.5 h-3.5 shrink-0" />}
              <span className={cn('truncate', c.id !== selected && 'pl-5')}>{c.name}</span>
            </button>
          ))}
          {clients.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted-foreground text-center">Nenhum cliente encontrado.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Template picker ───────────────────────────────────────────────────────────

function TemplateCard({ tpl, onSelect }: { tpl: Template; onSelect: () => void }) {
  const metricLabels = tpl.blocks
    .flatMap(b => b.metricKeys)
    .slice(0, 6)
    .map(k => ALL_UNIFIED_METRICS.find(m => m.key === k)?.shortLabel ?? k);

  return (
    <button onClick={onSelect}
      className="group text-left rounded-2xl border border-border bg-card hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10 transition-all p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-base leading-tight">{tpl.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{tpl.subtitle}</p>
        </div>
        <div className="w-8 h-8 rounded-lg shrink-0 mt-0.5" style={{ background: tpl.color + '33', border: `1px solid ${tpl.color}55` }}>
          <div className="w-full h-full rounded-lg flex items-center justify-center">
            <span className="w-2 h-2 rounded-full" style={{ background: tpl.color }} />
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{tpl.description}</p>
      <div className="flex flex-wrap gap-1 mt-auto pt-1">
        {tpl.tags.map(t => (
          <span key={t} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
            {t}
          </span>
        ))}
      </div>
      <div className="border-t border-border pt-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
          {tpl.blocks.length} blocos · inclui
        </p>
        <div className="flex flex-wrap gap-1">
          {metricLabels.map((l, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted/60 text-muted-foreground">{l}</span>
          ))}
          {tpl.blocks.flatMap(b => b.metricKeys).length > 6 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted/60 text-muted-foreground">
              +{tpl.blocks.flatMap(b => b.metricKeys).length - 6} mais
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function TemplatePicker({
  onSelect, onDismiss, isModal,
}: { onSelect: (tpl: Template) => void; onDismiss?: () => void; isModal?: boolean }) {
  const content = (
    <div className={cn(isModal && 'bg-card rounded-2xl border border-border shadow-2xl w-full max-w-3xl p-6')}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-heading font-normal text-2xl uppercase tracking-wide">Escolha um template</p>
          <p className="text-xs text-muted-foreground mt-1">
            Pré-configurado com os blocos mais usados. Customize depois à vontade.
          </p>
        </div>
        {isModal && onDismiss && (
          <button onClick={onDismiss}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TEMPLATES.map(tpl => (
          <TemplateCard key={tpl.id} tpl={tpl} onSelect={() => onSelect(tpl)} />
        ))}
      </div>
      {isModal && (
        <div className="mt-4 pt-4 border-t border-border">
          <button onClick={onDismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancelar e continuar editando
          </button>
        </div>
      )}
    </div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
        {content}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      {content}
    </div>
  );
}

// ── Copy from client dialog ───────────────────────────────────────────────────

function CopyDialog({
  clients, currentId, onCopy, onClose,
}: { clients: Client[]; currentId: string; onCopy: (id: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState('');
  const others = clients.filter(c => c.id !== currentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm p-5 space-y-4">
        <p className="font-semibold text-sm">Copiar configuração de outro cliente</p>
        <p className="text-xs text-muted-foreground">
          A configuração atual será substituída pela do cliente selecionado.
        </p>
        <div className="space-y-1 max-h-52 overflow-y-auto">
          {others.map(c => (
            <button key={c.id} onClick={() => setPicked(c.id)}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 rounded-lg border text-sm transition-colors',
                picked === c.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card hover:bg-muted/50 text-muted-foreground hover:text-foreground',
              )}>
              {picked === c.id && <Check className="w-3.5 h-3.5 shrink-0" />}
              <span className={cn('truncate', picked !== c.id && 'pl-5')}>{c.name}</span>
            </button>
          ))}
          {others.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-4">Nenhum outro cliente com configuração salva.</p>
          )}
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancelar
          </button>
          <button onClick={() => { if (picked) { onCopy(picked); onClose(); } }}
            disabled={!picked}
            className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors">
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ConstruitorPage() {
  const [period,         setPeriod]         = useState<Period>('30d');
  const [blocks,         setBlocks]         = useState<DashBlockType[]>([]);
  const [libCollapsed,   setLibCollapsed]   = useState(false);
  const [newBlockId,     setNewBlockId]     = useState<string | null>(null);
  const [dragLibKey,     setDragLibKey]     = useState<string | null>(null);
  const [showTplPicker,  setShowTplPicker]  = useState(false);
  const [clientLoaded,   setClientLoaded]   = useState(false);

  // Clients + persistence
  const [clients,      setClients]      = useState<Client[]>([]);
  const [selectedId,   setSelectedId]   = useState('');
  const [savedClients, setSavedClients] = useState<Client[]>([]);
  const [saving,       setSaving]       = useState(false);
  const [savedAt,      setSavedAt]      = useState<string | null>(null);
  const [copyOpen,     setCopyOpen]     = useState(false);

  const data = useMemo(() => generateMockSeries(period), [period]);

  // ── Load clients ──────────────────────────────────────────────────────────

  useEffect(() => {
    fetch('/api/clients')
      .then(r => r.ok ? r.json() as Promise<Client[]> : [])
      .then(list => { setClients(list); if (list.length > 0 && !selectedId) setSelectedId(list[0].id); })
      .catch(() => {});

    fetch('/api/dashboard-configs', { method: 'PATCH' })
      .then(r => r.ok ? r.json() as Promise<Array<{ client_id: string; client_name: string }>> : [])
      .then(rows => setSavedClients(rows.map(r => ({ id: r.client_id, name: r.client_name }))))
      .catch(() => {});
  }, []);

  // ── Load config when client changes ───────────────────────────────────────

  const loadConfig = useCallback(async (clientId: string) => {
    if (!clientId) return;
    setClientLoaded(false);
    try {
      const res = await fetch(`/api/dashboard-configs?clientId=${clientId}`);
      if (!res.ok) { setBlocks([]); setShowTplPicker(true); return; }
      const d = await res.json() as SavedConfig;
      if (d.blocks && d.blocks.length > 0) {
        setBlocks(d.blocks);
        setSavedAt(d.updatedAt);
        setShowTplPicker(false);
      } else {
        setBlocks([]);
        setSavedAt(null);
        setShowTplPicker(true); // no blocks saved → show template picker
      }
    } catch {
      setBlocks([]);
      setShowTplPicker(true);
    } finally {
      setClientLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadConfig(selectedId);
  }, [selectedId, loadConfig]);

  // ── Apply template ────────────────────────────────────────────────────────

  function applyTemplate(tpl: Template) {
    const now = Date.now();
    const newBlocks: DashBlockType[] = tpl.blocks.map((b, i) => ({
      ...b,
      id: `b${now}${i}`,
      position: i,
    }));
    setBlocks(newBlocks);
    setSavedAt(null);
    setShowTplPicker(false);
  }

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
        const rows = await fetch('/api/dashboard-configs', { method: 'PATCH' })
          .then(r => r.ok ? r.json() as Promise<Array<{ client_id: string; client_name: string }>> : []);
        setSavedClients(rows.map(r => ({ id: r.client_id, name: r.client_name })));
      }
    } finally {
      setSaving(false);
    }
  }

  // ── Copy from client ─────────────────────────────────────────────────────

  async function handleCopy(fromClientId: string) {
    try {
      const res = await fetch(`/api/dashboard-configs?clientId=${fromClientId}`);
      if (!res.ok) return;
      const d = await res.json() as SavedConfig;
      if (d.blocks && d.blocks.length > 0) {
        setBlocks(d.blocks.map((b, i) => ({ ...b, id: `b${Date.now()}${i}`, position: i })));
        setSavedAt(null);
      }
    } catch { /* ignore */ }
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  function handleExport() {
    const client = clients.find(c => c.id === selectedId);
    const json = JSON.stringify({
      clientId: selectedId, clientName: client?.name ?? '',
      blocks, exportedAt: new Date().toISOString(),
    }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `dashboard-${client?.name ?? selectedId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const parsed = JSON.parse(e.target?.result as string) as { blocks: DashBlockType[] };
          if (Array.isArray(parsed.blocks)) {
            setBlocks(parsed.blocks.map((b, i) => ({ ...b, id: `b${Date.now()}${i}` })));
            setSavedAt(null);
          }
        } catch { /* invalid JSON */ }
      };
      reader.readAsText(file);
    };
    input.click();
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
      setBlocks(prev => [...prev, {
        id, metricKeys: [d.metricKey as string], vizType: viz, size,
        level: 'conta', comparativo: 'none', meta: null, position: prev.length,
      }]);
      setNewBlockId(id);
      return;
    }

    if (over && active.id !== over.id) {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === active.id);
        const to   = prev.findIndex(b => b.id === over.id);
        if (from === -1 || to === -1) return prev;
        return arrayMove(prev, from, to).map((b, i) => ({ ...b, position: i }));
      });
    }
  }

  function updateBlock(updated: DashBlockType) {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
    if (newBlockId === updated.id) setNewBlockId(null);
  }

  function removeBlock(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id));
    if (newBlockId === id) setNewBlockId(null);
  }

  function addEmptyBlock() {
    const metric = METRIC_BY_KEY['meta_leads'];
    if (!metric) return;
    const id = `b${Date.now()}`;
    setBlocks(prev => [...prev, {
      id, metricKeys: ['meta_leads'], vizType: getDefaultViz(metric), size: 2,
      level: 'conta', comparativo: 'none', meta: null, position: prev.length,
    }]);
    setNewBlockId(id);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // When no blocks and client loaded → show template picker inline (not modal)
  const showInlinePicker = clientLoaded && blocks.length === 0 && showTplPicker;

  return (
    <>
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-0 -mx-6 -mt-4">

          {/* Sidebar */}
          <BlockLibrary collapsed={libCollapsed} onToggle={() => setLibCollapsed(p => !p)} />

          {/* Main */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

            {/* Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3 px-6 py-4 border-b border-border">
              <div>
                <h1 className="font-heading font-normal text-3xl uppercase leading-none tracking-wide">
                  Construtor de Dashboard
                </h1>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <p className="text-xs text-muted-foreground">
                    {blocks.length} bloco{blocks.length !== 1 ? 's' : ''}
                  </p>
                  {savedAt && (
                    <span className="text-[10px] text-muted-foreground/50">
                      · salvo {new Date(savedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <ClientSelector
                  clients={clients}
                  selected={selectedId}
                  onSelect={id => { setSelectedId(id); setSavedAt(null); }}
                />

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

                {/* Templates button */}
                <button onClick={() => setShowTplPicker(true)} title="Usar template"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <LayoutTemplate className="w-3.5 h-3.5" /> Templates
                </button>

                <button onClick={() => setCopyOpen(true)} title="Copiar de outro cliente"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <Copy className="w-3.5 h-3.5" /> Copiar de
                </button>

                <button onClick={handleImport} title="Importar JSON"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                </button>

                <button onClick={handleExport} title="Exportar JSON"
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <Download className="w-3.5 h-3.5" />
                </button>

                <button onClick={addEmptyBlock}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <Plus className="w-3.5 h-3.5" /> Adicionar
                </button>

                <button onClick={() => void handleSave()} disabled={!selectedId || saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {saving
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvando</>
                    : <><Save className="w-3.5 h-3.5" /> Salvar</>}
                </button>
              </div>
            </div>

            {/* Template picker inline (when no blocks) or modal (when blocks exist) */}
            {showInlinePicker ? (
              <TemplatePicker onSelect={applyTemplate} />
            ) : (
              <div className="flex-1 overflow-y-auto px-6 py-5">
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
              </div>
            )}
          </div>
        </div>

        <DragOverlay>
          {dragLibKey && <LibraryDragPreview metricKey={dragLibKey} />}
        </DragOverlay>
      </DndContext>

      {/* Template picker modal (when blocks already exist) */}
      {showTplPicker && !showInlinePicker && (
        <TemplatePicker
          isModal
          onSelect={tpl => { applyTemplate(tpl); setShowTplPicker(false); }}
          onDismiss={() => setShowTplPicker(false)}
        />
      )}

      {/* Copy dialog */}
      {copyOpen && (
        <CopyDialog
          clients={savedClients}
          currentId={selectedId}
          onCopy={id => void handleCopy(id)}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </>
  );
}
