import { makeServerPool } from '@/lib/server-db';

/**
 * Quais clientes têm integração de leads com o SULTS (conexão LIGADA).
 *
 * A dashboard usa isso pra mostrar a tabela "Desempenho por região" só para
 * esses clientes (pedido do Matheus, 2026-09-24): é onde a origem e a região
 * do lead chegam completas e o cruzamento com campanha por região faz
 * sentido. Mesmo padrão do delivery-flags — a fonte da verdade é a própria
 * conexão, sem flag em `clients`. Sem tabela → objeto vazio, nunca 500.
 */
export async function GET() {
  const pool = makeServerPool();
  try {
    const flags: Record<string, true> = {};
    const { rows } = await pool.query<{ client_id: string }>(
      `SELECT DISTINCT client_id FROM public.sults_connections WHERE enabled = true`
    ).catch(() => ({ rows: [] as { client_id: string }[] }));
    for (const r of rows) flags[r.client_id] = true;
    return Response.json(flags);
  } catch {
    return Response.json({});
  } finally {
    await pool.end();
  }
}
