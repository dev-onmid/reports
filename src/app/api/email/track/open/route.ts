import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

// 1×1 transparent GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(request: NextRequest) {
  const rid = request.nextUrl.searchParams.get('rid');

  if (rid) {
    const pool = makeServerPool();
    try {
      await pool.query(
        `UPDATE public.email_recipients
         SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1
         WHERE id = $1`,
        [rid],
      );
    } catch {
      // best-effort — never block pixel delivery
    } finally {
      await pool.end();
    }
  }

  return new Response(GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}
