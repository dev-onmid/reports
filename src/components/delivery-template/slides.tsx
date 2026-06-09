import React from 'react';
import type { DeliveryReportData } from './types';

export const SLIDE_W = 1280;
export const SLIDE_H = 720;

// ── Design tokens ──────────────────────────────────────────────────────────────
const C = {
  green:       '#22C55E',
  greenLight:  '#DCFCE7',
  greenMid:    '#86EFAC',
  greenDark:   '#16A34A',
  text:        '#0F172A',
  sub:         '#475569',
  muted:       '#94A3B8',
  border:      '#E2E8F0',
  bg:          '#FFFFFF',
  row:         '#F8FAFC',
  red:         '#F87171',
  redLight:    '#FEF2F2',
  salmon:      '#FB7185',
  salmonLight: '#FFF1F2',
  blue:        '#3B82F6',
  blueLight:   '#EFF6FF',
  blueMid:     '#93C5FD',
  purple:      '#8B5CF6',
  purpleLight: '#EDE9FE',
};

const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

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

// ── Brand components ───────────────────────────────────────────────────────────
function OnmidLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontWeight: 900, fontSize: 22, color: C.text, letterSpacing: '-0.04em', lineHeight: 1, fontFamily: FONT }}>onmid</span>
      <svg width={44} height={24} viewBox="0 0 44 24" style={{ flexShrink: 0 }}>
        <rect x="0" y="0" width="44" height="24" rx="12" fill={C.green} />
        <circle cx="32" cy="12" r="9" fill="white" />
      </svg>
      <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, marginTop: -10, fontFamily: FONT }}>®</span>
    </div>
  );
}

function SlideCounter({ current, total }: { current: number; total: number }) {
  const cur = String(current).padStart(2, '0');
  const tot = String(total).padStart(2, '0');
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 1, fontFamily: FONT }}>
      <span style={{ fontSize: 18, fontWeight: 800, color: C.text, borderBottom: `2.5px solid ${C.green}`, paddingBottom: 2, lineHeight: 1.1 }}>{cur}</span>
      <span style={{ fontSize: 15, fontWeight: 600, color: C.muted, lineHeight: 1.1 }}>/{tot}</span>
    </div>
  );
}

function ReportsFooter() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONT }}>
      <svg width={34} height={18} viewBox="0 0 34 18">
        <rect x="0" y="0" width="34" height="18" rx="9" fill={C.green} />
        <circle cx="25" cy="9" r="7" fill="white" />
      </svg>
      <span style={{ fontWeight: 900, fontSize: 12, color: C.text, letterSpacing: '0.04em' }}>ONMID</span>
      <span style={{ fontSize: 12, color: C.muted, fontWeight: 500 }}>Reports</span>
    </div>
  );
}

