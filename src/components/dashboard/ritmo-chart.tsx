'use client';

import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { Superficie } from './superficie';
import {
  COR_PRIMARIA, COR_SECUNDARIA, COR_REFERENCIA, TRACO_REFERENCIA, TRACO_PROJECAO, ALTURA_GRAFICO, AREA_OPACIDADE,
  eixoXProps, eixoYProps, gradeProps, margemGrafico, tooltipProps, legendaProps,
} from './grafico-estilo';

/**
 * Gráficos de ritmo da Visão geral.
 *
 * Só renderizam com série diária de verdade — sem dado, o componente devolve
 * null (caixa vazia parece número zerado, não dado ausente).
 *
 * Estilo: `grafico-estilo.ts` (o mesmo da Evolução diária da Landing page).
 */

const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const moedaCent = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const inteiro = (n: number) => Math.round(n).toLocaleString('pt-BR');
const compacto = (n: number) => n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function ddmm(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

function Moldura({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <Superficie titulo={titulo} sub={sub}>
      <div className="w-full" style={{ height: ALTURA_GRAFICO }}>{children}</div>
    </Superficie>
  );
}

function Degrade({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={COR_PRIMARIA} stopOpacity={AREA_OPACIDADE.topo} />
        <stop offset="100%" stopColor={COR_PRIMARIA} stopOpacity={AREA_OPACIDADE.base} />
      </linearGradient>
    </defs>
  );
}

/**
 * Acumulado do período contra a linha da meta (meta × dia ÷ dias do mês) e,
 * no mês corrente, a projeção linear até o fim do mês.
 *
 * `dias` = eixo completo (o mês inteiro, no mês corrente); `diario` = valor por
 * dia, com `null` para os dias que ainda não aconteceram.
 */
export function RitmoMesChart({ titulo, sub, dias, diario, metaTotal, formato, projetar, rotuloSerie }: {
  titulo: string;
  sub?: string;
  dias: string[];
  diario: Array<number | null>;
  /** Meta do eixo inteiro (a do mês, no mês corrente; a parcial, nos demais períodos). */
  metaTotal: number;
  formato: 'currency' | 'number';
  /** Desenha a projeção tracejada até o fim do eixo. */
  projetar: boolean;
  rotuloSerie: string;
}) {
  const n = dias.length;
  if (n < 2) return null;
  const ultimoReal = diario.reduce<number>((acc, v, i) => (v !== null ? i : acc), -1);
  if (ultimoReal < 0) return null;
  const acumulado: Array<number | null> = [];
  let soma = 0;
  for (const v of diario) {
    if (v === null) { acumulado.push(null); continue; }
    soma += v;
    acumulado.push(soma);
  }
  if (soma <= 0) return null;
  const totalHoje = acumulado[ultimoReal] ?? 0;
  const ritmoDia = totalHoje / (ultimoReal + 1);
  const dados = dias.map((d, i) => ({
    dia: ddmm(d),
    realizado: acumulado[i],
    meta: metaTotal > 0 ? (metaTotal * (i + 1)) / n : null,
    projecao: projetar && i >= ultimoReal ? ritmoDia * (i + 1) : null,
  }));
  const fmt = formato === 'currency' ? moeda : inteiro;

  return (
    <Moldura titulo={titulo} sub={sub}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={margemGrafico}>
          <Degrade id="ritmo-realizado" />
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="dia" {...eixoXProps} />
          <YAxis
            {...eixoYProps}
            domain={[0, 'auto']}
            width={formato === 'currency' ? 64 : 40}
            tickFormatter={(v: number) => (formato === 'currency' ? `R$ ${compacto(v)}` : compacto(v))}
          />
          <Tooltip
            {...tooltipProps}
            formatter={(v, name) => [v == null ? '—' : fmt(Number(v)), String(name)]}
          />
          <Legend {...legendaProps} />
          {metaTotal > 0 && (
            <Line type="linear" dataKey="meta" name="Meta (linear)" stroke={COR_REFERENCIA} strokeWidth={1.5} strokeDasharray={TRACO_REFERENCIA} dot={false} isAnimationActive={false} />
          )}
          <Area type="monotone" dataKey="realizado" name={rotuloSerie} stroke={COR_PRIMARIA} strokeWidth={2} fill="url(#ritmo-realizado)" dot={false} connectNulls={false} isAnimationActive={false} />
          {projetar && (
            <Line type="linear" dataKey="projecao" name="Projeção" stroke={COR_PRIMARIA} strokeOpacity={0.55} strokeWidth={2} strokeDasharray={TRACO_PROJECAO} dot={false} isAnimationActive={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </Moldura>
  );
}

/** CPL por dia + média móvel de 7 dias + linha da meta de CPL. */
export function CplDiarioChart({ dias, gasto, leads, metaCpl }: {
  dias: string[];
  gasto: number[];
  leads: number[];
  metaCpl: number;
}) {
  const n = dias.length;
  if (n < 2) return null;
  const totalLeads = leads.reduce((s, v) => s + v, 0);
  const totalGasto = gasto.reduce((s, v) => s + v, 0);
  if (totalLeads <= 0 || totalGasto <= 0) return null;
  const dados = dias.map((d, i) => {
    let g = 0, l = 0;
    for (let j = Math.max(0, i - 6); j <= i; j++) { g += gasto[j] ?? 0; l += leads[j] ?? 0; }
    return {
      dia: ddmm(d),
      cpl: (leads[i] ?? 0) > 0 ? (gasto[i] ?? 0) / leads[i] : null,
      media7: l > 0 ? g / l : null,
    };
  });

  return (
    <Moldura titulo="CPL diário" sub="investimento ÷ leads das plataformas · média móvel de 7 dias">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={dados} margin={margemGrafico}>
          <Degrade id="cpl-media7" />
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="dia" {...eixoXProps} />
          <YAxis
            {...eixoYProps}
            domain={[0, 'auto']}
            width={56}
            tickFormatter={(v: number) => `R$ ${compacto(v)}`}
          />
          <Tooltip
            {...tooltipProps}
            formatter={(v, name) => [v == null ? '—' : moedaCent(Number(v)), String(name)]}
          />
          <Legend {...legendaProps} />
          {metaCpl > 0 && (
            <ReferenceLine
              y={metaCpl}
              stroke={COR_REFERENCIA}
              strokeWidth={1.5}
              strokeDasharray={TRACO_REFERENCIA}
              label={{ value: `meta ${moedaCent(metaCpl)}`, fill: COR_REFERENCIA, fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Area type="monotone" dataKey="media7" name="Média 7 dias" stroke={COR_PRIMARIA} strokeWidth={2} fill="url(#cpl-media7)" dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="cpl" name="CPL do dia" stroke={COR_SECUNDARIA} strokeWidth={1.5} dot={{ r: 2, fill: COR_SECUNDARIA, strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Moldura>
  );
}
