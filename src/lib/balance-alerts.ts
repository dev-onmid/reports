import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { sendText as sendWhatsapp, type ZApiClient } from '@/lib/zapi';

export type LowBalanceAlert = {
  clientId: string;
  clientName: string;
  platform: 'meta' | 'google';
  accountId: string;
  accountName: string;
  balance: number;
  spentYesterday: number;
  currency: string;
};

function yesterdayDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Meta Ads ────────────────────────────────────────────────────────────────

function centsToCurrency(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed / 100;
}

function calculateMetaAvailableBalance(account: { balance?: string; amount_spent?: string; spend_cap?: string }): number | null {
  const billAmountDue = centsToCurrency(account.balance) ?? 0;
  const amountSpent = centsToCurrency(account.amount_spent);
  const spendCap = centsToCurrency(account.spend_cap);
  if (spendCap !== null && spendCap > 0 && amountSpent !== null) {
    return Math.max(0, spendCap - amountSpent + billAmountDue);
  }
  return centsToCurrency(account.balance);
}

async function fetchMetaLowBalanceAlerts(): Promise<LowBalanceAlert[]> {
  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[];
  let links: { account_id: string; client_id: string; client_name: string }[];
  try {
    const { rows } = await pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'");
    conns = rows;
    const { rows: linkRows } = await pool.query(`
      SELECT cal.account_id, cal.client_id, c.name AS client_name
      FROM public.client_account_links cal
      JOIN public.clients c ON c.id = cal.client_id
      WHERE cal.platform IN ('meta', 'meta_ads')
    `);
    links = linkRows;
  } finally {
    await pool.end();
  }

  const linkMap = new Map(links.map(l => [l.account_id.replace(/^act_/, ''), { clientId: l.client_id, clientName: l.client_name }]));
  const yesterday = yesterdayDateStr();
  const results: LowBalanceAlert[] = [];

  await Promise.allSettled(conns.map(async (conn) => {
    const token = await getFreshMetaToken(conn);
    const acctRes = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,balance,amount_spent,spend_cap,currency&limit=100&access_token=${token}`,
    ).catch(() => null);
    if (!acctRes?.ok) return;
    const acctData = await acctRes.json() as {
      data?: Array<{ id: string; name: string; balance?: string; amount_spent?: string; spend_cap?: string; currency?: string; error?: { message: string } }>;
    };

    await Promise.allSettled((acctData.data ?? []).map(async (a) => {
      if (a.error) return;
      const normalizedId = a.id.replace(/^act_/, '');
      const link = linkMap.get(normalizedId);
      if (!link) return; // only alert for accounts linked to a client

      const balance = calculateMetaAvailableBalance(a);
      if (balance === null) return;

      const insightsUrl = new URL(`https://graph.facebook.com/v21.0/${a.id}/insights`);
      insightsUrl.searchParams.set('level', 'account');
      insightsUrl.searchParams.set('fields', 'spend');
      insightsUrl.searchParams.set('time_range', JSON.stringify({ since: yesterday, until: yesterday }));
      insightsUrl.searchParams.set('access_token', token);
      const insightsRes = await fetch(insightsUrl.toString()).catch(() => null);
      if (!insightsRes?.ok) return;
      const insightsData = await insightsRes.json() as { data?: { spend?: string }[] };
      const spentYesterday = parseFloat(insightsData.data?.[0]?.spend || '0');

      if (spentYesterday > 0 && balance < spentYesterday) {
        results.push({
          clientId: link.clientId, clientName: link.clientName,
          platform: 'meta', accountId: a.id, accountName: a.name,
          balance, spentYesterday, currency: a.currency ?? 'BRL',
        });
      }
    }));
  }));

  return results;
}

// ── Google Ads ──────────────────────────────────────────────────────────────

type GoogleConnectionRow = {
  id: string; email: string | null; access_token: string; refresh_token: string;
  token_expiry: string | null; account_type: string | null; status: string | null;
};

async function getFreshGoogleAccessToken(conn: GoogleConnectionRow): Promise<string> {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials.access_token ?? conn.access_token;
}

function makeGoogleAdsHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
  return headers;
}

