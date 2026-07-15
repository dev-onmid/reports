import { createHash, randomUUID } from 'crypto';
import type { Pool } from 'pg';
import {
  resolveGoogleAdsAccess, resolveConversionAction, uploadClickConversion,
  type ClickIds,
} from '@/lib/google-offline-conversions';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversionLeadData = {
  id?: string | null;
  phone: string;
  ctwaClid?: string | null;
};

type ConversionConfig = {
  meta_pixel_id: string | null;
  meta_access_token: string | null;
  meta_test_event_code: string | null;
  meta_page_id: string | null;
  meta_ativo: boolean;
  google_customer_id: string | null;
  google_conversion_label_lead: string | null;
  google_conversion_label_contact: string | null;
  google_conversion_label_purchase: string | null;
  google_api_secret: string | null;
  google_measurement_id: string | null;
  google_ativo: boolean;
};

// ── Schema ────────────────────────────────────────────────────────────────────

export async function ensureConversionSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.client_conversion_config (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL UNIQUE,
      meta_pixel_id TEXT,
      meta_access_token TEXT,
      meta_test_event_code TEXT,
      meta_page_id TEXT,
      meta_ativo BOOLEAN NOT NULL DEFAULT false,
      google_customer_id TEXT,
      google_conversion_label_lead TEXT,
      google_conversion_label_contact TEXT,
      google_conversion_label_purchase TEXT,
      google_api_secret TEXT,
      google_measurement_id TEXT,
      google_ativo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE public.client_conversion_config ADD COLUMN IF NOT EXISTS meta_page_id TEXT;

    CREATE TABLE IF NOT EXISTS public.client_conversion_eventos_custom (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT NOT NULL,
      status_gatilho TEXT NOT NULL,
      meta_event_name TEXT,
      google_conversion_label TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_eventos_unique
      ON public.client_conversion_eventos_custom (client_id, status_gatilho);

    CREATE TABLE IF NOT EXISTS public.conversion_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id TEXT,
      lead_id UUID,
      plataforma TEXT NOT NULL,
      event_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      telefone_hash TEXT,
      valor NUMERIC,
      status_resposta INTEGER,
      resposta_body TEXT,
      enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sucesso BOOLEAN NOT NULL DEFAULT false
    );

    CREATE INDEX IF NOT EXISTS idx_conversion_log_client
      ON public.conversion_log (client_id, enviado_em DESC);
  `).catch(() => null);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim().toLowerCase()).digest('hex');
}

function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.startsWith('55') ? digits : `55${digits}`;
}

async function loadConfig(pool: Pool, clientId: string): Promise<ConversionConfig | null> {
  const { rows: [cfg] } = await pool.query(
    `SELECT * FROM public.client_conversion_config WHERE client_id = $1`,
    [clientId],
  ).catch(() => ({ rows: [] as ConversionConfig[] }));
  return cfg ?? null;
}

async function logConversion(pool: Pool, data: {
  clientId: string;
  leadId?: string | null;
  plataforma: 'meta' | 'google';
  eventName: string;
  eventId: string;
  telefoneHash?: string | null;
  valor?: number | null;
  statusResposta?: number | null;
  respostaBody?: string | null;
  sucesso: boolean;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.conversion_log
       (client_id, lead_id, plataforma, event_name, event_id, telefone_hash,
        valor, status_resposta, resposta_body, sucesso)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      data.clientId,
      data.leadId ?? null,
      data.plataforma,
      data.eventName,
      data.eventId,
      data.telefoneHash ?? null,
      data.valor ?? null,
      data.statusResposta ?? null,
      data.respostaBody ? data.respostaBody.slice(0, 4000) : null,
      data.sucesso,
    ],
  ).catch(() => null);
}

export async function hasSuccessfulConversion(pool: Pool, data: {
  clientId: string;
  leadId?: string | null;
  plataforma: 'meta' | 'google';
  eventName: string;
}): Promise<boolean> {
  if (!data.leadId) return false;
  const { rows: [row] } = await pool.query(
    `SELECT 1
       FROM public.conversion_log
      WHERE client_id = $1
        AND lead_id = $2
        AND plataforma = $3
        AND event_name = $4
        AND sucesso = true
      LIMIT 1`,
    [data.clientId, data.leadId, data.plataforma, data.eventName],
  ).catch(() => ({ rows: [] as Array<{ '?column?': number }> }));
  return Boolean(row);
}

// ── Meta CAPI ─────────────────────────────────────────────────────────────────

export async function enviarEventoMeta(
  pool: Pool,
  clientId: string,
  eventName: string,
  leadData: ConversionLeadData,
  valor?: number | null,
): Promise<void> {
  try {
    await ensureConversionSchema(pool);
    let cfg = await loadConfig(pool, clientId);
    if (!cfg?.meta_ativo || !cfg.meta_pixel_id || !cfg.meta_access_token) {
      // Fallback: config legada (client_tracking_config, do rastreio por Pixel v1).
      // Unificação da Fase 4 — clientes que só configuraram o sistema antigo
      // continuam enviando eventos, agora pelo caminho novo (business_messaging
      // + event_id + dedup), em vez do sendMetaEvent legado (action_source:
      // 'other', que a Meta não atribuía).
      const { rows: [legacy] } = await pool.query<{ pixel_id: string | null; meta_token: string | null }>(
        `SELECT pixel_id, meta_token FROM public.client_tracking_config WHERE client_id = $1`,
        [clientId],
      ).catch(() => ({ rows: [] as Array<{ pixel_id: string | null; meta_token: string | null }> }));
      if (!legacy?.pixel_id || !legacy?.meta_token) return;
      cfg = {
        ...(cfg ?? {} as ConversionConfig),
        meta_ativo: true,
        meta_pixel_id: legacy.pixel_id,
        meta_access_token: legacy.meta_token,
        meta_test_event_code: cfg?.meta_test_event_code ?? null,
        meta_page_id: cfg?.meta_page_id ?? null,
      };
    }

    const eventId = randomUUID();
    const normalizedPhone = normalizePhoneE164(leadData.phone);
    const phoneHash = hashPhone(normalizedPhone);

    // Purchase: valor é obrigatório e não pode ser zero
    if (eventName === 'Purchase') {
      if (!valor || valor <= 0) {
        await logConversion(pool, {
          clientId, leadId: leadData.id, plataforma: 'meta', eventName, eventId,
          telefoneHash: phoneHash, valor: null,
          statusResposta: 0, respostaBody: 'Valor da compra não informado', sucesso: false,
        });
        return;
      }
    }

    // Required by Meta's Conversions API for Business Messaging — without action_source
    // "business_messaging" + messaging_channel "whatsapp" + user_data.page_id, the API
    // still returns 200 OK but the event is NOT attributed to the WhatsApp ad/campaign
    // (there's no test-events tool for this dataset to catch that silently — see
    // platform.claude.com research from the Dericson Calari transcripts review).
    const userData: Record<string, unknown> = {
      ph: [phoneHash],
    };
    if (cfg.meta_page_id) userData.page_id = cfg.meta_page_id;
    if (leadData.ctwaClid) userData.ctwa_clid = leadData.ctwaClid;

    const eventData: Record<string, unknown> = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'business_messaging',
      messaging_channel: 'whatsapp',
      user_data: userData,
      custom_data: {
        currency: 'BRL',
        value: eventName === 'Purchase' ? Number(valor!.toFixed(2)) : 0,
      },
    };

    const payload: Record<string, unknown> = {
      data: [eventData],
      access_token: cfg.meta_access_token,
    };
    if (cfg.meta_test_event_code) payload.test_event_code = cfg.meta_test_event_code;

    const res = await fetch(
      `https://graph.facebook.com/v18.0/${cfg.meta_pixel_id}/events`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    );
    const resText = await res.text().catch(() => '');
    await logConversion(pool, {
      clientId, leadId: leadData.id, plataforma: 'meta', eventName, eventId,
      telefoneHash: phoneHash, valor: valor ?? null,
      statusResposta: res.status, respostaBody: resText, sucesso: res.ok,
    });
  } catch (err) {
    console.error('[enviarEventoMeta]', err);
  }
}

