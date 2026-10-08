import type { Pool } from 'pg';
import { avaliarEngajamento } from '@/lib/lead-qualificacao-server';
import type { NormalizedMessage } from '@/lib/whatsapp-provider';
import { markLeadResponded } from '@/lib/followup-send';
import { analisarConversa } from '@/lib/crm-ai-analysis';
import { enviarEventoMeta, enviarEventoGoogle, hasSuccessfulConversion } from '@/lib/conversions';
import { upsertLeadFromConversation, ensureCrmMessagesSchema } from '@/lib/crm-conversation-sync';
import { resolverLeadExistente } from '@/lib/lead-identity';
import { logMissingAdTracking } from '@/lib/crm-tracking-debug';
import { resolveMetaAdHierarchy } from '@/lib/meta-ad-resolver';
import {
  extractTrackingFromText, extractClickCode, matchClickByCode, matchClickByWindow,
  DORMENCIA_REENTRADA_DIAS, mergeTracking,
  applyLeadAttribution, linkClickToLead, recordTrackingEvent, originFromTracking,
  type MergedTracking,
} from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';

// Pipeline único de uma mensagem de WhatsApp dentro do CRM — lead, atribuição,
// histórico, conversões (CAPI/Google) e o fluxo legado do Pixel. Os webhooks
// (Evolution/Z-API e Meta oficial) só normalizam o payload e resolvem mídia;
// tudo que acontece DEPOIS disso mora aqui, para os provedores não divergirem.

export type EntradaMensagem = {
  clientId: string;
  /** UUID da linha em client_zapi_instances (whatsapp_leads.zapi_instance_id). */
  instanceRowId: string;
  /** Identificador da instância no provedor (nome Evolution, phone_number_id da Meta…). */
  instanceName: string;
  msg: NormalizedMessage;
  /** Texto já resolvido (URL pública quando é mídia), tipo e legenda separada. */
  media: { text: string; tipo: string; caption: string | null };
  rawPayload: unknown;
};

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
  sourceUrl: string | null | undefined,
  tracking: MergedTracking,
  text: string,
  fromMe: boolean,
): string {
  // CTWA: o sourceUrl do externalAdReply diz ONDE a pessoa clicou no anúncio —
  // link do Instagram = placement Instagram (senão fica tudo rotulado Facebook).
  if (ctwaClid) return /instagram\.com/i.test(String(sourceUrl ?? '')) ? 'instagram' : 'meta';
  if (fromMe) return 'cliente';
  return originFromTracking(tracking) ?? detectOriginFromContext(text) ?? 'organic';
}

