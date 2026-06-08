import { makeServerPool } from '@/lib/server-db';
import DiagnosticoTemplate from '@/components/diagnostico-template';
import OmniPerformanceTemplate from '@/components/onmid-performance-template';
import DeliveryViewer from '@/components/delivery-template/viewer';
import type { DiagnosticoData } from '@/components/diagnostico-template/types';
import type { OmniReportData } from '@/components/onmid-performance-template/types';
import type { DeliveryReportData } from '@/components/delivery-template/types';

export const dynamic = 'force-dynamic';

export default async function RelatorioPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

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

  if (report.template_slug === 'onmid-delivery') {
    return (
      <>
        <title>{`Relatório Delivery — ${report.client_name}`}</title>
        <DeliveryViewer data={report.report_data as DeliveryReportData} />
      </>
    );
  }

  if (report.template_slug === 'onmid-clean-performance') {
    return (
      <>
        <title>{`Relatório — ${report.client_name}`}</title>
        <OmniPerformanceTemplate data={report.report_data as OmniReportData} />
      </>
    );
  }

  return (
    <>
      <title>{`Relatório — ${report.client_name}`}</title>
      <DiagnosticoTemplate data={report.report_data as DiagnosticoData} />
    </>
  );
}
