'use client';

// Gráficos do painel "Landing page" (GA4): sparkline dos KPIs e evolução diária.
// Só apresentação — recebe a série `diario` pronta (ver src/lib/ga4-landing.ts).

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Ga4Dia } from '@/lib/ga4-landing';

const VERDE = '#6cff2f';
const AZUL = '#3987e5';
const GRID = 'rgba(255,255,255,0.06)';
const EIXO = '#7c868c';

const tooltipStyle = {
  contentStyle: { background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#f4f7f8', fontWeight: 700 },
  itemStyle: { color: '#dce4e8' },
};

const inteiro = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');
const compacto = (n: number) => n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function ddmm(iso: string) {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/**
 * Sparkline em SVG puro (sem eixo, sem tooltip): só a forma da série no
 * período. Base fixa em 0 — linha "subindo" a partir de um mínimo arbitrário
 * exageraria a variação. Menos de 2 pontos = nada.
 */
export function Sparkline({ valores, cor = VERDE, altura = 36 }: { valores: number[]; cor?: string; altura?: number }) {
  if (valores.length < 2) return null;
  const max = Math.max(1, ...valores);
  const w = 100;
  const pts = valores.map((v, i) => [(i / (valores.length - 1)) * w, altura - (v / max) * (altura - 2) - 1] as const);
  const linha = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `0,${altura} ${linha} ${w},${altura}`;
  const id = `spk-${cor.replace('#', '')}`;
  return (
    <svg viewBox={`0 0 ${w} ${altura}`} preserveAspectRatio="none" className="block w-full" style={{ height: altura }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cor} stopOpacity={0.28} />
          <stop offset="100%" stopColor={cor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={linha} fill="none" stroke={cor} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Evolução diária: sessões (área) e contatos (eventos-chave do GA4).
 * Sem eixo duplo, de propósito: se as grandezas são comparáveis (contatos ≥ 25%
 * do pico de sessões), vão juntas no mesmo eixo (contatos em barras); senão,
 * dois gráficos empilhados com o mesmo eixo X (sessões em cima, contatos
 * embaixo), cada um com a própria escala começando em 0.
 */
export function EvolucaoDiaria({ diario }: { diario: Ga4Dia[] }) {
  if (diario.length < 2) return null;
  const dados = diario.map(d => ({ dia: ddmm(d.date), sessoes: d.sessoes, contatos: d.contatos }));
  const maxS = Math.max(0, ...dados.map(d => d.sessoes));
  const maxC = Math.max(0, ...dados.map(d => d.contatos));
  if (maxS + maxC === 0) return null;
  const comparaveis = maxC > 0 && maxC >= maxS * 0.25;
  const xProps = { dataKey: 'dia', tick: { fill: EIXO, fontSize: 10 }, tickLine: false, axisLine: { stroke: GRID }, interval: 'preserveStartEnd' as const, minTickGap: 18 };
  const yProps = { tick: { fill: EIXO, fontSize: 10 }, tickLine: false, axisLine: false, width: 36, domain: [0, 'auto'] as [number, string], allowDecimals: false, tickFormatter: compacto };
  const fmtTooltip = (v: unknown, nome: unknown) => [inteiro(Number(v)), nome === 'sessoes' ? 'Sessões' : 'Contatos (eventos-chave)'] as [string, string];

  const gradiente = (
    <defs>
      <linearGradient id="ga4-sessoes" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={VERDE} stopOpacity={0.35} />
        <stop offset="100%" stopColor={VERDE} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );

  const legenda = (
    <div className="flex flex-wrap items-center gap-3 text-[10px] text-[#9aa4aa]">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: VERDE }} />Sessões</span>
      {maxC > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: AZUL }} />Contatos (eventos-chave)</span>}
    </div>
  );

  if (comparaveis || maxC === 0) {
    return (
      <div className="space-y-2">
        {legenda}
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              {gradiente}
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis {...xProps} />
              <YAxis {...yProps} />
              <Tooltip {...tooltipStyle} formatter={fmtTooltip} />
              <Area type="monotone" dataKey="sessoes" stroke={VERDE} strokeWidth={2} fill="url(#ga4-sessoes)" />
              {maxC > 0 && <Bar dataKey="contatos" fill={AZUL} radius={[3, 3, 0, 0]} maxBarSize={14} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {legenda}
      <div className="h-[150px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados} syncId="ga4-diario" margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            {gradiente}
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis {...xProps} hide />
            <YAxis {...yProps} />
            <Tooltip {...tooltipStyle} formatter={fmtTooltip} />
            <Area type="monotone" dataKey="sessoes" stroke={VERDE} strokeWidth={2} fill="url(#ga4-sessoes)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[100px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} syncId="ga4-diario" margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis {...xProps} />
            <YAxis {...yProps} />
            <Tooltip {...tooltipStyle} formatter={fmtTooltip} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="contatos" fill={AZUL} radius={[3, 3, 0, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
