import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { exchangeAndSaveMetaToken } from '@/lib/meta-token';

function normalizeMetaAccountId(accountId: string) {
  return accountId.replace(/^act_/, '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToJson(r: any) {
  return {
    id: r.id,
    label: r.label ?? '',
    status: r.status ?? 'connected',
    appId: r.app_id ?? '',
    accessToken: r.access_token ?? '',
    userId: r.user_id ?? '',
    userName: r.user_name ?? '',
    userPicture: r.user_picture ?? null,
    connectedAt: r.connected_at ?? new Date().toISOString(),
    tokenExpiry: r.token_expiry ?? null,
  };
}

async function syncClientLinksToConnection(connectionId: string, accessToken: string) {
  const accountsRes = await fetch(
    `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,currency&limit=200&access_token=${accessToken}`
  );
  if (!accountsRes.ok) return;

  const data = await accountsRes.json() as { data?: Array<{ id: string; name?: string; currency?: string }> };
  const accounts = data.data ?? [];
  if (accounts.length === 0) return;

  const pool = makeServerPool();
  try {
    await Promise.allSettled(
      accounts.map((account) => pool.query(
        `UPDATE public.client_account_links
         SET connection_id = $1,
             account_name = COALESCE(NULLIF(account_name, ''), $2),
             currency = COALESCE(NULLIF(currency, ''), $3)
         WHERE platform = 'meta_ads'
           AND regexp_replace(account_id, '^act_', '') = $4`,
        [connectionId, account.name ?? account.id, account.currency ?? 'BRL', normalizeMetaAccountId(account.id)]
      ))
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42P01' && code !== '42703') throw error;
  } finally {
    await pool.end();
  }
}

export async function GET() {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      'SELECT * FROM public.meta_connections ORDER BY connected_at DESC'
    );
    return Response.json(rows.map(rowToJson));
  } finally {
    await pool.end();
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    label: string; status: string; appId: string;
    accessToken: string; userId: string; userName: string; userPicture?: string;
  };
  const pool = makeServerPool();
  try {
    const existing = body.userId
      ? await pool.query('SELECT id FROM public.meta_connections WHERE user_id = $1 ORDER BY connected_at DESC LIMIT 1', [body.userId])
      : { rows: [] };

    const { rows } = existing.rows[0]
      ? await pool.query(
        `UPDATE public.meta_connections
         SET label = $1,
             status = $2,
             app_id = $3,
             access_token = $4,
             user_name = $5,
             user_picture = $6,
             connected_at = NOW(),
             token_expiry = NULL
         WHERE id = $7
         RETURNING *`,
        [body.label, body.status, body.appId, body.accessToken, body.userName, body.userPicture ?? null, existing.rows[0].id]
      )
      : await pool.query(
        `INSERT INTO public.meta_connections (label, status, app_id, access_token, user_id, user_name, user_picture)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [body.label, body.status, body.appId, body.accessToken, body.userId, body.userName, body.userPicture ?? null]
      );

    const saved = rowToJson(rows[0]);

    // Exchange short-lived token for long-lived (60 days) — runs async, doesn't block response
    exchangeAndSaveMetaToken(saved.id, body.appId, body.accessToken).catch(console.error);

    await syncClientLinksToConnection(saved.id, body.accessToken);
    return Response.json(saved, { status: existing.rows[0] ? 200 : 201 });
  } finally {
    await pool.end();
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const pool = makeServerPool();
  try {
    await pool.query('DELETE FROM public.meta_connections WHERE id = $1', [id]);
    return new Response(null, { status: 204 });
  } finally {
    await pool.end();
  }
}
