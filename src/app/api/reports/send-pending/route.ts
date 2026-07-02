import type { NextRequest } from 'next/server';
import { fetchPendingConfigsThisMonth, dispatchReportConfigs } from '@/lib/report-dispatch';

// Manual contingency button (Relatórios > "Disparar pendentes") for when the daily
// cron misses a client's send_day — e.g. it was down or hadn't been deployed yet.
// Only processes configs that haven't generated a report this calendar month, so
// re-clicking it never duplicates a send that already went out.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const configs = await fetchPendingConfigsThisMonth();
  const origin = new URL(request.url).origin;
  const results = await dispatchReportConfigs(configs, origin);

  return Response.json({ ok: true, processed: results.length, results });
}
