import { createHmac } from 'crypto';
import type { Pool } from 'pg';

/**
 * Instagram DIRETO — "Instagram API with Instagram Login" (SERVER ONLY).
 *
 * É o caminho da Meta para conta profissional SEM Página do Facebook vinculada
 * ("does not require a Facebook Page") — o caso da conta com restrição que não
 * consegue vincular Página. A própria conta autoriza o app no login do
 * Instagram e a publicação sai por `graph.instagram.com` com um token DELA,
 * não com page token.
 *
 * ⚠️ Diferenças que importam contra o caminho por Página:
 *  - O token é LONGO DE 60 DIAS por conta, e precisa ser RENOVADO
 *    (`refresh_access_token`, idade mínima 24h). Sem renovar, morre — por isso
 *    `renovarTokensVencendo` roda no tick do worker de publicações.
 *  - Credencial do app é o INSTAGRAM App ID/Secret (produto "Instagram" no App
 *    Dashboard) — NÃO é o App ID do Facebook do FB_SCOPE.
 *  - Sem Página ⇒ sem a perna do Facebook para essa conta (o planejador já
 *    descarta o FB com motivo quando não há pageId).
 */

let ensured: Promise<void> | null = null;

export function ensureInstagramDirectSchema(pool: Pool): Promise<void> {
  ensured ??= (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS public.instagram_direct_connections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL UNIQUE,
      ig_user_id TEXT NOT NULL,
      username TEXT,
      access_token TEXT NOT NULL,
      token_expiry TIMESTAMPTZ,
      scopes TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_refresh_at TIMESTAMPTZ
    )`);
  })();
  return ensured;
}

export function igAppCreds(): { appId: string; secret: string } | null {
  const appId = (process.env.INSTAGRAM_APP_ID ?? '').trim();
  const secret = (process.env.INSTAGRAM_APP_SECRET ?? '').trim();
  if (!appId || !secret) return null;
  return { appId, secret };
}

// ---------------------------------------------------------------- OAuth state

/**
 * State do OAuth assinado com o SESSION_SECRET (CSRF): sem isso, qualquer um
 * poderia forjar um callback e pendurar a PRÓPRIA conta de Instagram num
 * cliente nosso. Validade curta — o state só vive durante o login.
 */
export function stateAssinar(clientId: string, agora = Date.now()): string {
  const secret = process.env.SESSION_SECRET ?? '';
  const payload = Buffer.from(JSON.stringify({ c: clientId, exp: agora + 15 * 60_000 })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function stateVerificar(state: string, agora = Date.now()): string | null {
  const secret = process.env.SESSION_SECRET ?? '';
  const [payload, sig] = String(state ?? '').split('.');
  if (!payload || !sig) return null;
  const esperado = createHmac('sha256', secret).update(payload).digest('base64url');
  if (sig !== esperado) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { c?: string; exp?: number };
    if (!dados.c || typeof dados.exp !== 'number' || dados.exp < agora) return null;
    return dados.c;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- Troca

const IG_GRAPH = 'https://graph.instagram.com';

/**
 * Chamada aos endpoints de TOKEN do graph.instagram.com.
 *
 * ⚠️ A doc mostra GET com query params, mas na prática a Meta responde
 * "Unsupported request - method type: get" para vários apps (visto aqui em
 * 09/09 e em issues públicas — ex. NangoHQ/nango#5531). Tenta GET como a doc
 * manda e, nesse erro específico, refaz como POST com corpo form-encoded.
 */
async function tokenCall(path: string, params: Record<string, string>): Promise<{ status: number; texto: string }> {
  const qs = new URLSearchParams(params).toString();
  const viaGet = await fetch(`${IG_GRAPH}/${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const textoGet = await viaGet.text();
  if (!/method type:\s*get/i.test(textoGet)) return { status: viaGet.status, texto: textoGet };

  const viaPost = await fetch(`${IG_GRAPH}/${path}`, {
    method: 'POST',
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: viaPost.status, texto: await viaPost.text() };
}

export type TokenLongo = {
  accessToken: string;
  /** ISO do vencimento (≈60 dias). */
  expiraEm: string;
  permissions: string;
};

/**
 * code → token curto (api.instagram.com) → token longo de 60 dias
 * (graph.instagram.com, grant ig_exchange_token).
 */
export async function trocarCodePorTokenLongo(code: string, redirectUri: string): Promise<TokenLongo> {
  const creds = igAppCreds();
  if (!creds) throw new Error('INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET não configurados no servidor.');

  const curtoRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: creds.appId,
      client_secret: creds.secret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const curto = await curtoRes.json() as {
    access_token?: string; permissions?: string[] | string;
    error_message?: string; error?: { message?: string };
  };
  if (!curto.access_token) {
    throw new Error(curto.error_message ?? curto.error?.message ?? 'o Instagram não devolveu o token');
  }

  const longoRes = await tokenCall('access_token', {
    grant_type: 'ig_exchange_token',
    client_secret: creds.secret,
    access_token: curto.access_token,
  });
  let longo: { access_token?: string; expires_in?: number; error?: { message?: string } } = {};
  try { longo = JSON.parse(longoRes.texto); } catch { /* corpo não-JSON vai pro log abaixo */ }
  if (!longo.access_token) {
    // Log com o passo e o corpo cru — sem isso o erro da Meta chega genérico
    // na tela e não dá para saber QUAL chamada falhou (visto em 09/09).
    console.error('[instagram-direct] troca pelo token longo falhou:', longoRes.status, longoRes.texto.slice(0, 400));
    throw new Error(`troca pelo token de 60 dias: ${longo.error?.message ?? `HTTP ${longoRes.status}`}`);
  }

  return {
    accessToken: longo.access_token,
    expiraEm: new Date(Date.now() + (longo.expires_in ?? 60 * 86400) * 1000).toISOString(),
    permissions: Array.isArray(curto.permissions) ? curto.permissions.join(',') : String(curto.permissions ?? ''),
  };
}

/** Perfil da conta autorizada. `user_id` é o id usado nos paths de publicação. */
export async function buscarPerfilDireto(token: string): Promise<{ igUserId: string; username: string }> {
  const res = await fetch(
    `${IG_GRAPH}/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  const texto = await res.text();
  let j: { user_id?: string | number; id?: string; username?: string; error?: { message?: string } } = {};
  try { j = JSON.parse(texto); } catch { /* corpo não-JSON vai pro log abaixo */ }
  const igUserId = j.user_id ?? j.id;
  if (!igUserId) {
    console.error('[instagram-direct] leitura do perfil falhou:', res.status, texto.slice(0, 400));
    throw new Error(`leitura do perfil: ${j.error?.message ?? `HTTP ${res.status}`}`);
  }
  return { igUserId: String(igUserId), username: j.username ?? '' };
}

// ------------------------------------------------------------------ Conexões

export type ContaDireta = {
  clientId: string;
  igUserId: string;
  username: string | null;
  accessToken: string;
  tokenExpiry: string | null;
  status: string;
};

export async function salvarConexaoDireta(
  pool: Pool,
  dados: { clientId: string; igUserId: string; username: string; accessToken: string; expiraEm: string; scopes: string },
): Promise<void> {
  await ensureInstagramDirectSchema(pool);
  await pool.query(
    `INSERT INTO public.instagram_direct_connections
       (client_id, ig_user_id, username, access_token, token_expiry, scopes, status, connected_at, last_refresh_at)
     VALUES ($1,$2,$3,$4,$5,$6,'connected',NOW(),NULL)
     ON CONFLICT (client_id) DO UPDATE SET
       ig_user_id = EXCLUDED.ig_user_id,
       username = EXCLUDED.username,
       access_token = EXCLUDED.access_token,
       token_expiry = EXCLUDED.token_expiry,
       scopes = EXCLUDED.scopes,
       status = 'connected',
       connected_at = NOW(),
       last_refresh_at = NULL`,
    [dados.clientId, dados.igUserId, dados.username || null, dados.accessToken, dados.expiraEm, dados.scopes],
  );
}

/** Conexões CONECTADAS dos clientes pedidos. */
export async function contasDiretas(pool: Pool, clientIds: string[]): Promise<Map<string, ContaDireta>> {
  if (clientIds.length === 0) return new Map();
  await ensureInstagramDirectSchema(pool);
  const { rows } = await pool.query(
    `SELECT client_id, ig_user_id, username, access_token, token_expiry, status
       FROM public.instagram_direct_connections
      WHERE client_id = ANY($1) AND status = 'connected'`,
    [clientIds],
  );
  return new Map(rows.map(r => [r.client_id as string, {
    clientId: r.client_id, igUserId: r.ig_user_id, username: r.username,
    accessToken: r.access_token, tokenExpiry: r.token_expiry, status: r.status,
  }]));
}

// ------------------------------------------------------------------ Renovação

/**
 * Renova tokens que vencem em <30 dias. Roda no tick do worker de publicações
 * (quase sempre 0 linhas — a folga de 30 dias sobre um token de 60 garante
 * muitas chances antes do vencimento, sem cron novo).
 *
 * ⚠️ `last_refresh_at` é gravado na TENTATIVA, não só no sucesso — senão uma
 * falha de rede faria o worker martelar a Meta a cada minuto. Só erro de OAuth
 * (token inválido/revogado) derruba para `status='erro'`; falha transitória
 * tenta de novo no dia seguinte.
 */
export async function renovarTokensVencendo(pool: Pool): Promise<number> {
  await ensureInstagramDirectSchema(pool);
  const { rows } = await pool.query(
    `SELECT id, client_id, access_token FROM public.instagram_direct_connections
      WHERE status = 'connected'
        AND (token_expiry IS NULL OR token_expiry < NOW() + INTERVAL '30 days')
        AND connected_at < NOW() - INTERVAL '1 day'
        AND (last_refresh_at IS NULL OR last_refresh_at < NOW() - INTERVAL '1 day')
      LIMIT 10`,
  );
  let renovados = 0;
  for (const r of rows) {
    await pool.query(`UPDATE public.instagram_direct_connections SET last_refresh_at = NOW() WHERE id = $1`, [r.id]);
    try {
      const res = await tokenCall('refresh_access_token', {
        grant_type: 'ig_refresh_token',
        access_token: r.access_token,
      });
      let j: { access_token?: string; expires_in?: number; error?: { message?: string; code?: number } } = {};
      try { j = JSON.parse(res.texto); } catch { /* fica sem access_token e cai no ramo de erro */ }
      if (j.access_token) {
        await pool.query(
          `UPDATE public.instagram_direct_connections
              SET access_token = $2, token_expiry = $3 WHERE id = $1`,
          [r.id, j.access_token, new Date(Date.now() + (j.expires_in ?? 60 * 86400) * 1000).toISOString()],
        );
        renovados++;
      } else if (j.error) {
        // Erro de OAuth = token morto (senha trocada, app revogado). Marcar e
        // deixar visível na tela — reconectar é o único remédio.
        console.error('[instagram-direct] token de', r.client_id, 'recusado:', j.error.message);
        await pool.query(
          `UPDATE public.instagram_direct_connections SET status = 'erro' WHERE id = $1`, [r.id],
        );
      }
    } catch (err) {
      console.error('[instagram-direct] falha transitória ao renovar', r.client_id, err);
    }
  }
  return renovados;
}
