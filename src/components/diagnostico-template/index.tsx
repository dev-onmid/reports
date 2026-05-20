'use client';

import type { DiagnosticoData, CriativoItem, OrigemItem, ClienteItem } from './types';

// ── Shared constants ────────────────────────────────────────────────────────
const GREEN = '#3EE649';
const LIGHT_GREEN = '#f0fdf2';
const BLUE_LIGHT = '#eff6ff';

// ── Sub-components ──────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: -0.5, color: '#111' }}>onmid</span>
      <span style={{
        display: 'inline-flex', alignItems: 'center', background: GREEN,
        borderRadius: 20, padding: '2px 5px', gap: 2,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff' }} />
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
      </span>
      <span style={{ fontSize: 9, color: '#666', marginLeft: 1 }}>®</span>
    </div>
  );
}

function PageNum({ n, total = 10 }: { n: number; total?: number }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <span style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>
        {String(n).padStart(2, '0')}<span style={{ color: '#ccc' }}>/{total}</span>
      </span>
      <div style={{ height: 2, background: GREEN, marginTop: 2, width: '100%' }} />
    </div>
  );
}

function PageHeader({ n }: { n: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
      <Logo />
      <PageNum n={n} />
    </div>
  );
}

function PageFooter() {
  return (
    <div style={{ position: 'absolute', bottom: 22, left: 36, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', background: GREEN,
        borderRadius: 20, padding: '2px 5px', gap: 2,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.45)' }} />
      </span>
      <span style={{ fontWeight: 600, fontSize: 11, color: '#555' }}>
        <span style={{ fontWeight: 700 }}>ONMID</span> Reports
      </span>
    </div>
  );
}

function Slide({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      position: 'relative', width: '100%', aspectRatio: '16/9',
      background: '#fff', padding: '28px 36px 60px',
      fontFamily: 'Inter, -apple-system, sans-serif',
      overflow: 'hidden', boxSizing: 'border-box',
      pageBreakAfter: 'always', breakAfter: 'page',
      ...style,
    }}>
      {/* Decorative background blobs */}
      <div style={{
        position: 'absolute', top: -80, right: -80, width: 280, height: 280,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(62,230,73,0.07) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -60, left: -60, width: 220, height: 220,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(96,165,250,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {children}
      <PageFooter />
    </div>
  );
}

function Card({ children, style, accent }: { children: React.ReactNode; style?: React.CSSProperties; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? LIGHT_GREEN : '#fff',
      border: accent ? `1.5px solid ${GREEN}` : '1.5px solid #f0f0f0',
      borderRadius: 12, padding: '14px 18px',
      boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
      ...style,
    }}>
      {children}
    </div>
  );
}

function IconBox({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 8, background: bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 15, flexShrink: 0,
    }}>
      <span style={{ color }}>{children}</span>
    </div>
  );
}

function Leitura({ text, color = GREEN }: { text: string; color?: string }) {
  return (
    <div style={{
      display: 'flex', gap: 14, background: LIGHT_GREEN,
      border: `1.5px solid ${color}30`, borderRadius: 12, padding: '14px 18px',
      borderLeft: `4px solid ${color}`,
    }}>
      <IconBox color={color} bg={`${color}20`}>💡</IconBox>
      <div>
        <p style={{ fontWeight: 700, fontSize: 13, color: color, marginBottom: 4 }}>Leitura</p>
        <p style={{ fontSize: 11.5, color: '#444', lineHeight: 1.55, margin: 0 }}>{text}</p>
      </div>
    </div>
  );
}

function ProgressBar({ pct, color = GREEN }: { pct: number; color?: string }) {
  return (
    <div style={{ flex: 1, height: 7, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: color, borderRadius: 4 }} />
    </div>
  );
}

// ── Page 1 — Capa ───────────────────────────────────────────────────────────

function CapaKpiCard({ label, value, varStr }: { label: string; value: string; varStr?: string }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10, padding: '10px 14px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.07)',
    }}>
      <p style={{ fontSize: 10, color: '#888', margin: '0 0 2px' }}>{label}</p>
      <p style={{ fontWeight: 700, fontSize: 16, color: '#111', margin: 0 }}>{value}</p>
      {varStr && (
        <p style={{ fontSize: 10, color: GREEN, margin: '2px 0 0', fontWeight: 600 }}>▲ {varStr} vs período anterior</p>
      )}
    </div>
  );
}

