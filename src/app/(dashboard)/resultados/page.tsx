"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, TrendingUp, Users, Wallet, Target, RefreshCw } from 'lucide-react';
import { useInvestmentPayments } from '@/lib/payment-store';
import { clientResults, type ClientFunnel } from '@/lib/client-results-store';
import { useClients } from '@/lib/client-store';
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
const ZERO_FUNNEL: ClientFunnel = { contatos: 0, qualificados: 0, agendamentos: 0, comparecimentos: 0, fechamentos: 0 };

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resultado Geral</h1>
          <p className="text-muted-foreground mt-1">
            Métricas reais das contas vinculadas — leads e CPL do Meta Ads, CAC do Google Ads.
          </p>
        </div>
        {loadingMetrics && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Atualizando métricas...
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          { label: 'Meta Total',      value: formatCurrencyBRL(totMeta),       icon: Target,     tone: 'text-foreground' as const },
          { label: 'Resultado Total', value: formatCurrencyBRL(totResult),      icon: TrendingUp, tone: overC.text as string },
          { label: 'Total de Leads',  value: totLeads.toLocaleString('pt-BR'),  icon: Users,      tone: 'text-foreground' as const },
          { label: 'Investimento',    value: formatCurrencyBRL(totInvest),      icon: Wallet,     tone: 'text-foreground' as const },
        ] as const).map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
              <Icon className={cn('w-4 h-4 shrink-0', tone)} />
            </div>
            <p className={cn('text-2xl font-bold font-heading mt-3', tone)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Legenda</span>
        {([
          { label: '≥ 75% da meta', badge: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' },
          { label: '30 – 74%',       badge: 'bg-yellow-500/15 border-yellow-400/30 text-yellow-300' },
          { label: '< 30% da meta',  badge: 'bg-red-500/15 border-red-400/30 text-red-300' },
        ] as const).map(({ label, badge }) => (
          <span key={label} className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-bold', badge)}>
            {label}
          </span>
        ))}
        <span className="text-[10px] text-muted-foreground/60 italic">CPL e CAC: menor = melhor</span>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {['Gestor', 'Cliente', 'Meta', 'Resultado', '%', 'Leads', 'CPL', 'CAC', 'Funil', 'Investimento'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const resultC = pctColors(row.pctResult);
                return (
                  <tr key={row.client.id} className={cn('border-l-[3px] hover:bg-muted/20 transition-colors', resultC.border)}>
                    <td className="px-4 py-4 text-sm font-semibold whitespace-nowrap">{row.gestor || '—'}</td>
                    <td className="px-4 py-4">
                      <Link href={`/clientes/${row.client.id}`} className="text-sm font-bold hover:text-primary transition-colors">
                        {row.client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">{row.client.segment}</p>
                    </td>
                    <td className="px-4 py-4 text-sm font-semibold whitespace-nowrap">
                      {row.metaTarget > 0 ? formatCurrencyBRL(row.metaTarget) : '—'}
                    </td>
                    <td className={cn('px-4 py-4 text-sm font-bold whitespace-nowrap', resultC.text)}>
                      {row.resultado > 0 ? formatCurrencyBRL(row.resultado) : '—'}
                    </td>
                    <td className="px-4 py-4">
                      {row.metaTarget > 0 && row.resultado > 0 ? (
                        <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                          <div className={cn('h-full rounded-full', resultC.bar)} style={{ width: `${row.pctResult ?? 0}%` }} />
                        </div>
                      ) : <span className="text-muted-foreground/40 text-sm">—</span>}
                    </td>
                    <td className="px-4 py-4">
                      <MetricCell value={row.leads} pct={row.pctLeads} format="number" loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-4">
                      <MetricCell value={row.cpl} pct={row.pctCpl} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-4">
                      <MetricCell value={row.cac} pct={row.pctCac} loading={loadingMetrics && !apiMetricsByClient[row.client.id]} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-0.5">
                        {FUNNEL_KEYS.map((key, idx) => {
                          const c = pctColors(row.funnelPcts[idx]);
                          return (
                            <span key={key} className="flex items-start gap-0.5">
                              <span className="flex flex-col items-center min-w-[36px]">
                                <span className={cn('text-xs font-bold leading-tight', row.funil[key] > 0 ? c.text : 'text-muted-foreground/30')}>
                                  {row.funil[key] > 0 ? row.funil[key] : '—'}
                                </span>
                                <span className="text-[9px] text-muted-foreground/40 leading-tight mt-0.5">{FUNNEL_LABELS[idx]}</span>
                              </span>
                              {idx < FUNNEL_KEYS.length - 1 && (
                                <ArrowRight className="w-2.5 h-2.5 mt-1 text-muted-foreground/25 shrink-0" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(row.totalInvest)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">
                        {formatCurrencyBRL(row.dispatchedInvest)} enviado
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" colSpan={2}>Total Geral</td>
                <td className="px-4 py-3 text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(totMeta)}</td>
                <td className={cn('px-4 py-3 text-sm font-bold whitespace-nowrap', overC.text)}>{formatCurrencyBRL(totResult)}</td>
                <td className="px-4 py-3">
                  <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                    <div className={cn('h-full rounded-full', overC.bar)} style={{ width: `${overallPct}%` }} />
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold">{totLeads.toLocaleString('pt-BR')}</td>
                <td colSpan={3} />
                <td className="px-4 py-3 text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(totInvest)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
