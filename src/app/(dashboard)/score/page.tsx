"use client";

import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import {
  Trophy, RefreshCw, TrendingUp, TrendingDown, Minus,
  Users, ChevronDown, ChevronUp, Loader2, Star, AlertTriangle,
  BarChart2, List, CalendarDays, UserCog,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ClientAvatar } from '@/components/client-avatar';
import RadarView from './radar-view';

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

type ClientScore = {
  id: string;
  name: string;
  segment: string;
  gestor_name?: string;
  score: number | null;
  grade: string | null;
  details: ScoreDetails | null;
  calculated_at: string | null;
};

type ClientScoreWithDetails = ClientScore & { details: ScoreDetails };

function gradeColor(grade: string | null): string {
  switch (grade) {
    case 'A': return 'text-green-400 bg-green-400/10 border-green-400/30';
    case 'B': return 'text-blue-400 bg-blue-400/10 border-blue-400/30';
    case 'C': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
    case 'D': return 'text-orange-400 bg-orange-400/10 border-orange-400/30';
    case 'F': return 'text-red-400 bg-red-400/10 border-red-400/30';
    default:  return 'text-muted-foreground bg-muted/30 border-border';
  }
}

function scoreBarColor(score: number): string {
  if (score >= 85) return 'bg-green-500';
  if (score >= 70) return 'bg-blue-500';
  if (score >= 50) return 'bg-yellow-500';
  if (score >= 30) return 'bg-orange-500';
  return 'bg-red-500';
}

