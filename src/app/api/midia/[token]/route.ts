import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { obterMidiaPorToken } from '@/lib/post-server';

/**
 * Imagem de uma publicação, PÚBLICA por token.
 *
 * ⚠️ Precisa ser pública: a Meta faz cURL nesta URL a partir da internet no
 * momento de criar o container ("the media must be hosted on a publicly
 * accessible server at the time of the attempt") e não carrega cookie nenhum.
 * O token de 32 hex é a credencial — mesmo modelo de `/api/portal/` e
 * `/relatorio/[token]`. Por isso o prefixo `/api/midia/` está em
 * PUBLIC_PREFIXES do proxy: é uma decisão de segurança consciente.
 *
 * Não há listagem e o token não é derivável de nada — só quem recebeu a URL chega nela.
 */
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pool = makeServerPool();
  try {
    const midia = await obterMidiaPorToken(pool, token);
    if (!midia) return new Response('não encontrado', { status: 404 });
    return new Response(new Uint8Array(midia.bytes), {
      headers: {
        'Content-Type': midia.mime,
        // Cache longo: a imagem é imutável e a Meta pode buscar mais de uma vez
        // (uma por conta) na mesma rodada de publicação.
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch {
    return new Response('erro', { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
