import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { getCallerScope } from '@/lib/disparos-access';
import { etiquetarQuemRecebeu, saudeDaInstancia } from '@/lib/disparos-lid';
import { registrarLogCampanha } from '@/lib/disparos-log';

export const maxDuration = 120;

/**
 * Etiqueta RETROATIVAMENTE quem já recebeu a campanha e ficou sem a etiqueta.
 *
 * Por que existe (2026-10-02): a sessão do Baileys perde a coleção de etiquetas
 * sozinha em horas (ver CLAUDE.md), então o motor deixa contatos entregues sem
 * rótulo, com a nota "etiqueta: …" em `error_msg`. Depois de re-parear, este
 * botão passa pelos pendentes e aplica pelo LID gravado no envio.
 *
 * ⚠️ Checa a saúde da sessão UMA vez antes de começar e recusa (409) se a
 * coleção estiver morta — aplicar em lote sobre base vazia seria 26 "200 OK"
 * sem nada no celular.
 * ⚠️ Só aplica pelo LID (`exigirLid`): pelo telefone, dias depois, não chega.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();
  const inicio = Date.now();
  try {
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS lid TEXT`);
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS etiquetado_em TIMESTAMPTZ`);

    const scope = await getCallerScope(request, pool);
    const { rows: [campaign] } = await pool.query(
      `SELECT c.label_id, c.label_nome, cl.owner_id, cl.instance_id, cl.provider
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = $1`,
      [id],
    );
    if (!campaign) return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    if (!scope.unrestricted && campaign.owner_id !== scope.userId) {
      return Response.json({ error: 'Sem permissão para esta campanha' }, { status: 403 });
    }
    if (!campaign.label_id) return Response.json({ error: 'Esta campanha não tem etiqueta configurada.' }, { status: 400 });
    if (campaign.provider !== 'evolution') return Response.json({ error: 'Etiqueta só funciona em instância Evolution.' }, { status: 400 });

    const saude = await saudeDaInstancia(campaign.instance_id);
    if (saude && !saude.ok) {
      return Response.json({
        error: `A sessão do WhatsApp (${campaign.instance_id}) não está sincronizando etiquetas (${saude.motivo}). Desconecte e leia o QR de novo, depois tente outra vez.`,
        sessao_sem_sincronia: true,
      }, { status: 409 });
    }

    const { rows: pendentes } = await pool.query<{ id: string; phone: string; lid: string | null }>(
      `SELECT id, phone, lid FROM public.zapi_numbers
        WHERE campaign_id = $1 AND status = 'sent' AND etiquetado_em IS NULL
        ORDER BY sent_at ASC NULLS LAST, position ASC
        LIMIT 300`,
      [id],
    );

    let aplicadas = 0; let falharam = 0; let semLid = 0; let processadas = 0;
    const motivos: Record<string, number> = {};
    for (const n of pendentes) {
      if (Date.now() - inicio > 100_000) break; // orçamento: o botão pode ser clicado de novo
      processadas++;
      const et = await etiquetarQuemRecebeu({
        instanceName: campaign.instance_id, phone: n.phone, labelId: campaign.label_id,
        lid: n.lid, exigirLid: true, pularSaude: true,
      });
      if (et.aplicada) {
        aplicadas++;
        await pool.query(
          `UPDATE public.zapi_numbers
              SET etiquetado_em = NOW(), lid = COALESCE($2, lid),
                  error_msg = CASE WHEN error_msg LIKE 'etiqueta:%' THEN NULL ELSE error_msg END
            WHERE id = $1`,
          [n.id, et.lid],
        );
      } else {
        if (et.motivo.startsWith('sem LID')) semLid++; else falharam++;
        motivos[et.motivo.slice(0, 80)] = (motivos[et.motivo.slice(0, 80)] ?? 0) + 1;
        await pool.query(`UPDATE public.zapi_numbers SET error_msg = $2 WHERE id = $1`, [n.id, `etiqueta: ${et.motivo}`]);
      }
      await new Promise(r => setTimeout(r, 250));
    }

    if (processadas > 0) {
      await registrarLogCampanha(pool, {
        campaignId: id, userId: scope.userId, acao: 'etiquetou',
        detalhes: { etiqueta: campaign.label_nome ?? campaign.label_id, pendentes: pendentes.length, aplicadas, falharam, sem_lid: semLid },
      });
    }

    return Response.json({
      ok: true,
      etiqueta: campaign.label_nome ?? campaign.label_id,
      pendentes: pendentes.length,
      processadas, aplicadas, falharam, semLid,
      restantes: pendentes.length - processadas,
      motivos,
      saude: saude ? `regular v${saude.versao} com ${saude.entradas} entradas` : 'não medida',
      elapsed: Date.now() - inicio,
    });
  } finally {
    await pool.end();
  }
}
