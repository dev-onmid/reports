import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { NextRequest } from 'next/server';

// Vídeo/imagem de exemplo da biblioteca "Formatos de Criativos". Serve a CÓPIA
// LOCAL do volume da VPS (`$MIDIA_DIR/formatos-criativos/format-N/example-M.ext`)
// e, se o arquivo faltar, redireciona para o armazenamento público de onde a
// biblioteca original toca o mesmo arquivo. Usado pela rota interna (sessão) e
// pela pública (token) — a autorização é de quem chama.

const ARQUIVO_VALIDO = /^format-\d{1,2}\/example-\d{1,2}\.(mp4|jpg|png)$/;
const ORIGEM =
  'https://dhvedtlywtovvzaboeht.supabase.co/storage/v1/object/public/creative-examples/v2/';
const MIME: Record<string, string> = { mp4: 'video/mp4', jpg: 'image/jpeg', png: 'image/png' };

function pastaLocal() {
  return path.join(process.env.MIDIA_DIR ?? '/app/midia', 'formatos-criativos');
}

/**
 * Entrega o arquivo `f` (format-N/example-M.ext), com Range e ?baixar=.
 * Quem chama decide se o pedido pode ver aquele arquivo (sessão ou token).
 */
export async function servirMidiaFormato(req: NextRequest, f: string): Promise<Response> {
  if (!ARQUIVO_VALIDO.test(f)) return new Response('arquivo inválido', { status: 400 });

  const caminho = path.join(pastaLocal(), f);
  const st = await fs.stat(caminho).catch(() => null);
  if (!st) return Response.redirect(ORIGEM + f, 302);

  const ext = f.split('.').pop()!;
  // ?baixar=<nome> força o download com um nome legível em vez de tocar.
  const baixar = req.nextUrl.searchParams.get('baixar');
  const nome = baixar ? `${baixar.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80)}.${ext}` : null;
  const base: Record<string, string> = {
    'Content-Type': MIME[ext],
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
  };
  if (nome) base['Content-Disposition'] = `attachment; filename="${nome}"`;

  // Safari só toca vídeo com resposta parcial (206); sem Range, também não dá
  // para avançar o vídeo em nenhum navegador.
  const range = req.headers.get('range');
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m && (m[1] || m[2])) {
    let inicio = m[1] ? Number(m[1]) : st.size - Number(m[2]);
    let fim = m[1] && m[2] ? Number(m[2]) : st.size - 1;
    inicio = Math.max(0, inicio);
    fim = Math.min(fim, st.size - 1);
    if (inicio > fim) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(caminho, { start: inicio, end: fim })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...base,
        'Content-Length': String(fim - inicio + 1),
        'Content-Range': `bytes ${inicio}-${fim}/${st.size}`,
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(caminho)) as ReadableStream;
  return new Response(stream, { headers: { ...base, 'Content-Length': String(st.size) } });
}
