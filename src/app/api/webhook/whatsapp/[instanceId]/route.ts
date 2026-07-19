import { makeServerPool } from '@/lib/server-db';
import { normalizeWebhookPayload, type WhatsAppProvider } from '@/lib/whatsapp-provider';
import { markLeadResponded } from '@/lib/followup-send';
import { analisarConversa } from '@/lib/crm-ai-analysis';
import { enviarEventoMeta, enviarEventoGoogle, hasSuccessfulConversion } from '@/lib/conversions';
import { upsertLeadFromConversation, ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { fetchEvolutionMediaBase64, uploadBase64ToStorage } from '@/lib/evolution-media';
import { logMissingAdTracking } from '@/lib/crm-tracking-debug';
import { resolveMetaAdHierarchy } from '@/lib/meta-ad-resolver';
import {
  extractTrackingFromText, extractClickCode, matchClickByCode, mergeTracking,
  applyLeadAttribution, linkClickToLead, recordTrackingEvent, originFromTracking,
  type MergedTracking,
} from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';
import type { NextRequest } from 'next/server';

// O download de mídia recebida (getBase64FromMediaMessage, timeout 15s) + upload pro
// storage não cabem no orçamento default de 10s do Hobby — sem isso, fotos/áudios
// grandes falhavam silenciosamente e viravam placeholder.
export const maxDuration = 60;

// ── Helpers ─────────────────────────────────────────────────────────────────

function originToCanal(origin: string): string {
  const map: Record<string, string> = {
    meta: 'Facebook', google: 'Google', instagram: 'Instagram',
    tiktok: 'TikTok', youtube: 'YouTube', indicacao: 'Indicação',
    anuncio: 'Whatsapp', cliente: 'Whatsapp', organic: 'Whatsapp',
  };
  return map[origin] ?? 'Whatsapp';
}

function detectOriginFromContext(text: string): string | null {
  const t = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/\bgoogle\b|\bpesquisei\b/.test(t)) return 'google';
  if (/\binstagram\b|\binsta\b/.test(t)) return 'instagram';
  if (/\bfacebook\b|\bfb\b/.test(t)) return 'meta';
  if (/\btiktok\b|\btik tok\b/.test(t)) return 'tiktok';
  if (/\byoutube\b/.test(t)) return 'youtube';
  if (/\banuncio\b|\bpropaganda\b|\bpublicidade\b/.test(t)) return 'anuncio';
  if (/\bindicac\w*\b|\bindicou\b|\bindicado\b/.test(t)) return 'indicacao';
  return null;
}

function detectOrigin(
  ctwaClid: string | undefined,
  tracking: MergedTracking,
  text: string,
  fromMe: boolean,
): string {
  if (ctwaClid) return 'meta';
  if (fromMe) return 'cliente';
  return originFromTracking(tracking) ?? detectOriginFromContext(text) ?? 'organic';
}

