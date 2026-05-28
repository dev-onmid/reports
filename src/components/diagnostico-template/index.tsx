'use client';

import { type ReactNode, type CSSProperties } from 'react';
import type { DiagnosticoData, CriativoItem, OrigemItem, ClienteItem } from './types';

// ── Tokens ─────────────────────────────────────────────────────────────────
const G  = '#22c55e';
const GL = '#f0fdf4';
const GB = '#bbf7d0';
const B  = '#3b82f6';
const BL = '#eff6ff';
const TX = '#111827';
const TG = '#6b7280';
const TM = '#374151';
const BD = '#f1f5f9';
const SH = '0 12px 34px rgba(15,23,42,0.10), 0 1px 2px rgba(15,23,42,0.04)';

// ── SVG icon registry (Lucide-style line icons) ────────────────────────────

const ICONS: Record<string, ReactNode> = {
  '$':   <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  '💬':  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  '👁':  <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  '👥':  <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  '🛒':  <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
  '📄':  <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>,
  '👤':  <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  '🏷':  <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></>,
  '📊':  <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  '📅':  <><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  '💡':  <><line x1="9" y1="18" x2="15" y2="18" /><line x1="10" y1="22" x2="14" y2="22" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" /></>,
  '📖':  <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></>,
  '↗':   <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>,
  '➕':  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  '🛡':  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  '🔍':  <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  '⚠️': <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  '🎯':  <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  'ℹ':   <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>,
  '★':   <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
};

// ── Primitives ─────────────────────────────────────────────────────────────

function IBox({ icon, green, size = 30 }: { icon: string; green?: boolean; size?: number }) {
  const svgNode = ICONS[icon];
  const color = green ? G : B;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: green ? GL : BL,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {svgNode ? (
        <svg viewBox="0 0 24 24" width={size * 0.52} height={size * 0.52}
          fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {svgNode}
        </svg>
      ) : (
        <span style={{ fontSize: size * 0.46 }}>{icon}</span>
      )}
    </div>
  );
}

function Bar({ pct, color = G }: { pct: number; color?: string }) {
  return (
    <div style={{ flex: 1, height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color, borderRadius: 3 }} />
    </div>
  );
}

function Card({ children, style, accent }: { children: ReactNode; style?: CSSProperties; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? GL : '#fff',
      border: `1.5px solid ${accent ? GB : BD}`,
      borderRadius: 14, padding: '14px 18px',
      boxShadow: accent ? 'none' : SH,
      ...style,
    }}>{children}</div>
  );
}

function Kpi({ icon, label, value, green, accent }: {
  icon: string; label: string; value: string | number; green?: boolean; accent?: boolean;
}) {
  return (
    <Card accent={accent} style={{ padding: '13px 15px' }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 8 }}>
        <IBox icon={icon} green={green || accent} size={28} />
        <span style={{ fontSize: 10.5, color: TG, lineHeight: 1.35, paddingTop: 1 }}>{label}</span>
      </div>
      <p style={{ fontWeight: 800, fontSize: 20, color: accent ? G : TX, margin: 0, lineHeight: 1 }}>
        {String(value)}
      </p>
    </Card>
  );
}

function Leitura({ text, title = 'Leitura', style }: { text: string; title?: string; style?: CSSProperties }) {
  return (
    <div style={{
      display: 'flex', gap: 14, alignItems: 'flex-start',
      background: GL, border: `1.5px solid ${GB}`,
      borderLeft: `4px solid ${G}`, borderRadius: 12,
      padding: '13px 17px', ...style,
    }}>
      <IBox icon="💡" green size={32} />
      <div>
        <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: '0 0 4px' }}>{title}</p>
        <p style={{ fontSize: 11.5, color: TM, lineHeight: 1.6, margin: 0 }}>{text}</p>
      </div>
    </div>
  );
}

// ── Persistent header / footer elements ────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 900, fontSize: 31, color: TX, letterSpacing: -1.4, lineHeight: 1 }}>onmid</span>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        background: 'linear-gradient(90deg, #25e10f 0%, #22c55e 100%)',
        borderRadius: 40, width: 48, height: 25,
        paddingRight: 4, gap: 2, boxSizing: 'border-box',
        boxShadow: '0 10px 22px rgba(34,197,94,0.24)',
      }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(255,255,255,0.38)' }} />
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
      </div>
      <span style={{ fontSize: 9, color: '#aaa' }}>®</span>
    </div>
  );
}

