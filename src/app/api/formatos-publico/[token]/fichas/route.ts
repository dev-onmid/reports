import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { resolverToken } from '@/lib/formatos-compartilhamento';
import { fichasDoFormato } from '@/lib/formatos-fichas';

// PÚBLICA: fichas de um formato, só se o formato estiver no escopo do token.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const numero = Number(req.nextUrl.searchParams.get('numero'));
  const pool = makeServerPool();
  try {
    const escopo = await resolverToken(pool, token);
    if (!escopo || (escopo !== 'todos' && escopo !== String(numero))) {
      return Response.json({ error: 'não encontrado' }, { status: 404 });
    }
    const r = fichasDoFormato(numero);
    return r ? Response.json(r) : Response.json({ error: 'não encontrado' }, { status: 404 });
  } catch (err) {
    console.error('[formatos-publico fichas]', err);
    return Response.json({ error: 'erro' }, { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