function parseProviderTimestamp(value: unknown): string {
  if (value === null || value === undefined || value === '') return new Date().toISOString();
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && value.trim() !== '') return parseProviderTimestamp(numeric);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const ms = value < 10_000_000_000 ? value * 1000 : value;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }
  return new Date().toISOString();
}

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
  const eventName = String(body?.event ?? body?.type ?? '').toUpperCase();
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
// Nota (Fase 4): o sendMetaEvent legado (action_source: 'other', sem page_id,
// sem event_id) foi removido — ele duplicava o Purchase com o CAPI novo e a Meta
// não atribuía os eventos dele. Todo envio agora passa por enviarEventoMeta
// (business_messaging + dedup), que faz fallback pra config legada
// (client_tracking_config) quando o cliente não tem client_conversion_config.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  const pool = makeServerPool();

  try {
    // 1. Resolve instance → client + provider (accepts UUID or instance_id name)
    const { rows: [inst] } = await pool.query(
      `SELECT client_id, provider, instance_id FROM public.client_zapi_instances
       WHERE (id::text = $1 OR instance_id = $1) AND ativo = true`,
      [instanceId],
    );
    if (!inst) {
      return Response.json({ ok: false, error: 'Instância não encontrada ou inativa' }, { status: 404 });
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

    const {
      phone, lid, fromMe, text: rawMessageText, timestamp, externalId, ctwaClid, sourceId,
      sourceUrl, campaignName, adsetName, adName, creativeName, pushName, profilePictureUrl,
    } = msg;
    const messageCreatedAt = parseProviderTimestamp(timestamp);

    // Evolution's webhook text for media messages is just a placeholder ("[Áudio]",
    // "[Imagem]"…) — the real bytes are end-to-end encrypted and not in the payload.
    // Fetch+decode them via getBase64FromMediaMessage and persist as a public URL so
    // the chat can actually render (MessageBubble handles tipo audio/imagem/video/
    // documento). Before 2026-07-16 only audio was fetched — incoming photos/videos/
    // documents showed up as the literal text "[Imagem]"/"[Vídeo]"/"[Doc]".
    let messageTipo: string = 'texto';
    let resolvedMessageText: string = rawMessageText;
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

    // ── CRM: upsert lead + save message (always, regardless of pixel config) ──
    // 1) Fallback legado: UTMs/click-ids de URLs coladas no texto da mensagem.
    // 2) Caminho robusto: código curto ("Cód: A7X2K9") injetado pelo /r/[slug] —
    //    casa com o clique gravado server-side e herda a atribuição COMPLETA
    //    (utm, gclid, keyword, placement, device, geo), imune a edição do texto.
    const textTracking = extractTrackingFromText(rawMessageText);
    const clickCode = fromMe ? null : extractClickCode(rawMessageText);
    const clickMatch = clickCode ? await matchClickByCode(pool, clickCode).catch(() => null) : null;
    const tracking = mergeTracking(textTracking, clickMatch);
    const origin = detectOrigin(ctwaClid, tracking, rawMessageText, fromMe);

    // When fromMe=true the pushName is the instance owner's name, not the contact's.
    // Only set nome from pushName on incoming messages (fromMe=false).
    const contactName = fromMe ? null : (pushName ?? null);
    const canal = originToCanal(origin);

    // Diagnostic: origin says it came from an ad channel (Facebook/Instagram/Google/TikTok/
    // YouTube) but NO tracking identifier came through at all — neither ctwa_clid/externalAdReply
    // (Meta) nor any utm_*/source_id (Google, TikTok, etc.) — so campanha/conjunto/anúncio would
    // all show "Não recebido" in the UI. Persist the raw payload so we can inspect, after the
    // fact, whether the provider actually forwarded the ad-tracking context for this message —
    // there's no other record of it once this request ends.
    const AD_ORIGINS = ['meta', 'instagram', 'google', 'tiktok', 'youtube'];
    const hasAnyTracking = Boolean(
      ctwaClid || sourceId || clickMatch
      || tracking.utm_source || tracking.utm_campaign
      || tracking.gclid || tracking.wbraid || tracking.gbraid || tracking.fbclid || tracking.ttclid,
    );
    if (!fromMe && AD_ORIGINS.includes(origin) && !hasAnyTracking) {
      await logMissingAdTracking(pool, { clientId, phone, canal, rawPayload: body });
    }

    // WhatsApp's own ad-referral payload never carries campaign/adset names — only
    // `sourceId` (the ad's Graph API object ID). Resolve the real names via the Marketing
    // API using the client's connected ads account, same as third-party CTWA tracking
    // tools do. Best-effort: falls back to whatever (likely empty) names came inline.
    let resolvedCampaignName = campaignName ?? null;
    let resolvedAdsetName = adsetName ?? null;
    let resolvedAdName = adName ?? null;
    if (!fromMe && sourceId) {
      const hierarchy = await resolveMetaAdHierarchy(pool, clientId, sourceId).catch(() => null);
      if (hierarchy) {
        resolvedCampaignName = hierarchy.campaign_name ?? resolvedCampaignName;
        resolvedAdsetName = hierarchy.adset_name ?? resolvedAdsetName;
        resolvedAdName = hierarchy.ad_name ?? resolvedAdName;
      }
    }

    // Use upsertLeadFromConversation — works without a unique constraint on (client_id, numero)
    const { id: leadId } = await upsertLeadFromConversation(pool, {
      clientId,
      phone,
      lid: lid ?? undefined,
      name: contactName ?? undefined,
      profilePictureUrl: profilePictureUrl ?? undefined,
      lastMessageAt: messageCreatedAt,
      lastMessageText: rawMessageText || undefined,
      lastDirection: fromMe ? 'out' : 'in',
      canal,
      origin,
      ctwaClid: ctwaClid ?? null,
      sourceId: sourceId ?? null,
      sourceUrl: sourceUrl ?? tracking.source_url ?? null,
      utmSource: tracking.utm_source ?? null,
      utmMedium: tracking.utm_medium ?? null,
      utmCampaign: tracking.utm_campaign ?? null,
      utmContent: tracking.utm_content ?? null,
      utmTerm: tracking.utm_term ?? null,
      campaignName: resolvedCampaignName,
      adsetName: resolvedAdsetName,
      adName: resolvedAdName,
      creativeName: creativeName ?? null,
      instanceId: evolutionInstanceName ?? instanceId,
    });

    // ── Atribuição estendida + região (first-touch: nunca sobrescreve) ────────
    // Região: prioriza a geolocalização do clique (localização real via headers
    // da Vercel); sem clique, deriva do DDD do telefone (sempre disponível p/ BR).
    const dddInfo = regiaoFromPhone(phone);
    const regiao = (clickMatch?.geo_region || clickMatch?.geo_city)
      ? { uf: clickMatch?.geo_region ?? null, cidade: clickMatch?.geo_city ?? null, fonte: 'ip' as const }
      : dddInfo
        ? { uf: dddInfo.uf, cidade: dddInfo.regiao, fonte: 'ddd' as const }
        : null;
    await applyLeadAttribution(pool, leadId, {
      // Em mensagens fromMe o texto é do atendente — não vale como atribuição.
      tracking: fromMe ? {} : tracking,
      ddd: dddInfo?.ddd ?? null,
      regiaoUf: regiao?.uf ?? null,
      regiaoCidade: regiao?.cidade ?? null,
      regiaoFonte: regiao?.fonte ?? null,
      hasClickMatch: Boolean(clickMatch),
    });
    // Elo permanente clique ↔ lead (o clique deixa de ser anônimo)
    if (clickMatch) await linkClickToLead(pool, clickMatch.id, leadId);

    const { rows: [crmLead] } = await pool.query<{ id: string; time_interno: boolean }>(
      `SELECT id, time_interno FROM public.crm_leads WHERE id = $1`,
      [leadId],
    );

    // messageText: the resolved audio URL for audio messages (see above), otherwise the
    // normalizer's placeholder text ("[Imagem]", "[Vídeo]"...) for other media types.
    const messageText = resolvedMessageText;

    let isFirstInbound = false;
    if (crmLead && messageText) {
      await ensureCrmMessagesSchema(pool);
      // A failure here must NEVER 500 the webhook (Evolution would retry forever and
      // the lead's last-message preview would already be committed). Persist best-effort.
      try {
        if (externalId) {
          // Deduplicate by external_id to prevent double-inserts from retried webhooks.
          // NOTE: the unique index on (lead_id, external_id) is PARTIAL, so a bare
          // `ON CONFLICT (lead_id, external_id)` cannot be inferred — use the bare
          // `ON CONFLICT DO NOTHING`, which considers every usable unique index.
          await pool.query(
            `INSERT INTO public.crm_messages
              (lead_id, client_id, direction, text, tipo, external_id, created_at, whatsapp_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
             ON CONFLICT DO NOTHING`,
            [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, externalId, messageCreatedAt, fromMe ? 'sent' : null],
          );
        } else {
          await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo, created_at, whatsapp_status)
             SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7
             WHERE NOT EXISTS (
               SELECT 1 FROM public.crm_messages
               WHERE lead_id = $1 AND text = $4 AND created_at = $6::timestamptz
             )`,
            [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, messageCreatedAt, fromMe ? 'sent' : null],
          );
        }
      } catch (err) {
        console.error('[webhook crm_messages insert]', err);
      }
      // Legenda da mídia (caption de imagem/vídeo) vira mensagem de texto própria,
      // 1s depois da mídia pra manter a ordem no chat. Dedup por external_id:caption.
      if (mediaCaption) {
        await pool.query(
          `INSERT INTO public.crm_messages
             (lead_id, client_id, direction, text, tipo, external_id, created_at, whatsapp_status)
           VALUES ($1, $2, $3, $4, 'texto', $5, $6::timestamptz + interval '1 second', $7)
           ON CONFLICT DO NOTHING`,
          [crmLead.id, clientId, fromMe ? 'out' : 'in', mediaCaption,
           externalId ? `${externalId}:caption` : null, messageCreatedAt, fromMe ? 'sent' : null],
        ).catch(() => null);
      }
      if (!fromMe) {
        // Detect first inbound message (now count = 1 after insert above)
        const { rows: [{ cnt }] } = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM public.crm_messages
            WHERE lead_id = $1 AND direction = 'in'`,
          [crmLead.id],
        ).catch(() => ({ rows: [{ cnt: 0 }] }));
        isFirstInbound = Number(cnt) === 1;
        await markLeadResponded(pool, crmLead.id).catch(() => null);
      }
    }
    // ── Histórico imutável de toques (lead_tracking_events) ───────────────────
    // Grava: (a) o primeiro contato do lead (sempre, com o snapshot completo da
    // atribuição) e (b) qualquer mensagem posterior que traga identificador novo
    // de rastreio (ctwa/código/utm). Mensagens orgânicas do meio da conversa não
    // geram evento — o histórico é de TOQUES DE ATRIBUIÇÃO, não de mensagens.
    if (crmLead && !fromMe) {
      const eventType = ctwaClid ? 'ctwa'
        : clickMatch ? 'link_click'
        : (textTracking.utm_source || textTracking.gclid || textTracking.fbclid || textTracking.ttclid) ? 'utm_texto'
        : origin !== 'organic' && origin !== 'cliente' ? 'contexto'
        : 'organico';
      const carriesIdentifier = eventType === 'ctwa' || eventType === 'link_click' || eventType === 'utm_texto';
      if (isFirstInbound || carriesIdentifier) {
        await recordTrackingEvent(pool, {
          leadId: crmLead.id,
          clientId,
          eventType,
          origin,
          canal,
          externalId: externalId ?? null,
          ctwaClid: ctwaClid ?? null,
          sourceId: sourceId ?? null,
          sourceUrl: sourceUrl ?? tracking.source_url ?? null,
          tracking,
          campaignName: resolvedCampaignName,
          adsetName: resolvedAdsetName,
          adName: resolvedAdName,
          creativeName: creativeName ?? null,
          ddd: dddInfo?.ddd ?? null,
          regiaoUf: regiao?.uf ?? null,
          regiaoCidade: regiao?.cidade ?? null,
        });
      }
    }

    if (crmLead?.time_interno === true) {
      return Response.json({ ok: true, message: 'Contato interno salvo sem automações.' });
    }
    if (crmLead && messageText) {
      await analisarConversa(pool, crmLead.id).catch(err => console.error('[webhook analisarConversa]', err));
    }

    // ── CAPI / Enhanced Conversions (new system, client_conversion_config) ────
    if (crmLead && !fromMe) {
      const leadData = { id: crmLead.id as string, phone, ctwaClid: ctwaClid ?? null };
      if (isFirstInbound) {
        // First message = new lead contact
        await enviarEventoMeta(pool, clientId, 'Lead', leadData).catch(() => null);
        const { rows: [convCfg] } = await pool.query(
          `SELECT google_conversion_label_lead FROM public.client_conversion_config WHERE client_id = $1`,
          [clientId],
        ).catch(() => ({ rows: [] as Array<{ google_conversion_label_lead: string | null }> }));
        await enviarEventoGoogle(pool, clientId, convCfg?.google_conversion_label_lead, leadData).catch(() => null);
      } else {
        // First response after being created
        const { rows: [{ total_in }] } = await pool.query(
          `SELECT COUNT(*)::int AS total_in FROM public.crm_messages
            WHERE lead_id = $1 AND direction = 'in'`,
          [crmLead.id],
        ).catch(() => ({ rows: [{ total_in: 0 }] }));
        if (Number(total_in) === 2) {
          // Second inbound = first reply after initial contact
          await enviarEventoMeta(pool, clientId, 'Contact', leadData).catch(() => null);
          const { rows: [convCfg] } = await pool.query(
            `SELECT google_conversion_label_contact FROM public.client_conversion_config WHERE client_id = $1`,
            [clientId],
          ).catch(() => ({ rows: [] as Array<{ google_conversion_label_contact: string | null }> }));
          await enviarEventoGoogle(pool, clientId, convCfg?.google_conversion_label_contact, leadData).catch(() => null);
        }
      }
    }

    // 3. Load client tracking config (optional — only needed for pixel events)
    const { rows: [cfg] } = await pool.query(
      `SELECT pixel_id, meta_token, gatilho_compra, eventos_ativos
       FROM public.client_tracking_config WHERE client_id = $1`,
      [clientId],
    );
    if (!cfg?.pixel_id || !cfg?.meta_token) {
      return Response.json({ ok: true, message: 'CRM salvo. Pixel não configurado para este cliente.' });
    }
    const eventos: { lead: boolean; purchase: boolean } = cfg.eventos_ativos ?? { lead: true, purchase: true };
    const gatilho: string = (cfg.gatilho_compra ?? 'compra aprovada').toLowerCase().trim();

    // ── FLOW 1: Lead (received from ad) ──────────────────────────────────────
    if (!fromMe) {
      if (!eventos.lead) {
        return Response.json({ ok: true, message: 'evento Lead desativado para este cliente' });
      }

      if (!ctwaClid && !sourceId) {
        return Response.json({ ok: true, message: 'mensagem orgânica, salva no CRM' });
      }

      // Deduplicate per client
      const { rows: existing } = await pool.query(
        `SELECT id FROM public.whatsapp_leads WHERE telefone = $1 AND client_id = $2`,
        [phone, clientId],
      );
      if (existing.length > 0) {
        return Response.json({ ok: true, message: 'lead já registrado para este cliente' });
      }

      // O evento Lead já foi disparado pelo CAPI novo no primeiro inbound (acima).
      // Aqui só registramos o lead na whatsapp_leads (bookkeeping do fluxo de
      // Purchase) com o status real do envio, lido do conversion_log.
      const leadSent = crmLead
        ? await hasSuccessfulConversion(pool, {
            clientId, leadId: crmLead.id, plataforma: 'meta', eventName: 'Lead',
          }).catch(() => false)
        : false;

      await pool.query(`
        INSERT INTO public.whatsapp_leads
          (telefone, ctwa_clid, source_id, pixel_id,
           evento_lead_enviado, client_id, zapi_instance_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [phone, ctwaClid ?? null, sourceId ?? null, cfg.pixel_id,
          leadSent, clientId, instanceId]);

      return Response.json({ ok: true, action: 'lead_created', meta_sent: leadSent });
    }

    // ── FLOW 2: Purchase (sent by attendant) ─────────────────────────────────
    if (fromMe) {
      if (!eventos.purchase) {
        return Response.json({ ok: true, message: 'evento Purchase desativado para este cliente' });
      }

      const lcMsg = messageText.toLowerCase();
      if (!lcMsg.includes(gatilho)) {
        return Response.json({ ok: true, message: 'mensagem sem gatilho de compra, ignorada' });
      }

      // Extract value after the trigger keyword
      const afterGatilho = lcMsg.slice(lcMsg.indexOf(gatilho) + gatilho.length).trim();
      const match = afterGatilho.match(/^[\s:]*([\d.,]+)/);
      if (!match) {
        return Response.json({ ok: false, error: 'valor de compra não encontrado após o gatilho' }, { status: 400 });
      }
      const valor = parseFloat(match[1].replace(',', '.'));
      if (isNaN(valor)) {
        return Response.json({ ok: false, error: 'valor de compra inválido' }, { status: 400 });
      }

      const { rows: [lead] } = await pool.query(
        `SELECT id, ctwa_clid, evento_compra_enviado
         FROM public.whatsapp_leads WHERE telefone = $1 AND client_id = $2`,
        [phone, clientId],
      );
      if (!lead) {
        return Response.json({ ok: false, error: 'lead não encontrado para este telefone/cliente' }, { status: 404 });
      }
      if (lead.evento_compra_enviado) {
        return Response.json({ ok: true, message: 'evento de compra já enviado anteriormente' });
      }

      // Envio ÚNICO pelo CAPI novo (antes disparava DUAS vezes: sendMetaEvent
      // legado com action_source 'other' + este — o legado foi removido).
      const leadDataForCapi = { id: crmLead?.id as string | undefined, phone, ctwaClid: lead.ctwa_clid };
      await enviarEventoMeta(pool, clientId, 'Purchase', leadDataForCapi, valor).catch(() => null);
      const purchaseSent = crmLead
        ? await hasSuccessfulConversion(pool, {
            clientId, leadId: crmLead.id, plataforma: 'meta', eventName: 'Purchase',
          }).catch(() => false)
        : false;

      await pool.query(
        `UPDATE public.whatsapp_leads
         SET evento_compra_enviado = $1, valor_compra = $2
         WHERE id = $3`,
        [purchaseSent, valor, lead.id],
      );

      const { rows: [convCfgP] } = await pool.query(
        `SELECT google_conversion_label_purchase FROM public.client_conversion_config WHERE client_id = $1`,
        [clientId],
      ).catch(() => ({ rows: [] as Array<{ google_conversion_label_purchase: string | null }> }));
      await enviarEventoGoogle(pool, clientId, convCfgP?.google_conversion_label_purchase, leadDataForCapi, valor).catch(() => null);

      return Response.json({ ok: true, action: 'purchase_sent', valor, meta_sent: purchaseSent });
    }

    return Response.json({ ok: true, message: 'mensagem ignorada' });

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
