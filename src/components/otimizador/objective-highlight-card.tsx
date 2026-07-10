"use client";

import { cn, formatCurrencyBRL } from '@/lib/utils';
import { SEV, resumoDoObjetivo, type TreeNode } from '@/lib/optimizer-ui';

// Card de destaque por objetivo — leitura de reunião, read-only. Mostra verba, resultados e custo
// por resultado do objetivo (com o rótulo certo: "Conversas"/"Custo por conversa" etc.) + pill de
// saúde. Sem botão de ação, sem jargão técnico.
export function ObjectiveHighlightCard({ objetivo, nodes }: { objetivo: string; nodes: TreeNode[] }) {
  const r = resumoDoObjetivo(nodes);
  const sev = SEV[r.piorSeveridade];
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Verba gasta', value: formatCurrencyBRL(r.gasto) },
    { label: r.rotulos.resultado, value: r.resultados.toLocaleString('pt-BR') },
    { label: r.rotulos.custo, value: r.custo != null ? formatCurrencyBRL(r.custo) : '—' },
  ];
  return (
    <div className="rounded-[12px] border border-border bg-card/90 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-foreground">{objetivo}</h3>
          <p className="text-xs text-muted-foreground">{r.campanhas} campanha{r.campanhas === 1 ? '' : 's'}</p>
        </div>
        <span className={cn('shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold', sev.badge)}>{sev.label}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[var(--radius)] bg-background/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-1.5 whitespace-nowrap text-xl font-bold text-foreground">{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
