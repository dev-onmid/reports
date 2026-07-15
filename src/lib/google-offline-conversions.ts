// ── Google Ads: upload de conversão offline por click id ─────────────────────
//
// O caminho REAL de atribuição pro Google Ads: o gclid/wbraid/gbraid capturado
// no clique (Fase 1, /r/[slug] → crm_leads) volta pro Google via
// `customers/{id}:uploadClickConversions`. O Google casa o click id com o clique
// original e credita a conversão à campanha/palavra-chave exata — é isso que
// alimenta o Smart Bidding ("ele entende quem é meu público mais rápido").
//
// Token: fetch cru no endpoint OAuth (espelha report-builder/otimizador —
// NUNCA googleapis refreshAccessToken, que falha silencioso; ver CLAUDE.md).

import type { Pool } from 'pg';
import { getCached, setCached, TTL_4H } from '@/lib/api-cache';

const DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';

export type ClickIds = { gclid?: string | null; wbraid?: string | null; gbraid?: string | null };

function normalizeCustomerId(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

type TokenRow = { access_token: string; refresh_token: string; token_expiry: string | null };

async function refreshGoogleAccessToken(row: TokenRow): Promise<string | null> {
  if (row.token_expiry && new Date(row.token_expiry).getTime() > Date.now() + 60_000) {
    return row.access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }).toString(),
  }).catch(() => null);
  if (res?.ok) {
    const data = await res.json().catch(() => null) as { access_token?: string } | null;
    return data?.access_token ?? row.access_token ?? null;
  }
  return row.access_token ?? null;
}

async function gadsSearch(customerId: string, query: string, token: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
    { method: 'POST', headers, body: JSON.stringify({ query }), signal: AbortSignal.timeout(9000) },
  ).catch(() => null);
  if (!res?.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

// Reusa a mesma chave de cache do metrics/demografia (`mccmap:{connId}`)
async function buildMccMap(token: string, connectionId: string): Promise<Record<string, string>> {
  const cacheKey = `mccmap:${connectionId}`;
  const cached = getCached(cacheKey);
  if (cached) return cached.data as Record<string, string>;
  const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
    headers: { Authorization: `Bearer ${token}`, 'developer-token': DEV_TOKEN },
  }).catch(() => null);
  if (!listRes?.ok) { setCached(cacheKey, {}, TTL_4H); return {}; }
  const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
  const mccMap: Record<string, string> = {};
  await Promise.allSettled(resourceNames.map(async (rn) => {
    const custId = normalizeCustomerId(rn.replace('customers/', ''));
    const data = await gadsSearch(custId, 'SELECT customer.id, customer.manager FROM customer LIMIT 1', token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (data?.results?.[0] as any)?.customer;
    if (!c?.manager) return;
    const subData = await gadsSearch(
      custId,
      'SELECT customer_client.id, customer_client.level FROM customer_client WHERE customer_client.level >= 1',
      token, custId,
    );
    for (const r of subData?.results ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub = (r as any).customerClient;
      if (sub?.id) mccMap[normalizeCustomerId(String(sub.id))] = custId;
    }
  }));
  setCached(cacheKey, mccMap, TTL_4H);
  return mccMap;
}

// ── Resolução de acesso (cliente → conta + token + login-customer-id) ─────────

export type GoogleAdsAccess = { customerId: string; token: string; loginCustomerId?: string };

export async function resolveGoogleAdsAccess(
  pool: Pool,
  clientId: string,
  configCustomerId?: string | null,
): Promise<GoogleAdsAccess | null> {
  // Conta: config explícita > primeiro vínculo google_ads do cliente
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { rows: links } = await pool.query<any>(
    `SELECT connection_id, account_id FROM public.client_account_links
      WHERE client_id = $1 AND platform = 'google_ads'
      ORDER BY created_at ASC`,
    [clientId],
  ).catch(() => ({ rows: [] }));

  const customerId = normalizeCustomerId(configCustomerId) || normalizeCustomerId(links[0]?.account_id);
  if (!customerId) return null;

  // Token: conexão vinculada > qualquer conexão Google Ads conectada (fallback
  // do report-builder — o connection_id salvo pode estar defasado)
  const linkedConnId = links.find((l: { account_id: string }) => normalizeCustomerId(l.account_id) === customerId)?.connection_id
    ?? links[0]?.connection_id;
  const candidates: Array<TokenRow & { id: string }> = [];
  if (linkedConnId) {
    const { rows } = await pool.query<TokenRow & { id: string }>(
      `SELECT id, access_token, refresh_token, token_expiry FROM public.google_connections WHERE id = $1`,
      [linkedConnId],
    ).catch(() => ({ rows: [] as Array<TokenRow & { id: string }> }));
    candidates.push(...rows);
  }
  const { rows: fallbacks } = await pool.query<TokenRow & { id: string }>(
    `SELECT id, access_token, refresh_token, token_expiry
       FROM public.google_connections
      WHERE status = 'connected' AND (account_type = 'google_ads' OR scope ILIKE '%adwords%')
      ORDER BY connected_at DESC LIMIT 3`,
  ).catch(() => ({ rows: [] as Array<TokenRow & { id: string }> }));
  for (const f of fallbacks) if (!candidates.some(c => c.id === f.id)) candidates.push(f);

  for (const conn of candidates) {
    const token = await refreshGoogleAccessToken(conn);
    if (!token) continue;
    const mccMap = await buildMccMap(token, conn.id).catch(() => ({} as Record<string, string>));
    return { customerId, token, loginCustomerId: mccMap[customerId] };
  }
  return null;
}

