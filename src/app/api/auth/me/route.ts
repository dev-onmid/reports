import { makeServerPool } from '@/lib/server-db';
import { readSession } from '@/lib/session';

/**
 * Fonte de verdade da sessão para o cliente.
 *
 * O localStorage continua existindo por conveniência de UI, mas deixou de ser
 * autoridade: quem manda é o cookie assinado, e role/team são relidos do banco
 * a cada chamada — assim, rebaixar um usuário tem efeito imediato, sem esperar
 * o token de 7 dias expirar.
 */
export async function GET(req: Request) {
  const session = readSession(req);
  if (!session) return Response.json({ error: 'Não autenticado.' }, { status: 401 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, role, status, COALESCE(team, 'onmid') AS team
         FROM public.users WHERE id = $1 LIMIT 1`,
      [session.uid],
    );
    const user = rows[0];
    if (!user || user.status !== 'Ativo') {
      return Response.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    return Response.json({
      userId: String(user.id), name: user.name, email: user.email, role: user.role, team: user.team,
    });
  } catch {
    // auditoria 2026-08-22: falha de banco NÃO é sessão inválida. Devolver 401
    // aqui deslogava todo mundo sempre que o Postgres piscava; 503 deixa o
    // cliente distinguir "indisponível" (tentar de novo) de "expirou" (relogar).
    return Response.json({ error: 'indisponivel' }, { status: 503 });
  } finally {
    await pool.end();
  }
}
