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
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ`);

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

    // Atomically claim the tick slot — if next_tick_at is in the future, the background
    // worker just processed this campaign; skip to avoid double-sending
    const intervalSec = campaign.interval_min + Math.random() * (campaign.interval_max - campaign.interval_min);
    const { rows: [claimed] } = await pool.query(
      `UPDATE public.zapi_campaigns
          SET next_tick_at = NOW() + ($1 * INTERVAL '1 second')
        WHERE id = $2
          AND status = 'running'
          AND (next_tick_at IS NULL OR next_tick_at <= NOW())
        RETURNING id`,
      [Math.ceil(intervalSec), id],
    );
    if (!claimed) {
      return Response.json({ status: 'running', done: false, skipped: true });
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

    let messagePool: string[] = [campaign.message];
    if (campaign.messages) {
      try {
        const parsed: string[] = typeof campaign.messages === 'string' ? JSON.parse(campaign.messages) : campaign.messages;
        if (Array.isArray(parsed) && parsed.length > 0) messagePool = parsed;
      } catch { /* keep single message */ }
    }
    const rawMessage = messagePool[Math.floor(Math.random() * messagePool.length)];
    const message = interpolate(rawMessage, number.phone, number.name ?? '');
    const client = { instanceId: campaign.instance_id, token: campaign.token, clientToken: campaign.security_token ?? undefined };

    // Parse image URLs (may be a JSON array for multiple images, or a plain string for single)
    let imageUrls: string[] = [];
    if (campaign.image_url) {
      if (campaign.image_url.startsWith('[')) {
        try { imageUrls = JSON.parse(campaign.image_url); } catch { imageUrls = [campaign.image_url]; }
      } else {
        imageUrls = [campaign.image_url];
      }
    }

    let result;
    if (imageUrls.length > 0) {
      // Send first image with caption
      result = await sendImage(client, number.phone, imageUrls[0], message);
      // Send remaining images without caption (best-effort, don't fail the number)
      if (result.ok) {
        for (let i = 1; i < imageUrls.length; i++) {
          await sendImage(client, number.phone, imageUrls[i], '');
        }
      }
    } else {
      result = await sendText(client, number.phone, message);
    }

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
