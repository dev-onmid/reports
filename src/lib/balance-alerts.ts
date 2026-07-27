import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { sendText as sendZapiText, type ZApiClient } from '@/lib/zapi';
import { sendEvolutionText } from '@/lib/evolution-api';
import { sendGmail } from '@/lib/gmail';

/** Days of runway below which an account is considered at risk (UI-configurable). */
export const DEFAULT_DIAS_ANTECEDENCIA = 3;

/** How many days of history feed the "ritmo" (average daily spend). */
const RITMO_WINDOW_DAYS = 7;

export type AccountBalance = {
  clientId: string;
  clientName: string;
  platform: 'meta' | 'google';
  accountId: string;
  accountName: string;
  balance: number;
  spentYesterday: number;
  /** Spend pace used for the runway: max(7-day average, yesterday) — see computeRitmo. */
  ritmoDiario: number;
  /** balance / ritmoDiario, or null when the account had no spend in the window. */
  diasRestantes: number | null;
  currency: string;
};

/**
 * Spend pace behind the runway estimate.
 *
 * The 7-day average alone reacts too slowly to an account that just scaled up
 * (it would report days of runway that no longer exist), so we take whichever
 * of the average and yesterday is higher. Erring toward the higher pace means
 * warning a bit early, which is the cheap failure — the expensive one is
 * campaigns stopping because nobody was warned in time.
 */
export function computeRitmo(totalWindow: number, spentYesterday: number): number {
  const media = totalWindow / RITMO_WINDOW_DAYS;
  return Math.max(media, spentYesterday);
}

/** balance / pace, rounded to one decimal. null when the account isn't spending. */
export function computeDiasRestantes(balance: number, ritmoDiario: number): number | null {
  if (ritmoDiario <= 0) return null;
  return Math.round((balance / ritmoDiario) * 10) / 10;
}

/** Accounts whose runway is under the configured threshold, worst first. */
export function selectLowBalance(accounts: AccountBalance[], diasAntecedencia: number): AccountBalance[] {
  return accounts
    .filter(a => a.diasRestantes !== null && a.diasRestantes < diasAntecedencia)
    .sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0));
}

// Dates are resolved in America/Sao_Paulo: the cron fires at 07h BRT, and using
// the server's UTC clock would silently shift the window by a day for anyone
// looking at the numbers next to the Pagamentos screen.
function brtDateStr(daysAgo: number): string {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  brt.setUTCDate(brt.getUTCDate() - daysAgo);
  return brt.toISOString().split('T')[0];
}