// ── Google: conversão de volta pro Google Ads ─────────────────────────────────
//
// Dois caminhos, na ordem:
// 1. OFFLINE CLICK CONVERSION (o caminho real de atribuição): se o lead tem
//    gclid/wbraid/gbraid capturado (Fase 1), sobe via uploadClickConversions —
//    o Google credita a campanha/palavra-chave exata e alimenta o Smart Bidding.
//    O campo de config (google_conversion_label_*) é o NOME ou ID da ação de
//    conversão no Google Ads.
// 2. GA4 Measurement Protocol (fallback, lead sem click id): evento vai pro GA4
//    com client_id sintético DETERMINÍSTICO no formato do cookie _ga
//    ("{int32}.{int32}" derivado do hash do telefone — o mesmo lead vira sempre
//    o mesmo "usuário" no GA4). Sem o cookie real do device não há atribuição
//    de sessão/campanha no GA4 — serve como contagem, não como atribuição
//    (o hash cru de antes nem era aceito como client_id válido).

/** client_id sintético no formato do cookie _ga, determinístico por telefone. */
function syntheticGa4ClientId(phoneHash: string): string {
  const a = parseInt(phoneHash.slice(0, 8), 16) >>> 0;
  const b = parseInt(phoneHash.slice(8, 16), 16) >>> 0;
  return `${a}.${b}`;
}

