import { __devPreviewInstagram } from '@/lib/delivery-report-builder';

export const dynamic = 'force-dynamic';

export default function DevPageIgMetricsPreview() {
  const html = __devPreviewInstagram();
  return (
    <div style={{ background: '#EEF1F5', minHeight: '100vh', overflowX: 'auto' }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