function yesterdayDateStr(): string {
  return brtDateStr(1);
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

async function fetchMetaBalances(): Promise<AccountBalance[]> {
  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[];
  let links: { account_id: string; client_id: string; client_name: string; ads_billing_mode: string }[];
  try {
    const { rows } = await pool.query("SELECT * FROM public.meta_connections WHERE status = 'connected'");
    conns = rows;
    const { rows: linkRows } = await pool.query(`
      SELECT cal.account_id, cal.client_id, c.name AS client_name, c.ads_billing_mode
      FROM public.client_account_links cal
      JOIN public.clients c ON c.id = cal.client_id
      WHERE cal.platform IN ('meta', 'meta_ads')
    `);
    links = linkRows;
  } finally {
    await pool.end();
  }

  // Card-billed clients top up their own ad account — they're never "out of balance"
  // for our purposes, so they're excluded the same way the Pagamentos page excludes them.
  const linkMap = new Map(
    links
      .filter(l => (l.ads_billing_mode ?? 'prepaid') !== 'card')
      .map(l => [l.account_id.replace(/^act_/, ''), { clientId: l.client_id, clientName: l.client_name }]),
  );
  const yesterday = yesterdayDateStr();
  const windowStart = brtDateStr(RITMO_WINDOW_DAYS);
  const results: AccountBalance[] = [];

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

      // One daily-broken-down call covers both the pace window and yesterday —
      // cheaper than two round-trips, which matters against the 60s cron budget.
      const insightsUrl = new URL(`https://graph.facebook.com/v21.0/${a.id}/insights`);
      insightsUrl.searchParams.set('level', 'account');
      insightsUrl.searchParams.set('fields', 'spend');
      insightsUrl.searchParams.set('time_increment', '1');
      insightsUrl.searchParams.set('time_range', JSON.stringify({ since: windowStart, until: yesterday }));
      insightsUrl.searchParams.set('access_token', token);
      const insightsRes = await fetch(insightsUrl.toString()).catch(() => null);
      if (!insightsRes?.ok) return;
      const insightsData = await insightsRes.json() as { data?: { spend?: string; date_start?: string }[] };
      const days = insightsData.data ?? [];
      const totalWindow = days.reduce((sum, d) => sum + parseFloat(d.spend || '0'), 0);
      const spentYesterday = parseFloat(days.find(d => d.date_start === yesterday)?.spend || '0');
      const ritmoDiario = computeRitmo(totalWindow, spentYesterday);

      results.push({
        clientId: link.clientId, clientName: link.clientName,
        platform: 'meta', accountId: a.id, accountName: a.name,
        balance, spentYesterday, ritmoDiario,
        diasRestantes: computeDiasRestantes(balance, ritmoDiario),
        currency: a.currency ?? 'BRL',
      });
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

/** Daily spend over the pace window; returns the window total and yesterday alone. */
async function fetchGoogleSpendWindow(
  customerId: string, accessToken: string, developerToken: string,
  since: string, yesterday: string, loginCustomerId?: string,
): Promise<{ totalWindow: number; spentYesterday: number }> {
  const data = await gadsSearch(
    customerId,
    `SELECT metrics.cost_micros, segments.date FROM customer
     WHERE segments.date BETWEEN '${since}' AND '${yesterday}'`,
    accessToken, developerToken, loginCustomerId,
  );
  if (!data?.results?.length) return { totalWindow: 0, spentYesterday: 0 };
  let totalWindow = 0;
  let spentYesterday = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of data.results as any[]) {
    const cost = Number(row.metrics?.costMicros ?? 0) / 1_000_000;
    totalWindow += cost;
    if (row.segments?.date === yesterday) spentYesterday += cost;
  }
  return { totalWindow, spentYesterday };
}

async function fetchGoogleBalances(): Promise<AccountBalance[]> {
  const pool = makeServerPool();
  let connections: GoogleConnectionRow[] = [];
  let links: { account_id: string; client_id: string; client_name: string; ads_billing_mode: string }[] = [];
  try {
    const { rows } = await pool.query(`
      SELECT * FROM public.google_connections
      WHERE status = 'connected' AND COALESCE(account_type, 'google_ads') = 'google_ads'
    `);
    connections = rows as GoogleConnectionRow[];
    const { rows: linkRows } = await pool.query(`
      SELECT cal.account_id, cal.client_id, c.name AS client_name, c.ads_billing_mode
      FROM public.client_account_links cal
      JOIN public.clients c ON c.id = cal.client_id
      WHERE cal.platform IN ('google', 'google_ads')
    `);
    links = linkRows;
  } finally {
    await pool.end();
  }

  // Card-billed clients top up their own ad account — excluded, same criteria as Pagamentos.
  const linkMap = new Map(
    links
      .filter(l => (l.ads_billing_mode ?? 'prepaid') !== 'card')
      .map(l => [l.account_id.replace(/\D/g, ''), { clientId: l.client_id, clientName: l.client_name }]),
  );
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';
  const yesterday = yesterdayDateStr();
  const windowStart = brtDateStr(RITMO_WINDOW_DAYS);
  const results: AccountBalance[] = [];
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
      const { totalWindow, spentYesterday } = await fetchGoogleSpendWindow(
        normalizedId, accessToken, developerToken, windowStart, yesterday, account.mccId,
      );
      const ritmoDiario = computeRitmo(totalWindow, spentYesterday);

      seen.add(normalizedId);
      results.push({
        clientId: link.clientId, clientName: link.clientName,
        platform: 'google', accountId: normalizedId, accountName: account.name,
        balance, spentYesterday, ritmoDiario,
        diasRestantes: computeDiasRestantes(balance, ritmoDiario),
        currency: account.currency,
      });
    }));
  }));

  return results;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Every prepaid, client-linked ad account with a finite balance, annotated with
 * its spend pace and runway. Deliberately unfiltered: the runway threshold is
 * per-destination, so one fetch can feed several configs with different rules.
 */