async function loadLeadClickIds(pool: Pool, leadId: string | null | undefined): Promise<ClickIds> {
  if (!leadId) return {};
  const { rows: [row] } = await pool.query<ClickIds>(
    `SELECT gclid, wbraid, gbraid FROM public.crm_leads WHERE id = $1`,
    [leadId],
  ).catch(() => ({ rows: [] as ClickIds[] }));
  return row ?? {};
}

export async function enviarEventoGoogle(
  pool: Pool,
  clientId: string,
  conversionLabel: string | null | undefined,
  leadData: ConversionLeadData,
  valor?: number | null,
): Promise<void> {
  try {
    if (!conversionLabel) return;
    await ensureConversionSchema(pool);
    const cfg = await loadConfig(pool, clientId);
    if (!cfg?.google_ativo) return;

    const eventId = randomUUID();
    const normalizedPhone = `+${normalizePhoneE164(leadData.phone)}`;
    const phoneHash = hashPhone(normalizedPhone);

    // Purchase: valor obrigatório
    const isPurchase = conversionLabel === cfg.google_conversion_label_purchase;
    if (isPurchase && (!valor || valor <= 0)) {
      await logConversion(pool, {
        clientId, leadId: leadData.id, plataforma: 'google', eventName: conversionLabel,
        eventId, telefoneHash: phoneHash, valor: null,
        statusResposta: 0, respostaBody: 'Valor da compra não informado', sucesso: false,
      });
      return;
    }

    // ── Caminho 1: offline click conversion (gclid capturado na Fase 1) ──
    const clickIds = await loadLeadClickIds(pool, leadData.id);
    if (clickIds.gclid || clickIds.wbraid || clickIds.gbraid) {
      const access = await resolveGoogleAdsAccess(pool, clientId, cfg.google_customer_id);
      if (access) {
        const action = await resolveConversionAction(access, conversionLabel).catch(() => null);
        if (action) {
          const result = await uploadClickConversion(access, action, clickIds, valor);
          await logConversion(pool, {
            clientId, leadId: leadData.id, plataforma: 'google', eventName: conversionLabel,
            eventId, telefoneHash: phoneHash, valor: valor ?? null,
            statusResposta: result.status ?? 0,
            respostaBody: `[offline_click_conversion] ${result.body ?? ''}`,
            sucesso: result.success,
          });
          if (result.success) return;
          // Upload falhou (ex: gclid expirado, ação errada) → cai pro GA4 abaixo
        } else {
          await logConversion(pool, {
            clientId, leadId: leadData.id, plataforma: 'google', eventName: conversionLabel,
            eventId: randomUUID(), telefoneHash: phoneHash, valor: valor ?? null,
            statusResposta: 0,
            respostaBody: `[offline_click_conversion] ação de conversão "${conversionLabel}" não encontrada na conta ${access.customerId} — use o NOME ou ID da ação (Google Ads → Metas → Conversões)`,
            sucesso: false,
          });
        }
      }
    }

    // ── Caminho 2: GA4 Measurement Protocol (fallback) ──
    if (!cfg.google_api_secret || !cfg.google_measurement_id) return;
    const payload = {
      client_id: syntheticGa4ClientId(phoneHash),
      user_data: { phone_number: phoneHash },
      events: [{
        name: 'conversion',
        params: {
          send_to: `${cfg.google_measurement_id}/${conversionLabel}`,
          value: valor ? Number(valor.toFixed(2)) : 0,
          currency: 'BRL',
          transaction_id: eventId,
        },
      }],
    };

    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${cfg.google_measurement_id}&api_secret=${cfg.google_api_secret}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const resText = await res.text().catch(() => '');
    await logConversion(pool, {
      clientId, leadId: leadData.id, plataforma: 'google', eventName: conversionLabel,
      eventId, telefoneHash: phoneHash, valor: valor ?? null,
      statusResposta: res.status, respostaBody: `[ga4_mp] ${resText}`, sucesso: res.ok,
    });
  } catch (err) {
    console.error('[enviarEventoGoogle]', err);
  }
}

