"use client";

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { PREMIUM, SEV_HEX, type AccountOption } from '@/lib/optimizer-ui';

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
    display: 'flex', width: 34, height: 40, flex: 'none', alignItems: 'center', justifyContent: 'center',
    borderRadius: 10, border: `1px solid ${PREMIUM.border}`, color: PREMIUM.txt3, background: PREMIUM.surf,
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-52 shrink-0">
        <Search size={14} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: PREMIUM.txt3 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente..."
          style={{
            height: 40, width: '100%', paddingLeft: 33, paddingRight: 12, fontSize: 13,
            background: PREMIUM.surf, border: `1px solid ${PREMIUM.border}`, borderRadius: 10, color: PREMIUM.txt, outline: 'none',
          }}
        />
      </div>
      <button onClick={() => scrollBy(-1)} className="hidden sm:flex" style={arrow} aria-label="Rolar contas para a esquerda"><ChevronLeft size={16} /></button>
      <div ref={scrollRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {filtered.map((c) => {
          const active = c.cliente_id === value;
          const dot = c.tem_analise ? SEV_HEX[c.pior_severidade] : PREMIUM.txt3;
          return (
            <button
              key={c.cliente_id}
              onClick={() => onChange(c.cliente_id)}
              title={c.cliente_nome}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, flex: 'none', whiteSpace: 'nowrap',
                padding: '8px 13px', borderRadius: 999, fontSize: 13,
                background: active ? 'rgba(85,245,47,0.12)' : PREMIUM.surf,
                border: `1px solid ${active ? 'rgba(85,245,47,0.4)' : PREMIUM.border}`,
                color: active ? PREMIUM.green : PREMIUM.txt2,
                fontWeight: active ? 600 : 400,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: 'none', boxShadow: c.tem_analise && c.pior_severidade !== 'ok' ? `0 0 6px ${dot}` : 'none' }} />
              <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cliente_nome}</span>
              {c.tem_analise && c.pendencias > 0 && (
                <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 11, fontWeight: 600, background: active ? 'rgba(85,245,47,0.2)' : 'rgba(255,255,255,0.06)', color: active ? PREMIUM.green : PREMIUM.txt3 }}>
                  {c.pendencias}
                </span>
              )}
              {!c.tem_analise && <span style={{ fontSize: 10, color: PREMIUM.txt3, border: `1px solid ${PREMIUM.border}`, borderRadius: 999, padding: '0 6px' }}>novo</span>}
            </button>
          );
        })}
        {filtered.length === 0 && <span style={{ padding: '0 8px', fontSize: 12, color: PREMIUM.txt3 }}>Nenhum cliente encontrado.</span>}
      </div>
      <button onClick={() => scrollBy(1)} className="hidden sm:flex" style={arrow} aria-label="Rolar contas para a direita"><ChevronRight size={16} /></button>
    </div>
  );
}