function PageNum({ n, total }: { n: number; total: number }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <span style={{ fontWeight: 800, fontSize: 17, color: TX }}>{String(n).padStart(2, '0')}</span>
      <span style={{ fontWeight: 400, fontSize: 17, color: '#c8d3dc' }}>/{String(total).padStart(2, '0')}</span>
      <div style={{ height: 2.5, background: G, borderRadius: 2, marginTop: 4 }} />
    </div>
  );
}

function Footer() {
  return (
    <div style={{
      position: 'absolute', bottom: 17, left: 44, zIndex: 2,
      display: 'flex', alignItems: 'center', gap: 7,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        background: G, borderRadius: 40, width: 34, height: 18,
        paddingRight: 2, gap: 2, boxSizing: 'border-box',
      }}>
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.4)' }} />
        <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#fff' }} />
      </div>
      <span style={{ fontSize: 11, color: '#555' }}><strong style={{ color: '#333' }}>ONMID</strong> Reports</span>
    </div>
  );
}

// ── Slide (every page uses this — header/footer always at same coordinates) ──

const TOTAL_SLIDES = 10;

function Slide({ n, children }: { n: number; children: ReactNode }) {
  return (
    <section className="onmid-report-page" aria-label={`Página ${n}`} style={{
      position: 'relative', width: 'min(100%, var(--screen-w))', aspectRatio: '16 / 9',
      background: '#fff', overflow: 'hidden', boxSizing: 'border-box',
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      pageBreakAfter: 'always', breakAfter: 'page',
    }}>
      {/* Background blob top-right — soft blue-gray circle */}
      <div style={{
        position: 'absolute', top: -160, right: -160, width: 580, height: 580,
        borderRadius: '50%', pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(circle, rgba(219,234,254,0.55) 0%, rgba(226,232,240,0.30) 45%, transparent 72%)',
      }} />
      {/* Logo — always top-left */}
      <div style={{ position: 'absolute', top: 26, left: 44, zIndex: 2 }}>
        <Logo />
      </div>
      {/* Page number — always top-right */}
      <div style={{ position: 'absolute', top: 26, right: 44, zIndex: 2 }}>
        <PageNum n={n} total={TOTAL_SLIDES} />
      </div>
      {/* Content starts below header */}
      <div style={{ position: 'relative', zIndex: 1, padding: '72px 44px 50px', height: '100%', boxSizing: 'border-box' }}>
        {children}
      </div>
      <Footer />
    </section>
  );
}

// ── Page 1 — Capa ──────────────────────────────────────────────────────────

