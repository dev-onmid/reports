import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';
import { getCached, setCached, cachedJson, TTL_4H } from '@/lib/api-cache';

type GoogleConnectionRow = {
  id: string;
  email: string | null;
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
  account_type: string | null;
  status: string | null;
};

type GoogleAdsAccountBalance = {
  id: string;
  name: string;
  currency: string;
  balance: number | null;
  error: string | null;
  connectionId: string;
  connectionName: string;
  isManager: boolean;
};

type GoogleAdsAccountBase = Omit<GoogleAdsAccountBalance, 'balance' | 'error' | 'connectionId' | 'connectionName'> & {
  mccId?: string;
};

async function getFreshAccessToken(conn: GoogleConnectionRow): Promise<string> {
  if (conn.token_expiry) {
    const expiry = new Date(conn.token_expiry).getTime();
    if (expiry > Date.now() + 5 * 60 * 1000) return conn.access_token;
  }

  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: conn.refresh_token });
  const { credentials } = await oauth2Client.refreshAccessToken();
  return credentials.access_token ?? conn.access_token;
}

function makeHeaders(accessToken: string, developerToken: string, loginCustomerId?: string) {
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
    {
      method: 'POST',
      headers: makeHeaders(accessToken, developerToken, loginCustomerId),
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) return null;
  return res.json() as Promise<{ results?: Record<string, unknown>[] }>;
}

async function fetchCustomerInfo(
  customerId: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string
): Promise<GoogleAdsAccountBase | null> {
  const data = await gadsSearch(
    customerId,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.status, customer.manager FROM customer LIMIT 1',
    accessToken,
    developerToken,
    loginCustomerId
  );
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customer = (data.results?.[0] as any)?.customer;
  if (!customer) return null;

  return {
    id: customerId,
    name: customer.descriptiveName ?? `Conta ${customerId}`,
    currency: customer.currencyCode ?? 'BRL',
    isManager: Boolean(customer.manager),
  };
}

async function fetchMccSubAccounts(
  mccId: string,
  accessToken: string,
  developerToken: string
): Promise<GoogleAdsAccountBase[]> {
  const data = await gadsSearch(
    mccId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
            customer_client.status, customer_client.manager, customer_client.level
     FROM customer_client
     WHERE customer_client.level = 1`,
    accessToken,
    developerToken,
    mccId
  );
  if (!data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data.results ?? []).map((row: any) => row.customerClient).filter(Boolean).map((customer: any) => ({
    id: String(customer.id ?? ''),
    name: customer.descriptiveName ?? `Conta ${customer.id}`,
    currency: customer.currencyCode ?? 'BRL',
    isManager: Boolean(customer.manager),
    mccId,
  }));
}

async function fetchAccountBalance(
  customerId: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string
): Promise<number | null> {
  const data = await gadsSearch(
    customerId,
    `SELECT account_budget.adjusted_spending_limit_micros, account_budget.amount_served_micros
     FROM account_budget
     WHERE account_budget.status = 'APPROVED'`,
    accessToken,
    developerToken,
    loginCustomerId
  );
  if (!data?.results?.length) return null;

  let totalRemaining = 0;
  let hasFiniteBudget = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of data.results as any[]) {
    const budget = row.accountBudget;
    if (!budget) continue;
    const limitMicros = budget.adjustedSpendingLimitMicros;
    if (limitMicros == null) continue; // unlimited / postpaid
    hasFiniteBudget = true;
    const served = Number(budget.amountServedMicros ?? 0);
    totalRemaining += Math.max(0, Number(limitMicros) - served);
  }

  if (!hasFiniteBudget) return null;
  return totalRemaining / 1_000_000;
}

export async function GET() {
  const cacheKey = 'google:account-balances';
  const cached = getCached(cacheKey);
  if (cached) return cachedJson(cached.data, true, cached.cachedAt);

  const pool = makeServerPool();
  let connections: GoogleConnectionRow[] = [];

  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM public.google_connections
       WHERE status = 'connected'
         AND COALESCE(account_type, 'google_ads') = 'google_ads'
       ORDER BY connected_at DESC`
    );
    connections = rows as GoogleConnectionRow[];
  } finally {
    await pool.end();
  }

  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? '1vR8GhAk4UMZoPaqo7Qq8Q';
  const accountMap = new Map<string, GoogleAdsAccountBalance>();

  await Promise.allSettled(
    connections.map(async (conn) => {
      const accessToken = await getFreshAccessToken(conn);
      const listRes = await fetch('https://googleads.googleapis.com/v24/customers:listAccessibleCustomers', {
        headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': developerToken },
      });
      if (!listRes.ok) return;

      const { resourceNames = [] } = await listRes.json() as { resourceNames?: string[] };
      const settledTopLevel = (
        await Promise.allSettled(
          resourceNames.map((resourceName) => fetchCustomerInfo(resourceName.replace('customers/', ''), accessToken, developerToken))
        )
      )
        .filter((result): result is PromiseFulfilledResult<GoogleAdsAccountBase> => result.status === 'fulfilled' && result.value !== null)
        .map((result) => result.value);
      const topLevel = settledTopLevel.filter((account): account is GoogleAdsAccountBase => account !== null);

      const subAccountArrays = await Promise.allSettled(
        topLevel.filter((account) => account.isManager).map((account) => fetchMccSubAccounts(account.id, accessToken, developerToken))
      );
      const subAccounts = subAccountArrays
        .filter((result): result is PromiseFulfilledResult<GoogleAdsAccountBase[]> => result.status === 'fulfilled')
        .flatMap((result) => result.value);

      const seenTopIds = new Set(topLevel.map((account) => account.id));
      const accounts = [...topLevel, ...subAccounts.filter((account) => !seenTopIds.has(account.id))];

      await Promise.allSettled(
        accounts.map(async (account) => {
          if (!account.id || account.isManager) return;
          const normalizedId = account.id.replace(/\D/g, '');
          const balance = await fetchAccountBalance(normalizedId, accessToken, developerToken, account.mccId);
          accountMap.set(normalizedId, {
            ...account,
            id: normalizedId,
            balance,
            error: null,
            connectionId: conn.id,
            connectionName: conn.email ?? 'Google Ads',
          });
        })
      );
    })
  );

  const result = [...accountMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  setCached(cacheKey, result, TTL_4H);
  return cachedJson(result, false);
}
