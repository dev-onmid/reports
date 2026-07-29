import { makeServerPool } from '@/lib/server-db';
import { verifyPassword, hashPassword } from '@/lib/password';
import { getSession, unauthorized } from '@/lib/api-auth';

/**
 * Reconfirmação de senha antes de uma ação sensível (ex: mudar status de
 * cliente). NÃO cria sessão — só responde se a credencial confere.
 *
 * Exige sessão válida de propósito: sem isso, seria um oráculo público pra
 * testar e-mail+senha de qualquer conta, que é justamente o que a rota antiga
 * de login virou.
 */
export async function POST(req: Request) {
  if (!getSession(req)) return unauthorized();

  let email: string, password: string;
  try {
    const body = await req.json() as { email?: unknown; password?: unknown };
    if (typeof body.email !== 'string' || typeof body.password !== 'string') {
      return Response.json({ ok: false }, { status: 400 });
    }
    email = body.email.trim().toLowerCase();
    password = body.password;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, password, role, status FROM public.users WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
      [email],
    );
    const user = rows[0];
    if (!user) return Response.json({ ok: false }, { status: 200 });

    const { ok, needsRehash } = await verifyPassword(password, user.password);
    if (!ok || user.status !== 'Ativo') return Response.json({ ok: false }, { status: 200 });

    if (needsRehash) {
      try {
        await pool.query('UPDATE public.users SET password = $1 WHERE id = $2', [await hashPassword(password), user.id]);
      } catch { /* conversão é best-effort */ }
    }

    return Response.json({ ok: true, role: user.role });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  } finally {
    await pool.end();
  }
}