function Page1({ d }: { d: DiagnosticoData }) {
  return (
    <Slide n={1}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 36, height: '100%', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 62, lineHeight: 1.04, color: TX, margin: '0 0 10px' }}>
            Diagnóstico de<br />Performance
          </h1>
          <p style={{ fontWeight: 700, fontSize: 22, color: G, margin: '0 0 18px' }}>{d.cliente}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <IBox icon="📅" green size={22} />
            <strong style={{ fontSize: 13, color: TX }}>Período analisado:</strong>
            <span style={{ fontSize: 13, color: TG }}> {d.periodo}</span>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#f8fafc', border: `1px solid ${BD}`, borderRadius: 10, padding: '7px 14px',
          }}>
            <IBox icon="📊" green size={22} />
            <span style={{ fontSize: 12, color: TG, fontWeight: 500 }}>{d.subtitulo}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card style={{ padding: '18px 22px' }}>
            <div style={{ height: 55, marginBottom: 14 }}>
              <svg viewBox="0 0 300 55" width="100%" height="100%" preserveAspectRatio="none">
                <polyline points="0,52 60,42 120,30 180,20 240,11 300,4" fill="none" stroke={G} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="0,52 60,46 120,39 180,30 240,25 300,18" fill="none" stroke={B} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5,3" />
              </svg>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={{ fontSize: 11, color: TG, margin: '0 0 3px' }}>Faturamento</p>
                <p style={{ fontWeight: 800, fontSize: 26, color: TX, margin: 0 }}>{d.capa.faturamento}</p>
                {d.capa.faturamento_var && (
                  <p style={{ fontSize: 10, color: G, margin: '3px 0 0', fontWeight: 600 }}>▲ {d.capa.faturamento_var} vs período anterior</p>
                )}
              </div>
              <IBox icon="↗" green size={30} />
            </div>
          </Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {([
              ['Investimento', d.capa.investimento, d.capa.investimento_var],
              ['ROAS', d.capa.roas, d.capa.roas_var],
              ['Leads', d.capa.leads, d.capa.leads_var],
            ] as [string, string, string | undefined][]).map(([lbl, val, vari]) => (
              <Card key={lbl} style={{ padding: '11px 14px' }}>
                <p style={{ fontSize: 10, color: TG, margin: '0 0 3px' }}>{lbl}</p>
                <p style={{ fontWeight: 800, fontSize: 15, color: TX, margin: 0 }}>{val}</p>
                {vari && <p style={{ fontSize: 9, color: G, margin: '2px 0 0', fontWeight: 600 }}>▲ {vari} vs período anterior</p>}
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 2 — Visão geral ────────────────────────────────────────────────────

function Page2({ d }: { d: DiagnosticoData }) {
  const m = d.meta;
  return (
    <Slide n={2}>
      <h1 style={{ fontWeight: 800, fontSize: 32, color: TX, margin: '0 0 4px' }}>Visão geral da mídia paga</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
        <IBox icon="📅" green size={20} />
        <strong style={{ fontSize: 12.5, color: TX }}>Período analisado:</strong>
        <span style={{ fontSize: 12.5, color: TG }}> {d.periodo}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 9, marginBottom: 9 }}>
        <Kpi icon="$" label="Investimento total" value={m.investimento_total} green />
        <Kpi icon="💬" label="Resultados / conversas iniciadas" value={m.resultados} green />
        <Kpi icon="$" label="Custo por resultado" value={m.custo_resultado} green />
        <Kpi icon="👁" label="Impressões" value={m.impressoes} />
        <Kpi icon="👥" label="Alcance somado" value={m.alcance} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9, marginBottom: 12 }}>
        <Kpi icon="💬" label="Total de contatos por mensagem" value={m.total_contatos} />
        <Kpi icon="👤" label="Novos contatos de mensagem" value={m.novos_contatos} green />
        <Kpi icon="$" label="Custo por novo contato" value={m.custo_novo_contato} green />
        <Kpi icon="🛒" label="Compras registradas no Meta Ads" value={m.compras} />
      </div>
      <Leitura text={m.leitura} />
    </Slide>
  );
}

// ── Page 3 — Plataformas ────────────────────────────────────────────────────

function Page3({ d }: { d: DiagnosticoData }) {
  const m = d.meta;
  type PD = typeof m.facebook;
  function PlatCard({ name, icon, data }: { name: string; icon: string; data: PD }) {
    const rows: [string, string, string | number, boolean][] = [
      ['$',  'Investimento',        data.investimento,      false],
      ['↗',  'Resultados',          data.resultados,        false],
      ['🏷', 'Custo por resultado', data.custo_resultado,   true],
      ['👤', 'Novos contatos',      data.novos_contatos,    false],
      ['➕', 'Custo por novo contato', data.custo_novo_contato, true],
    ];
    return (
      <Card style={{ flex: 1, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <IBox icon={icon} green size={32} />
          <p style={{ fontWeight: 800, fontSize: 18, color: TX, margin: 0 }}>{name}</p>
        </div>
        {rows.map(([ico, lbl, val, hi]) => (
          <div key={lbl} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 0', borderBottom: `1px solid ${BD}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IBox icon={String(ico)} size={26} />
              <span style={{ fontSize: 11.5, color: TM }}>{lbl}</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, color: hi ? G : TX }}>{String(val)}</span>
          </div>
        ))}
      </Card>
    );
  }
  return (
    <Slide n={3}>
      <h1 style={{ fontWeight: 800, fontSize: 34, color: TX, margin: '0 0 4px' }}>Desempenho por plataforma</h1>
      <p style={{ fontWeight: 700, fontSize: 17, color: G, margin: '0 0 16px' }}>Facebook x Instagram</p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <PlatCard name="Facebook" icon="👥" data={m.facebook} />
        <PlatCard name="Instagram" icon="📊" data={m.instagram} />
      </div>
      <Leitura text={m.leitura_plataformas} />
    </Slide>
  );
}

