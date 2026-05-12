import type { NextRequest } from 'next/server';
import { subscribe } from '@/lib/campaign-queue';

export const dynamic = 'force-dynamic';

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

      request.signal.addEventListener('abort', () => {
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