function Page1({ d }: { d: DiagnosticoData }) {
  return (
    <Slide>
      <PageHeader n={1} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 24, height: 'calc(100% - 80px)' }}>
        {/* Left */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h1 style={{ fontWeight: 800, fontSize: 42, lineHeight: 1.1, color: '#111', margin: '0 0 10px' }}>
            Diagnóstico de<br />Performance
          </h1>
          <p style={{ fontWeight: 700, fontSize: 22, color: GREEN, margin: '0 0 18px' }}>{d.cliente}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>📅</span>
            <span style={{ fontWeight: 700, fontSize: 13, color: '#111' }}>Período analisado:</span>
            <span style={{ fontSize: 13, color: '#444' }}>{d.periodo}</span>
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: '#f5f5f5', borderRadius: 8, padding: '6px 12px',
            fontSize: 12, color: '#555', fontWeight: 500, marginTop: 4,
          }}>
            <span>📊</span> {d.subtitulo}
          </div>
        </div>

        {/* Right — KPI mockup cards */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
          <div style={{
            background: '#fff', borderRadius: 14, padding: 16,
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 4px' }}>Faturamento</p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontWeight: 800, fontSize: 22, color: '#111', margin: 0 }}>{d.capa.faturamento}</p>
              <span style={{ fontSize: 14, color: GREEN }}>↗</span>
            </div>
            {d.capa.faturamento_var && (
              <p style={{ fontSize: 10, color: GREEN, margin: '3px 0 0', fontWeight: 600 }}>▲ {d.capa.faturamento_var} vs período anterior</p>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <CapaKpiCard label="Investimento" value={d.capa.investimento} varStr={d.capa.investimento_var} />
            <CapaKpiCard label="ROAS" value={d.capa.roas} varStr={d.capa.roas_var} />
            <CapaKpiCard label="Leads" value={d.capa.leads} varStr={d.capa.leads_var} />
          </div>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 2 — Visão geral mídia paga ────────────────────────────────────────

function KpiCard({ icon, label, value, green }: { icon: string; label: string; value: string; green?: boolean }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <IconBox color={green ? GREEN : '#3b82f6'} bg={green ? LIGHT_GREEN : BLUE_LIGHT}>{icon}</IconBox>
        <span style={{ fontSize: 10.5, color: '#666', lineHeight: 1.3 }}>{label}</span>
      </div>
      <p style={{ fontWeight: 800, fontSize: 20, color: '#111', margin: 0 }}>{value}</p>
    </Card>
  );
}

function Page2({ d }: { d: DiagnosticoData }) {
  const m = d.meta;
  return (
    <Slide>
      <PageHeader n={2} />
      <h1 style={{ fontWeight: 800, fontSize: 30, color: '#111', margin: '0 0 4px' }}>Visão geral da mídia paga</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        <span style={{ fontSize: 12 }}>📅</span>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#111' }}>Período analisado:</span>
        <span style={{ fontSize: 12, color: '#555' }}>{d.periodo}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 10 }}>
        <KpiCard icon="$" label="Investimento total" value={m.investimento_total} green />
        <KpiCard icon="💬" label="Resultados / conversas iniciadas" value={String(m.resultados)} green />
        <KpiCard icon="$" label="Custo por resultado" value={m.custo_resultado} green />
        <KpiCard icon="👁" label="Impressões" value={m.impressoes} />
        <KpiCard icon="👥" label="Alcance somado" value={m.alcance} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
        <KpiCard icon="💬" label="Total de contatos por mensagem" value={String(m.total_contatos)} />
        <KpiCard icon="➕" label="Novos contatos de mensagem" value={String(m.novos_contatos)} green />
        <KpiCard icon="$" label="Custo por novo contato" value={m.custo_novo_contato} green />
        <KpiCard icon="🛒" label="Compras registradas no Meta Ads" value={String(m.compras)} />
      </div>
      <Leitura text={m.leitura} />
    </Slide>
  );
}

// ── Page 3 — Desempenho por plataforma ─────────────────────────────────────

function PlatformCard({ name, icon, data, color }: {
  name: string;
  icon: string;
  color: string;
  data: { investimento: string; resultados: number; custo_resultado: string; novos_contatos: number; custo_novo_contato: string };
}) {
  const rows = [
    { icon: '$', label: 'Investimento', value: data.investimento, highlight: false },
    { icon: '↗', label: 'Resultados', value: String(data.resultados), highlight: false },
    { icon: '🏷', label: 'Custo por resultado', value: data.custo_resultado, highlight: true },
    { icon: '👤', label: 'Novos contatos', value: String(data.novos_contatos), highlight: false },
    { icon: '➕', label: 'Custo por novo contato', value: data.custo_novo_contato, highlight: true },
  ];
  return (
    <Card style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 24 }}>{icon}</span>
        <p style={{ fontWeight: 800, fontSize: 18, color: '#111', margin: 0 }}>{name}</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f5f5f5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconBox color={color} bg={`${color}15`}>{r.icon}</IconBox>
              <span style={{ fontSize: 11.5, color: '#555' }}>{r.label}</span>
            </div>
            <span style={{ fontWeight: 700, fontSize: 13, color: r.highlight ? color : '#111' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Page3({ d }: { d: DiagnosticoData }) {
  return (
    <Slide>
      <PageHeader n={3} />
      <h1 style={{ fontWeight: 800, fontSize: 30, color: '#111', margin: '0 0 4px' }}>Desempenho por plataforma</h1>
      <p style={{ fontWeight: 700, fontSize: 16, color: GREEN, margin: '0 0 18px' }}>Facebook x Instagram</p>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <PlatformCard name="Facebook" icon="🔵" color="#1877f2" data={d.meta.facebook} />
        <PlatformCard name="Instagram" icon="📸" color="#e1306c" data={d.meta.instagram} />
      </div>
      <Leitura text={d.meta.leitura_plataformas} />
    </Slide>
  );
}

// ── Page 4 — Principais criativos ──────────────────────────────────────────

function Page4({ d }: { d: DiagnosticoData }) {
  const criativos = d.meta.criativos.slice(0, 10);
  return (
    <Slide>
      <PageHeader n={4} />
      <h1 style={{ fontWeight: 800, fontSize: 28, color: '#111', margin: '0 0 14px' }}>
        Principais criativos<br />por volume de resultados
      </h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        {/* Table */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 110px', gap: 4, padding: '0 8px 6px', borderBottom: '1px solid #eee' }}>
            {['Criativo', 'Investimento', 'Resultados', 'Custo por resultado'].map(h => (
              <span key={h} style={{ fontSize: 9.5, color: '#888', fontWeight: 600 }}>{h}</span>
            ))}
          </div>
          {criativos.map((c: CriativoItem, i: number) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1fr 90px 70px 110px',
              gap: 4, padding: '6px 8px', borderBottom: '1px solid #f5f5f5',
              alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%', background: GREEN,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0,
                }}>{i + 1}</span>
                <span style={{ fontSize: 11, color: '#222', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</span>
                <ProgressBar pct={c.bar_pct} />
              </div>
              <span style={{ fontSize: 11.5, color: '#333' }}>{c.investimento}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600 }}>{c.resultados}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: c.custo_resultado.includes('R$') && parseFloat(c.custo_resultado.replace(/[^0-9,.]/g, '').replace(',', '.')) < 10 ? GREEN : '#333' }}>
                {c.custo_resultado}
              </span>
            </div>
          ))}
        </div>
        {/* Leitura aside */}
        <div style={{
          background: LIGHT_GREEN, border: `1.5px solid ${GREEN}30`,
          borderLeft: `4px solid ${GREEN}`, borderRadius: 12, padding: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>📖</span>
            <p style={{ fontWeight: 700, fontSize: 13, color: GREEN, margin: 0 }}>Leitura</p>
          </div>
          <p style={{ fontSize: 11, color: '#444', lineHeight: 1.55, margin: 0 }}>{d.meta.leitura_criativos}</p>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 5 — Faturamento base interna ──────────────────────────────────────

function Page5({ d }: { d: DiagnosticoData }) {
  const c = d.crm;
  return (
    <Slide>
      <PageHeader n={5} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 24, height: 'calc(100% - 64px)' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 30, color: '#111', margin: '0 0 4px' }}>Faturamento registrado<br />na base interna</h1>
          <p style={{ fontWeight: 700, fontSize: 13, color: GREEN, margin: '0 0 16px' }}>Base filtrada: {d.cliente} | {d.periodo}</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <KpiCard icon="📄" label="Registros de faturamento" value={String(c.registros)} />
            <KpiCard icon="👤" label="Pacientes únicos" value={String(c.pacientes_unicos)} />
            <Card accent>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <IconBox color={GREEN} bg={`${GREEN}25`}>$</IconBox>
                <span style={{ fontSize: 10.5, color: '#555' }}>Faturamento líquido total</span>
              </div>
              <p style={{ fontWeight: 800, fontSize: 22, color: GREEN, margin: 0 }}>{c.faturamento_total}</p>
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <KpiCard icon="🏷" label="Ticket médio por registro" value={c.ticket_medio_registro} />
            <KpiCard icon="👤" label="Ticket médio por paciente único" value={c.ticket_medio_paciente} />
            <KpiCard icon="📈" label="Relação faturamento / investimento" value={c.relacao_fat_investimento} green />
          </div>
          <Leitura text={c.leitura_faturamento} />
        </div>
        {/* Decorative chart mockup */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            background: '#f8fef9', border: `2px solid ${GREEN}25`,
            borderRadius: 16, padding: 16, width: '100%',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 100, justifyContent: 'center' }}>
              {[40, 55, 65, 50, 70, 80, 95, 100].map((h, i) => (
                <div key={i} style={{
                  flex: 1, height: `${h}%`, background: i === 7 ? GREEN : `${GREEN}40`,
                  borderRadius: '4px 4px 0 0',
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 6 — Faturamento por origem ────────────────────────────────────────

const CHANNEL_ICONS: Record<string, string> = {
  whatsapp: '💚', facebook: '🔵', instagram: '📸', google: '🔴',
  site: '🌐', indicacao: '🤝', indicação: '🤝', tiktok: '🎵',
};
function channelIcon(c: string) { return CHANNEL_ICONS[c.toLowerCase().split(' ')[0]] ?? '📍'; }

function Page6({ d }: { d: DiagnosticoData }) {
  return (
    <Slide>
      <PageHeader n={6} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24, height: 'calc(100% - 64px)' }}>
        {/* Left */}
        <div>
          <h1 style={{ fontWeight: 800, fontSize: 28, color: '#111', margin: '0 0 18px' }}>
            Faturamento<br />por origem registrada
          </h1>
          <Card style={{ borderLeft: `4px solid ${GREEN}`, background: LIGHT_GREEN }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <IconBox color={GREEN} bg={`${GREEN}20`}>ℹ</IconBox>
              <div>
                <p style={{ fontWeight: 700, fontSize: 13, color: GREEN, margin: '0 0 4px' }}>Leitura importante</p>
                <p style={{ fontSize: 11, color: '#444', lineHeight: 1.55, margin: 0 }}>{d.crm.leitura_origem}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Right — table */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', padding: '0 8px 8px', borderBottom: '2px solid #eee' }}>
            {['Origem registrada', 'Registros', 'Faturamento'].map((h, i) => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, color: i === 2 ? GREEN : '#555' }}>{h}</span>
            ))}
          </div>
          {d.crm.por_origem.map((o: OrigemItem) => (
            <div key={o.canal} style={{
              display: 'grid', gridTemplateColumns: '1fr 80px 120px',
              padding: '10px 8px', borderBottom: '1px solid #f0f0f0', alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 16 }}>{channelIcon(o.canal)}</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#222' }}>{o.canal}</span>
                <ProgressBar pct={o.bar_pct} color="#3b82f6" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>{o.registros}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{o.faturamento}</span>
            </div>
          ))}
        </div>
      </div>
    </Slide>
  );
}

// ── Page 7 — Todos os clientes faturados ───────────────────────────────────

function Page7({ d }: { d: DiagnosticoData }) {
  const clientes = d.crm.clientes;
  const half = Math.ceil(clientes.length / 2);
  const left = clientes.slice(0, half);
  const right = clientes.slice(half);
  const top4 = [...clientes].sort((a, b) => b.valor_num - a.valor_num).slice(0, 4);

  return (
    <Slide>
      <PageHeader n={7} />
      <h1 style={{ fontWeight: 800, fontSize: 26, color: '#111', margin: '0 0 3px' }}>Todos os clientes faturados no período</h1>
      <p style={{ fontSize: 11, color: '#888', margin: '0 0 10px' }}>Nomes duplicados foram agrupados e os valores foram somados</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: GREEN }}>{d.crm.registros}</span>
          <span style={{ fontSize: 11, color: '#555' }}>registros de faturamento</span>
        </Card>
        <Card style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: GREEN }}>{d.crm.pacientes_unicos}</span>
          <span style={{ fontSize: 11, color: '#555' }}>clientes únicos</span>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 220px', gap: 10 }}>
        {/* Left column */}
        <ClientTable rows={left} startIdx={1} />
        {/* Right column */}
        <ClientTable rows={right} startIdx={half + 1} />
        {/* Top 4 sidebar */}
        <Card style={{ background: '#fafafa' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 14 }}>⭐</span>
            <p style={{ fontWeight: 700, fontSize: 12, color: GREEN, margin: 0 }}>4 maiores valores</p>
          </div>
          {top4.map((c: ClienteItem, i: number) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <p style={{ fontWeight: 700, fontSize: 12, margin: '0 0 2px', color: '#111' }}>
                <span style={{ color: GREEN }}>{i + 1} </span>{c.nome}
              </p>
              <p style={{ fontWeight: 800, fontSize: 14, color: GREEN, margin: 0 }}>{c.valor_total}</p>
            </div>
          ))}
        </Card>
      </div>
    </Slide>
  );
}

