'use client';

import { useId, type CSSProperties, type ElementType, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';
import { SUPERFICIE } from './superficie';
import { COR_PRIMARIA, AREA_OPACIDADE } from './grafico-estilo';

/**
 * Card de KPI ÚNICO do dashboard de geração de leads.
 *
 * Antes eram três modelos (QuickMetricCard no topo, KpiHero na Landing page,
 * IgKpi no Instagram), cada um com ícone, sparkline e espaçamento próprios.
 * Agora todos são este: ícone na cor da seção (verde por padrão, rosa no
 * Instagram), rótulo, número, variação + comparativo, nota opcional e a mesma
 * sparkline (linha fina + área suave na cor do ícone).
 */

export type UnidadeVariacao = '%' | ' p.p.';

/** Texto e cor da variação — cinza quando não há base, é neutra ou arredonda para 0. */
function Variacao({ v, unidade = '%', inverso, neutro }: { v: number | null | undefined; unidade?: UnidadeVariacao; inverso?: boolean; neutro?: boolean }) {
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className={cn(T.delta, 'text-[#a7b0b6]')}>—</span>;
  const arred = Math.round(v * 10) / 10;
  const bom = inverso ? arred <= 0 : arred >= 0;
  const cor = neutro || arred === 0 ? 'text-[#a7b0b6]' : bom ? 'text-[#6cff2f]' : 'text-red-400';
  return (
    <span className={cn(T.delta, 'tabular-nums', cor)}>
      {arred > 0 ? '+' : ''}{arred.toFixed(1).replace('.', ',')}{unidade}
    </span>
  );
}

/** Sparkline sem eixo: linha fina + área suave. Base fixa em 0 (não exagera variação). */
export function Sparkline({ valores, cor = COR_PRIMARIA, altura = 32 }: { valores: number[]; cor?: string; altura?: number }) {
  const id = useId().replace(/:/g, '');
  if (valores.length < 2) return null;
  const max = Math.max(1e-9, ...valores);
  const w = 100;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, altura - (Math.max(0, v) / max) * (altura - 2) - 1] as const);
  const linha = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `0,${altura} ${linha} ${w},${altura}`;
  return (
    <svg viewBox={`0 0 ${w} ${altura}`} preserveAspectRatio="none" className="block w-full" style={{ height: altura }} aria-hidden>
      <defs>
        <linearGradient id={`spk-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity={AREA_OPACIDADE.topo} />
          <stop offset="100%" stopColor={cor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#spk-${id})`} />
      <polyline points={linha} fill="none" stroke={cor} strokeOpacity={0.9} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Caixa do ícone na cor da seção. `cor` precisa ser hex de 6 dígitos (recebe alfa). */
export function IconeBadge({ icone: Icon, cor = COR_PRIMARIA, tamanho }: { icone: ElementType; cor?: string; tamanho?: number }) {
  return (
    <span
      className={cn(T.iconeCaixa, 'border')}
      style={{ color: cor, borderColor: `${cor}40`, background: `${cor}1a`, ...(tamanho ? { width: tamanho, height: tamanho } : {}) }}
    >
      <Icon className={tamanho ? undefined : T.icone} style={tamanho ? { width: tamanho * 0.5, height: tamanho * 0.5 } : undefined} />
    </span>
  );
}

export function IndicadorCard({
  rotulo, valor, icone, cor = COR_PRIMARIA, variacao, unidade = '%', inverso, neutro, comparacao,
  nota, notaRuim, serie, dica, className, style, estiloRotulo, estiloValor, tamanhoIcone,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  icone: ElementType;
  /** Cor do ícone e da sparkline (hex de 6 dígitos). Padrão: verde. */
  cor?: string;
  /** Variação em % (ou p.p. com `unidade`). null = sem base de comparação; undefined = não mostra a linha. */
  variacao?: number | null;
  unidade?: UnidadeVariacao;
  /** Cair é bom (CPL, custo). */
  inverso?: boolean;
  /** Sem direção boa/ruim (investimento): variação em cinza. */
  neutro?: boolean;
  /** "vs 1–22/ago", "vs período anterior". */
  comparacao?: string;
  nota?: ReactNode;
  /** Pinta a nota de vermelho (ex.: perdeu seguidores). */
  notaRuim?: boolean;
  /** Série diária da sparkline; omitida (ou toda zero) = sem gráfico. */
  serie?: number[];
  /** Tooltip do rótulo/valor (como o número é calculado). */
  dica?: string;
  className?: string;
  style?: CSSProperties;
  /** Overrides do modelo por segmento (food). */
  estiloRotulo?: CSSProperties;
  estiloValor?: CSSProperties;
  tamanhoIcone?: number;
}) {
  const temSerie = !!serie && serie.length >= 2 && serie.some(v => v > 0);
  const mostraVariacao = variacao !== undefined || !!comparacao;
  return (
    <div className={cn(SUPERFICIE, 'flex h-full flex-col p-4', className)} style={style}>
      <div className="flex items-center gap-2.5">
        <IconeBadge icone={icone} cor={cor} tamanho={tamanhoIcone} />
        <p className={cn('flex min-w-0 flex-1 items-center gap-1', T.kpiRotulo)} style={estiloRotulo} title={dica}>
          <span className="line-clamp-2 min-w-0 leading-tight">{rotulo}</span>
          {dica && <Info className="h-3 w-3 shrink-0 text-[#6c767c]" aria-label={dica} />}
        </p>
      </div>
      <p className={cn('mt-3 tabular-nums', T.kpiValor)} style={estiloValor} title={dica}>{valor}</p>
      {mostraVariacao && (
        <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <Variacao v={variacao} unidade={unidade} inverso={inverso} neutro={neutro} />
          {comparacao && <span className={T.comparacao}>{comparacao}</span>}
        </p>
      )}
      {nota && <p className={cn('mt-1 truncate', T.nota, notaRuim && 'text-red-400')}>{nota}</p>}
      {temSerie && (
        <div className="mt-auto pt-3">
          <Sparkline valores={serie!} cor={cor} />
        </div>
      )}
    </div>
  );
}

/**
 * Faixa compacta de indicadores secundários — UM card, células separadas por
 * fio de 1px. Mesmo estilo na Landing page e no Instagram.
 */
export function FaixaIndicadores({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(SUPERFICIE, 'grid gap-px overflow-hidden bg-white/[0.06]', className)}>
      {children}
    </div>
  );
}

export function IndicadorMini({ rotulo, valor, icone: Icon, cor = COR_PRIMARIA, variacao, unidade = '%', inverso, dica }: {
  rotulo: string;
  valor: ReactNode;
  icone?: ElementType;
  cor?: string;
  variacao?: number | null;
  unidade?: UnidadeVariacao;
  inverso?: boolean;
  dica?: string;
}) {
  return (
    <div className="min-w-0 bg-[#0d1519] px-4 py-3" title={dica}>
      <p className={cn('flex items-center gap-1.5 truncate', T.miniRotulo)}>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cor }} />}
        <span className="truncate">{rotulo}</span>
      </p>
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className={cn('tabular-nums', T.miniValor)}>{valor}</span>
        {variacao !== undefined && <Variacao v={variacao} unidade={unidade} inverso={inverso} />}
      </p>
    </div>
  );
}
