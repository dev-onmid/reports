"use client";

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { AiUsageMonth, AiUsageBySource } from '@/app/api/ai-usage/route';
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

  useEffect(() => {
    fetch('/api/ai-usage')
      .then(r => r.ok ? r.json() : null)
      .then((data: { month: AiUsageMonth; by_source: AiUsageBySource[] } | null) => {
        if (!data) return;
        setMonth(data.month);
        setBySource(data.by_source);
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
            {costBrl === null ? '...' : fmtBrl(costBrl)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="w-64 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Consumo IA — este mês</p>
            <p className="text-[11px] text-muted-foreground">Tokens registrados internamente</p>
          </div>

          {month && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Gasto total</span>
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
