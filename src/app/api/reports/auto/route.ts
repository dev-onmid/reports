/**
 * Cron job: runs at 08:00 on days 28-31 of every month.
 * On the last day of the month it generates a diagnostic report for every active client.
 * Auth: Authorization: Bearer <CRON_SECRET>
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export const maxDuration = 60;

function isLastDayOfMonth(): boolean {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getMonth() !== now.getMonth();
}

function firstDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().split('T')[0];
}

function lastDayOfLastMonth(): string {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().split('T')[0];
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!isLastDayOfMonth()) {
    return Response.json({ skipped: true, reason: 'Not the last day of month' });
  }

  const dateFrom = firstDayOfLastMonth();
  const dateTo = lastDayOfLastMonth();
  const origin = new URL(req.url).origin;

  const pool = makeServerPool();
  let clients: { id: string; name: string }[] = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM public.clients WHERE status = 'Ativo' OR status = 'active' LIMIT 50`,
    );
    clients = rows;
  } catch {
    clients = [];
  } finally {
    await pool.end();
  }

  const results: { clientId: string; clientName: string; status: string }[] = [];

  for (const client of clients) {
    try {
      const res = await fetch(`${origin}/api/reports/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret ?? ''}` },
        body: JSON.stringify({
          clientId: client.id,
          clientName: client.name,
          dateFrom,
          dateTo,
          generatedBy: 'auto',
        }),
      });
      const data = await res.json() as { id?: string; error?: string };
      results.push({ clientId: client.id, clientName: client.name, status: data.id ? 'ok' : (data.error ?? 'error') });
    } catch (e) {
      results.push({ clientId: client.id, clientName: client.name, status: String(e) });
    }
  }

  return Response.json({ ok: true, dateFrom, dateTo, results });
}
