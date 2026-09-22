'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

/**
 * Donut de composição (parte do todo). Use só com POUCAS fatias — acima de 6
 * o ângulo deixa de ser comparável; quem chama agrupa a cauda em "Outros".
 * O número do miolo é o total (ou o que `centro` disser), legível sem hover.
 */
export type FatiaDonut = { label: string; valor: number; cor: string };

export function Donut({
  fatias, tamanho = 170, espessura = 30, centroTitulo = 'Total', centroValor, formatar,
}: {
  fatias: FatiaDonut[];
  tamanho?: number;
  espessura?: number;
  centroTitulo?: string;
  centroValor?: string;
  formatar: (n: number) => string;
}) {
  const externo = tamanho / 2 - 4;
  const interno = Math.max(0, externo - espessura);
  const dados = fatias.filter(f => f.valor > 0);
  return (
    <div className="relative mx-auto shrink-0" style={{ width: tamanho, height: tamanho }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={dados}
            dataKey="valor"
            nameKey="label"
            innerRadius={interno}
            outerRadius={externo}
            paddingAngle={0}
            // Anel da própria superfície entre as fatias: sem ele, dois tons
            // vizinhos encostam e a fronteira some.
            stroke="#0d1519"
            strokeWidth={2}
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
          >
            {dados.map(f => <Cell key={f.label} fill={f.cor} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#0b1216', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12 }}
            labelStyle={{ color: '#f4f7f8' }}
            itemStyle={{ color: '#dce4e8' }}
            formatter={(v) => formatar(Number(v))}
          />
        </PieChart>
      </ResponsiveContainer>
      {centroValor && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#9aa4aa]">{centroTitulo}</span>
          <span className="font-heading text-lg leading-tight text-[#f4f7f8]">{centroValor}</span>
        </div>
      )}
    </div>
  );
}