// ── Page 4 — Criativos ──────────────────────────────────────────────────────

function Page4({ d }: { d: DiagnosticoData }) {
  const list = d.meta.criativos.slice(0, 10);
  return (
    <Slide n={4}>
      <h1 style={{ fontWeight: 800, fontSize: 30, color: TX, margin: '0 0 14px' }}>
        Principais criativos<br />por volume de resultados
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 120px', gap: 4, padding: '0 8px 6px', borderBottom: `1px solid ${BD}` }}>
            {['Criativo', 'Investimento', 'Resultados', 'Custo por resultado'].map(h => (
              <span key={h} style={{ fontSize: 9.5, color: TG, fontWeight: 600 }}>{h}</span>
            ))}
          </div>
          {list.map((c: CriativoItem, i: number) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 80px 120px',
              gap: 4, padding: '5.5px 8px', borderBottom: `1px solid ${BD}`, alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: G,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>{i + 1}</div>
                <span style={{ fontSize: 11, color: TX, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
                <Bar pct={c.bar_pct} />
              </div>
              <span style={{ fontSize: 11, color: TM }}>{c.investimento}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: TX }}>{c.resultados}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: G }}>{c.custo_resultado}</span>
            </div>
          ))}
          {list.length === 0 && (
            <p style={{ fontSize: 12, color: TG, padding: '20px 8px' }}>Nenhum criativo registrado no período.</p>
          )}
        </div>
        <Card style={{ padding: '14px 16px', alignSelf: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <IBox icon="📖" green size={28} />
            <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: 0 }}>Leitura</p>
          </div>
          <p style={{ fontSize: 11, color: TM, lineHeight: 1.6, margin: 0 }}>{d.meta.leitura_criativos}</p>
        </Card>
      </div>
    </Slide>
  );
}

// ── Page 5 — Faturamento ────────────────────────────────────────────────────

function Page5({ d }: { d: DiagnosticoData }) {
  const c = d.crm;
  return (
    <Slide n={5}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: 28 }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 32, color: TX, margin: '0 0 4px', lineHeight: 1.1 }}>
            Faturamento registrado<br />na base interna
          </h1>
          <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: '0 0 14px' }}>
            Base filtrada: {d.cliente} | {d.periodo}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.1fr', gap: 9, marginBottom: 9 }}>
            <Kpi icon="📄" label="Registros de faturamento" value={c.registros} green />
            <Kpi icon="👤" label="Pacientes únicos" value={c.pacientes_unicos} green />
            <Kpi icon="$" label="Faturamento líquido total" value={c.faturamento_total} accent />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 9, marginBottom: 12 }}>
            <Kpi icon="🏷" label="Ticket médio por registro" value={c.ticket_medio_registro} green />
            <Kpi icon="👤" label="Ticket médio por paciente único" value={c.ticket_medio_paciente} green />
            <Kpi icon="📊" label="Relação faturamento / investimento" value={c.relacao_fat_investimento} green />
          </div>
          <Leitura text={c.leitura_faturamento} />
        </div>
        {/* Decorative bar chart */}
        <div style={{
          background: GL, border: `1.5px solid ${GB}`, borderRadius: 14,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          padding: '14px 14px 10px', gap: 6,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 130, justifyContent: 'center' }}>
            {[35, 50, 45, 65, 72, 82, 90, 100].map((h, i) => (
              <div key={i} style={{
                flex: 1, background: i === 7 ? G : `${G}50`,
                borderRadius: '4px 4px 0 0', height: `${h}%`,
                minWidth: 12,
              }} />
            ))}
          </div>
          <p style={{ fontSize: 10, color: G, fontWeight: 600, textAlign: 'center', margin: 0 }}>Evolução do período</p>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 6 — Faturamento por origem ────────────────────────────────────────

