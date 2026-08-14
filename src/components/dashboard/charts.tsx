"use client";

// Gauge · Ring · Funnel · Heatmap — os gráficos SVG do dashboard de Delivery.
//
// "use client" está aqui por causa do Heatmap, que tem hover. Gauge, Ring e
// Funnel são puros e poderiam ser server components; ficam juntos por coesão de
// arquivo — se um dia pesar, é só separar o Heatmap.
//
// Nenhum hex neste arquivo: a cor vem por `currentColor` a partir dos tons do
// design system.

import { Fragment, useState } from 'react';
import {
  CLASSE_TEXTO, DIAS_SEMANA,
  ETAPAS_CATALOGO, ROTULO_ETAPA_CATALOGO,
  type FunilCatalogo, type Heatmap as HeatmapDados, type TomGrafico,
} from '@/types/dashboard';
import { BlocoVazio, fmt, Label, SEM_DADO } from './primitives';
import { cn } from '@/lib/utils';

// ───────────────────────────────────────────────────────────── Gauge

export function Gauge({ valor, max, tom = 'primary', unidade, legenda, size = 132 }: {
  valor: number | null; max: number; tom?: TomGrafico;
  unidade: string; legenda: string; size?: number;
}) {
  const p = valor === null || max <= 0 ? 0 : Math.max(0, Math.min(1, valor / max));
  const A0 = Math.PI * 0.78;
  const A1 = Math.PI * 2.22;
  const cx = size / 2, cy = size / 2, r = size / 2 - 11;
  const pt = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M${x0} ${y0} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }} className={CLASSE_TEXTO[tom]}>
      <path d={arc(A0, A1)} fill="none" strokeWidth="9" className="stroke-border" />
      {p > 0 && <path d={arc(A0, A0 + (A1 - A0) * p)} fill="none" stroke="currentColor" strokeWidth="9" />}
      {[0.25, 0.5, 0.75].map((t) => {
        const a = A0 + (A1 - A0) * t;
        const [x, y] = pt(a);
        return (
          <line key={t} x1={x} y1={y} x2={cx + (r - 12) * Math.cos(a)} y2={cy + (r - 12) * Math.sin(a)}
            strokeWidth="2" className="stroke-background" />
        );
      })}
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={size * 0.26} className="fill-foreground font-heading">
        {unidade}
      </text>
      <text x={cx} y={cy + 19} textAnchor="middle" fontSize="7.5" fontWeight="700" letterSpacing="1.4"
        className="fill-muted-foreground">
        {legenda}
      </text>
    </svg>
  );
}

// ───────────────────────────────────────────────────────────── Ring

