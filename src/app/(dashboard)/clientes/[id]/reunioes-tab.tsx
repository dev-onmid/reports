'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronDown, Circle, ExternalLink, FileText,
  ListChecks, RefreshCw, Trash2, Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Aba "Reuniões" — o repositório de reuniões gravadas do cliente, pra dar
 * continuidade de onde a última parou:
 *
 * - A reunião mais recente vem aberta e destacada, com o checklist em evidência.
 * - Cada reunião traz resumo, link da gravação (TLDV), doc completo e checklist
 *   INTERATIVO (marcar item feito persiste via PATCH /api/clients/[id]/reunioes).
 *
 * Quem alimenta é o webhook `/api/integrations/reuniao/resumo` (Make, no final
 * do cenário do TLDV) — payload documentado na própria rota.
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

function fmtData(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(/^\d+$/.test(String(iso)) ? Number(iso) : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Link da gravação: o que a automação mandou; sem ele, se o meeting_id tem a
 * cara de um id do TLDV (ObjectId de 24 hex), derivamos o link do app.
 */
function linkGravacao(r: ResumoRow): string | null {
  if (r.recording_url) return r.recording_url;
  if (r.meeting_id && /^[0-9a-f]{24}$/i.test(r.meeting_id)) {
    return `https://tldv.io/app/meetings/${r.meeting_id}`;
  }
  return null;
}

function Checklist({
  itens, onToggle,
}: { itens: ChecklistItem[]; onToggle: (index: number) => void }) {
  const feitos = itens.filter(i => i.feito).length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Checklist da reunião
        </span>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] font-bold',
          feitos === itens.length
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-border bg-background text-muted-foreground',
        )}>
          {feitos}/{itens.length}
        </span>
      </div>
      <div className="space-y-1">
        {itens.map((item, i) => (
          <button
            key={`${i}-${item.texto}`}
            type="button"
            onClick={() => onToggle(i)}
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
  );
}

function LinksReuniao({ r }: { r: ResumoRow }) {
  const gravacao = linkGravacao(r);
  if (!gravacao && !r.doc_url) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {gravacao && (
        <a
          href={gravacao}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          <Video className="h-3.5 w-3.5" /> Ver gravação
        </a>
      )}
      {r.doc_url && (
        <a
          href={r.doc_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground/80 transition-colors hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" /> Documento completo <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

export function ClientReunioesTab({ clientId }: { clientId: string }) {
  const [resumos, setResumos] = useState<ResumoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandido, setExpandido] = useState<string | null>(null);

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
  }

  function toggleItem(r: ResumoRow, index: number) {
    if (!r.checklist) return;
    const novo = r.checklist.map((item, i) => i === index ? { ...item, feito: !item.feito } : item);
    // Otimista: a tela reflete na hora; o PATCH persiste em segundo plano.
    setResumos(prev => prev.map(item => item.id === r.id ? { ...item, checklist: novo } : item));
    void fetch(`/api/clients/${clientId}/reunioes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumoId: r.id, checklist: novo }),
    }).catch(() => {});
  }

  const [ultima, ...anteriores] = resumos;

  return (
    <div className="space-y-6 pt-1">
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background">
              <Video className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-bold text-foreground">Reuniões</h3>
              <p className="text-xs text-muted-foreground">
                Toda reunião gravada com o cliente: resumo, gravação e o checklist pra continuar de onde parou.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Atualizar
          </Button>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Carregando reuniões...</p>
          ) : resumos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma reunião registrada ainda. Quando a automação enviar
              (webhook <code className="rounded bg-background px-1.5 py-0.5 text-[11px]">/api/integrations/reuniao/resumo</code>),
              elas aparecem aqui da mais recente pra mais antiga.
            </p>
          ) : (
            <div className="space-y-5">
              {/* ── Última reunião: aberta e em evidência ─────────────────── */}
              <div className="rounded-xl border border-primary/30 bg-background">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
                        Última reunião
                      </span>
                      <span className="text-[11px] text-muted-foreground">{fmtData(ultima.reuniao_em)}</span>
                    </div>
                    <p className="font-bold text-sm text-foreground">
                      {ultima.titulo?.trim() || `Reunião de ${fmtData(ultima.reuniao_em)}`}
                    </p>
                  </div>
                  <LinksReuniao r={ultima} />
                </div>
                <div className="space-y-4 px-4 py-4">
                  {ultima.checklist && ultima.checklist.length > 0 && (
                    <Checklist itens={ultima.checklist} onToggle={i => toggleItem(ultima, i)} />
                  )}
                  <div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Resumo</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{ultima.resumo}</p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void excluir(ultima)}
                      className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" /> Excluir
                    </button>
                  </div>
                </div>
              </div>

              {/* ── Histórico ─────────────────────────────────────────────── */}
              {anteriores.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    Reuniões anteriores · {anteriores.length}
                  </h4>
                  <div className="space-y-3">
                    {anteriores.map(r => {
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
                            <div className="space-y-4 border-t border-border px-4 py-4">
                              <LinksReuniao r={r} />
                              {r.checklist && r.checklist.length > 0 && (
                                <Checklist itens={r.checklist} onToggle={i => toggleItem(r, i)} />
                              )}
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{r.resumo}</p>
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => void excluir(r)}
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
