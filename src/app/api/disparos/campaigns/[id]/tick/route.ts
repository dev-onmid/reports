/**
 * Processes ONE pending number for a campaign.
 * Called repeatedly by the frontend at random intervals.
 * Stateless — works on Vercel serverless.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText, sendImage } from '@/lib/zapi';

function interpolate(template: string, phone: string, name: string) {
  return template.replace(/\{telefone\}/g, phone).replace(/\{nome\}/g, name);
}

function isWithinWindow(activeFrom: string, activeUntil: string): boolean {
  const now = new Date();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [fh, fm] = activeFrom.split(':').map(Number);
  const [uh, um] = activeUntil.split(':').map(Number);
  const fromMinutes = fh * 60 + fm;
  const untilMinutes = uh * 60 + um;

  if (fromMinutes <= untilMinutes) {
    return nowMinutes >= fromMinutes && nowMinutes < untilMinutes;
  }
  // overnight window (e.g. 22:00 - 06:00)
  return nowMinutes >= fromMinutes || nowMinutes < untilMinutes;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();

  try {
    const { rows: [campaign] } = await pool.query(
      `SELECT c.*, cl.instance_id, cl.token, cl.security_token
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = $1`,
      [id],
    );

    if (!campaign) {
      return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    }

    if (campaign.status !== 'running') {
      return Response.json({ status: campaign.status, done: true });
    }

    // Check end time
    const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
    if (endsAt && new Date() > endsAt) {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [id]);
      const { rows: [final] } = await pool.query(`SELECT total, sent, failed FROM public.zapi_campaigns WHERE id = $1`, [id]);
      return Response.json({ status: 'done', done: true, reason: 'end_time_reached', ...final });
    }

    // Check active time window
    if (campaign.active_from && campaign.active_until) {
      if (!isWithinWindow(campaign.active_from, campaign.active_until)) {
        return Response.json({ status: 'running', done: false, sleeping: true });
      }
    }

    // Grab next pending number
    const { rows: [number] } = await pool.query(
      `SELECT * FROM public.zapi_numbers WHERE campaign_id = $1 AND status = 'pending' ORDER BY position ASC LIMIT 1`,
      [id],
    );

    if (!number) {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [id]);
      const { rows: [final] } = await pool.query(`SELECT total, sent, failed FROM public.zapi_campaigns WHERE id = $1`, [id]);
      return Response.json({ status: 'done', done: true, ...final });
    }

    const message = interpolate(campaign.message, number.phone, number.name ?? '');
    const client = { instanceId: campaign.instance_id, token: campaign.token, clientToken: campaign.security_token ?? undefined };

    const result = campaign.image_url
      ? await sendImage(client, number.phone, campaign.image_url, message)
      : await sendText(client, number.phone, message);

    const newStatus = result.ok ? 'sent' : 'failed';
    await pool.query(
      `UPDATE public.zapi_numbers SET status = $1, sent_at = NOW(), error_msg = $2 WHERE id = $3`,
      [newStatus, result.error ?? null, number.id],
    );

    const field = result.ok ? 'sent = sent + 1' : 'failed = failed + 1';
    await pool.query(`UPDATE public.zapi_campaigns SET ${field} WHERE id = $1`, [id]);

    const { rows: [updated] } = await pool.query(
      `SELECT total, sent, failed, status FROM public.zapi_campaigns WHERE id = $1`,
      [id],
    );

    return Response.json({
      status: updated.status,
      done: false,
      total: updated.total,
      sent: updated.sent,
      failed: updated.failed,
      lastPhone: number.phone,
      lastResult: newStatus,
      lastError: newStatus === 'failed' ? (result.error ?? null) : null,
    });
  } finally {
    await pool.end();
  }
}
