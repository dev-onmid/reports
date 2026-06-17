import { __devPreviewFullReport } from '@/lib/delivery-report-builder';
import FullPreviewViewerClient from './viewer-client';

export const dynamic = 'force-dynamic';

export default function DevFullPreview() {
  const html = __devPreviewFullReport();
  return <FullPreviewViewerClient html={html} />;
}
