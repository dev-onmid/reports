import type { NextRequest } from 'next/server';
import { fetchConfigsForToday, dispatchReportConfigs } from '@/lib/report-dispatch';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  const validSecrets = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only run for configs whose send_day matches today
  const configs = await fetchConfigsForToday();
  const origin = new URL(request.url).origin;
  const results = await dispatchReportConfigs(configs, origin);

  return Response.json({ ok: true, processed: results.length, results });
}
