"use client";

import { type ElementType, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, TrendingUp, Users, Target, RefreshCw,
  Eye, Calendar, ShoppingBag, CheckCircle2, ChevronRight, Info, DollarSign, Users2,
} from 'lucide-react';
import { useInvestmentPayments } from '@/lib/payment-store';
import { clientResults, type ClientFunnel } from '@/lib/client-results-store';
import { useClients } from '@/lib/client-store';
import { ClientAvatar } from '@/components/client-avatar';
import { cn, formatCurrencyBRL } from '@/lib/utils';

type ApiMetrics = {
  meta: { spend: number; impressions: number; clicks: number; leads: number; cpl: number } | null;
  google: { cost: number; impressions: number; clicks: number; cpc: number; conversions: number; cpa: number } | null;
};

type GoalConfig = { type: string; target: number };

function readGoalFromStorage(clientId: string): GoalConfig | null {
  try {
    const stored = localStorage.getItem(`clientGoal_${clientId}`);
    if (!stored) return null;
    return JSON.parse(stored) as GoalConfig;
  } catch { return null; }
}

function calcPct(atual: number, meta: number, inverse = false): number | null {
  if (meta === 0) return null; // sem meta definida → sem cor
  if (atual === 0) return 0;
  const raw = inverse ? (meta / atual) * 100 : (atual / meta) * 100;
  return Math.min(100, Math.round(raw));
}

const NEUTRAL_COLORS = {
  badge:  'bg-muted/30 border-border text-muted-foreground',
  text:   'text-foreground', bar: 'bg-muted', border: 'border-l-border',
};

function pctColors(pct: number | null) {
  if (pct === null) return NEUTRAL_COLORS;
  if (pct >= 75) return {
    badge:  'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
    text:   'text-emerald-300', bar: 'bg-emerald-500', border: 'border-l-emerald-500',
  };
  if (pct >= 30) return {
    badge:  'bg-yellow-500/15 border-yellow-400/30 text-yellow-300',
    text:   'text-yellow-300', bar: 'bg-yellow-400', border: 'border-l-yellow-400',
  };
  return {
    badge:  'bg-red-500/15 border-red-400/30 text-red-300',
    text:   'text-red-300', bar: 'bg-red-500', border: 'border-l-red-500',
  };
}

function MetricCell({ value, pct, format = 'currency', loading = false }: {
  value: number; pct: number | null; format?: 'currency' | 'number'; loading?: boolean;
}) {
  const c = pctColors(pct);
  if (loading) return <span className="text-muted-foreground/40 text-sm">…</span>;
  if (value === 0) return <span className="text-muted-foreground/40 text-sm">—</span>;
  return (
    <p className={cn('text-sm font-bold whitespace-nowrap', c.text)}>
      {format === 'currency' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}
    </p>
  );
}

const FUNNEL_KEYS: (keyof ClientFunnel)[] = ['contatos', 'qualificados', 'agendamentos', 'comparecimentos', 'fechamentos'];
const FUNNEL_LABELS = ['Cont.', 'Qualif.', 'Agend.', 'Comp.', 'Fecha.'];
const FUNNEL_ICONS = [Eye, Users2, Calendar, ShoppingBag, CheckCircle2];
const ZERO_FUNNEL: ClientFunnel = { contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0 };

function ResultSparkline({ color }: { color: string }) {
  return (
    <svg width="100%" height="28" viewBox="0 0 120 28" preserveAspectRatio="none" className="mt-5 opacity-80">
      <path
        d="M0,17 L8,18 L16,18 L24,16 L32,18 L40,15 L48,16 L56,13 L64,13 L72,15 L80,13 L88,17 L96,17 L104,14 L112,17 L120,18"
        fill="none"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResultKpiCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: ElementType;
  color: string;
}) {
  return (
    <div
      className="relative min-h-[170px] overflow-hidden rounded-2xl border border-border bg-card px-7 py-7"
      style={{
        background: `radial-gradient(circle at 11% 36%, ${color}18, transparent 31%), linear-gradient(145deg, rgba(17,22,35,0.92), rgba(8,11,18,0.97))`,
        boxShadow: `0 0 30px ${color}0d, inset 0 0 0 1px rgba(255,255,255,0.025)`,
      }}
    >
      <div className="flex items-start gap-6">
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border"
          style={{
            color,
            borderColor: `${color}38`,
            background: `radial-gradient(circle, ${color}30 0%, ${color}16 72%)`,
            boxShadow: `0 0 24px ${color}22`,
          }}
        >
          <Icon className="h-8 w-8" />
        </span>
        <div className="min-w-0 pt-1">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5" style={{ color }} />
            <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
          </div>
          <p className="mt-3 font-heading font-normal text-3xl leading-none tabular-nums" style={{ color }}>
            {value}
          </p>
        </div>
      </div>
      <div className="absolute bottom-6 left-10 right-8">
        <ResultSparkline color={color} />
      </div>
    </div>
  );
}

