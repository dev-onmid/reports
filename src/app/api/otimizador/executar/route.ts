import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerRecStatusTable } from '@/lib/optimizer';
import { executeOptimizerAction, logExecucao, upsertRecStatus } from '@/lib/optimizer-execucao';
import type { OptimizerAcaoTipo, OptimizerObjetoTipo, OptimizerModo } from '@/lib/optimizer';

type ExecutarBody = {
  analise_id?: string;
  rec_id?: string;                 // opcional: persiste o workflow da recomendação
  canal?: 'meta' | 'google';
  client_id: string;
  connection_id: string;
  account_id?: string;             // Google: customer id
  login_customer_id?: string;      // Google: MCC
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  objeto_nome?: string;
  parametros?: { novo_orcamento_diario?: number; budget_resource_name?: string };
  justificativa?: string;
  modo_operacao?: OptimizerModo;
  dias_ativo?: number;
  min_dias_aprendizado?: number;
  autor_id?: string;
  autor_nome?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as ExecutarBody;

  if (!body.client_id || !body.acao || !body.objeto_tipo || !body.objeto_id) {
    return Response.json({ error: 'Campos obrigatórios: client_id, acao, objeto_tipo, objeto_id.' }, { status: 400 });
  }

  // Proteção de aprendizado: não pausa objeto que ainda está aprendendo.
  const diasAtivo = body.dias_ativo ?? 999;
  const minDias = body.min_dias_aprendizado ?? 7;
  if (body.acao === 'PAUSAR' && diasAtivo < minDias) {
    return Response.json({
      ok: false,
      error: `Conjunto/anúncio tem apenas ${diasAtivo} dias — mínimo de ${minDias} dias para pausar.`,
      bloqueado: true,
    }, { status: 422 });
  }

  const canal = body.canal ?? 'meta';
  const parametros = body.parametros ?? {};

  const result = await executeOptimizerAction({
    canal,
    acao: body.acao,
    objeto_tipo: body.objeto_tipo,
    objeto_id: body.objeto_id,
    parametros,
    connection_id: body.connection_id,
    account_id: body.account_id,
    login_customer_id: body.login_customer_id,
  });

  const pool = makeServerPool();
  try {
    await logExecucao(pool, {
      analise_id: body.analise_id,
      client_id: body.client_id,
      connection_id: body.connection_id,
      objeto_tipo: body.objeto_tipo,
      objeto_id: body.objeto_id,
      objeto_nome: body.objeto_nome ?? '',
      acao: body.acao,
      parametros,
      justificativa: body.justificativa ?? '',
      modo_operacao: body.modo_operacao ?? '',
      resultado: result.ok ? 'sucesso' : 'erro',
      erro_detalhe: result.error,
    });

    if (result.ok && body.rec_id) {
      await ensureOptimizerRecStatusTable(pool);
      await upsertRecStatus(pool, {
        rec_id: body.rec_id,
        analise_id: body.analise_id,
        cliente_id: body.client_id,
        objeto_id: body.objeto_id,
        status: 'aplicado',
        autor_id: body.autor_id,
        autor_nome: body.autor_nome,
        // Guarda a ação inversa para o "Desfazer".
        undo_payload: result.undo
          ? {
              canal,
              acao: result.undo.acao,
              objeto_tipo: body.objeto_tipo,
              objeto_id: body.objeto_id,
              objeto_nome: body.objeto_nome ?? '',
              parametros: result.undo.parametros,
              connection_id: body.connection_id,
              account_id: body.account_id ?? null,
              login_customer_id: body.login_customer_id ?? null,
            }
          : null,
      });
    }
  } finally {
    await pool.end();
  }

  if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: 502 });
  return Response.json({ ok: true, execucao_id: randomUUID(), pode_desfazer: !!result.undo });
}
