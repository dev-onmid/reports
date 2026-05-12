import { makeServerPool } from '@/lib/server-db';

type MetaConnRow = {
  id: string;
  app_id: string;
  access_token: string;
  token_expiry: string | null;
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

async function exchangeForLongLived(appId: string, appSecret: string, token: string): Promise<{ token: string; expiresAt: Date } | null> {
  const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  if (!data.access_token) return null;
  const expiresIn = Number(data.expires_in ?? 5184000); // 60 days default
  return { token: data.access_token, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export async function exchangeAndSaveMetaToken(connId: string, appId: string, shortLivedToken: string): Promise<string> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return shortLivedToken;

  const result = await exchangeForLongLived(appId, appSecret, shortLivedToken);
  if (!result) return shortLivedToken;

  const pool = makeServerPool();
  try {
    await pool.query(
      'UPDATE meta_connections SET access_token = $1, token_expiry = $2 WHERE id = $3',
      [result.token, result.expiresAt, connId]
    );
  } finally {
    await pool.end();
  }
  return result.token;
}

export async function getFreshMetaToken(conn: MetaConnRow): Promise<string> {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !conn.token_expiry) return conn.access_token;

  const expiresAt = new Date(conn.token_expiry).getTime();

  // Token already expired — can't refresh, user must reconnect
  if (expiresAt < Date.now()) return conn.access_token;

  // Token expires in more than 7 days — no refresh needed
  if (expiresAt > Date.now() + SEVEN_DAYS_MS) return conn.access_token;

  // Within 7-day window: proactively refresh
  const result = await exchangeForLongLived(conn.app_id, appSecret, conn.access_token);
  if (!result) return conn.access_token;

  const pool = makeServerPool();
  try {
    await pool.query(
      'UPDATE meta_connections SET access_token = $1, token_expiry = $2 WHERE id = $3',
      [result.token, result.expiresAt, conn.id]
    );
  } finally {
    await pool.end();
  }
  return result.token;
}
