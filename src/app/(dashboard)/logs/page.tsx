"use client";

import { useEffect, useState } from 'react';
import {
  Activity,
  Trash2,
  Plus,
  UserPlus,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
} from 'lucide-react';
import {
  type ActivityEntry,
  type ActivityType,
  clearActivityLog,
  readActivityLog,
} from '@/lib/activity-log-store';
import { cn } from '@/lib/utils';

type FilterType = ActivityType | 'Todos';

const PAGE_SIZE = 10;

const TYPE_LABELS: Record<ActivityType, string> = {
  payment_added: 'Pix adicionado',
  payment_deleted: 'Pix excluído',
  client_created: 'Cliente criado',
  client_status_updated: 'Status de cliente',
};

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  payment_added: Plus,
  payment_deleted: Trash2,
  client_created: UserPlus,
  client_status_updated: RefreshCw,
};

// Circle bg/border/icon color per type
const TYPE_CIRCLE_STYLE: Record<ActivityType, { wrapper: string; icon: string; dot: string }> = {
  payment_added: {
    wrapper: 'bg-emerald-500/20 border border-emerald-500/30',
    icon: 'text-emerald-400',
    dot: 'bg-emerald-500/60',
  },
  payment_deleted: {
    wrapper: 'bg-red-500/20 border border-red-500/30',
    icon: 'text-red-400',
    dot: 'bg-red-500/60',
  },
  client_created: {
    wrapper: 'bg-violet-500/20 border border-violet-500/30',
    icon: 'text-violet-400',
    dot: 'bg-violet-500/60',
  },
  client_status_updated: {
    wrapper: 'bg-orange-500/20 border border-orange-500/30',
    icon: 'text-orange-400',
    dot: 'bg-orange-500/60',
  },
};

// Badge pill styles per type
const TYPE_BADGE_STYLE: Record<ActivityType, string> = {
  payment_added: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  payment_deleted: 'bg-red-500/15 text-red-400 border border-red-500/30',
  client_created: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
  client_status_updated: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
};

// Filter dot colors
const FILTER_DOT: Record<string, string> = {
  payment_added: 'bg-emerald-400',
  payment_deleted: 'bg-red-400',
  client_created: 'bg-blue-400',
  client_status_updated: 'bg-purple-400',
};

// Avatar config per actor name
function getActorMeta(actor: string): { initial: string; color: string; email: string } {
  const lower = actor.toLowerCase();
  if (lower.includes('leticia') || lower.includes('letícia')) {
    return { initial: 'L', color: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', email: 'leticia@onreport.com' };
  }
  return { initial: actor.charAt(0).toUpperCase(), color: 'bg-violet-500/20 text-violet-400 border border-violet-500/30', email: 'matheus.onmid@gmail.com' };
}

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { date, time };
}

// Extract short meta from description (ID-like substring + source tag)
function extractMeta(description: string): string {
  // Try to find something that looks like an ID or source
  const idMatch = description.match(/\b([a-f0-9]{8})\b/i);
  const sourceMatch = description.match(/\(([^)]+)\)/);
  const parts: string[] = [];
  if (idMatch) parts.push(`ID: ${idMatch[1]}`);
  if (sourceMatch) parts.push(sourceMatch[1]);
  if (parts.length === 0) return '';
  return parts.join(' • ');
}

const FILTERS: Array<{ key: FilterType; label: string }> = [
  { key: 'Todos', label: 'Todos' },
  { key: 'payment_added', label: 'Pix adicionados' },
  { key: 'payment_deleted', label: 'Pix excluídos' },
  { key: 'client_created', label: 'Clientes criados' },
  { key: 'client_status_updated', label: 'Status de clientes' },
];

