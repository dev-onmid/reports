import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { getInstanceClientLink, linkInstanceToClient, unlinkInstanceFromClient } from '@/lib/instance-link';

// Resolves the disparos instance (zapi_clients) and enforces the partner scope,
// returning its Evolution instance fields when the caller may touch it.
async function loadInstance(pool: ReturnType<typeof makeServerPool>, req: NextRequest, id: string) {
  const scope = await getCallerScope(req, pool);
  const { rows: [inst] } = await pool.query(
    `SELECT id, name, instance_id, token, provider, owner_id FROM public.zapi_clients WHERE id = $1`,
    [id],
  );
  if (!inst) return { error: 'Instância não encontrada' as const, status: 404 as const };
  if (!scope.unrestricted && inst.owner_id !== scope.userId) {
    return { error: 'Sem permissão para esta instância' as const, status: 403 as const };
  }
  return { inst };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = makeServerPool();
  try {
    const res = await loadInstance(pool, req, id);
    if ('error' in res) return Response.json({ error: res.error }, { status: res.status });
    const link = await getInstanceClientLink(pool, res.inst.instance_id);
    return Response.json({ link });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { clientId?: string | null };
  const pool = makeServerPool();
  try {
    const res = await loadInstance(pool, req, id);
    if ('error' in res) return Response.json({ error: res.error }, { status: res.status });
    const { inst } = res;

    if (!body.clientId) {
      await unlinkInstanceFromClient(pool, inst.instance_id);
      return Response.json({ ok: true, link: null });
    }

    await linkInstanceToClient(pool, {
      instanceId: inst.instance_id,
      token: inst.token,
      provider: inst.provider === 'evolution' ? 'evolution' : 'zapi',
      nome: inst.name,
      clientId: body.clientId,
      appOrigin: new URL(req.url).origin,
    });
    const link = await getInstanceClientLink(pool, inst.instance_id);
    return Response.json({ ok: true, link });
  } finally {
    await pool.end();
  }
}
