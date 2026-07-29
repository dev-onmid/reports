import { clearSessionCookieHeader } from '@/lib/session';

export async function POST() {
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clearSessionCookieHeader() },
  });
}