export function Ring({ proporcao, tom = 'primary', size = 46, children }: {
  proporcao: number; tom?: TomGrafico; size?: number; children?: React.ReactNode;
}) {
  const r = size / 2 - 3.5;
  const circ = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, proporcao || 0));
  return (
    <div className={cn('relative shrink-0', CLASSE_TEXTO[tom])} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3.5" className="stroke-border" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="3.5"
          strokeDasharray={`${circ * p} ${circ}`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── Funnel

const TOM_ETAPA: Record<string, TomGrafico> = {
  acessos: 'blue', viuItens: 'blue', carrinho: 'secondary', checkout: 'orange', pedidos: 'primary',
};

/**
 * Funil do catálogo.
 *
 * ⚠️ Etapa com valor `null` NÃO é desenhada como zero — vira um degrau vazado
 * rotulado "sem medição". Desenhar zero faria o funil parecer que os clientes
 * abandonaram, quando na verdade nós é que não medimos.
 */
export function Funnel({ funil, alto }: { funil: FunilCatalogo; alto?: boolean }) {
  const medidas = ETAPAS_CATALOGO.filter((e) => funil[e] !== null);
  if (medidas.length === 0) {
    return (
      <BlocoVazio
        oQueFalta="Nenhuma etapa do funil do catálogo está sendo medida no período."
        comoLigar="Exige instrumentar o catálogo digital (acessos, visualização de item, carrinho e checkout)."
      />
    );
  }

  const topo = funil[medidas[0]] ?? 1;
  const W = 340, H = 300;
  const alturaEtapa = H / ETAPAS_CATALOGO.length;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: alto ? 560 : 300 }}>
        {ETAPAS_CATALOGO.map((etapa, i) => {
          const v = funil[etapa];
          const prox = ETAPAS_CATALOGO[i + 1] ? funil[ETAPAS_CATALOGO[i + 1]] : null;
          const larg = v === null ? W * 0.30 : (v / topo) * (W * 0.80);
          const largProx = prox === null ? larg * 0.9 : (prox / topo) * (W * 0.80);
          const y = i * alturaEtapa, y2 = y + alturaEtapa - 5, cx = W * 0.44;
          const pts = [
            [cx - larg / 2, y], [cx + larg / 2, y],
            [cx + largProx / 2, y2], [cx - largProx / 2, y2],
          ].map((p) => p.join(',')).join(' ');
          const semDado = v === null;
          return (
            <g key={etapa} className={CLASSE_TEXTO[TOM_ETAPA[etapa] ?? 'primary']}>
              <polygon
                points={pts}
                fill={semDado ? 'none' : 'currentColor'}
                fillOpacity={semDado ? 0 : 0.22}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray={semDado ? '4 3' : undefined}
                strokeOpacity={semDado ? 0.45 : 1}
              />
              <text x={cx} y={y + alturaEtapa / 2 - 2} textAnchor="middle" fontSize="12"
                className="fill-foreground font-heading">
                {semDado ? SEM_DADO : fmt.int(v)}
              </text>
              <text x={cx} y={y + alturaEtapa / 2 + 8} textAnchor="middle" fontSize="5.2" fontWeight="700"
                letterSpacing="0.7" className="fill-muted-foreground">
                {ROTULO_ETAPA_CATALOGO[etapa].toUpperCase()}
              </text>
              <text x={W - 2} y={y + alturaEtapa / 2 + 2} textAnchor="end" fontSize="11"
                className="fill-current font-heading">
                {semDado ? '' : fmt.pct((v as number) / topo)}
              </text>
            </g>
          );
        })}
      </svg>
      {medidas.length < ETAPAS_CATALOGO.length && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Etapas tracejadas não são medidas hoje — não são zero.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── Heatmap

/** Pedidos por dia da semana × faixa de horário. Único componente com estado. */
export function Heatmap({ dados }: { dados: HeatmapDados }) {
  const [hover, setHover] = useState<[number, number] | null>(null);

  if (!dados.faixas.length || dados.max <= 0) {
    return (
      <BlocoVazio
        oQueFalta="Sem pedidos suficientes no período para montar o mapa de horários."
        comoLigar="O mapa usa o horário de cada pedido sincronizado do cardápio digital."
      />
    );
  }

  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: '44px repeat(7,1fr)' }}>
        <div />
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {d}
          </div>
        ))}
        {dados.faixas.map((faixa, fi) => (
          <Fragment key={faixa}>
            <div className="flex items-center justify-end pr-1 text-[10px] text-muted-foreground">{faixa}</div>
            {DIAS_SEMANA.map((_, di) => {
              const v = dados.matriz[fi]?.[di] ?? 0;
              const intensidade = v / dados.max;
              const ativo = hover?.[0] === fi && hover?.[1] === di;
              return (
                <div
                  key={di}
                  onMouseEnter={() => setHover([fi, di])}
                  onMouseLeave={() => setHover(null)}
                  title={`${DIAS_SEMANA[di]} ${faixa}: ${fmt.int(v)} pedidos`}
                  className={cn(
                    'relative h-8 cursor-pointer rounded-[var(--radius)] border transition-transform',
                    ativo ? 'scale-105 border-primary' : 'border-transparent',
                  )}
                  style={{ backgroundColor: `color-mix(in srgb, var(--primary) ${(6 + intensidade * 90).toFixed(0)}%, transparent)` }}
                >
                  <span
                    className={cn(
                      'absolute inset-0 flex items-center justify-center text-[10px] font-bold',
                      intensidade > 0.5 ? 'text-background' : 'text-muted-foreground',
                    )}
                  >
                    {ativo ? fmt.int(v) : ''}
                  </span>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <Label>Menos</Label>
        {[10, 30, 50, 70, 95].map((a) => (
          <span key={a} className="h-2.5 w-5 rounded-[var(--radius)]"
            style={{ backgroundColor: `color-mix(in srgb, var(--primary) ${a}%, transparent)` }} />
        ))}
        <Label>Mais</Label>
      </div>
    </div>
  );
}
