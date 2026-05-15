import type { NextRequest } from 'next/server';

/**
 * Proxy the Facebook ad_snapshot_url server-side so we can embed it in an
 * iframe — Facebook sends X-Frame-Options: DENY which blocks direct embedding.
 * We strip that header and forward the HTML through our domain.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return new Response('Missing url param', { status: 400 });

  // Only allow Facebook snapshot URLs
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  if (!parsed.hostname.endsWith('facebook.com') && !parsed.hostname.endsWith('fbcdn.net')) {
    return new Response('Only Facebook URLs allowed', { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

    if (!res.ok) {
      return new Response(`Upstream error: ${res.status}`, { status: 502 });
    }

    const contentType = res.headers.get('content-type') ?? 'text/html';
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // Strip X-Frame-Options — this is the whole point of the proxy
        // Do NOT forward X-Frame-Options or CSP frame-ancestors
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    return new Response(`Proxy fetch failed: ${String(e)}`, { status: 502 });
  }
}
