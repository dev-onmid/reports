import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getLowBalanceAlerts, sendLowBalanceAlerts } from '@/lib/balance-alerts';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  let configs: { id: string; whatsapp_group: string; zapi_instance_id: string | null; zapi_token: string | null; zapi_security_token: string | null }[] = [];
  try {
    const { rows } = await pool.query(`
      SELECT bac.id, bac.whatsapp_group, z.instance_id AS zapi_instance_id, z.token AS zapi_token, z.security_token AS zapi_security_token
      FROM public.balance_alert_configs bac
      LEFT JOIN public.zapi_clients z ON z.id = bac.zapi_client_id AND z.active = true
      WHERE bac.active = true
    `);
    configs = rows;
  } finally {
    await pool.end();
  }

  const activeConfigs = configs.filter(c => c.zapi_instance_id && c.zapi_token);
  if (activeConfigs.length === 0) return Response.json({ ok: true, alerts: 0, configs: 0 });

  const alerts = await getLowBalanceAlerts();
  const results = [];
  for (const cfg of activeConfigs) {
    const result = await sendLowBalanceAlerts(
      { instanceId: cfg.zapi_instance_id!, token: cfg.zapi_token!, clientToken: cfg.zapi_security_token ?? '' },
      cfg.whatsapp_group,
      alerts,
      { force: false },
    );
    results.push({ configId: cfg.id, ...result });
  }

  return Response.json({ ok: true, totalAlerts: alerts.length, configs: results.length, results });
}
