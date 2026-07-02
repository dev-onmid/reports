import { makeServerPool } from '@/lib/server-db';
import DiagnosticoTemplate from '@/components/diagnostico-template';
import OmniPerformanceTemplate from '@/components/onmid-performance-template';
import DeliveryViewer from '@/components/delivery-template/viewer';
import type { DiagnosticoData } from '@/components/diagnostico-template/types';
import type { OmniReportData } from '@/components/onmid-performance-template/types';
import type { DeliveryReportData } from '@/components/delivery-template/types';

export const dynamic = 'force-dynamic';

export default async function RelatorioPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const printParam = Array.isArray(query.print) ? query.print[0] : query.print;
  const shouldPrint = printParam === '1' || printParam === 'true';
  const printScript = shouldPrint
    ? <script dangerouslySetInnerHTML={{ __html: 'setTimeout(() => window.print(), 900);' }} />
    : null;

  const pool = makeServerPool();
  let report: {
    client_name: string;
    period_from: string;
    period_to: string;
    report_data: unknown;
    template_slug: string;
  } | null = null;

  try {
    const { rows } = await pool.query(
      `SELECT client_name, period_from, period_to, report_data, template_slug
       FROM public.diagnostic_reports
       WHERE public_token = $1`,
      [token],
    );
    report = rows[0] ?? null;
  } catch {
    report = null;
  } finally {
    await pool.end();
  }

  if (!report) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#f5f5f5', fontFamily: 'Inter, sans-serif',
      }}>
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: 48, marginBottom: 16 }}>📄</p>
          <p style={{ fontWeight: 700, fontSize: 20, color: '#333', marginBottom: 8 }}>Relatório não encontrado</p>
          <p style={{ fontSize: 14, color: '#888' }}>O link pode ter expirado ou ser inválido.</p>
        </div>
      </div>
    );
  }

  // ── New narrative templates (HTML output from Claude) ──────────────────────
  if (
    report.template_slug === 'onmid-narrative-performance' ||
    report.template_slug === 'onmid-narrative-delivery'
  ) {
    const data = report.report_data as { html: string };
    const isDelivery = report.template_slug === 'onmid-narrative-delivery';
    const printCss = `
      :root {
        --report-canvas: #EEF1F5;
        --report-page: #F7F8FA;
        --report-surface: #FFFFFF;
        --report-surface-alt: #F1F5F9;
        --report-border: #D6DEE8;
        --report-text: #0F172A;
        --report-muted: #334155;
      }
      @page { size: 1440px 810px; margin: 0; }
      @media print {
        body { background: var(--report-canvas) !important; }
        [style*="page-break-after"] { break-after: page; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
        .onmid-report { padding: 0 !important; }
        [style*="width:1440px"] { margin: 0 !important; }
      }
      * { box-sizing: border-box; }
      body { background: var(--report-canvas); }
      [style*="background:#F4F4F4"],
      [style*="background: #F4F4F4"] { background: var(--report-canvas) !important; }
      [style*="background:#FFFFFF"],
      [style*="background: #FFFFFF"] { background: var(--report-page) !important; }
      [style*="background:#F7F8FA"],
      [style*="background: #F7F8FA"] { background: var(--report-surface) !important; }
      [style*="border:1px solid #E2E8F0"],
      [style*="border: 1px solid #E2E8F0"] { border-color: var(--report-border) !important; }
      [style*="border-bottom:1px solid #E2E8F0"],
      [style*="border-bottom: 1px solid #E2E8F0"] { border-bottom-color: var(--report-border) !important; }
      [style*="color:#111827"],
      [style*="color: #111827"] { color: var(--report-text) !important; }
      [style*="color:#374151"],
      [style*="color: #374151"],
      [style*="color:#64748B"],
      [style*="color: #64748B"] { color: var(--report-muted) !important; }
    `;
    return (
      <>
        <title>{`Relatório ${isDelivery ? 'Delivery' : 'de Performance'} — ${report.client_name}`}</title>
        <style dangerouslySetInnerHTML={{ __html: printCss }} />
        {printScript}
        <div style={{ background: '#EEF1F5', minHeight: '100vh', overflowX: 'auto' }}>
          <div dangerouslySetInnerHTML={{ __html: data.html ?? '' }} />
        </div>
      </>
    );
  }

  // ── Legacy templates ───────────────────────────────────────────────────────
  if (report.template_slug === 'onmid-delivery') {
    return (
      <>
        <title>{`Relatório Delivery — ${report.client_name}`}</title>
        {printScript}
        <DeliveryViewer data={report.report_data as DeliveryReportData} />
      </>
    );
  }

  if (report.template_slug === 'onmid-clean-performance') {
    return (
      <>
        <title>{`Relatório — ${report.client_name}`}</title>
        {printScript}
        <OmniPerformanceTemplate data={report.report_data as OmniReportData} />
      </>
    );
  }

  return (
    <>
      <title>{`Relatório — ${report.client_name}`}</title>
      {printScript}
      <DiagnosticoTemplate data={report.report_data as DiagnosticoData} />
    </>
  );
}
