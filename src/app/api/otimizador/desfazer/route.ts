import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerRecStatusTable, type OptimizerAcaoTipo, type OptimizerObjetoTipo } from '@/lib/optimizer';
import { executeOptimizerAction, logExecucao, upsertRecStatus } from '@/lib/optimizer-execucao';

// Reverte uma ação aplicada usando o undo_payload gravado no momento do Aplicar
// (ex: reativar item pausado, restaurar orçamento). Volta a recomendação para pendente.

type DesfazerBody = {
  rec_id: string;
  cliente_id: string;
  autor_id?: string;
  autor_nome?: string;
};

type UndoPayload = {
  canal?: 'meta' | 'google';
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  objeto_nome?: string;
  parametros?: { novo_orcamento_diario?: number; budget_resource_name?: string };
  connection_id?: string;
  account_id?: string | null;
  login_customer_id?: string | null;
};

type StatusRow = { analise_id: string | null; objeto_id: string | null; undo_payload: UndoPayload | null };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as DesfazerBody;
  if (!body.rec_id || !body.cliente_id) {
    return Response.json({ error: 'rec_id e cliente_id são obrigatórios.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);
    const { rows } = await pool.query<StatusRow>(
      `SELECT analise_id, objeto_id, undo_payload FROM public.optimizer_recomendacao_status WHERE rec_id = $1`,
      [body.rec_id],
    );
    const undo = rows[0]?.undo_payload;
    if (!undo || !undo.acao) {
      return Response.json({ ok: false, error: 'Esta ação não pode ser revertida (sem estado anterior gravado).' }, { status: 422 });
    }

    const result = await executeOptimizerAction({
      canal: undo.canal ?? 'meta',
      acao: undo.acao,
      objeto_tipo: undo.objeto_tipo,
      objeto_id: undo.objeto_id,
      parametros: undo.parametros ?? {},
      connection_id: undo.connection_id ?? '',
      account_id: undo.account_id ?? null,
      login_customer_id: undo.login_customer_id ?? null,
    });

    await logExecucao(pool, {
      analise_id: rows[0]?.analise_id,
      client_id: body.cliente_id,
      connection_id: undo.connection_id ?? '',
      objeto_tipo: undo.objeto_tipo,
      objeto_id: undo.objeto_id,
      objeto_nome: undo.objeto_nome ?? '',
      acao: `DESFAZER:${undo.acao}`,
      parametros: undo.parametros ?? {},
      justificativa: 'Reversão manual pelo operador.',
      modo_operacao: '',
      resultado: result.ok ? 'sucesso' : 'erro',
      erro_detalhe: result.error,
    });

    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 502 });

    // Volta para pendente (reaparece na fila) e limpa o undo consumido.
    await upsertRecStatus(pool, {
      rec_id: body.rec_id,
      analise_id: rows[0]?.analise_id,
      cliente_id: body.cliente_id,
      objeto_id: rows[0]?.objeto_id,
      status: 'pendente',
      autor_id: body.autor_id,
      autor_nome: body.autor_nome,
      undo_payload: null,
    });

    return Response.json({ ok: true });
  } finally {
    await pool.end();
  }
}
