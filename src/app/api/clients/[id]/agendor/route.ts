import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import {
  garantirConexaoAgendor, validarTokenAgendor, garantirAssinaturasAgendor,
  listarLogsAgendor, ensureAgendorSchema,
} from '@/lib/agendor-server';
import { webhookOrigin } from '@/lib/evolution-api';

/**
 * Config da integração Agendor por cliente.
 *
 * GET  → estado (lazy-create da conexão; token da API vem MASCARADO — mesma
 *        regra do ClickUp: credencial não volta ao navegador).
 * POST → conectar: valida o token no Agendor (/users/me), grava, cria as
 *        assinaturas de webhook POR API apontando pro nosso receptor e zera o
 *        cursor do backfill (o sync-cron importa o histórico em seguida).
 * PATCH→ {enabled} liga/desliga a recepção.
 *
 * Auth = deny-by-default do proxy (padrão das subrotas de cliente).
 */

function mascarar(token: string | null): string | null {
  if (!token) return null;
  return token.length <= 8 ? '••••' : `${token.slice(0, 4)}••••••••${token.slice(-4)}`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pool = makeServerPool();
  try {
    const conn = await garantirConexaoAgendor(pool, id);
    const logs = await listarLogsAgendor(pool, id, 20);
    return Response.json({
      enabled: conn.enabled,
      conectado: Boolean(conn.api_token),
      api_token_masked: mascarar(conn.api_token),
      account_name: conn.account_name,
      subscriptions: conn.subscriptions,
      backfill_concluido: conn.backfill_concluido,
      backfill_pagina: conn.backfill_pagina,
      ultima_sync_em: conn.ultima_sync_em,
      last_received_at: conn.last_received_at,
      ultimo_erro: conn.ultimo_erro,
      logs,
    });
  } catch (err) {
    console.error('[agendor config] GET', err);
    return Response.json({ enabled: false, conectado: false, logs: [] });
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { api_token?: string };
  const apiToken = String(body.api_token ?? '').trim();
  if (!apiToken) return Response.json({ error: 'Informe o token da API do Agendor.' }, { status: 400 });

  const pool = makeServerPool();
  try {
    const conn = await garantirConexaoAgendor(pool, id);

    const val = await validarTokenAgendor(apiToken);
    if (!val.ok) return Response.json({ error: val.erro }, { status: 400 });

    const targetUrl = `${webhookOrigin(req.url)}/api/integrations/agendor/${conn.token}`;
    const assinaturas = await garantirAssinaturasAgendor(apiToken, targetUrl);

    // Backfill recomeça do zero a cada (re)conexão — o dedupe por external_id
    // torna a reimportação idempotente, então recomeçar é seguro e simples.
    await pool.query(
      `UPDATE public.agendor_connections SET
         api_token = $2, account_name = $3, enabled = TRUE,
         subscriptions = $4::jsonb, backfill_pagina = 1, backfill_concluido = FALSE,
         ultimo_erro = NULL
       WHERE client_id = $1`,
      [id, apiToken, val.nome, JSON.stringify(assinaturas)],
    );

    return Response.json({
      ok: true,
      account_name: val.nome,
      assinaturas,
      aviso: assinaturas.erros.length
        ? 'Algumas assinaturas de webhook falharam — o sync periódico cobre, mas o tempo real fica parcial.'
        : null,
    });
  } catch (err) {
    console.error('[agendor config] POST', err);
    return Response.json({ error: 'Falha ao conectar com o Agendor.' }, { status: 500 });
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'enabled deve ser boolean' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await ensureAgendorSchema(pool);
    await pool.query(
      `UPDATE public.agendor_connections SET enabled = $2 WHERE client_id = $1`,
      [id, body.enabled],
    );
    return Response.json({ ok: true, enabled: body.enabled });
  } finally {
    await pool.end();
  }
}
