import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import {
  listarWebhooks, criarWebhook, atualizarWebhook, excluirWebhook,
  listarLogsWebhook, normalizarNomeWebhook, type WebhookEntrada,
} from '@/lib/webhook-entrada-server';

/**
 * Webhooks de entrada de lead do cliente (auth = deny-by-default do proxy).
 *
 * ⚠️ O GET NÃO cria nada. A versão anterior fazia lazy-create ("abrir a aba já
 * gera o token") e o resultado foi 6 das 7 conexões de produção existirem sem
 * nunca ter recebido um único lead — alguém abriu a aba uma vez. Webhook agora
 * nasce no POST, quando o gestor decide criar.
 */

/**
 * ⚠️ A URL devolvida é sempre a do endereço NOVO. Quem já tem a URL antiga
 * (`/api/integrations/datalytics/{token}`) colada lá fora não precisa mexer em
 * nada: o token é o mesmo e as duas rotas respondem igual.
 */
function urlDoWebhook(base: string, w: WebhookEntrada): string {
  return `${base}/api/integrations/webhook/${w.token}`;
}

function baseCanonica(reqUrl: string): string {
  // Mesma origem canônica dos webhooks do Evolution — acesso via preview não
  // pode gerar URL de preview.
  return webhookOrigin(reqUrl) || 'https://reports.onmid.app';
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const pool = makeServerPool();
  try {
    const [webhooks, logs] = await Promise.all([
      listarWebhooks(pool, clientId),
      listarLogsWebhook(pool, clientId, 30),
    ]);
    const base = baseCanonica(req.url);
    return Response.json({
      webhooks: webhooks.map(w => ({
        id: w.id,
        nome: w.nome,
        enabled: w.enabled,
        last_received_at: w.last_received_at,
        url: urlDoWebhook(base, w),
      })),
      logs,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao carregar os webhooks.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { nome?: string };
  const pool = makeServerPool();
  try {
    const w = await criarWebhook(pool, clientId, normalizarNomeWebhook(body.nome));
    return Response.json({
      ok: true,
      webhook: {
        id: w.id, nome: w.nome, enabled: w.enabled,
        last_received_at: w.last_received_at,
        url: urlDoWebhook(baseCanonica(req.url), w),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao criar o webhook.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as {
    id?: string; nome?: string; enabled?: boolean;
  };
  if (!body.id) return Response.json({ error: 'id do webhook é obrigatório' }, { status: 400 });
  if (body.nome === undefined && body.enabled === undefined) {
    return Response.json({ error: 'nada a alterar' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    const w = await atualizarWebhook(pool, clientId, body.id, {
      nome: body.nome,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    });
    if (!w) return Response.json({ error: 'webhook não encontrado' }, { status: 404 });
    return Response.json({
      ok: true,
      webhook: {
        id: w.id, nome: w.nome, enabled: w.enabled,
        last_received_at: w.last_received_at,
        url: urlDoWebhook(baseCanonica(req.url), w),
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao salvar o webhook.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const webhookId = new URL(req.url).searchParams.get('webhookId');
  if (!webhookId) return Response.json({ error: 'webhookId é obrigatório' }, { status: 400 });
  const pool = makeServerPool();
  try {
    const ok = await excluirWebhook(pool, clientId, webhookId);
    if (!ok) return Response.json({ error: 'webhook não encontrado' }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao excluir o webhook.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}
