import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sanearFunisDoCliente } from '@/lib/crm-saneamento';

/**
 * Varredura única: saneia os Kanbans de TODOS os clientes de uma vez (funde
 * Fechado+Comprou num ganho só e remove colunas gêmeas — crm-saneamento.ts).
 *
 * O GET de /api/crm/funnels já faz a auto-cura por cliente ao abrir o board;
 * esta rota existe pra não depender de alguém abrir cada CRM. Rodar uma vez:
 *   GET /api/crm/sanear-kanban?secret=<REPORTS_CRON_SECRET>
 * Idempotente — rodar de novo não muda nada.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') ?? '';
  const valid = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (valid.length === 0 || !valid.includes(secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const pool = makeServerPool();
  try {
    const { rows: clientes } = await pool.query<{ client_id: string }>(
      `SELECT DISTINCT client_id FROM public.crm_funnels`
    );

    const porCliente: Record<string, { leadsMigrados: number; stagesRemovidos: number; gatilhosRealinhados: number }> = {};
    let leadsMigrados = 0, stagesRemovidos = 0, gatilhosRealinhados = 0, erros = 0;

    for (const c of clientes) {
      // Orçamento de 280s: melhor devolver parcial (idempotente, roda de novo)
      // do que morrer no teto da rota.
      if (Date.now() - started > 280_000) {
        return Response.json({
          ok: true, parcial: true, motivo: 'sem_tempo',
          clientes: clientes.length, leadsMigrados, stagesRemovidos, gatilhosRealinhados, erros, porCliente,
        });
      }
      try {
        const r = await sanearFunisDoCliente(pool, c.client_id);
        if (r.leadsMigrados || r.stagesRemovidos || r.gatilhosRealinhados) {
          porCliente[c.client_id] = {
            leadsMigrados: r.leadsMigrados,
            stagesRemovidos: r.stagesRemovidos,
            gatilhosRealinhados: r.gatilhosRealinhados,
          };
        }
        leadsMigrados += r.leadsMigrados;
        stagesRemovidos += r.stagesRemovidos;
        gatilhosRealinhados += r.gatilhosRealinhados;
      } catch (err) {
        erros++;
        console.error(`[sanear-kanban] cliente ${c.client_id}`, err);
      }
    }

    return Response.json({
      ok: true,
      clientes: clientes.length,
      leadsMigrados, stagesRemovidos, gatilhosRealinhados, erros,
      porCliente,
      tookMs: Date.now() - started,
    });
  } finally {
    await pool.end();
  }
}
