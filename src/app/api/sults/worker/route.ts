import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { processarFilaSults } from '@/lib/sults-motor';

/**
 * Cron do envio de leads para o SULTS — casca fina sobre `sults-motor`.
 *
 * Cron: linha na crontab da VPS a cada minuto (GitHub Actions é throttleado
 * neste repo). ⚠️ A rota precisa estar em CRON_PREFIXES no proxy.ts, senão o
 * cron recebe {"error":"Não autenticado."} do PROXY e não da rota — foi o que
 * pegou o worker de publicações em 2026-08-26.
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
    const r = await processarFilaSults(pool, { budgetMs: 45_000 });
    return Response.json({ ok: true, ...r });
  } catch (err) {
    console.error('[sults worker]', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
