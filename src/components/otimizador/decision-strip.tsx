"use client";

import type { CSSProperties } from 'react';
import { categoriaDoNode, type Categoria, type NivelFiltro, type TreeNode } from '@/lib/optimizer-ui';

const CARD: Record<'pausar' | 'revisar' | 'manter' | 'escalar', { label: string; fg: string; bg: string }> = {
  pausar: { label: 'Pausar agora', fg: 'var(--text-danger)', bg: 'var(--bg-danger)' },
  revisar: { label: 'Revisar', fg: 'var(--text-warning)', bg: 'var(--bg-warning)' },
  manter: { label: 'Manter', fg: 'var(--text-success)', bg: 'var(--bg-success)' },
  escalar: { label: 'Escalar', fg: 'var(--text-accent)', bg: 'var(--bg-accent)' },
};

// Chips de decisão rápida — contadores clicáveis (número + label) que filtram a árvore.
export function QuickDecisionCards({ nodes, active, onSelect }: {
  nodes: TreeNode[];
  active: Categoria | null;
  onSelect: (cat: Categoria | null) => void;
}) {
  const counts: Record<Categoria, number> = { pausar: 0, revisar: 0, manter: 0, escalar: 0, investigar: 0, sem_diagnostico: 0 };
  for (const n of nodes) counts[categoriaDoNode(n)]++;
  const grid: Array<'pausar' | 'revisar' | 'manter' | 'escalar'> = ['pausar', 'revisar', 'manter', 'escalar'];

  return (
    <div className="grid grid-cols-4 gap-[6px]">
      {grid.map((cat) => {
        const meta = CARD[cat];
        const isActive = active === cat;
        return (
          <button
            key={cat}
            onClick={() => onSelect(isActive ? null : cat)}
            style={{
              textAlign: 'center', padding: '7px 8px',
              background: isActive ? meta.bg : 'var(--surface-2)',
              border: `0.5px solid ${isActive ? meta.fg : 'var(--border)'}`,
              borderRadius: 8, transition: 'all .15s',
            }}
          >
            <span style={{ display: 'block', fontSize: 18, fontWeight: 500, lineHeight: 1, color: meta.fg }}>{counts[cat]}</span>
            <span style={{ display: 'block', fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Filtros de nível + "só com diagnóstico".
export function FilterChips({ nivel, onNivel, apenasComAcao, onApenasComAcao }: {
  nivel: NivelFiltro;
  onNivel: (n: NivelFiltro) => void;
  apenasComAcao: boolean;
  onApenasComAcao: (v: boolean) => void;
}) {
  const opcoes: Array<{ value: NivelFiltro; label: string }> = [
    { value: 'todos', label: 'Todos' },
    { value: 'campaign', label: 'Campanhas' },
    { value: 'adset', label: 'Conjuntos' },
    { value: 'ad', label: 'Criativos' },
  ];
  const chip = (active: boolean): CSSProperties => ({
    padding: '3px 8px', borderRadius: 20, fontSize: 10,
    fontWeight: active ? 500 : 400,
    background: 'transparent',
    border: `0.5px solid ${active ? 'var(--border-strong)' : 'var(--border)'}`,
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)', transition: 'all .15s',
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {opcoes.map((o) => (
        <button key={o.value} onClick={() => onNivel(o.value)} style={chip(nivel === o.value)}>{o.label}</button>
      ))}
      <button onClick={() => onApenasComAcao(!apenasComAcao)} style={chip(apenasComAcao)}>Só com diagnóstico</button>
    </div>
  );
}
