"use client";

import { useState } from 'react';

type ScoreDetails = {
  cpl:             { score: number; max: number; current: number; previous: number };
  leads:           { score: number; max: number; current: number; previous: number };
  ctr:             { score: number; max: number; current: number; previous: number };
  frequency:       { score: number; max: number; avg: number; count: number };
  creativeCount:   { score: number; max: number; count: number };
  creativeAge:     { score: number; max: number; avgAge: number; stale: number };
  formatDiversity: { score: number; max: number; formats: string[]; unique: number };
  consistency:     { score: number; max: number; cv: number | null; weeklySpends: number[] };
  budgetPaused:    { score: number; max: number; count: number };
  crmConversion:   { score: number; max: number; rate: number | null; total: number; advanced: number };
  reports:         { score: number; max: number; count: number };
  spend:           { current: number; previous: number };
  convRate:        { current: number; previous: number };
};

type InsightTone = 'red' | 'orange' | 'green';
type ScoreInsight = {
  key: string;
  title: string;
  percent: number;
  tone: InsightTone;
  diagnosis: string;
  action: string;
};

function pct(score: number, max: number) {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}
function avg2(a: number, b: number) { return Math.round((a + b) / 2); }
function avg3(a: number, b: number, c: number) { return Math.round((a + b + c) / 3); }