// ── Status-triggered custom events ────────────────────────────────────────────

export async function dispararEventosPorStatus(
  pool: Pool,
  clientId: string,
  status: string,
  leadData: ConversionLeadData,
  valor?: number | null,
): Promise<void> {
  try {
    await ensureConversionSchema(pool);
    const { rows } = await pool.query(
      `SELECT meta_event_name, google_conversion_label
         FROM public.client_conversion_eventos_custom
        WHERE client_id = $1
          AND LOWER(status_gatilho) = LOWER($2)
          AND ativo = true`,
      [clientId, status],
    ).catch(() => ({ rows: [] as Array<{ meta_event_name: string | null; google_conversion_label: string | null }> }));

    for (const row of rows) {
      if (row.meta_event_name) {
        const alreadySent = await hasSuccessfulConversion(pool, {
          clientId,
          leadId: leadData.id,
          plataforma: 'meta',
          eventName: row.meta_event_name,
        });
        if (alreadySent) continue;
        await enviarEventoMeta(pool, clientId, row.meta_event_name, leadData, valor).catch(() => null);
      }
      if (row.google_conversion_label) {
        const alreadySent = await hasSuccessfulConversion(pool, {
          clientId,
          leadId: leadData.id,
          plataforma: 'google',
          eventName: row.google_conversion_label,
        });
        if (alreadySent) continue;
        await enviarEventoGoogle(pool, clientId, row.google_conversion_label, leadData, valor).catch(() => null);
      }
    }
  } catch (err) {
    console.error('[dispararEventosPorStatus]', err);
  }
}

// ── Deal-closed trigger (independent of status/Kanban column) ─────────────────
// "Fechou negócio" can be marked manually or by the AI deal-value suggestion without
// the lead ever moving Kanban column — dispararEventosPorStatus alone would miss that
// case since it only fires on a status change. This always sends a Purchase event
// (Meta + Google, when configured) the moment fechou flips to true with a value,
// independent of whatever status-based custom event mapping exists. The dedup check
// (hasSuccessfulConversion) keeps this safe to call alongside dispararEventosPorStatus
// for the same lead without sending Purchase to Meta/Google twice.
export async function dispararEventoFechamento(
  pool: Pool,
  clientId: string,
  leadData: ConversionLeadData,
  valor: number,
): Promise<void> {
  try {
    await ensureConversionSchema(pool);

    const alreadySentMeta = await hasSuccessfulConversion(pool, {
      clientId, leadId: leadData.id, plataforma: 'meta', eventName: 'Purchase',
    });
    if (!alreadySentMeta) {
      await enviarEventoMeta(pool, clientId, 'Purchase', leadData, valor).catch(() => null);
    }

    const cfg = await loadConfig(pool, clientId);
    if (cfg?.google_conversion_label_purchase) {
      const alreadySentGoogle = await hasSuccessfulConversion(pool, {
        clientId, leadId: leadData.id, plataforma: 'google', eventName: cfg.google_conversion_label_purchase,
      });
      if (!alreadySentGoogle) {
        await enviarEventoGoogle(pool, clientId, cfg.google_conversion_label_purchase, leadData, valor).catch(() => null);
      }
    }
  } catch (err) {
    console.error('[dispararEventoFechamento]', err);
  }
}

// ── Load config (for API routes) ──────────────────────────────────────────────

export async function getConversionConfig(pool: Pool, clientId: string) {
  await ensureConversionSchema(pool);
  const { rows: [cfg] } = await pool.query(
    `SELECT * FROM public.client_conversion_config WHERE client_id = $1`,
    [clientId],
  ).catch(() => ({ rows: [] }));
  return cfg ?? null;
}

export async function upsertConversionConfig(pool: Pool, clientId: string, data: Partial<ConversionConfig>) {
  await ensureConversionSchema(pool);
  const fields = Object.keys(data) as (keyof ConversionConfig)[];
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => data[f] ?? null);
  await pool.query(
    `INSERT INTO public.client_conversion_config (client_id, ${fields.join(', ')}, updated_at)
     VALUES ($1, ${fields.map((_, i) => `$${i + 2}`).join(', ')}, NOW())
     ON CONFLICT (client_id) DO UPDATE SET ${setClause}, updated_at = NOW()`,
    [clientId, ...values],
  );
}
