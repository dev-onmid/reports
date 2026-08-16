// KpiCard · Mini · Tile · Chapter — os blocos de leitura do dashboard de Delivery.
//
// Todos aceitam `estilo` (EstiloElemento) e o aplicam por cima dos padrões. Sem
// isso o inspetor não teria o que controlar: valor fixo no componente não é
// editável. Campo nulo no estilo = herda o padrão, então a tela sem customização
// nenhuma continua exatamente como era.

import type { LucideIcon } from 'lucide-react';
import { InnerCard, Delta, IconTile, Label, Spark, CLASSE_SUPERFICIE, type Superficie } from './primitives';
import { CLASSE_TEXTO, type TomGrafico } from '@/types/dashboard';
import { styleTexto, styleValor, styleFundo, type EstiloElemento } from '@/lib/dashboard-elementos';
import { cn } from '@/lib/utils';

/** Estilo vazio compartilhado — evita criar objeto novo a cada render. */
const VAZIO: EstiloElemento = {};

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
  estilo?: EstiloElemento;
  superficie?: Superficie;
  className?: string;
};

/** KPI principal: valor grande e sparkline dividindo a linha. */
export function KpiCard({ icon, tom = 'primary', label, valor, delta, menorMelhor, spark, sub, estilo = VAZIO, superficie, className }: KpiCardProps) {
  return (
    <InnerCard superficie={superficie} className={className} style={styleFundo(estilo)}>
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tom={tom} size={estilo.tamanhoIcone ?? 32} cor={estilo.corIcone} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Label style={styleTexto(estilo)}>{estilo.texto ?? label}</Label>
            {delta !== undefined && <Delta valor={delta} menorMelhor={menorMelhor} small />}
          </div>
          <div className="mt-1.5 flex items-end gap-3">
            <p className="font-heading text-2xl leading-none text-foreground" style={styleValor(estilo)}>{valor}</p>
            {spark && spark.length > 1 && (
              <div className="min-w-0 flex-1"><Spark dados={spark} tom={tom} altura={26} /></div>
            )}
          </div>
          {sub && <p className="mt-1.5 text-[11px] text-[#9aa4aa]">{sub}</p>}
        </div>
      </div>
    </InnerCard>
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
  estilo?: EstiloElemento;
  superficie?: Superficie;
};

/** Bloco pequeno reaproveitado DENTRO dos cards — é o que evita card vazio. */
export function Mini({ label, valor, sub, icon, tom = 'primary', grande, className, estilo = VAZIO, superficie = 'inner' }: MiniProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5',
        CLASSE_SUPERFICIE[superficie],
        grande ? 'p-4' : 'p-2.5',
        className,
      )}
      style={styleFundo(estilo)}
    >
      {icon && <IconTile icon={icon} tom={tom} size={estilo.tamanhoIcone ?? (grande ? 38 : 28)} cor={estilo.corIcone} />}
      <div className="min-w-0">
        <Label style={styleTexto(estilo)}>{estilo.texto ?? label}</Label>
        <p className={cn('font-heading leading-none text-foreground', grande ? 'text-3xl' : 'text-lg')} style={styleValor(estilo)}>
          {valor}
        </p>
        {sub && <p className="mt-0.5 truncate text-[10px] text-[#9aa4aa]">{sub}</p>}
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
  estilo?: EstiloElemento;
};

/** Célula compacta do resumo de tráfego. */
export function Tile({ icon: Icon, tom = 'primary', label, valor, delta, menorMelhor, nota, estilo = VAZIO }: TileProps) {
  const temDelta = delta !== undefined && delta !== null;
  const bom = temDelta && (menorMelhor ? delta <= 0 : delta >= 0);
  return (
    <div className="min-w-0 rounded-[12px] border border-white/[0.08] bg-[#071014] p-2.5" style={styleFundo(estilo)}>
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn('shrink-0', !estilo.corIcone && CLASSE_TEXTO[tom])}
          style={{
            width: estilo.tamanhoIcone ?? 12,
            height: estilo.tamanhoIcone ?? 12,
            ...(estilo.corIcone ? { color: estilo.corIcone } : {}),
          }}
        />
        <span className="truncate text-[9px] font-black uppercase tracking-[0.07em] text-[#9aa4aa]" style={styleTexto(estilo)}>
          {estilo.texto ?? label}
        </span>
      </div>
      <p className="mt-1.5 font-heading text-2xl leading-none text-foreground" style={styleValor(estilo)}>{valor}</p>
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
  estilo?: EstiloElemento;
};

/** Cabeçalho de capítulo (RESUMO) ou de seção (Vendas, Clientes…). */
export function Chapter({ icon, titulo, sub, tom = 'primary', right, nivel = 'capitulo', estilo = VAZIO }: ChapterProps) {
  const capitulo = nivel === 'capitulo';
  const texto = estilo.texto ?? titulo;
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-4',
        capitulo ? 'mb-4 border-b border-white/[0.08] pb-3' : 'mb-3',
      )}
    >
      <div className="flex items-center gap-3">
        <IconTile icon={icon} tom={tom} size={estilo.tamanhoIcone ?? (capitulo ? 40 : 32)} cor={estilo.corIcone} />
        <div>
          {/* ⚠️ Título de SEÇÃO segue o card de Faturamento — Inter pequena,
              black, caixa alta e tracking largo. Antes usava Bebas text-lg, o
              que fazia "VENDAS" e "FATURAMENTO" parecerem de sistemas
              diferentes lado a lado. Capítulo mantém Bebas grande (RESUMO). */}
          {capitulo ? (
            <h2 className="font-heading text-3xl leading-none text-foreground" style={styleTexto(estilo)}>{texto}</h2>
          ) : (
            <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]" style={styleTexto(estilo)}>{texto}</h3>
          )}
          {sub && <p className="mt-1 text-[11px] text-[#9aa4aa]">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}
