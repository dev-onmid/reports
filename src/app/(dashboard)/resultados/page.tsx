"use client";

import Link from 'next/link';
import { ArrowRight, TrendingUp, Users, Wallet, Target } from 'lucide-react';
import { useInvestmentPayments } from '@/lib/payment-store';
import { clientResults, type ClientFunnel } from '@/lib/client-results-store';
import { mockClients } from '@/lib/mock-data';
import { useClients } from '@/lib/client-store';
import { cn, formatCurrencyBRL } from '@/lib/utils';

// For "higher is better": pct = atual / meta * 100
// For "lower is better": pct = meta / atual * 100  (above 100 = beating goal, capped at 100)
function calcPct(atual: number, meta: number, inverse = false): number {
  if (meta === 0) return 100;
  const raw = inverse ? (meta / atual) * 100 : (atual / meta) * 100;
  return Math.min(100, Math.round(raw));
}

function pctColors(pct: number) {
  if (pct >= 75) return {
    badge:  'bg-emerald-500/15 border-emerald-400/30 text-emerald-300',
    text:   'text-emerald-300',
    bar:    'bg-emerald-500',
    border: 'border-l-emerald-500',
  };
  if (pct >= 30) return {
    badge:  'bg-yellow-500/15 border-yellow-400/30 text-yellow-300',
    text:   'text-yellow-300',
    bar:    'bg-yellow-400',
    border: 'border-l-yellow-400',
  };
  return {
    badge:  'bg-red-500/15 border-red-400/30 text-red-300',
    text:   'text-red-300',
    bar:    'bg-red-500',
    border: 'border-l-red-500',
  };
}

// Compact colored metric cell: value + small badge with %
function MetricCell({ value, pct, format = 'currency' }: {
  value: number;
  pct: number;
  format?: 'currency' | 'number';
}) {
  const c = pctColors(pct);
  return (
    <p className={cn('text-sm font-bold whitespace-nowrap', c.text)}>
      {format === 'currency' ? formatCurrencyBRL(value) : value.toLocaleString('pt-BR')}
    </p>
  );
}

const FUNNEL_KEYS: (keyof ClientFunnel)[] = [
  'contatos', 'qualificados', 'agendamentos', 'comparecimentos', 'fechamentos',
];
const FUNNEL_LABELS = ['Cont.', 'Qualif.', 'Agend.', 'Comp.', 'Fecha.'];