export default function ResultadosPage() {
  const { clients } = useClients();
  const { payments } = useInvestmentPayments();
  const [apiMetricsByClient, setApiMetricsByClient] = useState<Record<string, ApiMetrics>>({});
  const [goalsByClient, setGoalsByClient] = useState<Record<string, GoalConfig | null>>({});
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  // Read localStorage goals (client-side only)
  useEffect(() => {
    const goals: Record<string, GoalConfig | null> = {};
    for (const c of clients) goals[c.id] = readGoalFromStorage(c.id);
    setGoalsByClient(goals);
  }, [clients]);

  // Fetch real metrics for all clients
  useEffect(() => {
    if (clients.length === 0) return;
    setLoadingMetrics(true);
    Promise.allSettled(
      clients.map(async (c) => {
        const res = await fetch(`/api/clients/${c.id}/metrics`);
        const data: ApiMetrics = res.ok ? await res.json() : { meta: null, google: null };
        return [c.id, data] as const;
      })
    ).then((results) => {
      const map: Record<string, ApiMetrics> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
      }
      setApiMetricsByClient(map);
    }).finally(() => setLoadingMetrics(false));
  }, [clients]);

  const rows = clients.map((client) => {
    const hardcoded = clientResults.find((r) => r.clientId === client.id);
    const api = apiMetricsByClient[client.id];
    const goal = goalsByClient[client.id];

    const clientPayments = payments.filter((p) => p.clientId === client.id);
    const totalInvest = clientPayments.reduce((s, p) => s + p.amount, 0);
    const dispatchedInvest = clientPayments
      .filter((p) => p.status === 'Pago' || p.status === 'Enviado')
      .reduce((s, p) => s + p.amount, 0);

    // Metrics: prefer real API, fallback to hardcoded
    const leads = api?.meta?.leads ?? hardcoded?.leads ?? 0;
    const cpl = api?.meta?.cpl ?? hardcoded?.cpl ?? 0;
    const cac = api?.google?.cpa ?? hardcoded?.cac ?? 0;
    const resultado = hardcoded?.resultado ?? 0;

    // Goals: prefer localStorage config, fallback to hardcoded
    const metaTarget = (goal?.type === 'revenue' ? goal.target : null) ?? hardcoded?.meta ?? 0;
    const metaLeads = (goal?.type === 'leads' ? goal.target : null) ?? hardcoded?.metaLeads ?? 0;
    const metaCpl = hardcoded?.metaCpl ?? 0;
    const metaCac = hardcoded?.metaCac ?? 0;
    const funil = hardcoded?.funil ?? ZERO_FUNNEL;
    const metaFunil = hardcoded?.metaFunil ?? ZERO_FUNNEL;

    const pctResult = calcPct(resultado, metaTarget);
    const pctLeads  = calcPct(leads, metaLeads);
    const pctCpl    = calcPct(cpl, metaCpl, true);
    const pctCac    = calcPct(cac, metaCac, true);
    const funnelPcts = FUNNEL_KEYS.map((k) => calcPct(funil[k], metaFunil[k]));

    return {
      client, hardcoded, api,
      leads, cpl, cac, resultado,
      metaTarget, metaLeads, metaCpl, metaCac,
      funil, funnelPcts,
      totalInvest, dispatchedInvest,
      pctResult, pctLeads, pctCpl, pctCac,
      gestor: hardcoded?.gestor ?? '',
    };
  });

  const totMeta   = rows.reduce((s, r) => s + r.metaTarget, 0);
  const totResult = rows.reduce((s, r) => s + r.resultado, 0);
  const totLeads  = rows.reduce((s, r) => s + r.leads, 0);
  const totInvest = rows.reduce((s, r) => s + r.totalInvest, 0);
  const overallPct = calcPct(totResult, totMeta);
  const overC = pctColors(overallPct);

  return (
    <div className="space-y-6 pb-8">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-normal text-4xl uppercase leading-none tracking-wide text-foreground">Radar Geral</h1>
          <p className="mt-4 text-lg font-medium text-muted-foreground">
            Métricas reais das contas vinculadas — leads e CPL do Meta Ads, CAC do Google Ads.
          </p>
        </div>
        <div
          className={cn(
            'mt-2 flex h-11 items-center gap-3 rounded-xl border border-border bg-card px-5 text-sm font-bold text-muted-foreground shadow-[0_0_22px_rgba(15,23,42,0.18)]',
            !loadingMetrics && 'opacity-70',
          )}
        >
          <span className={cn('h-2 w-2 rounded-full bg-primary', loadingMetrics && 'animate-pulse shadow-[0_0_12px_rgba(85,245,47,0.55)]')} />
          {loadingMetrics ? 'Atualizando métricas...' : 'Métricas atualizadas'}
          <RefreshCw className={cn('h-4 w-4', loadingMetrics && 'animate-spin')} />
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {([
          { label: 'META TOTAL',      value: formatCurrencyBRL(totMeta),      Icon: Target,     color: '#8b5cf6' },
          { label: 'RESULTADO TOTAL', value: formatCurrencyBRL(totResult),     Icon: TrendingUp, color: overC.text === 'text-emerald-300' ? '#22c55e' : overC.text === 'text-yellow-300' ? '#facc15' : '#ef4444' },
          { label: 'TOTAL DE LEADS',  value: totLeads.toLocaleString('pt-BR'), Icon: Users,      color: '#2f85ff' },
          { label: 'INVESTIMENTO',    value: formatCurrencyBRL(totInvest),     Icon: DollarSign, color: '#f5d000' },
        ] as const).map(({ label, value, Icon, color }) => (
          <ResultKpiCard key={label} label={label} value={value} icon={Icon} color={color} />
        ))}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Info className="h-4 w-4" />
          Legenda
        </span>
        {([
          { label: '≥ 75% da meta',  bg: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' },
          { label: '30 – 74% da meta', bg: 'bg-orange-500/15 border-orange-400/30 text-orange-300' },
          { label: '< 30% da meta',  bg: 'bg-red-500/15 border-red-400/30 text-red-300' },
        ]).map(({ label, bg }) => (
          <span key={label} className={cn('rounded-full border px-5 py-2 text-sm font-bold', bg)}>
            {label}
          </span>
        ))}
        <span className="flex items-center gap-2 text-sm font-semibold italic text-muted-foreground/70">
          <TrendingUp className="h-4 w-4" />
          CPL e CAC: menor = melhor
        </span>
      </div>

      {/* ── Table ── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {[
                  { label: 'CLIENTE', info: false },
                  { label: 'META', info: false },
                  { label: 'RESULTADO', info: false },
                  { label: '%', info: false },
                  { label: 'LEADS', info: false },
                  { label: 'CPL', info: true },
                  { label: 'CAC', info: true },
                  { label: 'FUNIL', info: false },
                  { label: 'INVESTIMENTO', info: true },
                  { label: '', info: false },
                ].map((col) => (
                  <th key={col.label} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                    {col.info ? (
                      <span className="flex items-center gap-1">{col.label} <Info className="w-3 h-3 opacity-50" /></span>
                    ) : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const resultC = pctColors(row.pctResult);
                return (
                  <tr key={row.client.id} className={cn('border-l-[3px] hover:bg-muted/20 transition-colors', resultC.border)}>
                    <td className="px-4 py-3">
                      <Link href={`/clientes/${row.client.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                        <ClientAvatar clientId={row.client.id} name={row.client.name} size="sm" />
                        <div>
                          <p className="text-sm font-bold">{row.client.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{row.client.segment}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold whitespace-nowrap">
                      {row.metaTarget > 0 ? formatCurrencyBRL(row.metaTarget) : <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className={cn('px-4 py-3 text-sm font-bold whitespace-nowrap', row.resultado > 0 ? resultC.text : 'text-red-400')}>
                      {row.resultado > 0 ? formatCurrencyBRL(row.resultado) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.metaTarget > 0 && row.pctResult !== null ? (
                        <span className={cn('text-sm font-bold', resultC.text)}>{row.pctResult}%</span>
                      ) : <span className="text-red-400 text-sm font-bold">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-blue-400">
                      {row.leads > 0 ? row.leads.toLocaleString('pt-BR') : <span className="text-foreground/70">0</span>}
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell value={row.cpl} pct={row.pctCpl} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-3">
                      <MetricCell value={row.cac} pct={row.pctCac} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        {FUNNEL_KEYS.map((key, idx) => {
                          const FunnelIcon = FUNNEL_ICONS[idx];
                          const c = pctColors(row.funnelPcts[idx]);
                          return (
                            <span key={key} className="flex items-center gap-0.5">
                              <span className="flex flex-col items-center min-w-[36px]">
                                <span className={cn('text-[10px] font-bold mb-0.5 tabular-nums', row.funil[key] > 0 ? c.text : 'text-muted-foreground/30')}>
                                  {row.funil[key] > 0 ? row.funil[key] : '—'}
                                </span>
                                <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center', row.funil[key] > 0 ? 'bg-muted/40' : 'bg-muted/20')}>
                                  <FunnelIcon className={cn('w-3.5 h-3.5', row.funil[key] > 0 ? c.text : 'text-muted-foreground/25')} />
                                </span>
                                <span className="text-[8px] text-muted-foreground/40 mt-0.5 whitespace-nowrap">{FUNNEL_LABELS[idx]}</span>
                              </span>
                              {idx < FUNNEL_KEYS.length - 1 && (
                                <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/20 shrink-0 mb-3" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(row.totalInvest)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">{formatCurrencyBRL(row.dispatchedInvest)} enviado</p>
                    </td>
                    <td className="px-2 py-3">
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
