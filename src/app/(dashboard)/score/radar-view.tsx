"use client";

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
  { label: 'Custo/CPL', desc: 'Compara o CPL atual com o mês anterior. Quanto menor o CPL, melhor a pontuação.' },
  { label: 'Volume', desc: 'Mede o volume de leads atual versus o mês anterior.' },
  { label: 'Engajamento', desc: 'Combina CTR e frequência para indicar qualidade de criativo e saturação.' },
  { label: 'Criativos', desc: 'Considera quantidade de anúncios ativos, idade média e variedade de formatos.' },
  { label: 'Consistência', desc: 'Avalia estabilidade semanal do investimento e campanhas pausadas por saldo.' },
  { label: 'Gestão', desc: 'Considera conversão no CRM e quantidade de relatórios gerados no mês.' },
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
  if (tone === 'red') return { card: 'border-red-500/30 bg-red-500/10', pill: 'border-red-500/30 bg-red-500/10 text-red-400', dot: 'bg-red-400' };
  if (tone === 'orange') return { card: 'border-orange-500/30 bg-orange-500/10', pill: 'border-orange-500/30 bg-orange-500/10 text-orange-400', dot: 'bg-orange-400' };
  return { card: 'border-green-500/30 bg-green-500/10', pill: 'border-green-500/30 bg-green-500/10 text-green-400', dot: 'bg-green-400' };
}

// SVG hexagonal radar — no external deps
function SvgRadar({ axes, color }: { axes: { label: string; value: number }[]; color: string }) {
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
        fillOpacity={0.2}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} fill={color} stroke="none" />
      ))}

      {/* Labels */}
      {axes.map((ax, i) => {
        const lp = point(R + 22, i);
        const anchor = lp.x < cx - 5 ? 'end' : lp.x > cx + 5 ? 'start' : 'middle';
        return (
          <g key={i}>
            <text
              x={lp.x}
              y={lp.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fill="hsl(var(--muted-foreground))"
              fontSize="11"
              fontWeight="600"
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
  const axes = buildAxes(details);
  const color = score !== null ? radarColor(score) : '#6b7280';
  const insights = buildInsights(details);

  return (
    <div>
      <div className="flex flex-col lg:flex-row">
        {/* Radar SVG */}
        <div className="flex-1 flex items-center justify-center py-4 px-4">
          <SvgRadar axes={axes} color={color} />
        </div>

        {/* Right: axis breakdown */}
        <div className="lg:w-60 border-t lg:border-t-0 lg:border-l border-border/50 p-5 flex flex-col gap-2.5">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Detalhes por eixo</p>
          {axes.map(item => (
            <div key={item.label}>
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-foreground">{item.label}</span>
                <span className="text-xs font-bold" style={{ color: radarColor(item.value) }}>{item.value}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: `${item.value}%`, backgroundColor: radarColor(item.value) }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 border-t border-border/50 p-5 xl:grid-cols-[1fr_1.1fr]">
        <section className="rounded-xl border border-border/70 bg-background/35 p-4">
          <div className="mb-4">
            <p className="text-sm font-bold text-foreground">Legenda do radar</p>
            <p className="text-xs text-muted-foreground">O que é considerado em cada etapa do Score.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {AXIS_LEGEND.map(item => (
              <div key={item.label} className="rounded-lg border border-border/60 bg-card/50 p-3">
                <p className="text-xs font-bold text-foreground">{item.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-background/35 p-4">
          <div className="mb-4">
            <p className="text-sm font-bold text-foreground">Insights diretos</p>
            <p className="text-xs text-muted-foreground">Prioridades práticas para melhorar o que está puxando o Score para baixo.</p>
          </div>
          <div className="space-y-2">
            {insights.map(item => {
              const tone = toneClasses(item.tone);
              return (
                <div key={item.key} className={`rounded-lg border p-3 ${tone.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                        <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
                        {item.title}
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.diagnosis}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone.pill}`}>
                      {item.percent}%
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-foreground/85">
                    <span className="font-bold">Como melhorar: </span>{item.action}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