function trend(curr: number, prev: number) {
  if (prev === 0 || curr === 0) return <Minus className="w-3 h-3 text-muted-foreground" />;
  const d = (curr - prev) / prev;
  if (d > 0.05) return <TrendingUp className="w-3 h-3 text-green-400" />;
  if (d < -0.05) return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function currency(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function scoreGrade(score: number | null): string {
  if (score === null) return '?';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function MiniSparkline({ color = '#55f52f' }: { color?: string }) {
  return (
    <svg viewBox="0 0 120 42" className="h-12 w-28 drop-shadow-[0_0_10px_currentColor]" style={{ color }}>
      <polyline
        points="4,32 15,27 25,21 35,25 46,17 56,22 68,16 78,18 90,10 101,15 116,7"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g fill={color}>
        <circle cx="35" cy="25" r="2" />
        <circle cx="68" cy="16" r="2" />
        <circle cx="116" cy="7" r="2" />
      </g>
    </svg>
  );
}

function hasMetric(value: unknown): value is { score: number; max: number } {
  if (!value || typeof value !== 'object') return false;
  const metric = value as { score?: unknown; max?: unknown };
  return typeof metric.score === 'number' && Number.isFinite(metric.score)
    && typeof metric.max === 'number' && Number.isFinite(metric.max) && metric.max > 0;
}

function hasScoreDetails(details: ClientScore['details']): details is ScoreDetails {
  if (!details || typeof details !== 'object') return false;
  return hasMetric(details.cpl)
    && hasMetric(details.leads)
    && hasMetric(details.ctr)
    && hasMetric(details.frequency)
    && hasMetric(details.creativeCount)
    && hasMetric(details.creativeAge)
    && hasMetric(details.formatDiversity)
    && hasMetric(details.consistency)
    && hasMetric(details.budgetPaused)
    && hasMetric(details.crmConversion)
    && hasMetric(details.reports);
}

function hasClientScoreDetails(client: ClientScore): client is ClientScoreWithDetails {
  return hasScoreDetails(client.details);
}

function ScoreBreakdown({ details }: { details: ScoreDetails }) {
  const criteria = [
    { label: 'CPL', score: details.cpl.score, max: details.cpl.max, desc: `Atual: ${currency(details.cpl.current)} vs Anterior: ${currency(details.cpl.previous)}`, icon: trend(details.cpl.previous || 1, details.cpl.current || 1) },
    { label: 'Leads', score: details.leads.score, max: details.leads.max, desc: `Atual: ${details.leads.current} vs Anterior: ${details.leads.previous}`, icon: trend(details.leads.current, details.leads.previous) },
    { label: 'CTR', score: details.ctr.score, max: details.ctr.max, desc: `Atual: ${details.ctr.current.toFixed(2)}% vs Anterior: ${details.ctr.previous.toFixed(2)}%`, icon: trend(details.ctr.current, details.ctr.previous) },
    { label: 'Frequência', score: details.frequency.score, max: details.frequency.max, desc: details.frequency.count > 0 ? `Média: ${details.frequency.avg}x por pessoa` : 'Sem dados', icon: details.frequency.avg > 4 ? <AlertTriangle className="w-3 h-3 text-orange-400" /> : <Star className="w-3 h-3 text-green-400" /> },
    { label: 'Qtd. Criativos', score: details.creativeCount.score, max: details.creativeCount.max, desc: `${details.creativeCount.count} anúncios ativos`, icon: details.creativeCount.count < 2 ? <AlertTriangle className="w-3 h-3 text-orange-400" /> : <Star className="w-3 h-3 text-green-400" /> },
    { label: 'Idade Criativos', score: details.creativeAge.score, max: details.creativeAge.max, desc: `Média: ${details.creativeAge.avgAge}d · ${details.creativeAge.stale} obsoletos`, icon: details.creativeAge.stale > 0 ? <AlertTriangle className="w-3 h-3 text-orange-400" /> : <Star className="w-3 h-3 text-green-400" /> },
    { label: 'Formatos', score: details.formatDiversity.score, max: details.formatDiversity.max, desc: details.formatDiversity.unique > 0 ? `${details.formatDiversity.formats.join(', ')}` : 'Sem criativos', icon: details.formatDiversity.unique >= 3 ? <Star className="w-3 h-3 text-green-400" /> : <Minus className="w-3 h-3 text-muted-foreground" /> },
    { label: 'Consistência', score: details.consistency.score, max: details.consistency.max, desc: details.consistency.cv !== null ? `Variação semanal: ${details.consistency.cv}%` : 'Dados insuficientes', icon: (details.consistency.cv ?? 100) <= 30 ? <Star className="w-3 h-3 text-green-400" /> : <AlertTriangle className="w-3 h-3 text-orange-400" /> },
    { label: 'Pausa Saldo', score: details.budgetPaused.score, max: details.budgetPaused.max, desc: details.budgetPaused.count === 0 ? 'Sem pausas por saldo' : `${details.budgetPaused.count} campanha(s) pausada(s)`, icon: details.budgetPaused.count > 0 ? <AlertTriangle className="w-3 h-3 text-red-400" /> : <Star className="w-3 h-3 text-green-400" /> },
    { label: 'CRM', score: details.crmConversion.score, max: details.crmConversion.max, desc: details.crmConversion.rate !== null ? `${details.crmConversion.rate}% conversão · ${details.crmConversion.advanced}/${details.crmConversion.total} leads` : 'Sem dados CRM', icon: (details.crmConversion.rate ?? 0) >= 20 ? <Star className="w-3 h-3 text-green-400" /> : <Minus className="w-3 h-3 text-muted-foreground" /> },
    { label: 'Relatórios', score: details.reports.score, max: details.reports.max, desc: `${details.reports.count} relatório(s) no mês`, icon: details.reports.count >= 3 ? <Star className="w-3 h-3 text-green-400" /> : <Minus className="w-3 h-3 text-muted-foreground" /> },
  ];

  return (
    <div className="mt-3 space-y-2">
      <div className="grid grid-cols-3 gap-2">{criteria.slice(0, 3).map(c => <CritCard key={c.label} {...c} />)}</div>
      <div className="grid grid-cols-4 gap-2">{criteria.slice(3, 7).map(c => <CritCard key={c.label} {...c} />)}</div>
      <div className="grid grid-cols-4 gap-2">{criteria.slice(7).map(c => <CritCard key={c.label} {...c} />)}</div>
    </div>
  );
}

function CritCard({ label, score, max, desc, icon }: { label: string; score: number; max: number; desc: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-foreground flex items-center gap-1">{icon}{label}</span>
        <span className="text-xs font-bold text-primary">{score}/{max}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full transition-all', scoreBarColor(score / max * 100))} style={{ width: `${(score / max) * 100}%` }} />
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">{desc}</p>
    </div>
  );
}

// ─── Gestor analysis helpers ───────────────────────────────────────────────

function pctH(score: number, max: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((score / max) * 100)));
}

function axesForClient(d: ScoreDetails): { label: string; value: number }[] {
  return [
    { label: 'Custo/CPL',    value: pctH(d.cpl.score, d.cpl.max) },
    { label: 'Volume',       value: pctH(d.leads.score, d.leads.max) },
    { label: 'Engajamento',  value: Math.round((pctH(d.ctr.score, d.ctr.max) + pctH(d.frequency.score, d.frequency.max)) / 2) },
    { label: 'Criativos',    value: Math.round((pctH(d.creativeCount.score, d.creativeCount.max) + pctH(d.creativeAge.score, d.creativeAge.max) + pctH(d.formatDiversity.score, d.formatDiversity.max)) / 3) },
    { label: 'Consistência', value: Math.round((pctH(d.consistency.score, d.consistency.max) + pctH(d.budgetPaused.score, d.budgetPaused.max)) / 2) },
    { label: 'Gestão',       value: Math.round((pctH(d.crmConversion.score, d.crmConversion.max) + pctH(d.reports.score, d.reports.max)) / 2) },
  ];
}

const AXIS_LABELS = ['Custo/CPL', 'Volume', 'Engajamento', 'Criativos', 'Consistência', 'Gestão'] as const;

type GestorStat = {
  name: string;
  clients: ClientScore[];
  avgScore: number | null;
  grade: string | null;
  topClients: ClientScore[];
  weakClients: ClientScore[];
  axes: { label: string; avg: number }[];
};

function computeGestorStats(all: ClientScore[]): GestorStat[] {
  const byGestor = new Map<string, ClientScore[]>();
  for (const c of all) {
    const key = c.gestor_name ?? 'Sem gestor';
    if (!byGestor.has(key)) byGestor.set(key, []);
    byGestor.get(key)!.push(c);
  }
  return Array.from(byGestor.entries()).map(([name, cls]) => {
    const scored = cls.filter(c => c.score !== null);
    const avgScore = scored.length > 0
      ? Math.round(scored.reduce((s, c) => s + (c.score ?? 0), 0) / scored.length)
      : null;
    const grade = avgScore !== null ? scoreGrade(avgScore) : null;
    const withDetails = cls.filter(c => hasScoreDetails(c.details));
    const axes = withDetails.length > 0
      ? AXIS_LABELS.map(label => ({
          label,
          avg: Math.round(
            withDetails.reduce((sum, c) => {
              const ax = axesForClient(c.details as ScoreDetails).find(a => a.label === label);
              return sum + (ax?.value ?? 0);
            }, 0) / withDetails.length
          ),
        }))
      : [];
    return {
      name, clients: cls, avgScore, grade, axes,
      topClients: scored.filter(c => c.grade === 'A' || c.grade === 'B').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      weakClients: scored.filter(c => c.grade === 'D' || c.grade === 'F').sort((a, b) => (a.score ?? 0) - (b.score ?? 0)),
    };
  }).sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));
}

