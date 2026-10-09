import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { escopoValido, gerarLink, listarLinks, revogarLink, TOKEN_REGEX } from '@/lib/formatos-compartilhamento';

// Gestão dos links públicos da biblioteca "Formatos de Criativos" (interno).
// GET = links ativos; POST {escopo: 'todos' | número} = gera (ou devolve o
// ativo do mesmo escopo); DELETE ?token= = desativa na hora.

export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const pool = makeServerPool();
  try {
    return Response.json({ links: await listarLinks(pool) });
  } catch (err) {
    console.error('[formatos links GET]', err);
    return Response.json({ links: [] });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as { escopo?: unknown };
  const escopo = escopoValido(body.escopo);
  if (!escopo) return Response.json({ error: 'escopo inválido' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const { rows: [u] } = await pool
      .query<{ name: string }>('SELECT name FROM public.users WHERE id = $1', [session.uid])
      .catch(() => ({ rows: [] as { name: string }[] }));
    const link = await gerarLink(pool, escopo, { id: session.uid, nome: u?.name ?? null });
    return Response.json({ link, path: `/formatos/${link.token}` });
  } catch (err) {
    console.error('[formatos links POST]', err);
    return Response.json({ error: 'Erro ao gerar link' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function DELETE(req: NextRequest) {
  if (!getSession(req)) return unauthorized();
  const token = req.nextUrl.searchParams.get('token') ?? '';
  if (!TOKEN_REGEX.test(token)) return Response.json({ error: 'token inválido' }, { status: 400 });
  const pool = makeServerPool();
  try {
    return Response.json({ ok: await revogarLink(pool, token) });
  } catch (err) {
    console.error('[formatos links DELETE]', err);
    return Response.json({ error: 'Erro ao desativar' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
