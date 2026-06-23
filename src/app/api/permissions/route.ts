import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { PERMISSION_KEYS, defaultPermission, type Permission } from '@/lib/mock-data';

type Pool = ReturnType<typeof makeServerPool>;

async function ensureSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.user_permissions
      ADD COLUMN IF NOT EXISTS crm BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS radar BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS pagamentos BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS disparos BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS luna_ia BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS cofre BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS automacoes BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS logs BOOLEAN NOT NULL DEFAULT FALSE;
  `);

  // One-time backfill so existing users keep the access they already had via role,
  // except `disparos` which is being newly gated and starts opt-in (Administrador only).
  const { rows: migrated } = await pool.query(
    `SELECT 1 FROM public.schema_migrations WHERE name = 'permissions_v2_features'`,
  );
  if (migrated.length === 0) {
    await pool.query(`
      UPDATE public.user_permissions up SET crm = TRUE, radar = TRUE, pagamentos = TRUE, luna_ia = TRUE, cofre = TRUE
        FROM public.users u WHERE u.id = up.user_id AND u.role IN ('Administrador', 'Usuário');
      UPDATE public.user_permissions up SET automacoes = TRUE, logs = TRUE, disparos = TRUE
        FROM public.users u WHERE u.id = up.user_id AND u.role = 'Administrador';
      INSERT INTO public.schema_migrations (name) VALUES ('permissions_v2_features')
        ON CONFLICT (name) DO NOTHING;
    `);
  }
}

export async function GET() {
  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query('SELECT * FROM public.user_permissions');
    const map: Record<string, Permission> = {};
    for (const r of rows) {
      const perm = { ...defaultPermission };
      for (const key of PERMISSION_KEYS) perm[key] = Boolean(r[key]);
      map[r.user_id] = perm;
    }
    return Response.json(map);
  } catch {
    // Distinct from a legitimately empty table: callers fail OPEN on a non-200
    // (see useMyPermissions / AuthGuard) instead of treating it as "no access granted".
    return Response.json({}, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json() as { userId: string } & Partial<Permission>;
  if (!body.userId) return Response.json({ error: 'userId obrigatório' }, { status: 400 });

  const values = PERMISSION_KEYS.map((key) => Boolean(body[key] ?? defaultPermission[key]));
  const columns = PERMISSION_KEYS.join(', ');
  const placeholders = PERMISSION_KEYS.map((_, i) => `$${i + 2}`).join(', ');
  const updates = PERMISSION_KEYS.map((key, i) => `${key} = $${i + 2}`).join(', ');

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    await pool.query(
      `INSERT INTO public.user_permissions (user_id, ${columns})
       VALUES ($1, ${placeholders})
       ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
      [body.userId, ...values],
    );
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
