import { makeServerPool } from '@/lib/server-db';
import { normalizeWebhookPayload, type WhatsAppProvider } from '@/lib/whatsapp-provider';
import { ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { fetchEvolutionMediaBase64, uploadBase64ToStorage } from '@/lib/evolution-media';
import { registrarMensagemWhatsApp } from '@/lib/whatsapp-inbound';
import type { NextRequest } from 'next/server';

// O download de mídia recebida (getBase64FromMediaMessage, timeout 15s) + upload pro
// storage não cabem no orçamento default de 10s do Hobby — sem isso, fotos/áudios
// grandes falhavam silenciosamente e viravam placeholder.
export const maxDuration = 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

function normalizeEvolutionDeliveryStatus(raw: unknown): string | null {
  const status = String(raw ?? '').toLowerCase();
  if (!status) return null;
  if (status.includes('read') || status.includes('played') || status === '4') return 'read';
  if (
    status.includes('delivery')
    || status.includes('delivered')
    || status.includes('device_ack')
    || status === '3'
  ) return 'delivered';
  if (
    status.includes('server')
    || status.includes('sent')
    || status.includes('ack')
    || status === '2'
    || status === '1'
  ) return 'sent';
  if (status.includes('error') || status.includes('fail')) return 'failed';
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEvolutionStatusUpdates(body: any): Array<{ id: string; status: string; error?: string; remoteJid?: string; remoteDigits?: string }> {
  // Evolution manda o event como "messages.update" (ponto); normalizar pra
  // comparar com MESSAGES_UPDATE (underscore, formato da config de webhook).
  const eventName = String(body?.event ?? body?.type ?? '').toUpperCase().replace(/\./g, '_');
  // ⚠️ BUG HISTÓRICO (2026-07-24): o messages.upsert REAL da Evolution v2.3.7 traz
  // `status: 'DELIVERY_ACK'/'READ'` DENTRO do data da mensagem nova — sem este gate,
  // TODA mensagem recebida era classificada como atualização de ✓✓, caía no UPDATE
  // (que não acha nada) e era descartada com 200. O CRM inteiro só "andava" pelo
  // import do navegador. Evento explícito que não é MESSAGES_UPDATE NUNCA é status.
  if (eventName && !eventName.includes('MESSAGES_UPDATE')) return [];
  const rawData = Array.isArray(body?.data) ? body.data : [body?.data ?? body];
  const updates: Array<{ id: string; status: string; error?: string; remoteJid?: string; remoteDigits?: string }> = [];

  for (const item of rawData) {
    const key = item?.key ?? item?.message?.key ?? item?.data?.key ?? item?.update?.key ?? {};
    const update = item?.update ?? item?.message?.update ?? item?.data?.update ?? item;
    const id = String(
      key?.id
      ?? update?.id
      ?? update?.messageId
      ?? update?.message_id
      ?? item?.id
      ?? item?.messageId
      ?? item?.message_id
      ?? '',
    );
    const status = normalizeEvolutionDeliveryStatus(
      update?.status
      ?? update?.messageStatus
      ?? update?.ack
      ?? update?.deliveryStatus
      ?? item?.status
      ?? item?.messageStatus
      ?? item?.ack
      ?? item?.deliveryStatus
      ?? item?.message?.status
      ?? item?.message?.ack
      ?? item?.message?.messageStatus,
    );
    const remoteJid = String(
      key?.remoteJid
      ?? update?.remoteJid
      ?? item?.remoteJid
      ?? item?.message?.key?.remoteJid
      ?? '',
    );
    const remoteDigits = normalizeEvolutionJidDigits(remoteJid);
    if ((!id && !remoteDigits) || !status) continue;
    updates.push({
      id,
      status,
      error: typeof update?.error === 'string' ? update.error : undefined,
      remoteJid: remoteJid || undefined,
      remoteDigits: remoteDigits || undefined,
    });
  }

  if (updates.length === 0 && !eventName.includes('MESSAGES_UPDATE')) return [];
  return updates;
}

function normalizeEvolutionJidDigits(raw: unknown): string {
  return String(raw ?? '').split('@')[0].replace(/\D/g, '');
}

// ── Handler ──────────────────────────────────────────────────────────────────
// O pipeline do CRM (lead, atribuição, histórico, conversões, Pixel) vive em
// `registrarMensagemWhatsApp` e é compartilhado com o webhook da Meta oficial.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  const pool = makeServerPool();

  try {
    // 1. Resolve instance → client + provider (accepts UUID or instance_id name)
    const { rows: [inst] } = await pool.query(
      `SELECT id, client_id, provider, instance_id FROM public.client_zapi_instances
       WHERE (id::text = $1 OR instance_id = $1) AND ativo = true`,
      [instanceId],
    );
    if (!inst) {
      return Response.json({ ok: false, error: 'Instância não encontrada ou inativa' }, { status: 404 });
    }
    if (inst.provider === 'meta') {
      return Response.json({ ok: false, error: 'Instância da API oficial recebe em /api/webhook/whatsapp-oficial' }, { status: 404 });
    }
    const clientId: string = inst.client_id;
    const provider: WhatsAppProvider = inst.provider === 'evolution' ? 'evolution' : 'zapi';
    // The URL param may be the DB UUID; Evolution's own endpoints need the instance NAME.
    const evolutionInstanceName: string = inst.instance_id ?? instanceId;

    // 2. Parse and normalize payload based on provider
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json().catch(() => ({}));

    if (provider === 'evolution') {
      const statusUpdates = extractEvolutionStatusUpdates(body);
      if (statusUpdates.length > 0) {
        await ensureCrmMessagesSchema(pool);
        for (const update of statusUpdates) {
          let updated = 0;
          if (update.id) {
            const result = await pool.query(
              `UPDATE public.crm_messages
                  SET whatsapp_status = $3,
                      whatsapp_error = CASE WHEN $3 = 'failed' THEN COALESCE($4, whatsapp_error) ELSE whatsapp_error END
                WHERE client_id = $1
                  AND external_id = $2`,
              [clientId, update.id, update.status, update.error ?? null],
            ).catch(err => {
              console.error('[webhook message status update]', err);
              return { rowCount: 0 };
            });
            updated = result.rowCount ?? 0;
          }

          if (updated === 0 && update.remoteDigits) {
            await pool.query(
              `WITH target_leads AS (
                 SELECT id
                   FROM public.crm_leads
                  WHERE client_id = $1
                    AND (
                      NULLIF(regexp_replace(COALESCE(numero, ''), '\\D', '', 'g'), '') = $5
                      OR NULLIF(regexp_replace(COALESCE(whatsapp_lid, ''), '\\D', '', 'g'), '') = $5
                    )
               ),
               target_message AS (
                 SELECT id
                   FROM public.crm_messages
                  WHERE client_id = $1
                    AND direction = 'out'
                    AND lead_id IN (SELECT id FROM target_leads)
                    AND created_at > NOW() - INTERVAL '7 days'
                    AND COALESCE(whatsapp_status, 'sent') IN ('pending', 'sent', 'delivered')
                  ORDER BY created_at DESC
                  LIMIT 1
               )
               UPDATE public.crm_messages m
                  SET whatsapp_status = $3,
                      whatsapp_error = CASE WHEN $3 = 'failed' THEN COALESCE($4, m.whatsapp_error) ELSE m.whatsapp_error END,
                      external_id = COALESCE(NULLIF($2, ''), m.external_id)
                 FROM target_message
                WHERE m.id = target_message.id`,
              [clientId, update.id, update.status, update.error ?? null, update.remoteDigits],
            ).catch(err => console.error('[webhook message status fallback]', err));
          }
        }
        return Response.json({ ok: true, status_updates: statusUpdates.length });
      }
    }

    // REGRA ABSOLUTA: mensagens de grupos NUNCA entram no CRM.
    // JIDs de grupo terminam em @g.us; listas de transmissão em @broadcast.
    // Esta verificação deve ocorrer antes de qualquer escrita no banco.
    if (provider === 'evolution') {
      const remoteJid: string = body?.data?.key?.remoteJid ?? '';
      if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast')) {
        return Response.json({ ok: true, ignored: true, reason: 'group_message' });
      }
    }
    // Z-API: some payloads expose isGroup flag
    if (provider === 'zapi' && body?.isGroup === true) {
      return Response.json({ ok: true, ignored: true, reason: 'group_message' });
    }

    const msg = normalizeWebhookPayload(provider, body);

    if (!msg) {
      return Response.json({ ok: false, error: 'telefone não identificado' }, { status: 400 });
    }

    // Evolution's webhook text for media messages is just a placeholder ("[Áudio]",
    // "[Imagem]"…) — the real bytes are end-to-end encrypted and not in the payload.
    // Fetch+decode them via getBase64FromMediaMessage and persist as a public URL so
    // the chat can actually render (MessageBubble handles tipo audio/imagem/video/
    // documento). Before 2026-07-16 only audio was fetched — incoming photos/videos/
    // documents showed up as the literal text "[Imagem]"/"[Vídeo]"/"[Doc]".
    let messageTipo: string = 'texto';
    let resolvedMessageText: string = msg.text;
    let mediaCaption: string | null = null;
    const evoMsg = provider === 'evolution' ? body?.data?.message : null;
    const mediaKind: string | null = evoMsg?.audioMessage ? 'audio'
      : evoMsg?.imageMessage ? 'imagem'
      : evoMsg?.stickerMessage ? 'imagem'
      : evoMsg?.videoMessage ? 'video'
      : evoMsg?.documentMessage ? 'documento'
      : null;
    if (mediaKind && body?.data?.key) {
      const media = await fetchEvolutionMediaBase64(evolutionInstanceName, body.data.key);
      if (media) {
        const mediaUrl = await uploadBase64ToStorage(media.base64, media.mimetype);
        if (mediaUrl) {
          resolvedMessageText = mediaUrl;
          messageTipo = mediaKind;
          // Legenda de imagem/vídeo vira uma segunda mensagem de texto (o bolha de
          // mídia usa o campo text como URL — anexar a legenda quebraria o src).
          mediaCaption = String(
            evoMsg?.imageMessage?.caption ?? evoMsg?.videoMessage?.caption ?? '',
          ).trim() || null;
        }
      }
    }

    return await registrarMensagemWhatsApp(pool, {
      clientId,
      instanceRowId: String(inst.id),
      instanceName: evolutionInstanceName,
      msg,
      media: { text: resolvedMessageText, tipo: messageTipo, caption: mediaCaption },
      rawPayload: body,
    });

  } finally {
    await pool.end();
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: 'Webhook WhatsApp (instância) ativo.',
  });
}
