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

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return Response.json({ error: 'Missing url' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return Response.json({ error: 'Invalid url' }, { status: 400 });
  }
  if (target.protocol !== 'https:' || isBlockedHost(target.hostname)) {
    return Response.json({ error: 'Url not allowed' }, { status: 400 });
  }

  try {
    const upstream = await fetch(target.toString());
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Upstream fetch failed' }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return Response.json({ error: 'Upstream fetch failed' }, { status: 502 });
  }
}
