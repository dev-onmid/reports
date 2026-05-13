import type { SlideSpec, MetricCard, BarData, FunnelStage } from './types';

export const SLIDE_W = 1200;
export const SLIDE_H = 675;

// ─── Theme helpers ─────────────────────────────────────────────────────────────

export function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '');
  if (h.length < 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

const DARK = {
  text: '#FFFFFF',
  muted: 'rgba(255,255,255,0.50)',
  faint: 'rgba(255,255,255,0.25)',
  accent: '#A855F7',
  green: '#4ADE80',
  cardBg: 'rgba(255,255,255,0.07)',
  cardBorder: 'rgba(255,255,255,0.13)',
  grid: 'rgba(255,255,255,0.07)',
};

const LIGHT = {
  text: '#0F172A',
  muted: 'rgba(15,23,42,0.50)',
  faint: 'rgba(15,23,42,0.28)',
  accent: '#7B21D0',
  green: '#16A34A',
  cardBg: 'rgba(0,0,0,0.04)',
  cardBorder: 'rgba(0,0,0,0.10)',
  grid: 'rgba(0,0,0,0.07)',
};

type Colors = typeof DARK;

// ─── Slide base wrapper ────────────────────────────────────────────────────────

interface BaseProps {
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
  padding?: string;
  children: React.ReactNode;
}

function Base({ theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides, padding, children }: BaseProps) {
  return (
    <div style={{
      width: SLIDE_W,
      height: SLIDE_H,
      position: 'relative',
      overflow: 'hidden',
      background: theme,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      {primaryLogo && (
        <img
          src={primaryLogo}
          alt=""
          style={{ position: 'absolute', top: 30, right: 56, height: 30, objectFit: 'contain', opacity: 0.9 }}
        />
      )}
      {clientLogo && slideIndex === 0 && (
        <img
          src={clientLogo}
          alt=""
          style={{ position: 'absolute', bottom: 56, left: 72, height: 28, objectFit: 'contain', opacity: 0.85 }}
        />
      )}
      {slideIndex > 0 && (
        <span style={{
          position: 'absolute', bottom: 22, right: 56,
          fontSize: 11, letterSpacing: '0.08em',
          color: colors.faint,
        }}>
          {slideIndex + 1}/{totalSlides}
        </span>
      )}
      <div style={{ padding: padding ?? '60px 72px', height: '100%', boxSizing: 'border-box' }}>
        {children}
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ card, colors }: { card: MetricCard; colors: Colors }) {
  const valueColor = card.accent ? colors.green : colors.text;
  return (
    <div style={{
      background: colors.cardBg,
      border: `1px solid ${card.accent ? colors.green + '40' : colors.cardBorder}`,
      borderRadius: 12,
      padding: '22px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 12, color: colors.muted, letterSpacing: '0.04em', lineHeight: 1.3 }}>
        {card.label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 800, color: valueColor, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        {card.value}
      </div>
      {card.sub && (
        <div style={{ fontSize: 11, color: colors.faint, marginTop: 2 }}>
          {card.sub}
        </div>
      )}
    </div>
  );
}

// ─── Bar chart SVG ────────────────────────────────────────────────────────────

function BarChart({ data, colors, valuePrefix = '', valueSuffix = '' }: {
  data: BarData[];
  colors: Colors;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const VW = 1060;
  const CHART_H = 270;
  const LABEL_H = 28;
  const VALUE_PAD = 18;
  const max = Math.max(...data.map(d => d.value), 1);
  const n = data.length;

  const slotW = VW / n;
  const barW = Math.min(72, slotW * 0.62);

  const fmt = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
    return v.toFixed(0);
  };

  // Subtle grid lines at 25%, 50%, 75%
  const gridLines = [0.25, 0.5, 0.75, 1].map(f => ({
    f,
    y: VALUE_PAD + (1 - f) * CHART_H,
  }));

  return (
    <svg
      viewBox={`0 0 ${VW} ${CHART_H + VALUE_PAD + LABEL_H + 6}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {/* Grid lines */}
      {gridLines.map(({ f, y }) => (
        <line key={f} x1={0} y1={y} x2={VW} y2={y} stroke={colors.grid} strokeWidth={1} />
      ))}

      {data.map((d, i) => {
        const slotX = i * slotW;
        const barX = slotX + (slotW - barW) / 2;
        const barH = Math.max(3, (d.value / max) * CHART_H);
        const barY = VALUE_PAD + CHART_H - barH;
        const labelY = VALUE_PAD + CHART_H + 20;
        const valY = barY - 7;

        return (
          <g key={i}>
            {/* Bar with rounded top */}
            <rect x={barX} y={barY} width={barW} height={barH} rx={5} fill={colors.accent} opacity={0.82} />
            {/* Value above bar */}
            <text x={barX + barW / 2} y={valY} textAnchor="middle" fontSize={11} fontWeight="700" fill={colors.text}>
              {valuePrefix}{fmt(d.value)}{valueSuffix}
            </text>
            {/* Category label */}
            <text x={barX + barW / 2} y={labelY} textAnchor="middle" fontSize={12} fill={colors.muted}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Funnel viz ───────────────────────────────────────────────────────────────

function Funnel({ stages, colors }: { stages: FunnelStage[]; colors: Colors }) {
  const maxVal = stages[0]?.value ?? 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
      {stages.map((stage, i) => {
        const pct = stage.value / maxVal;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div style={{ width: 200, fontSize: 14, color: colors.muted, flexShrink: 0, lineHeight: 1.3 }}>
              {stage.label}
            </div>
            <div style={{ flex: 1, height: 44, position: 'relative', background: colors.cardBg, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${pct * 100}%`,
                borderRadius: 8,
                background: `linear-gradient(90deg, ${colors.accent}dd, ${colors.accent}88)`,
                transition: 'width 0.3s',
              }} />
              <span style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 16,
                fontWeight: 800,
                color: pct > 0.25 ? '#fff' : colors.text,
              }}>
                {stage.value.toLocaleString('pt-BR')}
              </span>
            </div>
            {stage.rate && (
              <div style={{ width: 56, fontSize: 14, fontWeight: 700, color: colors.green, textAlign: 'right', flexShrink: 0 }}>
                {stage.rate}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Slide title block ────────────────────────────────────────────────────────

function SlideTitle({ title, subtitle, colors }: { title: string; subtitle?: string; colors: Colors }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: colors.faint, marginBottom: 6 }}>
        Diagnóstico de Performance
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: colors.text, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
        {title}
      </div>
      {subtitle && (
        <div style={{ fontSize: 14, color: colors.muted, marginTop: 6 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

// ─── Insight bar ──────────────────────────────────────────────────────────────

function InsightBar({ text, colors }: { text: string; colors: Colors }) {
  return (
    <div style={{
      marginTop: 'auto',
      paddingTop: 18,
      borderTop: `1px solid ${colors.cardBorder}`,
      fontSize: 13,
      color: colors.muted,
      lineHeight: 1.5,
      fontStyle: 'italic',
    }}>
      {text}
    </div>
  );
}

// ─── Individual slide renderers ───────────────────────────────────────────────

function CoverSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'cover' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  const isLight = isLightColor(theme);
  return (
    <div style={{
      width: SLIDE_W,
      height: SLIDE_H,
      position: 'relative',
      overflow: 'hidden',
      background: theme,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      {/* Decorative glow */}
      <div style={{
        position: 'absolute',
        top: -120,
        right: -120,
        width: 480,
        height: 480,
        borderRadius: '50%',
        background: isLight
          ? 'radial-gradient(circle, rgba(123,33,208,0.12) 0%, transparent 70%)'
          : 'radial-gradient(circle, rgba(168,85,247,0.2) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: -80,
        left: -60,
        width: 320,
        height: 320,
        borderRadius: '50%',
        background: isLight
          ? 'radial-gradient(circle, rgba(123,33,208,0.07) 0%, transparent 70%)'
          : 'radial-gradient(circle, rgba(168,85,247,0.1) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Agency logo top right */}
      {primaryLogo && (
        <img
          src={primaryLogo}
          alt=""
          style={{ position: 'absolute', top: 36, right: 56, height: 32, objectFit: 'contain', opacity: 0.9 }}
        />
      )}

      {/* Client logo bottom left */}
      {clientLogo && (
        <div style={{
          position: 'absolute',
          bottom: 52,
          left: 72,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}>
          <img src={clientLogo} alt="" style={{ height: 36, objectFit: 'contain', opacity: 0.85 }} />
        </div>
      )}

      {/* Slide counter bottom right */}
      <span style={{ position: 'absolute', bottom: 22, right: 56, fontSize: 11, color: colors.faint, letterSpacing: '0.08em' }}>
        {slideIndex + 1}/{totalSlides}
      </span>

      {/* Main content — left aligned, vertically centered */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, bottom: 0,
        width: '65%',
        padding: '0 72px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0,
      }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: colors.faint, marginBottom: 20 }}>
          Diagnóstico de Performance
        </div>
        <div style={{
          fontSize: 52,
          fontWeight: 900,
          color: colors.text,
          lineHeight: 1.08,
          letterSpacing: '-0.03em',
          marginBottom: 16,
        }}>
          {spec.headline}
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: colors.accent, marginBottom: 12 }}>
          {spec.clientName}
        </div>
        <div style={{ fontSize: 16, color: colors.muted }}>
          {spec.period}
        </div>
        {spec.tagline && (
          <div style={{
            marginTop: 32,
            fontSize: 14,
            color: colors.muted,
            lineHeight: 1.6,
            maxWidth: 480,
            borderLeft: `3px solid ${colors.accent}`,
            paddingLeft: 16,
          }}>
            {spec.tagline}
          </div>
        )}
      </div>
    </div>
  );
}

function KpisSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'kpis' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  const cols = Math.min(4, spec.metrics.length);
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SlideTitle title={spec.title} subtitle={spec.subtitle} colors={colors} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 16,
          flex: 1,
          alignContent: 'start',
        }}>
          {spec.metrics.map((m, i) => (
            <KpiCard key={i} card={m} colors={colors} />
          ))}
        </div>
        {spec.insight && <InsightBar text={spec.insight} colors={colors} />}
      </div>
    </Base>
  );
}

function BarChartSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'bar-chart' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SlideTitle title={spec.title} subtitle={spec.subtitle} colors={colors} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <BarChart
            data={spec.data}
            colors={colors}
            valuePrefix={spec.valuePrefix}
            valueSuffix={spec.valueSuffix}
          />
        </div>
        {spec.insight && <InsightBar text={spec.insight} colors={colors} />}
      </div>
    </Base>
  );
}

function FunnelSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'funnel' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SlideTitle title={spec.title} colors={colors} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Funnel stages={spec.stages} colors={colors} />
        </div>
        {spec.insight && <InsightBar text={spec.insight} colors={colors} />}
      </div>
    </Base>
  );
}

function ChannelsSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'channels' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SlideTitle title={spec.title} colors={colors} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${spec.channels.length}, 1fr)`,
          gap: 24,
          flex: 1,
        }}>
          {spec.channels.map((ch, ci) => (
            <div key={ci} style={{
              background: colors.cardBg,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 14,
              padding: '24px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
            }}>
              {/* Channel header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 18,
                paddingBottom: 14,
                borderBottom: `1px solid ${colors.cardBorder}`,
              }}>
                {ch.color && (
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: ch.color, flexShrink: 0 }} />
                )}
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>
                  {ch.name}
                </div>
              </div>
              {/* Metrics */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                {ch.metrics.map((m, mi) => (
                  <div key={mi} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 12, color: colors.muted }}>{m.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: m.accent ? colors.green : colors.text }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {ch.insight && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.cardBorder}`, fontSize: 12, color: colors.muted, fontStyle: 'italic', lineHeight: 1.5 }}>
                  {ch.insight}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Base>
  );
}

function InsightSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'insight' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 820 }}>
        <div style={{
          width: 40,
          height: 4,
          borderRadius: 2,
          background: colors.accent,
          marginBottom: 28,
        }} />
        <div style={{
          fontSize: 40,
          fontWeight: 800,
          color: colors.text,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
          marginBottom: 24,
        }}>
          {spec.headline}
        </div>
        <div style={{
          fontSize: 16,
          color: colors.muted,
          lineHeight: 1.7,
          marginBottom: spec.supporting?.length ? 36 : 0,
        }}>
          {spec.body}
        </div>
        {spec.supporting && spec.supporting.length > 0 && (
          <div style={{
            display: 'flex',
            gap: 24,
            paddingTop: 24,
            borderTop: `1px solid ${colors.cardBorder}`,
          }}>
            {spec.supporting.map((m, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: m.accent ? colors.green : colors.text }}>
                  {m.value}
                </div>
                <div style={{ fontSize: 12, color: colors.muted }}>{m.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Base>
  );
}

function RecommendationsSlide({ spec, theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides }: {
  spec: Extract<SlideSpec, { type: 'recommendations' }>;
  theme: string;
  colors: Colors;
  primaryLogo?: string;
  clientLogo?: string;
  slideIndex: number;
  totalSlides: number;
}) {
  return (
    <Base theme={theme} colors={colors} primaryLogo={primaryLogo} clientLogo={clientLogo} slideIndex={slideIndex} totalSlides={totalSlides}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <SlideTitle title={spec.title} colors={colors} />
        <div style={{
          display: 'grid',
          gridTemplateColumns: spec.items.length > 3 ? 'repeat(2, 1fr)' : '1fr',
          gap: 14,
          flex: 1,
          alignContent: 'start',
        }}>
          {spec.items.map((item, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 18,
              background: colors.cardBg,
              border: `1px solid ${colors.cardBorder}`,
              borderRadius: 12,
              padding: '18px 20px',
              alignItems: 'flex-start',
            }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: colors.accent + '22',
                border: `1px solid ${colors.accent}44`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: 12,
                fontWeight: 800,
                color: colors.accent,
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
                  {item.title}
                </div>
                <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.55 }}>
                  {item.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Base>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function renderSlide(
  spec: SlideSpec,
  theme: string,
  primaryLogo: string | undefined,
  clientLogo: string | undefined,
  slideIndex: number,
  totalSlides: number,
): React.ReactNode {
  const colors = isLightColor(theme) ? LIGHT : DARK;
  const shared = { theme, colors, primaryLogo, clientLogo, slideIndex, totalSlides };

  switch (spec.type) {
    case 'cover':          return <CoverSlide key={slideIndex} spec={spec} {...shared} />;
    case 'kpis':           return <KpisSlide key={slideIndex} spec={spec} {...shared} />;
    case 'bar-chart':      return <BarChartSlide key={slideIndex} spec={spec} {...shared} />;
    case 'funnel':         return <FunnelSlide key={slideIndex} spec={spec} {...shared} />;
    case 'channels':       return <ChannelsSlide key={slideIndex} spec={spec} {...shared} />;
    case 'insight':        return <InsightSlide key={slideIndex} spec={spec} {...shared} />;
    case 'recommendations': return <RecommendationsSlide key={slideIndex} spec={spec} {...shared} />;
    default:               return null;
  }
}
