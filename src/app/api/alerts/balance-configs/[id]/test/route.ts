import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getLowBalanceAlerts, sendLowBalanceAlerts } from '@/lib/balance-alerts';

export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const pool = makeServerPool();
  let cfg: { whatsapp_group: string; zapi_instance_id: string | null; zapi_token: string | null; zapi_security_token: string | null } | null = null;
  try {
    const { rows } = await pool.query(`
      SELECT bac.whatsapp_group, z.instance_id AS zapi_instance_id, z.token AS zapi_token, z.security_token AS zapi_security_token
      FROM public.balance_alert_configs bac
      LEFT JOIN public.zapi_clients z ON z.id = bac.zapi_client_id
      WHERE bac.id = $1
    `, [id]);
    cfg = rows[0] ?? null;
  } finally {
    await pool.end();
  }

  if (!cfg) return Response.json({ error: 'Configuração não encontrada' }, { status: 404 });
  if (!cfg.zapi_instance_id || !cfg.zapi_token) return Response.json({ error: 'Instância Z-API não configurada' }, { status: 400 });

  const alerts = await getLowBalanceAlerts();
  const result = await sendLowBalanceAlerts(
    { instanceId: cfg.zapi_instance_id, token: cfg.zapi_token, clientToken: cfg.zapi_security_token ?? '' },
    cfg.whatsapp_group,
    alerts,
    { force: true },
  );

  return Response.json({ ok: true, totalChecked: alerts.length, ...result });
}