// Slide shell
function Shell({ current, total, children }: { current: number; total: number; children: React.ReactNode }) {
  return (
    <div style={{
      width: SLIDE_W, height: SLIDE_H,
      background: C.bg,
      position: 'relative',
      overflow: 'hidden',
      fontFamily: FONT,
    }}>
      {/* Blob top-right */}
      <div style={{
        position: 'absolute', top: -120, right: -120,
        width: 520, height: 520, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(219,234,254,0.55) 0%, rgba(220,252,231,0.25) 45%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Blob bottom-left */}
      <div style={{
        position: 'absolute', bottom: -80, left: -80,
        width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Logo */}
      <div style={{ position: 'absolute', top: 24, left: 40 }}><OnmidLogo /></div>
      {/* Counter */}
      <div style={{ position: 'absolute', top: 24, right: 40 }}><SlideCounter current={current} total={total} /></div>
      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 18, left: 40 }}><ReportsFooter /></div>
      {/* Content area */}
      <div style={{ position: 'absolute', top: 68, left: 40, right: 40, bottom: 46, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

// Green icon circle
function GreenCircle({ size = 48, children, color }: { size?: number; children: React.ReactNode; color?: string }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || C.greenLight,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

// Number badge
function NumBadge({ n }: { n: number }) {
  return (
    <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'white' }}>{n}</span>
    </div>
  );
}

// Insight with left border
function InsightBorder({ icon, title, body, style }: { icon: React.ReactNode; title?: string; body: string; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, borderLeft: `4px solid ${C.green}`, paddingLeft: 16, ...style }}>
      <GreenCircle size={44}>{icon}</GreenCircle>
      <div>
        {title && <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>{title}</div>}
        <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

// Generic card
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', ...style }}>
      {children}
    </div>
  );
}

// ── SVG Icons ──────────────────────────────────────────────────────────────────
const Icon = {
  target: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  ),
  calendar: (color = C.green) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  info: (color = C.blue) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  ),
  bulb: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
    </svg>
  ),
  dollar: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  cart: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  ),
  tag: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  ),
  chart: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  arrowUp: (color = C.green) => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15"/>
    </svg>
  ),
  arrowDown: (color = C.red) => (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  arrowRight: (color = C.green) => (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
    </svg>
  ),
  people: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  trophy: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/>
      <path d="M7 4H4a2 2 0 0 0-2 2v3a5 5 0 0 0 5 5 5 5 0 0 0 5-5V4"/>
      <path d="M17 4h3a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4"/>
    </svg>
  ),
  eye: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  ),
  click: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 9l5 12 1.8-5.2L21 14z"/><path d="M7.2 2.2L8 5.1"/><path d="M5.1 8H2.2"/><path d="M11.4 4l-2 2"/><path d="M4 11.4l-2 2"/>
    </svg>
  ),
  pin: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  rocket: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
    </svg>
  ),
  message: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  bag: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  truck: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
      <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  ),
  clipboard: (color = C.blue) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
    </svg>
  ),
  refresh: (color = C.green) => (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
  ),
  whatsapp: (
    <svg width={22} height={22} viewBox="0 0 24 24" fill={C.green}>
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
      fontFamily: FONT,
    }}>
      {/* Blob top-right */}
      <div style={{
        position: 'absolute', top: -120, right: -120,
        width: 520, height: 520, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(219,234,254,0.55) 0%, rgba(220,252,231,0.25) 45%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Blob bottom-left */}
      <div style={{
        position: 'absolute', bottom: -80, left: -80,
        width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(34,197,94,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Logo */}
      <div style={{ position: 'absolute', top: 24, left: 40 }}><OnmidLogo /></div>
      {/* Counter */}
      <div style={{ position: 'absolute', top: 24, right: 40 }}><SlideCounter current={current} total={total} /></div>
      {/* Footer */}
      <div style={{ position: 'absolute', bottom: 18, left: 40 }}><ReportsFooter /></div>

      {/* Left content — 58% width */}
      <div style={{ position: 'absolute', top: 72, left: 40, width: 700, bottom: 52 }}>
        {/* Title */}
        <h1 style={{
          margin: 0, fontSize: 58, fontWeight: 900, color: C.text,
          letterSpacing: '-0.03em', lineHeight: 1.05, marginBottom: 14,
        }}>
          Relatório de<br />Performance —<br />
          <span style={{ color: C.green }}>{data.clientName}</span>
        </h1>
        <p style={{ margin: '0 0 26px', fontSize: 17, color: C.sub, fontWeight: 400, lineHeight: 1.5, maxWidth: 580 }}>
          {data.cover.subtitle}
        </p>

        {/* Period rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: C.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {Icon.calendar()}
            </div>
            <span style={{ fontSize: 15, color: C.text }}>
              <strong>Período analisado:</strong> <span style={{ color: C.green, fontWeight: 700 }}>{data.cover.periodLabel}</span>
            </span>
          </div>
          {data.cover.prevPeriodLabel && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: C.blueLight, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {Icon.info()}
              </div>
              <span style={{ fontSize: 15, color: C.text }}>
                <strong>Comparativo:</strong> <span style={{ color: C.blue, fontWeight: 600 }}>{data.cover.prevPeriodLabel}</span>
              </span>
            </div>
          )}
        </div>

        {/* Objective — borda esquerda */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, borderLeft: `4px solid ${C.green}`, paddingLeft: 16 }}>
          <GreenCircle size={44}>{Icon.target()}</GreenCircle>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Objetivo do relatório</div>
            <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.6 }}>{data.cover.objective}</div>
          </div>
        </div>
      </div>

      {/* Right: Dashboard mockup — 42% width */}
      <div style={{ position: 'absolute', top: 60, right: 24, width: 500, bottom: 52 }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {/* Card 1 — Line chart (browser mockup) */}
          <div style={{
            position: 'absolute', top: 10, right: 0, width: 300, height: 160,
            background: 'white', borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
            border: `1px solid ${C.border}`,
            padding: '12px 14px',
            overflow: 'hidden',
          }}>
            {/* browser dots */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FCA5A5' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FDE68A' }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.greenMid }} />
            </div>
            <svg viewBox="0 0 260 90" style={{ width: '100%', height: 90 }}>
              <defs>
                <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.green} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={C.green} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline points="0,78 36,62 72,66 108,38 144,44 180,18 216,22 260,10"
                fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <polygon points="0,78 36,62 72,66 108,38 144,44 180,18 216,22 260,10 260,90 0,90"
                fill="url(#lg1)" />
              {/* Data points */}
              {[[108,38],[180,18],[260,10]].map(([x,y],i) => (
                <circle key={i} cx={x} cy={y} r={4} fill={C.green} />
              ))}
            </svg>
          </div>

          {/* Card 2 — Donut */}
          <div style={{
            position: 'absolute', top: 130, left: 0, width: 180, height: 180,
            background: 'white', borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
            border: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="0 0 120 120" width={120} height={120}>
              <circle cx="60" cy="60" r="44" fill="none" stroke={C.greenLight} strokeWidth="22" />
              <circle cx="60" cy="60" r="44" fill="none" stroke={C.green} strokeWidth="22"
                strokeDasharray={`${276.5 * 0.62} ${276.5 * 0.38}`}
                strokeDashoffset={`${276.5 * 0.25}`} strokeLinecap="butt" />
              <circle cx="60" cy="60" r="44" fill="none" stroke={C.salmon} strokeWidth="22"
                strokeDasharray={`${276.5 * 0.24} ${276.5 * 0.76}`}
                strokeDashoffset={`${276.5 * (0.25 - 0.62)}`} strokeLinecap="butt" />
              <circle cx="60" cy="60" r="22" fill={C.greenLight} />
              <text x="60" y="65" textAnchor="middle" fontSize="13" fontWeight="800" fill={C.greenDark}>62%</text>
            </svg>
          </div>

          {/* Card 3 — Bars */}
          <div style={{
            position: 'absolute', bottom: 40, right: 10, width: 240, height: 160,
            background: 'white', borderRadius: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.10)',
            border: `1px solid ${C.border}`,
            padding: '14px 16px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.sub, marginBottom: 10 }}>Pedidos por dia</div>
            <svg viewBox="0 0 200 90" style={{ width: '100%', height: 90 }}>
              {[38, 55, 44, 82, 64, 90, 72].map((h, i) => (
                <rect key={i} x={i * 29 + 2} y={90 - h} width={20} height={h} rx={5}
                  fill={i === 5 ? C.green : i === 3 ? C.greenMid : C.border} />
              ))}
            </svg>
          </div>

          {/* Card 4 — Stat chip */}
          <div style={{
            position: 'absolute', top: 88, left: 60,
            background: C.greenLight, borderRadius: 20,
            padding: '7px 16px',
            display: 'flex', alignItems: 'center', gap: 7,
            boxShadow: '0 4px 12px rgba(34,197,94,0.2)',
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: C.green }} />
            <span style={{ fontSize: 12, fontWeight: 800, color: C.greenDark }}>
              +{data.monthlyOverview.current.orders > 0 ? num(data.monthlyOverview.current.orders) : '—'} pedidos
            </span>
          </div>
        </div>
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

  function MetricCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px' }}>
        {icon}
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: C.text, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</div>
        </div>
      </div>
    );
  }

  function DeltaCell({ icon, label, delta }: { icon: React.ReactNode; label: string; delta: { text: string; up: boolean } }) {
    const col = delta.up ? C.greenDark : C.red;
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px' }}>
        {icon}
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 2 }}>{label}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: col, letterSpacing: '-0.02em', lineHeight: 1 }}>{delta.text}</span>
            <span style={{ color: col, display: 'flex', alignItems: 'center' }}>
              {delta.up ? Icon.arrowUp(col) : Icon.arrowDown(col)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  function Divider() {
    return <div style={{ width: 1, background: C.border, alignSelf: 'stretch', margin: '12px 0' }} />;
  }

  const rowBase: React.CSSProperties = {
    display: 'flex', alignItems: 'stretch',
    borderRadius: 14, overflow: 'hidden',
    border: `1px solid ${C.border}`,
    background: 'white',
  };

  return (
    <Shell current={current} total={total}>
      {/* Title */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 52, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>Visão geral do mês</h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: C.sub }}>Comparativo de {cur.monthLabel} com {prev.monthLabel} de {cur.year}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Row: Mês atual */}
        <div style={{ ...rowBase, borderLeft: `4px solid ${C.green}` }}>
          <div style={{ width: 148, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: C.greenLight, flexShrink: 0 }}>
            <GreenCircle size={44}>{Icon.calendar()}</GreenCircle>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{cur.monthLabel}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{cur.year}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1 }}>
            <MetricCell icon={<GreenCircle size={40}>{Icon.dollar()}</GreenCircle>} label="Faturamento" value={`R$ ${brl(cur.revenue)}`} />
            <Divider />
            <MetricCell icon={<GreenCircle size={40}>{Icon.cart()}</GreenCircle>} label="Pedidos" value={num(cur.orders)} />
            <Divider />
            <MetricCell icon={<GreenCircle size={40}>{Icon.tag()}</GreenCircle>} label="Ticket médio" value={`R$ ${brl(cur.avgTicket)}`} />
          </div>
        </div>

        {/* Row: Mês anterior */}
        <div style={{ ...rowBase, borderLeft: `4px solid ${C.blue}` }}>
          <div style={{ width: 148, display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: C.blueLight, flexShrink: 0 }}>
            <GreenCircle size={44} color={C.blueLight}>{Icon.calendar(C.blue)}</GreenCircle>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{prev.monthLabel}</div>
              <div style={{ fontSize: 12, color: C.muted }}>{prev.year}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1 }}>
            <MetricCell icon={<GreenCircle size={40} color={C.blueLight}>{Icon.dollar(C.blue)}</GreenCircle>} label="Faturamento" value={`R$ ${brl(prev.revenue)}`} />
            <Divider />
            <MetricCell icon={<GreenCircle size={40} color={C.blueLight}>{Icon.cart(C.blue)}</GreenCircle>} label="Pedidos" value={num(prev.orders)} />
            <Divider />
            <MetricCell icon={<GreenCircle size={40} color={C.blueLight}>{Icon.tag(C.blue)}</GreenCircle>} label="Ticket médio" value={`R$ ${brl(prev.avgTicket)}`} />
          </div>
        </div>

        {/* Row: Comparativo */}
        <div style={{ ...rowBase, background: C.row }}>
          <div style={{ width: 148, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', flexShrink: 0 }}>
            <GreenCircle size={40}>{Icon.chart()}</GreenCircle>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, lineHeight: 1.4 }}>
              Comparativo<br />{cur.monthLabel} vs. {prev.monthLabel}
            </div>
          </div>
          <div style={{ display: 'flex', flex: 1 }}>
            <DeltaCell icon={<GreenCircle size={40}>{Icon.dollar()}</GreenCircle>} label="Faturamento" delta={rDelta} />
            <Divider />
            <DeltaCell icon={<GreenCircle size={40}>{Icon.cart()}</GreenCircle>} label="Pedidos" delta={oDelta} />
            <Divider />
            <DeltaCell icon={<GreenCircle size={40}>{Icon.tag()}</GreenCircle>} label="Ticket médio" delta={tDelta} />
          </div>
        </div>
      </div>

      {/* Insight */}
      <div style={{ marginTop: 16 }}>
        <InsightBorder icon={Icon.bulb()} title="Leitura principal" body={data.monthlyOverview.mainInsight} />
      </div>
    </Shell>
  );
}

