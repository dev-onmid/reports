import type { NextRequest } from 'next/server';
import { receberWebhook, testarWebhook } from '@/lib/webhook-entrada-receptor';

/**
 * Endereço ORIGINAL dos webhooks de entrada, de quando a integração se chamava
 * só "Datalytics". Continua valendo para sempre.
 *
 * ⚠️ Não remover. Existe URL neste formato colada no painel de cliente em
 * produção, recebendo lead todo dia; o token é o mesmo, então o endereço novo
 * (`/api/integrations/webhook/{token}`) e este respondem igual. Trocar a URL
 * lá fora é trabalho do gestor, no tempo dele — e mesmo depois, nada garante
 * que não sobrou uma integração esquecida apontando para cá.
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
