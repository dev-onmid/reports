"use client";

import { ChevronRight, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CATEGORIA_META,
  categoriaDoNode,
  type Categoria,
  type NivelFiltro,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Cards de decisão rápida — contadores clicáveis que também filtram a árvore.
export function QuickDecisionCards({ nodes, active, onSelect }: {
  nodes: TreeNode[];
  active: Categoria | null;
  onSelect: (cat: Categoria | null) => void;
}) {
  // "sem_diagnostico" não vira card — ver categoriaDoNode. Só as 5 categorias acionáveis contam.
  const counts: Record<Categoria, number> = { pausar: 0, revisar: 0, manter: 0, escalar: 0, investigar: 0, sem_diagnostico: 0 };
  for (const n of nodes) counts[categoriaDoNode(n)]++;

  const grid4: Array<Exclude<Categoria, 'sem_diagnostico' | 'investigar'>> = ['pausar', 'revisar', 'manter', 'escalar'];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {grid4.map((cat) => {
          const meta = CATEGORIA_META[cat];
          const Icon = meta.icon;
          const isActive = active === cat;
          const descricao = cat === 'pausar' ? 'Impacto alto de desperdício'
            : cat === 'revisar' ? 'Precisam de ajustes'
              : cat === 'manter' ? 'Performando bem'
                : 'Oportunidades de crescimento';
          return (
            <button
              key={cat}
              onClick={() => onSelect(isActive ? null : cat)}
              title={descricao}
              className={cn(
                'group flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2 text-left transition-all',
                meta.tone,
                isActive ? 'ring-1 ring-current' : 'opacity-75 hover:opacity-100',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-lg font-bold leading-none">{counts[cat]}</span>
                <span className="block truncate text-[11px] font-medium leading-tight">{meta.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      {counts.investigar > 0 && (
        <button
          onClick={() => onSelect(active === 'investigar' ? null : 'investigar')}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-[var(--radius)] border px-3 py-2 text-left text-xs transition-colors',
            active === 'investigar' ? CATEGORIA_META.investigar.tone : 'border-secondary/30 bg-secondary/5 text-muted-foreground hover:border-secondary/50',
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <Eye className="h-3.5 w-3.5 shrink-0 text-secondary" />
            <span className="truncate"><span className="font-semibold text-foreground">{counts.investigar}</span> item(ns) para investigar antes de decidir</span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opcoes.map((o) => (
        <button
          key={o.value}
          onClick={() => onNivel(o.value)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            nivel === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30',
          )}
        >
          {o.label}
        </button>
      ))}
      <button
        onClick={() => onApenasComAcao(!apenasComAcao)}
        className={cn(
          'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
          apenasComAcao ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/30',
        )}
      >
        Só com diagnóstico
      </button>
    </div>
  );
}
