import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buildOmniReport, saveOmniReport } from '@/lib/report-builder';
import { buildDeliveryReport, saveDeliveryReport } from '@/lib/delivery-report-builder';

export const maxDuration = 60;

function prevMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  return { from: fmt(first), to: fmt(last) };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ configId: string }> }) {
  const { configId } = await params;
  const body = await request.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string };

  const pool = makeServerPool();
  let config: {
    client_id: string; client_name: string; template: 'performance' | 'delivery';
    meta_connection_id: string | null; meta_account_ids: string[];
    google_connection_id: string | null; google_account_ids: string[];
  } | null = null;

  try {
    const { rows } = await pool.query(`
      SELECT
        rc.client_id, c.name AS client_name, rc.template,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform IN ('meta','meta_ads') LIMIT 1) AS meta_connection_id,
        ARRAY(SELECT cal.account_id FROM public.client_account_links cal
              WHERE cal.client_id = rc.client_id AND cal.platform IN ('meta','meta_ads')) AS meta_account_ids,
        (SELECT cal.connection_id FROM public.client_account_links cal
         WHERE cal.client_id = rc.client_id AND cal.platform IN ('google','google_ads') LIMIT 1) AS google_connection_id,
        ARRAY(SELECT cal.account_id FROM public.client_account_links cal
              WHERE cal.client_id = rc.client_id AND cal.platform IN ('google','google_ads')) AS google_account_ids
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      WHERE rc.id = $1
    `, [configId]);
    config = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!config) return Response.json({ error: 'Config not found' }, { status: 404 });

  const period = body.dateFrom
    ? { from: body.dateFrom, to: body.dateTo ?? body.dateFrom }
    : prevMonth();

  // ── Delivery template ──────────────────────────────────────────────────────
  // Automated runs never have CSVs to attach — sections derived from the
  // cardápio digital are simply omitted, same as a manual run without uploads.
  if (config.template === 'delivery') {
    const reportData = await buildDeliveryReport({
      clientId: config.client_id, clientName: config.client_name,
      from: period.from, to: period.to, csvFiles: [],
      connectionId: config.meta_connection_id,
      accountIds: config.meta_account_ids,
    });
    const { token, reportId } = await saveDeliveryReport({
      clientId: config.client_id, clientName: config.client_name,
      from: period.from, to: period.to, data: reportData,
      generatedBy: 'auto', configId,
    });
    return Response.json({ ok: true, id: reportId, public_token: token });
  }

  // ── Performance template (default) ────────────────────────────────────────
  const reportData = await buildOmniReport({
    clientId: config.client_id,
    clientName: config.client_name,
    connectionId: config.meta_connection_id,
    accountIds: config.meta_account_ids,
    googleConnectionId: config.google_connection_id,
    googleAccountIds: config.google_account_ids,
    periodFrom: period.from,
    periodTo: period.to,
  });

  const { id, public_token } = await saveOmniReport({
    clientId: config.client_id, clientName: config.client_name,
    periodFrom: period.from, periodTo: period.to,
    reportData, generatedBy: 'auto', configId,
  });

  return Response.json({ ok: true, id, public_token });
}
