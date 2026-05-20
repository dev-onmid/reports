import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

export async function GET(request: NextRequest) {
  const rid = request.nextUrl.searchParams.get('rid');
  const url = request.nextUrl.searchParams.get('url') ?? '';

  if (rid) {
    const pool = makeServerPool();
    try {
      await pool.query(
        `UPDATE public.email_recipients
         SET clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1
         WHERE id = $1`,
        [rid],
      );
    } catch {
      // best-effort — never block the redirect
    } finally {
      await pool.end();
    }
  }

  const destination = url.startsWith('http://') || url.startsWith('https://') ? url : '/';
  return Response.redirect(destination, 302);
}