function getOriginIcon(canal: string) {
  const k = canal.toLowerCase();
  if (k.includes('instagram')) return '📊';
  if (k.includes('facebook')) return '👥';
  if (k.includes('whatsapp')) return '💬';
  if (k.includes('google')) return '🔍';
  if (k.includes('indica')) return '★';
  return '↗';
}

function Page6({ d }: { d: DiagnosticoData }) {
  const origins = d.crm.por_origem;
  const maxReg = Math.max(...origins.map(o => o.registros), 1);
  return (
    <Slide n={6}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 32, height: '100%', alignItems: 'start' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 34, color: TX, margin: '0 0 24px', lineHeight: 1.1 }}>
            Faturamento<br />por origem registrada
          </h1>
          <div style={{
            background: GL, border: `1.5px solid ${GB}`, borderLeft: `4px solid ${G}`,
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <IBox icon="ℹ" green size={24} />
              <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: 0 }}>Leitura importante</p>
            </div>
            <p style={{ fontSize: 11.5, color: TM, lineHeight: 1.65, margin: 0 }}>{d.crm.leitura_origem}</p>
          </div>
        </div>
        <Card style={{ padding: '16px 20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px', gap: 8, padding: '0 0 8px', borderBottom: `1.5px solid ${BD}`, marginBottom: 4 }}>
            <span style={{ fontSize: 10.5, color: TM, fontWeight: 600 }}>Origem registrada</span>
            <span style={{ fontSize: 10.5, color: B, fontWeight: 700, textAlign: 'right' }}>Registros</span>
            <span style={{ fontSize: 10.5, color: G, fontWeight: 700, textAlign: 'right' }}>Faturamento</span>
          </div>
          {origins.map((o: OrigemItem) => (
            <div key={o.canal} style={{
              display: 'grid', gridTemplateColumns: '1fr 70px 90px', gap: 8,
              padding: '9px 0', borderBottom: `1px solid ${BD}`, alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <IBox icon={getOriginIcon(o.canal)} green size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: TX, fontWeight: 500 }}>{o.canal}</span>
                  <div style={{ marginTop: 4 }}>
                    <Bar pct={Math.round((o.registros / maxReg) * 100)} color={B} />
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 800, color: B, textAlign: 'right' }}>{o.registros}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: G, textAlign: 'right' }}>{o.faturamento}</span>
            </div>
          ))}
          {origins.length === 0 && (
            <p style={{ fontSize: 12, color: TG, padding: '16px 0' }}>Nenhuma origem registrada no período.</p>
          )}
        </Card>
      </div>
    </Slide>
  );
}

// ── Page 7 — Clientes ───────────────────────────────────────────────────────

