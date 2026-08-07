import type { NextRequest } from 'next/server';
import { isAllowedMediaUrl, safeFilename } from '@/lib/ads-library';

// GET /api/ads-library/download?u=<url do fbcdn>&name=<arquivo>
// Proxy de download: o browser não consegue baixar direto do fbcdn com nome de
// arquivo (o atributo `download` é ignorado cross-origin) — aqui o servidor
// repassa o stream com Content-Disposition: attachment. Só aceita CDNs do Meta
// (isAllowedMediaUrl) pra não virar proxy aberto.
// Auth: deny-by-default do proxy — o clique no <a> é same-origin e leva o cookie.

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const u = searchParams.get('u') ?? '';
  const name = searchParams.get('name') ?? '';

  if (!isAllowedMediaUrl(u)) {
    return Response.json({ ok: false, error: 'URL de mídia inválida.' }, { status: 400 });
  }

  try {
    const upstream = await fetch(u, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(110_000),
    });
    if (!upstream.ok || !upstream.body) {
      return Response.json(
        { ok: false, error: `A mídia expirou ou o CDN recusou (HTTP ${upstream.status}). Refaça a busca pra renovar os links.` },
        { status: 502 },
      );
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const ext = contentType.includes('video') ? 'mp4' : contentType.includes('png') ? 'png' : 'jpg';
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeFilename(name, ext)}"`,
      'Cache-Control': 'no-store',
    });
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    return new Response(upstream.body, { headers });
  } catch (err) {
    console.error('[ads-library/download]', err);
    return Response.json(
      { ok: false, error: 'Falha ao baixar a mídia — os links do fbcdn expiram; refaça a busca.' },
      { status: 502 },
    );
  }
}
