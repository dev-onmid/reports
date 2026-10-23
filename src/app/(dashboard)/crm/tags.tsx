'use client';

/**
 * Tags de qualificação do lead (2026-10-10) — a peça de tela, usada pelo card
 * do Kanban, pelo modal do lead e pelo cabeçalho do chat.
 *
 * Regra de UX pedida pelo Matheus: marcar tem que ser PRÁTICO (um clique no
 * card, sem abrir modal) e a tag tem que ficar perto do nome. Por isso:
 * - `TagChips`: as tags do lead como pílulas coloridas, logo abaixo do nome;
 * - `BotaoTags`: um botão com a lista de tags do cliente em checklist — abre
 *   no próprio card (para o pointerdown não virar arraste, o botão engole o
 *   evento, como os vizinhos dele já fazem);
 * - `TagsConfigModal`: criar/renomear/recolorir/apagar as tags do cliente —
 *   a agência e qualquer usuário do cliente (gestor ou atendente, desde 23/10).
 *
 * As tags chegam DENTRO do lead (`lead.tags`, montadas no SQL da listagem);
 * o catálogo do cliente vem de `/api/crm/tags?clientId=` via `useTagsDoCliente`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Plus, Settings2, Tag, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';
import { PALETA_TAGS, NOME_TAG_MAX, type CrmTag } from '@/lib/crm-tags';

export type { CrmTag };

export function useTagsDoCliente(clientId: string | null | undefined) {
  // Guardado junto do cliente a que pertence: trocar de cliente não mostra o
  // catálogo do anterior enquanto o novo carrega. `versao` é o gatilho de
  // recarga (quem grava tag chama `recarregar` para a contagem do filtro
  // acompanhar) — o efeito só busca; nenhum setState síncrono dentro dele.
  const [estado, setEstado] = useState<{ clientId: string; tags: CrmTag[] }>({ clientId: '', tags: [] });
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    fetch(`/api/crm/tags?clientId=${encodeURIComponent(clientId)}`)
      .then(r => (r.ok ? r.json() : []))
      .then((lista: unknown) => { if (vivo) setEstado({ clientId, tags: Array.isArray(lista) ? lista as CrmTag[] : [] }); })
      .catch(() => { /* sem tag o board continua funcionando */ });
    return () => { vivo = false; };
  }, [clientId, versao]);
  const recarregar = useCallback(() => { setVersao(v => v + 1); }, []);
  const tags = clientId && estado.clientId === clientId ? estado.tags : [];
  const setTags = useCallback((lista: CrmTag[]) => { if (clientId) setEstado({ clientId, tags: lista }); }, [clientId]);
  return { tags, setTags, recarregar };
}

/** Grava a lista completa de tags de um lead. Devolve a lista confirmada pelo servidor. */
export async function salvarTagsDoLead(leadId: string, tagIds: string[]): Promise<CrmTag[]> {
  const r = await fetch(`/api/crm/${leadId}/tags`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagIds }),
  });
  const j = await r.json().catch(() => ({})) as { tags?: CrmTag[]; error?: string };
  if (!r.ok) throw new Error(j.error ?? 'Não foi possível salvar as tags.');
  return j.tags ?? [];
}

/** Cor do texto sobre o fundo translúcido da pílula: a própria cor, clareada. */
function estiloChip(cor: string): React.CSSProperties {
  return { backgroundColor: `${cor}26`, color: cor, borderColor: `${cor}66` };
}

