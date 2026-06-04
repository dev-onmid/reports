'use client';

import type {
  OmniReportData, ReportPage, MonthPoint,
  CoverPage, ExecutiveSummaryPage, GrowthChartPage,
  NewCustomersPage, ExplanationCardsPage, ComparisonTablePage,
  CostPerCustomerPage, ReachImpressionsPage, MetricHighlightPage,
  DiagnosisPage, InsightsPage, RecommendationsPage, ActionPlanPage, ConclusionPage,
} from './types';

// ── Design tokens ─────────────────────────────────────────────────────────────
const G   = '#22c55e';  // ONMID green
const GL  = '#f0fdf4';  // green light bg
const GB  = '#bbf7d0';  // green border
const B   = '#3b82f6';  // blue (secondary)
const BL  = '#eff6ff';  // blue light bg
const TX  = '#111827';  // primary text
const TG  = '#6b7280';  // muted text
const TM  = '#374151';  // medium text
const R   = '#ef4444';  // red (negative)

const PAGE: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16/9',
  background: '#ffffff',
  fontFamily: '"Inter", "Segoe UI", sans-serif',
  overflow: 'hidden',
  boxSizing: 'border-box',
  padding: '5% 5.5%',
};

const DECO_RING: React.CSSProperties = {
  position: 'absolute', right: '-4%', top: '-10%',
  width: '38%', height: '80%',
  border: '1.5px solid rgba(34,197,94,0.12)',
  borderRadius: '50%', pointerEvents: 'none',
};

const DECO_RING2: React.CSSProperties = {
  position: 'absolute', right: '-2%', top: '5%',
  width: '28%', height: '58%',
  border: '1px solid rgba(34,197,94,0.07)',
  borderRadius: '50%', pointerEvents: 'none',
};