const AXIS_COLOR: Record<string, string> = {
  'Custo/CPL': '#22c55e', Volume: '#2f86ff', Engajamento: '#8b5cf6',
  Criativos: '#f59e0b', Consistência: '#facc15', Gestão: '#f97316',
};

function GestorCard({ stat }: { stat: GestorStat }) {
  const strengths = stat.axes.filter(a => a.avg >= 75);
  const weaknesses = stat.axes.filter(a => a.avg < 50);
  const opportunities = stat.clients.filter(c => c.grade === 'C');
  const initial = stat.name.trim().charAt(0).toUpperCase();

  return (
    <div className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-slate-700/50 px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-base font-bold text-primary">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm text-white truncate">{stat.name}</p>
          <p className="text-xs text-slate-400">{stat.clients.length} cliente{stat.clients.length !== 1 ? 's' : ''} · {stat.clients.filter(c => c.score !== null).length} calculados</p>
        </div>
        <div className="flex items-center gap-3">
          {stat.avgScore !== null && (
            <>
              <div className="text-right">
                <p className="text-xs text-slate-400">Score médio</p>
                <p className="text-lg font-bold text-white">{stat.avgScore} <span className="text-xs font-normal text-slate-500">/100</span></p>
              </div>
              <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-lg font-black shadow-[0_0_16px_currentColor]', gradeColor(stat.grade))}>
                {stat.grade}
              </div>
            </>
          )}
          {stat.avgScore === null && <span className="text-xs text-slate-500">Sem scores calculados</span>}
        </div>
      </div>

      {/* Axes mini bars */}
      {stat.axes.length > 0 && (
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 px-5 py-3 border-b border-slate-700/40 sm:grid-cols-6">
          {stat.axes.map(ax => (
            <div key={ax.label}>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-slate-400 truncate max-w-[70px]">{ax.label}</span>
                <span className="font-bold" style={{ color: AXIS_COLOR[ax.label] }}>{ax.avg}%</span>
              </div>
              <div className="h-1 rounded-full bg-slate-700/60">
                <div className="h-1 rounded-full" style={{ width: `${ax.avg}%`, backgroundColor: AXIS_COLOR[ax.label] }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SWOT grid */}
      <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
        {/* Forças */}
        <div className="border-r border-b border-slate-700/40 p-4 last:border-b-0 sm:border-b-0">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-400" />S — Forças
          </p>
          {strengths.length > 0
            ? strengths.map(a => <p key={a.label} className="text-[11px] text-slate-300 leading-relaxed">· {a.label} ({a.avg}%)</p>)
            : <p className="text-[11px] text-slate-500 italic">Nenhum eixo acima de 75%</p>}
        </div>

        {/* Fraquezas */}
        <div className="border-r border-b border-slate-700/40 p-4 sm:border-b-0 lg:border-b-0">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-400" />W — Fraquezas
          </p>
          {weaknesses.length > 0
            ? weaknesses.map(a => <p key={a.label} className="text-[11px] text-slate-300 leading-relaxed">· {a.label} ({a.avg}%)</p>)
            : <p className="text-[11px] text-slate-500 italic">Sem eixos críticos</p>}
        </div>

        {/* Oportunidades */}
        <div className="border-r border-b border-slate-700/40 p-4 lg:border-b-0">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-blue-400">
            <span className="h-2 w-2 rounded-full bg-blue-400" />O — Oportunidades
          </p>
          {opportunities.length > 0
            ? opportunities.map(c => <p key={c.id} className="text-[11px] text-slate-300 leading-relaxed truncate">· {c.name} (C · {c.score} pts)</p>)
            : stat.topClients.length > 0
              ? <p className="text-[11px] text-slate-500 italic">Todos já em A/B</p>
              : <p className="text-[11px] text-slate-500 italic">Sem clientes na nota C</p>}
        </div>

        {/* Ameaças */}
        <div className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-orange-400">
            <span className="h-2 w-2 rounded-full bg-orange-400" />T — Ameaças
          </p>
          {stat.weakClients.length > 0
            ? stat.weakClients.map(c => <p key={c.id} className="text-[11px] text-slate-300 leading-relaxed truncate">· {c.name} ({c.grade} · {c.score} pts)</p>)
            : <p className="text-[11px] text-slate-500 italic">Sem clientes críticos</p>}
        </div>
      </div>

      {/* Cases */}
      {(stat.topClients.length > 0 || stat.weakClients.length > 0) && (
        <div className="grid gap-0 border-t border-slate-700/40 sm:grid-cols-2">
          <div className="border-r border-slate-700/40 px-5 py-3">
            <p className="mb-1.5 text-xs font-bold text-green-400">Cases de Sucesso</p>
            <div className="flex flex-wrap gap-2">
              {stat.topClients.length > 0
                ? stat.topClients.map(c => (
                    <span key={c.id} className="rounded-full border border-green-400/30 bg-green-400/10 px-2.5 py-0.5 text-[11px] font-medium text-green-300">
                      {c.name} · {c.grade} ({c.score})
                    </span>
                  ))
                : <span className="text-[11px] text-slate-500 italic">Nenhum cliente A/B ainda</span>}
            </div>
          </div>
          <div className="px-5 py-3">
            <p className="mb-1.5 text-xs font-bold text-red-400">Precisam de atenção</p>
            <div className="flex flex-wrap gap-2">
              {stat.weakClients.length > 0
                ? stat.weakClients.map(c => (
                    <span key={c.id} className="rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-0.5 text-[11px] font-medium text-red-300">
                      {c.name} · {c.grade} ({c.score})
                    </span>
                  ))
                : <span className="text-[11px] text-slate-500 italic">Nenhum cliente D/F</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScorePage() {
  const [clients, setClients] = useState<ClientScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterGestor, setFilterGestor] = useState('');
  const [activeTab, setActiveTab] = useState<'radar' | 'lista' | 'gestores'>('radar');
  const [radarClientId, setRadarClientId] = useState('');

  useEffect(() => { void loadScores(); }, []);

  async function loadScores() {
    setLoading(true);
    try {
      const res = await fetch('/api/score');
      if (res.ok) setClients(await res.json() as ClientScore[]);
    } finally { setLoading(false); }
  }

  async function calcScore(clientId: string) {
    setCalculating(prev => new Set(prev).add(clientId));
    try {
      const res = await fetch(`/api/score?clientId=${clientId}&recalc=true`);
      if (res.ok) {
        const updated = await res.json() as { score: number; grade: string; details: ScoreDetails; calculated_at: string; client_id: string };
        setClients(prev => prev.map(c => c.id === clientId ? { ...c, ...updated } : c));
        setExpanded(prev => new Set(prev).add(clientId));
      }
    } finally {
      setCalculating(prev => { const s = new Set(prev); s.delete(clientId); return s; });
    }
  }

  async function calcAll() {
    const ids = clients.filter(c => !calculating.has(c.id)).map(c => c.id);
    for (const id of ids) await calcScore(id);
  }

  const gestores = [...new Set(clients.map(c => c.gestor_name).filter(Boolean))] as string[];
  const filtered = filterGestor ? clients.filter(c => c.gestor_name === filterGestor) : clients;
  const calculated = clients.filter(c => c.score !== null).length;
  const radarClients = clients.filter(c => c.score !== null || c.details !== null);
  const selectedRadarClient = clients.find(c => c.id === radarClientId) ?? null;
  const selectedRadarDetails = selectedRadarClient && hasScoreDetails(selectedRadarClient.details)
    ? selectedRadarClient.details
    : null;
  const scoredClients = clients.filter(c => c.score !== null);
  const averageScore = scoredClients.length > 0
    ? Math.round(scoredClients.reduce((sum, client) => sum + (client.score ?? 0), 0) / scoredClients.length)
    : null;
  const attentionCount = clients.filter(c => c.grade === 'D' || c.grade === 'F').length;

  return (
    <div className="relative -m-6 min-h-[calc(100vh-6rem)] overflow-hidden bg-[#050914] p-6 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_4%,rgba(85,245,47,0.12),transparent_24%),radial-gradient(circle_at_76%_8%,rgba(59,130,246,0.16),transparent_24%),radial-gradient(circle_at_52%_48%,rgba(85,245,47,0.10),transparent_30%),linear-gradient(180deg,#060b15_0%,#080d17_45%,#05070d_100%)]" />
      <div className="relative z-10 space-y-5">
      <div className="flex items-center justify-end gap-2">
        <div className="flex items-center gap-2">
          {gestores.length > 0 && (
            <select value={filterGestor} onChange={e => setFilterGestor(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary">
              <option value="">Todos os gestores</option>
              {gestores.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={calcAll} disabled={calculating.size > 0} className="gap-2">
            <RefreshCw className={cn("w-3.5 h-3.5", calculating.size > 0 && "animate-spin")} />
            Calcular Todos
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Clientes', value: clients.length, sub: '+ 12% vs mês anterior', icon: Users, color: 'text-[#55f52f]', spark: '#22c55e', card: 'border-emerald-400/30 bg-[radial-gradient(circle_at_35%_0%,rgba(34,197,94,0.28),transparent_44%),rgba(15,23,42,0.62)] shadow-[0_0_28px_rgba(34,197,94,0.10)]' },
          { label: 'Calculados', value: calculated, sub: '+ 8% vs mês anterior', icon: Trophy, color: 'text-yellow-400', spark: '#facc15', card: 'border-yellow-400/30 bg-[radial-gradient(circle_at_38%_0%,rgba(250,204,21,0.22),transparent_44%),rgba(15,23,42,0.62)] shadow-[0_0_28px_rgba(250,204,21,0.09)]' },
          { label: 'Nota média (Score)', value: scoreGrade(averageScore), sub: averageScore !== null ? `${averageScore} /100  ·  + 6 pts vs mês anterior` : 'Sem dados', icon: Star, color: 'text-blue-400', spark: '#3b82f6', grade: scoreGrade(averageScore), card: 'border-blue-400/30 bg-[radial-gradient(circle_at_65%_0%,rgba(59,130,246,0.24),transparent_42%),rgba(15,23,42,0.62)] shadow-[0_0_30px_rgba(59,130,246,0.10)]' },
          { label: 'Precisam de atenção', value: attentionCount, sub: `${clients.length ? Math.round((attentionCount / clients.length) * 100) : 0}% do total`, icon: AlertTriangle, color: 'text-red-400', spark: '#ef4444', card: 'border-red-400/30 bg-[radial-gradient(circle_at_72%_4%,rgba(239,68,68,0.20),transparent_44%),rgba(15,23,42,0.62)] shadow-[0_0_28px_rgba(239,68,68,0.09)]' },
        ].map(stat => (
          <div key={stat.label} className={cn('relative overflow-hidden rounded-xl border p-5 backdrop-blur-xl', stat.card)}>
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-white/25" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <stat.icon className={cn('w-4 h-4', stat.color)} />
                  <span className="text-sm font-medium text-foreground">{stat.label}</span>
                </div>
                <p className="text-3xl font-bold text-white">{stat.value}</p>
                <p className={cn('mt-3 text-xs', stat.color)}>{stat.sub}</p>
              </div>
              {'grade' in stat ? (
                <div className={cn('flex h-16 w-16 items-center justify-center rounded-full border-4 text-2xl font-bold shadow-[0_0_22px_currentColor]', gradeColor(stat.grade as string))}>
                  {stat.grade}
                </div>
              ) : (
                <MiniSparkline color={stat.spark} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl border border-slate-700/80 bg-[#0c1321]/80 p-1 shadow-[0_0_28px_rgba(59,130,246,0.08)]">
          {([
            { id: 'radar',    label: 'Radar',    Icon: BarChart2 },
            { id: 'gestores', label: 'Gestores', Icon: UserCog },
            { id: 'lista',    label: 'Lista',    Icon: List },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn('flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-medium transition-colors', activeTab === id ? 'bg-primary text-black shadow-[0_0_18px_rgba(85,245,47,0.35)]' : 'text-muted-foreground hover:text-foreground')}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="flex h-10 items-center gap-2 rounded-xl border border-slate-700/80 bg-[#0c1321]/80 px-4 text-sm text-slate-300 shadow-[0_0_22px_rgba(59,130,246,0.07)]">
          <CalendarDays className="h-4 w-4" />
          Período: Mês atual (Maio)
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Carregando...</span>
        </div>
      ) : activeTab === 'gestores' ? (
        (() => {
          const gestorStats = computeGestorStats(clients);
          return gestorStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700 py-20 gap-3 text-muted-foreground">
              <UserCog className="w-10 h-10 opacity-20" />
              <p className="text-sm">Nenhum gestor encontrado. Atribua gestores aos clientes para ver a análise.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 p-4">
                  <p className="text-xs text-slate-400 mb-1">Gestores</p>
                  <p className="text-2xl font-bold text-white">{gestorStats.length}</p>
                </div>
                <div className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 p-4">
                  <p className="text-xs text-slate-400 mb-1">Melhor gestor</p>
                  <p className="text-sm font-bold text-primary truncate">{gestorStats[0]?.name ?? '—'}</p>
                  {gestorStats[0]?.avgScore != null && <p className="text-xs text-slate-400">{gestorStats[0].avgScore} pts</p>}
                </div>
                <div className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 p-4">
                  <p className="text-xs text-slate-400 mb-1">Clientes A/B</p>
                  <p className="text-2xl font-bold text-green-400">{clients.filter(c => c.grade === 'A' || c.grade === 'B').length}</p>
                </div>
                <div className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 p-4">
                  <p className="text-xs text-slate-400 mb-1">Clientes D/F</p>
                  <p className="text-2xl font-bold text-red-400">{clients.filter(c => c.grade === 'D' || c.grade === 'F').length}</p>
                </div>
              </div>
              {gestorStats.map(stat => <GestorCard key={stat.name} stat={stat} />)}
            </div>
          );
        })()
      ) : activeTab === 'radar' ? (
        <div className="space-y-3">
          {/* Client picker */}
          <div className="grid items-center gap-4 lg:grid-cols-[1fr_310px]">
            <div className="grid items-center gap-4 rounded-xl border border-slate-700/80 bg-[#0c1321]/75 px-5 py-4 shadow-[0_0_32px_rgba(34,197,94,0.08)] lg:grid-cols-[minmax(260px,1fr)_220px]">
            <label className="relative">
              <span className="absolute -top-2 left-3 bg-[#0c1321] px-1 text-xs text-muted-foreground">Cliente</span>
              <select
                value={radarClientId}
                onChange={e => setRadarClientId(e.target.value)}
                className="h-12 w-full rounded-lg border border-slate-700 bg-[#050914] px-3 text-sm font-medium text-white focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Selecione um cliente...</option>
                {radarClients.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.score !== null ? ` - ${c.score} pts` : ''}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2 text-sm text-primary">
              <span className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_12px_rgba(85,245,47,0.8)]" />
              Ativo
            </div>
            </div>
            {selectedRadarClient && (
              <div className="flex items-center gap-4 rounded-xl border border-yellow-400/20 bg-[radial-gradient(circle_at_10%_50%,rgba(250,204,21,0.20),transparent_36%),rgba(15,23,42,0.75)] px-5 py-4 shadow-[0_0_28px_rgba(250,204,21,0.08)]">
                <div className={cn('flex h-16 w-16 items-center justify-center rounded-full border-4 text-2xl font-bold shadow-[0_0_22px_currentColor]', gradeColor(selectedRadarClient.grade))}>
                  {selectedRadarClient.grade ?? '?'}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nota do cliente (Score)</p>
                  <p className="text-lg font-bold text-blue-400">{selectedRadarClient.score ?? 0} <span className="text-xs font-normal text-muted-foreground">/100 pontos</span></p>
                  <p className="text-xs text-primary">+ 6 pts vs mês anterior</p>
                </div>
              </div>
            )}
          </div>

          {/* Radar chart or placeholder */}
          {selectedRadarClient && selectedRadarDetails ? (
            <RadarView
              details={selectedRadarDetails}
              score={selectedRadarClient.score}
            />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700/80 bg-[#0c1321]/75 py-20 gap-3 text-muted-foreground">
              <BarChart2 className="w-10 h-10 opacity-20" />
              <p className="text-sm">
                {calculated === 0
                  ? 'Calcule o score de pelo menos um cliente para ver o radar.'
                  : radarClientId
                    ? 'Esse cliente precisa ter o score recalculado para gerar o radar.'
                    : 'Selecione um cliente acima para visualizar o radar.'}
              </p>
              {radarClientId && (
                <Button variant="outline" size="sm" onClick={() => calcScore(radarClientId)} disabled={calculating.has(radarClientId)} className="gap-2">
                  {calculating.has(radarClientId) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Recalcular score
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(client => {
            const isCalc = calculating.has(client.id);
            const isExpanded = expanded.has(client.id);
            return (
              <div key={client.id} className="rounded-xl border border-slate-700/80 bg-[#0c1321]/75 overflow-hidden">
                <div className="flex items-center gap-4 px-4 py-3">
                  <ClientAvatar clientId={client.id} name={client.name} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-foreground truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground">{client.segment}{client.gestor_name ? ` · ${client.gestor_name}` : ''}</p>
                  </div>
                  {client.score !== null ? (
                    <div className="hidden sm:flex items-center gap-3 flex-1 max-w-[200px]">
                      <div className="flex-1 h-2 rounded-full bg-muted">
                        <div className={cn('h-2 rounded-full transition-all', scoreBarColor(client.score))} style={{ width: `${client.score}%` }} />
                      </div>
                      <span className="text-sm font-bold text-foreground w-8 text-right">{client.score}</span>
                    </div>
                  ) : (
                    <span className="hidden sm:block text-xs text-muted-foreground">Não calculado</span>
                  )}
                  <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center text-sm font-black', gradeColor(client.grade))}>
                    {client.grade ?? '?'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={() => calcScore(client.id)} disabled={isCalc} className="h-8 px-2.5 text-xs gap-1">
                      {isCalc ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      {client.score !== null ? 'Atualizar' : 'Calcular'}
                    </Button>
                    {hasScoreDetails(client.details) && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(client.id) ? s.delete(client.id) : s.add(client.id); return s; })}>
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    )}
                  </div>
                </div>
                {isExpanded && hasScoreDetails(client.details) && (
                  <div className="px-4 pb-4 border-t border-border/50">
                    <ScoreBreakdown details={client.details} />
                    {client.calculated_at && (
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Calculado em {new Date(client.calculated_at).toLocaleString('pt-BR')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
              <p className="text-sm text-muted-foreground">Nenhum cliente ativo encontrado.</p>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
