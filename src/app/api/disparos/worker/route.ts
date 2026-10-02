/**
 * Background worker — called by Vercel Cron (or any external cron) every minute.
 * Processes pending messages for ALL running campaigns without requiring the browser.
 *
 * Auth: set CRON_SECRET env var.
 *   - Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
 *   - External cron (cron-job.org): append ?secret=<CRON_SECRET> to the URL
 *
 * Requires Vercel Pro for full 60-second budget. On Hobby (10s) it still runs
 * but processes fewer messages per invocation.
 */
import type { NextRequest } from 'next/server';
import { makeServerPool } from '@/lib/server-db';
import { sendText, sendImage } from '@/lib/zapi';
import { sendFollowupMessage, type WaInstance } from '@/lib/followup-send';
import { isWithinWindow, isActiveDayNow } from '@/lib/disparos-schedule';
import { lerImagens, parDoRodizio } from '@/lib/disparos-rodizio';
import { etiquetarQuemRecebeu, lidDoEnvio } from '@/lib/disparos-lid';
import {
  garantirProtecaoChip, reservarEnvioNoChip, removerOptoutDaFila,
  podeSincronizarOptout, sincronizarOptout,
} from '@/lib/disparos-chip';
import { classificarErroEnvio } from '@/lib/disparos-destinos';
import { sondarInstancia } from '@/lib/disparos-sonda';
import { pausarCampanhaPorInstancia } from '@/lib/disparos-alerta';

export const maxDuration = 30;

const BUDGET_MS = 25_000;

