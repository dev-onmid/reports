import type { NextRequest } from 'next/server';

// Meta/Instagram creative and post thumbnails are served from CDNs (fbcdn.net etc.)
// that don't send permissive CORS headers, which would taint the canvas used to
// rasterize report slides for PDF export. This route re-fetches the image
// server-side and re-serves it same-origin with an open CORS header.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '0.0.0.0' || h === '[::1]' ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}

const HOSTS_PERMITIDOS = [/(^|\.)fbcdn\.net$/, /(^|\.)cdninstagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)fbsbx\.com$/, /(^|\.)googleusercontent\.com$/, /(^|\.)gstatic\.com$/, /(^|\.)unavatar\.io$/, /(^|\.)instagram\.com$/];
function hostPermitido(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return HOSTS_PERMITIDOS.some(r => r.test(h));
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return Response.json({ error: 'Missing url' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Response.json({ error: 'Invalid url' }, { status: 400 });
  }
  // Só os CDNs de onde os criativos vêm (auditoria 2026-10-10): a lista de
  // bloqueio sozinha deixava passar redirecionamento para host interno
  // (169.254…, evolution, localhost:3000) e devolvia HTML no nosso domínio.
  if (target.protocol !== 'https:' || isBlockedHost(target.hostname) || !hostPermitido(target.hostname)) {
    return Response.json({ error: 'Url not allowed' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString(), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    const tipo = (upstream.headers.get('content-type') ?? '').toLowerCase();
    if (!upstream.ok || !upstream.body || !tipo.startsWith('image/')) {
      return Response.json({ error: 'Upstream fetch failed' }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': tipo,
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return Response.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }
}
