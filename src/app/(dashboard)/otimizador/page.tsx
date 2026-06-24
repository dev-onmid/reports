"use client";

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  MousePointerClick,
  RefreshCw,
  Target,
  ThumbsDown,
  WandSparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientAvatar } from '@/components/client-avatar';
import { getAuthSession } from '@/lib/auth-store';
import type { Client } from '@/lib/mock-data';
import { cn, formatCurrencyBRL } from '@/lib/utils';
import type { OptimizerAnalysisResult } from '@/lib/optimizer';

type LevelFilter = 'todos' | 'vermelho' | 'amarelo' | 'verde';

type QueueItem = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  conjunto_id: string;
  campanha_nome: string;
  conta_plataforma: string;
  periodo_label: string;
  periodo_dias: number;
  origem: OptimizerAnalysisResult['origem'];
  nivel_critico: OptimizerAnalysisResult['nivel_critico'];
  gasto_total: number;
  conversoes: number;
  cpl_cpa_atual: number | null;
  ctr_link: number | null;
  resultado: OptimizerAnalysisResult;
  created_at: string;
};

const LEVEL_STYLE = {
  verde: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  amarelo: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  vermelho: 'border-red-400/40 bg-red-400/10 text-red-300',
};

const SOURCE_LABEL: Record<OptimizerAnalysisResult['origem'], string> = {
  camada_1: 'Regra',
  ia: 'IA',
  cache: 'Cache',
  fallback: 'Fallback',
};

