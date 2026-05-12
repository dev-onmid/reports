import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) return new Response('url required', { status: 400 });

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      },
    });

    const html = await res.text();

    // Inject base tag so relative paths resolve to facebook.com
    const patched = html.replace(
      /<head([^>]*)>/i,
      '<head$1><base href="https://www.facebook.com">',
    );

    return new Response(patched, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        // Intentionally omit X-Frame-Options so the iframe renders
      },
    });
  } catch {
    return new Response('<p style="font-family:sans-serif;padding:16px;color:#666">Preview indisponível</p>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}
