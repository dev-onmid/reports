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

// ─── Paleta dark premium (comprometida com o tema escuro do Otimizador) ──────
// Hex fixo de propósito: o redesign commita num visual escuro único (aprovado pelo Matheus),
// em camadas, com acento verde ONMID. Superfícies e bordas suaves > preto chapado.
const SURF = '#141416';
const SURF_2 = '#0f0f11';
const BORDER = 'rgba(255,255,255,0.08)';
const TXT = '#fafafa';
const TXT_2 = '#a1a1aa';
const TXT_3 = '#71717a';

// Anel de score compacto (54px), com glow sutil na cor do estado.
function ScoreGauge({ score, ring }: { score: number; ring: string }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" style={{ flex: 'none' }}>
      <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
      <circle
        cx="27" cy="27" r={r} fill="none" stroke={ring} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 27 27)"
        style={{ transition: 'stroke-dashoffset 0.5s ease', filter: `drop-shadow(0 0 4px ${ring}66)` }}
      />
      <text x="27" y="32" textAnchor="middle" fontSize="18" fontWeight="500" fill={TXT}>{score}</text>
    </svg>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: TXT_3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, marginTop: 4, lineHeight: 1, color: accent ?? TXT, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

// Hero de saúde da conta — score + estado + resumo executivo + KPIs, em dark premium.
export function AccountHealthHero({ resumo, nodes, generatedAt, proximaAnalise }: {
  resumo: ArvoreResumo | null;
  nodes: TreeNode[];
  generatedAt: string | null;
  proximaAnalise: string | null;
}) {
  if (!resumo) return null;
  const estado = ESTADO_LABEL[resumo.estado_da_conta ?? ''] ?? { label: '—', tone: '', ring: '#71717a' };
  const score = computeAccountScore(resumo.estado_da_conta, nodes);
  const cm = resumo.cruzamento_com_metas;

  return (
    <section
      style={{
        background: `linear-gradient(180deg, ${SURF}, ${SURF_2})`,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '14px 18px',
      }}
    >
      {/* Score header: [ring] [status + resumo] [última análise] */}
      <div
        className="grid items-center gap-3"
        style={{ gridTemplateColumns: '54px minmax(0,1fr) auto' }}
      >
        <ScoreGauge score={score} ring={estado.ring} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span style={{ fontSize: 11, fontWeight: 500, color: estado.ring }}>{estado.label}</span>
            {resumo.semana_analise && <span style={{ fontSize: 11, color: TXT_3 }}>· semana {resumo.semana_analise}</span>}
          </div>
          {resumo.resumo_executivo && (
            <p className="line-clamp-3" style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.5, color: TXT_2 }}>
              {resumo.resumo_executivo}
            </p>
          )}
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div style={{ fontSize: 11, color: TXT_3 }}>Última análise</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: TXT, whiteSpace: 'nowrap' }}>{formatDateTime(generatedAt)}</div>
          {proximaAnalise && <div style={{ fontSize: 11, color: TXT_3 }}>próxima {proximaAnalise}</div>}
        </div>
      </div>

      {/* Rodapé: estrutura da conta */}
      <div
        className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 pt-3"
        style={{ fontSize: 11, color: TXT_3, borderTop: `1px solid ${BORDER}` }}
      >
        <span>{resumo.campanhas} campanhas · {resumo.conjuntos} conjuntos · {resumo.criativos} criativos · {resumo.diagnosticos} diagnósticos</span>
      </div>
    </section>
  );
}

// KPI row separado do card de score — 3 colunas, cards próprios (spec de layout).
export function AccountKpiRow({ resumo }: { resumo: ArvoreResumo | null }) {
  if (!resumo) return null;
  const cm = resumo.cruzamento_com_metas;
  const kpiCard: CSSProperties = { background: SURF, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '12px 14px' };
  return (
    <div className="grid grid-cols-3 gap-[10px]">
      <div style={kpiCard}><Kpi label="Verba gasta" value={formatCurrencyBRL(cm?.gasto_total ?? 0)} /></div>
      <div style={kpiCard}><Kpi label="Resultados" value={String(cm?.volume_conversoes_atual ?? 0)} accent="#55f52f" /></div>
      <div style={kpiCard}><Kpi label="Custo por result." value={cm?.cpl_atual != null ? formatCurrencyBRL(cm.cpl_atual) : '—'} /></div>
    </div>
  );
}
