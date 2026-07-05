import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureOptimizerRecStatusTable, type OptimizerAcaoTipo, type OptimizerObjetoTipo } from '@/lib/optimizer';
import { executeOptimizerAction, logExecucao, upsertRecStatus } from '@/lib/optimizer-execucao';

// Ação em lote: aplica a MESMA ação (mesmo `padrao`) em várias contas de uma vez.
// Cada item traz os dados da sua conta/objeto. Retorna sucesso/erro por item.

type LoteItem = {
  rec_id: string;
  analise_id?: string;
  canal?: 'meta' | 'google';
  cliente_id: string;
  cliente_nome?: string;
  connection_id: string;
  account_id?: string;
  login_customer_id?: string;
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  objeto_nome?: string;
  parametros?: { novo_orcamento_diario?: number; budget_resource_name?: string };
  justificativa?: string;
  modo_operacao?: string;
  dias_ativo?: number;
  min_dias_aprendizado?: number;
};

type LoteBody = { itens: LoteItem[]; autor_id?: string; autor_nome?: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as LoteBody;
  if (!Array.isArray(body.itens) || body.itens.length === 0) {
    return Response.json({ error: 'itens (array) é obrigatório.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    await ensureOptimizerRecStatusTable(pool);
    const results: Array<{ rec_id: string; cliente_id: string; ok: boolean; error?: string }> = [];

    for (const item of body.itens) {
      if (!item.cliente_id || !item.acao || !item.objeto_tipo || !item.objeto_id) {
        results.push({ rec_id: item.rec_id, cliente_id: item.cliente_id, ok: false, error: 'campos obrigatórios faltando.' });
        continue;
      }
      // Proteção de aprendizado (mesma regra do executar).
      const diasAtivo = item.dias_ativo ?? 999;
      const minDias = item.min_dias_aprendizado ?? 7;
      if (item.acao === 'PAUSAR' && diasAtivo < minDias) {
        results.push({ rec_id: item.rec_id, cliente_id: item.cliente_id, ok: false, error: `Em aprendizado (${diasAtivo}/${minDias} dias).` });
        continue;
      }

      const canal = item.canal ?? 'meta';
      const parametros = item.parametros ?? {};
      const res = await executeOptimizerAction({
        canal,
        acao: item.acao,
        objeto_tipo: item.objeto_tipo,
        objeto_id: item.objeto_id,
        parametros,
        connection_id: item.connection_id,
        account_id: item.account_id,
        login_customer_id: item.login_customer_id,
      });

      await logExecucao(pool, {
        analise_id: item.analise_id,
        client_id: item.cliente_id,
        connection_id: item.connection_id,
        objeto_tipo: item.objeto_tipo,
        objeto_id: item.objeto_id,
        objeto_nome: item.objeto_nome ?? '',
        acao: item.acao,
        parametros,
        justificativa: item.justificativa ?? 'Ação em lote.',
        modo_operacao: item.modo_operacao ?? '',
        resultado: res.ok ? 'sucesso' : 'erro',
        erro_detalhe: res.error,
      });

      if (res.ok && item.rec_id) {
        await upsertRecStatus(pool, {
          rec_id: item.rec_id,
          analise_id: item.analise_id,
          cliente_id: item.cliente_id,
          objeto_id: item.objeto_id,
          status: 'aplicado',
          autor_id: body.autor_id,
          autor_nome: body.autor_nome,
          undo_payload: res.undo
            ? {
                canal, acao: res.undo.acao, objeto_tipo: item.objeto_tipo, objeto_id: item.objeto_id,
                objeto_nome: item.objeto_nome ?? '', parametros: res.undo.parametros,
                connection_id: item.connection_id, account_id: item.account_id ?? null,
                login_customer_id: item.login_customer_id ?? null,
              }
            : null,
        });
      }

      results.push({ rec_id: item.rec_id, cliente_id: item.cliente_id, ok: res.ok, error: res.error });
    }

    const ok_count = results.filter((r) => r.ok).length;
    return Response.json({ ok: true, ok_count, erros: results.length - ok_count, results });
  } finally {
    await pool.end();
  }
}
