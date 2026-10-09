import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { hashPassword } from '@/lib/password';
import { esquecerAcesso } from '@/lib/acesso';

/**
 * O GESTOR do cliente cadastra a própria equipe (2026-10-10, decisão do
 * Matheus): a Onmid cria só o gestor; quem contrata/demite atendente é a
 * clínica. Travas, todas conferidas aqui de novo (o proxy já prende o
 * `clientId` ao do chamador):
 * - só quem tem `perfil_cliente = 'gestor'` (header que o proxy escreve do banco);
 * - só cria ATENDENTE, nunca gestor, nunca Administrador, nunca de outro time;
 * - só mexe em usuário cujo ÚNICO cliente é o dele — um atendente que a Onmid
 *   tenha ligado a duas unidades fica fora do alcance de cada gestor;
 * - nunca mexe em si mesmo (não se desativa por engano).
 */
type Pool = ReturnType<typeof makeServerPool>;

function chamadorGestor(req: NextRequest): { id: string; clientes: string[] } | null {
  if (req.headers.get('x-onmid-team') !== 'cliente' || req.headers.get('x-onmid-perfil') !== 'gestor') return null;
  const id = req.headers.get('x-onmid-user-id') ?? '';
  const clientes = (req.headers.get('x-onmid-clientes') ?? '').split(',').filter(Boolean);
  return id ? { id, clientes } : null;
}

const SELECT = `id, name, email, status, COALESCE(perfil_cliente, 'atendente') AS perfil, created_at`;

async function ensure(pool: Pool) {
  await pool.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`).catch(() => null);
}

export async function GET(req: NextRequest) {
  const quem = chamadorGestor(req);
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!quem || !clientId || !quem.clientes.includes(clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  const pool = makeServerPool();
  try {
    await ensure(pool);
    const { rows } = await pool.query(
      `SELECT ${SELECT} FROM public.users WHERE team = 'cliente' AND $1 = ANY(client_ids) ORDER BY perfil_cliente, name`,
      [clientId],
    );
    return Response.json({ equipe: rows.map(r => ({ ...r, souEu: String(r.id) === quem.id, editavel: String(r.id) !== quem.id && r.perfil === 'atendente' })) });
  } finally {
    await pool.end();
  }
}

function emailValido(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 160;
}

export async function POST(req: NextRequest) {
  const quem = chamadorGestor(req);
  const body = await req.json().catch(() => ({})) as { clientId?: string; name?: string; email?: string; password?: string };
  if (!quem || !body.clientId || !quem.clientes.includes(body.clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  const name = String(body.name ?? '').trim().slice(0, 120);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!name || !emailValido(email)) return Response.json({ error: 'Informe nome e e-mail válidos.' }, { status: 400 });
  if (password.length < 8) return Response.json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensure(pool);
    const { rowCount } = await pool.query(`SELECT 1 FROM public.users WHERE LOWER(TRIM(email)) = $1`, [email]);
    if (rowCount) return Response.json({ error: 'Já existe um usuário com este e-mail.' }, { status: 409 });
    const id = String(Date.now());
    const { rows: [u] } = await pool.query(
      `INSERT INTO public.users (id, name, email, password, role, status, team, client_ids, perfil_cliente)
       VALUES ($1, $2, $3, $4, 'Usuário', 'Ativo', 'cliente', $5::text[], 'atendente')
       RETURNING ${SELECT}`,
      [id, name, email, await hashPassword(password), [body.clientId]],
    );
    return Response.json({ ...u, editavel: true, souEu: false }, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const quem = chamadorGestor(req);
  const body = await req.json().catch(() => ({})) as { clientId?: string; userId?: string; status?: string; password?: string; name?: string };
  if (!quem || !body.clientId || !quem.clientes.includes(body.clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  if (!body.userId || body.userId === quem.id) return Response.json({ error: 'Usuário inválido.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    await ensure(pool);
    // Alvo: atendente cujo único cliente é o deste gestor.
    const { rows: [alvo] } = await pool.query(
      `SELECT id FROM public.users
        WHERE id = $1 AND team = 'cliente' AND COALESCE(perfil_cliente, 'atendente') = 'atendente'
          AND client_ids = $2::text[]`,
      [body.userId, [body.clientId]],
    );
    if (!alvo) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    const sets: string[] = []; const vals: unknown[] = [body.userId];
    if (body.status === 'Ativo' || body.status === 'Inativo') { vals.push(body.status); sets.push(`status = $${vals.length}`); }
    if (typeof body.name === 'string' && body.name.trim()) { vals.push(body.name.trim().slice(0, 120)); sets.push(`name = $${vals.length}`); }
    if (typeof body.password === 'string' && body.password) {
      if (body.password.length < 8) return Response.json({ error: 'A senha precisa ter pelo menos 8 caracteres.' }, { status: 400 });
      vals.push(await hashPassword(body.password)); sets.push(`password = $${vals.length}`);
    }
    if (sets.length === 0) return Response.json({ error: 'Nada para alterar.' }, { status: 400 });
    const { rows: [u] } = await pool.query(`UPDATE public.users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${SELECT}`, vals);
    esquecerAcesso(String(body.userId));
    return Response.json({ ...u, editavel: true, souEu: false });
  } finally {
    await pool.end();
  }
}
