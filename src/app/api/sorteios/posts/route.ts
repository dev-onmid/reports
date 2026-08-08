import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolveContaDoCliente, listarPosts } from '@/lib/sorteio-fonte';

// Sorteador — lista os ~30 posts recentes do Instagram e do Facebook do
// cliente (com contagem de comentários) pro usuário escolher qual sortear.
// Auth = deny-by-default do proxy.

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const clientId = req.nextUrl.searchParams.get('clientId') ?? '';
  if (!clientId) return Response.json({ error: 'clientId obrigatório.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const conta = await resolveContaDoCliente(pool, clientId);
    if (!conta) {
      return Response.json({
        ok: false,
        error: 'Não achei a conta de Instagram/Facebook deste cliente. Vincule a conta em Clientes → Vincular Contas.',
      });
    }
    const posts = await listarPosts(conta);
    return Response.json({
      ok: true,
      conta: { username: conta.username, picture: conta.picture, pageName: conta.pageName },
      posts,
    });
  } catch {
    return Response.json({ ok: false, error: 'Falha ao buscar os posts — tente de novo.' });
  } finally {
    await pool.end();
  }
}
