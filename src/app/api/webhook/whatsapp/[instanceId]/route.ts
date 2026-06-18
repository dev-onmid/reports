import { createHash } from 'crypto';
import { makeServerPool } from '@/lib/server-db';
import { normalizeWebhookPayload, type WhatsAppProvider } from '@/lib/whatsapp-provider';
import { markLeadResponded } from '@/lib/followup-send';
import { analisarConversa } from '@/lib/crm-ai-analysis';
import { enviarEventoMeta, enviarEventoGoogle } from '@/lib/conversions';
import { upsertLeadFromConversation, ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { fetchEvolutionMediaBase64, uploadBase64ToStorage } from '@/lib/evolution-media';
import type { NextRequest } from 'next/server';

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractUtm(text: string): {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  source_url?: string;
} {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      const utm_source = u.searchParams.get('utm_source') ?? undefined;
      if (utm_source) {
        return {
          utm_source,
          utm_medium: u.searchParams.get('utm_medium') ?? undefined,
          utm_campaign: u.searchParams.get('utm_campaign') ?? undefined,
          utm_content: u.searchParams.get('utm_content') ?? undefined,
          utm_term: u.searchParams.get('utm_term') ?? undefined,
          source_url: url,
        };
      }
    } catch { /* invalid URL, skip */ }
  }
  const srcMatch = text.match(/utm_source=([^\s&]+)/i);
  if (srcMatch) {
    return {
      utm_source: srcMatch[1],
      utm_medium: text.match(/utm_medium=([^\s&]+)/i)?.[1],
      utm_campaign: text.match(/utm_campaign=([^\s&]+)/i)?.[1],
      utm_content: text.match(/utm_content=([^\s&]+)/i)?.[1],
      utm_term: text.match(/utm_term=([^\s&]+)/i)?.[1],
    };
  }
  return {};
}

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
  utmSource: string | undefined,
  text: string,
  fromMe: boolean,
): string {
  if (ctwaClid) return 'meta';
  if (fromMe) return 'cliente';
  if (utmSource) {
    const src = utmSource.toLowerCase();
    if (src.includes('google')) return 'google';
    if (src.includes('instagram')) return 'instagram';
    if (src.includes('facebook') || src.includes('fb')) return 'meta';
    if (src.includes('tiktok')) return 'tiktok';
    return utmSource;
  }
  return detectOriginFromContext(text) ?? 'organic';
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone).digest('hex');
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

async function sendMetaEvent({
  pixelId, accessToken, eventName, phone, ctwaClid, value,
}: {
  pixelId: string; accessToken: string;
  eventName: 'Lead' | 'Purchase';
  phone: string; ctwaClid?: string | null; value?: number;
}): Promise<{ success: boolean; error?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userData: Record<string, any> = { ph: [hashPhone(phone)] };
  if (ctwaClid) userData.ctwa_clid = ctwaClid;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventData: Record<string, any> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'other',
    user_data: userData,
  };
  if (eventName === 'Purchase' && value !== undefined) {
    eventData.custom_data = { currency: 'BRL', value };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [eventData], access_token: accessToken }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { success: false, error: JSON.stringify(err) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

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

    // Evolution's webhook text for audio messages is just a "[Áudio]" placeholder — the
    // real bytes are end-to-end encrypted and not in the payload. Fetch+decode them via
    // getBase64FromMediaMessage and persist as a public URL so the chat can actually play
    // it back (MessageBubble renders an <audio> player for tipo 'audio').
    let messageTipo: string = 'texto';
    let resolvedMessageText: string = rawMessageText;
    if (provider === 'evolution' && body?.data?.message?.audioMessage && body?.data?.key) {
      const media = await fetchEvolutionMediaBase64(evolutionInstanceName, body.data.key);
      if (media) {
        const audioUrl = await uploadBase64ToStorage(media.base64, media.mimetype);
        if (audioUrl) {
          resolvedMessageText = audioUrl;
          messageTipo = 'audio';
        }
      }
    }

    // ── CRM: upsert lead + save message (always, regardless of pixel config) ──
    const utmData = extractUtm(rawMessageText);
    const origin = detectOrigin(ctwaClid, utmData.utm_source, rawMessageText, fromMe);

    // When fromMe=true the pushName is the instance owner's name, not the contact's.
    // Only set nome from pushName on incoming messages (fromMe=false).
    const contactName = fromMe ? null : (pushName ?? null);
    const canal = originToCanal(origin);

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
      sourceUrl: sourceUrl ?? utmData.source_url ?? null,
      utmSource: utmData.utm_source ?? null,
      utmMedium: utmData.utm_medium ?? null,
      utmCampaign: utmData.utm_campaign ?? null,
      utmContent: utmData.utm_content ?? null,
      utmTerm: utmData.utm_term ?? null,
      campaignName: campaignName ?? null,
      adsetName: adsetName ?? null,
      adName: adName ?? null,
      creativeName: creativeName ?? null,
      instanceId: evolutionInstanceName ?? instanceId,
    });

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
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo, external_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
             ON CONFLICT DO NOTHING`,
            [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, externalId, messageCreatedAt],
          );
        } else {
          await pool.query(
            `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo, created_at)
             SELECT $1, $2, $3, $4, $5, $6::timestamptz
             WHERE NOT EXISTS (
               SELECT 1 FROM public.crm_messages
               WHERE lead_id = $1 AND text = $4 AND created_at = $6::timestamptz
             )`,
            [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, messageCreatedAt],
          );
        }
      } catch (err) {
        console.error('[webhook crm_messages insert]', err);
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

      const metaResult = await sendMetaEvent({
        pixelId: cfg.pixel_id, accessToken: cfg.meta_token,
        eventName: 'Lead', phone, ctwaClid,
      });

      await pool.query(`
        INSERT INTO public.whatsapp_leads
          (telefone, ctwa_clid, source_id, pixel_id,
           evento_lead_enviado, client_id, zapi_instance_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [phone, ctwaClid ?? null, sourceId ?? null, cfg.pixel_id,
          metaResult.success, clientId, instanceId]);

      return Response.json({
        ok: true, action: 'lead_created',
        meta_sent: metaResult.success, meta_error: metaResult.error ?? null,
      });
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

      const metaResult = await sendMetaEvent({
        pixelId: cfg.pixel_id, accessToken: cfg.meta_token,
        eventName: 'Purchase', phone, ctwaClid: lead.ctwa_clid, value: valor,
      });

      await pool.query(
        `UPDATE public.whatsapp_leads
         SET evento_compra_enviado = $1, valor_compra = $2
         WHERE id = $3`,
        [metaResult.success, valor, lead.id],
      );

      // Also fire through new CAPI system (logs separately, non-blocking)
      const leadDataForCapi = { id: crmLead?.id as string | undefined, phone, ctwaClid: lead.ctwa_clid };
      await enviarEventoMeta(pool, clientId, 'Purchase', leadDataForCapi, valor).catch(() => null);
      const { rows: [convCfgP] } = await pool.query(
        `SELECT google_conversion_label_purchase FROM public.client_conversion_config WHERE client_id = $1`,
        [clientId],
      ).catch(() => ({ rows: [] as Array<{ google_conversion_label_purchase: string | null }> }));
      await enviarEventoGoogle(pool, clientId, convCfgP?.google_conversion_label_purchase, leadDataForCapi, valor).catch(() => null);

      return Response.json({
        ok: true, action: 'purchase_sent', valor,
        meta_sent: metaResult.success, meta_error: metaResult.error ?? null,
      });
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
