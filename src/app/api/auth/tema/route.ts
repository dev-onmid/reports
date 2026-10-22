import { makeServerPool } from '@/lib/server-db';
import { readSession } from '@/lib/session';

/**
 * Guarda o tema (claro/escuro) NA CONTA da pessoa.
 *
 * Antes a escolha do sol/lua vivia só no localStorage: trocar de navegador
 * ou limpar o cache voltava para o escuro. Pedido do Matheus (2026-10-22):
 * "se clicou uma vez em claro, tem que ficar claro sempre que ele entrar".
 * A coluna `users.tema` nasce no `garantirColunasLogin` do login (memoizado)
 * e foi criada em produção à mão antes do deploy — esta rota NÃO roda DDL
 * (lição do ALTER em caminho quente de 16/09).
 */
export async function PATCH(req: Request) {
  const session = readSession(req);
  if (!session) return Response.json({ error: 'Não autenticado.' }, { status: 401 });
  const body = await req.json().catch(() => null) as { tema?: unknown } | null;
  const tema = body?.tema;
  if (tema !== 'light' && tema !== 'dark') {
    return Response.json({ error: 'tema inválido' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await pool.query('UPDATE public.users SET tema = $1 WHERE id = $2', [tema, session.uid]);
    return Response.json({ ok: true, tema });
  } catch {
    return Response.json({ error: 'indisponivel' }, { status: 503 });
  } finally {
    await pool.end();
  }
}
