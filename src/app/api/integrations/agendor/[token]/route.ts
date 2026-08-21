import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { extrairEventoAgendor } from '@/lib/agendor';
import {
  conexaoAgendorPorToken, ensureAgendorSchema, registrarLogAgendor,
} from '@/lib/agendor-server';
import { buscarPessoaAgendor, conferirFiltros, ingerirNegocioAgendor, posProcessarIngestao } from '@/lib/agendor-ingest';

/**
 * Receptor do webhook do Agendor — um token POR CLIENTE na URL.
 *
 * As assinaturas são criadas por API na conexão (rota de config), apontando
 * pra cá. Só eventos de NEGÓCIO são assinados; payload de pessoa que chegar é
 * logado como 'ignorado' em vez de virar lead (pessoa sem negócio não é lead
 * de funil).
 *
 * Mesma filosofia de resposta do Datalytics: payload ruim → 200 ok:false
 * (retry não conserta payload); erro nosso → 500; cru SEMPRE no agendor_log —
 * o ENVELOPE do webhook deles não é documentado, o log é como se descobre.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  try {
    const raw: unknown = await req.json().catch(async () => {
      const texto = await req.text().catch(() => '');
      return { _raw: texto };
    });

    const conn = await conexaoAgendorPorToken(pool, token);
    if (!conn) {
      await registrarLogAgendor(pool, { clientId: null, raw, resultado: 'token_invalido' });
      return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    }
    if (!conn.enabled) {
      await registrarLogAgendor(pool, { clientId: conn.client_id, raw, resultado: 'desativado' });
      return Response.json({ ok: false, erro: 'integracao_desativada' }, { status: 403 });
    }

    await pool.query(
      `UPDATE public.agendor_connections SET last_received_at = NOW() WHERE id = $1`,
      [conn.id],
    ).catch(() => {});

    const evento = extrairEventoAgendor(raw);
    if (evento.tipo !== 'negocio') {
      await registrarLogAgendor(pool, {
        clientId: conn.client_id, raw, resultado: 'ignorado',
        detalhe: evento.tipo === 'pessoa'
          ? 'payload de pessoa (só negócios viram lead)'
          : `payload sem negócio reconhecível (evento: ${evento.evento ?? '—'})`,
      });
      return Response.json({ ok: false, erro: 'sem_negocio' });
    }

    // O negócio referencia a pessoa sem telefone — busca o cadastro completo
    // com o token do cliente. Falha aqui não derruba a ingestão.
    const tentouPessoa = Boolean(conn.api_token && evento.negocio.pessoa.id);
    const pessoa = tentouPessoa
      ? await buscarPessoaAgendor(conn.api_token!, evento.negocio.pessoa.id!)
      : null;

    // Filtros de importação do cliente (funil/origem escolhidos no card).
    // pessoaFalhou: origem desconhecida por erro passa (não barrar por 429).
    const { negocio, bloqueado } = await conferirFiltros(
      conn, evento.negocio, pessoa, tentouPessoa && pessoa === null);
    if (bloqueado) {
      await registrarLogAgendor(pool, {
        clientId: conn.client_id, raw, resultado: 'filtrado', detalhe: bloqueado,
      });
      return Response.json({ ok: true, resultado: 'filtrado' });
    }

    const r = await ingerirNegocioAgendor(pool, conn.client_id, negocio, pessoa);
    await posProcessarIngestao(pool, conn, negocio, pessoa, r, raw,
      r.criado ? 'criado' : 'atualizado');

    return Response.json({ ok: true, resultado: r.criado ? 'criado' : 'atualizado', leadId: r.leadId });
  } catch (err) {
    console.error('[agendor] erro na recepção', err);
    await registrarLogAgendor(pool, {
      clientId: null, raw: { erro: true },
      resultado: 'erro', detalhe: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
    return Response.json({ ok: false, erro: 'interno' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

/** Teste de conectividade sem efeito colateral. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const pool = makeServerPool();
  try {
    await ensureAgendorSchema(pool);
    const conn = await conexaoAgendorPorToken(pool, token);
    if (!conn) return Response.json({ ok: false, erro: 'token_invalido' }, { status: 401 });
    await registrarLogAgendor(pool, { clientId: conn.client_id, raw: { teste: 'GET' }, resultado: 'teste_get' });
    return Response.json({ ok: true, integracao: 'agendor', cliente: conn.client_id, ativa: conn.enabled });
  } finally {
    await pool.end();
  }
}
