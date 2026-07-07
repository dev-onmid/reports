import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { fetchDisconnectedInstances, sendInstanceAlerts } from '@/lib/evolution-instance-alerts';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret');
  if (secret !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pool = makeServerPool();
  let waInstance = 'numero_matheus_4398835555';
  let waGroup = '';
  const emailTo = process.env.WEBSHARE_ALERT_EMAIL ?? '';

  try {
    // Re-use the optimizer WhatsApp config as destination (same internal group)
    const { rows } = await pool.query<{ instance_name: string; group_jid: string }>(
      `SELECT instance_name, group_jid FROM public.optimizer_whatsapp_config LIMIT 1`,
    );
    if (rows[0]) {
      waInstance = rows[0].instance_name;
      waGroup = rows[0].group_jid;
    }
  } catch { /* table may not exist yet */ } finally {
    await pool.end();
  }

  let disconnected;
  try {
    disconnected = await fetchDisconnectedInstances();
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 502 });
  }

  const result = await sendInstanceAlerts(disconnected, {
    whatsappInstance: waInstance,
    whatsappGroup: waGroup || undefined,
    emailTo: emailTo || undefined,
  });

  return Response.json({ ok: true, ...result });
}