async function gadsSearch(customerId: string, query: string, accessToken: string, developerToken: string, loginCustomerId?: string) {
  const res = await fetch(
    `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
    { method: 'POST', headers: makeGoogleAdsHeaders(accessToken, developerToken, loginCustomerId), body: JSON.stringify({ query }) },
  ).catch(() => null);
  if (!res?.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

type GAdsAccount = { id: string; name: string; currency: string; isManager: boolean; mccId?: string };

async function fetchCustomerInfo(customerId: string, accessToken: string, developerToken: string, loginCustomerId?: string): Promise<GAdsAccount | null> {
  const data = await gadsSearch(
    customerId,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1',
    accessToken, developerToken, loginCustomerId,
  );
  if (!data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customer = (data.results?.[0] as any)?.customer;
  if (!customer) return null;
  return { id: customerId, name: customer.descriptiveName ?? `Conta ${customerId}`, currency: customer.currencyCode ?? 'BRL', isManager: Boolean(customer.manager) };
}

async function fetchMccSubAccounts(mccId: string, accessToken: string, developerToken: string): Promise<GAdsAccount[]> {
  const data = await gadsSearch(
    mccId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.level
     FROM customer_client WHERE customer_client.level = 1`,
    accessToken, developerToken, mccId,
  );
  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((row: any) => row.customerClient).filter(Boolean).map((customer: any) => ({
    id: String(customer.id ?? ''), name: customer.descriptiveName ?? `Conta ${customer.id}`,
    currency: customer.currencyCode ?? 'BRL', isManager: Boolean(customer.manager), mccId,
  }));
}

async function fetchGoogleAccountBalance(customerId: string, accessToken: string, developerToken: string, loginCustomerId?: string): Promise<number | null> {
  const data = await gadsSearch(
    customerId,
    `SELECT account_budget.adjusted_spending_limit_micros, account_budget.amount_served_micros
     FROM account_budget WHERE account_budget.status = 'APPROVED'`,
    accessToken, developerToken, loginCustomerId,
  );
  if (!data?.results?.length) return null;
  let totalRemaining = 0;
  let hasFiniteBudget = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of data.results as any[]) {
    const budget = row.accountBudget;
    if (!budget) continue;
    const limitMicros = budget.adjustedSpendingLimitMicros;
    if (limitMicros == null) continue; // unlimited / postpaid — can't alert on this
    hasFiniteBudget = true;
    const served = Number(budget.amountServedMicros ?? 0);
    totalRemaining += Math.max(0, Number(limitMicros) - served);
  }
  if (!hasFiniteBudget) return null;
  return totalRemaining / 1_000_000;
}

async function fetchGoogleYesterdaySpend(customerId: string, accessToken: string, developerToken: string, loginCustomerId?: string): Promise<number> {
  const data = await gadsSearch(
    customerId,
    'SELECT metrics.cost_micros FROM customer WHERE segments.date DURING YESTERDAY',
    accessToken, developerToken, loginCustomerId,
  );
  if (!data?.results?.length) return 0;
  let total = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of data.results as any[]) total += Number(row.metrics?.costMicros ?? 0);
  return total / 1_000_000;
}

