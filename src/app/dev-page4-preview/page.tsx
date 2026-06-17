import { __devPreviewMetaAdsResumo } from '@/lib/delivery-report-builder';

export const dynamic = 'force-dynamic';

export default function DevPage4Preview() {
  const html = __devPreviewMetaAdsResumo();
  return (
    <div style={{ background: '#EEF1F5', minHeight: '100vh', overflowX: 'auto' }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
