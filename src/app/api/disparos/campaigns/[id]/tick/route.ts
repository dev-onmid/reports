/**
 * Processes ONE pending number for a campaign.
 * Called repeatedly by the frontend at random intervals.
 * Stateless — works on Vercel serverless.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText, sendImage } from '@/lib/zapi';
import { sendFollowupMessage, type WaInstance } from '@/lib/followup-send';
import { isWithinWindow, isActiveDayNow } from '@/lib/disparos-schedule';
import { classificarErroEnvio } from '@/lib/disparos-destinos';
import { pausarCampanhaPorInstancia } from '@/lib/disparos-alerta';
import { lerImagens, parDoRodizio } from '@/lib/disparos-rodizio';
import { etiquetarQuemRecebeu, lidDoEnvio } from '@/lib/disparos-lid';
import { montarMensagem } from '@/lib/disparos-mensagem';
import {
  garantirProtecaoChip, reservarEnvioNoChip, removerOptoutDaFila, esperaDoChip,
} from '@/lib/disparos-chip';

// {nome}/{primeiro_nome}/{telefone} + frase recomposta quando falta o nome —
// a MESMA função da prévia da tela (disparos-mensagem.ts).
function interpolate(template: string, phone: string, name: string) {
  return montarMensagem(template, { phone, name });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const pool = makeServerPool();

  try {
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS message_index INT NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_days TEXT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS daily_limit INT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS label_id TEXT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS label_nome TEXT`);
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS lid TEXT`);
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS etiquetado_em TIMESTAMPTZ`);
    await garantirProtecaoChip(pool);

    const { rows: [campaign] } = await pool.query(
      `SELECT c.*, cl.instance_id, cl.token, cl.security_token, cl.provider, cl.name AS client_name
         FROM public.zapi_campaigns c
         JOIN public.zapi_clients cl ON cl.id = c.client_id
        WHERE c.id = $1`,
      [id],
    );

    if (!campaign) {
      return Response.json({ error: 'Campanha não encontrada' }, { status: 404 });
    }

    // Auto-start pending campaigns whose scheduled time has arrived
    if (campaign.status === 'pending' && new Date(campaign.starts_at) <= new Date()) {
      await pool.query(
        `UPDATE public.zapi_campaigns SET status = 'running', next_tick_at = NULL WHERE id = $1`,
        [id],
      );
      campaign.status = 'running';
    }

    if (campaign.status !== 'running') {
      return Response.json({ status: campaign.status, done: campaign.status === 'done' || campaign.status === 'cancelled' });
    }

    // Check end time
    const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
    if (endsAt && new Date() > endsAt) {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [id]);
      const { rows: [final] } = await pool.query(`SELECT total, sent, failed FROM public.zapi_campaigns WHERE id = $1`, [id]);
      return Response.json({ status: 'done', done: true, reason: 'end_time_reached', ...final });
    }

    // Check allowed weekdays (BRT)
    if (!isActiveDayNow(campaign.active_days)) {
      return Response.json({ status: 'running', done: false, sleeping: true });
    }

    // Check active time window
    if (campaign.active_from && campaign.active_until) {
      if (!isWithinWindow(campaign.active_from, campaign.active_until)) {
        return Response.json({ status: 'running', done: false, sleeping: true });
      }
    }

    // Teto diário anti-bloqueio (mesma régua do worker): envios de HOJE em BRT
    // da instância inteira — atingiu, dorme até a virada do dia.
    if (campaign.daily_limit && Number(campaign.daily_limit) > 0) {
      const { rows: [cnt] } = await pool.query<{ sent_today: number }>(
        `SELECT COUNT(*)::int AS sent_today
           FROM public.zapi_numbers n
           JOIN public.zapi_campaigns c2 ON c2.id = n.campaign_id
          WHERE c2.client_id = $1 AND n.status = 'sent'
            AND n.sent_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
        [campaign.client_id],
      );
      if (Number(cnt?.sent_today ?? 0) >= Number(campaign.daily_limit)) {
        return Response.json({ status: 'running', done: false, sleeping: true, reason: 'limite_diario' });
      }
    }

    // Atomically claim the tick slot — if next_tick_at is in the future, the background
    // worker just processed this campaign; skip to avoid double-sending.
    // Piso anti-bloqueio de 90s — vale também pra campanhas antigas.
    const minSec = Math.max(90, Number(campaign.interval_min) || 0);
    const maxSec = Math.max(minSec + 30, Number(campaign.interval_max) || 0);
    const intervalSec = minSec + Math.random() * (maxSec - minSec);
    const { rows: [claimed] } = await pool.query(
      `UPDATE public.zapi_campaigns
          SET next_tick_at = NOW() + ($1 * INTERVAL '1 second')
        WHERE id = $2
          AND status = 'running'
          AND (next_tick_at IS NULL OR next_tick_at <= NOW())
        RETURNING id`,
      [Math.ceil(intervalSec), id],
    );
    if (!claimed) {
      return Response.json({ status: 'running', done: false, skipped: true });
    }

    // Quem pediu para parar sai da fila antes de escolhermos o próximo contato.
    await removerOptoutDaFila(pool, { campaignId: id, clientId: campaign.client_id }).catch(() => 0);

    // Grab next pending number
    const { rows: [number] } = await pool.query(
      `SELECT * FROM public.zapi_numbers WHERE campaign_id = $1 AND status = 'pending' ORDER BY position ASC LIMIT 1`,
      [id],
    );

    if (!number) {
      await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [id]);
      const { rows: [final] } = await pool.query(`SELECT total, sent, failed FROM public.zapi_campaigns WHERE id = $1`, [id]);
      return Response.json({ status: 'done', done: true, ...final });
    }

    // ⚠️ A vez do CHIP, não da campanha — o claim acima é por campanha, e três
    // campanhas na mesma instância furavam o piso de 90s do número.
    if (!await reservarEnvioNoChip(pool, { clientId: campaign.client_id, intervaloSeg: minSec })) {
      return Response.json({
        status: 'running', done: false, skipped: true,
        aguardandoChip: await esperaDoChip(pool, campaign.client_id),
      });
    }

    let messagePool: string[] = [campaign.message];
    if (campaign.messages) {
      try {
        const parsed: string[] = typeof campaign.messages === 'string' ? JSON.parse(campaign.messages) : campaign.messages;
        if (Array.isArray(parsed) && parsed.length > 0) messagePool = parsed;
      } catch { /* keep single message */ }
    }
    const imagens = lerImagens(campaign.image_url);
    // Mesmo par do worker — os dois caminhos TÊM que concordar, senão a campanha
    // rodada pela tela produziria combinações diferentes da rodada pelo cron.
    const par = parDoRodizio(campaign.message_index ?? 0, messagePool.length, imagens.length);
    const message = interpolate(messagePool[par.mensagem], number.phone, number.name ?? '');
    const imagemDaVez = imagens.length > 0 ? imagens[par.imagem] : null;
    const client = { instanceId: campaign.instance_id, token: campaign.token, clientToken: campaign.security_token ?? undefined };


    const isEvolution = campaign.provider === 'evolution';
    // Evolution routes through the same dispatcher the CRM uses (lib/followup-send.ts).
    // Z-API keeps its own path because disparos instances carry a security_token.
    const waInstance: WaInstance = { instanceId: campaign.instance_id, token: campaign.token, provider: 'evolution' };

    let result;
    if (imagemDaVez) {
      result = isEvolution
        ? await sendFollowupMessage({ instance: waInstance, phone: number.phone, tipo: 'imagem', conteudo: imagemDaVez, vars: { caption: message } })
        : await sendImage(client, number.phone, imagemDaVez, message);
    } else {
      result = isEvolution
        ? await sendFollowupMessage({ instance: waInstance, phone: number.phone, tipo: 'texto', conteudo: message, vars: {} })
        : await sendText(client, number.phone, message);
    }

    // Mesma regra do worker: falha da INSTÂNCIA devolve o contato pra fila e
    // pausa a campanha, em vez de queimar a lista um número por tick.
    if (!result.ok && classificarErroEnvio(result.error ?? '') === 'instancia') {
      await pool.query(
        `UPDATE public.zapi_numbers SET status = 'pending', sent_at = NULL, error_msg = $2 WHERE id = $1`,
        [number.id, result.error ?? null],
      );
      await pausarCampanhaPorInstancia(pool, {
        campaignId: id,
        campanha: campaign.name,
        cliente: campaign.client_name,
        instancia: campaign.instance_id,
        motivo: `a instância falhou no envio: ${String(result.error ?? '').slice(0, 160)}`,
      });
      return Response.json({
        done: false,
        paused: true,
        error: `Campanha pausada: ${result.error ?? 'falha na instância'}`,
      });
    }

    // Mesma regra do worker: etiqueta só em quem recebeu, e nunca derruba o envio.
    let notaEtiqueta: string | null = null;
    let lidGravar: string | null = null;
    let etiquetou = false;
    if (result.ok && isEvolution) {
      lidGravar = await lidDoEnvio({ instanceName: campaign.instance_id, phone: number.phone }).catch(() => null);
      if (campaign.label_id) {
        const et = await etiquetarQuemRecebeu({ instanceName: campaign.instance_id, phone: number.phone, labelId: campaign.label_id, lid: lidGravar });
        if (et.aplicada) etiquetou = true;
        else notaEtiqueta = `etiqueta: ${et.motivo}`;
      }
    }

    const newStatus = result.ok ? 'sent' : 'failed';
    await pool.query(
      `UPDATE public.zapi_numbers
          SET status = $1, sent_at = NOW(), error_msg = $2,
              lid = COALESCE($4, lid),
              etiquetado_em = CASE WHEN $5::boolean THEN NOW() ELSE etiquetado_em END
        WHERE id = $3`,
      [newStatus, result.error ?? notaEtiqueta ?? null, number.id, lidGravar, etiquetou],
    );

    const field = result.ok ? 'sent = sent + 1' : 'failed = failed + 1';
    await pool.query(
      `UPDATE public.zapi_campaigns
          SET ${field}, message_index = message_index + 1
        WHERE id = $1`,
      [id],
    );

    const { rows: [updated] } = await pool.query(
      `SELECT total, sent, failed, status FROM public.zapi_campaigns WHERE id = $1`,
      [id],
    );

    return Response.json({
      status: updated.status,
      done: false,
      total: updated.total,
      sent: updated.sent,
      failed: updated.failed,
      lastPhone: number.phone,
      lastResult: newStatus,
      lastError: newStatus === 'failed' ? (result.error ?? null) : null,
    });
  } finally {
    await pool.end();
  }
}
