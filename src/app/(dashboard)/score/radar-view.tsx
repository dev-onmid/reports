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

function pct(score: number, max: number) { return Math.round((score / max) * 100); }
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

  return (
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
  );
}