export async function getAccountBalances(): Promise<AccountBalance[]> {
  const [meta, gads] = await Promise.allSettled([fetchMetaBalances(), fetchGoogleBalances()]);
  const out: AccountBalance[] = [];
  if (meta.status === 'fulfilled') out.push(...meta.value);
  if (gads.status === 'fulfilled') out.push(...gads.value);
  return out;
}

/** WhatsApp destination. Evolution and Z-API instances both live in zapi_clients. */
export type WhatsAppTarget =
  | { provider: 'evolution'; instanceName: string; group: string }
  | { provider: 'zapi'; zapi: ZApiClient; group: string };

async function sendToTarget(target: WhatsAppTarget, message: string) {
  return target.provider === 'evolution'
    ? sendEvolutionText(target.instanceName, target.group, message)
    : sendZapiText(target.zapi, target.group, message);
}

const fmtMoney = (n: number, currency: string) =>
  n.toLocaleString('pt-BR', { style: 'currency', currency: currency || 'BRL' });

function fmtRunway(dias: number | null): string {
  if (dias === null) return 'sem gasto recente';
  if (dias < 1) return 'menos de 1 dia';
  return `~${dias.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

/** One aggregated message for every account at risk — a bad day used to mean one message per account. */
export function buildBalanceAlertMessage(alerts: AccountBalance[], diasAntecedencia: number): string {
  const header = alerts.length === 1
    ? '🚨 *Saldo baixo — 1 conta de anúncio*'
    : `🚨 *Saldo baixo — ${alerts.length} contas de anúncio*`;

  const blocks = alerts.map((a) => {
    const platformLabel = a.platform === 'meta' ? 'Meta Ads' : 'Google Ads';
    return `*${a.clientName}* — ${platformLabel}\n`
      + `Conta: ${a.accountName}\n`
      + `Saldo: ${fmtMoney(a.balance, a.currency)}  ·  Dura ${fmtRunway(a.diasRestantes)}\n`
      + `Ritmo: ${fmtMoney(a.ritmoDiario, a.currency)}/dia (ontem: ${fmtMoney(a.spentYesterday, a.currency)})`;
  });

  return `${header}\n\n${blocks.join('\n\n')}\n\n`
    + `_Régua: avisar quando o saldo cobrir menos de ${diasAntecedencia} dia(s) no ritmo atual. Recarregue para as campanhas não pararem._`;
}

export function buildBalanceAlertEmail(alerts: AccountBalance[], diasAntecedencia: number) {
  const subject = alerts.length === 1
    ? `[ONMID] Saldo baixo: ${alerts[0].clientName}`
    : `[ONMID] Saldo baixo em ${alerts.length} contas de anúncio`;

  const rows = alerts.map((a) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${a.clientName}</strong></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${a.platform === 'meta' ? 'Meta Ads' : 'Google Ads'}<br><span style="color:#666;font-size:12px">${a.accountName}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${fmtMoney(a.balance, a.currency)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#c00"><strong>${fmtRunway(a.diasRestantes)}</strong></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${fmtMoney(a.ritmoDiario, a.currency)}/dia</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px">
      <h2 style="margin:0 0 4px">Saldo baixo em conta de anúncio</h2>
      <p style="color:#666;margin:0 0 16px">Régua: avisar quando o saldo cobrir menos de ${diasAntecedencia} dia(s) no ritmo atual.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5;text-align:left">
            <th style="padding:8px 12px">Cliente</th><th style="padding:8px 12px">Conta</th>
            <th style="padding:8px 12px">Saldo</th><th style="padding:8px 12px">Dura</th><th style="padding:8px 12px">Ritmo</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#666;font-size:12px;margin-top:16px">Alerta automático da plataforma ONMID Reports.</p>
    </div>`;

  const text = alerts.map(a =>
    `${a.clientName} (${a.platform === 'meta' ? 'Meta' : 'Google'} — ${a.accountName}): saldo ${fmtMoney(a.balance, a.currency)}, dura ${fmtRunway(a.diasRestantes)}, ritmo ${fmtMoney(a.ritmoDiario, a.currency)}/dia`,
  ).join('\n');

  return { subject, html, text };
}

