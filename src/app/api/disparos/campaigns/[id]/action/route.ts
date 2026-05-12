import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';

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
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'paused' WHERE id = $1`, [id]);
    } else if (action === 'resume' || action === 'start') {
      // If ends_at has already passed, clear it so the campaign can run until completion
      await pool.query(
        `UPDATE public.zapi_campaigns
            SET status = 'running',
                ends_at = CASE WHEN ends_at IS NOT NULL AND ends_at < NOW() THEN NULL ELSE ends_at END
          WHERE id = $1`,
        [id],
      );
    } else if (action === 'cancel') {
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
