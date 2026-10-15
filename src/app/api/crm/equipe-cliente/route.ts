import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { atualizarAcesso, criarAcesso, ehErro, listarAcessos } from '@/lib/acessos-cliente';

/**
 * O GESTOR do cliente cadastra a própria equipe (2026-10-10). A regra mora em
 * src/lib/acessos-cliente.ts (a mesma da porta da agência); aqui só o que o
 * gestor pode: criar ATENDENTE, mexer só em atendente, nunca em si mesmo.
 * O proxy já prende o `clientId` ao do chamador.
 */
function chamadorGestor(req: NextRequest): { id: string; clientes: string[] } | null {
  if (req.headers.get('x-onmid-team') !== 'cliente' || req.headers.get('x-onmid-perfil') !== 'gestor') return null;
  const id = req.headers.get('x-onmid-user-id') ?? '';
  const clientes = (req.headers.get('x-onmid-clientes') ?? '').split(',').filter(Boolean);
  return id ? { id, clientes } : null;
}

export async function GET(req: NextRequest) {
  const quem = chamadorGestor(req);
  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!quem || !clientId || !quem.clientes.includes(clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  const pool = makeServerPool();
  try {
    const lista = await listarAcessos(pool, clientId);
    return Response.json({ equipe: lista.map(u => ({ ...u, souEu: String(u.id) === quem.id, editavel: String(u.id) !== quem.id && u.perfil === 'atendente' })) });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const quem = chamadorGestor(req);
  const body = await req.json().catch(() => ({})) as { clientId?: string; name?: unknown; email?: unknown; password?: unknown };
  if (!quem || !body.clientId || !quem.clientes.includes(body.clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  const pool = makeServerPool();
  try {
    const r = await criarAcesso(pool, { clientId: body.clientId, name: body.name, email: body.email, password: body.password, perfil: 'atendente' });
    if (ehErro(r)) return Response.json({ error: r.erro }, { status: r.status });
    return Response.json({ ...r, editavel: true, souEu: false }, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest) {
  const quem = chamadorGestor(req);
  const body = await req.json().catch(() => ({})) as { clientId?: string; userId?: string; status?: unknown; password?: unknown; name?: unknown };
  if (!quem || !body.clientId || !quem.clientes.includes(body.clientId)) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
  if (!body.userId || body.userId === quem.id) return Response.json({ error: 'Usuário inválido.' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const r = await atualizarAcesso(pool, { clientId: body.clientId, userId: body.userId, status: body.status, name: body.name, password: body.password, somenteAtendente: true });
    if (ehErro(r)) return Response.json({ error: r.erro }, { status: r.status });
    return Response.json({ ...r, editavel: true, souEu: false });
  } finally {
    await pool.end();
  }
}
