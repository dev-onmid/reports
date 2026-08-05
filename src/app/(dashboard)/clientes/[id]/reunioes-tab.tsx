'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, ChevronRight, Circle, ExternalLink, FileText,
  Info, ListChecks, Play, RefreshCw, ScrollText, Search, Trash2, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Aba "Reuniões" — repositório de reuniões gravadas do cliente. Layout em 3
 * blocos (mock do Matheus, 2026-08-04):
 *
 * 1. Checklist da última reunião (esquerda): progresso + itens com badge
 *    Concluída/Pendente, toggle persiste via PATCH.
 * 2. Histórico de reuniões (direita): busca, linha do tempo com data/título/
 *    resumo de uma linha, "Ver gravação" na mais recente e "Ver detalhes"
 *    (modal com resumo completo, checklist, links e excluir).
 * 3. Tarefas geradas nas reuniões (embaixo): agregação dos checklists de
 *    TODAS as reuniões — cada item vira linha com a reunião de origem; o
 *    status é clicável (mesmo PATCH). Responsável/prazo não existem no dado
 *    (checklist é {texto, feito}) — colunas omitidas de propósito.
 *
 * Alimentação: webhook `/api/integrations/reuniao/resumo` (Make/TLDV) e o
 * backfill `/api/integrations/tldv-backfill`.
 */

type ChecklistItem = { texto: string; feito: boolean };

type ResumoRow = {
  id: string;
  meeting_id: string | null;
  titulo: string | null;
  resumo: string;
  doc_url: string | null;
  recording_url: string | null;
  checklist: ChecklistItem[] | null;
  reuniao_em: string;
  created_at: string;
};

