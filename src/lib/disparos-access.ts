import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export type CallerScope = {
  userId: string | null;
  /** Administrador role or 'onmid' team — sees every instance/campaign. */
  unrestricted: boolean;
};

/**
 * Disparos visibility rule: Administrador role or 'onmid' team sees everything;
 * 'parceiro' team sees only the instances/campaigns they created.
 *
 * Caller identity is self-reported by the client via the x-onmid-user-id header
 * (set from the localStorage session in src/lib/auth-store.ts) — this app has no
 * server-side session of its own, so this matches the trust model already used
 * everywhere else (e.g. /api/permissions). Missing or unresolvable identity fails
 * CLOSED (unrestricted: false, userId: null), which makes every owner_id-scoped
 * query below return zero rows rather than risk leaking another partner's data.
 */
export async function getCallerScope(
  req: NextRequest,
  pool: ReturnType<typeof makeServerPool>,
): Promise<CallerScope> {
  const userId = req.headers.get('x-onmid-user-id');
  if (!userId) return { userId: null, unrestricted: false };
  try {
    const { rows: [user] } = await pool.query('SELECT role, team FROM public.users WHERE id = $1', [userId]);
    if (!user) return { userId, unrestricted: false };
    return { userId, unrestricted: user.role === 'Administrador' || user.team !== 'parceiro' };
  } catch {
    return { userId, unrestricted: false };
  }
}
