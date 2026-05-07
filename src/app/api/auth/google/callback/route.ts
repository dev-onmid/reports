import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { Pool } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: 'db.iremmorsgwiqrorzoihx.supabase.co',
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: process.env.SUPABASE_DB_PASSWORD,
      ssl: { rejectUnauthorized: false },
      max: 1,
    });
  }
  return pool;
}

function popupHtml(script: string, message: string) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Google OAuth</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;font-size:14px;}</style>
    </head><body><p>${message}</p><script>${script}<\/script></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state') ?? 'gmb';
  const oauthError = request.nextUrl.searchParams.get('error');
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (oauthError || !code) {
    const msg = oauthError ?? 'cancelled';
    return popupHtml(
      `if(window.opener){window.opener.postMessage({type:'google_oauth_error',error:${JSON.stringify(msg)}},'*');window.close();}else{window.location.href=${JSON.stringify(appUrl + '/integracoes?google_error=' + encodeURIComponent(msg))}}`,
      'Erro na conexão. Fechando...'
    );
  }

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      `${appUrl}/api/auth/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    const db = getPool();
    await db.query(
      `INSERT INTO public.google_connections
        (email, display_name, picture, access_token, refresh_token, token_expiry, scope, account_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'connected')`,
      [
        profile.email ?? '',
        profile.name ?? '',
        profile.picture ?? null,
        tokens.access_token ?? '',
        tokens.refresh_token ?? '',
        tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        tokens.scope ?? '',
        state,
      ]
    );

    return popupHtml(
      `if(window.opener){window.opener.postMessage({type:'google_oauth_success',accountType:${JSON.stringify(state)}},'*');window.close();}else{window.location.href=${JSON.stringify(appUrl + '/integracoes?google_connected=1&type=' + encodeURIComponent(state))}}`,
      'Conectado com sucesso! Fechando...'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('Erro no callback Google OAuth:', err);
    return popupHtml(
      `if(window.opener){window.opener.postMessage({type:'google_oauth_error',error:${JSON.stringify(msg)}},'*');window.close();}else{window.location.href=${JSON.stringify(appUrl + '/integracoes?google_error=' + encodeURIComponent(msg))}}`,
      'Erro inesperado. Fechando...'
    );
  }
}
