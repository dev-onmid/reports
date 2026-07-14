"use client";

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

// Anel de score refinado, com glow sutil na cor do estado.
function ScoreGauge({ score, ring }: { score: number; ring: string }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - score / 100);
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" style={{ flex: 'none' }}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
      <circle
        cx="48" cy="48" r={r} fill="none" stroke={ring} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        style={{ transition: 'stroke-dashoffset 0.5s ease', filter: `drop-shadow(0 0 5px ${ring}66)` }}
      />
      <text x="48" y="46" textAnchor="middle" fontSize="27" fontWeight="700" fill={TXT}>{score}</text>
      <text x="48" y="62" textAnchor="middle" fontSize="10" fill={TXT_3} letterSpacing="0.08em">SCORE</text>
    </svg>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: TXT_3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: accent ?? TXT, whiteSpace: 'nowrap' }}>{value}</div>
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
        borderRadius: 14,
        padding: 20,
      }}
    >
      {/* Topo: score + estado + resumo */}
      <div className="flex flex-wrap items-center gap-5">
        <ScoreGauge score={score} ring={estado.ring} />
        <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5"
              style={{ padding: '3px 11px', borderRadius: 20, background: `${estado.ring}1f`, color: estado.ring, fontSize: 12, fontWeight: 600 }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: estado.ring, boxShadow: `0 0 8px ${estado.ring}` }} />
              {estado.label}
            </span>
            {resumo.semana_analise && <span style={{ fontSize: 12, color: TXT_3 }}>semana {resumo.semana_analise}</span>}
          </div>
          {resumo.resumo_executivo && (
            <p className="line-clamp-3" style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.55, color: '#d4d4d8' }}>
              {resumo.resumo_executivo}
            </p>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div
        className="mt-5 grid grid-cols-2 gap-4 pt-5 sm:grid-cols-3"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        <Kpi label="Verba gasta" value={formatCurrencyBRL(cm?.gasto_total ?? 0)} />
        <Kpi label="Resultados" value={String(cm?.volume_conversoes_atual ?? 0)} accent="#55f52f" />
        <Kpi label="Custo por result." value={cm?.cpl_atual != null ? formatCurrencyBRL(cm.cpl_atual) : '—'} />
      </div>

      {/* Rodapé: estrutura + última análise */}
      <div
        className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1"
        style={{ fontSize: 12, color: TXT_3 }}
      >
        <span>{resumo.campanhas} campanhas · {resumo.conjuntos} conjuntos · {resumo.criativos} criativos</span>
        <span style={{ color: TXT_2 }}>·</span>
        <span>{resumo.diagnosticos} diagnósticos</span>
        <span style={{ marginLeft: 'auto' }}>Última análise: {formatDateTime(generatedAt)}{proximaAnalise ? ` · próxima ${proximaAnalise}` : ''}</span>
      </div>
    </section>
  );
}
