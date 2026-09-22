'use client';

// Gráficos do painel "Landing page" (GA4): evolução diária.
// Só apresentação — recebe a série `diario` pronta (ver src/lib/ga4-landing.ts).
// Estilo: `grafico-estilo.ts`, o MESMO do Ritmo do mês e do CPL diário.

import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Ga4Dia } from '@/lib/ga4-landing';
import {
  COR_PRIMARIA, COR_SECUNDARIA, AREA_OPACIDADE, eixoXProps, eixoYProps, gradeProps, margemGrafico, tooltipProps,
} from './grafico-estilo';

/** A sparkline dos KPIs agora é a do IndicadorCard — reexportada por compatibilidade. */
export { Sparkline } from './indicador-card';

const inteiro = (n: number) => Math.round(Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');
const compacto = (n: number) => n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
function ddmm(iso: string) {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

/** Legenda no mesmo tom da Legend do Recharts usada nos outros gráficos (fonte 11, traço de linha). */
function Legenda({ comContatos }: { comContatos: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-[#a7b0b6]">
      <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded" style={{ background: COR_PRIMARIA }} />Sessões</span>
      {comContatos && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 rounded" style={{ background: COR_SECUNDARIA }} />Contatos (eventos-chave)</span>}
    </div>
  );
}

/**
 * Evolução diária: sessões (série primária, linha + área) e contatos
 * (eventos-chave do GA4, série secundária em linha azul).
 * Sem eixo duplo, de propósito: se as grandezas são comparáveis (contatos ≥ 25%
 * do pico de sessões), vão juntas no mesmo eixo; senão, dois gráficos empilhados
 * com o mesmo eixo X (sessões em cima, contatos embaixo), cada um com a própria
 * escala começando em 0 — mesmo estilo nos dois.
 */
export function EvolucaoDiaria({ diario }: { diario: Ga4Dia[] }) {
  if (diario.length < 2) return null;
  const dados = diario.map(d => ({ dia: ddmm(d.date), sessoes: d.sessoes, contatos: d.contatos }));
  const maxS = Math.max(0, ...dados.map(d => d.sessoes));
  const maxC = Math.max(0, ...dados.map(d => d.contatos));
  if (maxS + maxC === 0) return null;
  const comparaveis = maxC > 0 && maxC >= maxS * 0.25;
  const yProps = { ...eixoYProps, width: 36, domain: [0, 'auto'] as [number, string], allowDecimals: false, tickFormatter: compacto };
  const fmtTooltip = (v: unknown, nome: unknown) => [inteiro(Number(v)), nome === 'sessoes' ? 'Sessões' : 'Contatos (eventos-chave)'] as [string, string];

  const gradiente = (
    <defs>
      <linearGradient id="ga4-sessoes" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COR_PRIMARIA} stopOpacity={AREA_OPACIDADE.topo} />
        <stop offset="100%" stopColor={COR_PRIMARIA} stopOpacity={AREA_OPACIDADE.base} />
      </linearGradient>
    </defs>
  );
  const areaSessoes = <Area type="monotone" dataKey="sessoes" stroke={COR_PRIMARIA} strokeWidth={2} fill="url(#ga4-sessoes)" dot={false} isAnimationActive={false} />;
  const linhaContatos = <Line type="monotone" dataKey="contatos" stroke={COR_SECUNDARIA} strokeWidth={1.5} dot={{ r: 2, fill: COR_SECUNDARIA, strokeWidth: 0 }} isAnimationActive={false} />;

  if (comparaveis || maxC === 0) {
    return (
      <div className="space-y-2">
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={dados} margin={margemGrafico}>
              {gradiente}
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="dia" {...eixoXProps} />
              <YAxis {...yProps} />
              <Tooltip {...tooltipProps} formatter={fmtTooltip} />
              {areaSessoes}
              {maxC > 0 && linhaContatos}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <Legenda comContatos={maxC > 0} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-[140px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dados} syncId="ga4-diario" margin={margemGrafico}>
            {gradiente}
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="dia" {...eixoXProps} hide />
            <YAxis {...yProps} />
            <Tooltip {...tooltipProps} formatter={fmtTooltip} />
            {areaSessoes}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[100px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dados} syncId="ga4-diario" margin={margemGrafico}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="dia" {...eixoXProps} />
            <YAxis {...yProps} />
            <Tooltip {...tooltipProps} formatter={fmtTooltip} />
            {linhaContatos}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <Legenda comContatos />
    </div>
  );
}
