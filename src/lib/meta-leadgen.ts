// ── Meta Lead Ads (formulários nativos) → CRM ────────────────────────────────
//
// Quando um lead preenche um formulário nativo do Meta (Lead Ads), a Meta manda
// um webhook `object=page, field=leadgen` com só os IDs (leadgen_id, page_id,
// ad_id, form_id). Este módulo:
//  1. Busca o lead completo na Graph API (respostas do form + nomes de
//     campanha/conjunto/anúncio, que o nó Lead já traz direto).
//  2. Resolve a qual CLIENTE o lead pertence: mapa explícito página→cliente
//     (meta_leadgen_page_map) OU via conta de anúncio do ad (client_account_links).
//  3. Upsert no CRM (por telefone, quando houver) com atribuição completa +
//     campos do formulário (email, cidade, idade…) e evento imutável
//     `formulario` em lead_tracking_events (dedup por leadgen_id).
//
// O formulário é a ÚNICA fonte de dados demográficos por lead (idade, cidade
// declarada) — WhatsApp e clique não entregam isso.

import type { Pool } from 'pg';
import {
  upsertLeadFromConversation, ensureDefaultFunnel, getFirstFunnelStageLabel, normalizeCrmPhone,
} from '@/lib/crm-conversation-sync';
import { resolveMetaAdHierarchy } from '@/lib/meta-ad-resolver';
import {
  applyLeadAttribution, recordTrackingEvent, ensureLeadTrackingSchema,
} from '@/lib/lead-tracking';
import { regiaoFromPhone } from '@/lib/ddd-regioes';

export type LeadgenChangeValue = {
  leadgen_id?: string | number;
  page_id?: string | number;
  form_id?: string | number;
  ad_id?: string | number;
  adgroup_id?: string | number;
  created_time?: number;
};

type LeadgenData = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  is_organic?: boolean;
  field_data?: Array<{ name?: string; values?: string[] }>;
};

async function ensureLeadgenSchema(pool: Pool) {
  // Mapa explícito página→cliente: prioridade máxima na resolução. Preenchido
  // manualmente (INSERT) ou por UI futura — cobre páginas cujo anúncio não dá
  // pra resolver via conta (ex: lead orgânico do form, sem ad_id).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.meta_leadgen_page_map (
      page_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => null);
}

// ── Resolução página/anúncio → cliente ───────────────────────────────────────

async function resolveLeadgenClient(
  pool: Pool,
  pageId: string,
  adId: string | null,
  token: string | null,
): Promise<string | null> {
  // 1. Mapa explícito página → cliente
  const { rows: [mapped] } = await pool.query<{ client_id: string }>(
    `SELECT client_id FROM public.meta_leadgen_page_map WHERE page_id = $1`,
    [pageId],
  ).catch(() => ({ rows: [] as Array<{ client_id: string }> }));
  if (mapped?.client_id) return mapped.client_id;

  // 2. Via conta de anúncio: ad_id → account_id → client_account_links
  if (adId && token) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${adId}?fields=account_id&access_token=${token}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (res.ok) {
        const json = await res.json() as { account_id?: string };
        if (json.account_id) {
          const { rows: [link] } = await pool.query<{ client_id: string }>(
            `SELECT client_id FROM public.client_account_links
              WHERE platform IN ('meta_ads', 'meta')
                AND (account_id = $1 OR account_id = 'act_' || $1 OR REPLACE(account_id, 'act_', '') = $1)
              ORDER BY created_at ASC LIMIT 1`,
            [String(json.account_id)],
          ).catch(() => ({ rows: [] as Array<{ client_id: string }> }));
          if (link?.client_id) {
            // Memoriza no mapa: próximos leads da mesma página resolvem sem API
            await pool.query(
              `INSERT INTO public.meta_leadgen_page_map (page_id, client_id)
               VALUES ($1, $2) ON CONFLICT (page_id) DO NOTHING`,
              [pageId, link.client_id],
            ).catch(() => null);
            return link.client_id;
          }
        }
      }
    } catch { /* best-effort */ }
  }
  return null;
}

// ── Busca do lead na Graph API ───────────────────────────────────────────────

