"use client";

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AiUsageMonth, AiUsageBySource, AiUsageBilling, AiUsageProvider } from '@/app/api/ai-usage/route';
import { ESTIMATES, calcCostUsd, USD_TO_BRL } from '@/lib/ai-usage-config';

const SOURCE_LABELS: Record<string, string> = {
  luna_chat:          'Luna IA',
  report_performance: 'Relatório Performance',
  report_delivery:    'Relatório Delivery',
  insights:           'Insights Dashboard',
  copy:               'Variações de Copy',
  whatsapp:           'Variações WhatsApp',
  mindmap:            'Mapa Mental',
  crm_analysis:       'Análise CRM',
  other:              'Outros',
};

function fmtBrl(brl: number) {
  return brl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
}

function fmtUsd(usd: number) {
  return usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
}

function EstimateRow({ source }: { source: string }) {
  const est = ESTIMATES[source];
  if (!est) return null;
  const costBrl = calcCostUsd(est.model, est.inputTokens, est.outputTokens) * USD_TO_BRL;
  return (
    <div className="flex justify-between gap-4 text-[11px] text-muted-foreground">
      <span>{est.labelPt}</span>
      <span className="font-medium tabular-nums">~{fmtBrl(costBrl)}</span>
    </div>
  );
}

export function AIUsagePill() {
  const [month, setMonth] = useState<AiUsageMonth | null>(null);
  const [bySource, setBySource] = useState<AiUsageBySource[]>([]);
  const [billing, setBilling] = useState<AiUsageBilling>(null);
  const [providers, setProviders] = useState<AiUsageProvider[]>([]);

  useEffect(() => {
    fetch('/api/ai-usage')
      .then(r => r.ok ? r.json() : null)
      .then((data: { month: AiUsageMonth; by_source: AiUsageBySource[]; billing?: AiUsageBilling; providers?: AiUsageProvider[] } | null) => {
        if (!data) return;
        setMonth(data.month);
        setBySource(data.by_source);
        setBilling(data.billing ?? null);
        setProviders(data.providers ?? []);
      })
      .catch(() => undefined);
  }, []);

  const costBrl = month?.cost_brl ?? null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs text-violet-400 hover:bg-violet-500/15 transition-colors cursor-default">
          <Zap className="w-3 h-3 shrink-0" />
          <span className="hidden sm:inline tabular-nums">
            {billing ? fmtBrl(billing.balance_brl) : costBrl === null ? '...' : fmtBrl(costBrl)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-80 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Saldo e Consumo de IA</p>
            <p className="text-[11px] text-muted-foreground">Baseado no crédito configurado e no uso registrado pelo sistema.</p>
          </div>

          {billing ? (
            <div className="rounded-lg border border-violet-500/20 bg-violet-500/10 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Saldo estimado disponível</p>
                  <p className="text-lg font-bold text-foreground tabular-nums">{fmtBrl(billing.balance_brl)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Gasto no mês</p>
                  <p className="text-sm font-semibold text-violet-200 tabular-nums">{fmtBrl(billing.used_brl)}</p>
                </div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-background/70 overflow-hidden">
                <div className="h-full rounded-full bg-violet-400" style={{ width: `${billing.used_pct}%` }} />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>Credito total {fmtUsd(billing.credit_usd)}</span>
                <span>{Math.round(billing.used_pct)}% usado</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-100">
              Configure os créditos em Configurações &gt; Uso IA para mostrar saldo disponível e ativar alertas.
            </div>
          )}

          {providers.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {providers.map(provider => (
                <div key={provider.provider} className="rounded-lg border border-border bg-background/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-foreground">{provider.label}</p>
                    <span className="text-[10px] text-muted-foreground">{provider.calls} chamadas</span>
                  </div>
                  <p className="mt-1 text-sm font-bold tabular-nums">{fmtUsd(provider.balance_usd)}</p>
                  <p className="text-[10px] text-muted-foreground">Gasto {fmtUsd(provider.cost_usd)}</p>
                </div>
              ))}
            </div>
          )}

          {month && (
            <div className="space-y-1 border-t border-border pt-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Gasto interno do mês</span>
                <span className="font-semibold text-foreground">{fmtBrl(month.cost_brl)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Chamadas à IA</span>
                <span>{month.calls.toLocaleString('pt-BR')}</span>
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Tokens usados</span>
                <span>{(month.input_tokens + month.output_tokens).toLocaleString('pt-BR')}</span>
              </div>
            </div>
          )}

          {bySource.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <p className="text-[11px] text-muted-foreground font-medium">Por funcionalidade</p>
              {bySource.map(s => (
                <div key={s.source} className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{SOURCE_LABELS[s.source] ?? s.source}</span>
                  <span className="tabular-nums font-medium">{fmtBrl(s.cost_brl)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border pt-2 space-y-1">
            <p className="text-[11px] text-muted-foreground font-medium">Estimativa por ação</p>
            {Object.keys(ESTIMATES).map(s => <EstimateRow key={s} source={s} />)}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
