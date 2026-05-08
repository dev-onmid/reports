import type { NextRequest } from 'next/server';
import { Pool } from 'pg';

function makePool() {
  return new Pool({
    host: 'aws-1-us-east-2.pooler.supabase.com',
    port: 6543,
    database: 'postgres',
    user: 'postgres.iremmorsgwiqrorzoihx',
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const pool = makePool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.client_account_links WHERE client_id = $1 ORDER BY created_at ASC',
      [clientId]
    );
    return Response.json(rows.map((r) => ({
      id: r.id,
      clientId: r.client_id,
      platform: r.platform,
      connectionId: r.connection_id,
      accountId: r.account_id,
      accountName: r.account_name,
      currency: r.currency,
      createdAt: r.created_at,
    })));
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const body = await req.json() as { platform: string; connectionId?: string; accountId: string; accountName?: string; currency?: string };
  const { platform, connectionId, accountId, accountName, currency } = body;
  if (!platform || !accountId) return Response.json({ error: 'Missing required fields' }, { status: 400 });

  const pool = makePool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.client_account_links (client_id, platform, connection_id, account_id, account_name, currency)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [clientId, platform, connectionId ?? null, accountId, accountName ?? null, currency ?? 'BRL']
    );
    if (!rows[0]) return Response.json({ error: 'Already linked' }, { status: 409 });
    return Response.json({ id: rows[0].id }, { status: 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const linkId = req.nextUrl.searchParams.get('linkId');
  if (!linkId) return Response.json({ error: 'Missing linkId' }, { status: 400 });

  const pool = makePool();
  try {
    await pool.query(
      'DELETE FROM public.client_account_links WHERE id = $1 AND client_id = $2',
      [linkId, clientId]
    );
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
