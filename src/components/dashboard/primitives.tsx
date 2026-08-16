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

export function Label({ children, className, style }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <p className={cn('text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]', className)} style={style}>
      {children}
    </p>
  );
}

/**
 * Superfície de um card.
 *
 * `inner` = card DENTRO de um bloco (fundo mais escuro, cantos 12px).
 * `card`  = card solto sobre o fundo da página, com a mesma cara do painel de
 *           Faturamento.
 *
 * ⚠️ Com a grade por elemento, cada métrica virou um card SOLTO. Mantê-las na
 * superfície `inner` (#071014, quase igual ao fundo da página) faria a métrica
 * parecer um buraco em vez de um card — por isso a variante existe.
 */
export type Superficie = 'inner' | 'card';

export const CLASSE_SUPERFICIE: Record<Superficie, string> = {
  inner: 'rounded-[12px] border border-white/[0.08] bg-[#071014]',
  card: 'rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 shadow-[0_18px_60px_rgba(0,0,0,0.28)]',
};

export function InnerCard({ children, className, style, superficie = 'inner' }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties; superficie?: Superficie;
}) {
  return (
    <div className={cn(CLASSE_SUPERFICIE[superficie], 'p-4', className)} style={style}>
      {children}
    </div>
  );
}

/**
 * Superfície de bloco.
 *
 * ⚠️ Alinhada ao card de Faturamento do dashboard premium, que é o PADRÃO REAL
 * da tela (decisão do Matheus). Isso diverge do DESIGN_SYSTEM.md, que prescreve
 * `--radius` (2px) e `--card` (#1a1a1a) — o documento está desatualizado para o
 * dashboard. Antes daqui, Vendas e Faturamento tinham cantos, fundo e sombra
 * diferentes lado a lado na mesma tela.
 */
export function Card({ children, className, style }: {
  children: React.ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <section className={cn('relative', CLASSE_SUPERFICIE.card, 'p-5', className)} style={style}>
      {children}
    </section>
  );
}

/** Ícone em círculo — mesmo formato do card de Faturamento (era quadrado). */
export function IconTile({ icon: Icon, tom = 'primary', size = 40, cor }: {
  icon: LucideIcon; tom?: TomGrafico; size?: number;
  /** Hex livre vindo do inspetor. Quando presente, ignora o `tom`. */
  cor?: string | null;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border bg-current/10 border-current/20',
        // A classe do tom só entra sem cor custom — senão as duas brigariam e a
        // do Tailwind venceria por especificidade.
        !cor && CLASSE_TEXTO[tom],
      )}
      style={{ width: size, height: size, ...(cor ? { color: cor } : {}) }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} />
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
