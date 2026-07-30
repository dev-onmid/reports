"use client";

// Seção "Rastreio" da tela de Início — o resumo da carteira inteira do que as
// rodadas recentes de atribuição destravaram: quanto dos leads tem origem
// identificada, de onde vêm, de que região, e quais criativos produziram
// RESULTADO (não só volume de lead).
//
// Duas fontes, ambas globais (as rotas aceitam clientId opcional; aqui não
// mandamos nenhum, então é a carteira toda):
//   • GET /api/tracking/leads      → summary de atribuição/origem/região
//   • GET /api/creative-library    → criativos agregados do CRM
//
// De propósito NÃO chamamos /api/creative-library/enrich: são segundos de
// latência e quota da Graph API por gasto/CPL/thumbnail — caro demais para um
// resumo de landing. Por isso o card não mostra gasto nem CPL.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clapperboard, Radar, ArrowRight } from 'lucide-react';
import { optimizerDateRangeForPeriod } from '@/lib/optimizer-period-range';
import {
  availableAxes,
  formatAxisValue,
  rankValue,
  sortByAxis,
  type CreativeRankable,
} from '@/lib/creative-library-ui';
import { cn } from '@/lib/utils';

// Períodos oferecidos. `this_month`/`last_month` são mês-calendário em BRT — é o
// motivo de as rotas aceitarem from/to em vez de só uma janela de N dias.
const PERIODOS = [
  { key: 'last_7d', label: '7 dias' },
  { key: 'last_30d', label: '30 dias' },
  { key: 'this_month', label: 'Mês atual' },
  { key: 'last_month', label: 'Mês passado' },
] as const;

type PeriodoKey = (typeof PERIODOS)[number]['key'];

type TrackingSummary = {
  total: number;
  comAtribuicao: number;
  comRegiao: number;
  porOrigem: { label: string; count: number }[];
  porCampanha: { label: string; count: number }[];
  porRegiao: { label: string; count: number }[];
};

