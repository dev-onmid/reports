import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import { processarFila } from '@/lib/post-motor';

/**
 * Cron do Planejador de Publicações — casca fina sobre `post-motor`.
 *
 * Cron: linha na crontab da VPS a cada minuto. NUNCA GitHub Actions — ele
 * throttleia os agendamentos deste repo (ver CLAUDE.md), e um post que sai duas
 * horas atrasado é um post errado.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function autorizado(req: NextRequest): boolean {
  const segredos = [
    process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET,
  ].filter(Boolean) as string[];
  if (segredos.length === 0) return false; // falha FECHADA
  const header = req.headers.get('authorization');
  const query = new URL(req.url).searchParams.get('secret');
  return segredos.some(s => header === `Bearer ${s}` || query === s);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = makeServerPool();
  try {
    const r = await processarFila(pool, webhookOrigin(req.url), { budgetMs: 45_000 });
    return Response.json({ ok: true, ...r });
  } catch (err) {
    console.error('[publicacoes worker]', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
