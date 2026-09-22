'use client';

import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts';
import { T } from '@/lib/dashboard-tipografia';

/**
 * Gráficos de ritmo da Visão geral.
 *
 * Só renderizam com série diária de verdade — sem dado, o componente devolve
 * null (caixa vazia parece número zerado, não dado ausente).
 */

const VERDE = '#55f52f';
const CINZA = '#8a959b';
const AZUL = '#3987e5';
const GRID = 'rgba(255,255,255,0.06)';
const EIXO = '#9aa4aa';

const tooltipStyle = {
  contentStyle: { background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 },
  labelStyle: { color: '#f4f7f8', fontWeight: 700 },
  itemStyle: { color: '#dce4e8' },
};

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
    <section className="rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h3 className={T.cardTitulo}>{titulo}</h3>
        {sub && <span className={T.cardSub}>{sub}</span>}
      </div>
      <div className="h-[220px] w-full">{children}</div>
    </section>
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
        <ComposedChart data={dados} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="dia" tick={{ fill: EIXO, fontSize: 10 }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={18} />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: EIXO, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={formato === 'currency' ? 64 : 40}
            tickFormatter={(v: number) => (formato === 'currency' ? `R$ ${compacto(v)}` : compacto(v))}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(v, name) => [v == null ? '—' : fmt(Number(v)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a7b0b6' }} iconType="plainline" />
          {metaTotal > 0 && (
            <Line type="linear" dataKey="meta" name="Meta (linear)" stroke={CINZA} strokeWidth={2} strokeDasharray="2 4" dot={false} isAnimationActive={false} />
          )}
          <Line type="monotone" dataKey="realizado" name={rotuloSerie} stroke={VERDE} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          {projetar && (
            <Line type="linear" dataKey="projecao" name="Projeção" stroke={VERDE} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="6 5" dot={false} isAnimationActive={false} />
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
        <ComposedChart data={dados} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="dia" tick={{ fill: EIXO, fontSize: 10 }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={18} />
          <YAxis
            domain={[0, 'auto']}
            tick={{ fill: EIXO, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={(v: number) => `R$ ${compacto(v)}`}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(v, name) => [v == null ? '—' : moedaCent(Number(v)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: '#a7b0b6' }} iconType="plainline" />
          {metaCpl > 0 && (
            <ReferenceLine
              y={metaCpl}
              stroke="#f5a524"
              strokeDasharray="4 4"
              label={{ value: `meta ${moedaCent(metaCpl)}`, fill: '#f5a524', fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Line type="monotone" dataKey="cpl" name="CPL do dia" stroke={AZUL} strokeOpacity={0.7} strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="media7" name="Média 7 dias" stroke={VERDE} strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </Moldura>
  );
}