export function TagChips({ tags, max = 3, tamanho = 'xs', className }: {
  tags: CrmTag[] | null | undefined; max?: number; tamanho?: 'xs' | 'sm'; className?: string;
}) {
  const lista = tags ?? [];
  if (lista.length === 0) return null;
  const visiveis = lista.slice(0, max);
  const resto = lista.length - visiveis.length;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {visiveis.map(t => (
        <span key={t.id} title={t.name} style={estiloChip(t.color)}
          className={cn('inline-flex max-w-[120px] items-center gap-1 truncate rounded border font-semibold leading-tight',
            tamanho === 'xs' ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[11px]')}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="truncate">{t.name}</span>
        </span>
      ))}
      {resto > 0 && (
        <span title={lista.slice(max).map(t => t.name).join(', ')}
          className={cn('rounded border border-border bg-muted/40 font-semibold leading-tight text-muted-foreground', tamanho === 'xs' ? 'px-1 py-px text-[9px]' : 'px-1.5 py-0.5 text-[11px]')}>
          +{resto}
        </span>
      )}
    </div>
  );
}

/**
 * Botão + lista em checklist. `selecionadas` são os ids já no lead; cada
 * clique chama `onToggle` com a lista NOVA (quem chama grava e repinta).
 */
export function BotaoTags({ tags, selecionadas, onChange, onConfigurar, alinhar = 'right', compacto = true, className }: {
  tags: CrmTag[];
  selecionadas: string[];
  onChange: (tagIds: string[]) => void;
  onConfigurar?: () => void;
  alinhar?: 'left' | 'right';
  compacto?: boolean;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    function esc(e: KeyboardEvent) { if (e.key === 'Escape') setAberto(false); }
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);
  const sel = new Set(selecionadas);
  function alternar(id: string) {
    const nova = sel.has(id) ? selecionadas.filter(x => x !== id) : [...selecionadas, id];
    onChange(nova);
  }
  return (
    <div ref={ref} className={cn('relative', className)} onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        title={selecionadas.length ? `Tags: ${tags.filter(t => sel.has(t.id)).map(t => t.name).join(', ')}` : 'Marcar tags'}
        onClick={() => setAberto(v => !v)}
        className={cn(
          compacto
            ? 'flex h-5 w-5 items-center justify-center rounded transition-colors hover:bg-muted'
            : 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-semibold transition-colors hover:border-primary/50',
          selecionadas.length ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Tag className={compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {!compacto && <span>Tags{selecionadas.length ? ` · ${selecionadas.length}` : ''}</span>}
      </button>
      {aberto && (
        <div className={cn('absolute top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-xl', alinhar === 'right' ? 'right-0' : 'left-0')}>
          {tags.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">Nenhuma tag criada ainda.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {tags.map(t => {
                const on = sel.has(t.id);
                return (
                  <button key={t.id} type="button" onClick={() => alternar(t.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
          {onConfigurar && (
            <button type="button" onClick={() => { setAberto(false); onConfigurar(); }}
              className="mt-1 flex w-full items-center gap-2 rounded border-t border-border px-2 py-1.5 text-left text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Settings2 className="h-3 w-3" /> Configurar tags
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Filtro da barra: uma tag ou todas. Some quando o cliente não tem tag. */
export function FiltroTag({ tags, valor, onChange }: { tags: CrmTag[]; valor: string; onChange: (v: string) => void }) {
  if (tags.length === 0) return null;
  const atual = tags.find(t => t.id === valor);
  return (
    <div className="relative">
      <select
        value={valor}
        onChange={e => onChange(e.target.value)}
        title="Filtrar por tag"
        className={cn('h-10 appearance-none rounded-lg border border-border bg-card pl-8 pr-7 text-sm font-semibold outline-none transition-colors hover:bg-muted/50', valor ? 'text-foreground' : 'text-muted-foreground')}
      >
        <option value="">Todas as tags</option>
        {tags.map(t => <option key={t.id} value={t.id}>{t.name}{typeof t.lead_count === 'number' ? ` (${t.lead_count})` : ''}</option>)}
      </select>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
        {atual ? <span className="block h-3 w-3 rounded-full" style={{ backgroundColor: atual.color }} /> : <Tag className="h-4 w-4 text-muted-foreground" />}
      </span>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">▾</span>
    </div>
  );
}

/** Configurar as tags do cliente: criar, renomear, recolorir, apagar. */
export function TagsConfigModal({ clientId, tags, onChange, onClose }: {
  clientId: string;
  tags: CrmTag[];
  onChange: (tags: CrmTag[]) => void;
  onClose: () => void;
}) {
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(PALETA_TAGS[0]);
  const [salvando, setSalvando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState('');

  async function criar() {
    const n = nome.trim();
    if (!n) return;
    setSalvando(true);
    try {
      const r = await fetch('/api/crm/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, name: n, color: cor }) });
      const j = await r.json().catch(() => ({})) as CrmTag & { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível criar a tag.');
      // POST em nome repetido devolve a existente: não duplicar na lista
      onChange(tags.some(t => t.id === j.id) ? tags.map(t => (t.id === j.id ? { ...t, ...j } : t)) : [...tags, { ...j, lead_count: 0 }].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
      setNome('');
      setCor(PALETA_TAGS[(PALETA_TAGS.indexOf(cor) + 1) % PALETA_TAGS.length]);
    } catch (e) {
      notificar(e instanceof Error ? e.message : 'Erro ao criar a tag.', 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function alterar(id: string, mudanca: { name?: string; color?: string }) {
    const antes = tags;
    onChange(tags.map(t => (t.id === id ? { ...t, ...mudanca } : t)));
    try {
      const r = await fetch(`/api/crm/tags/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mudanca) });
      const j = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'Não foi possível alterar a tag.');
    } catch (e) {
      onChange(antes);
      notificar(e instanceof Error ? e.message : 'Erro ao alterar a tag.', 'erro');
    }
  }

  async function apagar(t: CrmTag) {
    const n = t.lead_count ?? 0;
    if (!window.confirm(n > 0 ? `Apagar a tag "${t.name}"? Ela será removida de ${n} lead${n === 1 ? '' : 's'}.` : `Apagar a tag "${t.name}"?`)) return;
    const antes = tags;
    onChange(tags.filter(x => x.id !== t.id));
    try {
      const r = await fetch(`/api/crm/tags/${t.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Não foi possível apagar a tag.');
    } catch (e) {
      onChange(antes);
      notificar(e instanceof Error ? e.message : 'Erro ao apagar a tag.', 'erro');
    }
  }

  function confirmarRenome(t: CrmTag) {
    const n = nomeEdit.trim();
    setEditando(null);
    if (n && n !== t.name) void alterar(t.id, { name: n });
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold"><Tag className="h-4 w-4 text-primary" /> Tags de qualificação</h2>
            <p className="text-[11px] text-muted-foreground">Procedimento, produto, momento… o que ajudar a qualificar o lead.</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Fechar"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-2 border-b border-border px-4 py-3">
          <div className="flex gap-2">
            <input
              value={nome}
              onChange={e => setNome(e.target.value.slice(0, NOME_TAG_MAX))}
              onKeyDown={e => { if (e.key === 'Enter') void criar(); }}
              placeholder="Nova tag (ex.: Implante, Convênio, Urgência)"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <button type="button" onClick={() => void criar()} disabled={salvando || !nome.trim()}
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50">
              <Plus className="h-4 w-4" /> Criar
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {PALETA_TAGS.map(c => (
              <button key={c} type="button" onClick={() => setCor(c)} title={c} aria-label={`Cor ${c}`}
                className={cn('h-5 w-5 rounded-full border-2 transition-transform', cor === c ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105')}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
          {tags.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nenhuma tag ainda. Crie a primeira acima.</p>}
          {tags.map(t => (
            <div key={t.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
              <CorDaTag cor={t.color} onChange={c => void alterar(t.id, { color: c })} />
              {editando === t.id ? (
                <input
                  autoFocus
                  value={nomeEdit}
                  onChange={e => setNomeEdit(e.target.value.slice(0, NOME_TAG_MAX))}
                  onBlur={() => confirmarRenome(t)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarRenome(t); if (e.key === 'Escape') setEditando(null); }}
                  className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                />
              ) : (
                <button type="button" onClick={() => { setEditando(t.id); setNomeEdit(t.name); }} title="Clique para renomear"
                  className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline">
                  {t.name}
                </button>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">{t.lead_count ?? 0} lead{(t.lead_count ?? 0) === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => void apagar(t)} title="Apagar tag" aria-label={`Apagar ${t.name}`}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100 max-md:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CorDaTag({ cor, onChange }: { cor: string; onChange: (c: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setAberto(v => !v)} title="Trocar a cor" aria-label="Trocar a cor"
        className="h-5 w-5 rounded-full border border-white/20" style={{ backgroundColor: cor }} />
      {aberto && (
        <div className="absolute left-0 top-7 z-10 grid w-36 grid-cols-6 gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
          {PALETA_TAGS.map(c => (
            <button key={c} type="button" onClick={() => { onChange(c); setAberto(false); }} aria-label={`Cor ${c}`}
              className={cn('h-5 w-5 rounded-full border-2', c === cor ? 'border-foreground' : 'border-transparent')} style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
    </div>
  );
}
