import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import {
  listarOrigens, criarOrigem, atualizarOrigem, removerOrigem, listarLog,
} from '@/lib/lp-origens';

/**
 * Configuração dos sites/LPs de um cliente.
 *
 * Autenticação vem do proxy (deny-by-default em /api/*) — esta rota não está
 * em PUBLIC_PREFIXES, então só chega aqui quem tem sessão.
 */

export const runtime = 'nodejs';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const [origens, log] = await Promise.all([listarOrigens(pool, id), listarLog(pool, id)]);
    // A URL é montada com a origem CANÔNICA, nunca com a do request: acessar o
    // painel por um preview geraria uma URL que morre quando o preview morre.
    const base = webhookOrigin(req.url);
    return Response.json({
      origens: origens.map(o => ({ ...o, url_receptora: `${base}/api/integrations/lp/${o.token}` })),
      log,
    });
  } catch (err) {
    console.error('[lp-origens] GET', err);
    return Response.json({ origens: [], log: [] });   // degrada sem quebrar a tela
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const body = await req.json().catch(() => ({}));
    const nome = String(body.nome ?? '').trim();
    if (!nome) return Response.json({ erro: 'Informe um nome para o site' }, { status: 400 });
    const origem = await criarOrigem(pool, id, nome, body.url);
    const base = webhookOrigin(req.url);
    return Response.json({ ...origem, url_receptora: `${base}/api/integrations/lp/${origem.token}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // índice único (client_id, lower(nome)) — nome repetido não distinguiria nada
    if (msg.includes('idx_lp_origens_cliente_nome')) {
      return Response.json({ erro: 'Já existe um site com esse nome neste cliente' }, { status: 409 });
    }
    console.error('[lp-origens] POST', err);
    return Response.json({ erro: 'Não foi possível criar' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ctx.params;
  const pool = makeServerPool();
  try {
    const body = await req.json().catch(() => ({}));
    const origemId = String(body.origemId ?? '');
    if (!origemId) return Response.json({ erro: 'origemId obrigatório' }, { status: 400 });
    await atualizarOrigem(pool, origemId, {
      nome: body.nome, url: body.url, enabled: body.enabled,
    });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[lp-origens] PATCH', err);
    return Response.json({ erro: 'Não foi possível salvar' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await ctx.params;
  const pool = makeServerPool();
  try {
    const origemId = new URL(req.url).searchParams.get('origemId');
    if (!origemId) return Response.json({ erro: 'origemId obrigatório' }, { status: 400 });
    await removerOrigem(pool, origemId);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[lp-origens] DELETE', err);
    return Response.json({ erro: 'Não foi possível remover' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
