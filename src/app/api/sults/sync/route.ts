import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sincronizarVoltaSults } from '@/lib/sults-sync';

/**
 * Cron da volta (SULTS → reports) — casca fina sobre `sults-sync`.
 *
 * Cadência de 10 min na crontab da VPS, não 1 min como o worker de ida: cada
 * rodada lê o funil inteiro (a API não filtra por data de alteração), então
 * varrer de minuto em minuto só repetiria as mesmas centenas de leituras.
 *
 * ⚠️ Rota precisa estar em CRON_PREFIXES no proxy.ts.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
    const r = await sincronizarVoltaSults(pool, { budgetMs: 240_000 });
    return Response.json({ ok: true, ...r });
  } catch (err) {
    console.error('[sults sync]', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
