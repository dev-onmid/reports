import { makeServerPool } from '@/lib/server-db';

export type AccountBalance = {
  id: string;
  name: string;
  currency: string;
  balance: number | null;
  error: string | null;
  connectionId: string;
  connectionName: string;
};

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
        `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,balance,currency&limit=100&access_token=${token}`
      );
      if (!acctRes.ok) return;
      const acctData = await acctRes.json() as {
        data?: Array<{ id: string; name: string; balance?: string; currency?: string; error?: { message: string } }>;
      };

      for (const a of acctData.data ?? []) {
        if (a.error) {
          results.push({ id: a.id, name: a.name, currency: a.currency ?? 'BRL', balance: null, error: a.error.message, connectionId: connId, connectionName: connName });
        } else {
          // Meta returns balance in cents
          results.push({
            id: a.id,
            name: a.name,
            currency: a.currency ?? 'BRL',
            balance: a.balance != null ? parseInt(a.balance, 10) / 100 : null,
            error: null,
            connectionId: connId,
            connectionName: connName,
          });
        }
      }
    })
  );

  return Response.json(results);
}
