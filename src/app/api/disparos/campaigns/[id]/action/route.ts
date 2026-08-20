import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { checkEvolutionStatus } from '@/lib/evolution-api';
import { nomeConfere } from '@/lib/disparos-destinos';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { action, confirmClientName } = await request.json() as {
    action: 'start' | 'pause' | 'resume' | 'cancel';
    /** Nome do cliente digitado — exigido pra RELIGAR o envio, não pra parar. */
    confirmClientName?: string;
  };

  const pool = makeServerPool();
  try {
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ`);

    const scope = await getCallerScope(request, pool);
    const { rows: [campaign] } = await pool.query(
      `SELECT c.status, cl.owner_id, cl.name AS client_name, cl.instance_id, cl.provider
         FROM public.zapi_campaigns c
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
      // Religar volta a consumir a lista do cliente — mesma trava da criação:
      // digitar o nome e provar que o WhatsApp está de pé. Pausar/cancelar NÃO
      // pedem nada (parar é sempre seguro; exigir ritual pra parar faria alguém
      // deixar rodando errado por atrito).
      if (!nomeConfere(confirmClientName ?? '', campaign.client_name ?? '')) {
        return Response.json({
          error: `Confirmação não confere. Digite exatamente o nome do cliente: ${campaign.client_name}`,
          confirm_client_name: campaign.client_name,
        }, { status: 400 });
      }
      if (campaign.provider === 'evolution') {
        let conectada = false;
        try { conectada = await checkEvolutionStatus(campaign.instance_id); } catch { conectada = false; }
        if (!conectada) {
          return Response.json({
            error: `O WhatsApp de ${campaign.client_name} não está conectado (${campaign.instance_id}). `
                 + 'Reconecte em Configurações → Instâncias antes de retomar.',
            instancia_desconectada: true,
          }, { status: 409 });
        }
      }
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
