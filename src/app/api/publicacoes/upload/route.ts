import { Readable } from 'stream';
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { salvarVideoStream } from '@/lib/post-server';

/**
 * Upload de VÍDEO do planejador — corpo CRU, por stream.
 *
 * ⚠️ Não é multipart de propósito: o corpo é o próprio arquivo
 * (`fetch(..., { body: file })`, Content-Type do arquivo), o que permite
 * escrever direto no disco sem nunca materializar 80 MB em memória — o
 * `req.formData()` do Next carregaria tudo antes de entregar.
 *
 * Imagem NÃO passa por aqui (continua no dataUrl do POST /api/publicacoes,
 * cabe no JSON). Auth: deny-by-default do proxy.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const mime = (req.headers.get('content-type') ?? '').split(';')[0].trim();
  const duracao = Number(req.nextUrl.searchParams.get('duracao'));
  if (!req.body) return Response.json({ ok: false, error: 'Corpo vazio.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const stream = Readable.fromWeb(req.body as import('stream/web').ReadableStream);
    const salvo = await salvarVideoStream(
      pool, stream, mime,
      Number.isFinite(duracao) ? duracao : null,
      req.headers.get('x-onmid-user-id') ?? undefined,
    );
    return Response.json({ ok: true, midiaId: salvo.id, token: salvo.token, kb: salvo.kb });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err instanceof Error ? err.message : err) },
      { status: 400 },
    );
  } finally {
    await pool.end().catch(() => {});
  }
}