// ── Resolução da ação de conversão ────────────────────────────────────────────
// O campo de config aceita: resource name completo, ID numérico ou o NOME da
// ação de conversão (Google Ads → Metas → Conversões). Nome/ID são resolvidos
// via GAQL com cache 4h.

export async function resolveConversionAction(
  access: GoogleAdsAccess,
  ref: string,
): Promise<string | null> {
  const trimmed = ref.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('customers/')) return trimmed;
  if (/^\d+$/.test(trimmed)) return `customers/${access.customerId}/conversionActions/${trimmed}`;

  const cacheKey = `gads-conv-actions:${access.customerId}`;
  let actions = getCached(cacheKey)?.data as Array<{ id: string; name: string }> | undefined;
  if (!actions) {
    const data = await gadsSearch(
      access.customerId,
      `SELECT conversion_action.id, conversion_action.name FROM conversion_action WHERE conversion_action.status = 'ENABLED'`,
      access.token, access.loginCustomerId,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actions = ((data?.results ?? []) as any[]).map(r => ({
      id: String(r.conversionAction?.id ?? ''),
      name: String(r.conversionAction?.name ?? ''),
    })).filter(a => a.id);
    setCached(cacheKey, actions, TTL_4H);
  }
  const match = actions.find(a => a.name.toLowerCase() === trimmed.toLowerCase());
  return match ? `customers/${access.customerId}/conversionActions/${match.id}` : null;
}

// ── Upload ────────────────────────────────────────────────────────────────────

function conversionDateTimeNow(): string {
  // Formato exigido: "yyyy-mm-dd hh:mm:ss+|-hh:mm" — usamos UTC
  const iso = new Date().toISOString(); // 2026-07-15T14:03:22.123Z
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

export type UploadResult = {
  attempted: boolean;
  success: boolean;
  status?: number;
  body?: string;
};

export async function uploadClickConversion(
  access: GoogleAdsAccess,
  conversionAction: string,
  clickIds: ClickIds,
  valor?: number | null,
): Promise<UploadResult> {
  const conversion: Record<string, unknown> = {
    conversionAction,
    conversionDateTime: conversionDateTimeNow(),
    conversionValue: valor && valor > 0 ? Number(valor.toFixed(2)) : 0,
    currencyCode: 'BRL',
  };
  // Só UM dos três click ids por conversão
  if (clickIds.gclid) conversion.gclid = clickIds.gclid;
  else if (clickIds.wbraid) conversion.wbraid = clickIds.wbraid;
  else if (clickIds.gbraid) conversion.gbraid = clickIds.gbraid;
  else return { attempted: false, success: false };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${access.token}`,
    'developer-token': DEV_TOKEN,
    'Content-Type': 'application/json',
  };
  if (access.loginCustomerId) headers['login-customer-id'] = access.loginCustomerId;

  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${access.customerId}:uploadClickConversions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      signal: AbortSignal.timeout(9000),
    },
  ).catch(() => null);

  if (!res) return { attempted: true, success: false, status: 0, body: 'fetch falhou' };
  const body = await res.text().catch(() => '');
  if (!res.ok) return { attempted: true, success: false, status: res.status, body };

  // partialFailure: 200 OK pode ainda conter erro por conversão (ex: gclid expirado)
  const hasPartialError = body.includes('partialFailureError');
  return { attempted: true, success: !hasPartialError, status: res.status, body };
}
