import { makeServerPool } from '@/lib/server-db';

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, currency, balance
       FROM public.google_ads_accounts
       ORDER BY name ASC`
    );
    return Response.json(rows.map((row) => ({
      id: row.id,
      name: row.name,
      currency: row.currency ?? 'BRL',
      balance: row.balance === null ? null : Number(row.balance),
      error: null,
    })));
  } finally {
    await pool.end();
  }
}
