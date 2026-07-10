"use client";

import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEV, type AccountOption } from '@/lib/optimizer-ui';

// Rail de contas — troca instantânea. Em vez de um dropdown que o gestor precisa abrir a cada
// cliente, as contas ficam sempre visíveis em chips com dot de saúde (varre o roster inteiro num
// olhar) e trocam com 1 clique. Contas com pendência/análise vêm primeiro (ordenação já feita em
// accountOptions). Busca estreita a lista quando há muitos clientes; o rail rola na horizontal.
export function AccountRail({ contas, value, onChange }: {
  contas: AccountOption[];
  value: string;
  onChange: (clienteId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contas;
    return contas.filter((c) => c.cliente_nome.toLowerCase().includes(q));
  }, [contas, query]);

  function scrollBy(dir: -1 | 1) {
    scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-52 shrink-0">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente..."
          className="h-10 w-full rounded-[var(--radius)] border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>
      <button onClick={() => scrollBy(-1)} className="hidden h-10 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:text-foreground sm:flex" aria-label="Rolar contas para a esquerda">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div ref={scrollRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {filtered.map((c) => {
          const active = c.cliente_id === value;
          const dot = c.tem_analise ? SEV[c.pior_severidade].dot : 'bg-muted-foreground/50';
          return (
            <button
              key={c.cliente_id}
              onClick={() => onChange(c.cliente_id)}
              title={c.cliente_nome}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground',
              )}
            >
              <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
              <span className="max-w-[180px] truncate">{c.cliente_nome}</span>
              {c.tem_analise && c.pendencias > 0 && (
                <span className={cn('shrink-0 rounded-full px-1.5 text-[10px] font-semibold', active ? 'bg-primary/20 text-primary' : 'bg-background text-muted-foreground')}>
                  {c.pendencias}
                </span>
              )}
              {!c.tem_analise && (
                <span className="shrink-0 rounded-full border border-border bg-background px-1.5 text-[10px] text-muted-foreground">novo</span>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && <span className="px-2 text-xs text-muted-foreground">Nenhum cliente encontrado.</span>}
      </div>
      <button onClick={() => scrollBy(1)} className="hidden h-10 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] border border-border text-muted-foreground hover:text-foreground sm:flex" aria-label="Rolar contas para a direita">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
