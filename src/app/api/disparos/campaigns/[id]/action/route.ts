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
    // ⚠️ Resolve o MESMO nome que a tela mostra.
    //
    // `zapi_clients.name` é o nome da INSTÂNCIA de WhatsApp ("SAAC 2.0"); o
    // nome que o modal exibe vem de `clients.name` ("Saac Equipamentos"), pela
    // ponte `client_zapi_instances`. Validar só contra o primeiro deixava a
    // trava IMPOSSÍVEL de satisfazer: a tela pedia um nome e o servidor exigia
    // outro. Join idêntico ao da listagem (`campaigns/route.ts`) — se
    // divergirem de novo, o mesmo impasse volta.
    const { rows: [campaign] } = await pool.query(
      `SELECT c.status, cl.owner_id, cl.name AS client_name, cl.instance_id, cl.provider,
              oc.name AS onmid_client_name
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
         LEFT JOIN LATERAL (
           SELECT client_id FROM public.client_zapi_instances
            WHERE instance_id = cl.instance_id AND ativo = true
            ORDER BY created_at DESC LIMIT 1
         ) link ON true
         LEFT JOIN public.clients oc ON oc.id = link.client_id
        WHERE c.id = $1`,
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
      // Aceita os DOIS nomes: o do cliente (o que a tela mostra e o gestor
      // reconhece) e o da instância. Os dois identificam a mesma campanha, e
      // recusar o que está escrito na tela é impedir a operação, não protegê-la.
      const nomeNaTela = campaign.onmid_client_name ?? campaign.client_name;
      const digitado = confirmClientName ?? '';
      const confere = nomeConfere(digitado, campaign.onmid_client_name ?? '')
        || nomeConfere(digitado, campaign.client_name ?? '');
      if (!confere) {
        return Response.json({
          error: `Confirmação não confere. Digite exatamente o nome do cliente: ${nomeNaTela}`,
          confirm_client_name: nomeNaTela,
        }, { status: 400 });
      }
      if (campaign.provider === 'evolution') {
        let conectada = false;
        try { conectada = await checkEvolutionStatus(campaign.instance_id); } catch { conectada = false; }
        if (!conectada) {
          return Response.json({
            error: `O WhatsApp de ${campaign.onmid_client_name ?? campaign.client_name} não está conectado (${campaign.instance_id}). `
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
