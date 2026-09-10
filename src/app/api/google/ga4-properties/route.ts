// ── GET /api/google/ga4-properties?connectionId= ──────────────────────────────
// Propriedades GA4 que a conexão Google (tipo 'ga4') enxerga — Admin API
// accountSummaries. Alimenta o painel de Integrações ("Ver propriedades") e o
// diálogo de vínculo do cliente. Cache 4h por conexão.

import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { getCached, setCached, cachedJson, TTL_4H } from '@/lib/api-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export type Ga4Property = { propertyId: string; name: string; account: string; accountId: string };

async function getFreshAccessToken(conn: { access_token: string; refresh_token: string; token_expiry: string | null }): Promise<string> {
  if (conn.token_expiry && new Date(conn.token_expiry).getTime() > Date.now() + 5 * 60 * 1000) return conn.access_token;
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token!;
}

type Summary = { account?: string; displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> };

/**
 * ⚠️ 403 do Google tem DUAS causas que pedem ações opostas, e tratá-las como
 * uma só manda o gestor pro caminho errado.
 *
 * Medido em 10/09: a conexão tinha `analytics.readonly` no escopo (confirmado no
 * refresh do token) e mesmo assim tomava 403 — a Admin API estava DESLIGADA no
 * projeto do Cloud (`reason: SERVICE_DISABLED`). A mensagem antiga mandava
 * "reconecte marcando o acesso ao Google Analytics", que não resolve nada: dá
 * para reconectar dez vezes que o 403 volta igual, porque o problema é do
 * projeto, não da conta.
 */
function mensagemDoErro(status: number, corpo: string): string {
  if (status !== 403) return `Google Analytics respondeu ${status}`;
  try {
    const j = JSON.parse(corpo) as {
      error?: { message?: string; details?: Array<{ reason?: string; metadata?: Record<string, string> }> };
    };
    const detalhes = j.error?.details ?? [];
    const desligada = detalhes.find((d) => d.reason === 'SERVICE_DISABLED');
    if (desligada) {
      const url = desligada.metadata?.activationUrl;
      return 'A Google Analytics Admin API está DESLIGADA no projeto do Google Cloud — não é a conexão. '
        + 'Ative-a no Console (o link vem na resposta do Google) e tente de novo em alguns minutos.'
        + (url ? ` Link: ${url}` : '');
    }
    // 403 sem SERVICE_DISABLED: aí sim é a conta/escopo.
    const msg = j.error?.message?.trim();
    return msg
      ? `Google Analytics recusou (403): ${msg}`
      : 'A conta conectada não tem permissão de Analytics — reconecte marcando o acesso ao Google Analytics.';
  } catch {
    return 'A conta conectada não tem permissão de Analytics — reconecte marcando o acesso ao Google Analytics.';
  }
}

export async function GET(request: NextRequest) {
  const connectionId = request.nextUrl.searchParams.get('connectionId');
  if (!connectionId) return Response.json({ error: 'Missing connectionId' }, { status: 400 });

  const cacheKey = `google:ga4-properties:${connectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: any;
  try {
    conn = (await pool.query('SELECT * FROM public.google_connections WHERE id = $1', [connectionId])).rows[0];
  } finally {
    await pool.end();
  }
  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 });

  let token: string;
  try { token = await getFreshAccessToken(conn); }
  catch (e) {
    const msg = e instanceof Error ? e.message : 'Erro ao renovar token Google';
    return Response.json({ error: `Token Google expirado ou inválido — reconecte a conta. (${msg})` }, { status: 401 });
  }

  const out: Ga4Property[] = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!res) return Response.json({ error: 'Sem resposta do Google Analytics' }, { status: 502 });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[google/ga4-properties]', res.status, txt.slice(0, 300));
      return Response.json({ error: mensagemDoErro(res.status, txt) }, { status: res.status });
    }
    const data = await res.json() as { accountSummaries?: Summary[]; nextPageToken?: string };
    for (const a of data.accountSummaries ?? []) {
      for (const p of a.propertySummaries ?? []) {
        out.push({
          propertyId: String(p.property ?? '').replace('properties/', ''),
          name: p.displayName ?? '',
          account: a.displayName ?? '',
          accountId: String(a.account ?? '').replace('accounts/', ''),
        });
      }
    }
    pageToken = data.nextPageToken ?? '';
    if (!pageToken) break;
  }
  out.sort((a, b) => a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
  setCached(cacheKey, out, TTL_4H);
  return cachedJson(out, false);
}
