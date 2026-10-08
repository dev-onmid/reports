import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import { ensureMetaWebhookConfig } from '@/lib/meta-whatsapp';

// O que se cola no painel da Meta (App → WhatsApp → Configuração → Webhook):
// a URL de callback e o token de verificação. Rota atrás do login de propósito.
export async function GET(req: NextRequest) {
  const pool = makeServerPool();
  try {
    const verifyToken = await ensureMetaWebhookConfig(pool);
    return Response.json({
      callback_url: `${webhookOrigin(req.url)}/api/webhook/whatsapp-oficial`,
      verify_token: verifyToken,
      app_secret_configurado: Boolean(process.env.META_APP_SECRET),
    });
  } finally {
    await pool.end();
  }
}
