import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { buildRecomendacoes, ensureOptimizerRecStatusTable, type OptimizerOutputV2 } from '@/lib/optimizer';
import { upsertRecStatus } from '@/lib/optimizer-execucao';

// Marca TODAS as pendências da última análise semanal de um cliente como revisadas de uma vez
// (gestor bateu o olho na conta inteira e não achou nada que precise de ação). Some da fila e
// o dot volta a ficar "tudo certo" até a próxima análise semanal gerar pendências novas.

type RevisarTudoBody = {
  cliente_id: string;
  autor_id?: string;
  autor_nome?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as RevisarTudoBody;
  if (!body.cliente_id) {
    return Response.json({ error: 'cliente_id é obrigatório.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);

    const { rows: logs } = await pool.query<{
      id: string; cliente_id: string; cliente_nome: string | null;
      conta_plataforma: string | null; connection_id: string | null; account_id: string | null;
      resultado: OptimizerOutputV2;
    }>(
      `SELECT DISTINCT ON (cliente_id) id, cliente_id, cliente_nome, conta_plataforma, connection_id, account_id, resultado
         FROM public.optimizer_ai_logs
        WHERE cliente_id = $1 AND solicitacao = 'analise_semanal' AND resultado IS NOT NULL
        ORDER BY cliente_id, created_at DESC`,
      [body.cliente_id],
    );
    const log = logs[0];
    if (!log) return Response.json({ error: 'Nenhuma análise encontrada para este cliente.' }, { status: 404 });

    const canal: 'meta' | 'google' = log.conta_plataforma === 'google_ads' ? 'google' : 'meta';
    const recs = buildRecomendacoes(log.resultado, {
      analise_id: log.id,
      cliente_id: log.cliente_id,
      cliente_nome: log.cliente_nome ?? log.cliente_id,
      canal,
      connection_id: log.connection_id,
      account_id: log.account_id,
    });

    const { rows: statusRows } = await pool.query<{ rec_id: string; status: string }>(
      `SELECT rec_id, status FROM public.optimizer_recomendacao_status WHERE cliente_id = $1`,
      [body.cliente_id],
    );
    const statusByRec = new Map(statusRows.map((s) => [s.rec_id, s.status]));

    // Só marca quem ainda está pendente (nunca sobrescreve "aplicado" nem quem já foi ignorado).
    const pendentes = recs.filter((r) => {
      const st = statusByRec.get(r.rec_id) ?? 'pendente';
      return st !== 'ignorado' && st !== 'aplicado';
    });

    for (const r of pendentes) {
      await upsertRecStatus(pool, {
        rec_id: r.rec_id,
        analise_id: r.analise_id,
        cliente_id: r.cliente_id,
        objeto_id: r.objeto_id,
        status: 'ignorado',
        autor_id: body.autor_id,
        autor_nome: body.autor_nome,
        motivo: 'Revisão em lote — conta conferida, sem ajustes necessários.',
      });
    }

    return Response.json({ ok: true, revisados: pendentes.length });
  } finally {
    await pool.end();
  }
}
