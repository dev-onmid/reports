import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { igAppCreds, stateAssinar } from '@/lib/instagram-direct';
import { webhookOrigin } from '@/lib/evolution-api';

/**
 * Início do OAuth "Instagram API with Instagram Login" — o caminho para conta
 * SEM Página do Facebook. Navegação top-level autenticada (atrás do proxy):
 * valida o cliente e faz 302 para o login do Instagram.
 *
 * `force_reauth=1` de propósito: a agência conecta contas de VÁRIOS clientes no
 * mesmo navegador — sem ele, o Instagram reaproveitaria a sessão cacheada e a
 * conta ERRADA seria pendurada no cliente, em silêncio.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const clientId = (req.nextUrl.searchParams.get('clientId') ?? '').trim();
  if (!clientId) return new Response('clientId ausente', { status: 400 });

  const creds = igAppCreds();
  if (!creds) {
    return new Response(
      'INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET não configurados. Configure o produto ' +
      '"Instagram → API setup with Instagram business login" no App Dashboard da Meta, ' +
      'copie o Instagram App ID/Secret e adicione as duas envs no servidor.',
      { status: 500 },
    );
  }

  const pool = makeServerPool();
  try {
    const { rowCount } = await pool.query(`SELECT 1 FROM public.clients WHERE id = $1`, [clientId]);
    if (!rowCount) return new Response('cliente não encontrado', { status: 404 });
  } finally {
    await pool.end().catch(() => {});
  }

  const origin = webhookOrigin(req.url);
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', creds.appId);
  url.searchParams.set('redirect_uri', `${origin}/api/auth/instagram/callback`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'instagram_business_basic,instagram_business_content_publish');
  url.searchParams.set('state', stateAssinar(clientId));
  url.searchParams.set('force_reauth', '1');
  return Response.redirect(url.toString(), 302);
}