export default function LogsPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<FilterType>('Todos');
  const [confirmClear, setConfirmClear] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    readActivityLog().then(setEntries).catch(() => {});
  }, []);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setPage(1);
  }, [filter]);

  const filtered = filter === 'Todos' ? entries : entries.filter((e) => e.type === filter);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Count per type
  const countByType: Record<string, number> = {
    Todos: entries.length,
    payment_added: entries.filter((e) => e.type === 'payment_added').length,
    payment_deleted: entries.filter((e) => e.type === 'payment_deleted').length,
    client_created: entries.filter((e) => e.type === 'client_created').length,
    client_status_updated: entries.filter((e) => e.type === 'client_status_updated').length,
  };

  async function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearActivityLog().catch(() => {});
    setEntries([]);
    setConfirmClear(false);
    setPage(1);
  }

  // Build visible page numbers: always show first, last, current ±1, with ellipsis
  function buildPageRange(): Array<number | '...'> {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: Array<number | '...'> = [];
    const add = (n: number | '...') => {
      if (pages[pages.length - 1] !== n) pages.push(n);
    };
    add(1);
    if (page > 3) add('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) add(i);
    if (page < totalPages - 2) add('...');
    add(totalPages);
    return pages;
  }

  return (
    <div className="space-y-6 p-6">
      {/* HEADER */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0 mt-0.5">
            <Activity className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">Logs de Atividade</h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-xl">
              Histórico completo de todas as ações realizadas no sistema. Acompanhe, filtre e audite cada evento com facilidade.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClear}
          onBlur={() => setConfirmClear(false)}
          className={cn(
            'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
            confirmClear
              ? 'border-red-500/50 bg-red-500/15 text-red-300'
              : 'border-red-500/30 text-red-400 hover:bg-red-500/10',
          )}
        >
          <Trash2 className="w-4 h-4" />
          {confirmClear ? 'Confirmar limpeza' : 'Limpar logs'}
        </button>
      </div>

      {/* FILTER TABS ROW */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {FILTERS.map(({ key, label }) => {
            const count = countByType[key] ?? 0;
            const isActive = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-emerald-500 text-white'
                    : 'bg-card border border-border text-muted-foreground hover:text-foreground hover:border-border/80',
                )}
              >
                {key !== 'Todos' && (
                  <span
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      isActive ? 'bg-white/80' : FILTER_DOT[key],
                    )}
                  />
                )}
                {label}
                <span className={cn('ml-0.5', isActive ? 'text-white/80' : 'text-muted-foreground')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <span className="text-xs text-muted-foreground">
          {filtered.length} registro{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* TABLE */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <ClipboardList className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground">Nenhum registro encontrado</p>
            <p className="text-sm text-muted-foreground/60 mt-1">
              {entries.length === 0
                ? 'As ações realizadas no sistema aparecerão aqui.'
                : 'Nenhuma ação corresponde ao filtro selecionado.'}
            </p>
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[72px_1fr_180px_160px] gap-4 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
              <span>Ação</span>
              <span>Descrição</span>
              <span>Responsável</span>
              <span>Data e Hora</span>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border">
              {paginated.map((entry) => {
                const Icon = TYPE_ICON[entry.type];
                const circle = TYPE_CIRCLE_STYLE[entry.type];
                const badge = TYPE_BADGE_STYLE[entry.type];
                const { date, time } = formatTimestamp(entry.timestamp);
                const meta = extractMeta(entry.description);
                const actor = getActorMeta(entry.actor);

                return (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[72px_1fr_180px_160px] gap-4 px-5 py-4 items-center hover:bg-muted/20 transition-colors"
                  >
                    {/* AÇÃO column */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', circle.wrapper)}>
                        <Icon className={cn('w-4 h-4', circle.icon)} />
                      </div>
                      <span className={cn('w-2 h-2 rounded-full', circle.dot)} />
                    </div>

                    {/* DESCRIÇÃO column */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold leading-snug">{entry.description}</p>
                        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', badge)}>
                          {TYPE_LABELS[entry.type]}
                        </span>
                      </div>
                      {meta && (
                        <p className="mt-1 text-[11px] text-muted-foreground font-mono">{meta}</p>
                      )}
                    </div>

                    {/* RESPONSÁVEL column */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0', actor.color)}>
                        {actor.initial}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{entry.actor}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{actor.email}</p>
                      </div>
                    </div>

                    {/* DATA E HORA column */}
                    <div>
                      <p className="text-sm font-semibold">{date}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* FOOTER / PAGINATION */}
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-border flex-wrap">
              {/* Left: record range */}
              <span className="text-xs text-muted-foreground">
                Exibindo {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1} a{' '}
                {Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length} registros
              </span>

              {/* Center: page size label */}
              <span className="text-xs text-muted-foreground">{PAGE_SIZE} por página</span>

              {/* Right: pagination controls */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    page === 1
                      ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40',
                  )}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Anterior
                </button>

                {buildPageRange().map((p, i) =>
                  p === '...' ? (
                    <span key={`ellipsis-${i}`} className="px-1 text-xs text-muted-foreground">
                      ...
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={cn(
                        'w-8 h-8 rounded-md text-xs font-medium transition-colors',
                        p === page
                          ? 'bg-emerald-500 text-white'
                          : 'border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40',
                      )}
                    >
                      {p}
                    </button>
                  ),
                )}

                <button
                  type="button"
                  disabled={page === totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={cn(
                    'flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                    page === totalPages
                      ? 'border-border/40 text-muted-foreground/40 cursor-not-allowed'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40',
                  )}
                >
                  Próxima
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
