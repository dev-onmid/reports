import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureFidelidadeSchema } from '@/lib/fidelidade-server';
import { COLS_DEVIDA, processarCampanha, type LinhaDevida } from '@/lib/fidelidade-motor';

/**
 * Cron das campanhas de Fidelidade — casca fina sobre `fidelidade-motor`.
 *
 * A lógica mora na lib porque o botão "Disparar 1 agora" da tela usa
 * exatamente a mesma, e travas que divergem entre o automático e o manual
 * seriam a pior forma de errar aqui.
 *
 * Cron: linha na crontab da VPS a cada minuto (o GitHub Actions throttleia os
 * agendamentos deste repo — ver CLAUDE.md).
 */

export const maxDuration = 60;
const BUDGET_MS = 50_000;

function autorizado(req: NextRequest): boolean {
  const segredos = [
    process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET,
  ].filter(Boolean) as string[];
  if (segredos.length === 0) return false; // falha FECHADA: sem segredo, ninguém roda
  const header = req.headers.get('authorization');
  const query = new URL(req.url).searchParams.get('secret');
  return segredos.some(s => header === `Bearer ${s}` || query === s);
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const pool = makeServerPool();
  const inicio = Date.now();
  const relatorio: Record<string, unknown>[] = [];

  try {
    await ensureFidelidadeSchema(pool);

    // Só campanha ATIVA de cliente com o interruptor ligado. O JOIN é o mesmo
    // portão da rota da tela: desligar o cliente para o motor na mesma hora.
    const { rows: devidas } = await pool.query<LinhaDevida>(
      `SELECT ${COLS_DEVIDA}
         FROM public.fidelidade_campanhas f
         JOIN public.clients c ON c.id = f.client_id
        WHERE f.ativa = true
          AND c.fidelidade_ativa = true
          AND (f.proxima_execucao IS NULL OR f.proxima_execucao <= NOW())
        ORDER BY f.proxima_execucao ASC NULLS FIRST
        LIMIT 40`,
    );

    for (const campanha of devidas) {
      if (Date.now() - inicio > BUDGET_MS) break;
      try {
        relatorio.push(await processarCampanha(pool, campanha));
      } catch (err) {
        console.error('[fidelidade worker]', campanha.id, err);
        relatorio.push({ campanha: campanha.id, erro: String(err) });
        await pool.query(
          `UPDATE public.fidelidade_campanhas SET proxima_execucao = NOW() + interval '10 minutes'
            WHERE id = $1`, [campanha.id],
        ).catch(() => {});
      }
    }

    return Response.json({ ok: true, campanhas: devidas.length, relatorio });
  } catch (err) {
    console.error('[fidelidade worker]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  } finally {
    await pool.end();
  }
}
