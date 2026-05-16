import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { makeServerPool } from '@/lib/server-db';

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

    const pool = makeServerPool();
    try {
      const { rows: existing } = await pool.query(
        `SELECT id FROM public.google_connections WHERE email = $1 AND account_type = $2 LIMIT 1`,
        [profile.email ?? '', state]
      );

      if (existing[0]) {
        // Update the existing connection in-place so client_account_links remain valid
        await pool.query(
          `UPDATE public.google_connections
           SET display_name=$1, picture=$2, access_token=$3,
               refresh_token = COALESCE($4, refresh_token),
               token_expiry=$5, scope=$6, status='connected'
           WHERE id=$7`,
          [
            profile.name ?? '',
            profile.picture ?? null,
            tokens.access_token ?? '',
            tokens.refresh_token ?? null,
            tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            tokens.scope ?? '',
            existing[0].id,
          ]
        );
      } else {
        await pool.query(
          `INSERT INTO public.google_connections (email, display_name, picture, access_token, refresh_token, token_expiry, scope, account_type, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'connected')`,
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
      }
    } finally {
      await pool.end();
    }

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