const GLOW: React.CSSProperties = {
  position: 'absolute', right: '4%', top: '10%',
  width: '22%', height: '42%',
  background: 'radial-gradient(circle, rgba(34,197,94,0.14) 0%, transparent 70%)',
  pointerEvents: 'none',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString('pt-BR');
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace('.', ',')}k`;
  return n.toLocaleString('pt-BR');
}

// ── ONMID Logo ─────────────────────────────────────────────────────────────────

function OnmidLogo({ size = 1 }: { size?: number }) {
  const h = Math.round(22 * size);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 * size }}>
      <span style={{ fontSize: h, fontWeight: 800, letterSpacing: '-0.03em', color: TX, lineHeight: 1 }}>onmid</span>
      <svg width={h * 1.6} height={h * 0.9} viewBox="0 0 32 18" fill="none">
        <rect width="32" height="18" rx="9" fill={TX} />
        <circle cx="23" cy="9" r="6.5" fill={G} />
      </svg>
      <span style={{ fontSize: h * 0.55, color: TG, fontWeight: 500 }}>®</span>
    </div>
  );
}

// ── Icon circle ───────────────────────────────────────────────────────────────

const ICON_PATHS: Record<string, React.ReactNode> = {
  person:   <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />,
  target:   <><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
  dollar:   <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  chart:    <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
  book:     <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>,
  eye:      <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  star:     <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
  trophy:   <><path d="M8 21h8M12 21v-6m0 0a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9z"/><path d="M5 3H3v2a3 3 0 0 0 3 3M19 3h2v2a3 3 0 0 1-3 3"/></>,
  arrow:    <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
  filter:   <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>,
  megaphone:<><path d="M3 11l19-9-9 19-2-8-8-2z"/></>,
  users:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  tag:      <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>,
  cart:     <><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>,
  refresh:  <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,
  idea:     <><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></>,
};

function ICircle({ icon, size = 44, green = true }: { icon: string; size?: number; green?: boolean }) {
  const color = green ? G : B;
  const bg = green ? GL : BL;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {ICON_PATHS[icon] ?? <circle cx="12" cy="12" r="8" />}
      </svg>
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────

function BarChart({ data, color = G, highlightLastColor, h = 180 }: {
  data: MonthPoint[]; color?: string; highlightLastColor?: string; h?: number;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  const n = data.length;
  const COL = 50;
  const W = n * COL;
  const CHART_H = h - 22;
  const BAR_W = Math.min(28, COL * 0.7);
  const BAR_X = (COL - BAR_W) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%' }} preserveAspectRatio="xMidYMax meet">
      {data.map((d, i) => {
        const barH = Math.max((d.value / max) * CHART_H, 2);
        const x = i * COL + BAR_X;
        const y = CHART_H - barH;
        const isLast = i === n - 1 && !!highlightLastColor;
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH} rx="2" fill={isLast ? highlightLastColor! : color} />
            <text x={x + BAR_W / 2} y={Math.max(y - 3, 11)} textAnchor="middle" fontSize="9" fontWeight="700" fill={TM} fontFamily="Inter, sans-serif">
              {fmtShort(d.value)}
            </text>
            <text x={i * COL + COL / 2} y={h - 2} textAnchor="middle" fontSize="8" fill={TG} fontFamily="Inter, sans-serif">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function DualChart({ barData, lineData, h = 180 }: { barData: MonthPoint[]; lineData: MonthPoint[]; h?: number }) {
  const maxBar = Math.max(...barData.map(d => d.value), 1);
  const maxLine = Math.max(...lineData.map(d => d.value), 1);
  const n = barData.length;
  const COL = 50;
  const W = n * COL;
  const CHART_H = h - 22;
  const BAR_W = 28;
  const BAR_X = (COL - BAR_W) / 2;

  const linePoints = lineData.map((d, i) => {
    const x = i * COL + COL / 2;
    const y = CHART_H - (d.value / maxLine) * CHART_H;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%' }} preserveAspectRatio="xMidYMax meet">
      {barData.map((d, i) => {
        const barH = Math.max((d.value / maxBar) * CHART_H, 2);
        const x = i * COL + BAR_X;
        const y = CHART_H - barH;
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH} rx="2" fill={G} />
            <text x={x + BAR_W / 2} y={Math.max(y - 3, 11)} textAnchor="middle" fontSize="9" fontWeight="700" fill={TM} fontFamily="Inter, sans-serif">
              {fmtShort(d.value)}
            </text>
            <text x={i * COL + COL / 2} y={h - 2} textAnchor="middle" fontSize="8" fill={TG} fontFamily="Inter, sans-serif">
              {d.label}
            </text>
          </g>
        );
      })}
      <polyline points={linePoints} fill="none" stroke={B} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {lineData.map((d, i) => {
        const x = i * COL + COL / 2;
        const y = CHART_H - (d.value / maxLine) * CHART_H;
        return (
          <g key={`pt-${i}`}>
            <circle cx={x} cy={y} r="4" fill="white" stroke={B} strokeWidth="2" />
            <text x={x + 8} y={y - 3} fontSize="8" fill={B} fontWeight="700" fontFamily="Inter, sans-serif">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function MovingAvgChart({ barData, avgData, h = 200 }: { barData: MonthPoint[]; avgData: MonthPoint[]; h?: number }) {
  const max = Math.max(...barData.map(d => d.value), 1);
  const n = barData.length;
  const COL = 50;
  const W = n * COL;
  const CHART_H = h - 22;
  const BAR_W = 28;
  const BAR_X = (COL - BAR_W) / 2;

  const avgPts = avgData.map((d, i) => {
    const x = i * COL + COL / 2;
    const y = CHART_H - (d.value / max) * CHART_H;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${h}`} style={{ width: '100%' }} preserveAspectRatio="xMidYMax meet">
      {barData.map((d, i) => {
        const barH = Math.max((d.value / max) * CHART_H, 2);
        const x = i * COL + BAR_X;
        const y = CHART_H - barH;
        const isLast = i === n - 1;
        return (
          <g key={i}>
            <rect x={x} y={y} width={BAR_W} height={barH} rx="2" fill={isLast ? '#93c5fd' : G} />
            <text x={x + BAR_W / 2} y={Math.max(y - 3, 11)} textAnchor="middle" fontSize="9" fontWeight="700" fill={TM} fontFamily="Inter, sans-serif">
              {d.value}
            </text>
            <text x={i * COL + COL / 2} y={h - 2} textAnchor="middle" fontSize="8" fill={TG} fontFamily="Inter, sans-serif">
              {d.label}
            </text>
          </g>
        );
      })}
      {avgData.length > 1 && (
        <polyline points={avgPts} fill="none" stroke={B} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'white', borderRadius: 14, boxShadow: '0 2px 16px rgba(0,0,0,0.07)', padding: '4%', ...style }}>
      {children}
    </div>
  );
}

function GreenCard({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: GL, border: `1.5px solid ${GB}`, borderRadius: 14, padding: '4%', ...style }}>
      {children}
    </div>
  );
}

function ClientCard({ name, size = 1 }: { name: string; size?: number }) {
  const fs = 16 * size;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 * size, background: 'white', borderRadius: 12 * size, boxShadow: '0 2px 12px rgba(0,0,0,0.07)', padding: `${8 * size}px ${16 * size}px` }}>
      <ICircle icon="person" size={32 * size} />
      <span style={{ fontSize: fs, fontWeight: 800, color: TX }}>{name}</span>
    </div>
  );
}

