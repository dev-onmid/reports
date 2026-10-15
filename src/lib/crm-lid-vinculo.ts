/**
 * Vínculo telefone → LID no momento do ENVIO pelo CRM.
 *
 * ⚠️ Por que isto existe (2026-10-08, caso CondoStore): o WhatsApp passou a
 * entregar a maioria das conversas em modo LID (`…@lid`) SEM o telefone — na
 * instância da Dani eram 419 de 499 chats. O lead do SULTS só tem telefone, então
 * a resposta do lead e as mensagens que o atendente manda depois pelo celular
 * chegam presas a um LID que não casa com lead nenhum. Nenhuma consulta de
 * leitura (whatsappNumbers, fetchProfile, banco da Evolution) revela o par.
 *
 * O único momento em que o par aparece é o ENVIO: o Baileys resolve
 * telefone→LID para mandar a mensagem e grava `lid-mapping-<tel>.json` no
 * diretório da instância (mesma fonte dos Disparos — ver `disparos-lid.ts`).
 * Gravado em `crm_leads.whatsapp_lid`, a régua única de identidade passa a casar
 * todo o resto da conversa com o lead certo.
 *
 * Nunca lança: falhar aqui não pode derrubar o envio, que já aconteceu.
 */
import type { Pool } from 'pg';
import { lidDoEnvio } from '@/lib/disparos-lid';

/** Celular/fixo brasileiro guardado sem o 55 (padrão do SULTS) ganha o código do país. */
export function telefoneComPais(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if ((d.length === 10 || d.length === 11) && !d.startsWith('55')) return `55${d}`;
  return d;
}

export async function vincularLidAposEnvio(pool: Pool, opts: {
  clientId: string;
  leadId: string;
  phone: string;
  instanceName: string;
}): Promise<{ lid: string; fundidos: number } | null> {
  try {
    const lid = await lidDoEnvio({ instanceName: opts.instanceName, phone: telefoneComPais(opts.phone) });
    if (!lid) return null;

    await pool.query(
      `UPDATE public.crm_leads
          SET whatsapp_lid = $3
        WHERE id = $1 AND client_id = $2
          AND (whatsapp_lid IS NULL OR whatsapp_lid = '')`,
      [opts.leadId, opts.clientId, lid],
    );

    // O eco do envio (ou uma resposta rápida) pode ter chegado pelo webhook ANTES
    // do vínculo existir — aí nasceu um lead só com o LID. Ele é a mesma pessoa:
    // as mensagens vão para o lead certo e o fantasma sai.
    const { rows: fantasmas } = await pool.query<{ id: string }>(
      `SELECT id FROM public.crm_leads
        WHERE client_id = $1 AND id <> $2
          AND regexp_replace(COALESCE(whatsapp_lid, ''), '\\D', '', 'g') = $3
          AND (NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') IS NULL
               OR regexp_replace(numero, '\\D', '', 'g') = $3)`,
      [opts.clientId, opts.leadId, lid],
    );
    for (const f of fantasmas) {
      // mesma mensagem nos dois (eco já gravado no lead certo) → fica uma só
      await pool.query(
        `DELETE FROM public.crm_messages m
          WHERE m.lead_id = $1 AND m.external_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM public.crm_messages t
                         WHERE t.lead_id = $2 AND t.external_id = m.external_id)`,
        [f.id, opts.leadId],
      );
      await pool.query(`UPDATE public.crm_messages SET lead_id = $2 WHERE lead_id = $1`, [f.id, opts.leadId]);
      await pool.query(`DELETE FROM public.crm_leads WHERE id = $1 AND client_id = $2`, [f.id, opts.clientId]);
    }
    return { lid, fundidos: fantasmas.length };
  } catch (err) {
    console.error('[crm-lid-vinculo]', err instanceof Error ? err.message : err);
    return null;
  }
}
