// KpiCard · Mini · Tile · Chapter — os blocos de leitura do dashboard de Delivery.
// Todos presentational e sem estado: recebem props tipadas e renderizam.

import type { LucideIcon } from 'lucide-react';
import { Card, Delta, IconTile, Label, Spark } from './primitives';
import { CLASSE_TEXTO, type TomGrafico } from '@/types/dashboard';
import { cn } from '@/lib/utils';

export type KpiCardProps = {
  icon: LucideIcon;
  tom?: TomGrafico;
  label: string;
  /** Já formatado pelo caller (fmt.brl, fmt.int…) — o card não decide formato. */
  valor: string;
  /** Fração (0.12 = +12%). `null` = sem base de comparação. */
  delta?: number | null;
  menorMelhor?: boolean;
  spark?: number[];
  sub?: string;
};

/** KPI principal: valor grande e sparkline dividindo a linha. */
export function KpiCard({ icon, tom = 'primary', label, valor, delta, menorMelhor, spark, sub }: KpiCardProps) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tom={tom} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Label>{label}</Label>
            {delta !== undefined && <Delta valor={delta} menorMelhor={menorMelhor} small />}
          </div>
          <div className="mt-1.5 flex items-end gap-3">
            <p className="font-heading text-2xl leading-none text-foreground">{valor}</p>
            {spark && spark.length > 1 && (
              <div className="min-w-0 flex-1"><Spark dados={spark} tom={tom} altura={26} /></div>
            )}
          </div>
          {sub && <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
    </Card>
  );
}

export type MiniProps = {
  label: string;
  valor: string;
  sub?: string;
  icon?: LucideIcon;
  tom?: TomGrafico;
  grande?: boolean;
  className?: string;
};

/** Bloco pequeno reaproveitado DENTRO dos cards — é o que evita card vazio. */
export function Mini({ label, valor, sub, icon, tom = 'primary', grande, className }: MiniProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-[var(--radius)] bg-surface-elevated',
        grande ? 'p-4' : 'p-2.5',
        className,
      )}
    >
      {icon && <IconTile icon={icon} tom={tom} size={grande ? 38 : 28} />}
      <div className="min-w-0">
        <Label>{label}</Label>
        <p className={cn('font-heading leading-none text-foreground', grande ? 'text-3xl' : 'text-lg')}>{valor}</p>
        {sub && <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

export type TileProps = {
  icon: LucideIcon;
  tom?: TomGrafico;
  label: string;
  valor: string;
  delta?: number | null;
  menorMelhor?: boolean;
  nota?: string;
};

/** Célula compacta do resumo de tráfego. */
export function Tile({ icon: Icon, tom = 'primary', label, valor, delta, menorMelhor, nota }: TileProps) {
  const temDelta = delta !== undefined && delta !== null;
  const bom = temDelta && (menorMelhor ? delta <= 0 : delta >= 0);
  return (
    <div className="min-w-0 rounded-[var(--radius)] border border-border bg-surface-elevated p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3 w-3 shrink-0', CLASSE_TEXTO[tom])} />
        <span className="truncate text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      </div>
      <p className="mt-1.5 font-heading text-2xl leading-none text-foreground">{valor}</p>
      {temDelta && (
        <p className={cn('mt-1 text-[11px] font-bold', bom ? 'text-primary' : 'text-destructive')}>
          {(delta >= 0 ? '+' : '') + (delta * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
        </p>
      )}
      {nota && <p className="mt-1 text-[11px] font-semibold text-primary">{nota}</p>}
    </div>
  );
}

export type ChapterProps = {
  icon: LucideIcon;
  titulo: string;
  sub?: string;
  tom?: TomGrafico;
  right?: React.ReactNode;
  /** `sub` menor e sem borda — usado dentro de um capítulo. */
  nivel?: 'capitulo' | 'secao';
};

/** Cabeçalho de capítulo (Vendas, Clientes, Funil, Tráfego). */
export function Chapter({ icon, titulo, sub, tom = 'primary', right, nivel = 'capitulo' }: ChapterProps) {
  const capitulo = nivel === 'capitulo';
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-4',
        capitulo ? 'mb-4 border-b border-border pb-3' : 'mb-3',
      )}
    >
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tom={tom} size={capitulo ? 36 : 28} />
        <div>
          <h2 className={cn('font-heading leading-none text-foreground', capitulo ? 'text-3xl' : 'text-lg')}>
            {titulo}
          </h2>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
