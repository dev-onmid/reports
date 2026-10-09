import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { atualizarAcesso, criarAcesso, ehErro, listarAcessos, perfilValido, URL_CRM_CLIENTE } from '@/lib/acessos-cliente';

/**
 * Acessos do cliente ao CRM, pela EQUIPE DA ONMID (dentro do cliente). Qualquer
 * pessoa do time Onmid cria gestor ou atendente — não precisa ser administrador
 * nem ir em Configurações. Usuário de cliente não alcança (não está na lista
 * do proxy).
 */
async function equipeOnmid(req: NextRequest, pool: ReturnType<typeof makeServerPool>): Promise<boolean> {
  const scope = await getCallerScope(req, pool);
  return !!scope.userId && scope.unrestricted;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    if (!(await equipeOnmid(req, pool))) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    return Response.json({ acessos: await listarAcessos(pool, id), url: URL_CRM_CLIENTE });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { name?: unknown; email?: unknown; password?: unknown; perfil?: unknown };
  const pool = makeServerPool();
  try {
    if (!(await equipeOnmid(req, pool))) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    const r = await criarAcesso(pool, { clientId: id, name: body.name, email: body.email, password: body.password, perfil: perfilValido(body.perfil) });
    if (ehErro(r)) return Response.json({ error: r.erro }, { status: r.status });
    return Response.json(r, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { userId?: string; status?: unknown; name?: unknown; password?: unknown; perfil?: unknown };
  if (!body.userId) return Response.json({ error: 'userId obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    if (!(await equipeOnmid(req, pool))) return Response.json({ error: 'Sem permissão.' }, { status: 403 });
    const r = await atualizarAcesso(pool, { clientId: id, userId: body.userId, status: body.status, name: body.name, password: body.password, perfil: body.perfil, somenteAtendente: false });
    if (ehErro(r)) return Response.json({ error: r.erro }, { status: r.status });
    return Response.json(r);
  } finally {
    await pool.end();
  }
}