function radarColor(score: number): string {
  if (score >= 85) return '#22c55e';
  if (score >= 70) return '#3b82f6';
  if (score >= 50) return '#eab308';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

const AXIS_COLORS: Record<string, string> = {
  'Custo/CPL': '#22c55e',
  Volume: '#2f86ff',
  Engajamento: '#8b5cf6',
  Criativos: '#f59e0b',
  'Consistência': '#facc15',
  'Gestão': '#f97316',
};

function buildAxes(d: ScoreDetails) {
  return [
    { label: 'Custo/CPL',    value: pct(d.cpl.score, d.cpl.max) },
    { label: 'Volume',       value: pct(d.leads.score, d.leads.max) },
    { label: 'Engajamento',  value: avg2(pct(d.ctr.score, d.ctr.max), pct(d.frequency.score, d.frequency.max)) },
    { label: 'Criativos',    value: avg3(pct(d.creativeCount.score, d.creativeCount.max), pct(d.creativeAge.score, d.creativeAge.max), pct(d.formatDiversity.score, d.formatDiversity.max)) },
    { label: 'Consistência', value: avg2(pct(d.consistency.score, d.consistency.max), pct(d.budgetPaused.score, d.budgetPaused.max)) },
    { label: 'Gestão',       value: avg2(pct(d.crmConversion.score, d.crmConversion.max), pct(d.reports.score, d.reports.max)) },
  ];
}

const AXIS_LEGEND = [
  { label: 'Custo/CPL', desc: 'Avalia o custo por lead e sua eficiência em gerar resultados com economia.' },
  { label: 'Volume', desc: 'Mede o volume de leads e conversões em relação ao período anterior.' },
  { label: 'Engajamento', desc: 'Analisa cliques, CTR e frequência para qualificar as interações com os anúncios.' },
  { label: 'Criativos', desc: 'Avalia quantidade, idade e diversidade dos criativos em veiculação.' },
  { label: 'Consistência', desc: 'Verifica a regularidade do investimento e estabilidade das campanhas.' },
  { label: 'Gestão', desc: 'Considera a gestão no CRM, revisões e ações tomadas pela equipe.' },
];

function insightTone(percent: number): InsightTone {
  if (percent < 50) return 'red';
  if (percent < 75) return 'orange';
  return 'green';
}

function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function buildInsight(key: string, title: string, percent: number, diagnosis: string, action: string): ScoreInsight {
  return { key, title, percent, tone: insightTone(percent), diagnosis, action };
}

function buildInsights(d: ScoreDetails): ScoreInsight[] {
  const insights = [
    buildInsight('cpl', 'CPL precisa de ajuste', pct(d.cpl.score, d.cpl.max), `CPL atual em ${money(d.cpl.current)}; anterior em ${money(d.cpl.previous)}.`, 'Revise campanhas/adsets caros, pause fontes acima da média e redistribua verba para criativos e públicos com menor CPL.'),
    buildInsight('leads', 'Volume de leads baixo', pct(d.leads.score, d.leads.max), `${d.leads.current} leads no período atual contra ${d.leads.previous} no mês anterior.`, 'Aumente verba nas campanhas que já performam, teste novos públicos e revise oferta, promessa e copy dos anúncios.'),
    buildInsight('ctr', 'CTR abaixo do ideal', pct(d.ctr.score, d.ctr.max), `CTR atual de ${d.ctr.current.toFixed(2)}% contra ${d.ctr.previous.toFixed(2)}% no mês anterior.`, 'Troque gancho, criativo e promessa. Teste variações de headline, imagem ou vídeo com uma chamada mais direta.'),
    buildInsight('frequency', 'Frequência em atenção', pct(d.frequency.score, d.frequency.max), d.frequency.count > 0 ? `Frequência média de ${d.frequency.avg}x por pessoa.` : 'Sem dados suficientes de frequência.', 'Renove criativos, amplie público ou reduza repetição para evitar saturação e perda de resposta.'),
    buildInsight('creativeCount', 'Poucos criativos ativos', pct(d.creativeCount.score, d.creativeCount.max), `${d.creativeCount.count} anúncios ativos considerados no período.`, 'Suba novos anúncios ativos para dar mais opções ao algoritmo e reduzir fadiga dos criativos atuais.'),
    buildInsight('creativeAge', 'Criativos envelhecidos', pct(d.creativeAge.score, d.creativeAge.max), `Idade média de ${d.creativeAge.avgAge} dias; ${d.creativeAge.stale} criativo(s) acima de 45 dias.`, 'Substitua criativos antigos, principalmente os acima de 45 dias, por variações novas de imagem, vídeo e copy.'),
    buildInsight('formatDiversity', 'Formatos pouco diversos', pct(d.formatDiversity.score, d.formatDiversity.max), d.formatDiversity.unique > 0 ? `${d.formatDiversity.unique} formato(s): ${d.formatDiversity.formats.join(', ')}.` : 'Sem formatos identificados.', 'Diversifique entre imagem, vídeo e carrossel para encontrar novos sinais de performance e reduzir dependência de um formato.'),
    buildInsight('consistency', 'Investimento instável', pct(d.consistency.score, d.consistency.max), d.consistency.cv !== null ? `Variação semanal de ${d.consistency.cv}%.` : 'Dados semanais insuficientes para medir estabilidade.', 'Estabilize a verba semanal e evite grandes oscilações para melhorar aprendizado e previsibilidade das campanhas.'),
    buildInsight('budgetPaused', 'Pausas por saldo', pct(d.budgetPaused.score, d.budgetPaused.max), d.budgetPaused.count === 0 ? 'Nenhuma campanha pausada por saldo.' : `${d.budgetPaused.count} campanha(s) pausada(s) por saldo ou cobrança.`, 'Revise saldo, cobrança e orçamento para evitar interrupções que quebram entrega e aprendizado das campanhas.'),
    buildInsight('crmConversion', 'Conversão no CRM baixa', pct(d.crmConversion.score, d.crmConversion.max), d.crmConversion.rate !== null ? `${d.crmConversion.rate}% de conversão; ${d.crmConversion.advanced}/${d.crmConversion.total} leads avançaram.` : 'Sem dados suficientes de conversão no CRM.', 'Melhore qualificação, tempo de resposta e acompanhamento dos leads para transformar mais contatos em oportunidades.'),
    buildInsight('reports', 'Poucos relatórios', pct(d.reports.score, d.reports.max), `${d.reports.count} relatório(s) gerado(s) no mês.`, 'Gere mais relatórios no mês para acompanhar decisões, registrar aprendizados e corrigir quedas mais rápido.'),
  ];

  const weak = insights.filter(item => item.percent < 75).sort((a, b) => a.percent - b.percent).slice(0, 5);
  if (weak.length > 0) return weak;

  return [
    buildInsight('healthy', 'Score saudável', 100, 'Os principais critérios estão acima do nível de atenção.', 'Mantenha rotina de testes, acompanhe CPL e leads semanalmente e continue renovando criativos antes de saturar.'),
  ];
}

function toneClasses(tone: InsightTone) {
  if (tone === 'red') return { card: 'border-red-500/40 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.22),transparent_42%),rgba(127,29,29,0.16)] shadow-[0_0_26px_rgba(239,68,68,0.10)]', pill: 'border-red-500/40 bg-red-500/10 text-red-400', dot: 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.85)]', label: 'Crítico' };
  if (tone === 'orange') return { card: 'border-orange-500/40 bg-[radial-gradient(circle_at_50%_0%,rgba(249,115,22,0.20),transparent_42%),rgba(124,45,18,0.16)] shadow-[0_0_26px_rgba(249,115,22,0.10)]', pill: 'border-orange-500/40 bg-orange-500/10 text-orange-400', dot: 'bg-orange-400 shadow-[0_0_12px_rgba(251,146,60,0.85)]', label: 'Alto' };
  return { card: 'border-yellow-500/40 bg-[radial-gradient(circle_at_50%_0%,rgba(250,204,21,0.18),transparent_42%),rgba(113,63,18,0.14)] shadow-[0_0_26px_rgba(250,204,21,0.10)]', pill: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-400', dot: 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.85)]', label: 'Médio' };
}