function interpolate(template: string, phone: string, name: string) {
  return template.replace(/\{telefone\}/g, phone).replace(/\{nome\}/g, name);
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function runWorker(req: NextRequest) {
  // Mesma família de secrets dos outros crons (CRON_SECRET da Vercel é
  // write-only — os workflows do GitHub usam REPORTS_CRON_SECRET).
  const validSecrets = [process.env.CRON_SECRET, process.env.REPORTS_CRON_SECRET, process.env.CRM_CRON_SECRET]
    .filter(Boolean);
  if (validSecrets.length > 0) {
    const authHeader = req.headers.get('authorization');
    const urlSecret = new URL(req.url).searchParams.get('secret');
    const ok = validSecrets.some(s => authHeader === `Bearer ${s}` || urlSecret === s);
    if (!ok) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const pool = makeServerPool();
  const startTime = Date.now();
  let processed = 0;
  let optout = 0;
  let etiquetaFalhou = 0;
  let chipOcupado = 0;

  try {
    // Inline migration — safe to run every time
    await pool.query(`
      ALTER TABLE public.zapi_campaigns
      ADD COLUMN IF NOT EXISTS next_tick_at TIMESTAMPTZ
    `);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS message_index INT NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS active_days TEXT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS daily_limit INT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS label_id TEXT`);
    await pool.query(`ALTER TABLE public.zapi_campaigns ADD COLUMN IF NOT EXISTS label_nome TEXT`);
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS lid TEXT`);
    await pool.query(`ALTER TABLE public.zapi_numbers ADD COLUMN IF NOT EXISTS etiquetado_em TIMESTAMPTZ`);
    await garantirProtecaoChip(pool);

    // Transition pending campaigns whose start time has arrived
    await pool.query(`
      UPDATE public.zapi_campaigns
         SET status = 'running', next_tick_at = NULL
       WHERE status = 'pending'
         AND starts_at <= NOW()
    `);

    const { rows: campaigns } = await pool.query<{
      id: string;
      name: string;
      client_name: string;
      status: string;
      message: string;
      messages: string | null;
      message_index: number;
      image_url: string | null;
      ends_at: string | null;
      active_from: string | null;
      active_until: string | null;
      active_days: string | null;
      interval_min: number;
      interval_max: number;
      daily_limit: number | null;
      label_id: string | null;
      client_id: string;
      instance_id: string;
      token: string;
      security_token: string | null;
      provider: string;
    }>(`
      SELECT c.id, c.name, c.status, c.message, c.messages, c.message_index, c.image_url, c.ends_at,
             c.active_from, c.active_until, c.active_days, c.interval_min, c.interval_max,
             c.daily_limit, c.label_id, c.client_id,
             cl.instance_id, cl.token, cl.security_token, cl.provider, cl.name AS client_name
        FROM public.zapi_campaigns c
        JOIN public.zapi_clients cl ON cl.id = c.client_id
       WHERE c.status = 'running'
         AND (c.next_tick_at IS NULL OR c.next_tick_at <= NOW())
       ORDER BY c.next_tick_at ASC NULLS FIRST
    `);

    for (const campaign of campaigns) {
      if (Date.now() - startTime > BUDGET_MS) break;

      // Check end time
      if (campaign.ends_at && new Date() > new Date(campaign.ends_at)) {
        await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
        continue;
      }

      // Outside allowed weekdays or active window — push next_tick_at forward 60 seconds and skip
      const outsideDay = !isActiveDayNow(campaign.active_days);
      const outsideWindow = !!(campaign.active_from && campaign.active_until && !isWithinWindow(campaign.active_from, campaign.active_until));
      if (outsideDay || outsideWindow) {
        await pool.query(
          `UPDATE public.zapi_campaigns SET next_tick_at = NOW() + INTERVAL '60 seconds' WHERE id = $1`,
          [campaign.id],
        );
        continue;
      }

      // Teto diário anti-bloqueio: conta os envios de HOJE (dia BRT) da
      // INSTÂNCIA inteira (todas as campanhas do mesmo número compartilham a
      // reputação). Atingiu o limite → dorme até a virada do dia em BRT.
      if (campaign.daily_limit && campaign.daily_limit > 0) {
        const { rows: [cnt] } = await pool.query<{ sent_today: number }>(
          `SELECT COUNT(*)::int AS sent_today
             FROM public.zapi_numbers n
             JOIN public.zapi_campaigns c2 ON c2.id = n.campaign_id
            WHERE c2.client_id = $1 AND n.status = 'sent'
              AND n.sent_at >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
          [campaign.client_id],
        );
        if (Number(cnt?.sent_today ?? 0) >= campaign.daily_limit) {
          await pool.query(
            `UPDATE public.zapi_campaigns
                SET next_tick_at = (date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo'
              WHERE id = $1`,
            [campaign.id],
          );
          continue;
        }
      }

      // ── Sonda a instância ANTES de gastar contato ───────────────────────
      // Instância morta marcava cada número como `failed` e o worker só pega
      // `pending` — a lista ia embora sem retry e sem aviso. Agora a campanha
      // pausa e avisa; Evolution fora do ar (transitório) só adia o tick.
      if (campaign.provider === 'evolution') {
        const estado = await sondarInstancia(campaign.instance_id);
        if (estado === 'inexistente' || estado === 'desconectada') {
          await pausarCampanhaPorInstancia(pool, {
            campaignId: campaign.id,
            campanha: campaign.name,
            cliente: campaign.client_name,
            instancia: campaign.instance_id,
            motivo: estado === 'inexistente'
              ? 'a instância não existe mais no servidor Evolution'
              : 'o WhatsApp está desconectado',
          });
          continue;
        }
        if (estado === 'indisponivel') {
          await pool.query(
            `UPDATE public.zapi_campaigns SET next_tick_at = NOW() + INTERVAL '60 seconds' WHERE id = $1`,
            [campaign.id],
          );
          continue;
        }
      }

      const client = {
        instanceId: campaign.instance_id,
        token: campaign.token,
        clientToken: campaign.security_token ?? undefined,
      };

      const imageUrls = lerImagens(campaign.image_url);

      // Quem pediu para parar sai da fila ANTES do laço, de uma vez: marcar
      // dentro do laço gastaria a vez do chip em contato que não vai receber.
      // A varredura das respostas é claimada por instância (10 min), então
      // crons sobrepostos não varrem a mesma caixa duas vezes.
      if (await podeSincronizarOptout(pool, campaign.client_id)) {
        await sincronizarOptout(pool, { clientId: campaign.client_id, desdeHoras: 6 })
          .catch(() => ({ novos: 0, analisadas: 0 }));
      }
      const removidos = await removerOptoutDaFila(pool, { campaignId: campaign.id, clientId: campaign.client_id })
        .catch(() => 0);
      optout += removidos;

      // Build message pool once per campaign; track local index so within-invocation
      // rotation stays in sync before the DB is updated
      let messagePool: string[] = [campaign.message];
      if (campaign.messages) {
        try {
          const parsed: string[] = typeof campaign.messages === 'string' ? JSON.parse(campaign.messages) : campaign.messages;
          if (Array.isArray(parsed) && parsed.length > 0) messagePool = parsed;
        } catch { /* keep single message */ }
      }
      // ⚠️ UM contador só para o par. `message_index` é o número de envios da
      // campanha, e é dele que saem TEXTO e IMAGEM — dois contadores separados
      // poderiam divergir (uma gravação falha) e quebrar a garantia de m×n.
      let localIndex = campaign.message_index ?? 0;

      // Process messages for this campaign until time budget runs out.
      // Piso anti-bloqueio de 90s no intervalo — vale também pra campanhas
      // antigas criadas com valores agressivos (o default da UI já foi 5-15s).
      const minSec = Math.max(90, campaign.interval_min || 0);
      const maxSec = Math.max(minSec + 30, campaign.interval_max || 0);
      while (Date.now() - startTime < BUDGET_MS) {
        const intervalSec = minSec + Math.random() * (maxSec - minSec);

        // Atomically claim the campaign slot and advance next_tick_at to prevent
        // the browser tick and other worker invocations from double-processing
        const { rows: [claimed] } = await pool.query(
          `UPDATE public.zapi_campaigns
              SET next_tick_at = NOW() + ($1 * INTERVAL '1 second')
            WHERE id = $2
              AND status = 'running'
              AND (next_tick_at IS NULL OR next_tick_at <= NOW())
            RETURNING id`,
          [Math.ceil(intervalSec), campaign.id],
        );
        if (!claimed) break; // Browser or another worker just claimed it

        // Grab next pending number
        const { rows: [number] } = await pool.query(
          `SELECT * FROM public.zapi_numbers
            WHERE campaign_id = $1 AND status = 'pending'
            ORDER BY position ASC LIMIT 1`,
          [campaign.id],
        );

        if (!number) {
          await pool.query(`UPDATE public.zapi_campaigns SET status = 'done' WHERE id = $1`, [campaign.id]);
          break;
        }

        // ⚠️ A vez do CHIP, não da campanha. O claim acima é por campanha e era
        // a única trava — com três campanhas na mesma instância, o número levava
        // as três somadas (medido: 27% dos envios abaixo de 90s, mínimo de 1s).
        // Chip ocupado: sai do laço desta campanha e deixa a próxima rodada
        // pegar a vez. O next_tick_at já foi adiado acima, então não gira em falso.
        if (!await reservarEnvioNoChip(pool, { clientId: campaign.client_id, intervaloSeg: minSec })) {
          chipOcupado++;
          break;
        }

        // O par da vez: texto e imagem saem do mesmo contador, combinados de
        // forma que os (textos × imagens) pares apareçam todos antes de repetir.
        const par = parDoRodizio(localIndex, messagePool.length, imageUrls.length);
        const message = interpolate(messagePool[par.mensagem], number.phone, number.name ?? '');
        const imagemDaVez = imageUrls.length > 0 ? imageUrls[par.imagem] : null;

        const isEvolution = campaign.provider === 'evolution';
        // Evolution goes through the exact same dispatcher the CRM uses
        // (lib/followup-send.ts) — proven for text/image/audio/doc + LID targets.
        // Z-API stays on its own path because disparos instances carry a
        // security_token that the CRM resolver doesn't pass.
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

        // Culpa da INSTÂNCIA não queima o contato: devolve pra fila e pausa.
        // (Número sem WhatsApp — `exists:false` — segue marcado como failed,
        // que é o certo: tentar de novo não faria ele existir.)
        if (!result.ok && classificarErroEnvio(result.error ?? '') === 'instancia') {
          await pool.query(
            `UPDATE public.zapi_numbers SET status = 'pending', sent_at = NULL, error_msg = $2 WHERE id = $1`,
            [number.id, result.error ?? null],
          );
          await pausarCampanhaPorInstancia(pool, {
            campaignId: campaign.id,
            campanha: campaign.name,
            cliente: campaign.client_name,
            instancia: campaign.instance_id,
            motivo: `a instância falhou no envio: ${String(result.error ?? '').slice(0, 160)}`,
          });
          break;
        }

        // Etiqueta no WhatsApp do cliente: só para quem REALMENTE recebeu, e
        // sempre best-effort. A mensagem já saiu — falhar em pendurar o rótulo
        // não pode marcar o contato como falha nem parar a campanha.
        let notaEtiqueta: string | null = null;
        let lidGravar: string | null = null;
        let etiquetou = false;
        if (result.ok && isEvolution) {
          // O LID nasce no envio e morre no re-pareamento — guardar SEMPRE,
          // com ou sem etiqueta, é o que permite etiquetar depois.
          lidGravar = await lidDoEnvio({ instanceName: campaign.instance_id, phone: number.phone }).catch(() => null);
          if (campaign.label_id) {
            const et = await etiquetarQuemRecebeu({ instanceName: campaign.instance_id, phone: number.phone, labelId: campaign.label_id, lid: lidGravar });
            if (et.aplicada) etiquetou = true;
            else { etiquetaFalhou++; notaEtiqueta = `etiqueta: ${et.motivo}`; }
          }
        }

        const newStatus = result.ok ? 'sent' : 'failed';
        // `error_msg` guarda a nota da etiqueta SEM mudar o status: a mensagem
        // foi entregue; o que falhou foi o rótulo, e isso precisa ficar visível.
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
          [campaign.id],
        );
        localIndex++;
        processed++;

        // Re-check status in case it was paused/cancelled externally
        const { rows: [refreshed] } = await pool.query(
          `SELECT status FROM public.zapi_campaigns WHERE id = $1`,
          [campaign.id],
        );
        if (!refreshed || refreshed.status !== 'running') break;

        const remaining = BUDGET_MS - (Date.now() - startTime);
        if (remaining <= 1000) break;

        // Sleep for the interval, but not past our budget
        await sleep(Math.min(intervalSec * 1000, remaining - 1000));
      }
    }

    return Response.json({ ok: true, processed, optout, chipOcupado, etiquetaFalhou, elapsed: Date.now() - startTime });
  } finally {
    await pool.end();
  }
}

// Vercel Cron sends GET; external cron-job.org can POST with ?secret=
export async function GET(req: NextRequest) { return runWorker(req); }
export async function POST(req: NextRequest) { return runWorker(req); }
