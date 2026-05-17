"use client";

import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
} from 'recharts';

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
function avg(...vals: number[]) { return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length); }

function buildRadarData(d: ScoreDetails) {
  return [
    { axis: 'Custo/CPL',    value: pct(d.cpl.score, d.cpl.max) },
    { axis: 'Volume',       value: pct(d.leads.score, d.leads.max) },
    { axis: 'Engajamento',  value: avg(pct(d.ctr.score, d.ctr.max), pct(d.frequency.score, d.frequency.max)) },
    { axis: 'Criativos',    value: avg(pct(d.creativeCount.score, d.creativeCount.max), pct(d.creativeAge.score, d.creativeAge.max), pct(d.formatDiversity.score, d.formatDiversity.max)) },
    { axis: 'Consistência', value: avg(pct(d.consistency.score, d.consistency.max), pct(d.budgetPaused.score, d.budgetPaused.max)) },
    { axis: 'Gestão',       value: avg(pct(d.crmConversion.score, d.crmConversion.max), pct(d.reports.score, d.reports.max)) },
  ];
}

function radarFillColor(score: number): string {
  if (score >= 85) return '#22c55e';
  if (score >= 70) return '#3b82f6';
  if (score >= 50) return '#eab308';
  if (score >= 30) return '#f97316';
  return '#ef4444';
}

export default function RadarView({ details, clientName, score }: {
  details: ScoreDetails;
  clientName: string;
  score: number | null;
}) {
  const color = score !== null ? radarFillColor(score) : '#6b7280';
  const data = buildRadarData(details);

  return (
    <div className="flex flex-col lg:flex-row gap-0">
      {/* Radar chart */}
      <div className="flex-1 flex items-center justify-center py-6 px-4">
        <ResponsiveContainer width="100%" height={340}>
          <RadarChart data={data} margin={{ top: 20, right: 40, bottom: 20, left: 40 }}>
            <PolarGrid stroke="rgba(255,255,255,0.08)" gridType="polygon" />
            <PolarAngleAxis
              dataKey="axis"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12, fontWeight: 600 }}
            />
            <Radar
              name={clientName}
              dataKey="value"
              stroke={color}
              fill={color}
              fillOpacity={0.25}
              strokeWidth={2}
              dot={{ fill: color, r: 4, strokeWidth: 0 }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Right: axis breakdown */}
      <div className="lg:w-64 border-t lg:border-t-0 lg:border-l border-border/50 p-5 flex flex-col gap-2.5">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Detalhes por eixo</p>
        {data.map(item => (
          <div key={item.axis}>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">{item.axis}</span>
              <span className="text-xs font-bold" style={{ color: radarFillColor(item.value) }}>{item.value}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full transition-all"
                style={{ width: `${item.value}%`, backgroundColor: radarFillColor(item.value) }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
