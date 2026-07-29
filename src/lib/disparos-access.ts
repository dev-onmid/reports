import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { readSession } from '@/lib/session';

export type CallerScope = {
  userId: string | null;
  /** Administrador role or 'onmid' team — sees every instance/campaign. */
  unrestricted: boolean;
};

/**
 * Regra de visibilidade: Administrador ou time 'onmid' vê tudo; 'parceiro' vê
 * só o que criou.
 *
 * A identidade vem do COOKIE DE SESSÃO ASSINADO, não mais do header
 * `x-onmid-user-id`. O header era declarado pelo próprio cliente, então
 * qualquer um mandava o id de um admin e ficava irrestrito — esta função
 * parecia um guard, mas era só um filtro de dados.
 *
 * O header segue como fallback porque o proxy o SOBRESCREVE com o valor do
 * cookie verificado antes da rota rodar; ele nunca carrega mais o que o
 * cliente mandou. Identidade ausente ou irresolvível falha FECHADO.
 */
export async function getCallerScope(
  req: NextRequest,
  pool: ReturnType<typeof makeServerPool>,
): Promise<CallerScope> {
  const userId = readSession(req)?.uid ?? req.headers.get('x-onmid-user-id');
  if (!userId) return { userId: null, unrestricted: false };
  try {
    const { rows: [user] } = await pool.query('SELECT role, team FROM public.users WHERE id = $1', [userId]);
    if (!user) return { userId, unrestricted: false };
    // Explicit allowlist: only Administrador role or explicitly-tagged 'onmid' team
    // members are unrestricted. NULL team (legacy rows) and 'parceiro' are scoped.
    return { userId, unrestricted: user.role === 'Administrador' || user.team === 'onmid' };
  } catch {
    return { userId, unrestricted: false };
  }
}
