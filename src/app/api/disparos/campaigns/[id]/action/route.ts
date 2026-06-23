import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { action } = await request.json() as { action: 'start' | 'pause' | 'resume' | 'cancel' };

  const pool = makeServerPool();
  try {
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ`);

    const scope = await getCallerScope(request, pool);
    const { rows: [campaign] } = await pool.query(
      `SELECT c.status, cl.owner_id FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id WHERE c.id = $1`,
      [id],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (!scope.unrestricted && campaign.owner_id !== scope.userId) {
      return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });
    }

    if (action === 'pause') {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'paused' WHERE id = $1`, [id]);
    } else if (action === 'resume' || action === 'start') {
      // Clear next_tick_at so the background worker picks it up on the next cron tick
      await pool.query(
        `UPDATE public.zapi_campaigns
            SET status = 'running',
                next_tick_at = NULL,
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
