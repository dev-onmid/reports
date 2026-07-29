import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { requireAdmin, getSession, unauthorized } from '@/lib/api-auth';

type Pool = ReturnType<typeof makeServerPool>;

async function ensureSchema(pool: Pool) {
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'onmid'`);
}

/**
 * O campo `password` NUNCA sai daqui.
 *
 * O parâmetro `?login=1`, que ligava a inclusão da senha, foi removido: a
 * verificação de credencial agora acontece em POST /api/auth/login, no
 * servidor. Nenhum caminho desta rota lê a coluna password.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return { id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, team: r.team ?? 'onmid' };
}

const SAFE_COLUMNS = 'id, name, email, role, status, COALESCE(team, \'onmid\') AS team';

export async function GET(req: NextRequest) {
  // Listar usuários expõe e-mails e papéis: exige sessão, mas não ser admin
  // (a tela de Configurações usa isso pra montar seletores).
  if (!getSession(req)) return unauthorized();

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const { rows } = await pool.query(`SELECT ${SAFE_COLUMNS} FROM public.users ORDER BY name ASC`);
    return Response.json(rows.map(rowToJson));
  } catch {
    return Response.json([], { status: 200 });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  // Criar/editar usuário define papel e senha — escalada de privilégio direta
  // se ficar aberto. Só administrador.
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const body = await req.json() as { id: string; name: string; email: string; password?: string; role: string; status: string; team?: string };
  const team = body.team === 'parceiro' ? 'parceiro' : 'onmid';
  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const hasPassword = typeof body.password === 'string' && body.password.trim().length > 0;
    let rows: Record<string, unknown>[];
    if (hasPassword) {
      // Senha entra hasheada; texto puro nunca é gravado.
      const hashed = await hashPassword(body.password as string);
      ({ rows } = await pool.query(
        `INSERT INTO public.users (id, name, email, password, role, status, team)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name=$2, email=$3, password=$4, role=$5, status=$6, team=$7
         RETURNING ${SAFE_COLUMNS}`,
        [body.id, body.name, body.email, hashed, body.role, body.status, team]
      ));
    } else {
      // Update sem tocar na senha existente.
      ({ rows } = await pool.query(
        `INSERT INTO public.users (id, name, email, password, role, status, team)
         VALUES ($1, $2, $3, '', $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name=$2, email=$3, role=$4, status=$5, team=$6
         RETURNING ${SAFE_COLUMNS}`,
        [body.id, body.name, body.email, body.role, body.status, team]
      ));
    }
    return Response.json(rowToJson(rows[0]), { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });
  if (id === auth.userId) {
    return Response.json({ error: 'Não é possível excluir o próprio usuário.' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.users WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