async function fetchGoogleLowBalanceAlerts(): Promise<LowBalanceAlert[]> {
  const pool = makeServerPool();
  let connections: GoogleConnectionRow[] = [];
  let links: { account_id: string; client_id: string; client_name: string }[] = [];
  try {
    const { rows } = await pool.query(`
      SELECT * FROM public.google_connections
      WHERE status = 'connected' AND COALESCE(account_type, 'google_ads') = 'google_ads'
    `);
    connections = rows as GoogleConnectionRow[];
    const { rows: linkRows } = await pool.query(`
      SELECT cal.account_id, cal.client_id, c.name AS client_name
      FROM public.client_account_links cal
      JOIN public.clients c ON c.id = cal.client_id
      WHERE cal.platform IN ('google', 'google_ads')
    `);
    links = linkRows;
  } finally {
    await pool.end();
  }

  const linkMap = new Map(links.map(l => [l.account_id.replace(/\D/g, ''), { clientId: l.client_id, clientName: l.client_name }]));
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';
  const results: LowBalanceAlert[] = [];
  const seen = new Set<string>();

  await Promise.allSettled(connections.map(async (conn) => {
    const accessToken = await getFreshGoogleAccessToken(conn);
    const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
      headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': developerToken },
    }).catch(() => null);
    if (!listRes?.ok) return;

    const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
    const topLevelResults = await Promise.allSettled(
      resourceNames.map((resourceName) => fetchCustomerInfo(resourceName.replace('customers/', ''), accessToken, developerToken)),
    );
    const topLevel = topLevelResults
      .filter((r): r is PromiseFulfilledResult<GAdsAccount> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value);

    const subAccountArrays = await Promise.allSettled(
      topLevel.filter((a) => a.isManager).map((a) => fetchMccSubAccounts(a.id, accessToken, developerToken)),
    );
    const subAccounts = subAccountArrays
      .filter((r): r is PromiseFulfilledResult<GAdsAccount[]> => r.status === 'fulfilled')
      .flatMap((r) => r.value);

    const seenTopIds = new Set(topLevel.map((a) => a.id));
    const accounts = [...topLevel, ...subAccounts.filter((a) => !seenTopIds.has(a.id))];

    await Promise.allSettled(accounts.map(async (account) => {
      if (!account.id || account.isManager) return;
      const normalizedId = account.id.replace(/\D/g, '');
      if (seen.has(normalizedId)) return;
      const link = linkMap.get(normalizedId);
      if (!link) return; // only alert for accounts linked to a client

      const balance = await fetchGoogleAccountBalance(normalizedId, accessToken, developerToken, account.mccId);
      if (balance === null) return;
      const spentYesterday = await fetchGoogleYesterdaySpend(normalizedId, accessToken, developerToken, account.mccId);

      if (spentYesterday > 0 && balance < spentYesterday) {
        seen.add(normalizedId);
        results.push({
          clientId: link.clientId, clientName: link.clientName,
          platform: 'google', accountId: normalizedId, accountName: account.name,
          balance, spentYesterday, currency: account.currency,
        });
      }
    }));
  }));

  return results;
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getLowBalanceAlerts(): Promise<LowBalanceAlert[]> {
  const [meta, gads] = await Promise.allSettled([fetchMetaLowBalanceAlerts(), fetchGoogleLowBalanceAlerts()]);
  const out: LowBalanceAlert[] = [];
  if (meta.status === 'fulfilled') out.push(...meta.value);
  if (gads.status === 'fulfilled') out.push(...gads.value);
  return out;
}

export function buildBalanceAlertMessage(alert: LowBalanceAlert): string {
  const platformLabel = alert.platform === 'meta' ? 'Meta Ads' : 'Google Ads';
  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: alert.currency || 'BRL' });
  return `🚨 *Saldo baixo — ${alert.clientName}*\n\n`
    + `Conta: ${alert.accountName} (${platformLabel})\n`
    + `Saldo disponível: ${fmt(alert.balance)}\n`
    + `Gasto de ontem: ${fmt(alert.spentYesterday)}\n\n`
    + `No ritmo de gasto de ontem, o saldo atual não é suficiente para cobrir mais um dia de campanhas ativas. Verifique o pagamento/recarga ainda hoje.`;
}

async function ensureAlertLogTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.balance_alerts_log (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id TEXT NOT NULL,
      alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (account_id, alert_date)
    );
  `);
}

// Sends one WhatsApp message per alert. Dedupes by (accountId, today) so the
// daily cron never double-alerts the same account if it runs twice — pass
// force:true (manual "test now" button) to bypass that and always resend.
export async function sendLowBalanceAlerts(
  zapi: ZApiClient,
  whatsappGroup: string,
  alerts: LowBalanceAlert[],
  opts: { force?: boolean } = {},
): Promise<{ sent: LowBalanceAlert[]; skipped: LowBalanceAlert[]; failed: LowBalanceAlert[] }> {
  const pool = makeServerPool();
  const sent: LowBalanceAlert[] = [];
  const skipped: LowBalanceAlert[] = [];
  const failed: LowBalanceAlert[] = [];
  try {
    await ensureAlertLogTable(pool);
    for (const alert of alerts) {
      if (opts.force) {
        await pool.query(`DELETE FROM public.balance_alerts_log WHERE account_id = $1 AND alert_date = CURRENT_DATE`, [alert.accountId]);
      }
      const { rowCount } = await pool.query(
        `INSERT INTO public.balance_alerts_log (account_id) VALUES ($1) ON CONFLICT (account_id, alert_date) DO NOTHING`,
        [alert.accountId],
      );
      if (!rowCount) { skipped.push(alert); continue; }
      const result = await sendWhatsapp(zapi, whatsappGroup, buildBalanceAlertMessage(alert));
      if (result.ok) sent.push(alert); else failed.push(alert);
    }
  } finally {
    await pool.end();
  }
  return { sent, skipped, failed };
}
