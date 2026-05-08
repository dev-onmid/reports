import { Pool } from 'pg';

function makePool() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL ?? process.env.POSTGRES_PRISMA_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }

  return new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DATABASE ?? 'postgres',
    user: process.env.POSTGRES_USER,
    password: process.env.SUPABASE_DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

export async function GET() {
  const pool = makePool();
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
