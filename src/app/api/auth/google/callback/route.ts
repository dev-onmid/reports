import type { NextRequest } from 'next/server';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state') ?? 'gmb';
  const oauthError = request.nextUrl.searchParams.get('error');
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  if (oauthError || !code) {
    const msg = oauthError ?? 'cancelled';
    return Response.redirect(`${appUrl}/integracoes?google_error=${encodeURIComponent(msg)}`);
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

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { error: dbError } = await supabase.from('google_connections').insert({
      email: profile.email ?? '',
      display_name: profile.name ?? '',
      picture: profile.picture ?? null,
      access_token: tokens.access_token ?? '',
      refresh_token: tokens.refresh_token ?? '',
      token_expiry: tokens.expiry_date
        ? new Date(tokens.expiry_date).toISOString()
        : null,
      scope: tokens.scope ?? '',
      account_type: state,
      status: 'connected',
    });

    if (dbError) {
      console.error('Erro ao salvar conexão Google:', dbError);
      return Response.redirect(
        `${appUrl}/integracoes?google_error=${encodeURIComponent(dbError.message)}`
      );
    }

    return Response.redirect(
      `${appUrl}/integracoes?google_connected=1&type=${encodeURIComponent(state)}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('Erro no callback Google OAuth:', err);
    return Response.redirect(
      `${appUrl}/integracoes?google_error=${encodeURIComponent(msg)}`
    );
  }
}
