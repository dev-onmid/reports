import type { NextRequest } from 'next/server';
import { receberWebhook, testarWebhook } from '@/lib/webhook-entrada-receptor';

/**
 * Endereço canônico dos webhooks de entrada de lead.
 *
 * Casca fina de propósito: a lógica inteira mora em
 * `@/lib/webhook-entrada-receptor`, porque `/api/integrations/datalytics/`
 * serve EXATAMENTE o mesmo handler (ver o alias lá). Duas implementações
 * divergiriam na primeira mudança, e a que quebraria em silêncio seria a
 * antiga — a que já está colada em painel de cliente.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return receberWebhook(req, token);
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  return testarWebhook(token);
}
