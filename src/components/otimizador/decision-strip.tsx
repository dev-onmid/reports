"use client";

import type { CSSProperties } from 'react';
import { ChevronRight, Eye, MinusCircle, PauseCircle, Rocket, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PREMIUM, categoriaDoNode, type Categoria, type NivelFiltro, type TreeNode } from '@/lib/optimizer-ui';

const CARD: Record<'pausar' | 'revisar' | 'manter' | 'escalar', { label: string; icon: LucideIcon; color: string }> = {
  pausar: { label: 'Pausar agora', icon: PauseCircle, color: PREMIUM.red },
  revisar: { label: 'Revisar', icon: Search, color: PREMIUM.amber },
  manter: { label: 'Manter', icon: MinusCircle, color: PREMIUM.emerald },
  escalar: { label: 'Escalar', icon: Rocket, color: PREMIUM.green },
};

// Cards de decisão rápida — contadores clicáveis que filtram a árvore.
export function QuickDecisionCards({ nodes, active, onSelect }: {
  nodes: TreeNode[];
  active: Categoria | null;
  onSelect: (cat: Categoria | null) => void;
}) {
  const counts: Record<Categoria, number> = { pausar: 0, revisar: 0, manter: 0, escalar: 0, investigar: 0, sem_diagnostico: 0 };
  for (const n of nodes) counts[categoriaDoNode(n)]++;
  const grid: Array<'pausar' | 'revisar' | 'manter' | 'escalar'> = ['pausar', 'revisar', 'manter', 'escalar'];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {grid.map((cat) => {
          const meta = CARD[cat];
          const Icon = meta.icon;
          const isActive = active === cat;
          return (
            <button
              key={cat}
              onClick={() => onSelect(isActive ? null : cat)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', textAlign: 'left',
                background: isActive ? `${meta.color}14` : PREMIUM.surf,
                border: `1px solid ${isActive ? `${meta.color}66` : PREMIUM.border}`,
                borderRadius: 12, transition: 'all .15s',
              }}
            >
              <span style={{ display: 'flex', width: 34, height: 34, borderRadius: 9, background: `${meta.color}1f`, color: meta.color, alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                <Icon size={17} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 22, fontWeight: 700, lineHeight: 1, color: PREMIUM.txt }}>{counts[cat]}</span>
                <span style={{ display: 'block', fontSize: 12, color: PREMIUM.txt2, marginTop: 3 }}>{meta.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      {counts.investigar > 0 && (
        <button
          onClick={() => onSelect(active === 'investigar' ? null : 'investigar')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', padding: '10px 14px',
            background: active === 'investigar' ? 'rgba(183,148,255,0.1)' : PREMIUM.surf,
            border: `1px solid ${active === 'investigar' ? 'rgba(183,148,255,0.5)' : PREMIUM.border}`,
            borderRadius: 10, fontSize: 12, color: PREMIUM.txt2,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <Eye size={14} style={{ color: PREMIUM.purple, flex: 'none' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <b style={{ color: PREMIUM.txt }}>{counts.investigar}</b> item(ns) para investigar antes de decidir
            </span>
          </span>
          <ChevronRight size={14} style={{ flex: 'none' }} />
        </button>
      )}
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
    { value: 'todos', label: 'Todos os níveis' },
    { value: 'campaign', label: 'Campanhas' },
    { value: 'adset', label: 'Conjuntos' },
    { value: 'ad', label: 'Criativos' },
  ];
  const chip = (active: boolean): CSSProperties => ({
    padding: '5px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
    background: active ? 'rgba(85,245,47,0.12)' : 'transparent',
    border: `1px solid ${active ? 'rgba(85,245,47,0.4)' : PREMIUM.border}`,
    color: active ? PREMIUM.green : PREMIUM.txt2, transition: 'all .15s',
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opcoes.map((o) => (
        <button key={o.value} onClick={() => onNivel(o.value)} style={chip(nivel === o.value)}>{o.label}</button>
      ))}
      <button onClick={() => onApenasComAcao(!apenasComAcao)} style={chip(apenasComAcao)}>Só com diagnóstico</button>
    </div>
  );
}