function ClientTable({ rows, startIdx }: { rows: ClienteItem[]; startIdx: number }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 60px 90px', padding: '0 4px 4px', borderBottom: '1px solid #eee' }}>
        {['Cliente', 'Origem', 'Reg.', 'Valor'].map(h => (
          <span key={h} style={{ fontSize: 9.5, color: '#888', fontWeight: 600 }}>{h}</span>
        ))}
      </div>
      {rows.map((c: ClienteItem, i: number) => (
        <div key={i} style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 60px 90px',
          padding: '4px 4px', borderBottom: '1px solid #f5f5f5', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9.5, color: '#222', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {startIdx + i}. {c.nome}
          </span>
          <span style={{ fontSize: 9.5, color: '#555' }}>{c.origem}</span>
          <span style={{ fontSize: 9.5, color: '#555' }}>{c.registros}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#111' }}>{c.valor_total}</span>
        </div>
      ))}
    </div>
  );
}

// ── Page 8 — Ponto de atenção ───────────────────────────────────────────────

function Page8({ d }: { d: DiagnosticoData }) {
  // Detect which origins need attention
  const waOrigens = d.crm.por_origem
    .filter(o => o.canal.toLowerCase().includes('whatsapp'))
    .map(o => o.canal);

  return (
    <Slide>
      <PageHeader n={8} />
      <h1 style={{ fontWeight: 800, fontSize: 32, color: '#111', margin: '0 0 4px' }}>Ponto de atenção sobre</h1>
      <p style={{ fontWeight: 800, fontSize: 32, color: GREEN, margin: '0 0 24px' }}>validação de origem</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconBox color={GREEN} bg={LIGHT_GREEN}>🛡</IconBox>
            <p style={{ fontWeight: 700, fontSize: 13, color: '#111', margin: 0 }}>Por que validar?</p>
          </div>
          <p style={{ fontSize: 11.5, color: '#555', lineHeight: 1.55, margin: 0 }}>
            A origem registrada na base deve ser usada como referência, mas precisa ser validada no atendimento para garantir que a análise esteja correta.
          </p>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconBox color="#3b82f6" bg={BLUE_LIGHT}>🔍</IconBox>
            <p style={{ fontWeight: 700, fontSize: 13, color: '#111', margin: 0 }}>Quando redobrar a atenção</p>
          </div>
          {waOrigens.length > 0 ? (
            <ul style={{ fontSize: 11.5, color: '#555', lineHeight: 1.7, margin: 0, paddingLeft: 14 }}>
              {waOrigens.map(o => <li key={o}>{o}</li>)}
            </ul>
          ) : (
            <p style={{ fontSize: 11.5, color: '#555', lineHeight: 1.55, margin: 0 }}>Todos os clientes com origem "WhatsApp" ou combinações.</p>
          )}
          <p style={{ fontSize: 11, color: '#888', lineHeight: 1.5, margin: '8px 0 0' }}>
            O WhatsApp pode ser apenas o canal onde a conversa aconteceu, e não necessariamente o primeiro ponto de contato.
          </p>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <IconBox color="#8b5cf6" bg="#f5f3ff">💬</IconBox>
            <p style={{ fontWeight: 700, fontSize: 13, color: '#111', margin: 0 }}>Pergunta sugerida para o atendimento</p>
          </div>
          <div style={{ background: '#f9f9f9', borderRadius: 8, padding: 10, position: 'relative' }}>
            <span style={{ fontSize: 20, color: '#ccc', position: 'absolute', top: 4, left: 8 }}>"</span>
            <p style={{ fontSize: 11.5, color: '#555', lineHeight: 1.55, margin: '8px 0 0', paddingLeft: 16 }}>
              Só para registrarmos certinho: você conheceu a clínica por anúncio, Instagram, Facebook, Google, WhatsApp, link da bio ou outro canal?
            </p>
            <span style={{ fontSize: 20, color: '#ccc', float: 'right' }}>"</span>
          </div>
        </Card>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#f9fef9', borderRadius: 12, padding: '12px 16px',
        border: `1px solid ${GREEN}25`,
      }}>
        <span style={{ fontSize: 20 }}>🎯</span>
        <p style={{ fontSize: 12, color: '#444', lineHeight: 1.5, margin: 0 }}>
          Essa validação ajuda a <strong style={{ color: GREEN }}>entender melhor</strong> quais canais estão influenciando os fechamentos e <strong style={{ color: GREEN }}>evita uma leitura errada dos resultados</strong>.
        </p>
      </div>
    </Slide>
  );
}

