import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText as sendWhatsapp } from '@/lib/zapi';
import { sendEvolutionText } from '@/lib/evolution-api';

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get('secret');
  const validSecrets = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Only run on send_day of month (default: day 1)
  const today = new Date().getDate();

  const pool = makeServerPool();
  let configs: {
    id: string; client_id: string; client_name: string; template: 'performance' | 'delivery';
    whatsapp_group: string | null; zapi_client_id: string | null;
    send_day: number; zapi_provider: 'zapi' | 'evolution' | null; zapi_instance_id: string | null;
    zapi_token: string | null; zapi_security_token: string | null;
  }[] = [];

  try {
    const { rows } = await pool.query(`
      SELECT
        rc.id, rc.client_id, c.name AS client_name, rc.template,
        rc.whatsapp_group, rc.zapi_client_id, rc.send_day,
        z.provider AS zapi_provider,
        z.instance_id AS zapi_instance_id,
        z.token AS zapi_token,
        z.security_token AS zapi_security_token
      FROM public.report_configs rc
      JOIN public.clients c ON c.id = rc.client_id
      LEFT JOIN public.zapi_clients z ON z.id = rc.zapi_client_id AND z.active = true
      WHERE rc.active = true AND rc.send_day = $1
    `, [today]);
    configs = rows;
  } finally {
    await pool.end();
  }

  const origin = new URL(request.url).origin;
  const results: { client: string; status: string; token?: string }[] = [];

  for (const cfg of configs) {
    try {
      // Generate the report
      const runRes = await fetch(`${origin}/api/reports/run/${cfg.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // uses prevMonth() by default
      });

      if (!runRes.ok) {
        results.push({ client: cfg.client_name, status: 'error: run failed' });
        continue;
      }

      const { public_token } = await runRes.json() as { public_token: string };
      const reportUrl = `${origin}/relatorio/${public_token}`;

      // Send WhatsApp if configured (Evolution instance or Z-API instance)
      const hasEvolution = cfg.whatsapp_group && cfg.zapi_provider === 'evolution' && cfg.zapi_instance_id;
      const hasZapi = cfg.whatsapp_group && cfg.zapi_provider !== 'evolution' && cfg.zapi_instance_id && cfg.zapi_token;
      if (hasEvolution || hasZapi) {
        const now = new Date();
        const month = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        const label = cfg.template === 'delivery' ? 'Relatório de Delivery' : 'Relatório de Performance';
        const message = `📊 *${label} — ${cfg.client_name}*\n\nO relatório de *${month}* está pronto!\n\nAcesse aqui: ${reportUrl}`;

        const send = hasEvolution
          ? sendEvolutionText(cfg.zapi_instance_id!, cfg.whatsapp_group!, message)
          : sendWhatsapp(
              {
                instanceId: cfg.zapi_instance_id!,
                token: cfg.zapi_token!,
                clientToken: cfg.zapi_security_token ?? '',
              },
              cfg.whatsapp_group!,
              message,
            );

        await send.catch(() => null);

        // Mark as sent
        const pool2 = makeServerPool();
        try {
          await pool2.query(
            `UPDATE public.diagnostic_reports SET sent_at = NOW() WHERE public_token = $1`,
            [public_token],
          );
        } finally {
          await pool2.end();
        }
      }

      results.push({ client: cfg.client_name, status: 'ok', token: public_token });
    } catch (e) {
      results.push({ client: cfg.client_name, status: String(e) });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
}
