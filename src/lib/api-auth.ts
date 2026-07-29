import { makeServerPool } from '@/lib/server-db';
import { readSession, type SessionPayload } from '@/lib/session';

/**
 * Autorização dentro da rota, independente do proxy.
 *
 * O proxy já barra quem não tem sessão, mas rotas sensíveis não devem depender
 * só dele: um erro de matcher, uma rota movida ou um deploy parcial voltariam a
 * expor tudo. Aqui a sessão é relida e verificada do zero.
 */

export type Caller = { session: SessionPayload; role: string; team: string };

/** Sessão válida (assinatura + expiração), sem consultar o banco. */
export function getSession(req: Request): SessionPayload | null {
  return readSession(req);
}

export function unauthorized() {
  return Response.json({ error: 'Não autenticado.' }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: 'Sem permissão.' }, { status: 403 });
}

/**
 * Confirma no BANCO que o usuário da sessão é Administrador e está ativo.
 *
 * Não usa o `role` de dentro do token: o token vale 7 dias, e um usuário
 * rebaixado nesse intervalo continuaria carregando "Administrador" numa
 * assinatura válida. Para uma ação destrutiva, vale o estado atual.
 */
export async function requireAdmin(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const session = readSession(req);
  if (!session) return { ok: false, response: unauthorized() };

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      'SELECT role, status FROM public.users WHERE id = $1 LIMIT 1',
      [session.uid],
    );
    const user = rows[0];
    if (!user || user.status !== 'Ativo' || user.role !== 'Administrador') {
      return { ok: false, response: forbidden() };
    }
    return { ok: true, userId: session.uid };
  } catch {
    // Erro de banco não concede permissão.
    return { ok: false, response: forbidden() };
  } finally {
    await pool.end();
  }
}