// ── Page 9 — Diagnóstico geral ──────────────────────────────────────────────

function Page9({ d }: { d: DiagnosticoData }) {
  const m = d.meta;
  const c = d.crm;
  return (
    <Slide>
      <PageHeader n={9} />
      <h1 style={{ fontWeight: 800, fontSize: 32, color: '#111', margin: '0 0 18px' }}>Diagnóstico geral</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Card>
          <p style={{ fontWeight: 700, fontSize: 11, color: GREEN, margin: '0 0 8px' }}>Geração de conversas</p>
          <p style={{ fontWeight: 800, fontSize: 24, color: '#111', margin: '0 0 2px' }}>{m.resultados}</p>
          <p style={{ fontSize: 10, color: '#888', margin: '0 0 8px' }}>resultados</p>
          <div style={{ width: '100%', height: 2, background: GREEN, borderRadius: 2, marginBottom: 6 }} />
          <p style={{ fontSize: 10.5, color: '#555', margin: 0 }}>custo médio de <strong style={{ color: GREEN }}>{m.custo_resultado}</strong> por conversa iniciada</p>
        </Card>
        <Card>
          <p style={{ fontWeight: 700, fontSize: 11, color: GREEN, margin: '0 0 8px' }}>Eficiência por plataforma</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span>🔵</span>
            <p style={{ fontSize: 11, color: '#444', margin: 0 }}>Facebook teve <strong>melhor eficiência</strong> de custo</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📸</span>
            <p style={{ fontSize: 11, color: '#444', margin: 0 }}>Instagram manteve <strong>bom volume</strong>, mas com custo mais elevado</p>
          </div>
        </Card>
        <Card>
          <p style={{ fontWeight: 700, fontSize: 11, color: GREEN, margin: '0 0 8px' }}>Faturamento da base interna</p>
          <p style={{ fontWeight: 800, fontSize: 20, color: '#111', margin: '0 0 2px' }}>{c.faturamento_total}</p>
          <div style={{ width: '100%', height: 2, background: GREEN, borderRadius: 2, margin: '6px 0' }} />
          <p style={{ fontSize: 11, color: '#555', margin: 0 }}>{c.pacientes_unicos} <span style={{ color: '#888' }}>clientes únicos</span></p>
        </Card>
        <Card>
          <p style={{ fontWeight: 700, fontSize: 11, color: '#f59e0b', margin: '0 0 8px' }}>⚠ Principal ponto de atenção</p>
          <p style={{ fontSize: 11.5, color: '#444', lineHeight: 1.5, margin: 0 }}>
            validar a origem real dos pacientes, principalmente quando a origem aparece como <strong style={{ color: '#555' }}>WhatsApp</strong>
          </p>
        </Card>
      </div>

      <div style={{
        display: 'flex', gap: 14, background: LIGHT_GREEN,
        border: `1.5px solid ${GREEN}30`, borderRadius: 12, padding: '14px 18px',
        borderLeft: `4px solid ${GREEN}`,
      }}>
        <IconBox color={GREEN} bg={`${GREEN}20`}>🎯</IconBox>
        <div>
          <p style={{ fontWeight: 700, fontSize: 13, color: GREEN, marginBottom: 4 }}>Diagnóstico</p>
          <p style={{ fontSize: 12, color: '#444', lineHeight: 1.6, margin: 0 }}>{d.diagnostico.texto}</p>
        </div>
      </div>
    </Slide>
  );
}

