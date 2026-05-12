import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { startCampaign, pauseCampaign } from '@/lib/campaign-queue';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { action } = await request.json() as { action: 'start' | 'pause' | 'resume' | 'cancel' };

  const pool = makeServerPool();
  try {
    const { rows: [campaign] } = await pool.query(
      `SELECT status FROM public.zapi_campaigns WHERE id = $1`,
      [id],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });

    if (action === 'pause') {
      pauseCampaign(id);
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'paused' WHERE id = $1`, [id]);
    } else if (action === 'resume' || action === 'start') {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'running' WHERE id = $1`, [id]);
      startCampaign(id);
    } else if (action === 'cancel') {
      pauseCampaign(id);
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'cancelled' WHERE id = $1`, [id]);
    }

    const { rows: [updated] } = await pool.query(
      `SELECT id, status, sent, failed, total FROM public.zapi_campaigns WHERE id = $1`,
      [id],
    );
    return Response.json(updated);
  } finally {
    await pool.end();
  }
}