function Page7({ d }: { d: DiagnosticoData }) {
  const all = d.crm.clientes;
  const col1 = all.slice(0, 10);
  const col2 = all.slice(10, 20);
  const top4 = all.slice(0, 4);
  const rowStyle: CSSProperties = {
    display: 'grid', gridTemplateColumns: '18px 1fr 80px 50px 80px',
    gap: 6, padding: '5px 0', borderBottom: `1px solid ${BD}`, alignItems: 'center',
  };
  const headStyle: CSSProperties = {
    display: 'grid', gridTemplateColumns: '18px 1fr 80px 50px 80px',
    gap: 6, padding: '0 0 6px', borderBottom: `1.5px solid ${BD}`, marginBottom: 2,
  };
  function TableHead() {
    return (
      <div style={headStyle}>
        <span />
        {['Cliente', 'Origem registrada', 'Reg.', 'Valor total'].map(h => (
          <span key={h} style={{ fontSize: 9, color: TG, fontWeight: 600 }}>{h}</span>
        ))}
      </div>
    );
  }
  function Row({ c, i }: { c: ClienteItem; i: number }) {
    return (
      <div style={rowStyle}>
        <span style={{ fontSize: 10, color: TG, fontWeight: 600 }}>{i + 1}</span>
        <span style={{ fontSize: 10, color: TX, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
        <span style={{ fontSize: 10, color: TG }}>{c.origem}</span>
        <span style={{ fontSize: 10, color: TX, fontWeight: 600, textAlign: 'center' }}>{c.registros}</span>
        <span style={{ fontSize: 10, color: G, fontWeight: 700 }}>{c.valor_total}</span>
      </div>
    );
  }
  return (
    <Slide n={7}>
      <h1 style={{ fontWeight: 800, fontSize: 28, color: TX, margin: '0 0 2px' }}>Todos os clientes faturados no período</h1>
      <p style={{ fontSize: 11, color: TG, margin: '0 0 10px' }}>Nomes duplicados foram agrupados e os valores foram somados</p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        {[
          ['📄', d.crm.registros, 'registros de faturamento'],
          ['👥', d.crm.pacientes_unicos, 'clientes únicos'],
        ].map(([icon, val, lbl]) => (
          <div key={String(lbl)} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: GL, border: `1.5px solid ${GB}`, borderRadius: 10, padding: '8px 16px',
          }}>
            <IBox icon={String(icon)} green size={28} />
            <span style={{ fontWeight: 800, fontSize: 18, color: G }}>{String(val)}</span>
            <span style={{ fontSize: 11, color: TM }}>{String(lbl)}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 200px', gap: 12 }}>
        <div>
          <TableHead />
          {col1.map((c, i) => <Row key={i} c={c} i={i} />)}
        </div>
        <div>
          <TableHead />
          {col2.map((c, i) => <Row key={i} c={c} i={i + 10} />)}
        </div>
        <Card style={{ padding: '12px 14px', alignSelf: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
            <IBox icon="★" green size={22} />
            <p style={{ fontWeight: 700, fontSize: 12, color: G, margin: 0 }}>{top4.length} maiores valores</p>
          </div>
          {top4.map((c, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: TX }}>{i + 1}</span>
                <span style={{ fontSize: 11, color: TM, fontWeight: 500 }}>{c.nome.length > 22 ? c.nome.slice(0, 22) + '…' : c.nome}</span>
              </div>
              <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: 0, paddingLeft: 20 }}>{c.valor_total}</p>
            </div>
          ))}
        </Card>
      </div>
    </Slide>
  );
}

// ── Page 8 — Validação de origem ────────────────────────────────────────────

function Page8({ d }: { d: DiagnosticoData }) {
  const waOrigins = d.crm.por_origem
    .filter(o => o.canal.toLowerCase().includes('whatsapp'))
    .map(o => o.canal);

  return (
    <Slide n={8}>
      <h1 style={{ fontWeight: 800, fontSize: 36, color: TX, margin: '0 0 4px', lineHeight: 1.05 }}>
        Ponto de atenção sobre
      </h1>
      <p style={{ fontWeight: 800, fontSize: 34, color: G, margin: '0 0 18px', lineHeight: 1.05 }}>
        validação de origem
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 14 }}>
        <Card style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IBox icon="🛡" green size={30} />
            <p style={{ fontWeight: 700, fontSize: 13, color: TX, margin: 0 }}>Por que validar?</p>
          </div>
          <p style={{ fontSize: 11.5, color: TM, lineHeight: 1.65, margin: 0 }}>
            A origem registrada na base deve ser usada como referência, mas precisa ser validada no atendimento para garantir que a análise esteja correta.
          </p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IBox icon="🔍" green size={30} />
            <p style={{ fontWeight: 700, fontSize: 13, color: TX, margin: 0 }}>Quando redobrar a atenção</p>
          </div>
          <div style={{ marginBottom: 8 }}>
            {(waOrigins.length > 0 ? waOrigins : ['WhatsApp', 'Facebook - WhatsApp', 'Instagram - WhatsApp']).map(o => (
              <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: G, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: TM }}>{o}</span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: TG, lineHeight: 1.55, margin: 0 }}>
            O WhatsApp pode ser apenas o canal onde a conversa aconteceu, e não necessariamente o primeiro ponto de contato do paciente.
          </p>
        </Card>
        <Card style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IBox icon="💬" green size={30} />
            <p style={{ fontWeight: 700, fontSize: 13, color: TX, margin: 0 }}>Pergunta sugerida para o atendimento</p>
          </div>
          <div style={{
            background: GL, border: `1.5px solid ${GB}`, borderRadius: 10, padding: '10px 12px',
            position: 'relative',
          }}>
            <span style={{ fontSize: 22, color: G, position: 'absolute', top: 4, left: 8, lineHeight: 1 }}>"</span>
            <p style={{ fontSize: 11.5, color: TM, lineHeight: 1.6, margin: '12px 0 0', paddingLeft: 12 }}>
              Só para registrarmos certinho: você conheceu a clínica por anúncio, Instagram, Facebook, Google, WhatsApp, link da bio ou outro canal?
            </p>
            <span style={{ fontSize: 22, color: G, position: 'absolute', bottom: 4, right: 8, lineHeight: 1 }}>"</span>
          </div>
        </Card>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: GL, border: `1.5px solid ${GB}`, borderRadius: 12, padding: '12px 18px',
      }}>
        <IBox icon="🎯" green size={32} />
        <p style={{ fontSize: 12, color: TM, margin: 0, lineHeight: 1.6 }}>
          Essa validação ajuda a <strong style={{ color: G }}>entender melhor</strong> quais canais estão influenciando os fechamentos e <strong style={{ color: G }}>evita uma leitura errada dos resultados</strong>.
        </p>
      </div>
    </Slide>
  );
}

