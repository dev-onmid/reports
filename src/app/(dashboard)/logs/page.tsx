"use client";

import { useEffect, useState } from 'react';
import { CirclePlus, Trash2, UserPlus, ClipboardList, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type ActivityEntry,
  type ActivityType,
  clearActivityLog,
  readActivityLog,
} from '@/lib/activity-log-store';
import { cn } from '@/lib/utils';

type FilterType = ActivityType | 'Todos';

const TYPE_LABELS: Record<ActivityType, string> = {
  payment_added: 'Pix adicionado',
  payment_deleted: 'Pix excluído',
  client_created: 'Cliente criado',
};

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  payment_added: CirclePlus,
  payment_deleted: Trash2,
  client_created: UserPlus,
};

const TYPE_STYLE: Record<ActivityType, string> = {
  payment_added: 'bg-primary/15 text-primary border-primary/30',
  payment_deleted: 'bg-red-500/15 text-red-300 border-red-400/30',
  client_created: 'bg-blue-500/15 text-blue-300 border-blue-400/30',
};

const TYPE_ICON_STYLE: Record<ActivityType, string> = {
  payment_added: 'text-primary',
  payment_deleted: 'text-red-300',
  client_created: 'text-blue-300',
};

function formatTimestamp(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { date, time };
}

const FILTERS: Array<{ key: FilterType; label: string }> = [
  { key: 'Todos', label: 'Todos' },
  { key: 'payment_added', label: 'Pix adicionados' },
  { key: 'payment_deleted', label: 'Pix excluídos' },
  { key: 'client_created', label: 'Clientes criados' },
];

export default function LogsPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState<FilterType>('Todos');
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    readActivityLog().then(setEntries).catch(() => {});
  }, []);

  const filtered = filter === 'Todos' ? entries : entries.filter((e) => e.type === filter);

  async function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    await clearActivityLog().catch(() => {});
    setEntries([]);
    setConfirmClear(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Logs de Atividade</h1>
          <p className="text-muted-foreground mt-1">Histórico de todas as ações realizadas no sistema.</p>
        </div>
        {entries.length > 0 && (
          <Button
            variant="ghost"
            onClick={handleClear}
            onBlur={() => setConfirmClear(false)}
            className={cn(
              'text-sm font-semibold transition-colors',
              confirmClear
                ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25 hover:text-red-200'
                : 'text-muted-foreground hover:text-red-300 hover:bg-red-500/10',
            )}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {confirmClear ? 'Confirmar limpeza' : 'Limpar logs'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'h-7 rounded-md px-3 text-[11px] font-bold transition-colors',
                filter === key
                  ? key === 'Todos'
                    ? 'bg-foreground/10 text-foreground'
                    : TYPE_STYLE[key as ActivityType]
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-1">
          {filtered.length} registro{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

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
            <div className="grid grid-cols-[28px_1fr_140px_160px] gap-4 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border">
              <span />
              <span>Descrição</span>
              <span>Quem fez</span>
              <span>Data e hora</span>
            </div>
            <div className="divide-y divide-border">
              {filtered.map((entry) => {
                const Icon = TYPE_ICON[entry.type];
                const { date, time } = formatTimestamp(entry.timestamp);
                return (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[28px_1fr_140px_160px] gap-4 px-5 py-3.5 items-center hover:bg-muted/30 transition-colors"
                  >
                    <div className={cn('flex items-center justify-center w-7 h-7 rounded-full border', TYPE_STYLE[entry.type])}>
                      <Icon className={cn('w-3.5 h-3.5', TYPE_ICON_STYLE[entry.type])} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{entry.description}</p>
                      <span className={cn('mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold', TYPE_STYLE[entry.type])}>
                        {TYPE_LABELS[entry.type]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground font-medium">{entry.actor}</p>
                    <div>
                      <p className="text-sm font-medium">{date}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
