import { makeServerPool } from '@/lib/server-db';
import { verifyPassword, hashPassword } from '@/lib/password';
import { createSessionToken, sessionCookieHeader, sessionSecretMissing } from '@/lib/session';

/**
 * Login server-side.
 *
 * Substitui o modelo antigo, em que o browser baixava TODAS as senhas via
 * GET /api/users?login=1 e comparava localmente. Aqui a senha nunca sai do
 * servidor e a resposta nunca contém o campo password.
 */
export async function POST(req: Request) {
  if (sessionSecretMissing()) {
    // Sem segredo não há como assinar sessão. Erro alto e explícito em vez de
    // deixar entrar sem sessão válida.
    return Response.json(
      { error: 'SESSION_SECRET não configurado no servidor.' },
      { status: 500 },
    );
  }

  let email: string, password: string;
  try {
    const body = await req.json() as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return Response.json({ error: 'Credenciais inválidas.' }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
    password = body.password;
  } catch {
    return Response.json({ error: 'Requisição inválida.' }, { status: 400 });
  }

  // Mensagem única pra e-mail inexistente, senha errada e usuário inativo:
  // respostas distintas permitiriam enumerar quem tem conta.
  const deny = () => Response.json({ error: 'E-mail ou senha inválidos, ou usuário inativo.' }, { status: 401 });

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, password, role, status, COALESCE(team, 'onmid') AS team
         FROM public.users
        WHERE LOWER(TRIM(email)) = $1
        LIMIT 1`,
      [email],
    );
    const user = rows[0];
    if (!user) return deny();

    const { ok, needsRehash } = await verifyPassword(password, user.password);
    if (!ok) return deny();
    if (user.status !== 'Ativo') return deny();

    // Migração transparente: a conta guardava a senha em texto puro (ou com
    // parâmetros de hash antigos) e acabou de provar que sabe a senha — este é
    // o único momento em que dá pra converter sem pedir nada ao usuário.
    if (needsRehash) {
      try {
        await pool.query('UPDATE public.users SET password = $1 WHERE id = $2', [await hashPassword(password), user.id]);
      } catch {
        // Falha na conversão não pode impedir o login legítimo; a próxima
        // tentativa converte.
      }
    }

    const token = createSessionToken({ uid: String(user.id), role: user.role, team: user.team });
    if (!token) return Response.json({ error: 'Falha ao criar sessão.' }, { status: 500 });

    return Response.json(
      {
        userId: String(user.id),
        name: user.name,
        email: user.email,
        role: user.role,
        team: user.team,
      },
      { headers: { 'Set-Cookie': sessionCookieHeader(token) } },
    );
  } catch {
    return Response.json({ error: 'Erro ao autenticar.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}