// ── Page 9 — Diagnóstico geral ──────────────────────────────────────────────

function Page9({ d }: { d: DiagnosticoData }) {
  const m = d.meta;
  const c = d.crm;
  const fbBetter = m.facebook.resultados >= m.instagram.resultados;
  return (
    <Slide n={9}>
      <h1 style={{ fontWeight: 800, fontSize: 34, color: TX, margin: '0 0 16px' }}>Diagnóstico geral</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 14 }}>
        {/* Geração de conversas */}
        <Card style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IBox icon="💬" green size={28} />
            <span style={{ fontSize: 11, color: G, fontWeight: 700 }}>Geração de conversas</span>
          </div>
          <p style={{ fontWeight: 800, fontSize: 22, color: TX, margin: '0 0 4px' }}>{m.resultados}</p>
          <p style={{ fontSize: 10.5, color: TG, margin: '0 0 4px' }}>resultados</p>
          <div style={{ height: 2, background: G, borderRadius: 2, width: 28, marginBottom: 6 }} />
          <p style={{ fontSize: 10.5, color: TG, margin: 0 }}>
            custo médio de <strong style={{ color: G }}>{m.custo_resultado}</strong><br />por conversa iniciada
          </p>
        </Card>
        {/* Eficiência */}
        <Card style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IBox icon="📊" green size={28} />
            <span style={{ fontSize: 11, color: G, fontWeight: 700 }}>Eficiência por plataforma</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
            <IBox icon="👥" green size={22} />
            <p style={{ fontSize: 11, color: TM, margin: 0 }}>
              Facebook teve <strong>melhor eficiência</strong> de custo
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <IBox icon="📊" green size={22} />
            <p style={{ fontSize: 11, color: TM, margin: 0 }}>
              Instagram manteve <strong>bom volume</strong>, mas com custo mais elevado
            </p>
          </div>
        </Card>
        {/* Faturamento */}
        <Card style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IBox icon="$" green size={28} />
            <span style={{ fontSize: 11, color: G, fontWeight: 700 }}>Faturamento da base interna</span>
          </div>
          <p style={{ fontWeight: 800, fontSize: 20, color: TX, margin: '0 0 4px', lineHeight: 1.1 }}>{c.faturamento_total}</p>
          <div style={{ height: 2, background: G, borderRadius: 2, width: 28, marginBottom: 6 }} />
          <p style={{ fontSize: 11, color: TG, margin: 0 }}>{c.pacientes_unicos} clientes únicos</p>
        </Card>
        {/* Ponto de atenção */}
        <Card style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <IBox icon="⚠️" green size={28} />
            <span style={{ fontSize: 11, color: G, fontWeight: 700 }}>Principal ponto de atenção</span>
          </div>
          <p style={{ fontSize: 11, color: TM, lineHeight: 1.6, margin: 0 }}>{d.diagnostico.proximo_passo}</p>
        </Card>
      </div>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 14,
        background: GL, border: `1.5px solid ${GB}`, borderLeft: `4px solid ${G}`,
        borderRadius: 12, padding: '14px 18px',
      }}>
        <IBox icon="🎯" green size={34} />
        <div>
          <p style={{ fontWeight: 700, fontSize: 13, color: G, margin: '0 0 5px' }}>Diagnóstico</p>
          <p style={{ fontSize: 12, color: TM, lineHeight: 1.65, margin: 0 }}>{d.diagnostico.texto}</p>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 10 — Conclusão ────────────────────────────────────────────────────

