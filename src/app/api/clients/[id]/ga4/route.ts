// ── GET /api/clients/[id]/ga4?period=&dateFrom=&dateTo= ───────────────────────
// Métricas de landing page (GA4) do cliente: soma das propriedades vinculadas
// em client_account_links (platform='ga4', account_id = id numérico da
// propriedade). Token: conexão Google do tipo 'ga4' (analytics.readonly) —
// a vinculada ao link, senão qualquer conectada (mesmo fallback do metrics).
// Sem vínculo → { ga4: null } (o dashboard esconde o bloco). Cache 15 min.

import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { resolveMetaPeriod } from '@/lib/period-utils';
import { getCached, setCached, cachedJson } from '@/lib/api-cache';
import { consolidar, faixasDoPeriodo, relatorioLanding, type Ga4Consolidado } from '@/lib/ga4-landing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Conn = { id: string; access_token: string; refresh_token: string; token_expiry: string | null };

async function getFreshGoogleToken(conn: Conn): Promise<string> {
  if (conn.token_expiry && new Date(conn.token_expiry).getTime() > Date.now() + 5 * 60 * 1000) return conn.access_token;
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2.refreshAccessToken();
  return credentials.access_token!;
}

export type Ga4Resposta = { ga4: Ga4Consolidado | null; aviso?: string };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const period = request.nextUrl.searchParams.get('period') ?? 'last_30d';
  const dateFrom = request.nextUrl.searchParams.get('dateFrom') ?? '';
  const dateTo = request.nextUrl.searchParams.get('dateTo') ?? '';
  const faixas = faixasDoPeriodo(resolveMetaPeriod(period, dateFrom, dateTo));

  const cacheKey = `ga4:v1:${clientId}:${faixas.atual.startDate}:${faixas.atual.endDate}`;
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  let links: Array<{ account_id: string; account_name: string | null; connection_id: string | null }> = [];
  let conns: Conn[] = [];
  try {
    links = (await pool.query(
      `SELECT account_id, account_name, connection_id FROM public.client_account_links WHERE client_id = $1 AND platform = 'ga4' ORDER BY created_at ASC`,
      [clientId],
    )).rows;
    if (links.length > 0) {
      conns = (await pool.query(
        `SELECT id, access_token, refresh_token, token_expiry FROM public.google_connections
          WHERE status = 'connected' AND (account_type = 'ga4' OR scope ILIKE '%analytics.readonly%')
          ORDER BY connected_at DESC`,
      )).rows;
    }
  } finally {
    await pool.end().catch(() => {});
  }

  if (links.length === 0) return cachedJson({ ga4: null } satisfies Ga4Resposta, false);
  if (conns.length === 0) return cachedJson({ ga4: null, aviso: 'Nenhuma conta Google Analytics conectada em Integrações.' } satisfies Ga4Resposta, false);

  const tokens = new Map<string, string>();
  async function tokenPara(connId: string | null): Promise<string | null> {
    const conn = conns.find(c => c.id === connId) ?? conns[0];
    if (tokens.has(conn.id)) return tokens.get(conn.id)!;
    try { const t = await getFreshGoogleToken(conn); tokens.set(conn.id, t); return t; }
    catch (e) { console.error('[ga4] refresh token falhou', e instanceof Error ? e.message : e); return null; }
  }

  const rels = await Promise.all(links.map(async l => {
    const token = await tokenPara(l.connection_id);
    if (!token) return null;
    const pid = String(l.account_id).replace(/\D/g, '');
    if (!pid) return null;
    return relatorioLanding(pid, l.account_name || `Propriedade ${pid}`, token, faixas.atual, faixas.anterior);
  }));
  const validos = rels.filter((r): r is NonNullable<typeof r> => r !== null);
  const resposta: Ga4Resposta = validos.length
    ? { ga4: consolidar(validos) }
    : { ga4: null, aviso: 'Token do Google Analytics expirado — reconecte a conta em Integrações.' };
  setCached(cacheKey, resposta);
  return cachedJson(resposta, false);
}
