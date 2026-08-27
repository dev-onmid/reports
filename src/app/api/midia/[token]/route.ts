import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { obterMidiaPorToken } from '@/lib/post-server';

/**
 * Mídia de uma publicação (imagem ou vídeo), PÚBLICA por token.
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
    const headers: Record<string, string> = {
      'Content-Type': midia.mime,
      // Cache longo: a mídia é imutável e a Meta pode buscar mais de uma vez
      // (uma por conta) na mesma rodada de publicação.
      'Cache-Control': 'public, max-age=86400, immutable',
    };

    // Imagem mora em BYTEA; vídeo mora em DISCO (volume da VPS) e sai por
    // STREAM — carregar 80 MB em memória por request esgotaria o mem_limit.
    const bytes = midia.bytes;
    if (bytes) return new Response(new Uint8Array(bytes), { headers });
    if (midia.arquivo) {
      const st = await fs.stat(midia.arquivo).catch(() => null);
      if (!st) return new Response('não encontrado', { status: 404 });
      headers['Content-Length'] = String(st.size);
      const stream = Readable.toWeb(createReadStream(midia.arquivo)) as ReadableStream;
      return new Response(stream, { headers });
    }
    return new Response('não encontrado', { status: 404 });
  } catch {
    return new Response('erro', { status: 500 });
  } finally {
    await pool.end().catch(() => {});
  }
}
