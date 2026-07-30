import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { listar, contadores, marcarNotificacoes, type FiltroFeed } from '@/lib/notificacoes';

function filtroDe(v: string | null): FiltroFeed {
  return v === 'importantes' || v === 'lidas' ? v : 'todas';
}

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  const pool = makeServerPool();
  try {
    const filtro = filtroDe(req.nextUrl.searchParams.get('filtro'));
    const [itens, cont] = await Promise.all([
      listar(pool, session.uid, filtro, Number(req.nextUrl.searchParams.get('limit') ?? 60)),
      contadores(pool, session.uid),
    ]);
    return Response.json({ itens, contadores: cont, filtro });
  } catch {
    // Degrada graciosa: o painel some, o resto do Início continua de pé.
    return Response.json({ itens: [], contadores: { naoLidas: 0, importantes: 0 }, filtro: 'todas' });
  } finally {
    await pool.end();
  }
}

/**
 * Marca lida/importante.
 *
 * O escopo ao usuário da sessão fica DENTRO do UPDATE (ver `marcarNotificacoes`)
 * — checar aqui e confiar no id depois deixaria qualquer um marcar a
 * notificação de outra pessoa.
 */
export async function PATCH(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();

  const body = await req.json().catch(() => ({})) as {
    ids?: unknown; id?: unknown; lida?: unknown; importante?: unknown;
  };
  const brutos = Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : [];
  const ids = brutos.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (!ids.length) return Response.json({ error: 'ids obrigatório.' }, { status: 400 });

  const patch: { lida?: boolean; importante?: boolean } = {};
  if (typeof body.lida === 'boolean') patch.lida = body.lida;
  if (typeof body.importante === 'boolean') patch.importante = body.importante;
  if (!Object.keys(patch).length) {
    return Response.json({ error: 'Informe lida e/ou importante.' }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const alteradas = await marcarNotificacoes(pool, session.uid, ids, patch);
    return Response.json({ ok: true, alteradas, contadores: await contadores(pool, session.uid) });
  } finally {
    await pool.end();
  }
}
