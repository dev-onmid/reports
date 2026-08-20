import type { Pool } from 'pg';
import { sendTextByInstanceId } from '@/lib/whatsapp-send';
import { mensagemPausaAutomatica } from '@/lib/disparos-destinos';

/**
 * Pausa a campanha e avisa. Separado de `disparos-destinos` porque puxa o
 * emissor de WhatsApp — a lib de destinos fica testável sem arrastar provider.
 *
 * ⚠️ A pausa é o ponto: sem ela o motor continua tentando contra uma instância
 * morta e marca cada contato como `failed`. Como o worker só pega `pending`,
 * contato queimado NÃO volta — foram 89 (20/08) e 925 (17/08) perdidos assim.
 */
export async function pausarCampanhaPorInstancia(pool: Pool, o: {
  campaignId: string; campanha: string; cliente: string; instancia: string; motivo: string;
}): Promise<void> {
  await pool.query(
    `UPDATE public.zapi_campaigns SET status = 'paused', next_tick_at = NULL WHERE id = $1`,
    [o.campaignId],
  );

  let restantes = 0;
  try {
    const { rows: [r] } = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM public.zapi_numbers WHERE campaign_id = $1 AND status = 'pending'`,
      [o.campaignId],
    );
    restantes = Number(r?.n ?? 0);
  } catch { /* contagem é enfeite do aviso, não pode derrubar a pausa */ }

  console.warn(`[disparos] campanha ${o.campaignId} pausada — ${o.motivo}`);

  // Aviso best-effort no mesmo canal das outras rotinas (grupo da agência).
  try {
    const { rows } = await pool.query<{ key: string; value: string | null }>(
      `SELECT key, value FROM public.system_settings
        WHERE key IN ('gads_rotina_group_id', 'social_alert_zapi_client_id', 'social_alert_group_id')`);
    const map = Object.fromEntries(rows.map(r => [r.key, r.value ?? '']));
    const grupo = map['gads_rotina_group_id'] || map['social_alert_group_id'];
    const inst = map['social_alert_zapi_client_id'];
    if (grupo && inst) {
      await sendTextByInstanceId(pool, inst, grupo, mensagemPausaAutomatica({ ...o, restantes }));
    }
  } catch { /* alerta mudo nunca impede a pausa */ }
}
