import type { NextRequest } from 'next/server';
import { subscribe } from '@/lib/campaign-queue';

export const dynamic = 'force-dynamic';

// Max SSE lifetime — browser EventSource reconnects automatically after close
const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(request: NextRequest) {
  const campaignId = request.nextUrl.searchParams.get('campaignId');
  if (!campaignId) return new Response('campaignId obrigatório', { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const unsub = subscribe(campaignId, (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          unsub();
        }
      });

      // Keepalive ping every 20s
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
          unsub();
        }
      }, 20000);

      // Close after MAX_DURATION_MS so Vercel doesn't bill CPU indefinitely.
      // The browser's EventSource reconnects automatically with a new request.
      const maxTimer = setTimeout(() => {
        clearInterval(ping);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      }, MAX_DURATION_MS);

      request.signal.addEventListener('abort', () => {
        clearTimeout(maxTimer);
        clearInterval(ping);
        unsub();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
