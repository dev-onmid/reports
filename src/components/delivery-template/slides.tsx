import React from 'react';
import type { DeliveryReportData, DailyData, RegionData, ProductData } from './types';

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  green:      '#22C55E',
  greenLight: '#DCFCE7',
  greenMid:   '#86EFAC',
  greenDark:  '#16A34A',
  text:       '#111827',
  muted:      '#6B7280',
  faint:      '#9CA3AF',
  border:     '#E5E7EB',
  bg:         '#FFFFFF',
  red:        '#EF4444',
  redLight:   '#FEE2E2',
  redMid:     '#FCA5A5',
  blue:       '#3B82F6',
  blueLight:  '#DBEAFE',
  blueMid:    '#93C5FD',
  purple:     '#8B5CF6',
  purpleLight:'#EDE9FE',
  cardBg:     '#F9FAFB',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function brl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n: number): string {
  return n.toLocaleString('pt-BR');
}
function pctDelta(a: number, b: number): { text: string; up: boolean } {
  if (b === 0) return { text: '—', up: true };
  const v = ((a - b) / b) * 100;
  return { text: (v >= 0 ? '+' : '') + v.toFixed(1) + '%', up: v >= 0 };
}

// ── Shared brand components ────────────────────────────────────────────────────

function OnmidLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontWeight: 900, fontSize: 22, color: C.text, letterSpacing: '-0.04em', lineHeight: 1 }}>onmid</span>
      <svg width={44} height={24} viewBox="0 0 44 24" style={{ flexShrink: 0 }}>
        <rect x="0" y="0" width="44" height="24" rx="12" fill={C.green} />
        <circle cx="32" cy="12" r="9" fill="white" />
      </svg>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginTop: -10 }}>®</span>
    </div>
  );
}

function SlideCounter({ current, total }: { current: number; total: number }) {
  const cur = String(current).padStart(2, '0');
  const tot = String(total).padStart(2, '0');
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, fontFamily: 'inherit' }}>
      <span style={{ fontSize: 18, fontWeight: 800, color: C.text, borderBottom: `2.5px solid ${C.green}`, paddingBottom: 2, lineHeight: 1.1 }}>{cur}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: C.faint, lineHeight: 1.1 }}>/{tot}</span>
    </div>
  );
}

function ReportsFooter() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={34} height={18} viewBox="0 0 34 18">
        <rect x="0" y="0" width="34" height="18" rx="9" fill={C.green} />
        <circle cx="25" cy="9" r="7" fill="white" />
      </svg>
      <span style={{ fontWeight: 900, fontSize: 12, color: C.text, letterSpacing: '0.04em' }}>ONMID</span>
      <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Reports</span>
    </div>
  );
}

// Decorative green glow blob (top-right corner decoration present in many slides)
function GreenBlob({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'absolute',
      width: 200, height: 200,
      borderRadius: '50%',
      background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 50%, transparent 70%)',
      pointerEvents: 'none',
      ...style,
    }} />
  );
}