export default function ResultadosPage() {
  const { clients } = useClients();
  const { payments } = useInvestmentPayments();
  const visibleClientIds = new Set(clients.map((client) => client.id));

  const rows = clientResults.filter((r) => visibleClientIds.has(r.clientId)).map((r) => {
    const client = mockClients.find((c) => c.id === r.clientId)!;

    const clientPayments = payments.filter((p) => p.clientId === r.clientId);
    const totalInvest      = clientPayments.reduce((s, p) => s + p.amount, 0);
    const dispatchedInvest = clientPayments
      .filter((p) => p.status === 'Pago' || p.status === 'Enviado')
      .reduce((s, p) => s + p.amount, 0);

    const pctResult = calcPct(r.resultado, r.meta);
    const pctLeads  = calcPct(r.leads, r.metaLeads);
    const pctCpl    = calcPct(r.cpl, r.metaCpl, true);   // inverse
    const pctCac    = calcPct(r.cac, r.metaCac, true);   // inverse

    const funnelPcts = FUNNEL_KEYS.map((k) =>
      calcPct(r.funil[k], r.metaFunil[k]),
    );

    return {
      r, client,
      totalInvest, dispatchedInvest,
      pctResult, pctLeads, pctCpl, pctCac, funnelPcts,
    };
  });

  const totMeta    = rows.reduce((s, r) => s + r.r.meta, 0);
  const totResult  = rows.reduce((s, r) => s + r.r.resultado, 0);
  const totLeads   = rows.reduce((s, r) => s + r.r.leads, 0);
  const totInvest  = rows.reduce((s, r) => s + r.totalInvest, 0);
  const overallPct = calcPct(totResult, totMeta);
  const overC      = pctColors(overallPct);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Resultado Geral</h1>
        <p className="text-muted-foreground mt-1">
          Visão consolidada — cada métrica colorida conforme atingimento da meta.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {([
          { label: 'Meta Total',       value: formatCurrencyBRL(totMeta),            icon: Target,    tone: 'text-foreground' as const },
          { label: 'Resultado Total',  value: formatCurrencyBRL(totResult),           icon: TrendingUp, tone: overC.text as string },
          { label: 'Total de Leads',   value: totLeads.toLocaleString('pt-BR'),       icon: Users,     tone: 'text-foreground' as const },
          { label: 'Investimento',     value: formatCurrencyBRL(totInvest),           icon: Wallet,    tone: 'text-foreground' as const },
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
          { label: '≥ 75% da meta',  badge: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300' },
          { label: '30 – 74%',        badge: 'bg-yellow-500/15 border-yellow-400/30 text-yellow-300'   },
          { label: '< 30% da meta',   badge: 'bg-red-500/15 border-red-400/30 text-red-300'            },
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
          <table className="min-w-[1400px] w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  'Gestor', 'Cliente', 'Meta', 'Resultado', '%',
                  'Leads', 'CPL', 'CAC',
                  'Funil',
                  'Investimento',
                ].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
              {/* Meta sub-header */}
              <tr className="border-b border-border/50 bg-muted/10">
                <td colSpan={2} />
                {[
                  { value: totMeta,  fmt: 'currency' },
                ] .map(({ value, fmt }, i) => (
                  <td key={i} className="px-4 py-1.5 text-[10px] text-muted-foreground/60 whitespace-nowrap">
                    {fmt === 'currency' ? formatCurrencyBRL(value) : value}
                  </td>
                ))}
                <td />
                <td />
                {/* leads meta */}
                <td className="px-4 py-1.5 text-[10px] text-muted-foreground/60">
                  meta {clientResults.map(r => r.metaLeads).join(' / ')}
                </td>
                {/* cpl meta */}
                <td className="px-4 py-1.5 text-[10px] text-muted-foreground/60 whitespace-nowrap">
                  meta ≤ {formatCurrencyBRL(Math.max(...clientResults.map(r => r.metaCpl)))}
                </td>
                {/* cac meta */}
                <td className="px-4 py-1.5 text-[10px] text-muted-foreground/60 whitespace-nowrap">
                  meta ≤ {formatCurrencyBRL(Math.max(...clientResults.map(r => r.metaCac)))}
                </td>
                <td colSpan={2} />
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {rows.map(({ r, client, totalInvest, dispatchedInvest, pctResult, pctLeads, pctCpl, pctCac, funnelPcts }) => {
                const resultC = pctColors(pctResult);
                return (
                  <tr
                    key={r.clientId}
                    className={cn('border-l-[3px] hover:bg-muted/20 transition-colors', resultC.border)}
                  >
                    {/* Gestor */}
                    <td className="px-4 py-4 text-sm font-semibold whitespace-nowrap">{r.gestor}</td>

                    {/* Cliente */}
                    <td className="px-4 py-4">
                      <Link href={`/clientes/${r.clientId}`} className="text-sm font-bold hover:text-primary transition-colors">
                        {client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5">{client.segment}</p>
                    </td>

                    {/* Meta */}
                    <td className="px-4 py-4 text-sm font-semibold whitespace-nowrap">
                      {formatCurrencyBRL(r.meta)}
                    </td>

                    {/* Resultado */}
                    <td className={cn('px-4 py-4 text-sm font-bold whitespace-nowrap', resultC.text)}>
                      {formatCurrencyBRL(r.resultado)}
                    </td>

                    {/* % — barra de progresso */}
                    <td className="px-4 py-4">
                      <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                        <div className={cn('h-full rounded-full', resultC.bar)} style={{ width: `${pctResult}%` }} />
                      </div>
                    </td>

                    {/* Leads */}
                    <td className="px-4 py-4">
                      <MetricCell value={r.leads} pct={pctLeads} format="number" />
                    </td>

                    {/* CPL */}
                    <td className="px-4 py-4">
                      <MetricCell value={r.cpl} pct={pctCpl} />
                    </td>

                    {/* CAC */}
                    <td className="px-4 py-4">
                      <MetricCell value={r.cac} pct={pctCac} />
                    </td>

                    {/* Funil */}
                    <td className="px-4 py-4">
                      <div className="flex items-start gap-0.5">
                        {FUNNEL_KEYS.map((key, idx) => {
                          const c = pctColors(funnelPcts[idx]);
                          return (
                            <span key={key} className="flex items-start gap-0.5">
                              <span className="flex flex-col items-center min-w-[36px]">
                                <span className={cn('text-xs font-bold leading-tight', c.text)}>
                                  {r.funil[key]}
                                </span>
                                <span className="text-[9px] text-muted-foreground/40 leading-tight mt-0.5">
                                  {FUNNEL_LABELS[idx]}
                                </span>
                              </span>
                              {idx < FUNNEL_KEYS.length - 1 && (
                                <ArrowRight className="w-2.5 h-2.5 mt-1 text-muted-foreground/25 shrink-0" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* Investimento */}
                    <td className="px-4 py-4">
                      <p className="text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(totalInvest)}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 whitespace-nowrap">
                        {formatCurrencyBRL(dispatchedInvest)} enviado
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Footer totals */}
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground" colSpan={2}>
                  Total Geral
                </td>
                <td className="px-4 py-3 text-sm font-bold whitespace-nowrap">{formatCurrencyBRL(totMeta)}</td>
                <td className={cn('px-4 py-3 text-sm font-bold whitespace-nowrap', overC.text)}>
                  {formatCurrencyBRL(totResult)}
                </td>
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