// SVG hexagonal radar — no external deps
function SvgRadar({ axes, color, hoveredAxis, onAxisHover }: {
  axes: { label: string; value: number }[];
  color: string;
  hoveredAxis: string | null;
  onAxisHover: (label: string | null) => void;
}) {
  const cx = 180;
  const cy = 170;
  const R = 120;
  const n = axes.length;

  function point(r: number, i: number) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  }

  function polygon(r: number) {
    return Array.from({ length: n }, (_, i) => {
      const p = point(r, i);
      return `${p.x},${p.y}`;
    }).join(' ');
  }

  const dataPoints = axes.map((ax, i) => point(R * ax.value / 100, i));
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox="0 0 360 340" className="w-full max-w-xs mx-auto">
      {/* Grid polygons */}
      {gridLevels.map((level) => (
        <polygon
          key={level}
          points={polygon(R * level)}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />
      ))}

      {/* Grid spokes */}
      {Array.from({ length: n }, (_, i) => {
        const p = point(R, i);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}

      {/* Data polygon */}
      <polygon
        points={dataPolygon}
        fill={color}
        fillOpacity={0.26}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        filter="drop-shadow(0 0 8px rgba(34,197,94,0.75))"
      />

      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={color} stroke="none" />
      ))}

      {/* Labels — hover area + colored dot + text */}
      {axes.map((ax, i) => {
        const lp = point(R + 22, i);
        const dot = point(R + 8, i);
        const hitP = point(R + 30, i);
        const anchor = lp.x < cx - 5 ? 'end' : lp.x > cx + 5 ? 'start' : 'middle';
        const isHovered = hoveredAxis === ax.label;
        const axisColor = AXIS_COLORS[ax.label] ?? color;
        return (
          <g
            key={i}
            style={{ cursor: 'pointer' }}
            onMouseEnter={() => onAxisHover(ax.label)}
            onMouseLeave={() => onAxisHover(null)}
          >
            {/* Invisible hit area */}
            <circle cx={hitP.x} cy={hitP.y} r={28} fill="transparent" />
            <circle cx={dot.x} cy={dot.y} r={isHovered ? 8 : 6} fill={axisColor} style={{ transition: 'r 0.15s' }} />
            <text
              x={lp.x}
              y={lp.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="white"
              fontSize={isHovered ? '12' : '11'}
              fontWeight={isHovered ? '800' : '500'}
            >
              {ax.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function RadarView({ details, score }: {
  details: ScoreDetails;
  score: number | null;
}) {
  const [hoveredAxis, setHoveredAxis] = useState<string | null>(null);
  const axes = buildAxes(details);
  const color = '#22c55e';
  const insights = buildInsights(details);
  const hoveredLegend = AXIS_LEGEND.find(l => l.label === hoveredAxis) ?? null;

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr]">
        <section className="relative overflow-hidden rounded-xl border border-emerald-400/30 bg-[radial-gradient(circle_at_24%_0%,rgba(34,197,94,0.24),transparent_34%),radial-gradient(circle_at_74%_36%,rgba(139,92,246,0.18),transparent_42%),rgba(15,23,42,0.72)] p-5 shadow-[0_0_42px_rgba(34,197,94,0.14)]">
          <div className="pointer-events-none absolute inset-x-16 top-0 h-px bg-emerald-300/70" />
          <div className="mb-2">
            <p className="text-base font-bold text-foreground">Radar de Performance <span className="text-xs text-muted-foreground">ⓘ</span></p>
            <p className="text-xs text-muted-foreground">Visão geral da performance do cliente nas 6 dimensões do Score.</p>
          </div>
          <div className="flex min-h-[310px] items-center justify-center">
            <SvgRadar axes={axes} color={color} hoveredAxis={hoveredAxis} onAxisHover={setHoveredAxis} />
          </div>
          {/* Tooltip area below chart */}
          <div className="min-h-[40px] rounded-lg px-3 py-2 text-center text-xs transition-all">
            {hoveredLegend ? (
              <span>
                <span className="font-bold" style={{ color: AXIS_COLORS[hoveredLegend.label] ?? color }}>{hoveredLegend.label}: </span>
                <span className="text-muted-foreground">{hoveredLegend.desc}</span>
              </span>
            ) : (
              <span className="text-muted-foreground/40">Passe o mouse sobre um eixo para ver a descrição</span>
            )}
          </div>
        </section>

        <section className="relative overflow-hidden rounded-xl border border-slate-700/80 bg-[radial-gradient(circle_at_64%_0%,rgba(34,197,94,0.18),transparent_34%),rgba(15,23,42,0.72)] p-5 shadow-[0_0_42px_rgba(59,130,246,0.10)]">
          <div className="pointer-events-none absolute inset-x-20 top-0 h-px bg-emerald-300/50" />
          <div className="mb-6">
            <p className="text-base font-bold text-foreground">Detalhes por eixo</p>
            <p className="text-xs text-muted-foreground">Performance em cada dimensão do Score.</p>
          </div>
          <div className="flex flex-col gap-4">
          {axes.map(item => {
            const isHovered = hoveredAxis === item.label;
            const legend = AXIS_LEGEND.find(l => l.label === item.label);
            const axisColor = AXIS_COLORS[item.label] ?? radarColor(item.value);
            return (
              <div
                key={item.label}
                className="cursor-default rounded-lg px-2 py-1 transition-colors"
                style={{ backgroundColor: isHovered ? `${axisColor}14` : 'transparent' }}
                onMouseEnter={() => setHoveredAxis(item.label)}
                onMouseLeave={() => setHoveredAxis(null)}
              >
                <div className="mb-1.5 grid grid-cols-[130px_1fr_56px] items-center gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background shadow-[0_0_14px_currentColor]" style={{ color: axisColor }}>●</span>
                    {item.label}
                  </span>
                  <div className="h-1.5 rounded-full bg-slate-800">
                    <div
                      className="h-1.5 rounded-full transition-all shadow-[0_0_12px_currentColor]"
                      style={{ width: `${item.value}%`, backgroundColor: axisColor, color: axisColor }}
                    />
                  </div>
                  <span className="text-right text-sm font-bold" style={{ color: axisColor }}>{item.value} <span className="text-xs font-normal text-muted-foreground">/100</span></span>
                </div>
                {isHovered && legend && (
                  <p className="ml-8 text-[11px] leading-relaxed text-muted-foreground">{legend.desc}</p>
                )}
              </div>
            );
          })}
          </div>
          <div className="mt-5 rounded-lg bg-black/35 px-4 py-3 text-xs text-muted-foreground">
            ⓘ Pontuações atualizadas diariamente com base nos dados do período selecionado.
          </div>
        </section>
      </div>

      <section className="relative mt-3 overflow-hidden rounded-xl border border-slate-700/80 bg-[radial-gradient(circle_at_50%_0%,rgba(239,68,68,0.14),transparent_36%),rgba(15,23,42,0.74)] p-5 shadow-[0_0_38px_rgba(239,68,68,0.08)]">
        <div className="pointer-events-none absolute inset-x-24 top-0 h-px bg-red-300/35" />
        <div className="mb-4">
          <p className="text-sm font-bold text-foreground">Insights diretos</p>
          <p className="text-xs text-muted-foreground">Prioridades práticas para melhorar o Score e acelerar resultados.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {insights.map(item => {
            const tone = toneClasses(item.tone);
            return (
              <div key={item.key} className={`rounded-lg border p-3 ${tone.card}`}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                    {item.title}
                  </p>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone.pill}`}>
                    {tone.label}
                  </span>
                </div>
                <p className="mb-2 text-xs leading-relaxed text-muted-foreground">{item.diagnosis}</p>
                <p className="text-xs leading-relaxed text-foreground/85">
                  <span className="font-bold">Recomendação: </span>{item.action}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