// Slide shell: white bg, logo top-left, counter top-right, footer bottom-left
interface ShellProps {
  current: number;
  total: number;
  children: React.ReactNode;
  noBlob?: boolean;
}
function Shell({ current, total, children, noBlob }: ShellProps) {
  return (
    <div style={{
      width: SLIDE_W, height: SLIDE_H,
      background: C.bg,
      position: 'relative',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      {!noBlob && <GreenBlob style={{ top: -60, right: -60 }} />}
      {/* Top bar */}
      <div style={{ position: 'absolute', top: 26, left: 44, right: 44, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <OnmidLogo />
        <SlideCounter current={current} total={total} />
      </div>
      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 18, left: 44 }}>
        <ReportsFooter />
      </div>
      {/* Content area */}
      <div style={{ position: 'absolute', top: 68, left: 44, right: 44, bottom: 48, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// Slide section title
function SlideHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ margin: 0, fontSize: 36, fontWeight: 900, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{title}</h1>
      {subtitle && <p style={{ margin: '6px 0 0', fontSize: 14, color: C.muted, fontWeight: 400 }}>{subtitle}</p>}
    </div>
  );
}

// Green icon circle
function GreenCircle({ size = 40, children }: { size?: number; children: React.ReactNode }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: C.greenLight,
      border: `1px solid ${C.greenMid}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

// Insight/recommendation box with left border
function InsightBox({ icon, title, body, style }: { icon: React.ReactNode; title?: string; body: string; style?: React.CSSProperties }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 14,
      background: C.cardBg, borderRadius: 10, padding: '14px 18px',
      border: `1px solid ${C.border}`,
      ...style,
    }}>
      <GreenCircle size={38}>{icon}</GreenCircle>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>{title}</div>}
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const Icon = {
  target: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
      <line x1="22" y1="2" x2="15" y2="9"/><line x1="15" y1="2" x2="22" y2="9"/>
    </svg>
  ),
  calendar: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  calendarBlue: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  info: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  bulb: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
    </svg>
  ),
  chart: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  check: (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  arrow: (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  arrowUp: (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  arrowDown: (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  people: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  trophy: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/>
      <path d="M7 4H4a2 2 0 0 0-2 2v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V4"/>
      <path d="M17 4h3a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4"/>
    </svg>
  ),
  dollar: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  eye: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  click: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9l5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2L8 5.1"/><path d="M5.1 8H2.2"/><path d="M11.4 4l-2 2"/><path d="M4 11.4l-2 2"/>
    </svg>
  ),
  pin: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  cart: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  ),
  refresh: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  rocket: (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
    </svg>
  ),
  whatsapp: (
    <svg width={20} height={20} viewBox="0 0 24 24" fill={C.green}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/>
    </svg>
  ),
};

// ── Slide 01 — Cover ───────────────────────────────────────────────────────────
export function Slide01Cover({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  return (
    <div style={{
      width: SLIDE_W, height: SLIDE_H,
      background: C.bg,
      position: 'relative',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    }}>
      {/* Decorative blobs */}
      <GreenBlob style={{ top: -80, right: -60, width: 280, height: 280 }} />
      <div style={{
        position: 'absolute', bottom: -80, left: -60,
        width: 220, height: 220, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,197,94,0.10) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 26, left: 44, right: 44, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <OnmidLogo />
        <SlideCounter current={current} total={total} />
      </div>

      {/* Left content */}
      <div style={{ position: 'absolute', top: 80, left: 44, width: 680, bottom: 52 }}>
        {/* Title */}
        <h1 style={{ margin: 0, fontSize: 46, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.08, marginBottom: 10 }}>
          Relatório de Performance —<br />{data.clientName}
        </h1>
        <p style={{ margin: '0 0 28px', fontSize: 15, color: C.muted, lineHeight: 1.5 }}>{data.cover.subtitle}</p>

        {/* Period rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: C.greenLight, border: `1px solid ${C.greenMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.calendar}
            </div>
            <span style={{ fontSize: 14, color: C.text }}>
              <strong>Período analisado:</strong> <span style={{ color: C.green, fontWeight: 700 }}>{data.cover.periodLabel}</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: C.blueLight, border: `1px solid ${C.blueMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.info}
            </div>
            <span style={{ fontSize: 14, color: C.text }}>
              <strong>Comparativo:</strong> <span style={{ color: C.blue, fontWeight: 600 }}>{data.cover.prevPeriodLabel}</span>
            </span>
          </div>
        </div>

        {/* Objective box */}
        <div style={{ display: 'flex', gap: 16, background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px' }}>
          <GreenCircle size={44}>{Icon.target}</GreenCircle>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: C.text, marginBottom: 6 }}>Objetivo do relatório</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{data.cover.objective}</div>
          </div>
        </div>
      </div>

      {/* Right: Decorative abstract dashboard mockup */}
      <div style={{ position: 'absolute', top: 70, right: 30, width: 500, bottom: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', width: 460, height: 480 }}>
          {/* Dashboard card 1 */}
          <div style={{ position: 'absolute', top: 0, right: 20, width: 260, height: 140, background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: `1px solid ${C.border}`, padding: 16, overflow: 'hidden' }}>
            <div style={{ width: 60, height: 8, background: C.greenLight, borderRadius: 4, marginBottom: 8 }} />
            {/* Mini line chart */}
            <svg viewBox="0 0 220 80" style={{ width: '100%', height: 70 }}>
              <polyline points="0,70 40,55 80,60 120,30 160,35 200,10 220,15"
                fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="0,70 40,55 80,60 120,30 160,35 200,10 220,15 220,80 0,80"
                fill="url(#g1)" strokeWidth="0" />
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity="0.2" />
                  <stop offset="100%" stopColor={C.green} stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          {/* Dashboard card 2 (pie) */}
          <div style={{ position: 'absolute', top: 100, left: 0, width: 180, height: 160, background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: `1px solid ${C.border}`, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 100 100" width={100} height={100}>
              <circle cx="50" cy="50" r="40" fill="none" stroke={C.greenLight} strokeWidth="20" />
              <circle cx="50" cy="50" r="40" fill="none" stroke={C.green} strokeWidth="20"
                strokeDasharray={`${251.2 * 0.135} ${251.2 * 0.865}`} strokeDashoffset={`${251.2 * 0.25}`} />
              <circle cx="50" cy="50" r="40" fill="none" stroke={C.redMid} strokeWidth="20"
                strokeDasharray={`${251.2 * 0.803} ${251.2 * 0.197}`}
                strokeDashoffset={`${251.2 * (0.25 - 0.135)}`} />
            </svg>
          </div>
          {/* Dashboard card 3 (bar) */}
          <div style={{ position: 'absolute', top: 220, right: 10, width: 220, height: 150, background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', border: `1px solid ${C.border}`, padding: 16 }}>
            <svg viewBox="0 0 180 100" width="100%" height={100}>
              {[30, 55, 45, 80, 65, 90, 70].map((h, i) => (
                <rect key={i} x={i * 26 + 2} y={100 - h} width={18} height={h} rx={4}
                  fill={i >= 4 ? C.green : '#E5E7EB'} />
              ))}
            </svg>
          </div>
          {/* Small stat chip */}
          <div style={{ position: 'absolute', bottom: 40, left: 30, background: C.greenLight, borderRadius: 20, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: C.greenDark }}>+{data.monthlyOverview.current.orders > 0 ? num(data.monthlyOverview.current.orders) : '—'} pedidos</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 18, left: 44 }}>
        <ReportsFooter />
      </div>
    </div>
  );
}

// ── Slide 02 — Visão geral do mês ─────────────────────────────────────────────
export function Slide02Monthly({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { current: cur, previous: prev } = data.monthlyOverview;
  const rDelta = pctDelta(cur.revenue, prev.revenue);
  const oDelta = pctDelta(cur.orders, prev.orders);
  const tDelta = pctDelta(cur.avgTicket, prev.avgTicket);

  function DeltaCell({ text, up }: { text: string; up: boolean }) {
    const color = up ? C.greenDark : C.red;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color, fontSize: 20, fontWeight: 800 }}>{text}</span>
        <span style={{ color, display: 'flex' }}>{up ? Icon.arrowUp : Icon.arrowDown}</span>
      </div>
    );
  }

  function MetricCell({ icon, label, value, accent = false }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 10px' }}>
        <GreenCircle size={38}>{icon}</GreenCircle>
        <div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: accent ? C.green : C.text, letterSpacing: '-0.01em' }}>{value}</div>
        </div>
      </div>
    );
  }

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Visão geral do mês" subtitle={`Comparativo de ${cur.monthLabel} com ${prev.monthLabel} de ${cur.year}`} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Current month row */}
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: 'white', borderLeft: `4px solid ${C.green}` }}>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px', background: C.greenLight, flexShrink: 0 }}>
            <GreenCircle size={32}>{Icon.calendar}</GreenCircle>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{cur.monthLabel}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{cur.year}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1, borderLeft: `1px solid ${C.border}` }}>
            <MetricCell icon={Icon.dollar} label="Faturamento" value={`R$ ${brl(cur.revenue)}`} accent />
            <div style={{ width: 1, background: C.border }} />
            <MetricCell icon={Icon.cart} label="Pedidos" value={num(cur.orders)} />
            <div style={{ width: 1, background: C.border }} />
            <MetricCell icon={Icon.trophy} label="Ticket médio" value={`R$ ${brl(cur.avgTicket)}`} />
          </div>
        </div>

        {/* Previous month row */}
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: 'white', borderLeft: `4px solid ${C.blue}` }}>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px', background: C.blueLight, flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#DBEAFE', border: `1px solid ${C.blueMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.calendarBlue}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{prev.monthLabel}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{prev.year}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1, borderLeft: `1px solid ${C.border}` }}>
            <MetricCell icon={Icon.dollar} label="Faturamento" value={`R$ ${brl(prev.revenue)}`} />
            <div style={{ width: 1, background: C.border }} />
            <MetricCell icon={Icon.cart} label="Pedidos" value={num(prev.orders)} />
            <div style={{ width: 1, background: C.border }} />
            <MetricCell icon={Icon.trophy} label="Ticket médio" value={`R$ ${brl(prev.avgTicket)}`} />
          </div>
        </div>

        {/* Delta row */}
        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', background: C.cardBg }}>
          <div style={{ width: 130, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexShrink: 0 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.greenLight, border: `1px solid ${C.greenMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {Icon.chart}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 11, color: C.muted, lineHeight: 1.3 }}>Comparativo<br />{cur.monthLabel} vs. {prev.monthLabel}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1, borderLeft: `1px solid ${C.border}` }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px' }}>
              <GreenCircle size={32}>{Icon.dollar}</GreenCircle>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Faturamento</div>
                <DeltaCell text={rDelta.text} up={rDelta.up} />
              </div>
            </div>
            <div style={{ width: 1, background: C.border }} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px' }}>
              <GreenCircle size={32}>{Icon.cart}</GreenCircle>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Pedidos</div>
                <DeltaCell text={oDelta.text} up={oDelta.up} />
              </div>
            </div>
            <div style={{ width: 1, background: C.border }} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px' }}>
              <GreenCircle size={32}>{Icon.trophy}</GreenCircle>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>Ticket médio</div>
                <DeltaCell text={tDelta.text} up={tDelta.up} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Insight */}
      <div style={{ marginTop: 14 }}>
        <InsightBox icon={Icon.bulb} title="Leitura principal" body={data.monthlyOverview.mainInsight} />
      </div>
    </Shell>
  );
}

// ── Slide 03 — Comportamento por dia da semana ────────────────────────────────
export function Slide03Weekly({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const orders = data.weeklyBehavior.ordersByDay;
  const deliveries = data.weeklyBehavior.deliveriesByDay;
  const maxOrders = Math.max(...orders.map(d => d.value), 1);
  const maxDeliveries = Math.max(...deliveries.map(d => d.value), 1);

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Comportamento por dia da semana" subtitle={`Pedidos e entregas em ${data.monthlyOverview.current.monthLabel.toLowerCase()}`} />

      <div style={{ display: 'flex', gap: 14, height: 'calc(100% - 80px)' }}>
        {/* Bar chart: Pedidos por dia */}
        <div style={{ flex: 2.5, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <GreenCircle size={30}>{Icon.calendar}</GreenCircle>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Pedidos por dia</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
            {orders.map((d, i) => {
              const h = (d.value / maxOrders) * 160;
              const isTop = d.highlight;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isTop ? C.text : C.muted }}>{num(d.value)}</span>
                  <div style={{ width: '100%', height: h, background: isTop ? C.green : '#E5E7EB', borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                  <span style={{ fontSize: 10, color: C.muted, whiteSpace: 'nowrap' }}>{d.day.slice(0, 3)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Horizontal chart: Entregas por dia */}
        <div style={{ flex: 2.5, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <GreenCircle size={30}>{Icon.cart}</GreenCircle>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Entregas por dia</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
            {deliveries.sort((a, b) => b.value - a.value).map((d, i) => {
              const w = (d.value / maxDeliveries) * 100;
              const isTop = d.highlight || i < 2;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: C.muted, width: 64, textAlign: 'right', flexShrink: 0 }}>{d.day}</span>
                  <div style={{ flex: 1, height: 28, background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${w}%`, background: isTop ? C.green : '#D1D5DB', borderRadius: 6, minWidth: 4 }} />
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isTop ? C.text : C.muted, width: 32, textAlign: 'right', flexShrink: 0 }}>{num(d.value)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Insights */}
        <div style={{ flex: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <GreenCircle size={28}>{Icon.target}</GreenCircle>
              <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Leitura estratégica</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{data.weeklyBehavior.strategicReading}</p>
          </div>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <GreenCircle size={28}>{Icon.bulb}</GreenCircle>
              <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Oportunidade para {data.actionSummary.nextMonth}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {data.weeklyBehavior.opportunities.slice(0, 3).map((o, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.muted }}>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 04 — Regiões ────────────────────────────────────────────────────────
export function Slide04Regions({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const regions = data.geoRegions.regions.slice(0, 8);

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Regiões com maior volume de pedidos" subtitle={`Bairros com maior força em ${data.monthlyOverview.current.monthLabel.toLowerCase()}`} />

      <div style={{ display: 'flex', gap: 20, height: 'calc(100% - 72px)' }}>
        {/* Left: Table */}
        <div style={{ flex: 2, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', borderBottom: `1px solid ${C.border}`, padding: '10px 16px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>{Icon.pin} Bairro</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textAlign: 'center' }}>Pedidos</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textAlign: 'right' }}>Faturamento</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {regions.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', padding: '9px 16px', borderBottom: i < regions.length - 1 ? `1px solid ${C.border}` : 'none', background: i % 2 === 0 ? 'white' : C.cardBg }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.greenLight, border: `1px solid ${C.greenMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: C.greenDark }}>{r.rank}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.name}</span>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text, textAlign: 'center' }}>{num(r.orders)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text, textAlign: 'right' }}>R$ {brl(r.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Map visualization + insights */}
        <div style={{ flex: 2.2, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Stylized map */}
          <div style={{ flex: 1, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #F0FFF4 0%, #EFF6FF 100%)' }} />
            {/* Place markers for top regions */}
            {regions.slice(0, 6).map((r, i) => {
              const positions = [
                { top: '30%', left: '42%' },
                { top: '52%', left: '24%' },
                { top: '42%', left: '55%' },
                { top: '22%', left: '70%' },
                { top: '58%', left: '68%' },
                { top: '65%', left: '36%' },
              ];
              const pos = positions[i] || { top: '50%', left: '50%' };
              const isFirst = i === 0;
              return (
                <div key={i} style={{ position: 'absolute', ...pos, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    padding: '3px 10px', background: isFirst ? C.green : 'white',
                    border: `1.5px solid ${isFirst ? C.green : C.border}`,
                    borderRadius: 20, fontSize: 11, fontWeight: 700,
                    color: isFirst ? 'white' : C.text,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    whiteSpace: 'nowrap',
                  }}>{r.name}</div>
                  <svg width={16} height={16} viewBox="0 0 24 24" style={{ marginTop: -2 }}>
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
                      fill={isFirst ? C.green : C.muted} />
                  </svg>
                </div>
              );
            })}
          </div>

          {/* Two insight boxes */}
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <GreenCircle size={28}>{Icon.arrow}</GreenCircle>
                <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Fortalecer onde já existe demanda</span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{data.geoRegions.strengthenInsight}</p>
            </div>
            <div style={{ flex: 1, background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <GreenCircle size={28}>{Icon.rocket}</GreenCircle>
                <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Estimular onde há potencial</span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.5 }}>{data.geoRegions.growInsight}</p>
            </div>
          </div>

          {/* Bottom insight */}
          <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <GreenCircle size={28}>{Icon.target}</GreenCircle>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}><strong style={{ color: C.text }}>Insight para remarketing e campanhas geográficas</strong> — {data.geoRegions.remarketingInsight}</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 05 — Base de clientes ───────────────────────────────────────────────
export function Slide05CustomerBase({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const cb = data.customerBase;
  const totalCustomers = cb.active + cb.inactive + cb.potential;
  const activePct = totalCustomers > 0 ? (cb.active / totalCustomers * 100).toFixed(1) : '0.0';
  const inactivePct = totalCustomers > 0 ? (cb.inactive / totalCustomers * 100).toFixed(1) : '0.0';
  const potentialPct = totalCustomers > 0 ? (cb.potential / totalCustomers * 100).toFixed(1) : '0.0';

  // SVG Donut
  const R = 90, CX = 110, CY = 110;
  const circ = 2 * Math.PI * R;
  const activeDash = circ * cb.active / totalCustomers;
  const inactiveDash = circ * cb.inactive / totalCustomers;
  const potentialDash = circ * cb.potential / totalCustomers;

  // offset starts from top (-90deg) = -circ*0.25
  const offset0 = circ * 0.25;
  const offset1 = offset0 - activeDash;
  const offset2 = offset1 - inactiveDash;

  return (
    <Shell current={current} total={total}>
      {/* Title + top KPIs */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900, color: C.text, letterSpacing: '-0.02em', lineHeight: 1.1 }}>Base de clientes e clientes ativos</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted }}>Onde está a maior oportunidade de relacionamento</p>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
          {[
            { label: 'Clientes ativos', value: num(cb.active), color: C.green, icon: Icon.people },
            { label: 'Clientes inativos', value: num(cb.inactive), color: C.red, icon: Icon.people },
            { label: 'Clientes em potencial', value: num(cb.potential), color: C.blue, icon: Icon.people },
          ].map((kpi, i) => (
            <div key={i} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 16px', textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>{kpi.label}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: kpi.color }}>{kpi.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, height: 'calc(100% - 110px)' }}>
        {/* Left: Donut */}
        <div style={{ flex: 2, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <svg width={220} height={220} viewBox="0 0 220 220" style={{ flexShrink: 0 }}>
              {/* BG circle */}
              <circle cx={CX} cy={CY} r={R} fill="none" stroke="#F3F4F6" strokeWidth={28} />
              {/* Active (green) */}
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.green} strokeWidth={28}
                strokeDasharray={`${activeDash} ${circ - activeDash}`}
                strokeDashoffset={offset0} strokeLinecap="butt" />
              {/* Inactive (pink/red) */}
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.redMid} strokeWidth={28}
                strokeDasharray={`${inactiveDash} ${circ - inactiveDash}`}
                strokeDashoffset={offset1} strokeLinecap="butt" />
              {/* Potential (light green) */}
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.greenMid} strokeWidth={28}
                strokeDasharray={`${potentialDash} ${circ - potentialDash}`}
                strokeDashoffset={offset2} strokeLinecap="butt" />
              {/* Center icon */}
              <circle cx={CX} cy={CY} r={38} fill={C.greenLight} />
              <text x={CX} y={CY + 5} textAnchor="middle" fontSize={22} fill={C.green}>👥</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { color: C.green, label: 'Clientes ativos', value: `${num(cb.active)} (${activePct}%)` },
                { color: C.redMid, label: 'Clientes inativos', value: `${num(cb.inactive)} (${inactivePct}%)` },
                { color: C.greenMid, label: 'Clientes em potencial', value: `${num(cb.potential)} (${potentialPct}%)` },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 11, color: C.muted }}>{item.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{item.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.muted, fontStyle: 'italic', lineHeight: 1.5 }}>
            {cb.baseInsight}
          </div>
        </div>

        {/* Right: Dentro da base + segmentação */}
        <div style={{ flex: 2.5, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Dentro da base ativa */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 13, color: C.text }}>Dentro da base ativa</p>
            <div style={{ display: 'flex', gap: 16 }}>
              {[
                { icon: Icon.cart, label: 'pedidos registrados na base', value: num(cb.ordersInBase) },
                { icon: Icon.people, label: 'Clientes com 1 pedido', value: num(cb.singleOrderCount) },
                { icon: Icon.people, label: 'Clientes com mais de 1 pedido', value: num(cb.multiOrderCount) },
              ].map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', padding: '10px 8px', background: C.cardBg, borderRadius: 8 }}>
                  <GreenCircle size={36}>{m.icon}</GreenCircle>
                  <div style={{ fontSize: 22, fontWeight: 900, color: C.green }}>{m.value}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.3 }}>{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Como segmentar */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 13, color: C.text }}>Como segmentar os ativos</p>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { bg: C.blueLight, color: C.blue, label: 'Primeira compra', sub: 'incentivar segunda compra' },
                { bg: C.greenLight, color: C.greenDark, label: 'Recorrentes', sub: 'estimular combos e favoritos' },
                { bg: C.purpleLight, color: C.purple, label: 'Muito recorrentes', sub: 'comunicação VIP e fidelidade' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, background: s.bg, borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'white', border: `1px solid ${s.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {Icon.cart}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom insight */}
          <div style={{ background: C.cardBg, borderRadius: 10, padding: '12px 14px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
            <GreenCircle size={28}>{Icon.bulb}</GreenCircle>
            <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{cb.segmentInsight}</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 06 — Inativos e potenciais ─────────────────────────────────────────
export function Slide06Inactives({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { ranges, potentialCount, approachSuggestions, entryProducts, cta } = data.inactives;
  const maxRange = Math.max(...ranges.map(r => r.count), 1);

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Inativos e potenciais" subtitle={`A maior reserva de crescimento para ${data.actionSummary.nextMonth}`} />

      <div style={{ display: 'flex', gap: 18, height: 'calc(100% - 72px)' }}>
        {/* Left: distribution */}
        <div style={{ flex: 2.4, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <GreenCircle size={28}>{Icon.chart}</GreenCircle>
            <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Distribuição da base inativa</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', position: 'relative' }}>
            {/* Priority bracket */}
            {ranges.some(r => r.priority) && (
              <div style={{
                position: 'absolute', right: -8, top: 0,
                height: `${(ranges.filter(r => r.priority).length / ranges.length) * 100}%`,
                borderRight: `2px dashed ${C.green}`,
                display: 'flex', alignItems: 'center',
              }}>
                <div style={{ background: C.green, color: 'white', fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 20, marginRight: -28, letterSpacing: '0.1em', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>PRIORIDADE</div>
              </div>
            )}
            {ranges.map((r, i) => {
              const w = (r.count / maxRange) * 100;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, color: C.muted, width: 88, flexShrink: 0, textAlign: 'right' }}>{r.label}</span>
                  <div style={{ flex: 1, height: 36, background: '#F3F4F6', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${w}%`, background: r.priority ? C.green : '#D1D5DB', borderRadius: 6, minWidth: 4 }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: r.priority ? C.greenDark : C.text, width: 50, textAlign: 'right', flexShrink: 0 }}>{num(r.count)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: potential + approaches */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Big number */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <GreenCircle size={44}>{Icon.people}</GreenCircle>
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: C.green, lineHeight: 1 }}>{num(potentialCount)}</div>
              <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>contatos sem pedidos registrados</div>
            </div>
          </div>

          {/* Approaches */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <GreenCircle size={26}>{Icon.bulb}</GreenCircle>
              <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Abordagens sugeridas para a primeira compra</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {approachSuggestions.slice(0, 3).map((a, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: C.muted }}>{a}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Entry products */}
          {entryProducts.length > 0 && (
            <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <GreenCircle size={26}>{Icon.cart}</GreenCircle>
                <span style={{ fontWeight: 700, fontSize: 12, color: C.text }}>Porta de entrada</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {entryProducts.slice(0, 4).map((p, i) => (
                  <div key={i} style={{ background: C.greenLight, borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 600, color: C.greenDark }}>
                    {p}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA */}
          <div style={{ background: C.greenLight, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
            <GreenCircle size={28}>{Icon.target}</GreenCircle>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: C.greenDark, lineHeight: 1.5 }}>{cta}</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 07 — Produtos campeões ──────────────────────────────────────────────
export function Slide07Products({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { ranking, combos, insight } = data.topProducts;
  const maxOrders = Math.max(...ranking.map(p => p.orders), 1);

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Produtos campeões e aumento de ticket" subtitle="Os itens que mais puxam venda e desejo" />

      <div style={{ display: 'flex', gap: 18, height: 'calc(100% - 72px)' }}>
        {/* Left: Combos */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 0 }}>
          <p style={{ margin: '0 0 10px', fontWeight: 700, fontSize: 13, color: C.text }}>Como usar para aumentar ticket</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {combos.slice(0, 4).map((c, i) => (
              <div key={i} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <GreenCircle size={32}>{Icon.trophy}</GreenCircle>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 3 }}>{c.title}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{c.description}</div>
                </div>
              </div>
            ))}
            {combos[4] && (
              <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', gridColumn: '1 / -1' }}>
                <GreenCircle size={32}>{Icon.trophy}</GreenCircle>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 3 }}>{combos[4].title}</div>
                  <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.4 }}>{combos[4].description}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Ranking + Insight */}
        <div style={{ flex: 2.5, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', flex: 1 }}>
            <p style={{ margin: '0 0 12px', fontWeight: 700, fontSize: 13, color: C.text }}>
              Top produtos de consumo em {data.monthlyOverview.current.monthLabel.toLowerCase()}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {ranking.slice(0, 6).map((p, i) => {
                const w = (p.orders / maxOrders) * 100;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.greenLight, border: `1px solid ${C.greenMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, color: C.greenDark }}>{p.rank}</span>
                    </div>
                    <span style={{ fontSize: 12, color: C.text, width: 160, flexShrink: 0, fontWeight: 500 }}>{p.name}</span>
                    <div style={{ flex: 1, height: 22, background: '#F3F4F6', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${w}%`, background: C.green, borderRadius: 5, minWidth: 4 }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.text, width: 32, textAlign: 'right', flexShrink: 0 }}>{num(p.orders)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <GreenCircle size={32}>{Icon.target}</GreenCircle>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 4 }}>Insight</div>
              <p style={{ margin: 0, fontSize: 12, color: C.muted, lineHeight: 1.55 }}>{insight}</p>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 08 — Tráfego pago ───────────────────────────────────────────────────
export function Slide08Traffic({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const pt = data.paidTraffic!;

  return (
    <Shell current={current} total={total}>
      <SlideHeading title="Resumo de tráfego pago" subtitle={`Visibilidade, cliques e destaques das campanhas de ${data.monthlyOverview.current.monthLabel.toLowerCase()}`} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100% - 72px)' }}>
        {/* Top 4 KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[
            { icon: Icon.dollar, label: 'Investimento', value: `R$ ${brl(pt.investment)}` },
            { icon: Icon.eye, label: 'Impressões', value: num(pt.impressions) },
            { icon: Icon.people, label: 'Alcance somado', value: num(pt.reach) },
            { icon: Icon.click, label: 'Cliques no link', value: num(pt.clicks) },
          ].map((kpi, i) => (
            <div key={i} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <GreenCircle size={38}>{kpi.icon}</GreenCircle>
              <div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{kpi.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{kpi.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Campaign list */}
        {pt.campaignNames.length > 0 && (
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <GreenCircle size={32}>{Icon.chart}</GreenCircle>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: C.text, marginBottom: 8 }}>Campanhas analisadas</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                {pt.campaignNames.slice(0, 8).map((name, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: C.muted }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Campaign comparison cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(pt.topCampaigns.length, 2)}, 1fr)`, gap: 12, flex: 1 }}>
          {pt.topCampaigns.slice(0, 2).map((camp, ci) => (
            <div key={ci} style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
                <GreenCircle size={34}>{ci === 0 ? Icon.whatsapp : Icon.cart}</GreenCircle>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: C.text }}>{camp.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{camp.description}</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {camp.metrics.slice(0, 6).map((m, mi) => (
                  <div key={mi}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{m.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{m.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                <GreenCircle size={26}>{Icon.target}</GreenCircle>
                <p style={{ margin: 0, fontSize: 11, color: C.muted, lineHeight: 1.5 }}><strong style={{ color: C.text }}>Insight estratégico</strong> — {camp.insight}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Recommendation */}
        <div style={{ background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <GreenCircle size={28}>{Icon.target}</GreenCircle>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}><strong style={{ color: C.text }}>Recomendação</strong> — {pt.recommendation}</p>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 09a — Criativos + Forças do faturamento ────────────────────────────
export function Slide09aCreatives({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { creatives, revenueForces, conclusion, nextMonth } = data.actionSummary;

  return (
    <Shell current={current} total={total}>
      <SlideHeading
        title={`Diagnóstico — ${nextMonth}`}
        subtitle="Criativos com melhor sinal e forças que compõem o faturamento"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, height: 'calc(100% - 72px)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1 }}>
          {/* Criativos */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'white' }}>1</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Criativos com melhor sinal</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Criativo</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>ROAS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              {creatives.slice(0, 5).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: ['#1a1a1a', C.greenLight, C.blueLight, C.purpleLight, C.cardBg][i],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <span style={{ fontSize: 11, color: i === 0 ? 'white' : C.muted, fontWeight: 700 }}>
                        {c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || `C${i + 1}`}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: C.text, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.name}</span>
                  </div>
                  <span style={{ fontSize: 18, fontWeight: 900, color: C.green, flexShrink: 0 }}>{c.roas.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue forces */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: 'white' }}>2</span>
              </div>
              <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>O que compõe o faturamento</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, flex: 1, alignContent: 'center' }}>
              {revenueForces.slice(0, 4).map((force, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '14px 10px', background: C.cardBg, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <GreenCircle size={44}>{[Icon.refresh, Icon.trophy, Icon.calendar, Icon.pin][i]}</GreenCircle>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text, textAlign: 'center', lineHeight: 1.4 }}>{force}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Conclusion */}
        <div style={{ background: 'linear-gradient(135deg, #F0FFF4, #EFF6FF)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          <GreenCircle size={36}>{Icon.target}</GreenCircle>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.5 }}>{conclusion}</p>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 09b — Plano de ação + Prioridades ───────────────────────────────────
export function Slide09bActionPlan({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { actionPlan, priorities, nextMonth } = data.actionSummary;

  return (
    <Shell current={current} total={total}>
      <SlideHeading
        title={`Plano de ação para ${nextMonth}`}
        subtitle="Transformar diagnóstico em ações táticas de alto impacto"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, height: 'calc(100% - 72px)' }}>
        {/* Plano de ação */}
        <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: 'white' }}>3</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Plano de ação para {nextMonth}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {actionPlan.slice(0, 8).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: C.greenLight, border: `1px solid ${C.greenMid}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 1,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: C.greenDark }}>{i + 1}</span>
                </div>
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Prioridades */}
        <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '18px 20px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 900, color: 'white' }}>4</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 14, color: C.text }}>Prioridades recomendadas</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {priorities.slice(0, 8).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 6 }} />
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Public render function ─────────────────────────────────────────────────────
export function renderDeliverySlide(
  data: DeliveryReportData,
  slideIndex: number,
  totalSlides: number,
): React.ReactNode {
  const current = slideIndex + 1;
  const hasTraffic = !!data.paidTraffic;

  // Index map:
  //  0-6  → slides 01-07 (always)
  //  7    → slide 08 Traffic (if traffic) OR slide 09a (no traffic)
  //  8    → slide 09a (if traffic)  OR slide 09b (no traffic)
  //  9    → slide 09b (if traffic only)
  switch (slideIndex) {
    case 0: return <Slide01Cover data={data} current={current} total={totalSlides} />;
    case 1: return <Slide02Monthly data={data} current={current} total={totalSlides} />;
    case 2: return <Slide03Weekly data={data} current={current} total={totalSlides} />;
    case 3: return <Slide04Regions data={data} current={current} total={totalSlides} />;
    case 4: return <Slide05CustomerBase data={data} current={current} total={totalSlides} />;
    case 5: return <Slide06Inactives data={data} current={current} total={totalSlides} />;
    case 6: return <Slide07Products data={data} current={current} total={totalSlides} />;
    case 7: return hasTraffic
      ? <Slide08Traffic data={data} current={current} total={totalSlides} />
      : <Slide09aCreatives data={data} current={current} total={totalSlides} />;
    case 8: return hasTraffic
      ? <Slide09aCreatives data={data} current={current} total={totalSlides} />
      : <Slide09bActionPlan data={data} current={current} total={totalSlides} />;
    case 9: return <Slide09bActionPlan data={data} current={current} total={totalSlides} />;
    default: return null;
  }
}

export function getDeliverySlideCount(data: DeliveryReportData): number {
  // 7 base slides + slide 08 traffic (if available) + slide 09a + slide 09b
  return data.paidTraffic ? 10 : 9;
}
