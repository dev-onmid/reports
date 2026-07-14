"use client";

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { SEV_HEX, type AccountOption } from '@/lib/optimizer-ui';

// Rail de contas — troca instantânea (chips sempre visíveis com dot de saúde + busca + scroll).
export function AccountRail({ contas, value, onChange }: {
  contas: AccountOption[];
  value: string;
  onChange: (clienteId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? contas.filter((c) => c.cliente_nome.toLowerCase().includes(q)) : contas;
  }, [contas, query]);

  const scrollBy = (dir: -1 | 1) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  const arrow: CSSProperties = {
    display: 'flex', width: 28, height: 28, flex: 'none', alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, border: '0.5px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--surface-1)',
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-44 shrink-0">
        <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente..."
          style={{
            height: 28, width: '100%', paddingLeft: 26, paddingRight: 10, fontSize: 11,
            background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', outline: 'none',
          }}
        />
      </div>
      <button onClick={() => scrollBy(-1)} className="hidden sm:flex" style={arrow} aria-label="Rolar contas para a esquerda"><ChevronLeft size={14} /></button>
      <div ref={scrollRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {filtered.map((c) => {
          const active = c.cliente_id === value;
          const dot = c.tem_analise ? SEV_HEX[c.pior_severidade] : 'var(--text-muted)';
          return (
            <button
              key={c.cliente_id}
              onClick={() => onChange(c.cliente_id)}
              title={c.cliente_nome}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flex: 'none', whiteSpace: 'nowrap',
                padding: '4px 10px', borderRadius: 20, fontSize: 11,
                background: active ? 'var(--bg-success)' : 'transparent',
                border: `0.5px solid ${active ? 'var(--border-success)' : 'var(--border)'}`,
                color: active ? 'var(--text-success)' : 'var(--text-secondary)',
                fontWeight: active ? 500 : 400,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flex: 'none' }} />
              <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cliente_nome}</span>
              {c.tem_analise && c.pendencias > 0 && (
                <span style={{ padding: '1px 6px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: active ? 'var(--bg-success)' : 'var(--surface-1)', color: active ? 'var(--text-success)' : 'var(--text-muted)' }}>
                  {c.pendencias}
                </span>
              )}
              {!c.tem_analise && <span style={{ fontSize: 9, color: 'var(--text-muted)', border: '0.5px solid var(--border)', borderRadius: 999, padding: '0 5px' }}>novo</span>}
            </button>
          );
        })}
        {filtered.length === 0 && <span style={{ padding: '0 8px', fontSize: 11, color: 'var(--text-muted)' }}>Nenhum cliente encontrado.</span>}
      </div>
      <button onClick={() => scrollBy(1)} className="hidden sm:flex" style={arrow} aria-label="Rolar contas para a direita"><ChevronRight size={14} /></button>
    </div>
  );
}