function Page10({ d }: { d: DiagnosticoData }) {
  const cards = [
    { icon: '📊', title: 'Cenário do período', text: d.diagnostico.cenario_periodo },
    { icon: '🔍', title: 'O que o resultado indica', text: d.diagnostico.o_que_indica },
    { icon: '🎯', title: 'Próximo passo', text: d.diagnostico.proximo_passo },
  ];
  return (
    <Slide n={10}>
      <h1 style={{ fontWeight: 800, fontSize: 52, color: TX, margin: '0 0 4px', lineHeight: 1.04 }}>Conclusão</h1>
      <p style={{ fontWeight: 700, fontSize: 20, color: G, margin: '0 0 22px' }}>{d.cliente}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {cards.map(card => (
          <Card key={card.title} style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <IBox icon={card.icon} green size={30} />
              <p style={{ fontWeight: 700, fontSize: 13, color: TX, margin: 0 }}>{card.title}</p>
            </div>
            <div style={{ height: 2, background: G, borderRadius: 2, width: 24, marginBottom: 10 }} />
            <p style={{ fontSize: 12, color: TM, lineHeight: 1.7, margin: 0 }}>{card.text}</p>
          </Card>
        ))}
      </div>
      {/* Custom footer for last page */}
      <div style={{
        position: 'absolute', bottom: 17, left: 44,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 28, height: 2.5, background: G, borderRadius: 2 }} />
        <span style={{ fontSize: 12, color: TG }}>
          <strong style={{ color: G }}>Onmid</strong>
          {' '}|{' '}Diagnóstico de Performance
        </span>
      </div>
    </Slide>
  );
}

// ── Export ─────────────────────────────────────────────────────────────────

export default function DiagnosticoTemplate({ data: d }: { data: DiagnosticoData }) {
  return (
    <main className="onmid-report" aria-label="Relatório de Performance Onmid">
      <style>{`
        :root {
          --slide-w: 13.333in;
          --slide-h: 7.5in;
          --screen-w: 1180px;
          --report-bg: #f4f6f8;
        }
        html, body {
          margin: 0;
          padding: 0;
          background: var(--report-bg);
        }
        .onmid-report {
          width: 100%;
          min-height: 100vh;
          padding: 24px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          background: var(--report-bg);
        }
        .onmid-report-page {
          box-shadow: 0 14px 40px rgba(15, 23, 42, 0.16);
        }
        @media print {
          html, body { width: var(--slide-w); background: #fff; }
          @page { size: 13.333in 7.5in; margin: 0; }
          .onmid-report { padding: 0; gap: 0; display: block; background: #fff; }
          .onmid-report-page {
            width: var(--slide-w) !important;
            height: var(--slide-h) !important;
            aspect-ratio: auto !important;
            box-shadow: none !important;
          }
          .onmid-report-page:last-child { page-break-after: auto; break-after: auto; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Print button */}
      <div className="no-print" style={{
        position: 'fixed', top: 20, right: 20, zIndex: 9999,
        display: 'flex', gap: 10,
      }}>
        <button
          onClick={() => window.print()}
          style={{
            background: G, color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(34,197,94,0.4)',
            fontFamily: 'inherit',
          }}
        >
          ⬇ Baixar PDF
        </button>
      </div>

      <Page1 d={d} />
      <Page2 d={d} />
      <Page3 d={d} />
      <Page4 d={d} />
      <Page5 d={d} />
      <Page6 d={d} />
      <Page7 d={d} />
      <Page8 d={d} />
      <Page9 d={d} />
      <Page10 d={d} />
    </main>
  );
}