// ── Page 10 — Conclusão ─────────────────────────────────────────────────────

function Page10({ d }: { d: DiagnosticoData }) {
  const cards = [
    { icon: '📊', title: 'Cenário do período', text: d.diagnostico.cenario_periodo },
    { icon: '🔍', title: 'O que o resultado indica', text: d.diagnostico.o_que_indica },
    { icon: '🎯', title: 'Próximo passo', text: d.diagnostico.proximo_passo },
  ];
  return (
    <Slide>
      <PageHeader n={10} />
      <h1 style={{ fontWeight: 800, fontSize: 44, color: '#111', margin: '0 0 4px' }}>Conclusão</h1>
      <p style={{ fontWeight: 700, fontSize: 18, color: GREEN, margin: '0 0 28px' }}>{d.cliente}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
        {cards.map(card => (
          <Card key={card.title} style={{ padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{card.icon}</span>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#111', margin: 0 }}>{card.title}</p>
            </div>
            <div style={{ height: 2, background: GREEN, borderRadius: 2, marginBottom: 12, width: 32 }} />
            <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6, margin: 0 }}>{card.text}</p>
          </Card>
        ))}
      </div>

      <div style={{ position: 'absolute', bottom: 22, right: 36, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#888' }}>
          <strong style={{ color: GREEN }}>Onmid</strong> | Diagnóstico de Performance
        </span>
      </div>
    </Slide>
  );
}

// ── Main export ─────────────────────────────────────────────────────────────

export default function DiagnosticoTemplate({ data }: { data: DiagnosticoData }) {
  return (
    <div style={{ background: '#e8e8e8', padding: '20px 0' }}>
      {/* Print button — hidden on print */}
      <div style={{ textAlign: 'center', marginBottom: 20 }} className="no-print">
        <button
          onClick={() => window.print()}
          style={{
            background: GREEN, color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 28px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Baixar / Imprimir PDF
        </button>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Page1 d={data} />
        <Page2 d={data} />
        <Page3 d={data} />
        <Page4 d={data} />
        <Page5 d={data} />
        <Page6 d={data} />
        <Page7 d={data} />
        <Page8 d={data} />
        <Page9 d={data} />
        <Page10 d={data} />
      </div>

      <style>{`
        @media print {
          body { margin: 0; background: white; }
          .no-print { display: none !important; }
          @page { size: 1200px 675px landscape; margin: 0; }
          body > div { padding: 0 !important; background: white !important; }
          body > div > div:last-child { max-width: 100% !important; gap: 0 !important; }
          body > div > div:last-child > div {
            width: 100vw !important; max-width: 100% !important;
            page-break-after: always !important; break-after: page !important;
          }
        }
      `}</style>
    </div>
  );
}
