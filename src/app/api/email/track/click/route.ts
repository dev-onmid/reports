import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { assinarDestino } from '@/lib/email-tracking';
import { timingSafeEqual } from 'node:crypto';

export async function GET(request: NextRequest) {
  const rid = request.nextUrl.searchParams.get('rid');
  const fcid = request.nextUrl.searchParams.get('fcid');
  const url = request.nextUrl.searchParams.get('url') ?? '';

  if (rid || fcid) {
    const pool = makeServerPool();
    try {
      if (rid) {
        await pool.query(
          `UPDATE public.email_recipients
           SET clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1
           WHERE id = $1`,
          [rid],
        );
      }
      if (fcid) {
        await pool.query(
          `UPDATE public.email_flow_contacts SET graph_clicks = graph_clicks + 1 WHERE id = $1`,
          [fcid],
        );
      }
    } catch {
      // best-effort — never block the redirect
    } finally {
      await pool.end();
    }
  }

  // Redirecionamento aberto fechado (auditoria 2026-10-10): só destino que o
  // nosso e-mail assinou. Link sem assinatura (e-mail antigo) cai na home.
  const s = request.nextUrl.searchParams.get('s') ?? '';
  const esperado = url ? assinarDestino(url) : '';
  const assinado = !!s && s.length === esperado.length && timingSafeEqual(Buffer.from(s), Buffer.from(esperado));
  const destination = assinado && /^https?:\/\//.test(url) ? url : '/';
  return Response.redirect(destination, 302);
}