async function fetchLeadgenData(leadgenId: string, token: string): Promise<LeadgenData | null> {
  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${leadgenId}`);
    url.searchParams.set(
      'fields',
      'created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic',
    );
    url.searchParams.set('access_token', token);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[meta-leadgen] fetch lead falhou', leadgenId, JSON.stringify(err).slice(0, 300));
      return null;
    }
    return await res.json() as LeadgenData;
  } catch (err) {
    console.error('[meta-leadgen] fetch lead erro', err);
    return null;
  }
}

// ── Normalização dos campos do formulário ────────────────────────────────────

type ParsedFields = {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  dataNascimento: string | null;
  /** Campos custom (pergunta → resposta), fora os padrão acima */
  extras: Record<string, string>;
};

const NOME_KEYS = ['full_name', 'nome', 'name', 'nome_completo'];
const PHONE_KEYS = ['phone_number', 'telefone', 'phone', 'whatsapp', 'celular'];
const EMAIL_KEYS = ['email', 'e-mail', 'email_address'];
const CIDADE_KEYS = ['city', 'cidade'];
const ESTADO_KEYS = ['state', 'estado', 'uf', 'province'];
const NASC_KEYS = ['date_of_birth', 'data_de_nascimento', 'data_nascimento', 'dob'];

export function parseLeadgenFields(fieldData: LeadgenData['field_data']): ParsedFields {
  const out: ParsedFields = {
    nome: null, telefone: null, email: null, cidade: null, estado: null, dataNascimento: null, extras: {},
  };
  let firstName: string | null = null;
  let lastName: string | null = null;
  for (const field of fieldData ?? []) {
    const key = String(field?.name ?? '').toLowerCase().trim();
    const value = String(field?.values?.[0] ?? '').trim();
    if (!key || !value) continue;
    if (NOME_KEYS.includes(key)) out.nome = out.nome ?? value;
    else if (key === 'first_name') firstName = value;
    else if (key === 'last_name') lastName = value;
    else if (PHONE_KEYS.includes(key)) out.telefone = out.telefone ?? value;
    else if (EMAIL_KEYS.includes(key)) out.email = out.email ?? value;
    else if (CIDADE_KEYS.includes(key)) out.cidade = out.cidade ?? value;
    else if (ESTADO_KEYS.includes(key)) out.estado = out.estado ?? value;
    else if (NASC_KEYS.includes(key)) out.dataNascimento = out.dataNascimento ?? value;
    else out.extras[key] = value;
  }
  if (!out.nome && (firstName || lastName)) {
    out.nome = [firstName, lastName].filter(Boolean).join(' ');
  }
  return out;
}

// ── Processamento do evento leadgen ──────────────────────────────────────────

export async function processLeadgenEvent(
  pool: Pool,
  value: LeadgenChangeValue,
  userToken: string,
  pageToken: string,
): Promise<{ ok: boolean; leadId?: string; clientId?: string; reason?: string }> {
  const leadgenId = String(value?.leadgen_id ?? '');
  const pageId = String(value?.page_id ?? '');
  if (!leadgenId || !pageId) return { ok: false, reason: 'leadgen_id/page_id ausentes' };

  await ensureLeadgenSchema(pool);
  await ensureLeadTrackingSchema(pool);

  // Dedup: a Meta reenvia webhooks; se este leadgen_id já virou evento, para aqui.
  const { rows: [dup] } = await pool.query(
    `SELECT id FROM public.lead_tracking_events
      WHERE event_type = 'formulario' AND external_id = $1 LIMIT 1`,
    [`leadgen:${leadgenId}`],
  ).catch(() => ({ rows: [] as Array<{ id: string }> }));
  if (dup) return { ok: true, reason: 'já processado' };

  // Busca o lead completo (respostas + nomes de campanha) — o token de página
  // costuma ser o exigido para /{leadgen_id}; cai pro user token se preciso.
  const lead = await fetchLeadgenData(leadgenId, pageToken)
    ?? await fetchLeadgenData(leadgenId, userToken);
  if (!lead) return { ok: false, reason: 'não consegui buscar o lead na Graph API' };

  const adId = String(lead.ad_id ?? value.ad_id ?? '') || null;
  const clientId = await resolveLeadgenClient(pool, pageId, adId, userToken);
  if (!clientId) {
    console.error('[meta-leadgen] cliente não resolvido para page', pageId, '— cadastre em meta_leadgen_page_map');
    return { ok: false, reason: `cliente não mapeado para a página ${pageId}` };
  }

  const fields = parseLeadgenFields(lead.field_data);

  // Nomes de campanha: o nó Lead já traz; fallback via resolver (cache 30d)
  let campaignName = lead.campaign_name ?? null;
  let adsetName = lead.adset_name ?? null;
  let adName = lead.ad_name ?? null;
  if (adId && (!campaignName || !adsetName || !adName)) {
    const hierarchy = await resolveMetaAdHierarchy(pool, clientId, adId).catch(() => null);
    if (hierarchy) {
      campaignName = campaignName ?? hierarchy.campaign_name;
      adsetName = adsetName ?? hierarchy.adset_name;
      adName = adName ?? hierarchy.ad_name;
    }
  }

  const origin = lead.is_organic ? 'organic' : 'meta';
  const canal = 'Formulário Meta';

  // Observação legível com as respostas custom do formulário
  const obsLines = Object.entries(fields.extras).map(([q, a]) => `${q}: ${a}`);
  if (fields.dataNascimento) obsLines.unshift(`data de nascimento: ${fields.dataNascimento}`);
  const observacao = obsLines.length > 0 ? `Formulário Meta — ${obsLines.join(' | ')}` : null;

  // Upsert no CRM: por telefone quando houver (junta com conversa futura no
  // WhatsApp do mesmo número); sem telefone, INSERT direto (form só-email).
  const phone = normalizeCrmPhone(fields.telefone);
  let leadId: string;
  if (phone) {
    const upserted = await upsertLeadFromConversation(pool, {
      clientId,
      phone,
      name: fields.nome,
      canal,
      origin,
      observacao,
      sourceId: adId,
      campaignName,
      adsetName,
      adName,
    });
    leadId = upserted.id;
  } else {
    const funnelId = await ensureDefaultFunnel(pool, clientId);
    const status = await getFirstFunnelStageLabel(pool, funnelId);
    const { rows: [inserted] } = await pool.query<{ id: string }>(
      `INSERT INTO public.crm_leads
         (client_id, nome, canal, origin, data, status, funnel_id, observacao,
          source_id, campaign_name, adset_name, ad_name, first_origin_at)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, NOW())
       RETURNING id`,
      [clientId, fields.nome ?? fields.email ?? 'Lead de formulário', canal, origin,
       status, funnelId, observacao, adId, campaignName, adsetName, adName],
    );
    leadId = inserted.id;
  }

  // Região: cidade/UF declaradas no form têm prioridade; senão DDD do telefone
  const dddInfo = regiaoFromPhone(phone);
  const regiao = (fields.cidade || fields.estado)
    ? { uf: fields.estado, cidade: fields.cidade, fonte: 'form' as const }
    : dddInfo
      ? { uf: dddInfo.uf, cidade: dddInfo.regiao, fonte: 'ddd' as const }
      : null;

  await applyLeadAttribution(pool, leadId, {
    tracking: {},
    ddd: dddInfo?.ddd ?? null,
    regiaoUf: regiao?.uf ?? null,
    regiaoCidade: regiao?.cidade ?? null,
    regiaoFonte: regiao?.fonte ?? null,
    email: fields.email,
    hasClickMatch: false,
  });

  // Evento imutável com o snapshot completo (respostas cruas em raw)
  await recordTrackingEvent(pool, {
    leadId,
    clientId,
    eventType: 'formulario',
    origin,
    canal,
    externalId: `leadgen:${leadgenId}`,
    sourceId: adId,
    campaignName,
    adsetName,
    adName,
    ddd: dddInfo?.ddd ?? null,
    regiaoUf: regiao?.uf ?? null,
    regiaoCidade: regiao?.cidade ?? null,
    raw: {
      leadgen_id: leadgenId,
      page_id: pageId,
      form_id: lead.form_id ?? value.form_id ?? null,
      ad_id: adId,
      adset_id: lead.adset_id ?? null,
      campaign_id: lead.campaign_id ?? null,
      is_organic: lead.is_organic ?? false,
      created_time: lead.created_time ?? null,
      field_data: lead.field_data ?? [],
    },
  });

  return { ok: true, leadId, clientId };
}
