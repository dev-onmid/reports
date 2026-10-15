import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { formatosDoEscopo, resolverToken } from '@/lib/formatos-compartilhamento';

// PÚBLICA (PUBLIC_PREFIXES no proxy): a lista de formatos que o token deixa ver.
// Token inválido ou desativado → 404 (sem dizer qual dos dois).
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pool = makeServerPool();
  try {
    const escopo = await resolverToken(pool, token, true);
    if (!escopo) return Response.json({ error: 'link inválido ou desativado' }, { status: 404 });
    return Response.json({ escopo, formatos: formatosDoEscopo(escopo) });
  } catch (err) {
    console.error('[formatos-publico GET]', err);
    return Response.json({ error: 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