// ── Slide 03 — Comportamento por dia da semana ────────────────────────────────
export function Slide03Weekly({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const orders = data.weeklyBehavior.ordersByDay;
  const deliveries = [...data.weeklyBehavior.deliveriesByDay].sort((a, b) => b.value - a.value);
  const maxOrders = Math.max(...orders.map(d => d.value), 1);
  const maxDeliveries = Math.max(...deliveries.map(d => d.value), 1);

  // X-axis scale for deliveries
  const scaleMax = Math.ceil(maxDeliveries / 50) * 50;
  const scaleSteps = [0, scaleMax * 0.25, scaleMax * 0.5, scaleMax * 0.75, scaleMax].map(v => Math.round(v));

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', gap: 14, height: '100%' }}>
        {/* Panel 1: Pedidos por dia (barras verticais) */}
        <div style={{ flex: 2.5, background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <GreenCircle size={36}>{Icon.calendar()}</GreenCircle>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Pedidos por dia</span>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 8, paddingBottom: 4 }}>
            {orders.map((d, i) => {
              const h = Math.max((d.value / maxOrders) * 180, 6);
              const isHigh = d.highlight;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isHigh ? C.text : C.muted }}>{num(d.value)}</span>
                  <div style={{
                    width: '100%', height: h,
                    background: isHigh ? C.green : '#CBD5E1',
                    borderRadius: '6px 6px 0 0',
                  }} />
                  <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{d.day.slice(0, 3)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel 2: Entregas por dia (barras horizontais) */}
        <div style={{ flex: 2.5, background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <GreenCircle size={36}>{Icon.truck()}</GreenCircle>
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Entregas por dia</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
            {deliveries.map((d, i) => {
              const w = (d.value / maxDeliveries) * 100;
              const isHigh = d.highlight || i === 0;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, color: C.sub, width: 72, textAlign: 'right', flexShrink: 0 }}>{d.day}</span>
                  <div style={{ flex: 1, height: 26, background: C.row, borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${w}%`, background: isHigh ? C.green : '#CBD5E1', borderRadius: 6, minWidth: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isHigh ? C.text : C.muted, width: 36, textAlign: 'right', flexShrink: 0 }}>{num(d.value)}</span>
                </div>
              );
            })}
          </div>
          {/* X axis scale */}
          <div style={{ display: 'flex', paddingLeft: 82, gap: 0, marginTop: 6 }}>
            {scaleSteps.map((v, i) => (
              <span key={i} style={{ flex: 1, fontSize: 10, color: C.muted, textAlign: i === 0 ? 'left' : 'center' }}>{v}</span>
            ))}
          </div>
        </div>

        {/* Panel 3: Insights */}
        <div style={{ flex: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Leitura estratégica */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', flex: 1, borderLeft: `4px solid ${C.green}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <GreenCircle size={36}>{Icon.target()}</GreenCircle>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Leitura estratégica</span>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.6 }}>{data.weeklyBehavior.strategicReading}</p>
          </div>

          {/* Oportunidade */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, padding: '16px 18px', flex: 1, borderLeft: `4px solid ${C.green}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <GreenCircle size={36}>{Icon.bulb()}</GreenCircle>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Oportunidade para {data.actionSummary.nextMonth}</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {data.weeklyBehavior.opportunities.slice(0, 4).map((o, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{o}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 04 — Regiões com maior volume de pedidos ────────────────────────────
export function Slide04Regions({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const regions = data.geoRegions.regions.slice(0, 8);

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', gap: 20, height: '100%' }}>
        {/* Left 44% */}
        <div style={{ flex: 2.2, display: 'flex', flexDirection: 'column', gap: 0 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 52, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Regiões com maior<br />volume de pedidos
          </h1>
          <p style={{ margin: '0 0 14px', fontSize: 15, color: C.sub }}>
            Bairros com maior força em {data.monthlyOverview.current.monthLabel.toLowerCase()}
          </p>

          {/* Table */}
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', flex: 1 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 130px', padding: '10px 16px', background: C.row, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                {Icon.pin(C.muted)} Bairro
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textAlign: 'center' }}>Pedidos</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.muted, textAlign: 'right' }}>Faturamento</span>
            </div>
            {/* Rows */}
            {regions.map((r, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1fr 80px 130px',
                padding: '9px 16px',
                borderBottom: i < regions.length - 1 ? `1px solid ${C.border}` : 'none',
                background: i % 2 === 0 ? 'white' : C.row,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'white' }}>{r.rank}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{r.name}</span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text, textAlign: 'center' }}>{num(r.orders)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text, textAlign: 'right' }}>R$ {brl(r.revenue)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right 56% */}
        <div style={{ flex: 2.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Stylized map */}
          <div style={{ flex: 1, borderRadius: 14, overflow: 'hidden', position: 'relative', border: `1px solid ${C.border}` }}>
            <svg width="100%" height="100%" viewBox="0 0 560 310" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
              {/* Background */}
              <rect width="560" height="310" fill="#DBEAFE" />
              {/* Water / grid lines */}
              {[0,1,2,3,4,5,6].map(i => (
                <line key={i} x1={0} y1={i*52} x2={560} y2={i*52} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
              ))}
              {[0,1,2,3,4,5,6,7,8].map(i => (
                <line key={i} x1={i*70} y1={0} x2={i*70} y2={310} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
              ))}
              {/* Region shapes (polygons — simulated bairros) */}
              <polygon points="120,80 200,60 240,100 220,150 160,160 110,130" fill={C.green} opacity="0.9" />
              <polygon points="210,95 270,75 310,110 300,155 250,160 215,140" fill={C.greenMid} opacity="0.85" />
              <polygon points="80,155 150,145 175,185 155,225 90,220 65,190" fill={C.greenMid} opacity="0.75" />
              <polygon points="300,140 360,120 400,160 385,200 320,210 285,175" fill={C.greenLight} opacity="0.9" stroke={C.greenDark} strokeWidth="1.5" />
              <polygon points="380,80 450,65 480,110 460,145 395,148 365,115" fill={C.greenLight} opacity="0.85" stroke={C.greenMid} strokeWidth="1" />
              <polygon points="160,220 230,210 260,250 240,285 175,290 145,260" fill={C.greenLight} opacity="0.8" stroke={C.greenMid} strokeWidth="1" />
              <polygon points="430,155 490,140 520,180 505,220 440,225 415,190" fill={C.greenLight} opacity="0.7" stroke={C.greenMid} strokeWidth="1" />
              {/* Region labels */}
              {[
                { x: 170, y: 115, name: regions[0]?.name || 'R1', rank: 1, dark: true },
                { x: 258, y: 122, name: regions[1]?.name || 'R2', rank: 2, dark: false },
                { x: 122, y: 190, name: regions[2]?.name || 'R3', rank: 3, dark: false },
                { x: 342, y: 176, name: regions[3]?.name || 'R4', rank: 4, dark: false },
                { x: 422, y: 110, name: regions[4]?.name || 'R5', rank: 5, dark: false },
                { x: 204, y: 255, name: regions[5]?.name || 'R6', rank: 6, dark: false },
              ].map((r, i) => (
                <g key={i}>
                  <rect x={r.x - 40} y={r.y - 14} width={80} height={22} rx={11}
                    fill={r.dark ? C.greenDark : 'white'} opacity="0.92"
                    filter="url(#shadow)" />
                  <text x={r.x} y={r.y + 2} textAnchor="middle" fontSize="10" fontWeight="700"
                    fill={r.dark ? 'white' : C.text}>{r.rank}. {r.name.slice(0, 10)}</text>
                </g>
              ))}
              {/* Pin markers */}
              {[[170,88],[258,95],[122,162],[342,148],[422,82],[204,228]].map(([x,y],i) => (
                <g key={i}>
                  <circle cx={x} cy={y} r={7} fill={i===0 ? C.greenDark : 'white'} stroke={C.greenDark} strokeWidth="1.5" />
                  <text x={x} y={y+4} textAnchor="middle" fontSize="8" fontWeight="900" fill={i===0?'white':C.greenDark}>{i+1}</text>
                </g>
              ))}
              <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.15" />
                </filter>
              </defs>
            </svg>
          </div>

          {/* Two insight cards */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', borderLeft: `4px solid ${C.green}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <GreenCircle size={32}>{Icon.arrowRight()}</GreenCircle>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Fortalecer onde já existe demanda</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{data.geoRegions.strengthenInsight}</p>
            </div>
            <div style={{ flex: 1, background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 14px', borderLeft: `4px solid ${C.green}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <GreenCircle size={32}>{Icon.rocket()}</GreenCircle>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Estimular onde há potencial de crescimento</span>
              </div>
              <p style={{ margin: 0, fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{data.geoRegions.growInsight}</p>
            </div>
          </div>

          {/* Remarketing insight */}
          <InsightBorder
            icon={Icon.target()}
            title="Insight para remarketing"
            body={data.geoRegions.remarketingInsight}
          />
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 05 — Base de clientes ───────────────────────────────────────────────
export function Slide05CustomerBase({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const cb = data.customerBase;
  const totalCust = cb.active + cb.inactive + cb.potential;
  const activePct  = totalCust > 0 ? (cb.active   / totalCust * 100) : 0;
  const inactivePct= totalCust > 0 ? (cb.inactive / totalCust * 100) : 0;
  const potPct     = totalCust > 0 ? (cb.potential/ totalCust * 100) : 0;

  // Donut SVG
  const R = 80; const CX = 100; const CY = 100;
  const circ = 2 * Math.PI * R;
  const aDash = circ * cb.active / Math.max(totalCust, 1);
  const iDash = circ * cb.inactive / Math.max(totalCust, 1);
  const pDash = circ * cb.potential / Math.max(totalCust, 1);
  const off0 = circ * 0.25;
  const off1 = off0 - aDash;
  const off2 = off1 - iDash;

  return (
    <Shell current={current} total={total}>
      {/* Title + KPI row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 46, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>Base de clientes</h1>
          <p style={{ margin: '4px 0 0', fontSize: 15, color: C.sub }}>Onde está a maior oportunidade de relacionamento</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Clientes ativos</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: C.green, letterSpacing: '-0.02em', lineHeight: 1 }}>{num(cb.active)}</div>
          </div>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Clientes inativos</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: C.salmon, letterSpacing: '-0.02em', lineHeight: 1 }}>{num(cb.inactive)}</div>
          </div>
          <div style={{ background: 'white', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Em potencial</div>
            <div style={{ fontSize: 34, fontWeight: 800, color: C.muted, letterSpacing: '-0.02em', lineHeight: 1 }}>{num(cb.potential)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, height: 'calc(100% - 118px)' }}>
        {/* Left: Donut + insight */}
        <div style={{ flex: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 20 }}>
            <svg width={200} height={200} viewBox="0 0 200 200" style={{ flexShrink: 0 }}>
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.border} strokeWidth={26} />
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.green} strokeWidth={26}
                strokeDasharray={`${aDash} ${circ - aDash}`} strokeDashoffset={off0} />
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.salmon} strokeWidth={26}
                strokeDasharray={`${iDash} ${circ - iDash}`} strokeDashoffset={off1} />
              <circle cx={CX} cy={CY} r={R} fill="none" stroke={C.greenMid} strokeWidth={26}
                strokeDasharray={`${pDash} ${circ - pDash}`} strokeDashoffset={off2} />
              {/* Center */}
              <circle cx={CX} cy={CY} r={36} fill={C.greenLight} />
              <text x={CX} y={CY - 6} textAnchor="middle" fontSize="11" fill={C.greenDark} fontWeight="700">BASE</text>
              <text x={CX} y={CY + 8} textAnchor="middle" fontSize="11" fill={C.greenDark} fontWeight="700">TOTAL</text>
              <text x={CX} y={CY + 22} textAnchor="middle" fontSize="12" fill={C.green} fontWeight="900">{num(totalCust)}</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { color: C.green,    label: 'Clientes ativos',    pct: activePct,   count: cb.active },
                { color: C.salmon,   label: 'Clientes inativos',  pct: inactivePct, count: cb.inactive },
                { color: C.greenMid, label: 'Em potencial',       pct: potPct,      count: cb.potential },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, color: C.sub }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{num(item.count)} <span style={{ fontWeight: 400, color: C.muted }}>({item.pct.toFixed(1)}%)</span></div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Insight borda esquerda */}
          <InsightBorder icon={Icon.bulb()} body={cb.baseInsight} />
        </div>

        {/* Right: Segmentação */}
        <div style={{ flex: 2.2, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Dentro da base ativa */}
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>Dentro da base ativa</div>
            <div style={{ display: 'flex', gap: 14 }}>
              {[
                { icon: Icon.cart(), label: 'pedidos registrados na base', value: num(cb.ordersInBase) },
                { icon: Icon.people(), label: 'Clientes com 1 pedido', value: num(cb.singleOrderCount) },
                { icon: Icon.people(), label: 'Clientes com mais de 1 pedido', value: num(cb.multiOrderCount) },
              ].map((m, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 8px', background: C.row, borderRadius: 10, textAlign: 'center' }}>
                  <GreenCircle size={42}>{m.icon}</GreenCircle>
                  <div style={{ fontSize: 28, fontWeight: 900, color: C.green, letterSpacing: '-0.02em', lineHeight: 1 }}>{m.value}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>{m.label}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Como segmentar */}
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>Como segmentar os ativos</div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[
                { bg: C.blueLight,   color: C.blue,      label: 'Primeira compra',      sub: 'Incentivar segunda compra' },
                { bg: C.greenLight,  color: C.greenDark, label: 'Recorrentes',          sub: 'Estimular combos e favoritos' },
                { bg: C.purpleLight, color: C.purple,    label: 'Muito recorrentes',    sub: 'Comunicação VIP e fidelidade' },
              ].map((s, i) => (
                <div key={i} style={{ flex: 1, background: s.bg, borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: s.color, marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 12, color: C.sub }}>{s.sub}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* Bottom insight */}
          <InsightBorder icon={Icon.message()} body={cb.segmentInsight} />
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 06 — Inativos e potenciais ─────────────────────────────────────────
export function Slide06Inactives({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { ranges, potentialCount, approachSuggestions, entryProducts, cta } = data.inactives;
  const maxRange = Math.max(...ranges.map(r => r.count), 1);
  const priorityRanges = ranges.filter(r => r.priority);
  const priorityStart = ranges.findIndex(r => r.priority);
  const priorityCount = priorityRanges.length;
  const rowH = ranges.length > 0 ? Math.floor(160 / ranges.length) : 30;

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', gap: 20, height: '100%' }}>
        {/* Left 55% */}
        <div style={{ flex: 2.7, display: 'flex', flexDirection: 'column', gap: 0 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 52, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>Inativos e potenciais</h1>
          <p style={{ margin: '0 0 14px', fontSize: 15, color: C.sub }}>A maior reserva de crescimento para {data.actionSummary.nextMonth}</p>

          <Card style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <GreenCircle size={36}>{Icon.chart()}</GreenCircle>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Distribuição da base inativa</span>
            </div>

            <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'space-around' }}>
              {/* Priority bracket */}
              {priorityCount > 0 && (
                <div style={{
                  position: 'absolute',
                  top: `${(priorityStart / ranges.length) * 100}%`,
                  right: 0,
                  height: `${(priorityCount / ranges.length) * 100}%`,
                  width: 52,
                  border: `2px dashed ${C.green}`,
                  borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none',
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 800, color: C.green,
                    letterSpacing: '0.12em', writingMode: 'vertical-rl',
                    transform: 'rotate(180deg)', textTransform: 'uppercase',
                  }}>PRIORIDADE</span>
                </div>
              )}

              {ranges.map((r, i) => {
                const w = (r.count / maxRange) * 100;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingRight: priorityCount > 0 ? 60 : 0 }}>
                    <span style={{ fontSize: 12, width: 100, flexShrink: 0, textAlign: 'right', fontWeight: r.priority ? 700 : 400, color: r.priority ? C.text : C.muted }}>{r.label}</span>
                    <div style={{ flex: 1, height: 32, background: C.row, borderRadius: 6, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${w}%`, background: r.priority ? C.green : '#CBD5E1', borderRadius: 6, minWidth: 4 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: r.priority ? C.greenDark : C.text, width: 56, textAlign: 'right', flexShrink: 0 }}>{num(r.count)}</span>
                  </div>
                );
              })}
            </div>

            {/* X-axis scale */}
            <div style={{ display: 'flex', paddingLeft: 116, marginTop: 6 }}>
              {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
                <span key={i} style={{ flex: 1, fontSize: 10, color: C.muted, textAlign: i === 0 ? 'left' : 'center' }}>
                  {num(Math.round(maxRange * v))}
                </span>
              ))}
            </div>
          </Card>
        </div>

        {/* Right 45% */}
        <div style={{ flex: 2.2, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Potenciais — big number */}
          <Card style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <GreenCircle size={52}>{Icon.people()}</GreenCircle>
            <div>
              <div style={{ fontSize: 48, fontWeight: 900, color: C.green, letterSpacing: '-0.03em', lineHeight: 1 }}>{num(potentialCount)}</div>
              <div style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>contatos sem pedidos registrados</div>
            </div>
          </Card>

          {/* Abordagens sugeridas */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <GreenCircle size={34}>{Icon.message()}</GreenCircle>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Abordagens sugeridas</span>
            </div>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {approachSuggestions.slice(0, 3).map((a, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>{a}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Porta de entrada */}
          {entryProducts.length > 0 && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <GreenCircle size={34}>{Icon.bag()}</GreenCircle>
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Porta de entrada</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {entryProducts.slice(0, 5).map((p, i) => (
                  <div key={i} style={{ background: C.greenLight, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: C.greenDark }}>
                    {p}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* CTA borda esquerda */}
          <div style={{ borderLeft: `4px solid ${C.green}`, paddingLeft: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <GreenCircle size={36}>{Icon.target()}</GreenCircle>
            <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.6 }}>{cta}</p>
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
  const comboIcons = [Icon.trophy(), Icon.cart(), Icon.tag(), Icon.rocket(), Icon.bulb()];

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', gap: 20, height: '100%' }}>
        {/* Left 48% */}
        <div style={{ flex: 2.4, display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 52, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
            Produtos<br />campeões
          </h1>
          <p style={{ margin: '0 0 14px', fontSize: 15, color: C.sub }}>Como usar para aumentar ticket</p>

          {/* Grid 2x2 + 1 full */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1 }}>
              {combos.slice(0, 4).map((c, i) => (
                <Card key={i} style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <GreenCircle size={36}>{comboIcons[i]}</GreenCircle>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3 }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{c.description}</div>
                  </div>
                </Card>
              ))}
            </div>
            {combos[4] && (
              <Card style={{ padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <GreenCircle size={36}>{comboIcons[4]}</GreenCircle>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 3 }}>{combos[4].title}</div>
                  <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>{combos[4].description}</div>
                </div>
              </Card>
            )}
          </div>
        </div>

        {/* Right 52% */}
        <div style={{ flex: 2.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>
              Top produtos de consumo em {data.monthlyOverview.current.monthLabel.toLowerCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ranking.slice(0, 6).map((p, i) => {
                const w = (p.orders / maxOrders) * 100;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: 'white' }}>{p.rank}</span>
                    </div>
                    <span style={{ fontSize: 13, color: C.text, width: 170, flexShrink: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <div style={{ flex: 1, height: 14, background: C.row, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${w}%`, background: C.green, borderRadius: 4, minWidth: 4 }} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text, width: 36, textAlign: 'right', flexShrink: 0 }}>{num(p.orders)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Insight borda esquerda */}
          <InsightBorder icon={Icon.target()} title="Insight" body={insight} />
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 08 — Tráfego pago ───────────────────────────────────────────────────
export function Slide08Traffic({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const pt = data.paidTraffic!;
  const campColors = [C.green, C.blue, C.purple, C.salmon];

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
        {/* Row 1: 4 KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { icon: Icon.dollar(), label: 'Investimento',   value: `R$ ${brl(pt.investment)}` },
            { icon: Icon.eye(),    label: 'Impressões',     value: num(pt.impressions) },
            { icon: Icon.people(), label: 'Alcance somado', value: num(pt.reach) },
            { icon: Icon.click(),  label: 'Cliques no link',value: num(pt.clicks) },
          ].map((kpi, i) => (
            <Card key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px' }}>
              <GreenCircle size={44}>{kpi.icon}</GreenCircle>
              <div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 3 }}>{kpi.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: C.text, letterSpacing: '-0.02em', lineHeight: 1 }}>{kpi.value}</div>
              </div>
            </Card>
          ))}
        </div>

        {/* Row 2: Campanhas analisadas */}
        {pt.campaignNames.length > 0 && (
          <Card style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <GreenCircle size={38} color={C.blueLight}>{Icon.clipboard()}</GreenCircle>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 }}>Campanhas analisadas</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 12px' }}>
                {pt.campaignNames.slice(0, 9).map((name, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: C.sub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}

        {/* Row 3: Campaign detail cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(pt.topCampaigns.length, 2)}, 1fr)`, gap: 12, flex: 1 }}>
          {pt.topCampaigns.slice(0, 2).map((camp, ci) => {
            const borderColor = campColors[ci] || C.green;
            return (
              <Card key={ci} style={{ borderLeft: `4px solid ${borderColor}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <GreenCircle size={44} color={ci === 0 ? C.greenLight : C.blueLight}>
                    {ci === 0 ? Icon.whatsapp : Icon.cart(C.blue)}
                  </GreenCircle>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>{camp.name}</div>
                    <div style={{ fontSize: 12, color: C.muted }}>{camp.description}</div>
                  </div>
                </div>
                {/* Metrics horizontal */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, padding: '10px 0' }}>
                  {camp.metrics.slice(0, 4).map((m, mi) => (
                    <React.Fragment key={mi}>
                      <div style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{ fontSize: 11, color: C.muted, marginBottom: 3 }}>{m.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{m.value}</div>
                      </div>
                      {mi < Math.min(camp.metrics.length, 4) - 1 && (
                        <div style={{ width: 1, height: 40, background: C.border }} />
                      )}
                    </React.Fragment>
                  ))}
                </div>
                {/* Insight arrow */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: borderColor, fontWeight: 800, fontSize: 14, flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 13, color: C.sub, lineHeight: 1.5 }}>{camp.insight}</span>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Row 4: Recomendação */}
        <InsightBorder icon={Icon.target()} title="Recomendação" body={pt.recommendation} />
      </div>
    </Shell>
  );
}

// ── Slide 09a — Diagnóstico: Criativos + Forças ───────────────────────────────
export function Slide09aCreatives({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { creatives, revenueForces, conclusion, nextMonth } = data.actionSummary;
  const forceIcons = [Icon.refresh(), Icon.trophy(), Icon.calendar(), Icon.pin()];
  const thumbnailBgs = ['#1a1a2e', C.greenLight, C.blueLight, C.purpleLight, C.row];

  return (
    <Shell current={current} total={total}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, flex: 1 }}>
          {/* Col 1: Criativos */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <NumBadge n={1} />
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Criativos com melhor sinal</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 8, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>CRIATIVO</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: '0.08em', textTransform: 'uppercase' }}>ROAS</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
              {creatives.slice(0, 5).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                      background: thumbnailBgs[i % thumbnailBgs.length],
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: `1px solid ${C.border}`,
                    }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: i === 0 ? 'white' : C.sub }}>
                        {c.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || `C${i + 1}`}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: C.text, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{c.name}</span>
                  </div>
                  <span style={{ fontSize: 20, fontWeight: 900, color: C.green, flexShrink: 0 }}>{c.roas.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Col 2: O que compõe o faturamento */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <NumBadge n={2} />
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>O que compõe o faturamento</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1, alignContent: 'center' }}>
              {revenueForces.slice(0, 4).map((force, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '14px 10px', background: C.row, borderRadius: 10, border: `1px solid ${C.border}` }}>
                  <GreenCircle size={44}>{forceIcons[i]}</GreenCircle>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text, textAlign: 'center', lineHeight: 1.4 }}>{force}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Col 3: Plano de ação */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <NumBadge n={3} />
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Plano de ação</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
              {data.actionSummary.actionPlan.slice(0, 6).map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.greenLight, border: `1px solid ${C.greenMid}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: C.greenDark }}>{i + 1}</span>
                  </div>
                  <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Col 4: Prioridades */}
          <Card style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <NumBadge n={4} />
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Prioridades</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
              {data.actionSummary.priorities.slice(0, 6).map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 5 }} />
                  <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Bottom full-width: conclusão */}
        <div style={{
          background: 'linear-gradient(135deg, #F0FFF4 0%, #EFF6FF 100%)',
          border: `1px solid ${C.border}`,
          borderRadius: 14, padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
        }}>
          <GreenCircle size={40}>{Icon.target()}</GreenCircle>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text, lineHeight: 1.6, fontStyle: 'italic' }}>{conclusion}</p>
        </div>
      </div>
    </Shell>
  );
}

// ── Slide 09b — Plano de ação ─────────────────────────────────────────────────
export function Slide09bActionPlan({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { actionPlan, priorities, nextMonth, conclusion } = data.actionSummary;

  return (
    <Shell current={current} total={total}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 58, fontWeight: 900, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
          Plano de ação<br />para {nextMonth}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 17, color: C.sub }}>Transformar diagnóstico em ações táticas de alto impacto</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, height: 'calc(100% - 124px)' }}>
        {/* Plano de ação */}
        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <NumBadge n={1} />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Plano de ação para {nextMonth}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {actionPlan.slice(0, 8).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: C.green, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', flexShrink: 0, marginTop: 1,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>{i + 1}</span>
                </div>
                <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{item}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Prioridades */}
        <Card style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <NumBadge n={2} />
            <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Prioridades recomendadas</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
            {priorities.slice(0, 8).map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 6 }} />
                <span style={{ fontSize: 13, color: C.text, lineHeight: 1.6 }}>{item}</span>
              </div>
            ))}
          </div>
          {/* Conclusão no rodapé do card */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Síntese</div>
            <div style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, fontStyle: 'italic' }}>{conclusion}</div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}

// ── Slide 10 — Destaques das campanhas ───────────────────────────────────────
export function Slide10CampaignHighlights({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const pt = data.paidTraffic!;
  const campColors = [C.green, C.blue];

  return (
    <Shell current={current} total={total}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 42, fontWeight: 900, color: C.text, letterSpacing: '-0.025em', lineHeight: 1.1 }}>Destaques das campanhas</h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: C.sub }}>Desempenho das campanhas em {data.monthlyOverview.current.monthLabel.toLowerCase()}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(pt.topCampaigns.length, 2)}, 1fr)`, gap: 18, height: 'calc(100% - 74px)' }}>
        {pt.topCampaigns.slice(0, 2).map((camp, ci) => {
          const borderColor = campColors[ci] || C.green;
          return (
            <Card key={ci} style={{ borderLeft: `4px solid ${borderColor}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 14, borderBottom: `1px solid ${C.border}` }}>
                <GreenCircle size={48} color={ci === 0 ? C.greenLight : C.blueLight}>
                  {ci === 0 ? Icon.whatsapp : Icon.cart(C.blue)}
                </GreenCircle>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: C.text, lineHeight: 1.2 }}>{camp.name}</div>
                  <div style={{ fontSize: 13, color: C.muted, marginTop: 3 }}>{camp.description}</div>
                </div>
              </div>
              {/* Metrics grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {camp.metrics.slice(0, 6).map((m, mi) => (
                  <div key={mi} style={{ background: C.row, borderRadius: 10, padding: '10px 14px', border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, lineHeight: 1.3 }}>{m.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>{m.value}</div>
                  </div>
                ))}
              </div>
              {/* Insight */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 12, background: C.greenLight, borderRadius: 10, padding: '12px 16px', borderLeft: `4px solid ${C.green}` }}>
                <GreenCircle size={34}>{Icon.bulb()}</GreenCircle>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.greenDark, marginBottom: 4 }}>Insight estratégico</div>
                  <p style={{ margin: 0, fontSize: 13, color: C.sub, lineHeight: 1.55 }}>{camp.insight}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </Shell>
  );
}

// ── Slide 11 — O que sustentou o faturamento ─────────────────────────────────
export function Slide11RevenueComposition({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const { revenueForces, revenueForceDetails, assetsForNextMonth, conclusion, nextMonth } = data.actionSummary;
  const forceIcons = [Icon.refresh(), Icon.trophy(), Icon.calendar(), Icon.pin()];

  return (
    <Shell current={current} total={total}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 42, fontWeight: 900, color: C.text, letterSpacing: '-0.025em', lineHeight: 1.1 }}>O que sustentou o faturamento</h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: C.sub }}>Forças que compõem a receita e ativos para {nextMonth}</p>
      </div>

      <div style={{ display: 'flex', gap: 18, height: 'calc(100% - 74px)' }}>
        {/* Left: force cards + conclusion */}
        <div style={{ flex: 2.2, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, flex: 1 }}>
            {revenueForces.slice(0, 4).map((force, i) => (
              <Card key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <GreenCircle size={40}>{forceIcons[i]}</GreenCircle>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{force}</span>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: C.sub, lineHeight: 1.6, flex: 1 }}>
                  {(revenueForceDetails || [])[i] || ''}
                </p>
              </Card>
            ))}
          </div>
          {/* Conclusion */}
          <div style={{ background: 'linear-gradient(135deg, #F0FFF4 0%, #EFF6FF 100%)', border: `1px solid ${C.border}`, borderRadius: 14, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <GreenCircle size={38}>{Icon.target()}</GreenCircle>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.text, lineHeight: 1.6 }}>{conclusion}</p>
          </div>
        </div>

        {/* Right: assets for next month */}
        <Card style={{ flex: 1.2, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <GreenCircle size={40}>{Icon.rocket()}</GreenCircle>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: C.text }}>O que ainda temos</div>
              <div style={{ fontSize: 12, color: C.muted }}>para aproveitar em {nextMonth}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            {(assetsForNextMonth || []).slice(0, 8).map((asset, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 10px', background: i % 2 === 0 ? C.row : 'white', borderRadius: 8, border: `1px solid ${C.border}` }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0, marginTop: 5 }} />
                <span style={{ fontSize: 12, color: C.text, lineHeight: 1.5 }}>{asset}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}

// ── Slide 12 — Plano de ação detalhado ────────────────────────────────────────
export function Slide12DetailedPlan({ data, current, total }: { data: DeliveryReportData; current: number; total: number }) {
  const plan = data.campaignActionPlan!;
  const { nextMonth } = data.actionSummary;

  return (
    <Shell current={current} total={total}>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 42, fontWeight: 900, color: C.text, letterSpacing: '-0.025em', lineHeight: 1.1 }}>
          Plano de ação detalhado — {nextMonth}
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 15, color: C.sub }}>Campanhas recomendadas por etapa do relacionamento com o cliente</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100% - 74px)' }}>
        {/* Campaign cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(plan.campaigns.length, 5)}, 1fr)`, gap: 10, flex: 1 }}>
          {plan.campaigns.slice(0, 5).map((camp, i) => (
            <Card key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <NumBadge n={i + 1} />
                <span style={{ fontWeight: 700, fontSize: 12, color: C.text, lineHeight: 1.3 }}>{camp.name}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: C.sub }}><strong style={{ color: C.text }}>Objetivo:</strong> {camp.objective}</div>
                <div style={{ fontSize: 11, color: C.sub }}><strong style={{ color: C.text }}>Público:</strong> {camp.audience}</div>
                <div style={{ background: C.greenLight, borderRadius: 8, padding: '7px 10px', fontSize: 11, color: C.greenDark, fontStyle: 'italic', lineHeight: 1.5 }}>
                  "{camp.message}"
                </div>
                {camp.product && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: C.muted }}>{camp.product}</span>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>

        {/* Customer journey */}
        {plan.customerJourney.length > 0 && (
          <Card style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0 }}>
            {plan.customerJourney.map((step, i) => (
              <React.Fragment key={i}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.text, whiteSpace: 'nowrap' }}>{step}</span>
                </div>
                {i < plan.customerJourney.length - 1 && (
                  <div style={{ color: C.greenMid, fontSize: 18, fontWeight: 900, padding: '0 4px' }}>→</div>
                )}
              </React.Fragment>
            ))}
          </Card>
        )}

        {/* Guidelines */}
        {plan.guidelines.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(plan.guidelines.length, 4)}, 1fr)`, gap: 8, flexShrink: 0 }}>
            {plan.guidelines.slice(0, 4).map((g, i) => (
              <div key={i} style={{ background: C.row, border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: C.text }}>{g}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}

// ── Slide list builder ────────────────────────────────────────────────────────
type SlideKey =
  | 'cover' | 'monthly' | 'weekly' | 'regions'
  | 'customerBase' | 'inactives' | 'products' | 'traffic'
  | 'creatives' | 'actionPlan'
  | 'campaignHighlights' | 'revenueComposition' | 'detailedPlan';

export function buildDeliverySlideList(data: DeliveryReportData): SlideKey[] {
  const list: SlideKey[] = ['cover', 'monthly'];

  if (data.weeklyBehavior.ordersByDay.some(d => d.value > 0)) list.push('weekly');
  if (data.geoRegions.regions.length > 0 && data.geoRegions.regions.some(r => r.orders > 0)) list.push('regions');
  if (data.customerBase.active > 0 || data.customerBase.inactive > 0 || data.customerBase.potential > 0) list.push('customerBase');
  if (data.inactives.ranges.some(r => r.count > 0) || data.inactives.potentialCount > 0) list.push('inactives');
  if (data.topProducts.ranking.length > 0 && data.topProducts.ranking.some(p => p.orders > 0)) list.push('products');
  if (data.paidTraffic) list.push('traffic');

  list.push('creatives');
  list.push('actionPlan');

  if (data.paidTraffic?.topCampaigns.length) list.push('campaignHighlights');
  if (data.actionSummary.revenueForces.length >= 3) list.push('revenueComposition');
  if (data.campaignActionPlan?.campaigns.length) list.push('detailedPlan');

  return list;
}

// ── Public API ────────────────────────────────────────────────────────────────
export function renderDeliverySlide(
  data: DeliveryReportData,
  slideIndex: number,
  totalSlides: number,
): React.ReactNode {
  const list = buildDeliverySlideList(data);
  const key = list[slideIndex];
  const current = slideIndex + 1;

  switch (key) {
    case 'cover':              return <Slide01Cover data={data} current={current} total={totalSlides} />;
    case 'monthly':            return <Slide02Monthly data={data} current={current} total={totalSlides} />;
    case 'weekly':             return <Slide03Weekly data={data} current={current} total={totalSlides} />;
    case 'regions':            return <Slide04Regions data={data} current={current} total={totalSlides} />;
    case 'customerBase':       return <Slide05CustomerBase data={data} current={current} total={totalSlides} />;
    case 'inactives':          return <Slide06Inactives data={data} current={current} total={totalSlides} />;
    case 'products':           return <Slide07Products data={data} current={current} total={totalSlides} />;
    case 'traffic':            return <Slide08Traffic data={data} current={current} total={totalSlides} />;
    case 'creatives':          return <Slide09aCreatives data={data} current={current} total={totalSlides} />;
    case 'actionPlan':         return <Slide09bActionPlan data={data} current={current} total={totalSlides} />;
    case 'campaignHighlights': return <Slide10CampaignHighlights data={data} current={current} total={totalSlides} />;
    case 'revenueComposition': return <Slide11RevenueComposition data={data} current={current} total={totalSlides} />;
    case 'detailedPlan':       return <Slide12DetailedPlan data={data} current={current} total={totalSlides} />;
    default:                   return null;
  }
}

export function getDeliverySlideCount(data: DeliveryReportData): number {
  return buildDeliverySlideList(data).length;
}
