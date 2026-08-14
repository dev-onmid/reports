// Primitivos compartilhados dos blocos do dashboard de Delivery.
//
// Refatorados do protótipo `docs/dashboard-delivery-v4.jsx`: o objeto `C` de
// constantes hex foi eliminado e tudo passou a usar os tokens do design system
// (bg-card, text-primary, border-border, rounded-[var(--radius)]).
//
// Server-safe: nenhum destes tem estado. Só o Heatmap precisa de "use client".

import type { LucideIcon } from 'lucide-react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { CLASSE_TEXTO, type TomGrafico } from '@/types/dashboard';
import { cn } from '@/lib/utils';

/** Travessão do design system para métrica sem fonte. Nunca 0, nunca 0%. */
export const SEM_DADO = '—';

const nf = new Intl.NumberFormat('pt-BR');
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Formatação centralizada — nada de `toFixed` espalhado pelos componentes. */
export const fmt = {
  int: (v: number | null) => (v === null ? SEM_DADO : nf.format(Math.round(v))),
  brl: (v: number | null) =>
    v === null ? SEM_DADO
      : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }),
  /** Recebe FRAÇÃO (0.036 → "3,6%"). */
  pct: (v: number | null) => (v === null ? SEM_DADO : `${nf1.format(v * 100)}%`),
  mult: (v: number | null) => (v === null ? SEM_DADO : `${nf1.format(v)}x`),
  compacto: (v: number | null) =>
    v === null ? SEM_DADO
      : v >= 1e6 ? `${nf1.format(v / 1e6)}M`
      : v >= 1000 ? `${nf1.format(v / 1000)}k`
      : nf.format(Math.round(v)),
};

export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('text-[10px] font-bold uppercase tracking-widest text-muted-foreground', className)}>
      {children}
    </p>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative rounded-[var(--radius)] border border-border bg-card p-4', className)}>
      {children}
    </div>
  );
}

/** Quadrado com ícone. A cor vem de um tom do design system, não de hex. */
export function IconTile({ icon: Icon, tom = 'primary', size = 32 }: {
  icon: LucideIcon; tom?: TomGrafico; size?: number;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[var(--radius)] border bg-current/10 border-current/25',
        CLASSE_TEXTO[tom],
      )}
      style={{ width: size, height: size }}
    >
      <Icon style={{ width: size * 0.45, height: size * 0.45 }} />
    </div>
  );
}

/**
 * Selo de variação. `null` vira travessão — variação sem base anterior não é
 * "+0%", é desconhecida.
 */
export function Delta({ valor, menorMelhor, small }: {
  valor: number | null; menorMelhor?: boolean; small?: boolean;
}) {
  if (valor === null) {
    return <span className={cn('text-muted-foreground', small ? 'text-[10px]' : 'text-xs')}>{SEM_DADO}</span>;
  }
  const subiu = valor >= 0;
  const bom = menorMelhor ? !subiu : subiu;
  const Icone = subiu ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[var(--radius)] border px-1.5 py-px font-bold',
        small ? 'text-[10px]' : 'text-xs',
        bom ? 'text-primary border-primary/40 bg-primary/10' : 'text-destructive border-destructive/40 bg-destructive/10',
      )}
    >
      <Icone className="h-3 w-3" />
      {(subiu ? '+' : '') + nf1.format(valor * 100)}%
    </span>
  );
}

/** Sparkline. Menos de 2 pontos não desenha — linha de um ponto é ruído. */
export function Spark({ dados, tom = 'primary', altura = 30 }: {
  dados: number[]; tom?: TomGrafico; altura?: number;
}) {
  if (!dados || dados.length < 2) return null;
  const w = 100;
  const min = Math.min(...dados);
  const max = Math.max(...dados);
  const span = max - min || 1;
  const pts = dados.map((v, i) => [
    (i / (dados.length - 1)) * w,
    altura - ((v - min) / span) * (altura - 4) - 2,
  ]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${altura}`}
      className={cn('w-full', CLASSE_TEXTO[tom])}
      style={{ height: altura }}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={`${d} L${w} ${altura} L0 ${altura} Z`} fill="currentColor" fillOpacity={0.16} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Estado vazio explícito — usado por todo bloco sem fonte. */
export function BlocoVazio({ titulo, oQueFalta, comoLigar }: {
  titulo?: string; oQueFalta: string; comoLigar?: string;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border bg-surface-elevated px-4 py-6 text-center">
      {titulo && <Label className="mb-1">{titulo}</Label>}
      <p className="text-[13px] text-foreground">{oQueFalta}</p>
      {comoLigar && <p className="mt-1 text-[11px] text-muted-foreground">{comoLigar}</p>}
    </div>
  );
}
