import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  buscarPerfilDireto, salvarConexaoDireta, stateVerificar, trocarCodePorTokenLongo,
} from '@/lib/instagram-direct';
import { webhookOrigin } from '@/lib/evolution-api';

/**
 * Callback do OAuth do Instagram Login.
 *
 * ⚠️ Rota PÚBLICA (entrada em PUBLIC_PREFIXES do proxy): o Instagram redireciona
 * o navegador para cá sem garantia do nosso cookie — mesma razão do
 * `/api/auth/google/callback`. A defesa é o `state` assinado com HMAC do
 * SESSION_SECRET: callback forjado não passa do `stateVerificar`.
 */
export const dynamic = 'force-dynamic';

function voltar(origin: string, params: Record<string, string>): Response {
  const url = new URL(`${origin}/ferramentas/publicacoes`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString(), 302);
}

export async function GET(req: NextRequest) {
  const origin = webhookOrigin(req.url);
  const code = req.nextUrl.searchParams.get('code');
  const erro = req.nextUrl.searchParams.get('error_description') ?? req.nextUrl.searchParams.get('error');
  const clientId = stateVerificar(req.nextUrl.searchParams.get('state') ?? '');

  if (erro) return voltar(origin, { ig_erro: erro });
  if (!code || !clientId) return voltar(origin, { ig_erro: 'login inválido ou expirado — tente conectar de novo' });

  const pool = makeServerPool();
  try {
    const token = await trocarCodePorTokenLongo(code, `${origin}/api/auth/instagram/callback`);
    // O /me é a forma BONITA de obter id+username, mas há apps em que a Meta
    // recusa toda leitura com "Unsupported request" (nível de acesso). O
    // próprio oauth/access_token já devolve o user_id — então o perfil é
    // BEST-EFFORT: sem ele a conexão salva mesmo assim (com o token guardado
    // dá para diagnosticar do servidor, sem queimar novos logins do usuário).
    let igUserId = token.igUserId;
    let username = '';
    try {
      const perfil = await buscarPerfilDireto(token.accessToken);
      igUserId = perfil.igUserId;
      username = perfil.username;
    } catch (err) {
      console.error('[instagram callback] perfil indisponível, usando user_id do OAuth:', err);
    }
    if (!igUserId) throw new Error('o Instagram não devolveu o id da conta');
    await salvarConexaoDireta(pool, {
      clientId,
      igUserId,
      username,
      accessToken: token.accessToken,
      expiraEm: token.expiraEm,
      scopes: token.permissions,
    });
    return voltar(origin, { ig_conectado: username || igUserId });
  } catch (err) {
    console.error('[instagram callback]', err);
    return voltar(origin, { ig_erro: String(err instanceof Error ? err.message : err).slice(0, 200) });
  } finally {
    await pool.end().catch(() => {});
  }
}
