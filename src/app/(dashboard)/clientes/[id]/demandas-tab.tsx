'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, CheckSquare, ChevronDown, ExternalLink, FileText,
  ListTodo, RefreshCw, Trash2, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Aba "Demandas" — espelho do progresso do cliente pra retomar reuniões:
 *
 * 1. Tarefas pendentes da lista do ClickUp vinculada ao cliente, SÓ dos status
 *    Flow e Tráfego (decisão do Matheus — o resto da lista não interessa aqui).
 * 2. Resumos das reuniões (backlog), gravados pelo webhook do Make
 *    (`/api/integrations/reuniao/resumo`) no final do cenário do TLDV.
 */

// Status do ClickUp que aparecem aqui. Comparação sobre o nome normalizado
// (sem acento/caixa), então cobre "FLOW", "Tráfego", "TRAFEGO" etc.
const STATUS_VISIVEIS = ['flow', 'trafego'];

function normalizeStatus(raw: string | null | undefined): string {
  return String(raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

type ClickupTaskRow = {
  id: string;
  name: string;
  url: string;
  status?: { status: string; color: string } | null;
  date_created?: string | null;
  due_date?: string | null;
  assignees?: { id: number; username: string }[];
};

type ResumoRow = {
  id: string;
  meeting_id: string | null;
  titulo: string | null;
  resumo: string;
  doc_url: string | null;
  reuniao_em: string;
  created_at: string;
};

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(/^\d+$/.test(String(iso)) ? Number(iso) : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClientDemandasTab({ clientId }: { clientId: string }) {
  const [tasks, setTasks] = useState<ClickupTaskRow[]>([]);
  const [tasksError, setTasksError] = useState('');
  const [tasksLoading, setTasksLoading] = useState(true);
  const [semVinculo, setSemVinculo] = useState(false);

  const [resumos, setResumos] = useState<ResumoRow[]>([]);
  const [resumosLoading, setResumosLoading] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError('');
    setSemVinculo(false);
    try {
      const r = await fetch(`/api/clickup/tasks?clientId=${encodeURIComponent(clientId)}`);
      const data = await r.json().catch(() => ({})) as { tasks?: ClickupTaskRow[]; error?: string };
      if (r.status === 404) { setSemVinculo(true); setTasks([]); return; }
      if (!r.ok || data.error) { setTasksError(data.error ?? 'Falha ao buscar tarefas do ClickUp'); setTasks([]); return; }
      setTasks(data.tasks ?? []);
    } catch {
      setTasksError('Falha de conexão com o ClickUp');
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [clientId]);

  const loadResumos = useCallback(async () => {
    setResumosLoading(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/reunioes`);
      const data = await r.json().catch(() => ({})) as { resumos?: ResumoRow[] };
      setResumos(data.resumos ?? []);
    } catch {
      setResumos([]);
    } finally {
      setResumosLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void loadTasks(); void loadResumos(); }, [loadTasks, loadResumos]);

  async function excluirResumo(r: ResumoRow) {
    if (!window.confirm('Excluir este resumo de reunião? A ação não desfaz.')) return;
    await fetch(`/api/clients/${clientId}/reunioes?resumoId=${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
    setResumos(prev => prev.filter(item => item.id !== r.id));
  }

  // Só Flow e Tráfego, agrupadas por status na ordem de STATUS_VISIVEIS.
  const grupos = useMemo(() => {
    const visiveis = tasks.filter(t => STATUS_VISIVEIS.includes(normalizeStatus(t.status?.status)));
    return STATUS_VISIVEIS
      .map(key => ({
        key,
        // rótulo/cor reais vêm da primeira tarefa do grupo (ClickUp manda ambos)
        exemplo: visiveis.find(t => normalizeStatus(t.status?.status) === key),
        tarefas: visiveis.filter(t => normalizeStatus(t.status?.status) === key),
      }))
      .filter(g => g.tarefas.length > 0);
  }, [tasks]);

  const totalVisiveis = grupos.reduce((sum, g) => sum + g.tarefas.length, 0);

  return (
    <div className="space-y-6 pt-1">
      {/* ── Demandas do ClickUp ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
              <ListTodo className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Demandas em andamento</h3>
              <p className="text-xs text-muted-foreground">
                Tarefas da lista do ClickUp deste cliente nos status Flow e Tráfego.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {totalVisiveis > 0 && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                {totalVisiveis} pendente{totalVisiveis === 1 ? '' : 's'}
              </span>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void loadTasks()} disabled={tasksLoading}>
              <RefreshCw className={cn('h-3.5 w-3.5', tasksLoading && 'animate-spin')} />
              Atualizar
            </Button>
          </div>
        </div>

        <div className="p-5">
          {tasksLoading ? (
            <p className="text-sm text-muted-foreground">Buscando tarefas no ClickUp...</p>
          ) : semVinculo ? (
            <p className="text-sm text-muted-foreground">
              Este cliente ainda não está vinculado a uma lista do ClickUp.
              Configure em <span className="text-foreground font-semibold">Integrações → ClickUp</span>.
            </p>
          ) : tasksError ? (
            <p className="text-sm text-red-400">{tasksError}</p>
          ) : totalVisiveis === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma demanda pendente nos status Flow ou Tráfego. 🎉
            </p>
          ) : (
            <div className="space-y-5">
              {grupos.map(grupo => (
                <div key={grupo.key}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: grupo.exemplo?.status?.color || '#55f52f' }}
                    />
                    <h4 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      {grupo.exemplo?.status?.status ?? grupo.key} · {grupo.tarefas.length}
                    </h4>
                  </div>
                  <div className="divide-y divide-border rounded-xl border border-border bg-background">
                    {grupo.tarefas.map(t => (
                      <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-foreground">{t.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              {t.assignees && t.assignees.length > 0 && (
                                <span className="flex items-center gap-1">
                                  <Users className="h-3 w-3" />
                                  {t.assignees.map(a => a.username).join(', ')}
                                </span>
                              )}
                              {t.due_date && (
                                <span className={cn(
                                  'flex items-center gap-1',
                                  Number(t.due_date) < Date.now() && 'text-red-400',
                                )}>
                                  <CalendarDays className="h-3 w-3" />
                                  Prazo: {fmtData(t.due_date)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          Abrir no ClickUp <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Resumos de reunião (backlog) ────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Reuniões</h3>
              <p className="text-xs text-muted-foreground">
                Resumos recebidos da automação — o backlog pra retomar de onde a última reunião parou.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void loadResumos()} disabled={resumosLoading}>
            <RefreshCw className={cn('h-3.5 w-3.5', resumosLoading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>

        <div className="p-5">
          {resumosLoading ? (
            <p className="text-sm text-muted-foreground">Carregando resumos...</p>
          ) : resumos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum resumo de reunião recebido ainda. Quando a automação enviar
              (webhook <code className="rounded bg-background px-1.5 py-0.5 text-[11px]">/api/integrations/reuniao/resumo</code>),
              eles aparecem aqui do mais recente pro mais antigo.
            </p>
          ) : (
            <div className="space-y-3">
              {resumos.map(r => {
                const aberto = expandido === r.id;
                return (
                  <div key={r.id} className="rounded-xl border border-border bg-background">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandido(aberto ? null : r.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandido(aberto ? null : r.id); } }}
                      className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', aberto && 'rotate-180')} />
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-foreground">
                            {r.titulo?.trim() || `Reunião de ${fmtData(r.reuniao_em)}`}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{fmtData(r.reuniao_em)}</p>
                        </div>
                      </div>
                      {!aberto && (
                        <p className="hidden max-w-[45%] truncate text-xs text-muted-foreground sm:block">
                          {r.resumo}
                        </p>
                      )}
                    </div>
                    {aberto && (
                      <div className="border-t border-border px-4 py-3">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{r.resumo}</p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          {r.doc_url ? (
                            <a
                              href={r.doc_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            >
                              Documento completo <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : <span />}
                          <button
                            type="button"
                            onClick={() => void excluirResumo(r)}
                            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-red-400"
                          >
                            <Trash2 className="h-3 w-3" /> Excluir
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
