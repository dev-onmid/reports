"use client";

import type { CSSProperties } from 'react';
import { formatCurrencyBRL } from '@/lib/utils';
import {
  ESTADO_LABEL,
  computeAccountScore,
  formatDateTime,
  type ArvoreResumo,
  type TreeNode,
} from '@/lib/optimizer-ui';

// Anel de score (48px), com glow sutil na cor do estado.
function ScoreGauge({ score, ring }: { score: number; ring: string }) {
  const r = 19;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" style={{ flex: 'none' }}>
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
      <circle
        cx="24" cy="24" r={r} fill="none" stroke={ring} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 24 24)"
        style={{ transition: 'stroke-dashoffset 0.5s ease', filter: `drop-shadow(0 0 4px ${ring}66)` }}
      />
      <text x="24" y="29" textAnchor="middle" fontSize="16" fontWeight="500" fill="var(--text-primary)">{score}</text>
    </svg>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1, color: accent ?? 'var(--text-primary)', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

// Hero de saúde da conta — score + estado + resumo executivo + última análise.
export function AccountHealthHero({ resumo, nodes, generatedAt, proximaAnalise }: {
  resumo: ArvoreResumo | null;
  nodes: TreeNode[];
  generatedAt: string | null;
  proximaAnalise: string | null;
}) {
  if (!resumo) return null;
  const estado = ESTADO_LABEL[resumo.estado_da_conta ?? ''] ?? { label: '—', tone: '', ring: '#71717a' };
  const score = computeAccountScore(resumo.estado_da_conta, nodes);

  return (
    <section
      style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center',
        background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '12px 16px',
      }}
    >
      <ScoreGauge score={score} ring={estado.ring} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontSize: 10, fontWeight: 500, color: estado.ring, marginBottom: 2 }}>{estado.label}</span>
          {resumo.semana_analise && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· semana {resumo.semana_analise}</span>}
        </div>
        {resumo.resumo_executivo && (
          <p className="line-clamp-3" style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            {resumo.resumo_executivo}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3" style={{ marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
          <span>{resumo.campanhas} campanhas · {resumo.conjuntos} conjuntos · {resumo.criativos} criativos · {resumo.diagnosticos} diagnósticos</span>
        </div>
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Última análise</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', marginTop: 2 }}>{formatDateTime(generatedAt)}</div>
        {proximaAnalise && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>próxima {proximaAnalise}</div>}
      </div>
    </section>
  );
}

// KPI row separado do card de score — 3 colunas, cards próprios.
export function AccountKpiRow({ resumo }: { resumo: ArvoreResumo | null }) {
  if (!resumo) return null;
  const cm = resumo.cruzamento_com_metas;
  const kpiCard: CSSProperties = { background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '10px 12px' };
  return (
    <div className="grid grid-cols-3 gap-2">
      <div style={kpiCard}><Kpi label="Verba gasta" value={formatCurrencyBRL(cm?.gasto_total ?? 0)} /></div>
      <div style={kpiCard}><Kpi label="Resultados" value={String(cm?.volume_conversoes_atual ?? 0)} accent="var(--text-success)" /></div>
      <div style={kpiCard}><Kpi label="Custo por result." value={cm?.cpl_atual != null ? formatCurrencyBRL(cm.cpl_atual) : '—'} /></div>
    </div>
  );
}