function parseData(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(/^\d+$/.test(String(iso)) ? Number(iso) : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtData(iso: string | null | undefined): string {
  const d = parseData(iso);
  return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function fmtDataCurta(iso: string | null | undefined): string {
  const d = parseData(iso);
  return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

/** Bloco de data do histórico: dia grande + mês abreviado ("31 JUL"). */
function DataBloco({ iso }: { iso: string }) {
  const d = parseData(iso);
  return (
    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border bg-background">
      <span className="text-sm font-extrabold leading-none text-foreground">
        {d ? String(d.getDate()).padStart(2, '0') : '—'}
      </span>
      <span className="mt-0.5 text-[9px] font-bold uppercase leading-none tracking-wider text-muted-foreground">
        {d ? d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') : ''}
      </span>
    </div>
  );
}

/**
 * Link da gravação: o que a automação mandou; sem ele, meeting_id com cara de
 * id do TLDV (ObjectId de 24 hex) deriva o link do app.
 */
function linkGravacao(r: ResumoRow): string | null {
  if (r.recording_url) return r.recording_url;
  if (r.meeting_id && /^[0-9a-f]{24}$/i.test(r.meeting_id)) {
    return `https://tldv.io/app/meetings/${r.meeting_id}`;
  }
  return null;
}

function StatusBadge({ feito, onClick }: { feito: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        'rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors',
        feito
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-amber-400/30 bg-amber-400/10 text-amber-400',
        onClick && 'cursor-pointer hover:brightness-125',
      )}
    >
      {feito ? 'Concluída' : 'Pendente'}
    </button>
  );
}

function tituloDe(r: ResumoRow): string {
  return r.titulo?.trim() || `Reunião de ${fmtData(r.reuniao_em)}`;
}

export function ClientReunioesTab({ clientId }: { clientId: string }) {
  const [resumos, setResumos] = useState<ResumoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [detalhe, setDetalhe] = useState<ResumoRow | null>(null);
  const [todasReunioes, setTodasReunioes] = useState(false);
  const [todasTarefas, setTodasTarefas] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/reunioes`);
      const data = await r.json().catch(() => ({})) as { resumos?: ResumoRow[] };
      setResumos(data.resumos ?? []);
    } catch {
      setResumos([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);

  async function excluir(r: ResumoRow) {
    if (!window.confirm('Excluir esta reunião do histórico? A ação não desfaz.')) return;
    await fetch(`/api/clients/${clientId}/reunioes?resumoId=${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
    setResumos(prev => prev.filter(item => item.id !== r.id));
    setDetalhe(prev => (prev?.id === r.id ? null : prev));
  }

  function toggleItem(resumoId: string, index: number) {
    const alvo = resumos.find(r => r.id === resumoId);
    if (!alvo?.checklist) return;
    const novo = alvo.checklist.map((item, i) => i === index ? { ...item, feito: !item.feito } : item);
    // Otimista: a tela reflete na hora; o PATCH persiste em segundo plano.
    setResumos(prev => prev.map(item => item.id === resumoId ? { ...item, checklist: novo } : item));
    setDetalhe(prev => (prev?.id === resumoId ? { ...prev, checklist: novo } : prev));
    void fetch(`/api/clients/${clientId}/reunioes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumoId, checklist: novo }),
    }).catch(() => {});
  }

  const ultima = resumos[0] as ResumoRow | undefined;

  const historicoFiltrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return resumos;
    return resumos.filter(r => `${tituloDe(r)} ${r.resumo}`.toLowerCase().includes(q));
  }, [resumos, busca]);
  const historicoVisivel = todasReunioes ? historicoFiltrado : historicoFiltrado.slice(0, 5);

  // Cada item de checklist de qualquer reunião = uma "tarefa gerada".
  const tarefas = useMemo(() =>
    resumos.flatMap(r => (r.checklist ?? []).map((item, index) => ({ item, index, reuniao: r }))),
  [resumos]);
  const tarefasOrdenadas = useMemo(() =>
    [...tarefas].sort((a, b) => Number(a.item.feito) - Number(b.item.feito)),
  [tarefas]);
  const tarefasVisiveis = todasTarefas ? tarefasOrdenadas : tarefasOrdenadas.slice(0, 8);

  const feitos = ultima?.checklist?.filter(i => i.feito).length ?? 0;
  const totalItens = ultima?.checklist?.length ?? 0;
  const pct = totalItens > 0 ? Math.round((feitos / totalItens) * 100) : 0;
  const gravacaoUltima = ultima ? linkGravacao(ultima) : null;

  if (loading) {
    return <p className="pt-4 text-sm text-muted-foreground">Carregando reuniões...</p>;
  }

  if (resumos.length === 0) {
    return (
      <div className="mt-1 rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          Nenhuma reunião registrada ainda. Quando a automação enviar
          (webhook <code className="rounded bg-background px-1.5 py-0.5 text-[11px]">/api/integrations/reuniao/resumo</code>),
          elas aparecem aqui da mais recente pra mais antiga.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-1">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_1fr]">
        {/* ── 1. Checklist da última reunião ──────────────────────────────── */}
        {/* min-w-0: sem isto o conteúdo largo define o mínimo da faixa do grid
            e uma coluna espreme a outra (truncate deixa de funcionar). */}
        <div className="min-w-0 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                <ListChecks className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-foreground">
                  Checklist da última reunião
                </h3>
                <p className="text-[11px] text-muted-foreground">{fmtData(ultima?.reuniao_em)} · {tituloDe(ultima!)}</p>
              </div>
            </div>
            {gravacaoUltima && (
              <a
                href={gravacaoUltima}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                <Play className="h-3.5 w-3.5" /> Ver gravação
              </a>
            )}
          </div>

          <div className="px-5 py-4">
            {totalItens > 0 ? (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Progresso do checklist
                  </span>
                  {/* basis força a barra pra linha própria no mobile em vez de sumir espremida */}
                  <div className="h-1.5 min-w-[120px] flex-1 basis-32 overflow-hidden rounded-full bg-background">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-foreground/80">
                    {feitos} de {totalItens} concluída{totalItens === 1 ? '' : 's'} ({pct}%)
                  </span>
                </div>

                <div className="divide-y divide-border/60">
                  {ultima!.checklist!.map((item, i) => (
                    <div key={`${i}-${item.texto}`} className="flex items-center justify-between gap-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggleItem(ultima!.id, i)}
                        className="flex min-w-0 items-start gap-2.5 text-left"
                      >
                        {item.feito
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className={cn(
                          'text-sm leading-snug',
                          item.feito ? 'text-muted-foreground' : 'text-foreground/90',
                        )}>
                          {item.texto}
                        </span>
                      </button>
                      <StatusBadge feito={item.feito} onClick={() => toggleItem(ultima!.id, i)} />
                    </div>
                  ))}
                </div>

                <p className="mt-3 flex items-center gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  Itens pendentes serão tratados nas próximas reuniões.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Esta reunião não trouxe checklist — veja o resumo em{' '}
                <button type="button" onClick={() => setDetalhe(ultima!)} className="font-semibold text-primary hover:underline">
                  Ver detalhes
                </button>.
              </p>
            )}
          </div>
        </div>

        {/* ── 2. Histórico de reuniões ────────────────────────────────────── */}
        <div className="min-w-0 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                <ScrollText className="h-4.5 w-4.5 text-primary" />
              </div>
              <h3 className="text-sm font-extrabold uppercase tracking-wide text-foreground">
                Histórico de reuniões
              </h3>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar reuniões"
                className="h-8 w-44 rounded-lg border border-border bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="px-5 py-4">
            {historicoVisivel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma reunião encontrada pra essa busca.</p>
            ) : (
              <div className="space-y-1">
                {historicoVisivel.map((r) => {
                  const gravacao = linkGravacao(r);
                  const ehUltima = r.id === ultima?.id;
                  return (
                    <div key={r.id} className="flex items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-background/60">
                      <DataBloco iso={r.reuniao_em} />
                      <button
                        type="button"
                        onClick={() => setDetalhe(r)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-foreground">{tituloDe(r)}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          Resumo: {r.resumo.split('\n')[0]}
                        </p>
                      </button>
                      {ehUltima && gravacao ? (
                        <a
                          href={gravacao}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
                        >
                          <Play className="h-3 w-3" /> Ver gravação
                        </a>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDetalhe(r)}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold text-foreground/80 transition-colors hover:text-foreground"
                        >
                          <FileText className="h-3 w-3" /> Ver detalhes
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {historicoFiltrado.length > 5 && (
              <button
                type="button"
                onClick={() => setTodasReunioes(v => !v)}
                className="mt-3 flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                {todasReunioes ? 'Mostrar menos' : `Ver todas as reuniões (${historicoFiltrado.length})`}
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', todasReunioes && 'rotate-90')} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. Tarefas geradas nas reuniões ───────────────────────────────── */}
      {tarefas.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background">
                <ListChecks className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-foreground">
                  Tarefas geradas nas reuniões
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  Acompanhamento das ações combinadas nas reuniões realizadas.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              Atualizar
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tarefa</th>
                  <th className="px-5 py-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Origem da reunião</th>
                  <th className="px-5 py-2.5 text-right text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {tarefasVisiveis.map(({ item, index, reuniao }) => (
                  <tr key={`${reuniao.id}-${index}`} className="transition-colors hover:bg-background/60">
                    <td className="px-5 py-3">
                      <div className="flex items-start gap-2.5">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className={cn('text-sm leading-snug', item.feito ? 'text-muted-foreground' : 'text-foreground/90')}>
                          {item.texto}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-xs font-semibold text-foreground/80">{fmtDataCurta(reuniao.reuniao_em)}</p>
                      <p className="max-w-[220px] truncate text-[11px] text-muted-foreground">{tituloDe(reuniao)}</p>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <StatusBadge feito={item.feito} onClick={() => toggleItem(reuniao.id, index)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {tarefasOrdenadas.length > 8 && (
            <div className="border-t border-border/60 px-5 py-3">
              <button
                type="button"
                onClick={() => setTodasTarefas(v => !v)}
                className="flex items-center gap-1 text-xs font-bold text-primary hover:underline"
              >
                {todasTarefas ? 'Mostrar menos' : `Ver todas as tarefas (${tarefasOrdenadas.length})`}
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', todasTarefas && 'rotate-90')} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Modal de detalhes ─────────────────────────────────────────────── */}
      {detalhe && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDetalhe(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{fmtData(detalhe.reuniao_em)}</p>
                <h3 className="font-bold text-foreground">{tituloDe(detalhe)}</h3>
              </div>
              <button
                type="button"
                onClick={() => setDetalhe(null)}
                className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-4">
              {(linkGravacao(detalhe) || detalhe.doc_url) && (
                <div className="flex flex-wrap items-center gap-2">
                  {linkGravacao(detalhe) && (
                    <a
                      href={linkGravacao(detalhe)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                    >
                      <Play className="h-3.5 w-3.5" /> Ver gravação
                    </a>
                  )}
                  {detalhe.doc_url && (
                    <a
                      href={detalhe.doc_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors hover:text-foreground"
                    >
                      <FileText className="h-3.5 w-3.5" /> Documento completo <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {detalhe.checklist && detalhe.checklist.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <ListChecks className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Checklist da reunião
                    </span>
                  </div>
                  <div className="space-y-1">
                    {detalhe.checklist.map((item, i) => (
                      <button
                        key={`${i}-${item.texto}`}
                        type="button"
                        onClick={() => toggleItem(detalhe.id, i)}
                        className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-background"
                      >
                        {item.feito
                          ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className={cn(
                          'text-sm leading-snug',
                          item.feito ? 'text-muted-foreground line-through' : 'text-foreground/90',
                        )}>
                          {item.texto}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Resumo</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{detalhe.resumo}</p>
              </div>

              <div className="flex justify-end border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={() => void excluir(detalhe)}
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" /> Excluir reunião
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
