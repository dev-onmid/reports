import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { webhookOrigin } from '@/lib/evolution-api';
import {
  garantirConexaoDatalytics, setDatalyticsEnabled, listarLogsDatalytics,
} from '@/lib/datalytics-server';

/**
 * Config da integração Datalytics do cliente (auth = deny-by-default do proxy).
 *
 * GET faz lazy-create: abrir o card já gera o token — a URL aparece pronta pra
 * colar no "Nova integração" do Datalytics, sem passo de "criar" separado.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const pool = makeServerPool();
  try {
    const conn = await garantirConexaoDatalytics(pool, clientId);
    const logs = await listarLogsDatalytics(pool, clientId, 20);
    // Mesma origem canônica dos webhooks do Evolution — acesso via preview não
    // pode gerar URL de preview.
    const base = webhookOrigin(req.url) || 'https://reports.onmid.app';
    return Response.json({
      enabled: conn.enabled,
      last_received_at: conn.last_received_at,
      url: `${base}/api/integrations/datalytics/${conn.token}`,
      logs,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Falha ao carregar a integração.' },
      { status: 500 },
    );
  } finally {
    await pool.end();
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await ctx.params;
  const body = await req.json().catch(() => ({})) as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') {
    return Response.json({ error: 'enabled (boolean) é obrigatório' }, { status: 400 });
  }
  const pool = makeServerPool();
  try {
    await garantirConexaoDatalytics(pool, clientId);
    await setDatalyticsEnabled(pool, clientId, body.enabled);
    return Response.json({ ok: true, enabled: body.enabled });
  } finally {
    await pool.end();
  }
}
