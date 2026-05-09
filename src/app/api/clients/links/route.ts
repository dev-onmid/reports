import { makeServerPool } from '@/lib/server-db';

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
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.client_account_links ORDER BY created_at ASC'
    );
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}