// ── Shared title block ─────────────────────────────────────────────────────────

function PageTitle({ title, highlight, subtitle, size = 1 }: { title: string; highlight?: string; subtitle?: string; size?: number }) {
  const base = 34 * size;
  const rendered = highlight
    ? title.split(highlight).map((part, i, arr) => (
      <span key={i}>{part}{i < arr.length - 1 && <span style={{ color: G }}>{highlight}</span>}</span>
    ))
    : title;

  return (
    <div>
      <h1 style={{ fontSize: base, fontWeight: 900, lineHeight: 1.08, color: TX, margin: 0, whiteSpace: 'pre-line' }}>
        {rendered}
      </h1>
      {subtitle && <p style={{ fontSize: base * 0.37, color: TG, marginTop: 6 * size, fontWeight: 500 }}>{subtitle}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// PAGE COMPONENTS
// ──────────────────────────────────────────────────────────────────────────────

function RenderCover({ page }: { page: CoverPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={DECO_RING2} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '6%', width: '55%' }}>
        <PageTitle title={page.title} highlight={page.titleHighlight} size={1.15} />
        <p style={{ fontSize: 13, color: TG, marginTop: 8, fontWeight: 500 }}>{page.subtitle}</p>
        <div style={{ marginTop: '5%' }}>
          <ClientCard name={page.clientName} />
        </div>
        <div style={{ marginTop: '5%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { icon: '📅', label: 'Período analisado:', value: page.period },
            { icon: '🗄', label: 'Fontes:', value: page.sources },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: GL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>{icon}</div>
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: TM }}>{label} </span>
                <span style={{ fontSize: 11, color: TG }}>{value}</span>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: GL, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <ICircle icon="target" size={20} />
            </div>
            <div>
              <span style={{ fontSize: 11, fontWeight: 700, color: TM }}>Objetivo do relatório: </span>
              <span style={{ fontSize: 11, color: TG }}>{page.objective}</span>
            </div>
          </div>
        </div>
      </div>
      {/* Right side: real summary metrics or decorative chart */}
      <div style={{ position: 'absolute', right: '5%', top: '15%', width: '34%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Card style={{ padding: '5%' }}>
          <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', gap: 5 }}>
            {[30, 45, 35, 60, 80, 70, 90].map((v, i) => (
              <div key={i} style={{ flex: 1, height: v + '%', background: i === 6 ? '#93c5fd' : G, borderRadius: '3px 3px 0 0', opacity: 0.8 }} />
            ))}
          </div>
        </Card>
        {page.summaryMetrics && page.summaryMetrics.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {page.summaryMetrics.map(({ label, value, accent }) => {
              const color = accent === 'green' ? G : accent === 'blue' ? B : TM;
              return (
                <Card key={label} style={{ padding: '8%' }}>
                  <div style={{ fontSize: 9, color: TG, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function RenderExecutiveSummary({ page }: { page: ExecutiveSummaryPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '4%' }}>
        <PageTitle title={'Resumo\nExecutivo'} highlight="Executivo" subtitle="O que os dados mostram?" />
      </div>
      <div style={{ marginTop: '3%' }}>
        <Card style={{ padding: '3% 4%', display: 'flex', alignItems: 'center', gap: 20 }}>
          <ICircle icon="target" size={44} />
          <p style={{ fontSize: 15, fontWeight: 700, color: TX, lineHeight: 1.45, margin: 0 }}>{page.mainStatement}</p>
        </Card>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 14 }}>
        {page.cards.map((card) => (
          <Card key={card.number} style={{ padding: '4%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: G, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>{card.number}</span>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: TX }}>{card.title}</span>
            </div>
            <p style={{ fontSize: 11, color: TG, margin: 0, lineHeight: 1.5 }}>{card.description}</p>
            <div style={{ marginTop: 12, height: 28, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
              {[40, 55, 50, 70, 65, 85].map((v, i) => (
                <div key={i} style={{ flex: 1, height: v + '%', background: i === 5 ? (card.number === '02' ? B : G) : (card.number === '02' ? BL : GL), borderRadius: '2px 2px 0 0' }} />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <GreenCard style={{ marginTop: 14, padding: '2.5% 4%', display: 'flex', alignItems: 'center', gap: 16 }}>
        <ICircle icon="arrow" size={34} />
        <p style={{ fontSize: 12, margin: 0, color: TX, lineHeight: 1.5 }}>
          A análise dos dados mostra <strong>{page.readout}</strong>
        </p>
        <div style={{ marginLeft: 'auto', width: 28, height: 28, borderRadius: '50%', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={G} strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </GreenCard>
    </div>
  );
}

function RenderGrowthChart({ page }: { page: GrowthChartPage }) {
  const { insight } = page;
  const growthPositive = !insight.growthPct.startsWith('-');
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '4%', marginTop: '3%', height: '85%' }}>
        <div>
          <PageTitle title={page.title} highlight={page.titleHighlight} subtitle={page.subtitle} />
          <Card style={{ marginTop: '4%', padding: '3%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ICircle icon="users" size={30} />
              <span style={{ fontSize: 12, fontWeight: 700, color: TX }}>{page.subtitle}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: G }} />
                  <span style={{ fontSize: 9, color: TG }}>Cadastros</span>
                </div>
                {page.movingAvgData && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 18, height: 2, background: B, borderRadius: 1 }} />
                    <span style={{ fontSize: 9, color: TG }}>Média móvel (3 meses)</span>
                  </div>
                )}
              </div>
            </div>
            <MovingAvgChart barData={page.chartData} avgData={page.movingAvgData ?? []} h={160} />
          </Card>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card>
            <div style={{ fontSize: 10, fontWeight: 700, color: TG, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Destaque do período</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: TG }}>{insight.prevLabel}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: TX }}>{insight.prevValue}</div>
                <div style={{ fontSize: 10, color: TG }}>cadastros</div>
              </div>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: GL, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke={G} strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 10, color: G, fontWeight: 700 }}>{insight.currLabel}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: G }}>{insight.currValue}</div>
                <div style={{ fontSize: 10, color: G, fontWeight: 700 }}>cadastros</div>
              </div>
            </div>
            <div style={{ background: growthPositive ? GL : '#fef2f2', border: `1px solid ${growthPositive ? GB : '#fca5a5'}`, borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: growthPositive ? G : R }}>{insight.growthPct}</div>
              <div style={{ fontSize: 10, color: growthPositive ? '#16a34a' : '#dc2626', fontWeight: 600, marginTop: 2 }}>Crescimento</div>
            </div>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 8, marginTop: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="white" strokeWidth="2.5"><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/><circle cx="12" cy="12" r="10"/></svg>
              </div>
              <p style={{ fontSize: 10, color: TM, margin: 0, lineHeight: 1.4 }}>{insight.comment}</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RenderNewCustomers({ page }: { page: NewCustomersPage }) {
  const medals = ['🥇', '🥈', '🥉'];
  const medalColors = ['#d97706', '#6b7280', '#b45309'];
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '4%', marginTop: '3%', height: '85%' }}>
        <div>
          <PageTitle title={'Novos clientes\nadquiridos'} highlight="adquiridos" subtitle="Clientes que fizeram o primeiro pedido" />
          <Card style={{ marginTop: '4%', padding: '3%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ICircle icon="person" size={30} />
              <span style={{ fontSize: 12, fontWeight: 700, color: TX }}>Novos clientes adquiridos</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: G }} />
                <span style={{ fontSize: 9, color: TG }}>Novos clientes</span>
              </div>
            </div>
            <BarChart data={page.chartData} color={G} h={160} />
          </Card>
        </div>
        <div>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <ICircle icon="trophy" size={34} />
              <span style={{ fontSize: 13, fontWeight: 800, color: TX }}>Melhores meses<br />de aquisição</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {page.ranking.slice(0, 3).map((r, i) => (
                <div key={r.label} style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: 12, padding: '10px 14px', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: `${medalColors[i]}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {medals[i]}
                    </div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: TX }}>{r.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: G }}>{r.value} <span style={{ fontSize: 10, fontWeight: 600, color: TG }}>novos clientes</span></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RenderExplanationCards({ page }: { page: ExplanationCardsPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '4%' }}>
        <PageTitle title={page.title} highlight={page.titleHighlight} />
      </div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginTop: '5%', height: '62%', minWidth: 0 }}>
        {page.cards.map((card, i) => (
          <div key={card.number} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <Card style={{ flex: 1, padding: '5%', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, height: '100%', boxSizing: 'border-box' }}>
              <ICircle icon={['person', 'dollar', 'book'][i] as string} size={52} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: G, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'white' }}>{card.number}</span>
                  </div>
                  <div style={{ height: 2, width: 30, background: G, borderRadius: 1 }} />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: TX, margin: '0 0 8px' }}>{card.title}</h3>
                <p style={{ fontSize: 11, color: TG, margin: 0, lineHeight: 1.55 }}>{card.description}</p>
                {card.highlight && (
                  <div style={{ marginTop: 10, background: GL, border: `1px solid ${GB}`, borderRadius: 6, padding: '6px 10px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: G }}>{card.highlight}</span>
                  </div>
                )}
              </div>
            </Card>
            {i < page.cards.length - 1 && (
              <div style={{ width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke={G} strokeWidth="2.5">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderComparisonTable({ page }: { page: ComparisonTablePage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '2.5%' }}>
        <h1 style={{ fontSize: 36, fontWeight: 900, color: TX, margin: 0 }}>
          {page.month1} x <span style={{ color: G }}>{page.month2}</span>
        </h1>
        <p style={{ fontSize: 13, color: TG, marginTop: 4 }}>Evolução do mês anterior</p>
      </div>
      <Card style={{ marginTop: '3%', padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', color: G, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ICircle icon="person" size={18} /> Indicador</div>
              </th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: TM, fontWeight: 700, fontSize: 11 }}>{page.month1}</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: G, fontWeight: 700, fontSize: 11 }}>{page.month2}</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', color: G, fontWeight: 700, fontSize: 11 }}>Variação</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, i) => (
              <tr key={row.label} style={{ borderBottom: '1px solid #f8fafc', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                <td style={{ padding: '9px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: GL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{row.icon}</div>
                  <span style={{ fontWeight: 500, color: TM }}>{row.label}</span>
                </td>
                <td style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 500, color: TM }}>{row.value1}</td>
                <td style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 700, color: G }}>{row.value2}</td>
                <td style={{ padding: '9px 14px', textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    <span style={{ fontWeight: 700, color: row.positive ? G : R }}>{row.variation}</span>
                    <div style={{ width: 18, height: 18, borderRadius: 4, background: row.positive ? GL : '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {row.positive
                        ? <svg viewBox="0 0 24 24" width="10" height="10" fill={G}><path d="M12 3 L3 21 L12 14 L21 21 Z"/></svg>
                        : <svg viewBox="0 0 24 24" width="10" height="10" fill={R}><path d="M12 21 L3 3 L12 10 L21 3 Z"/></svg>}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginTop: 12 }}>
        <Card style={{ padding: '3%', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <ICircle icon="target" size={32} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: TX, marginBottom: 3 }}>Leitura principal</div>
            <p style={{ fontSize: 11, color: TG, margin: 0, lineHeight: 1.5 }}>{page.readout}</p>
          </div>
        </Card>
        <GreenCard style={{ padding: '3% 4%', display: 'flex', alignItems: 'center', gap: 10, minWidth: 200 }}>
          <ICircle icon="arrow" size={28} />
          <p style={{ fontSize: 12, fontWeight: 700, color: G, margin: 0, lineHeight: 1.4 }}>{page.insight}</p>
        </GreenCard>
      </div>
    </div>
  );
}

function RenderCostPerCustomer({ page }: { page: CostPerCustomerPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '3%', marginTop: '2%', height: '90%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <PageTitle title={'Custo por\nnovo cliente'} highlight="novo cliente" subtitle="Quanto custou adquirir um novo comprador?" />
              {page.clientName && <div style={{ marginTop: 12 }}><ClientCard name={page.clientName} size={0.8} /></div>}
            </div>
          </div>
          <Card style={{ padding: '3%' }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 10, color: TG }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 10, height: 10, borderRadius: 2, background: G }} />Custo por novo cliente (R$)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 16, height: 2, background: B, borderRadius: 1 }} />Novos clientes</div>
            </div>
            <DualChart barData={page.barData} lineData={page.lineData} h={130} />
          </Card>
          <Card style={{ padding: '0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                  {[
                    { icon: '📅', label: 'Período' },
                    { icon: '💲', label: 'Investimento' },
                    { icon: '👥', label: 'Novos clientes' },
                    { icon: '💰', label: 'Custo por novo cliente' },
                  ].map(({ icon, label }) => (
                    <th key={label} style={{ padding: '7px 10px', textAlign: 'left', color: G, fontWeight: 700, fontSize: 9, textTransform: 'uppercase' }}>
                      {icon} {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.tableRows.map((row, i) => (
                  <tr key={row.period} style={{ borderBottom: '1px solid #f8fafc', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '6px 10px', color: TM }}>{row.period}</td>
                    <td style={{ padding: '6px 10px', color: TM }}>{row.investment}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'center', color: TM, fontWeight: 600 }}>{row.newCustomers}</td>
                    <td style={{ padding: '6px 10px', fontWeight: 700, color: row.costNum === Math.min(...page.tableRows.map(r => r.costNum)) ? G : TM }}>{row.costPerCustomer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <div>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <ICircle icon="star" size={34} />
              <span style={{ fontSize: 13, fontWeight: 800, color: TX, lineHeight: 1.3 }}>Melhor<br />eficiência</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {page.ranking.map((r, i) => (
                <div key={r.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: G, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: 'white' }}>{i + 1}</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: TX }}>{r.label}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: G }}>{r.value}</div>
                  <div style={{ fontSize: 9, color: TG }}>por novo cliente</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RenderReachImpressions({ page }: { page: ReachImpressionsPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 220px', gap: '3%', marginTop: '2%', height: '90%' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <PageTitle title={'Alcance e\nimpressões'} highlight="impressões" subtitle="" />
              <p style={{ fontSize: 11, color: TG, marginTop: 8, lineHeight: 1.55, maxWidth: '90%' }}>{page.context}</p>
            </div>
            <div style={{ flexShrink: 0 }}><ClientCard name={page.clientName} size={0.75} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 10, marginTop: 14, height: '55%' }}>
            <Card style={{ padding: '3%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <ICircle icon="eye" size={24} />
                <span style={{ fontSize: 11, fontWeight: 700, color: TX }}>Impressões por mês</span>
              </div>
              <BarChart data={page.impressionsData} color={G} h={100} />
            </Card>
            <Card style={{ padding: '3%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <ICircle icon="users" size={24} green={false} />
                <span style={{ fontSize: 11, fontWeight: 700, color: TX }}>Alcance somado por mês</span>
              </div>
              <BarChart data={page.reachData} color={B} h={100} />
            </Card>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card>
            <ICircle icon="arrow" size={34} />
            <p style={{ fontSize: 13, fontWeight: 800, color: G, marginTop: 10, lineHeight: 1.35 }}>{page.highlightLabel}</p>
            <p style={{ fontSize: 10, color: TG, marginTop: 6, lineHeight: 1.5 }}>
              Com <strong style={{ color: G }}>{fmtK(page.highlightValue)}</strong> {page.highlightDesc}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function RenderMetricHighlight({ page }: { page: MetricHighlightPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '4%' }}>
        <PageTitle title={page.title} highlight={page.titleHighlight} subtitle={page.subtitle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginTop: '4%' }}>
        {page.metrics.map((m) => (
          <Card key={m.label} style={{ textAlign: 'center', padding: '5%' }}>
            <div style={{ fontSize: 10, color: TG, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>{m.label}</div>
            <div style={{ fontSize: 26, fontWeight: 900, color: G }}>{m.value}</div>
          </Card>
        ))}
      </div>
      <GreenCard style={{ marginTop: 20, padding: '3% 4%' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: TX, margin: 0, lineHeight: 1.5 }}>{page.insight}</p>
      </GreenCard>
    </div>
  );
}

// ── Diagnosis ─────────────────────────────────────────────────────────────────

const ACCENT_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  positive:    { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a', icon: '#22c55e' },
  negative:    { bg: '#fef2f2', border: '#fca5a5', text: '#dc2626', icon: '#ef4444' },
  opportunity: { bg: '#eff6ff', border: '#bfdbfe', text: '#2563eb', icon: '#3b82f6' },
  neutral:     { bg: '#f8fafc', border: '#e2e8f0', text: '#475569', icon: '#64748b' },
};

function RenderDiagnosis({ page }: { page: DiagnosisPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '3%' }}>
        <PageTitle title={'Diagnóstico\nGeral'} highlight="Geral" subtitle="O que os dados revelam sobre o negócio?" />
      </div>
      <Card style={{ marginTop: '3%', padding: '3% 4%', display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <ICircle icon="target" size={38} />
        <p style={{ fontSize: 14, fontWeight: 700, color: TX, lineHeight: 1.5, margin: 0 }}>{page.mainStatement}</p>
      </Card>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
        {page.items.slice(0, 6).map((item, i) => {
          const a = ACCENT_COLORS[item.accent] ?? ACCENT_COLORS.neutral;
          return (
            <div key={i} style={{ background: a.bg, border: `1.5px solid ${a.border}`, borderRadius: 12, padding: '4%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ICircle icon={item.icon} size={28} green={item.accent !== 'opportunity'} />
                <span style={{ fontSize: 11, fontWeight: 700, color: a.text }}>{item.title}</span>
              </div>
              <p style={{ fontSize: 10, color: TM, margin: 0, lineHeight: 1.5 }}>{item.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Insights ──────────────────────────────────────────────────────────────────

function RenderInsights({ page }: { page: InsightsPage }) {
  const list = page.insights.slice(0, 5);
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '4%', marginTop: '3%', height: '84%' }}>
        <div>
          <PageTitle title={'Principais\nInsights'} highlight="Insights" />
          <p style={{ fontSize: 11, color: TG, marginTop: 8, lineHeight: 1.55 }}>
            Os dados deste período revelam pontos estratégicos que merecem atenção imediata.
          </p>
          <GreenCard style={{ marginTop: 16, padding: '5%' }}>
            <ICircle icon="idea" size={32} />
            <p style={{ fontSize: 11, color: TX, fontWeight: 600, marginTop: 8, lineHeight: 1.5 }}>
              Cada insight está conectado a uma evidência real dos dados.
            </p>
          </GreenCard>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map((ins, i) => (
            <Card key={i} style={{ padding: '3% 4%', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: G, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>{ins.number}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: TX, marginBottom: 3 }}>{ins.title}</div>
                <p style={{ fontSize: 10, color: TM, margin: 0, lineHeight: 1.5 }}>{ins.body}</p>
                {ins.evidence && (
                  <div style={{ marginTop: 5, display: 'inline-flex', alignItems: 'center', gap: 4, background: GL, border: `1px solid ${GB}`, borderRadius: 4, padding: '2px 7px' }}>
                    <span style={{ fontSize: 9, color: G, fontWeight: 600 }}>{ins.evidence}</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Recommendations ───────────────────────────────────────────────────────────

function RenderRecommendations({ page }: { page: RecommendationsPage }) {
  const groups = page.groups.slice(0, 4);
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '3%' }}>
        <PageTitle title={'Recomendações'} highlight="Recomendações" subtitle="O que fazer a partir deste relatório" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, 1fr)`, gap: 12, marginTop: '3%' }}>
        {groups.map((group, i) => (
          <Card key={i} style={{ padding: '4%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ICircle icon={group.icon} size={30} />
              <span style={{ fontSize: 12, fontWeight: 800, color: TX }}>{group.category}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.slice(0, 4).map((item, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: GL, border: `1.5px solid ${GB}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke={G} strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <p style={{ fontSize: 10, color: TM, margin: 0, lineHeight: 1.5 }}>{item}</p>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <GreenCard style={{ marginTop: 14, padding: '2.5% 4%', display: 'flex', alignItems: 'center', gap: 16 }}>
        <ICircle icon="arrow" size={30} />
        <p style={{ fontSize: 12, fontWeight: 700, color: G, margin: 0 }}>{page.highlight}</p>
      </GreenCard>
    </div>
  );
}

// ── Action Plan ───────────────────────────────────────────────────────────────

const URGENCY_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  alta:  { bg: '#fef2f2', text: '#dc2626', label: 'Alta' },
  média: { bg: '#fffbeb', text: '#d97706', label: 'Média' },
  baixa: { bg: '#f0fdf4', text: '#16a34a', label: 'Baixa' },
};

function RenderActionPlan({ page }: { page: ActionPlanPage }) {
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '4%', marginTop: '3%', height: '84%' }}>
        <div>
          <PageTitle title={'Plano de\nAção'} highlight="Ação" />
          <p style={{ fontSize: 11, color: TG, marginTop: 8 }}>Foco: <strong style={{ color: TX }}>{page.month}</strong></p>
          <Card style={{ marginTop: 14, padding: '5%' }}>
            <ICircle icon="target" size={32} />
            <p style={{ fontSize: 12, fontWeight: 700, color: TX, marginTop: 8, lineHeight: 1.45 }}>{page.mainFocus}</p>
          </Card>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(URGENCY_STYLE).map(([key, s]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: s.bg, border: `1.5px solid ${s.text}` }} />
                <span style={{ fontSize: 9, color: TG, fontWeight: 600 }}>Prioridade {s.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {page.actions.slice(0, 5).map((action, i) => {
            const s = URGENCY_STYLE[action.urgency] ?? URGENCY_STYLE.média;
            return (
              <Card key={i} style={{ padding: '3% 4%', display: 'flex', gap: 14, alignItems: 'flex-start', borderLeft: `3px solid ${s.text}` }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: s.text }}>{action.priority}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: TX, margin: '0 0 3px' }}>{action.what}</p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: GL, borderRadius: 4, padding: '2px 8px' }}>
                    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke={G} strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                    <span style={{ fontSize: 9, color: G, fontWeight: 600 }}>Métrica: {action.metric}</span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Conclusion ────────────────────────────────────────────────────────────────

function RenderConclusion({ page }: { page: ConclusionPage }) {
  const blocks = [
    { icon: 'chart',  label: 'Resumo do período', text: page.summary },
    { icon: 'idea',   label: 'Principal aprendizado', text: page.mainLearning },
    { icon: 'star',   label: 'Maior oportunidade', text: page.biggestOpportunity },
    { icon: 'target', label: 'Próximo foco estratégico', text: page.nextFocus },
  ];
  return (
    <div style={PAGE}>
      <div style={DECO_RING} /><div style={DECO_RING2} /><div style={GLOW} />
      <OnmidLogo />
      <div style={{ marginTop: '3%' }}>
        <PageTitle title={'Conclusão'} highlight="Conclusão" subtitle="Visão ampla do período e próximos passos" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: '4%', height: '68%' }}>
        {blocks.map((b, i) => (
          <Card key={i} style={{ padding: '5%', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ICircle icon={b.icon} size={32} green={i !== 1} />
              <span style={{ fontSize: 11, fontWeight: 700, color: TG, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{b.label}</span>
            </div>
            <p style={{ fontSize: 12, color: TX, margin: 0, lineHeight: 1.6, fontWeight: i === 0 ? 600 : 400 }}>{b.text}</p>
          </Card>
        ))}
      </div>
      <GreenCard style={{ marginTop: 14, padding: '2.5% 4%', display: 'flex', alignItems: 'center', gap: 14 }}>
        <ICircle icon="arrow" size={28} />
        <p style={{ fontSize: 12, fontWeight: 700, color: TX, margin: 0 }}>
          Relatório gerado pela <span style={{ color: G }}>ONMID</span> · {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
        </p>
      </GreenCard>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────

function RenderPage({ page }: { page: ReportPage }) {
  switch (page.type) {
    case 'cover':                return <RenderCover page={page} />;
    case 'executive_summary':    return <RenderExecutiveSummary page={page} />;
    case 'growth_chart':         return <RenderGrowthChart page={page} />;
    case 'new_customers':        return <RenderNewCustomers page={page} />;
    case 'explanation_cards':    return <RenderExplanationCards page={page} />;
    case 'comparison_table':     return <RenderComparisonTable page={page} />;
    case 'cost_per_customer':    return <RenderCostPerCustomer page={page} />;
    case 'reach_impressions':    return <RenderReachImpressions page={page} />;
    case 'metric_highlight':     return <RenderMetricHighlight page={page} />;
    case 'diagnosis':            return <RenderDiagnosis page={page} />;
    case 'insights_page':        return <RenderInsights page={page} />;
    case 'recommendations':      return <RenderRecommendations page={page} />;
    case 'action_plan':          return <RenderActionPlan page={page} />;
    case 'conclusion':           return <RenderConclusion page={page} />;
    default:                     return null;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function OmniPerformanceTemplate({ data }: { data: OmniReportData }) {
  return (
    <div className="report-outer" style={{ background: '#f4f4f5', minHeight: '100vh', padding: '32px 24px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

        @page {
          size: A4 landscape;
          margin: 0;
        }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          /* Hide everything outside the report */
          .no-print { display: none !important; }

          /* Each slide = one A4 landscape page */
          .report-page-wrapper {
            page-break-after: always;
            break-after: page;
            margin: 0 !important;
            padding: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            /* A4 landscape: 297mm × 210mm — fit 16:9 within height */
            width: 297mm !important;
            height: 167.0625mm !important; /* 297 * 9/16 */
            overflow: hidden !important;
          }

          /* No blank page after the last slide */
          .report-page-wrapper:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }

          /* Outer container resets */
          .report-outer {
            background: white !important;
            padding: 0 !important;
            min-height: unset !important;
          }
          .report-pages {
            max-width: unset !important;
            margin: 0 !important;
            gap: 0 !important;
          }
        }
      `}</style>

      {/* Print button */}
      <div className="no-print" style={{ maxWidth: 960, margin: '0 auto 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={() => window.print()}
          style={{ background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Exportar PDF
        </button>
      </div>

      {/* Pages */}
      <div className="report-pages" style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
        {data.pages.map((page, i) => (
          <div key={i} className="report-page-wrapper" style={{ borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 32px rgba(0,0,0,0.12)' }}>
            <RenderPage page={page} />
          </div>
        ))}
      </div>
    </div>
  );
}
