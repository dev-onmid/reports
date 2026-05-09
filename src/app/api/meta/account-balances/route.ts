import { makeServerPool } from '@/lib/server-db';

export type AccountBalance = {
  id: string;
  name: string;
  currency: string;
  balance: number | null;
  error: string | null;
  connectionId: string;
  connectionName: string;
  source?: 'spend_cap' | 'balance';
};

function centsToCurrency(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed / 100;
}

function calculateMetaAvailableBalance(account: {
  balance?: string;
  amount_spent?: string;
  spend_cap?: string;
}): { balance: number | null; source: 'spend_cap' | 'balance' } {
  const billAmountDue = centsToCurrency(account.balance) ?? 0;
  const amountSpent = centsToCurrency(account.amount_spent);
  const spendCap = centsToCurrency(account.spend_cap);

  if (spendCap !== null && spendCap > 0 && amountSpent !== null) {
    return {
      balance: Math.max(0, spendCap - amountSpent + billAmountDue),
      source: 'spend_cap',
    };
  }

  return {
    balance: centsToCurrency(account.balance),
    source: 'balance',
  };
}

export async function GET() {
  const pool = makeServerPool();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conns: any[];
  try {
    const { rows } = await pool.query(
      "SELECT * FROM public.meta_connections WHERE status = 'connected'"
    );
    conns = rows;
  } finally {
    await pool.end();
  }

  const results: AccountBalance[] = [];

  await Promise.allSettled(
    conns.map(async (conn) => {
      const token = conn.access_token as string;
      const connId = conn.id as string;
      const connName = (conn.user_name ?? conn.label ?? '') as string;

      const acctRes = await fetch(
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,balance,amount_spent,spend_cap,currency&limit=100&access_token=${token}`
      );
      if (!acctRes.ok) return;
      const acctData = await acctRes.json() as {
        data?: Array<{
          id: string;
          name: string;
          balance?: string;
          amount_spent?: string;
          spend_cap?: string;
          currency?: string;
          error?: { message: string };
        }>;
      };

      for (const a of acctData.data ?? []) {
        if (a.error) {
          results.push({ id: a.id, name: a.name, currency: a.currency ?? 'BRL', balance: null, error: a.error.message, connectionId: connId, connectionName: connName });
        } else {
          const calculated = calculateMetaAvailableBalance(a);

          results.push({
            id: a.id,
            name: a.name,
            currency: a.currency ?? 'BRL',
            balance: calculated.balance,
            error: null,
            connectionId: connId,
            connectionName: connName,
            source: calculated.source,
          });
        }
      }
    })
  );

  return Response.json(results);
}
