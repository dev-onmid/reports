import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { arquivoNoEscopo, resolverToken } from '@/lib/formatos-compartilhamento';
import { servirMidiaFormato } from '@/lib/formatos-midia';

// PÚBLICA: vídeo/imagem de exemplo, só se o arquivo for de um formato no escopo do token.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const f = req.nextUrl.searchParams.get('f') ?? '';
  const pool = makeServerPool();
  let escopo: string | null = null;
  try {
    escopo = await resolverToken(pool, token);
  } catch (err) {
    console.error('[formatos-publico midia]', err);
    return new Response('erro', { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
  if (!escopo || !arquivoNoEscopo(escopo, f)) return new Response('não encontrado', { status: 404 });
  return servirMidiaFormato(req, f);
}
