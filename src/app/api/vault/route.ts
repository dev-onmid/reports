import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getSession, unauthorized } from '@/lib/api-auth';
import { linhaVaultPublica } from '@/lib/vault-crypto';

/**
 * Visão global do Cofre (todos os clientes).
 *
 * Era a rota mais perigosa do sistema: `export async function GET()`, sem
 * sequer receber o request, devolvendo login e senha de TODOS os clientes para
 * qualquer visitante. O proxy já barra anônimo, mas a checagem própria fica
 * aqui também — depender de uma camada só significa que um erro de matcher ou
 * uma rota movida reabre tudo de uma vez.
 *
 * ⚠️ Continua devolvendo a senha decifrada para quem TEM sessão: é uma tela de
 * cofre, e mostrar a senha é a função dela. Restringir por DONO (quem pode ver
 * quais clientes) é a fase seguinte, ainda pendente.
 */
export async function GET(req: NextRequest) {
  if (!getSession(req)) return unauthorized();

  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT cv.id::text, cv.client_id, c.name AS client_name,
              cv.title, cv.url, cv.login, cv.password_enc,
              cv.category, cv.notes, cv.created_at, cv.updated_at
       FROM public.client_vault cv
       JOIN public.clients c ON c.id = cv.client_id
       ORDER BY c.name, cv.category, cv.title`
    );
    return Response.json(rows.map(linhaVaultPublica));
  } catch {
    return Response.json([]);
  } finally {
    await pool.end();
  }
}
