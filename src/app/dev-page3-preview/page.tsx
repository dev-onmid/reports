import { __devPreviewBase } from '@/lib/delivery-report-builder';

export const dynamic = 'force-dynamic';

export default function DevPage3Preview() {
  const html = __devPreviewBase();
  return (
    <div style={{ background: '#EEF1F5', minHeight: '100vh', overflowX: 'auto' }}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