async function ensureAlertLogTable(pool: ReturnType<typeof makeServerPool>) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.balance_alerts_log (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id TEXT NOT NULL,
      alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.balance_alerts_log ADD COLUMN IF NOT EXISTS config_id TEXT NOT NULL DEFAULT '';
  `);
  // The original key was (account_id, alert_date), which made the first
  // destination consume the day's slot and left every other configured group
  // silent. Dedupe is per destination.
  await pool.query(`ALTER TABLE public.balance_alerts_log DROP CONSTRAINT IF EXISTS balance_alerts_log_account_id_alert_date_key`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS balance_alerts_log_account_config_date_key
                      ON public.balance_alerts_log (account_id, config_id, alert_date)`);
}

export type SendBalanceResult = {
  whatsapp: string;
  email: string;
  alerted: AccountBalance[];
  skipped: AccountBalance[];
  totalChecked: number;
};

/**
 * Sends one aggregated alert per destination for the accounts whose runway is
 * under `diasAntecedencia` and that weren't alerted today.
 *
 * The dedupe row is written only after a successful send: the previous version
 * inserted first, so a failed WhatsApp call silently swallowed the alert for a
 * full day. Pass force:true (the "test now" button) to bypass the dedupe.
 */
export async function sendBalanceAlerts(
  target: WhatsAppTarget,
  accounts: AccountBalance[],
  opts: { configId: string; diasAntecedencia?: number; emailTo?: string; force?: boolean },
): Promise<SendBalanceResult> {
  const dias = opts.diasAntecedencia ?? DEFAULT_DIAS_ANTECEDENCIA;
  const atRisk = selectLowBalance(accounts, dias);
  const result: SendBalanceResult = {
    whatsapp: 'skipped', email: 'skipped',
    alerted: [], skipped: [], totalChecked: accounts.length,
  };
  if (atRisk.length === 0) return result;

  const pool = makeServerPool();
  try {
    await ensureAlertLogTable(pool);

    const { rows: alreadySent } = await pool.query<{ account_id: string }>(
      `SELECT account_id FROM public.balance_alerts_log
        WHERE config_id = $1 AND alert_date = CURRENT_DATE`,
      [opts.configId],
    );
    const seenToday = new Set(alreadySent.map(r => r.account_id));

    const novos = opts.force ? atRisk : atRisk.filter(a => !seenToday.has(a.accountId));
    result.skipped = atRisk.filter(a => !novos.includes(a));
    if (novos.length === 0) return result;

    const wa = await sendToTarget(target, buildBalanceAlertMessage(novos, dias));
    result.whatsapp = wa.ok ? 'enviado' : `falhou: ${wa.error ?? 'erro desconhecido'}`;

    const to = opts.emailTo ?? process.env.WEBSHARE_ALERT_EMAIL ?? '';
    let emailOk = false;
    if (to) {
      const { rows: gmailRows } = await pool.query<{ email: string; refresh_token: string }>(
        `SELECT email, refresh_token FROM public.google_connections
          WHERE account_type = 'gmail' AND status = 'connected' AND refresh_token IS NOT NULL
          LIMIT 1`,
      );
      if (gmailRows[0]) {
        const { subject, html, text } = buildBalanceAlertEmail(novos, dias);
        const r = await sendGmail({ email: gmailRows[0].email, refreshToken: gmailRows[0].refresh_token }, { to, subject, html, text });
        emailOk = r.ok;
        result.email = r.ok ? `enviado para ${to}` : `falhou: ${r.error ?? 'erro desconhecido'}`;
      } else {
        result.email = 'nenhuma conta Gmail conectada';
      }
    }

    // Only burn the daily slot if the warning actually reached someone.
    if (wa.ok || emailOk) {
      result.alerted = novos;
      for (const a of novos) {
        await pool.query(
          `INSERT INTO public.balance_alerts_log (account_id, config_id) VALUES ($1, $2)
             ON CONFLICT (account_id, config_id, alert_date) DO NOTHING`,
          [a.accountId, opts.configId],
        );
      }
    }

    return result;
  } finally {
    await pool.end();
  }
}