export function parseProviderTimestamp(value: unknown): string {
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

// Nota (Fase 4): o sendMetaEvent legado (action_source: 'other', sem page_id,
// sem event_id) foi removido — ele duplicava o Purchase com o CAPI novo e a Meta
// não atribuía os eventos dele. Todo envio agora passa por enviarEventoMeta
// (business_messaging + dedup), que faz fallback pra config legada
// (client_tracking_config) quando o cliente não tem client_conversion_config.
export async function registrarMensagemWhatsApp(pool: Pool, entrada: EntradaMensagem): Promise<Response> {
  const { clientId, instanceRowId, instanceName, msg, media, rawPayload: body } = entrada;
  const {
    phone, lid, fromMe, text: rawMessageText, timestamp, externalId, ctwaClid, sourceId,
    sourceUrl, campaignName, adsetName, adName, creativeName, pushName, profilePictureUrl,
  } = msg;
  const messageCreatedAt = parseProviderTimestamp(timestamp);
  const { text: resolvedMessageText, tipo: messageTipo, caption: mediaCaption } = media;

  // ── CRM: upsert lead + save message (always, regardless of pixel config) ──
  // 1) Fallback legado: UTMs/click-ids de URLs coladas no texto da mensagem.
  // 2) Caminho robusto: código curto ("Cód: A7X2K9") injetado pelo /r/[slug] —
  //    casa com o clique gravado server-side e herda a atribuição COMPLETA
  //    (utm, gclid, keyword, placement, device, geo), imune a edição do texto.
  const textTracking = extractTrackingFromText(rawMessageText);
  const clickCode = fromMe ? null : extractClickCode(rawMessageText);
  const clickMatch = clickCode ? await matchClickByCode(pool, clickCode).catch(() => null) : null;

  // 3) Rede de segurança: o lead APAGOU a mensagem pré-preenchida e escreveu a
  //    dele, então não há código nenhum para ler. Aí o clique é casado pela
  //    JANELA DE TEMPO — mas só quando a conversa está NASCENDO agora, porque
  //    mensagem de lead que já existe roubaria a atribuição dele.
  //    ⚠️ A régua de "já existe" é a MESMA do upsert (resolverLeadExistente):
  //    duas réguas de identidade divergentes aqui fariam a janela disparar em
  //    lead antigo que a régua boa reconheceria. E `matchClickByWindow` recusa
  //    qualquer ambiguidade — ver as travas lá.
  //    ⚠️⚠️ E só quando a mensagem NÃO traz identificador melhor. Um lead que
  //    chega por CTWA (anúncio da Meta, direto no WhatsApp) não tem código
  //    nenhum — sem esta guarda, a janela penduraria nele o clique de OUTRA
  //    pessoa que passou pelo /r/ no mesmo minuto, trocando uma atribuição
  //    certa (Meta) por uma inventada. Prova sempre vence inferência.
  const temSinalMelhor = Boolean(
    ctwaClid || sourceId
    || textTracking.utm_source || textTracking.utm_campaign
    || textTracking.gclid || textTracking.wbraid || textTracking.gbraid
    || textTracking.fbclid || textTracking.ttclid,
  );
  let clickJanela: Awaited<ReturnType<typeof matchClickByCode>> = null;
  if (!clickMatch && !fromMe && !temSinalMelhor) {
    const jaExiste = await resolverLeadExistente(pool, clientId, {
      telefone: phone, lid: lid ?? undefined,
    }).catch(() => null);
    // Lead NOVO entra direto. Lead que JÁ EXISTE entra só se estava em
    // silêncio — é reentrada (clicou de novo num anúncio meses depois), e não
    // mensagem no meio de uma conversa que já rola. Ver DORMENCIA_REENTRADA_DIAS.
    // ⚠️ A leitura acontece ANTES do upsert de propósito: depois dele a coluna
    // já carrega o carimbo desta mensagem e todo lead pareceria ativo.
    const reentrada = jaExiste
      ? await pool.query<{ dormente: boolean }>(
          `SELECT (whatsapp_last_message_at IS NULL
                   OR whatsapp_last_message_at < NOW() - ($2 || ' days')::interval) AS dormente
             FROM public.crm_leads WHERE id = $1`,
          [jaExiste.id, String(DORMENCIA_REENTRADA_DIAS)],
        ).then(r => r.rows[0]?.dormente === true).catch(() => false)
      : false;
    if (!jaExiste || reentrada) {
      clickJanela = await matchClickByWindow(pool, {
        clientId, quando: messageCreatedAt,
      }).catch(() => null);
    }
  }
  const click = clickMatch ?? clickJanela;
  const tracking = mergeTracking(textTracking, click);
  const origin = detectOrigin(ctwaClid, sourceUrl ?? tracking.source_url, tracking, rawMessageText, fromMe);

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
    ctwaClid || sourceId || click
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
    instanceId: instanceName,
  });

  // ── Atribuição estendida + região (first-touch: nunca sobrescreve) ────────
  // Região: prioriza a geolocalização do clique (localização real via headers
  // da Vercel); sem clique, deriva do DDD do telefone (sempre disponível p/ BR).
  const dddInfo = regiaoFromPhone(phone);
  const regiao = (click?.geo_region || click?.geo_city)
    ? { uf: click?.geo_region ?? null, cidade: click?.geo_city ?? null, fonte: 'ip' as const }
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
    hasClickMatch: Boolean(click),
    clientId,
  });
  // Elo permanente clique ↔ lead (o clique deixa de ser anônimo)
  if (click) await linkClickToLead(pool, click.id, leadId);

  const { rows: [crmLead] } = await pool.query<{ id: string; time_interno: boolean }>(
    `SELECT id, time_interno FROM public.crm_leads WHERE id = $1`,
    [leadId],
  );

  // messageText: the resolved media URL for media messages (see the webhook), otherwise
  // the normalizer's placeholder text ("[Imagem]", "[Vídeo]"...) for other media types.
  const messageText = resolvedMessageText;

  let isFirstInbound = false;
  if (crmLead && messageText) {
    await ensureCrmMessagesSchema(pool);
    // A failure here must NEVER 500 the webhook (Evolution would retry forever and
    // the lead's last-message preview would already be committed). Persist best-effort.
    try {
      const replyTo = msg.quotedText?.slice(0, 500) ?? null;
      if (externalId) {
        // Deduplicate by external_id to prevent double-inserts from retried webhooks.
        // NOTE: the unique index on (lead_id, external_id) is PARTIAL, so a bare
        // `ON CONFLICT (lead_id, external_id)` cannot be inferred — use the bare
        // `ON CONFLICT DO NOTHING`, which considers every usable unique index.
        await pool.query(
          `INSERT INTO public.crm_messages
            (lead_id, client_id, direction, text, tipo, external_id, created_at, whatsapp_status, reply_to_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9)
           ON CONFLICT DO NOTHING`,
          [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, externalId, messageCreatedAt, fromMe ? 'sent' : null, replyTo],
        );
      } else {
        await pool.query(
          `INSERT INTO public.crm_messages (lead_id, client_id, direction, text, tipo, created_at, whatsapp_status, reply_to_text)
           SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7, $8
           WHERE NOT EXISTS (
             SELECT 1 FROM public.crm_messages
             WHERE lead_id = $1 AND text = $4 AND created_at = $6::timestamptz
           )`,
          [crmLead.id, clientId, fromMe ? 'out' : 'in', messageText, messageTipo, messageCreatedAt, fromMe ? 'sent' : null, replyTo],
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
    // ⚠️ 'link_click_janela' é tipo PRÓPRIO de propósito: atribuição por
    // janela é inferência, e o histórico tem de dizer isso — auditar depois
    // "quais leads foram atribuídos no chute" precisa ser uma consulta, não
    // uma arqueologia.
    const eventType = ctwaClid ? 'ctwa'
      : clickMatch ? 'link_click'
      : clickJanela ? 'link_click_janela'
      : (textTracking.utm_source || textTracking.gclid || textTracking.fbclid || textTracking.ttclid) ? 'utm_texto'
      : origin !== 'organic' && origin !== 'cliente' ? 'contexto'
      : 'organico';
    const carriesIdentifier = eventType === 'ctwa' || eventType === 'link_click'
      || eventType === 'link_click_janela' || eventType === 'utm_texto';
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
      // ⚠️ ENGAJADO (pedido do Matheus, 16/09): sinal de QUALIDADE para o Meta, por
      // regra determinística — contagem de mensagens recebidas, sem IA no caminho.
      // `avaliarEngajamento` só devolve `virou: true` na TRANSIÇÃO, então o evento
      // sai uma vez por lead, nunca a cada mensagem seguinte.
      const eng = await avaliarEngajamento(pool, clientId, crmLead.id).catch(() => ({ virou: false, movido: false }));
      if (eng.virou) {
        await enviarEventoMeta(pool, clientId, 'Lead_Engajado', leadData).catch(() => null);
      }

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
        leadSent, clientId, instanceRowId]);

    return Response.json({ ok: true, action: 'lead_created', meta_sent: leadSent });
  }

  // ── FLOW 2: Purchase (sent by attendant) ─────────────────────────────────
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
