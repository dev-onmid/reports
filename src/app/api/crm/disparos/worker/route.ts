/**
 * Background worker for CRM-internal broadcast campaigns (crm_disparo_campaigns).
 * Mirrors /api/disparos/worker but is locked to the client's own registered AND
 * currently-connected WhatsApp instance (resolved via getConnectedClientInstance —
 * never trusts stored/cached credentials without a live connection check).
 *
 * Auth: CRON_SECRET as Bearer header or ?secret= query param.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { ensureCrmDisparoSchema, getConnectedClientInstance } from '@/lib/crm-disparo';
import { sendFollowupMessage, interpolate, type FollowupVars } from '@/lib/followup-send';

export const maxDuration = 30;
const BUDGET_MS = 25_000;

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

async function runWorker(req: NextRequest) {
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
    await ensureCrmDisparoSchema(pool);

    await pool.query(`
      UPDATE public.crm_disparo_campaigns
         SET status = 'running', next_tick_at = NULL
       WHERE status = 'pending'
         AND starts_at <= NOW()
    `);

    const { rows: campaigns } = await pool.query<{
      id: string;
      client_id: string;
      message: string;
      messages: string | null;
      message_index: number;
      image_url: string | null;
      ends_at: string | null;
      active_from: string | null;
      active_until: string | null;
      interval_min: number;
      interval_max: number;
    }>(`
      SELECT id, client_id, message, messages, message_index, image_url, ends_at,
             active_from, active_until, interval_min, interval_max
        FROM public.crm_disparo_campaigns
       WHERE status = 'running'
         AND (next_tick_at IS NULL OR next_tick_at <= NOW())
       ORDER BY next_tick_at ASC NULLS FIRST
    `);

    for (const campaign of campaigns) {
      if (Date.now() - startTime > BUDGET_MS) break;

      if (campaign.ends_at && new Date() > new Date(campaign.ends_at)) {
        await pool.query(`UPDATE public.crm_disparo_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
        continue;
      }

      if (campaign.active_from && campaign.active_until && !isWithinWindow(campaign.active_from, campaign.active_until)) {
        await pool.query(
          `UPDATE public.crm_disparo_campaigns SET next_tick_at = NOW() + INTERVAL '60 seconds' WHERE id = $1`,
          [campaign.id],
        );
        continue;
      }

      // Re-validate the connected instance on every cycle. If the client's
      // WhatsApp disconnects mid-campaign, pause rather than fail silently.
      const resolved = await getConnectedClientInstance(pool, campaign.client_id);
      if (!resolved.instance) {
        await pool.query(
          `UPDATE public.crm_disparo_campaigns SET status = 'paused', next_tick_at = NOW() + INTERVAL '120 seconds' WHERE id = $1`,
          [campaign.id],
        );
        continue;
      }
      const instance = resolved.instance;

      let imageUrls: string[] = [];
      if (campaign.image_url) {
        if (campaign.image_url.startsWith('[')) {
          try { imageUrls = JSON.parse(campaign.image_url); } catch { imageUrls = [campaign.image_url]; }
        } else {
          imageUrls = [campaign.image_url];
        }
      }

      let messagePool: string[] = [campaign.message];
      if (campaign.messages) {
        try {
          const parsed: string[] = typeof campaign.messages === 'string' ? JSON.parse(campaign.messages) : campaign.messages;
          if (Array.isArray(parsed) && parsed.length > 0) messagePool = parsed;
        } catch { /* keep single message */ }
      }
      let localIndex = campaign.message_index ?? 0;

      while (Date.now() - startTime < BUDGET_MS) {
        const intervalSec = campaign.interval_min + Math.random() * (campaign.interval_max - campaign.interval_min);

        const { rows: [claimed] } = await pool.query(
          `UPDATE public.crm_disparo_campaigns
              SET next_tick_at = NOW() + ($1 * INTERVAL '1 second')
            WHERE id = $2
              AND status = 'running'
              AND (next_tick_at IS NULL OR next_tick_at <= NOW())
            RETURNING id`,
          [Math.ceil(intervalSec), campaign.id],
        );
        if (!claimed) break;

        const { rows: [target] } = await pool.query(
          `SELECT * FROM public.crm_disparo_leads
            WHERE campaign_id = $1 AND status = 'pending'
            ORDER BY position ASC LIMIT 1`,
          [campaign.id],
        );

        if (!target) {
          await pool.query(`UPDATE public.crm_disparo_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
          break;
        }

        const rawMessage = messagePool[localIndex % messagePool.length];
        const vars: FollowupVars = { nome: target.name ?? target.phone, telefone: target.phone };

        let result: { ok: boolean; error?: string };
        if (imageUrls.length > 0) {
          result = await sendFollowupMessage({
            instance, phone: target.phone, tipo: 'imagem', conteudo: imageUrls[0],
            vars: { ...vars, caption: rawMessage },
          });
          if (result.ok) {
            for (let i = 1; i < imageUrls.length; i++) {
              await sendFollowupMessage({ instance, phone: target.phone, tipo: 'imagem', conteudo: imageUrls[i], vars: { ...vars, caption: '' } });
            }
          }
        } else {
          result = await sendFollowupMessage({ instance, phone: target.phone, tipo: 'texto', conteudo: rawMessage, vars });
        }

        const newStatus = result.ok ? 'sent' : 'failed';
        await pool.query(
          `UPDATE public.crm_disparo_leads SET status = $1, sent_at = NOW(), error_msg = $2 WHERE id = $3`,
          [newStatus, result.error ?? null, target.id],
        );

        const field = result.ok ? 'sent = sent + 1' : 'failed = failed + 1';
        await pool.query(`UPDATE public.crm_disparo_campaigns SET ${field}, message_index = message_index + 1 WHERE id = $1`, [campaign.id]);

        if (result.ok && target.lead_id) {
          const msgText = interpolate(rawMessage, vars);
          await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text) VALUES ($1, $2, 'out', $3)`,
            [target.lead_id, campaign.client_id, msgText],
          ).catch(() => null);
        }

        localIndex++;
        processed++;

        const { rows: [refreshed] } = await pool.query(
          `SELECT status FROM public.crm_disparo_campaigns WHERE id = $1`,
          [campaign.id],
        );
        if (!refreshed || refreshed.status !== 'running') break;

        const remaining = BUDGET_MS - (Date.now() - startTime);
        if (remaining <= 1000) break;

        await sleep(Math.min(intervalSec * 1000, remaining - 1000));
      }
    }

    return Response.json({ ok: true, processed, elapsed: Date.now() - startTime });
  } finally {
    await pool.end();
  }
}

export async function GET(req: NextRequest) { return runWorker(req); }
export async function POST(req: NextRequest) { return runWorker(req); }
