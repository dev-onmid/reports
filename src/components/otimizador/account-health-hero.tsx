"use client";

import { cn, formatCurrencyBRL } from '@/lib/utils';
import {
  ESTADO_LABEL,
  computeAccountScore,
  formatDateTime,
  type ArvoreResumo,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Anel de progresso (SVG) — mostra o score 0-100 (heurística client-side em computeAccountScore).
function ScoreGauge({ score, ring, size = 80 }: { score: number; ring: string; size?: number }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <div className="relative shrink-0" style={{ height: size, width: size }}>
      <svg viewBox="0 0 80 80" className="-rotate-90" style={{ height: size, width: size }}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeWidth="8" className="text-border/70" />
        <circle cx="40" cy="40" r={r} fill="none" stroke={ring} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-foreground">{score}</span>
        <span className="text-[9px] text-muted-foreground">/100</span>
      </div>
    </div>
  );
}

// Hero de saúde da conta — score + estado + resumo executivo + KPIs. Limpo o bastante pra mostrar
// numa reunião (o modo apresentação reusa esta leitura).
export function AccountHealthHero({ resumo, nodes, generatedAt, proximaAnalise }: {
  resumo: ArvoreResumo | null;
  nodes: TreeNode[];
  generatedAt: string | null;
  proximaAnalise: string | null;
}) {
  if (!resumo) return null;
  const estado = ESTADO_LABEL[resumo.estado_da_conta ?? ''] ?? { label: '—', tone: 'text-muted-foreground', ring: '#8b8b8b' };
  const score = computeAccountScore(resumo.estado_da_conta, nodes);
  const cm = resumo.cruzamento_com_metas;
  const stats: Array<{ label: string; value: string }> = [
    { label: 'Verba gasta', value: formatCurrencyBRL(cm?.gasto_total ?? 0) },
    { label: 'Conversões', value: String(cm?.volume_conversoes_atual ?? 0) },
    { label: 'Custo por conversão', value: cm?.cpl_atual != null ? formatCurrencyBRL(cm.cpl_atual) : '—' },
    { label: 'Campanhas', value: String(resumo.campanhas) },
    { label: 'Conjuntos', value: String(resumo.conjuntos) },
    { label: 'Criativos', value: String(resumo.criativos) },
  ];
  return (
    <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(420px,1fr)_minmax(500px,1.3fr)]">
      <section className="flex items-start gap-4 rounded-[var(--radius)] border border-border bg-card/90 p-4">
        <ScoreGauge score={score} ring={estado.ring} />
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={cn('text-sm font-bold uppercase tracking-wide', estado.tone)}>{estado.label}</span>
              <span className="text-xs text-muted-foreground">Performance {score >= 70 ? 'acima' : score >= 45 ? 'próxima' : 'abaixo'} do ideal</span>
              {resumo.semana_analise && <span className="text-xs text-muted-foreground">· semana {resumo.semana_analise}</span>}
            </div>
            {resumo.resumo_executivo && <p className="line-clamp-3 text-sm leading-relaxed text-foreground">{resumo.resumo_executivo}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Última análise: {formatDateTime(generatedAt)}</span>
            {proximaAnalise && <span>Próxima automática: {proximaAnalise}</span>}
            <span className="rounded border border-border/70 bg-background px-1.5 py-0.5 font-semibold text-foreground">{resumo.diagnosticos} diagnósticos</span>
          </div>
        </div>
      </section>
      <section className="grid grid-cols-3 overflow-hidden rounded-[var(--radius)] border border-border bg-card/90">
        {stats.map((s, index) => (
          <div
            key={s.label}
            className={cn(
              'min-h-[78px] px-4 py-3',
              index % 3 !== 0 && 'border-l border-border/70',
              index > 2 && 'border-t border-border/70',
            )}
          >
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-2 whitespace-nowrap text-xl font-bold leading-none text-foreground">{s.value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
