import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { requireAdmin, getSession, unauthorized } from '@/lib/api-auth';

type Pool = ReturnType<typeof makeServerPool>;

async function ensureSchema(pool: Pool) {
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT 'onmid'`);
  // `setor` decide quem recebe a tarefa de uma reunião: tráfego vai pro gestor
  // da conta, social vai pro setor inteiro. NULL = não participa desse rateio.
  await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS setor TEXT').catch(() => {});
  // ID numérico do membro no ClickUp — único identificador aceito em `assignees`.
  await pool.query('ALTER TABLE public.users ADD COLUMN IF NOT EXISTS clickup_id TEXT').catch(() => {});
}

/** Só estes valores são gravados; qualquer outra coisa vira NULL. */
export const SETORES = ['trafego', 'social'] as const;
function normalizeSetor(v: unknown): string | null {
  return typeof v === 'string' && (SETORES as readonly string[]).includes(v) ? v : null;
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
  return {
    id: r.id, name: r.name, email: r.email, role: r.role, status: r.status, team: r.team ?? 'onmid',
    setor: r.setor ?? null, clickup_id: r.clickup_id ?? null,
  };
}

const SAFE_COLUMNS = 'id, name, email, role, status, COALESCE(team, \'onmid\') AS team, setor, clickup_id';

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

  const body = await req.json() as {
    id: string; name: string; email: string; password?: string; role: string; status: string;
    team?: string; setor?: string | null; clickup_id?: string | null;
  };
  const team = body.team === 'parceiro' ? 'parceiro' : 'onmid';
  // Chave ausente = não mexer no valor atual; chave presente com null = limpar.
  // Sem essa distinção, todo caller antigo (que não conhece os campos novos)
  // apagaria o setor e o ClickUp ID do usuário ao salvar.
  const touchSetor = 'setor' in body;
  const setor = normalizeSetor(body.setor);
  const touchClickup = 'clickup_id' in body;
  const clickupId = typeof body.clickup_id === 'string' && body.clickup_id.trim() ? body.clickup_id.trim() : null;

  const pool = makeServerPool();
  try {
    await ensureSchema(pool);
    const hasPassword = typeof body.password === 'string' && body.password.trim().length > 0;
    // Senha entra hasheada; texto puro nunca é gravado.
    const hashed = hasPassword ? await hashPassword(body.password as string) : '';

    // As duas variantes compartilham as MESMAS 11 posições — a única diferença é
    // se o UPDATE toca em `password`. Numeração divergente entre elas já foi
    // fonte de bug (o $8 caindo no valor errado).
    const params = [
      body.id, body.name, body.email, hashed, body.role, body.status, team,
      touchSetor, setor, touchClickup, clickupId,
    ];
    const onConflict = [
      'name=$2', 'email=$3', ...(hasPassword ? ['password=$4'] : []), 'role=$5', 'status=$6', 'team=$7',
      'setor = CASE WHEN $8::boolean THEN $9 ELSE users.setor END',
      'clickup_id = CASE WHEN $10::boolean THEN $11 ELSE users.clickup_id END',
    ].join(', ');

    const { rows } = await pool.query(
      `INSERT INTO public.users (id, name, email, password, role, status, team, setor, clickup_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $9, $11)
       ON CONFLICT (id) DO UPDATE SET ${onConflict}
       RETURNING ${SAFE_COLUMNS}`,
      params,
    );
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
