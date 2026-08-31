"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Search } from 'lucide-react';
import { ClientAvatar } from '@/components/client-avatar';
import { useClients } from '@/lib/client-store';
import { normalizeClientName } from '@/lib/client-name';
import { cn } from '@/lib/utils';

/**
 * Troca de cliente a partir do avatar do cabeçalho — sem voltar pra lista.
 *
 * A aba atual viaja junto (`?tab=`), então dá pra comparar o mesmo painel de
 * dois clientes em sequência. Quem lê esse parâmetro é o inicializador de
 * `tab` na página do cliente.
 *
 * ⚠️ A troca depende do `template.tsx` deste segmento para REMONTAR a página:
 * sem ele, o estado client-side preso ao cliente anterior (planejamento,
 * blocos do dashboard, categoria) sobreviveria à navegação e apareceria —
 * ou pior, seria salvo — no cliente novo.
 *
 * ⚠️ Dropdown na mão (backdrop `fixed inset-0` + `absolute`), NÃO o Popover do
 * Base UI: aberto por CLIQUE ele mantém o foco no gatilho de propósito (o
 * FloatingFocusManager roda não-modal), e nem `autoFocus`, nem `initialFocus`,
 * nem `focus()` em rAF colocavam o cursor na busca — medido no browser, o que
 * o gestor digitava se perdia. Aqui o `autoFocus` do input simplesmente vale.
 */
export function ClientSwitcher({
  currentId,
  currentName,
  tab,
}: {
  currentId: string;
  currentName: string;
  /** Aba aberta agora; preservada ao trocar de cliente. */
  tab?: string;
}) {
  const router = useRouter();
  const { clients, allClients } = useClients();
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [cursor, setCursor] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);

  const opcoes = useMemo(() => {
    // `clients` já exclui arquivado/inativo. O cliente ABERTO entra de todo
    // jeito: dá pra chegar num arquivado por link direto, e ele sumir da
    // própria lista faria parecer que a troca quebrou.
    const base = [...clients];
    if (!base.some((c) => c.id === currentId)) {
      const atual = allClients.find((c) => c.id === currentId);
      if (atual) base.push(atual);
    }
    return base.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [clients, allClients, currentId]);

  const filtrados = useMemo(() => {
    const q = normalizeClientName(busca);
    if (!q) return opcoes;
    return opcoes.filter((c) =>
      normalizeClientName(`${c.name} ${c.category_name ?? ''} ${c.segment ?? ''}`).includes(q),
    );
  }, [opcoes, busca]);

  // Esc fecha de qualquer lugar (o foco pode estar num item da lista).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function abrir() {
    // Reabrir com a busca do uso anterior esconderia metade da carteira.
    setBusca('');
    setCursor(0);
    setOpen(true);
  }

  function irPara(clienteId: string) {
    setOpen(false);
    if (clienteId === currentId) return;
    router.push(`/clientes/${clienteId}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
  }

  function mover(delta: number) {
    setCursor((c) => {
      const proximo = Math.min(Math.max(c + delta, 0), Math.max(filtrados.length - 1, 0));
      listaRef.current?.querySelectorAll('[data-opcao]')[proximo]?.scrollIntoView({ block: 'nearest' });
      return proximo;
    });
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : abrir())}
        title="Trocar de cliente"
        aria-label="Trocar de cliente"
        aria-expanded={open}
        className="group relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <ClientAvatar clientId={currentId} name={currentName} size="lg" />
        <span className={cn(
          'pointer-events-none absolute inset-0 rounded-full ring-2 transition-colors',
          open ? 'ring-primary/60' : 'ring-transparent group-hover:ring-primary/60',
        )} />
        <span className={cn(
          'pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-card transition-colors',
          open ? 'border-primary/50 text-primary' : 'border-border text-muted-foreground group-hover:border-primary/50 group-hover:text-primary',
        )}>
          <ChevronsUpDown className="h-3 w-3" />
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg">
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => { setBusca(e.target.value); setCursor(0); }}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); mover(1); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); mover(-1); }
                    if (e.key === 'Enter' && filtrados[cursor]) { e.preventDefault(); irPara(filtrados[cursor].id); }
                  }}
                  placeholder="Buscar cliente..."
                  className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
            </div>

            <div ref={listaRef} className="max-h-72 overflow-y-auto p-1">
              {filtrados.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
              ) : (
                filtrados.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    data-opcao
                    onClick={() => irPara(c.id)}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                      i === cursor && 'bg-muted/60',
                      c.id === currentId && 'bg-primary/10',
                    )}
                  >
                    <ClientAvatar clientId={c.id} name={c.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className={cn(
                        'block truncate text-sm',
                        c.id === currentId ? 'font-bold text-primary' : 'text-foreground',
                      )}>
                        {c.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {c.category_name ?? c.segment ?? '—'}
                      </span>
                    </span>
                    {c.id === currentId && (
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-primary">atual</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
