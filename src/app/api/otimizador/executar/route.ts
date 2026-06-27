import { randomUUID } from 'crypto';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import type { OptimizerAcaoTipo, OptimizerObjetoTipo, OptimizerModo } from '@/lib/optimizer';

type ExecutarBody = {
  analise_id?: string;
  client_id: string;
  connection_id: string;
  acao: OptimizerAcaoTipo;
  objeto_tipo: OptimizerObjetoTipo;
  objeto_id: string;
  objeto_nome?: string;
  parametros?: { novo_orcamento_diario?: number };
  justificativa?: string;
  modo_operacao?: OptimizerModo;
  dias_ativo?: number;
  min_dias_aprendizado?: number;
};

async function resolveToken(connectionId: string): Promise<string | null> {
  const pool = makeServerPool();
  try {
    // Try exact connection
    if (connectionId) {
      const { rows } = await pool.query(
        `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE id = $1`,
        [connectionId],
      );
      if (rows[0]) return getFreshMetaToken(rows[0] as Parameters<typeof getFreshMetaToken>[0]);
    }
    // Fallback: first active connection in the pool
    const { rows: poolRows } = await pool.query(
      `SELECT id, app_id, access_token, token_expiry FROM public.meta_connections WHERE status = 'connected' ORDER BY connected_at DESC LIMIT 1`,
    );
    if (poolRows[0]) return getFreshMetaToken(poolRows[0] as Parameters<typeof getFreshMetaToken>[0]);
    // Fallback: legacy global integration
    const { rows: legacy } = await pool.query(
      `SELECT 'legacy' AS id, '' AS app_id, access_token, token_expiry
         FROM public.meta_integration WHERE id = 'global' AND status = 'connected' LIMIT 1`,
    );
    if (legacy[0]) return getFreshMetaToken(legacy[0] as Parameters<typeof getFreshMetaToken>[0]);
    return null;
  } finally {
    await pool.end();
  }
}

async function logExecucao(params: {
  analise_id: string | undefined;
  client_id: string;
  connection_id: string;
  objeto_tipo: string;
  objeto_id: string;
  objeto_nome: string;
  acao: string;
  parametros: Record<string, unknown>;
  justificativa: string;
  modo_operacao: string;
  resultado: 'pendente' | 'sucesso' | 'erro';
  erro_detalhe?: string;
}) {
  const pool = makeServerPool();
  try {
    await pool.query(
      `INSERT INTO public.optimizer_execucoes_automaticas
         (analise_id, client_id, connection_id, objeto_tipo, objeto_id, objeto_nome, acao,
          parametros, justificativa, modo_operacao, resultado, erro_detalhe, executado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        params.analise_id ?? null,
        params.client_id,
        params.connection_id,
        params.objeto_tipo,
        params.objeto_id,
        params.objeto_nome,
        params.acao,
        JSON.stringify(params.parametros),
        params.justificativa,
        params.modo_operacao,
        params.resultado,
        params.erro_detalhe ?? null,
      ],
    );
  } catch (err) {
    console.error('[executar][logExecucao]', err);
  } finally {
    await pool.end();
  }
}

async function executeMetaAction(
  acao: OptimizerAcaoTipo,
  objeto_tipo: OptimizerObjetoTipo,
  objeto_id: string,
  parametros: { novo_orcamento_diario?: number },
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const base = `https://graph.facebook.com/v21.0/${objeto_id}`;

  if (acao === 'PAUSAR') {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PAUSED', access_token: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Meta ${res.status}` };
    }
    return { ok: true };
  }

  if (acao === 'ATIVAR') {
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE', access_token: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Meta ${res.status}` };
    }
    return { ok: true };
  }

  if (acao === 'AJUSTAR_ORCAMENTO') {
    if (!parametros.novo_orcamento_diario || parametros.novo_orcamento_diario <= 0) {
      return { ok: false, error: 'novo_orcamento_diario inválido para ajuste de orçamento.' };
    }
    if (objeto_tipo !== 'adset') {
      return { ok: false, error: 'Ajuste de orçamento só é suportado em adsets.' };
    }
    const budgetCents = Math.round(parametros.novo_orcamento_diario * 100);
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_budget: budgetCents, access_token: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, error: err.error?.message ?? `Meta ${res.status}` };
    }
    return { ok: true };
  }

  return { ok: false, error: `Ação desconhecida: ${acao}` };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as ExecutarBody;

  if (!body.client_id || !body.acao || !body.objeto_tipo || !body.objeto_id) {
    return Response.json({ error: 'Campos obrigatórios: client_id, acao, objeto_tipo, objeto_id.' }, { status: 400 });
  }

  // Proteção de aprendizado
  const diasAtivo = body.dias_ativo ?? 999;
  const minDias = body.min_dias_aprendizado ?? 7;
  if (body.acao === 'PAUSAR' && diasAtivo < minDias) {
    return Response.json({
      ok: false,
      error: `Conjunto/anúncio tem apenas ${diasAtivo} dias — mínimo de ${minDias} dias para pausar automaticamente.`,
      bloqueado: true,
    }, { status: 422 });
  }

  const token = await resolveToken(body.connection_id);
  if (!token) {
    await logExecucao({
      analise_id: body.analise_id,
      client_id: body.client_id,
      connection_id: body.connection_id,
      objeto_tipo: body.objeto_tipo,
      objeto_id: body.objeto_id,
      objeto_nome: body.objeto_nome ?? '',
      acao: body.acao,
      parametros: body.parametros ?? {},
      justificativa: body.justificativa ?? '',
      modo_operacao: body.modo_operacao ?? '',
      resultado: 'erro',
      erro_detalhe: 'Token Meta não encontrado.',
    });
    return Response.json({ ok: false, error: 'Token Meta não encontrado.' }, { status: 404 });
  }

  const { ok, error } = await executeMetaAction(
    body.acao,
    body.objeto_tipo,
    body.objeto_id,
    body.parametros ?? {},
    token,
  );

  await logExecucao({
    analise_id: body.analise_id,
    client_id: body.client_id,
    connection_id: body.connection_id,
    objeto_tipo: body.objeto_tipo,
    objeto_id: body.objeto_id,
    objeto_nome: body.objeto_nome ?? '',
    acao: body.acao,
    parametros: body.parametros ?? {},
    justificativa: body.justificativa ?? '',
    modo_operacao: body.modo_operacao ?? '',
    resultado: ok ? 'sucesso' : 'erro',
    erro_detalhe: error,
  });

  if (!ok) return Response.json({ ok: false, error }, { status: 502 });
  return Response.json({ ok: true, execucao_id: randomUUID() });
}
