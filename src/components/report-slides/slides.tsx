import { SlideBase } from './decorations';
import type { ReportData, MonthlyData, OverallMetrics } from './types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtBRL(n: number): string {
  return `R$ ${fmt(n)}`;
}
function fmtROI(n: number): string {
  return `${fmt(n)}x`;
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, accent = false,
}: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-1.5"
      style={{
        borderColor: accent ? '#44DD2E44' : '#e5e7eb',
        background: accent ? '#f0fdf0' : '#fff',
      }}
    >
      <div className="flex items-center gap-1.5" style={{ color: accent ? '#16a34a' : '#7B21D0' }}>
        {icon}
      </div>
      <p className="text-[10px] text-gray-500 leading-tight">{label}</p>
      <p className="font-black leading-tight" style={{ fontSize: '1.1em', color: accent ? '#15803d' : '#7B21D0' }}>
        {value}
      </p>
    </div>
  );
}

// ─── InfoBox ─────────────────────────────────────────────────────────────────

function InfoBox({ text, purple = false }: { text: string; purple?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-3"
      style={{
        background: purple ? '#7B21D0' : '#F0FDF4',
        border: `1px solid ${purple ? 'transparent' : '#44DD2E44'}`,
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: purple ? '#44DD2E' : '#44DD2E' }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 8L6 12L14 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p
        className="text-xs leading-relaxed"
        style={{ color: purple ? 'white' : '#15803d' }}
        dangerouslySetInnerHTML={{ __html: text }}
      />
    </div>
  );
}

// ─── SLIDE 1 — Cover ─────────────────────────────────────────────────────────

export function CoverSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-14 pt-16 pb-10 h-full flex flex-col justify-between">
        <div className="flex-1">
          {/* Title */}
          <div className="mb-6 max-w-[65%]">
            <h1
              className="font-black uppercase leading-none tracking-tight"
              style={{ fontSize: 'clamp(2rem, 4.5vw, 3.8rem)', lineHeight: '1.05' }}
            >
              <span style={{ color: '#1a1a1a' }}>DIAGNÓSTICO DE</span>
              <br />
              <span style={{ color: '#7B21D0' }}>PERFORMANCE</span>
              <span style={{ color: '#1a1a1a' }}> – </span>
              <span style={{ color: '#44DD2E' }}>{data.clientName.toUpperCase()}</span>
            </h1>
          </div>

          {/* Subtitle row */}
          <div className="flex items-center gap-4 mb-6">
            <p className="font-bold text-lg" style={{ color: '#1a1a1a' }}>
              {data.sources.join(' + ')}
            </p>
            {/* Source icons */}
            <div className="flex items-center gap-3">
              {data.sources.map((s) => (
                <div
                  key={s}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 flex flex-col items-center gap-1"
                >
                  {s === 'CRM' && (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="#7B21D0" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="9" cy="7" r="4" stroke="#7B21D0" strokeWidth="2" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" stroke="#7B21D0" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {s === 'Meta Ads' && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/brand/meta-ads-logo.webp" alt="Meta" className="h-5 w-5 object-contain" />
                  )}
                  {s === 'Google Ads' && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src="/brand/google-ads-logo.png" alt="Google" className="h-5 w-5 object-contain" />
                  )}
                  <span className="text-[9px] font-semibold text-gray-600">{s}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Period */}
          <div className="flex items-center gap-2 mb-6">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="1" y="3" width="16" height="14" rx="2" stroke="#1a1a1a" strokeWidth="1.5" />
              <line x1="5" y1="1" x2="5" y2="5" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="13" y1="1" x2="13" y2="5" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1" y1="8" x2="17" y2="8" stroke="#1a1a1a" strokeWidth="1.5" />
            </svg>
            <span className="font-semibold text-sm text-gray-700">Período: {data.periodLabel}</span>
          </div>

          {/* Description box */}
          <div className="max-w-[58%] rounded-xl border border-gray-200 bg-white px-4 py-4 flex items-start gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: '#44DD2E' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">
              Análise integrada entre mídia paga e CRM para entender quais{' '}
              <strong>canais, meses e campanhas</strong> geraram mais{' '}
              <strong style={{ color: '#1a1a1a' }}>visibilidade</strong>,{' '}
              <strong style={{ color: '#7B21D0' }}>leads, reuniões, vendas e faturamento.</strong>
            </p>
          </div>
        </div>
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 2 — Data Overview ──────────────────────────────────────────────────

export function DataOverviewSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const inv = data.meta.investment + data.google.investment;
  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-10 pb-10 h-full flex flex-col gap-4">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight" style={{ color: '#1a1a1a' }}>
            BASE DE DADOS E
          </h2>
          <h2 className="font-black uppercase text-2xl leading-tight" style={{ color: '#1a1a1a' }}>
            CRITÉRIOS DE ANÁLISE
          </h2>
          <p className="text-xs text-gray-500 mt-1">Consolidado do CRM e das plataformas no período analisado</p>
        </div>

        {/* Stat cards */}
        <div className="flex gap-4">
          {[
            { label: 'leads válidos', value: fmtInt(data.overall.leads), color: '#7B21D0' },
            { label: data.periodLabel, value: '', color: '#7B21D0', isDate: true },
            { label: 'Investimento total corrigido:', value: fmtBRL(inv), color: '#44DD2E' },
          ].map((s, i) => (
            <div key={i} className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 flex flex-col gap-1">
              {s.isDate ? (
                <>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#7B21D020' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="2" width="12" height="11" rx="1.5" stroke="#7B21D0" strokeWidth="1.2" />
                      <line x1="4" y1="1" x2="4" y2="3.5" stroke="#7B21D0" strokeWidth="1.2" strokeLinecap="round" />
                      <line x1="10" y1="1" x2="10" y2="3.5" stroke="#7B21D0" strokeWidth="1.2" strokeLinecap="round" />
                      <line x1="1" y1="6" x2="13" y2="6" stroke="#7B21D0" strokeWidth="1.2" />
                    </svg>
                  </div>
                  <p className="font-black text-xl leading-tight" style={{ color: '#7B21D0' }}>
                    {data.periodLabel.split(' ')[0]}
                  </p>
                  <p className="text-xs text-gray-500">
                    a {data.periodLabel.split(' ').slice(2).join(' ')}
                  </p>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${s.color}20` }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <circle cx="7" cy="7" r="6" stroke={s.color} strokeWidth="1.2" />
                      <path d="M5 7h4M7 5v4" stroke={s.color} strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </div>
                  <p className="font-black text-xl leading-tight" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Two columns */}
        <div className="flex gap-4 flex-1">
          <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-bold mb-2" style={{ color: '#7B21D0' }}>Dados considerados</p>
            <ul className="space-y-1.5">
              {[
                `CRM com ${fmtInt(data.overall.leads)} leads válidos após remoção de duplicados.`,
                `Período analisado: ${data.periodLabel}.`,
                'Google Ads analisado a partir das campanhas e conversões.',
                'Meta Ads analisado a partir das campanhas e leads.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[10px] text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#1a1a1a' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3">
            <p className="text-xs font-bold mb-2" style={{ color: '#44DD2E', filter: 'brightness(0.7)' }}>Critérios e ajustes</p>
            <ul className="space-y-1.5">
              {[
                'CRM considerado como fonte absoluta dos leads e conversões reais.',
                'Os dados foram consolidados por canal, mês e funil.',
                'Leads com origens não identificadas foram agrupados como orgânicos.',
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-[10px] text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#1a1a1a' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 flex items-center gap-2 text-[10px] text-gray-600">
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#44DD2E' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6L4.5 8.5L10 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          Base final utilizada:{' '}
          <strong style={{ color: '#7B21D0' }}>CRM</strong> +{' '}
          <strong style={{ color: '#7B21D0' }}>Meta Ads</strong> +{' '}
          <strong style={{ color: '#44DD2E', filter: 'brightness(0.7)' }}>Google Ads</strong>.
        </div>
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 3 — Funnel Classification ─────────────────────────────────────────

const FUNNEL_STAGES = [
  { num: '01', label: 'Lead gerado', desc: 'todo lead válido no CRM.' },
  { num: '02', label: 'Reunião agendada', desc: 'Leads com status de agendamento confirmado.' },
  { num: '03', label: 'Reunião realizada', desc: 'Leads que compareceram à reunião.' },
  { num: '04', label: 'Venda/Ganho', desc: 'leads com situação Ganho.' },
  { num: '05', label: 'Faturamento', desc: 'valor dos negócios ganhos no CRM.' },
];

export function FunnelClassificationSlide({ page, total }: { page: number; total: number }) {
  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-10 pb-10 h-full flex flex-col gap-5">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight" style={{ color: '#1a1a1a' }}>
            COMO O FUNIL{' '}
            <span style={{ color: '#7B21D0' }}>FOI CLASSIFICADO</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1">Critérios usados para leitura do CRM e avanço no funil</p>
        </div>

        <div className="flex gap-3 flex-1">
          {FUNNEL_STAGES.map((stage) => (
            <div key={stage.num} className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-4 flex flex-col items-center gap-2 text-center">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-black" style={{ background: '#7B21D0' }}>
                {stage.num}
              </div>
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: '#EDE9FE' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  {stage.num === '01' && <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#7B21D0" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="7" r="4" stroke="#7B21D0" strokeWidth="1.8" /><path d="M16 11h2m0 0h2m-2 0v-2m0 2v2" stroke="#44DD2E" strokeWidth="1.5" strokeLinecap="round" /></>}
                  {stage.num === '02' && <><rect x="3" y="4" width="18" height="18" rx="2" stroke="#7B21D0" strokeWidth="1.8" /><line x1="16" y1="2" x2="16" y2="6" stroke="#7B21D0" strokeWidth="1.8" strokeLinecap="round" /><line x1="8" y1="2" x2="8" y2="6" stroke="#7B21D0" strokeWidth="1.8" strokeLinecap="round" /><path d="M9 12l2 2 4-4" stroke="#7B21D0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>}
                  {stage.num === '03' && <><path d="M17 12h.01M3 12h14M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0" stroke="#7B21D0" strokeWidth="1.8" strokeLinecap="round" /></>}
                  {stage.num === '04' && <><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="#7B21D0" strokeWidth="1.8" strokeLinejoin="round" /></>}
                  {stage.num === '05' && <><rect x="2" y="7" width="10" height="14" rx="1" stroke="#7B21D0" strokeWidth="1.8" /><rect x="8" y="11" width="10" height="10" rx="1" stroke="#7B21D0" strokeWidth="1.8" /><rect x="14" y="3" width="8" height="18" rx="1" stroke="#7B21D0" strokeWidth="1.8" /><circle cx="20" cy="8" r="3" fill="#44DD2E" /><path d="M20 7v1.5l1 1" stroke="white" strokeWidth="1" strokeLinecap="round" /></>}
                </svg>
              </div>
              <p className="text-xs font-bold" style={{ color: '#7B21D0' }}>{stage.label}</p>
              <p className="text-[9px] text-gray-500 leading-tight">{stage.desc}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white px-4 py-2 flex items-center gap-3 text-[10px] text-gray-700">
          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: '#44DD2E' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1zm0 3v3.5L8 9" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </div>
          O CRM foi tratado como <strong style={{ color: '#7B21D0', marginLeft: 4 }}>&nbsp;fonte oficial&nbsp;</strong> da conversão real.
        </div>
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 4 — Overall Results ────────────────────────────────────────────────

function MetricIcon({ type }: { type: string }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none' as const };
  switch (type) {
    case 'investment': return <svg {...props}><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" /><path d="M12 6v12M9 9h4.5a1.5 1.5 0 0 1 0 3H10.5a1.5 1.5 0 0 0 0 3H15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'eye': return <svg {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" strokeWidth="1.8" /><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" /></svg>;
    case 'click': return <svg {...props}><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'user': return <svg {...props}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" /></svg>;
    case 'tag': return <svg {...props}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="7" cy="7" r="1.5" fill="currentColor" /></svg>;
    case 'calendar': return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" /><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'users': return <svg {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'trophy': return <svg {...props}><path d="M6 9H2V5h4M18 9h4V5h-4M6 9a6 6 0 0 0 12 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><line x1="12" y1="15" x2="12" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><line x1="9" y1="19" x2="15" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'dollar': return <svg {...props}><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    case 'trend': return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><polyline points="17 6 23 6 23 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    default: return null;
  }
}

export function OverallResultsSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const { overall } = data;
  const metrics = [
    { icon: 'investment', label: 'Investimento total:', value: fmtBRL(overall.investment) },
    { icon: 'eye', label: 'Impressões totais:', value: fmtInt(overall.impressions) },
    { icon: 'click', label: 'Cliques totais:', value: fmtInt(overall.clicks) },
    { icon: 'user', label: 'Leads CRM:', value: fmtInt(overall.leads) },
    { icon: 'tag', label: 'CPL médio:', value: fmtBRL(overall.cpl) },
    { icon: 'calendar', label: 'Reuniões agendadas:', value: fmtInt(overall.meetingsScheduled) },
    { icon: 'users', label: 'Reuniões realizadas:', value: fmtInt(overall.meetingsDone) },
    { icon: 'trophy', label: 'Ganhos:', value: fmtInt(overall.wins) },
    { icon: 'dollar', label: 'Faturamento:', value: fmtBRL(overall.revenue) },
    { icon: 'trend', label: 'ROI geral:', value: fmtROI(overall.roi) },
  ];

  return (
    <SlideBase pageNumber={page} totalPages={total} bgClass="bg-[#f8fff8]">
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-4">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#1a1a1a' }}>RESULTADO GERAL – </span>
            <span style={{ color: '#7B21D0' }}>
              {data.periodLabel.replace(' de 2026', '').replace(' de 2025', '').toUpperCase()}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Principais indicadores consolidados do período</p>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-green-100 bg-white px-2 py-2 flex flex-col gap-1"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full" style={{ background: '#f0fdf0', color: '#7B21D0' }}>
                <MetricIcon type={m.icon} />
              </div>
              <p className="text-[9px] text-gray-500 leading-tight">{m.label}</p>
              <p className="font-black text-sm leading-tight" style={{ color: '#7B21D0' }}>{m.value}</p>
            </div>
          ))}
        </div>

        <InfoBox text={data.ai.overallHighlight} />
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 5 — Performance Funnel ────────────────────────────────────────────

export function PerformanceFunnelSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const { overall } = data;
  const stages = [
    { icon: 'eye', label: 'impressões', value: fmtInt(overall.impressions), color: '#7B21D0' },
    { icon: 'click', label: 'cliques', value: fmtInt(overall.clicks), color: '#44DD2E' },
    { icon: 'user', label: 'leads CRM', value: fmtInt(overall.leads), color: '#7B21D0' },
    { icon: 'calendar', label: 'reuniões agendadas', value: fmtInt(overall.meetingsScheduled), color: '#44DD2E' },
    { icon: 'users', label: 'reuniões realizadas', value: fmtInt(overall.meetingsDone), color: '#7B21D0' },
    { icon: 'trophy', label: 'vendas', value: fmtInt(overall.wins), color: '#44DD2E' },
    { icon: 'dollar', label: 'faturados', value: fmtBRL(overall.revenue), color: '#7B21D0' },
  ];

  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-3">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#1a1a1a' }}>FUNIL CONSOLIDADO DE </span>
            <span style={{ color: '#44DD2E', filter: 'brightness(0.7)' }}>PERFORMANCE</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Do volume de mídia ao faturamento</p>
        </div>

        <div className="flex-1 flex items-center gap-8">
          {/* Funnel visual */}
          <div className="flex flex-col items-center gap-0.5 w-52">
            {stages.map((s, i) => {
              const width = 100 - i * 10;
              return (
                <div
                  key={s.label}
                  className="flex items-center justify-center text-white text-[9px] font-bold"
                  style={{
                    width: `${width}%`,
                    height: 28,
                    background: s.color,
                    clipPath: i < stages.length - 1
                      ? 'polygon(0 0, 100% 0, 95% 100%, 5% 100%)'
                      : 'polygon(5% 0, 95% 0, 90% 100%, 10% 100%)',
                  }}
                >
                  <MetricIcon type={s.icon} />
                </div>
              );
            })}
          </div>

          {/* Stage labels */}
          <div className="flex-1 flex flex-col gap-1.5">
            {stages.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="font-black text-sm" style={{ color: s.color === '#44DD2E' ? '#15803d' : s.color }}>
                  {s.value}
                </span>
                <span className="text-[10px] text-gray-500">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Bottleneck note */}
          <div className="w-48 rounded-xl border border-gray-200 bg-white p-3">
            <div className="w-8 h-8 rounded-full flex items-center justify-center mb-2" style={{ background: '#44DD2E' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[10px] text-gray-600 leading-relaxed">{data.ai.funnelBottleneck}</p>
          </div>
        </div>
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 6 — Visibility vs Conversion ──────────────────────────────────────

export function VisibilityConversionSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const maxImpr = Math.max(...data.monthly.map((m) => m.impressions), 1);
  const maxRev = Math.max(...data.monthly.map((m) => m.revenue), 1);

  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-3">
        <div>
          <h2 className="font-black uppercase text-xl leading-tight">
            <span style={{ color: '#1a1a1a' }}>VISIBILIDADE ALTA, </span>
            <span style={{ color: '#7B21D0' }}>CONVERSÃO COMERCIAL CONCENTRADA</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Entrega de mídia e resultado comercial por mês</p>
        </div>

        <div className="flex gap-6 flex-1">
          {/* Left insights */}
          <div className="w-52 flex flex-col gap-2">
            {[
              { icon: 'eye', text: `A campanha gerou mais de ${fmtInt(Math.round(data.overall.impressions / 1000))} mil impressões.` },
              { icon: 'trend', text: data.ai.visibilityConversionInsight.split('.')[0] + '.' },
              { icon: 'dollar', text: data.ai.visibilityConversionInsight.split('.')[1]?.trim() || 'O resultado ficou concentrado nos primeiros meses.' },
              { icon: 'trend', text: 'O aumento de alcance não acompanhou o crescimento em vendas.' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="mt-0.5 shrink-0" style={{ color: '#7B21D0' }}>
                  <MetricIcon type={item.icon} />
                </div>
                <p className="text-[9px] text-gray-600 leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Right chart */}
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-4 text-[9px] text-gray-500 mb-1">
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 rounded-sm" style={{ background: '#7B21D0' }} />
                Impressões (Visibilidade)
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-2 rounded-sm" style={{ background: '#44DD2E' }} />
                Faturamento (Receita)
              </div>
            </div>
            <div className="flex gap-6 flex-1 items-end">
              {data.monthly.map((m) => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <p className="text-[9px] font-bold text-gray-600">{m.month.slice(0, 3).toUpperCase()}</p>
                  <div className="w-full flex gap-1 items-end" style={{ height: 100 }}>
                    <div
                      className="flex-1 rounded-t"
                      style={{ background: '#7B21D0', height: `${(m.impressions / maxImpr) * 100}%`, minHeight: 4 }}
                    />
                    <div
                      className="flex-1 rounded-t"
                      style={{ background: '#44DD2E', height: `${(m.revenue / maxRev) * 100}%`, minHeight: 4 }}
                    />
                  </div>
                  <p className="text-[8px] text-gray-400 text-center leading-tight">
                    {m.revenue > 0 ? `R$${Math.round(m.revenue / 1000)}k` : 'R$0'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quote box */}
        <div className="rounded-xl px-4 py-3 text-center text-white text-xs font-bold flex items-center gap-3" style={{ background: '#7B21D0' }}>
          <span style={{ fontSize: '1.8em', lineHeight: 1 }}>"</span>
          <span>Nem sempre o mês com maior entrega é o mês com{' '}
            <span style={{ color: '#44DD2E' }}>melhor resultado comercial.</span>
          </span>
          <span style={{ fontSize: '1.8em', lineHeight: 1 }}>"</span>
        </div>
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 7 — Monthly Evolution ─────────────────────────────────────────────

export function MonthlyEvolutionSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const bestMonth = [...data.monthly].sort((a, b) => b.revenue - a.revenue)[0];

  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-4">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#1a1a1a' }}>EVOLUÇÃO MENSAL </span>
            <span style={{ color: '#7B21D0' }}>DOS RESULTADOS</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Comparativo mensal de <strong>investimento, leads, reuniões, ganhos</strong> e <strong>faturamento</strong>
          </p>
        </div>

        <div className="flex-1 rounded-xl overflow-hidden border border-gray-200">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#7B21D0' }}>
                {['Mês', 'Investimento', 'Leads', 'Reuniões', 'Ganhos', 'Faturamento'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-bold text-white">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => {
                const isBest = m.month === bestMonth?.month;
                return (
                  <tr
                    key={m.month}
                    className="border-b border-gray-100"
                    style={{ background: isBest ? '#f0fdf0' : 'white' }}
                  >
                    <td className="px-4 py-2.5 font-bold flex items-center gap-2">
                      {isBest && (
                        <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: '#44DD2E' }}>
                          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                            <path d="M6 1l1.5 3.5L11 5l-2.5 2.5.5 3.5L6 9.5 3 11l.5-3.5L1 5l3.5-.5L6 1z" fill="white" />
                          </svg>
                        </span>
                      )}
                      <span style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{m.month}</span>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{fmtBRL(m.investment)}</td>
                    <td className="px-4 py-2.5" style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{fmtInt(m.leads)}</td>
                    <td className="px-4 py-2.5" style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{fmtInt(m.meetingsScheduled)}</td>
                    <td className="px-4 py-2.5" style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{fmtInt(m.wins)}</td>
                    <td className="px-4 py-2.5 font-bold" style={{ color: isBest ? '#15803d' : '#1a1a1a' }}>{fmtBRL(m.revenue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <InfoBox text={data.ai.monthlyInsight} />
      </div>
    </SlideBase>
  );
}

// ─── SLIDE 8+ — Month Detail ──────────────────────────────────────────────────

function monthTagline(m: MonthlyData, allMonths: MonthlyData[]): { part1: string; part2: string; color: string } {
  const maxRev = Math.max(...allMonths.map((x) => x.revenue));
  const maxInv = Math.max(...allMonths.map((x) => x.investment));

  if (m.revenue === maxRev && m.investment < maxInv) {
    return { part1: 'MELHOR MÊS EM', part2: 'EFICIÊNCIA COMERCIAL', color: '#44DD2E' };
  }
  if (m.wins === 0 && m.leads > 0) {
    return { part1: 'VOLUME ALTO,', part2: 'SEM FATURAMENTO', color: '#1a1a1a' };
  }
  if (m.investment === maxInv) {
    return { part1: 'MAIOR INVESTIMENTO E', part2: 'BAIXA CONVERSÃO', color: '#1a1a1a' };
  }
  return { part1: 'RESULTADO', part2: 'DO MÊS', color: '#7B21D0' };
}

export function MonthDetailSlide({ month, data, page, total }: { month: MonthlyData; data: ReportData; page: number; total: number }) {
  const tagline = monthTagline(month, data.monthly);
  const cpl = month.leads > 0 ? month.investment / month.leads : 0;
  const costPerMeeting = month.meetingsScheduled > 0 ? month.investment / month.meetingsScheduled : 0;
  const roi = month.investment > 0 ? month.revenue / month.investment : 0;
  const isBest = month.revenue === Math.max(...data.monthly.map((m) => m.revenue));

  const cards = [
    { icon: 'investment', label: 'Investimento:', value: fmtBRL(month.investment) },
    { icon: 'eye', label: 'Impressões:', value: fmtInt(month.impressions) },
    { icon: 'click', label: 'Cliques:', value: fmtInt(month.clicks) },
    { icon: 'user', label: 'Leads:', value: fmtInt(month.leads) },
    { icon: 'tag', label: 'CPL:', value: fmtBRL(cpl) },
    { icon: 'calendar', label: 'Reuniões agendadas:', value: fmtInt(month.meetingsScheduled) },
    { icon: 'trend', label: 'Custo por reunião:', value: fmtBRL(costPerMeeting) },
    { icon: 'trophy', label: 'Ganhos:', value: fmtInt(month.wins) },
    { icon: 'dollar', label: 'Faturamento:', value: fmtBRL(month.revenue) },
    { icon: 'trend', label: 'ROI:', value: fmtROI(roi) },
  ];

  return (
    <SlideBase pageNumber={page} totalPages={total} bgClass={isBest ? 'bg-[#f8fff8]' : 'bg-[#f8f6ff]'}>
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-3">
        <div>
          <h2 className="font-black uppercase text-xl leading-tight">
            <span style={{ color: '#7B21D0' }}>{month.month.toUpperCase()} – </span>
            <span style={{ color: '#1a1a1a' }}>{tagline.part1}</span>
            <br />
            <span style={{ color: tagline.color === '#44DD2E' ? '#15803d' : tagline.color }}>
              {tagline.part2}
            </span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Análise detalhada de investimento, leads e conversão</p>
        </div>

        <div className="grid grid-cols-5 gap-2 flex-1">
          {cards.map((c) => (
            <div key={c.label} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: isBest ? '#f0fdf0' : '#ede9fe', color: isBest ? '#15803d' : '#7B21D0' }}>
                <MetricIcon type={c.icon} />
              </div>
              <p className="text-[9px] text-gray-500 leading-tight">{c.label}</p>
              <p className="font-black text-sm leading-tight" style={{ color: isBest ? '#15803d' : '#7B21D0' }}>
                {c.value}
              </p>
            </div>
          ))}
        </div>

        <InfoBox
          text={isBest
            ? `<strong>${month.month}</strong> foi o mês de maior eficiência comercial. ${data.ai.monthlyInsight.split('.')[0]}.`
            : `<strong>${month.month}</strong>: ${month.leads} leads gerados, ${month.wins} venda(s) concretizada(s). O volume de mídia ${month.impressions > 0 ? 'foi relevante' : 'foi baixo'} mas a conversão comercial ${month.wins === 0 ? 'não se concretizou' : 'foi positiva'}.`
          }
        />
      </div>
    </SlideBase>
  );
}

// ─── SLIDE — Channel Comparison ──────────────────────────────────────────────

export function ChannelComparisonSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  const channels = [
    { ...data.meta, color: '#7B21D0' },
    { ...data.google, color: '#44DD2E' },
  ];

  return (
    <SlideBase pageNumber={page} totalPages={total}>
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-4">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#7B21D0' }}>META ADS</span>
            <span style={{ color: '#1a1a1a' }}> VS </span>
            <span style={{ color: '#15803d' }}>GOOGLE ADS</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Comparativo de performance entre plataformas no período</p>
        </div>

        <div className="flex-1 flex gap-6 items-stretch">
          {channels.map((ch) => (
            <div key={ch.name} className="flex-1 rounded-xl border-2 p-5 flex flex-col gap-3" style={{ borderColor: ch.color }}>
              <p className="font-black text-lg" style={{ color: ch.color === '#44DD2E' ? '#15803d' : ch.color }}>
                {ch.name}
              </p>
              <div className="grid grid-cols-2 gap-2 flex-1">
                {[
                  { label: 'Investimento', value: fmtBRL(ch.investment) },
                  { label: 'Impressões', value: fmtInt(ch.impressions) },
                  { label: 'Cliques', value: fmtInt(ch.clicks) },
                  { label: 'Leads', value: fmtInt(ch.leads) },
                  { label: 'CPL', value: fmtBRL(ch.cpl) },
                  { label: '% do Invest.', value: `${fmt(data.overall.investment > 0 ? (ch.investment / data.overall.investment) * 100 : 0, 1)}%` },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-gray-100 bg-gray-50 px-2 py-2">
                    <p className="text-[9px] text-gray-400">{m.label}</p>
                    <p className="font-black text-sm" style={{ color: ch.color === '#44DD2E' ? '#15803d' : ch.color }}>{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <InfoBox text={`${data.ai.metaInsight} ${data.ai.googleInsight}`} />
      </div>
    </SlideBase>
  );
}

// ─── SLIDE — Recommendations ─────────────────────────────────────────────────

export function RecommendationsSlide({ data, page, total }: { data: ReportData; page: number; total: number }) {
  return (
    <SlideBase pageNumber={page} totalPages={total} bgClass="bg-[#f8f6ff]">
      <div className="px-10 pt-8 pb-8 h-full flex flex-col gap-4">
        <div>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#1a1a1a' }}>RECOMENDAÇÕES</span>
          </h2>
          <h2 className="font-black uppercase text-2xl leading-tight">
            <span style={{ color: '#7B21D0' }}>E PRÓXIMOS PASSOS</span>
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Com base na análise integrada dos dados do período</p>
        </div>

        <div className="grid grid-cols-2 gap-3 flex-1">
          {data.ai.recommendations.slice(0, 4).map((rec, i) => (
            <div key={i} className="rounded-xl border border-purple-100 bg-white px-4 py-4 flex gap-3">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-black text-white text-sm" style={{ background: i % 2 === 0 ? '#7B21D0' : '#44DD2E' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <p className="text-xs text-gray-700 leading-relaxed">{rec}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl px-4 py-3 flex items-center gap-3 text-white text-xs font-semibold" style={{ background: '#7B21D0' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#44DD2E' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="white" />
            </svg>
          </div>
          Dados apresentados pela <strong style={{ marginLeft: 4 }}>onmid</strong> — plataforma de inteligência de mídia e CRM.
        </div>
      </div>
    </SlideBase>
  );
}

// ─── Slide registry ───────────────────────────────────────────────────────────

export function buildSlides(data: ReportData): React.ReactNode[] {
  const monthSlides = data.monthly.map((m, i) => (
    <MonthDetailSlide key={m.month} month={m} data={data} page={8 + i} total={8 + data.monthly.length + 2} />
  ));

  const totalSlides = 8 + data.monthly.length + 2;

  return [
    <CoverSlide key="cover" data={data} page={1} total={totalSlides} />,
    <DataOverviewSlide key="data" data={data} page={2} total={totalSlides} />,
    <FunnelClassificationSlide key="funnel-class" page={3} total={totalSlides} />,
    <OverallResultsSlide key="overall" data={data} page={4} total={totalSlides} />,
    <PerformanceFunnelSlide key="perf-funnel" data={data} page={5} total={totalSlides} />,
    <VisibilityConversionSlide key="visibility" data={data} page={6} total={totalSlides} />,
    <MonthlyEvolutionSlide key="monthly" data={data} page={7} total={totalSlides} />,
    ...monthSlides,
    <ChannelComparisonSlide key="channels" data={data} page={8 + data.monthly.length} total={totalSlides} />,
    <RecommendationsSlide key="recs" data={data} page={totalSlides} total={totalSlides} />,
  ];
}
