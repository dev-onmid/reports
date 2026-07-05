import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  buildRecomendacoes,
  ensureOptimizerRecStatusTable,
  type OptimizerOutputV2,
  type OptimizerRecomendacao,
  type OptimizerRecomendacaoSeveridade,
} from '@/lib/optimizer';

// Fila de decisão ("O que fazer agora"): achata as análises semanais v2 em uma lista plana
// de recomendações entre contas, cruza com o workflow persistido (ignorado/aplicado/em análise
// humana) e ordena por severidade. Uma decisão por vez na UI.

export const dynamic = 'force-dynamic';

type LogRow = {
  id: string;
  cliente_id: string;
  cliente_nome: string | null;
  conta_plataforma: string | null;
  connection_id: string | null;
  account_id: string | null;
  resultado: OptimizerOutputV2;
  created_at: string;
};

type StatusRow = {
  rec_id: string;
  status: string;
  atribuido_a: string | null;
};

const SEV_RANK: Record<OptimizerRecomendacaoSeveridade, number> = { urgente: 0, atencao: 1, ok: 2 };

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  const lookbackHours = Math.min(Math.max(Number(req.nextUrl.searchParams.get('hours') ?? 200), 1), 336);

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);

    // Última análise semanal (v2) por cliente dentro da janela.
    const params: unknown[] = [lookbackHours];
    const filters = [
      `created_at >= NOW() - ($1::int * INTERVAL '1 hour')`,
      `solicitacao = 'analise_semanal'`,
      `resultado IS NOT NULL`,
    ];
    if (clientId) {
      params.push(clientId);
      filters.push(`cliente_id = $${params.length}`);
    }

    const { rows: logs } = await pool.query<LogRow>(
      `SELECT DISTINCT ON (cliente_id)
          id, cliente_id, cliente_nome, conta_plataforma, connection_id, account_id, resultado, created_at
         FROM public.optimizer_ai_logs
        WHERE ${filters.join(' AND ')}
        ORDER BY cliente_id, created_at DESC`,
      params,
    );

    if (logs.length === 0) {
      return Response.json({ recs: [], contas: [], generated_at: null });
    }

    // Achata todas as recomendações.
    const allRecs: OptimizerRecomendacao[] = [];
    for (const log of logs) {
      const canal: 'meta' | 'google' = log.conta_plataforma === 'google_ads' ? 'google' : 'meta';
      const recs = buildRecomendacoes(log.resultado, {
        analise_id: log.id,
        cliente_id: log.cliente_id,
        cliente_nome: log.cliente_nome ?? log.cliente_id,
        canal,
        connection_id: log.connection_id,
        account_id: log.account_id,
      });
      allRecs.push(...recs);
    }

    // Cruza com o workflow persistido.
    const clienteIds = Array.from(new Set(logs.map((l) => l.cliente_id)));
    const { rows: statusRows } = await pool.query<StatusRow>(
      `SELECT rec_id, status, atribuido_a
         FROM public.optimizer_recomendacao_status
        WHERE cliente_id = ANY($1::text[])`,
      [clienteIds],
    );
    const statusByRec = new Map<string, StatusRow>();
    for (const s of statusRows) statusByRec.set(s.rec_id, s);

    // Filtra ignorado/aplicado; anota em_analise_humana (permanece visível como "aguardando análise").
    const visible = allRecs
      .map((rec) => {
        const st = statusByRec.get(rec.rec_id);
        return { rec, status: st?.status ?? 'pendente', atribuido_a: st?.atribuido_a ?? null };
      })
      .filter((r) => r.status !== 'ignorado' && r.status !== 'aplicado')
      .sort((a, b) => SEV_RANK[a.rec.severidade] - SEV_RANK[b.rec.severidade]);

    // Resumo por conta para o seletor: pior severidade pendente + contagem.
    const contasMap = new Map<string, { cliente_id: string; cliente_nome: string; pior_severidade: OptimizerRecomendacaoSeveridade; pendencias: number }>();
    for (const { rec } of visible) {
      const cur = contasMap.get(rec.cliente_id);
      if (!cur) {
        contasMap.set(rec.cliente_id, { cliente_id: rec.cliente_id, cliente_nome: rec.cliente_nome, pior_severidade: rec.severidade, pendencias: 1 });
      } else {
        cur.pendencias += 1;
        if (SEV_RANK[rec.severidade] < SEV_RANK[cur.pior_severidade]) cur.pior_severidade = rec.severidade;
      }
    }
    const contas = Array.from(contasMap.values()).sort(
      (a, b) => SEV_RANK[a.pior_severidade] - SEV_RANK[b.pior_severidade] || a.cliente_nome.localeCompare(b.cliente_nome),
    );

    const generated_at = logs.reduce<string | null>(
      (acc, l) => (!acc || new Date(l.created_at).getTime() > new Date(acc).getTime() ? l.created_at : acc),
      null,
    );

    return Response.json({
      recs: visible.map((v) => ({ ...v.rec, status: v.status, atribuido_a: v.atribuido_a })),
      contas,
      generated_at,
    });
  } finally {
    await pool.end();
  }
}
