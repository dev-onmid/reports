/**
 * Singleton campaign queue that runs inside the Next.js server process.
 * Uses SSE (Server-Sent Events) to push progress to subscribed clients.
 */

import { makeServerPool } from '@/lib/server-db';
import { sendText, sendImage } from '@/lib/zapi';
import { sendEvolutionText, sendEvolutionImage } from '@/lib/evolution-api';

export interface CampaignProgress {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  status: string;
  currentPhone?: string;
}

type Subscriber = (data: CampaignProgress) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function subscribe(campaignId: string, cb: Subscriber): () => void {
  if (!subscribers.has(campaignId)) subscribers.set(campaignId, new Set());
  subscribers.get(campaignId)!.add(cb);
  return () => subscribers.get(campaignId)?.delete(cb);
}

function emit(progress: CampaignProgress) {
  subscribers.get(progress.campaignId)?.forEach(cb => cb(progress));
}

function randomDelay(min: number, max: number): number {
  return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
}

function interpolate(template: string, phone: string, name: string): string {
  return template.replace(/\{telefone\}/g, phone).replace(/\{nome\}/g, name);
}

export async function startCampaign(campaignId: string): Promise<void> {
  if (activeTimers.has(campaignId)) return;

  const pool = makeServerPool();
  try {
    const { rows: [campaign] } = await pool.query(
      `SELECT c.*, cl.instance_id, cl.token, cl.provider
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = $1`,
      [campaignId],
    );
    if (!campaign) return;

    await pool.query(
      `UPDATE public.zapi_campaigns SET status = 'running' WHERE id = $1`,
      [campaignId],
    );
    await pool.end();

    processNext(campaignId, campaign);
  } catch {
    await pool.end().catch(() => {});
  }
}

async function processNext(
  campaignId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  campaign: any,
): Promise<void> {
  const pool = makeServerPool();
  try {
    // Check if campaign still running
    const { rows: [fresh] } = await pool.query(
      `SELECT status, ends_at, interval_min, interval_max, sent, failed, total FROM public.zapi_campaigns WHERE id = $1`,
      [campaignId],
    );
    if (!fresh || fresh.status !== 'running') {
      await pool.end();
      activeTimers.delete(campaignId);
      return;
    }

    // Check end time
    if (fresh.ends_at && new Date() > new Date(fresh.ends_at)) {
      await pool.query(
        `UPDATE public.zapi_campaigns SET status = 'paused' WHERE id = $1`,
        [campaignId],
      );
      await pool.end();
      activeTimers.delete(campaignId);
      emit({ campaignId, total: fresh.total, sent: fresh.sent, failed: fresh.failed, status: 'paused' });
      return;
    }

    // Grab next pending number
    const { rows: [number] } = await pool.query(
      `SELECT * FROM public.zapi_numbers WHERE campaign_id = $1 AND status = 'pending' ORDER BY position ASC LIMIT 1`,
      [campaignId],
    );

    if (!number) {
      await pool.query(
        `UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`,
        [campaignId],
      );
      await pool.end();
      activeTimers.delete(campaignId);
      emit({ campaignId, total: fresh.total, sent: fresh.sent, failed: fresh.failed, status: 'done' });
      return;
    }

    const message = interpolate(campaign.message, number.phone, number.name ?? '');

    const result = campaign.provider === 'evolution'
      ? campaign.image_url
        ? await sendEvolutionImage(campaign.instance_id, number.phone, campaign.image_url, message)
        : await sendEvolutionText(campaign.instance_id, number.phone, message)
      : campaign.image_url
        ? await sendImage({ instanceId: campaign.instance_id, token: campaign.token }, number.phone, campaign.image_url, message)
        : await sendText({ instanceId: campaign.instance_id, token: campaign.token }, number.phone, message);

    const newStatus = result.ok ? 'sent' : 'failed';
    await pool.query(
      `UPDATE public.zapi_numbers SET status = $1, sent_at = NOW(), error_msg = $2 WHERE id = $3`,
      [newStatus, result.error ?? null, number.id],
    );

    const updateField = result.ok ? 'sent = sent + 1' : 'failed = failed + 1';
    await pool.query(
      `UPDATE public.zapi_campaigns SET ${updateField} WHERE id = $1`,
      [campaignId],
    );

    const { rows: [updated] } = await pool.query(
      `SELECT total, sent, failed, status FROM public.zapi_campaigns WHERE id = $1`,
      [campaignId],
    );
    await pool.end();

    emit({
      campaignId,
      total: updated.total,
      sent: updated.sent,
      failed: updated.failed,
      status: updated.status,
      currentPhone: number.phone,
    });

    // Schedule next
    const delay = randomDelay(fresh.interval_min, fresh.interval_max);
    const timer = setTimeout(() => processNext(campaignId, campaign), delay);
    activeTimers.set(campaignId, timer);
  } catch {
    await pool.end().catch(() => {});
    // Retry after 5s on unexpected error
    const timer = setTimeout(() => processNext(campaignId, campaign), 5000);
    activeTimers.set(campaignId, timer);
  }
}

export function pauseCampaign(campaignId: string): void {
  const timer = activeTimers.get(campaignId);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(campaignId);
  }
}

export function isCampaignRunning(campaignId: string): boolean {
  return activeTimers.has(campaignId);
}
