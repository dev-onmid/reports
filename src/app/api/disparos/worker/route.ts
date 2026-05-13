/**
 * Background worker — called by Vercel Cron (or any external cron) every minute.
 * Processes pending messages for ALL running campaigns without requiring the browser.
 *
 * Auth: set CRON_SECRET env var.
 *   - Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
 *   - External cron (cron-job.org): append ?secret=<CRON_SECRET> to the URL
 *
 * Requires Vercel Pro for full 60-second budget. On Hobby (10s) it still runs
 * but processes fewer messages per invocation.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText, sendImage } from '@/lib/zapi';

export const maxDuration = 60;

const BUDGET_MS = 55_000;

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
  if (fromMinutes <= untilMinutes) return nowMinutes >= fromMinutes && nowMinutes < untilMinutes;
  return nowMinutes >= fromMinutes || nowMinutes < untilMinutes;
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = req.headers.get('authorization');
    const urlSecret = new URL(req.url).searchParams.get('secret');
    if (authHeader !== `Bearer ${secret}` && urlSecret !== secret) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const pool = makeServerPool();
  const startTime = Date.now();
  let processed = 0;

  try {
    // Inline migration — safe to run every time
    await pool.query(`
      ALTER TABLE public.zapi_campaigns
      ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ
    `);

    const { rows: campaigns } = await pool.query<{
      id: string;
      status: string;
      message: string;
      image_url: string | null;
      ends_at: string | null;
      active_from: string | null;
      active_until: string | null;
      interval_min: number;
      interval_max: number;
      instance_id: string;
      token: string;
      security_token: string | null;
    }>(`
      SELECT c.id, c.status, c.message, c.image_url, c.ends_at,
             c.active_from, c.active_until, c.interval_min, c.interval_max,
             cl.instance_id, cl.token, cl.security_token
        FROM public.zapi_campaigns c
        JOIN public.zapi_clients cl ON cl.id = c.client_id
       WHERE c.status = 'running'
         AND (c.next_tick_at IS NULL OR c.next_tick_at <= NOW())
       ORDER BY c.next_tick_at ASC NULLS FIRST
    `);

    for (const campaign of campaigns) {
      if (Date.now() - startTime > BUDGET_MS) break;

      // Check end time
      if (campaign.ends_at && new Date() > new Date(campaign.ends_at)) {
        await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
        continue;
      }

      // Outside active window — push next_tick_at forward 60 seconds and skip
      if (campaign.active_from && campaign.active_until && !isWithinWindow(campaign.active_from, campaign.active_until)) {
        await pool.query(
          `UPDATE public.zapi_campaigns SET next_tick_at = NOW() + INTERVAL '60 seconds' WHERE id = $1`,
          [campaign.id],
        );
        continue;
      }

      const client = {
        instanceId: campaign.instance_id,
        token: campaign.token,
        clientToken: campaign.security_token ?? undefined,
      };

      let imageUrls: string[] = [];
      if (campaign.image_url) {
        if (campaign.image_url.startsWith('[')) {
          try { imageUrls = JSON.parse(campaign.image_url); } catch { imageUrls = [campaign.image_url]; }
        } else {
          imageUrls = [campaign.image_url];
        }
      }

      // Process messages for this campaign until time budget runs out
      while (Date.now() - startTime < BUDGET_MS) {
        const intervalSec = campaign.interval_min + Math.random() * (campaign.interval_max - campaign.interval_min);

        // Atomically claim the campaign slot and advance next_tick_at to prevent
        // the browser tick and other worker invocations from double-processing
        const { rows: [claimed] } = await pool.query(
          `UPDATE public.zapi_campaigns
              SET next_tick_at = NOW() + ($1 * INTERVAL '1 second')
            WHERE id = $2
              AND status = 'running'
              AND (next_tick_at IS NULL OR next_tick_at <= NOW())
            RETURNING id`,
          [Math.ceil(intervalSec), campaign.id],
        );
        if (!claimed) break; // Browser or another worker just claimed it

        // Grab next pending number
        const { rows: [number] } = await pool.query(
          `SELECT * FROM public.zapi_numbers
            WHERE campaign_id = $1 AND status = 'pending'
            ORDER BY position ASC LIMIT 1`,
          [campaign.id],
        );

        if (!number) {
          await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
          break;
        }

        const message = interpolate(campaign.message, number.phone, number.name ?? '');

        let result;
        if (imageUrls.length > 0) {
          result = await sendImage(client, number.phone, imageUrls[0], message);
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
        await pool.query(`UPDATE public.zapi_campaigns SET ${field} WHERE id = $1`, [campaign.id]);
        processed++;

        // Re-check status in case it was paused/cancelled externally
        const { rows: [refreshed] } = await pool.query(
          `SELECT status FROM public.zapi_campaigns WHERE id = $1`,
          [campaign.id],
        );
        if (!refreshed || refreshed.status !== 'running') break;

        const remaining = BUDGET_MS - (Date.now() - startTime);
        if (remaining <= 1000) break;

        // Sleep for the interval, but not past our budget
        await sleep(Math.min(intervalSec * 1000, remaining - 1000));
      }
    }

    return Response.json({ ok: true, processed, elapsed: Date.now() - startTime });
  } finally {
    await pool.end();
  }
}
