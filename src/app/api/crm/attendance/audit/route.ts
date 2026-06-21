import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { runAttendanceAudit, fetchLatestAudit } from '@/lib/crm-attendance-audit';

function toDateParam(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function monthRange(month: string | null) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { from: null, to: null };
  const [year, monthIndex] = month.split('-').map(Number);
  const from = `${month}-01`;
  const end = new Date(Date.UTC(year, monthIndex, 0));
  const to = end.toISOString().slice(0, 10);
  return { from, to };
}

// Returns the most recently generated audit for this client, if any — the dashboard
// card shows this on load instead of forcing a fresh (paid) AI call every page view.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const latest = await fetchLatestAudit(pool, clientId);
    return Response.json({ audit: latest });
  } catch (err) {
    console.error('[crm/attendance/audit GET]', err);
    return Response.json({ error: 'Erro ao buscar auditoria.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

// Triggers a fresh AI audit for the given period — explicit user action ("Gerar
// auditoria"), never run automatically, since each call costs a real Claude request.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { clientId?: string; from?: string; to?: string; month?: string };
  const clientId = body.clientId;
  if (!clientId) return Response.json({ error: 'clientId required' }, { status: 400 });

  const range = monthRange(body.month ?? null);
  const from = toDateParam(body.from ?? null) ?? range.from;
  const to = toDateParam(body.to ?? null) ?? range.to;
  if (!from || !to) return Response.json({ error: 'Período (from/to ou month) é obrigatório' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const result = await runAttendanceAudit(pool, clientId, from, to);
    return Response.json({ audit: { result, periodFrom: from, periodTo: to, createdAt: new Date().toISOString() } });
  } catch (err) {
    console.error('[crm/attendance/audit POST]', err);
    const message = err instanceof Error ? err.message : 'Erro ao gerar auditoria.';
    return Response.json({ error: message }, { status: 500 });
  } finally {
    await pool.end();
  }
}