function formatDateTime(value: string | null): string {
  if (!value) return 'Ainda não gerado';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function levelSort(level: QueueItem['nivel_critico']) {
  if (level === 'vermelho') return 0;
  if (level === 'amarelo') return 1;
  return 2;
}

export default function OtimizadorPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientFilter, setClientFilter] = useState('todos');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('todos');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionFeedback, setActionFeedback] = useState<Record<number, string>>({});

  async function loadQueue() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('hours', '48');
      if (clientFilter !== 'todos') params.set('clientId', clientFilter);
      if (levelFilter !== 'todos') params.set('level', levelFilter);

      const [clientsRes, queueRes] = await Promise.all([
        fetch('/api/clients'),
        fetch(`/api/otimizador/analisar?${params.toString()}`),
      ]);

      if (clientsRes.ok) {
        const data = await clientsRes.json() as Client[];
        setClients(data.filter((client) => client.status !== 'Arquivado' && client.status !== 'Inativo'));
      }

      if (queueRes.ok) {
        const data = await queueRes.json() as { items: QueueItem[]; generated_at: string | null };
        setQueue(data.items);
        setGeneratedAt(data.generated_at);
        setSelectedId((current) => data.items.some((item) => item.id === current) ? current : data.items[0]?.id ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadQueue(); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientFilter, levelFilter]);

  const selected = useMemo(
    () => queue.find((item) => item.id === selectedId) ?? queue[0] ?? null,
    [queue, selectedId],
  );

  const stats = useMemo(() => {
    const vermelho = queue.filter((item) => item.nivel_critico === 'vermelho').length;
    const amarelo = queue.filter((item) => item.nivel_critico === 'amarelo').length;
    const verde = queue.filter((item) => item.nivel_critico === 'verde').length;
    const spend = queue.reduce((sum, item) => sum + item.gasto_total, 0);
    return { vermelho, amarelo, verde, spend };
  }, [queue]);

  const sortedQueue = useMemo(
    () => [...queue].sort((a, b) => {
      const levelDiff = levelSort(a.nivel_critico) - levelSort(b.nivel_critico);
      if (levelDiff !== 0) return levelDiff;
      return b.gasto_total - a.gasto_total;
    }),
    [queue],
  );

  async function logDecision(
    index: number,
    decisao: 'aceito' | 'recusado' | 'manual',
    actionText: string,
    resultado: 'pendente' | 'sucesso' | 'erro' = 'pendente',
  ) {
    if (!selected) return;
    const session = getAuthSession();
    setActionFeedback((prev) => ({ ...prev, [index]: 'Salvando...' }));
    try {
      const res = await fetch('/api/otimizador/analisar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gestor_id: session?.userId ?? 'desconhecido',
          cliente_id: selected.resultado.cliente_id,
          conjunto_id: selected.resultado.conjunto_id,
          recomendacao_id: selected.resultado.recomendacao_id,
          decisao,
          motivo_recusa: decisao === 'recusado' ? 'outro' : undefined,
          acao_executada: actionText,
          resultado_da_acao: resultado,
        }),
      });
      setActionFeedback((prev) => ({ ...prev, [index]: res.ok ? 'Registrado' : 'Erro ao salvar' }));
    } catch {
      setActionFeedback((prev) => ({ ...prev, [index]: 'Erro ao salvar' }));
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <WandSparkles className="h-4 w-4" />
            Otimizador
          </div>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Fila pronta de decisões</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Todo dia às 7h, o sistema analisa ontem, 3, 7, 21, 30 e 90 dias. Aqui aparece só o que merece ação.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[680px]">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Cliente</span>
            <select
              value={clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="todos">Todos</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Prioridade</span>
            <select
              value={levelFilter}
              onChange={(event) => setLevelFilter(event.target.value as LevelFilter)}
              className="h-11 w-full rounded-[var(--radius)] border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="todos">Todas</option>
              <option value="vermelho">Vermelho</option>
              <option value="amarelo">Amarelo</option>
              <option value="verde">Verde</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button variant="outline" className="w-full" onClick={loadQueue} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-5">
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CalendarClock className="h-4 w-4 text-primary" />
            Gerado
          </div>
          <div className="mt-2 text-lg font-bold text-foreground">{formatDateTime(generatedAt)}</div>
        </div>
        <button onClick={() => setLevelFilter('vermelho')} className="rounded-[var(--radius)] border border-red-400/30 bg-red-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-red-200">Fazer agora</div>
          <div className="mt-2 text-2xl font-bold text-red-100">{stats.vermelho}</div>
        </button>
        <button onClick={() => setLevelFilter('amarelo')} className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-amber-200">Acompanhar</div>
          <div className="mt-2 text-2xl font-bold text-amber-100">{stats.amarelo}</div>
        </button>
        <button onClick={() => setLevelFilter('verde')} className="rounded-[var(--radius)] border border-emerald-400/30 bg-emerald-400/10 p-4 text-left">
          <div className="text-xs font-semibold text-emerald-200">Oportunidade</div>
          <div className="mt-2 text-2xl font-bold text-emerald-100">{stats.verde}</div>
        </button>
        <div className="rounded-[var(--radius)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <CircleDollarSign className="h-4 w-4 text-primary" />
            Verba analisada
          </div>
          <div className="mt-2 text-lg font-bold text-foreground">{formatCurrencyBRL(stats.spend)}</div>
        </div>
      </section>

      <main className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <section className="rounded-[var(--radius)] border border-border bg-card">
          <div className="border-b border-border p-4">
            <h2 className="font-semibold text-foreground">O que fazer hoje</h2>
            <p className="text-xs text-muted-foreground">Ordem por urgência e verba impactada. Clique para ver a decisão recomendada.</p>
          </div>

          {loading ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando análises prontas...
            </div>
          ) : sortedQueue.length === 0 ? (
            <div className="flex h-72 flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-300" />
              <p className="font-semibold text-foreground">Nenhuma análise pronta ainda</p>
              <p className="max-w-md text-sm text-muted-foreground">
                A fila aparece depois do processamento das 7h. Também dá para chamar a rota do cron manualmente pelo servidor.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sortedQueue.map((item) => {
                const selectedRow = item.id === selected?.id;
                const firstAction = item.resultado.acoes[0]?.acao ?? 'Revisar recomendação';
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setActionFeedback({});
                    }}
                    className={cn(
                      'grid w-full gap-3 p-4 text-left transition-colors lg:grid-cols-[1fr_auto] hover:bg-primary/5',
                      selectedRow && 'bg-primary/10',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-[11px] font-bold uppercase', LEVEL_STYLE[item.nivel_critico])}>
                          {item.nivel_critico}
                        </span>
                        <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                          {item.periodo_label}
                        </span>
                        <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                          {SOURCE_LABEL[item.origem]}
                        </span>
                      </div>
                      <div className="mt-3 flex items-start gap-3">
                        <ClientAvatar clientId={item.cliente_id} name={item.cliente_nome} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{item.cliente_nome}</p>
                          <p className="truncate text-sm text-muted-foreground">{item.campanha_nome}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-foreground">{firstAction}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 lg:justify-end">
                      <div className="grid grid-cols-3 gap-3 text-right text-xs">
                        <div>
                          <span className="block text-muted-foreground">Gasto</span>
                          <span className="font-semibold text-foreground">{formatCurrencyBRL(item.gasto_total)}</span>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">CPL</span>
                          <span className="font-semibold text-foreground">{item.cpl_cpa_atual ? formatCurrencyBRL(item.cpl_cpa_atual) : '-'}</span>
                        </div>
                        <div>
                          <span className="block text-muted-foreground">Conv.</span>
                          <span className="font-semibold text-foreground">{item.conversoes.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {!selected ? (
            <section className="rounded-[var(--radius)] border border-border bg-card p-6 text-center">
              <WandSparkles className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-semibold text-foreground">Fila aguardando processamento</p>
              <p className="mt-1 text-sm text-muted-foreground">Quando as análises forem geradas, o detalhe aparece aqui.</p>
            </section>
          ) : (
            <section className="rounded-[var(--radius)] border border-border bg-card">
              <div className="border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('rounded-[var(--radius)] border px-2 py-1 text-xs font-bold uppercase', LEVEL_STYLE[selected.nivel_critico])}>
                        {selected.nivel_critico}
                      </span>
                      <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                        {selected.periodo_label}
                      </span>
                      <span className="rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                        Confiança {selected.resultado.confianca}
                      </span>
                    </div>
                    <h3 className="mt-3 text-lg font-bold text-foreground">{selected.resultado.titulo_problema}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{selected.cliente_nome} · {selected.campanha_nome}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selected.resultado.o_que_esta_acontecendo}</p>
              </div>

              <div className="space-y-3 p-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-[var(--radius)] border border-border bg-background p-3">
                    <CircleDollarSign className="h-4 w-4 text-primary" />
                    <span className="mt-2 block text-xs text-muted-foreground">Gasto</span>
                    <span className="font-semibold text-foreground">{formatCurrencyBRL(selected.gasto_total)}</span>
                  </div>
                  <div className="rounded-[var(--radius)] border border-border bg-background p-3">
                    <Target className="h-4 w-4 text-primary" />
                    <span className="mt-2 block text-xs text-muted-foreground">Conversões</span>
                    <span className="font-semibold text-foreground">{selected.conversoes.toLocaleString('pt-BR')}</span>
                  </div>
                  <div className="rounded-[var(--radius)] border border-border bg-background p-3">
                    <MousePointerClick className="h-4 w-4 text-primary" />
                    <span className="mt-2 block text-xs text-muted-foreground">CTR</span>
                    <span className="font-semibold text-foreground">{selected.ctr_link == null ? '-' : `${selected.ctr_link.toFixed(2)}%`}</span>
                  </div>
                </div>

                <h4 className="text-sm font-semibold text-foreground">Ações recomendadas</h4>
                {selected.resultado.acoes.map((action, index) => (
                  <div key={`${selected.id}-${action.prioridade}-${index}`} className="rounded-[var(--radius)] border border-border bg-background p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary text-sm font-bold text-primary-foreground">
                        {action.prioridade}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{action.acao}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{action.por_que}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {action.executavel_pelo_sistema ? (
                            <span className="inline-flex items-center gap-1 text-emerald-300"><BadgeCheck className="h-3.5 w-3.5" /> Executável</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Manual</span>
                          )}
                          {actionFeedback[index] && <span className="text-primary">{actionFeedback[index]}</span>}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button size="xs" onClick={() => logDecision(index, 'aceito', action.acao, 'pendente')}>
                            <Check className="h-3.5 w-3.5" />
                            Vou fazer
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => logDecision(index, 'manual', action.acao, 'sucesso')}>
                            <WandSparkles className="h-3.5 w-3.5" />
                            Marcar feita
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => logDecision(index, 'recusado', action.acao)}>
                            <ThumbsDown className="h-3.5 w-3.5" />
                            Recusar
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {selected.resultado.observacao && (
                  <div className="rounded-[var(--radius)] border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
                    {selected.resultado.observacao}
                  </div>
                )}
              </div>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
