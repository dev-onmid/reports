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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    clientId: r.client_id,
    platform: r.platform,
    connectionId: r.connection_id ?? undefined,
    accountId: r.account_id,
    accountName: r.account_name ?? undefined,
    currency: r.currency ?? 'BRL',
    createdAt: r.created_at,
  };
}

export async function GET() {
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.client_account_links ORDER BY created_at ASC'
    );
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}