type Creative = CreativeRankable & {
  client_name: string | null;
  ad_name: string | null;
  creative_name: string | null;
  ig_leads: number;
  fb_leads: number;
};

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function PeriodChips({ value, onChange }: { value: PeriodoKey; onChange: (v: PeriodoKey) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {PERIODOS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onChange(p.key)}
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors',
            value === p.key
              ? 'bg-primary/15 text-primary'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/** Lista compacta em barra — top N de um breakdown. */
function BreakdownList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { label: string; count: number }[];
  empty: string;
}) {
  const max = items.reduce((m, i) => Math.max(m, i.count), 0);
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {items.slice(0, 5).map((item, i) => (
            <div key={`${item.label}-${i}`} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                {/* A rota já normaliza vazio (ex: '(desconhecida)'), mas não deixamos a
                    linha ficar sem rótulo se algum nulo escapar. */}
                <span className="truncate text-[12px] text-foreground">{item.label || '(não informado)'}</span>
                <span className="shrink-0 text-[11px] font-bold text-muted-foreground">{item.count}</span>
              </div>
              <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${max > 0 ? Math.max((item.count / max) * 100, 3) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RastreioResumoCard({ from, to }: { from: string; to: string }) {
  const [summary, setSummary] = useState<TrackingSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSummary(null);
    setFailed(false);
    fetch(`/api/tracking/leads?from=${from}&to=${to}&limit=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { summary?: TrackingSummary }) => {
        if (!alive) return;
        if (j?.summary) setSummary(j.summary);
        else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [from, to]);

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Radar className="h-4.5 w-4.5 text-foreground" />
        <span className="text-sm font-semibold">Resumo de rastreio</span>
        <Link href="/rastreamento" className="ml-auto text-[11px] font-semibold text-primary hover:underline">
          Ver rastreamento →
        </Link>
      </div>

      {failed ? (
        <p className="text-sm text-muted-foreground">Não foi possível carregar o rastreio agora.</p>
      ) : summary === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : summary.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum lead no período. Leads de anúncio entram aqui automaticamente conforme chegam.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Leads', value: summary.total.toLocaleString('pt-BR') },
              { label: 'Origem identificada', value: `${pct(summary.comAtribuicao, summary.total)}%` },
              { label: 'Com região', value: `${pct(summary.comRegiao, summary.total)}%` },
            ].map((kpi) => (
              <div key={kpi.label} className="rounded-md border border-border bg-muted/20 p-3">
                <p className="text-lg font-bold leading-tight text-foreground">{kpi.value}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{kpi.label}</p>
              </div>
            ))}
          </div>

          {/* ⚠️ Os breakdowns da rota são truncados (top 8/10) — não somam o total.
              Por isso nada de fatia "outros" aqui: seria um número inventado. */}
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <BreakdownList title="Origens" items={summary.porOrigem} empty="Sem origem registrada." />
            <BreakdownList title="Campanhas" items={summary.porCampanha} empty="Sem campanha atribuída." />
            <BreakdownList title="Regiões" items={summary.porRegiao} empty="Sem região identificada." />
          </div>
        </>
      )}
    </section>
  );
}

function TopCriativosCard({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<Creative[] | null>(null);
  const [axis, setAxis] = useState('leads');

  useEffect(() => {
    let alive = true;
    setRows(null);
    fetch(`/api/creative-library?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((j: { creatives?: Creative[] }) => { if (alive) setRows(j?.creatives ?? []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [from, to]);

  const axes = useMemo(() => availableAxes(rows ?? []), [rows]);
  // O eixo escolhido pode desaparecer ao trocar de período (ex: nenhuma venda no
  // mês novo, ou etapa que não existe naquela janela) — cai em Leads sem travar.
  const activeAxis = axes.some((a) => a.key === axis) ? axis : 'leads';
  const top = useMemo(() => sortByAxis(rows ?? [], activeAxis).slice(0, 5), [rows, activeAxis]);

  return (
    <section className="rounded-[var(--radius)] border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Clapperboard className="h-4.5 w-4.5 text-foreground" />
        <span className="text-sm font-semibold">Top criativos</span>
        <Link href="/resultados/criativos" className="ml-auto text-[11px] font-semibold text-primary hover:underline">
          Ver biblioteca →
        </Link>
      </div>

      {rows !== null && rows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ranquear por
          </span>
          {axes.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => setAxis(a.key)}
              className={cn(
                'rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors',
                activeAxis === a.key
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : top.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum criativo com atribuição no período — leads de anúncio entram aqui automaticamente.
        </p>
      ) : (
        <div className="space-y-2.5">
          {top.map((c, i) => {
            const value = rankValue(c, activeAxis);
            return (
              <div key={`${c.ad_name ?? c.creative_name ?? 'x'}-${i}`} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-black text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">
                    {c.ad_name ?? c.creative_name ?? 'Criativo sem nome'}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.client_name ?? ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  {c.ig_leads > 0 && <span className="rounded bg-fuchsia-500/15 px-1 text-[9px] font-black text-fuchsia-400">IG {c.ig_leads}</span>}
                  {c.fb_leads > 0 && <span className="rounded bg-blue-500/15 px-1 text-[9px] font-black text-blue-400">FB {c.fb_leads}</span>}
                  {/* Valor do eixo em destaque; leads como contexto quando o eixo não é leads. */}
                  <span className="font-bold text-primary">
                    {formatAxisValue(activeAxis, value)}
                  </span>
                  {activeAxis !== 'leads' && (
                    <span className="hidden sm:inline">de {c.leads} leads</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RastreioSection() {
  const [periodo, setPeriodo] = useState<PeriodoKey>('last_30d');

  // Resolvido com o helper canônico do projeto (BRT, trata mês-calendário) — não
  // escrever date math nova aqui.
  const { from, to } = useMemo(() => {
    const r = optimizerDateRangeForPeriod(periodo);
    return { from: r.dateFrom, to: r.dateTo };
  }, [periodo]);

  const onChange = useCallback((v: PeriodoKey) => setPeriodo(v), []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground">Rastreio e criativos</p>
        <PeriodChips value={periodo} onChange={onChange} />
      </div>
      <RastreioResumoCard from={from} to={to} />
      <TopCriativosCard from={from} to={to} />
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        Período de {from.split('-').reverse().join('/')} a {to.split('-').reverse().join('/')}.
      </p>
    </div>
  );
}
