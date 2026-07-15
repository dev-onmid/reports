// ── Rastreio de leads: fundação de captura ──────────────────────────────────
//
// Peças centrais da atribuição clique → lead:
//  - Schema: colunas estendidas em link_redirect_clicks e crm_leads + a tabela
//    lead_tracking_events (histórico IMUTÁVEL de toques — só some com o lead,
//    via FK ON DELETE CASCADE).
//  - click_code: código curto gerado no /r/[slug] e injetado na mensagem do
//    WhatsApp ("Cód: A7X2K9"). O webhook casa o código com o clique e herda a
//    atribuição completa gravada server-side (utm, gclid, keyword, placement,
//    geo…) — imune a edição do resto do texto pelo lead.
//  - extractTrackingFromText: fallback legado — parse de UTMs/gclid de URLs
//    coladas no texto da mensagem (links antigos sem código).
//  - regiao: derivada do DDD do telefone (ddd-regioes.ts) e/ou da geolocalização
//    do clique (headers x-vercel-ip-* — zero API externa).

import { randomBytes } from 'crypto';
import type { Pool } from 'pg';

// Alfabeto sem caracteres ambíguos (0/O, 1/I/L) — código legível por humanos.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// "Cód: A7X2K9" / "cod. A7X2K9" / "Código: A7X2K9"
const CLICK_CODE_REGEX = /c[óo]d(?:igo)?\s*[.:]+\s*([A-HJ-NP-Za-hj-np-z2-9]{6})\b/i;

export function generateClickCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export function extractClickCode(text: string | null | undefined): string | null {
  const match = String(text ?? '').match(CLICK_CODE_REGEX);
  return match ? match[1].toUpperCase() : null;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export type TextTracking = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbclid?: string;
  ttclid?: string;
  source_url?: string;
};

export type ClickTracking = {
  id: string;
  redirect_id: string | null;
  click_code: string;
  url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  fbclid: string | null;
  ttclid: string | null;
  msclkid: string | null;
  keyword: string | null;
  matchtype: string | null;
  device: string | null;
  network: string | null;
  placement: string | null;
  loc_physical: string | null;
  geo_country: string | null;
  geo_region: string | null;
  geo_city: string | null;
  created_at: string;
};

/** Atribuição consolidada (clique server-side tem prioridade sobre texto). */
export type MergedTracking = TextTracking & {
  keyword?: string;
  matchtype?: string;
  device?: string;
  network?: string;
  placement?: string;
  click_code?: string;
  click_id?: string;
  geo_country?: string;
  geo_region?: string;
  geo_city?: string;
};

// ── Schema ───────────────────────────────────────────────────────────────────

let schemaEnsured = false;

export async function ensureLeadTrackingSchema(pool: Pool) {
  if (schemaEnsured) return;
  const stmts = [
    // Captura estendida no clique do /r/[slug]
    `ALTER TABLE public.link_redirect_clicks
       ADD COLUMN IF NOT EXISTS click_code TEXT,
       ADD COLUMN IF NOT EXISTS url TEXT,
       ADD COLUMN IF NOT EXISTS gclid TEXT,
       ADD COLUMN IF NOT EXISTS wbraid TEXT,
       ADD COLUMN IF NOT EXISTS gbraid TEXT,
       ADD COLUMN IF NOT EXISTS fbclid TEXT,
       ADD COLUMN IF NOT EXISTS ttclid TEXT,
       ADD COLUMN IF NOT EXISTS msclkid TEXT,
       ADD COLUMN IF NOT EXISTS keyword TEXT,
       ADD COLUMN IF NOT EXISTS matchtype TEXT,
       ADD COLUMN IF NOT EXISTS device TEXT,
       ADD COLUMN IF NOT EXISTS network TEXT,
       ADD COLUMN IF NOT EXISTS placement TEXT,
       ADD COLUMN IF NOT EXISTS loc_physical TEXT,
       ADD COLUMN IF NOT EXISTS geo_country TEXT,
       ADD COLUMN IF NOT EXISTS geo_region TEXT,
       ADD COLUMN IF NOT EXISTS geo_city TEXT,
       ADD COLUMN IF NOT EXISTS extra_params JSONB,
       ADD COLUMN IF NOT EXISTS lead_id UUID,
       ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ`,
    `CREATE UNIQUE INDEX IF NOT EXISTS link_redirect_clicks_code_idx
       ON public.link_redirect_clicks (click_code) WHERE click_code IS NOT NULL`,
    // Atribuição estendida no lead (first-touch: só preenche se vazio)
    `ALTER TABLE public.crm_leads
       ADD COLUMN IF NOT EXISTS gclid TEXT,
       ADD COLUMN IF NOT EXISTS wbraid TEXT,
       ADD COLUMN IF NOT EXISTS gbraid TEXT,
       ADD COLUMN IF NOT EXISTS fbclid TEXT,
       ADD COLUMN IF NOT EXISTS ttclid TEXT,
       ADD COLUMN IF NOT EXISTS keyword TEXT,
       ADD COLUMN IF NOT EXISTS matchtype TEXT,
       ADD COLUMN IF NOT EXISTS device TEXT,
       ADD COLUMN IF NOT EXISTS network TEXT,
       ADD COLUMN IF NOT EXISTS placement TEXT,
       ADD COLUMN IF NOT EXISTS click_code TEXT,
       ADD COLUMN IF NOT EXISTS email TEXT,
       ADD COLUMN IF NOT EXISTS ddd TEXT,
       ADD COLUMN IF NOT EXISTS regiao_uf TEXT,
       ADD COLUMN IF NOT EXISTS regiao_cidade TEXT,
       ADD COLUMN IF NOT EXISTS regiao_fonte TEXT`,
    // Histórico imutável de toques de atribuição (1 linha por toque, nunca sobrescreve).
    // Some apenas quando o lead é deletado (FK ON DELETE CASCADE, adicionada abaixo).
    `CREATE TABLE IF NOT EXISTS public.lead_tracking_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       lead_id UUID,
       client_id TEXT NOT NULL,
       event_type TEXT NOT NULL,
       origin TEXT,
       canal TEXT,
       external_id TEXT,
       click_id UUID,
       click_code TEXT,
       ctwa_clid TEXT,
       source_id TEXT,
       source_url TEXT,
       utm_source TEXT,
       utm_medium TEXT,
       utm_campaign TEXT,
       utm_content TEXT,
       utm_term TEXT,
       gclid TEXT,
       wbraid TEXT,
       gbraid TEXT,
       fbclid TEXT,
       ttclid TEXT,
       keyword TEXT,
       matchtype TEXT,
       device TEXT,
       network TEXT,
       placement TEXT,
       campaign_name TEXT,
       adset_name TEXT,
       ad_name TEXT,
       creative_name TEXT,
       geo_country TEXT,
       geo_region TEXT,
       geo_city TEXT,
       ddd TEXT,
       regiao_uf TEXT,
       regiao_cidade TEXT,
       raw JSONB,
       created_at TIMESTAMPTZ DEFAULT NOW()
     )`,
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_tracking_events_lead_fk') THEN
         ALTER TABLE public.lead_tracking_events
           ADD CONSTRAINT lead_tracking_events_lead_fk
           FOREIGN KEY (lead_id) REFERENCES public.crm_leads(id) ON DELETE CASCADE;
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS lead_tracking_events_lead_idx
       ON public.lead_tracking_events (lead_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS lead_tracking_events_client_idx
       ON public.lead_tracking_events (client_id, created_at DESC)`,
    // Dedup de retry de webhook: mesma mensagem não gera dois eventos
    `CREATE UNIQUE INDEX IF NOT EXISTS lead_tracking_events_external_idx
       ON public.lead_tracking_events (lead_id, external_id)
       WHERE external_id IS NOT NULL AND lead_id IS NOT NULL`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(err => console.error('[lead-tracking schema]', err?.message ?? err));
  }
  schemaEnsured = true;
}

// ── Extração de parâmetros do texto da mensagem (fallback legado) ────────────

const TEXT_PARAM_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'ttclid',
] as const;

export function extractTrackingFromText(text: string): TextTracking {
  const urls = String(text ?? '').match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      const out: TextTracking = {};
      let found = false;
      for (const key of TEXT_PARAM_KEYS) {
        const value = u.searchParams.get(key);
        if (value) { out[key] = value; found = true; }
      }
      if (found) {
        out.source_url = url;
        return out;
      }
    } catch { /* URL inválida, pula */ }
  }
  // Fallback: parâmetros soltos no texto (sem URL completa)
  const loose: TextTracking = {};
  for (const key of TEXT_PARAM_KEYS) {
    const m = text.match(new RegExp(`${key}=([^\\s&]+)`, 'i'));
    if (m) loose[key] = m[1];
  }
  return loose;
}

// ── Casamento clique ↔ lead pelo código ──────────────────────────────────────

export async function matchClickByCode(pool: Pool, code: string): Promise<ClickTracking | null> {
  await ensureLeadTrackingSchema(pool);
  const { rows: [click] } = await pool.query<ClickTracking>(
    `SELECT id, redirect_id, click_code, url,
            utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            gclid, wbraid, gbraid, fbclid, ttclid, msclkid,
            keyword, matchtype, device, network, placement, loc_physical,
            geo_country, geo_region, geo_city, created_at
       FROM public.link_redirect_clicks
      WHERE click_code = $1
        AND created_at > NOW() - INTERVAL '90 days'
      LIMIT 1`,
    [code],
  );
  return click ?? null;
}

/** Marca o clique como convertido em lead (elo permanente clique↔lead). */
export async function linkClickToLead(pool: Pool, clickId: string, leadId: string) {
  await pool.query(
    `UPDATE public.link_redirect_clicks
        SET lead_id = $2, matched_at = COALESCE(matched_at, NOW())
      WHERE id = $1 AND lead_id IS NULL`,
    [clickId, leadId],
  ).catch(() => null);
}

/**
 * Consolida atribuição: o clique (gravado server-side no /r/) tem prioridade
 * sobre o que veio no texto da mensagem — é mais completo e não é editável.
 */
export function mergeTracking(fromText: TextTracking, click: ClickTracking | null): MergedTracking {
  if (!click) return { ...fromText };
  return {
    utm_source: click.utm_source ?? fromText.utm_source,
    utm_medium: click.utm_medium ?? fromText.utm_medium,
    utm_campaign: click.utm_campaign ?? fromText.utm_campaign,
    utm_content: click.utm_content ?? fromText.utm_content,
    utm_term: click.utm_term ?? fromText.utm_term,
    gclid: click.gclid ?? fromText.gclid,
    wbraid: click.wbraid ?? fromText.wbraid,
    gbraid: click.gbraid ?? fromText.gbraid,
    fbclid: click.fbclid ?? fromText.fbclid,
    ttclid: click.ttclid ?? fromText.ttclid,
    source_url: click.url ?? fromText.source_url,
    keyword: click.keyword ?? undefined,
    matchtype: click.matchtype ?? undefined,
    device: click.device ?? undefined,
    network: click.network ?? undefined,
    placement: click.placement ?? undefined,
    click_code: click.click_code,
    click_id: click.id,
    geo_country: click.geo_country ?? undefined,
    geo_region: click.geo_region ?? undefined,
    geo_city: click.geo_city ?? undefined,
  };
}

// ── Origem a partir dos identificadores de rastreio ──────────────────────────
// Compartilhado entre webhook do WhatsApp, formulários e webhook genérico.
// Click IDs são o sinal mais confiável: gclid/wbraid/gbraid = Google
// auto-tagging; fbclid = Meta; ttclid = TikTok. utm_source vem depois.

export function originFromTracking(t: TextTracking | MergedTracking): string | null {
  if (t.gclid || t.wbraid || t.gbraid) return 'google';
  if (t.utm_source) {
    const src = t.utm_source.toLowerCase();
    if (src.includes('google') || src.includes('adwords')) return 'google';
    if (src.includes('instagram')) return 'instagram';
    if (src.includes('facebook') || src.includes('fb')) return 'meta';
    if (src.includes('tiktok')) return 'tiktok';
    return t.utm_source;
  }
  if (t.fbclid) return 'meta';
  if (t.ttclid) return 'tiktok';
  return null;
}

// ── Persistência no lead (first-touch: nunca sobrescreve valor existente) ────

export type LeadAttributionInput = {
  tracking: MergedTracking;
  ddd?: string | null;
  regiaoUf?: string | null;
  regiaoCidade?: string | null;
  /** ip (geo do clique) | ddd (telefone) | form (respondido no formulário) */
  regiaoFonte?: 'ip' | 'ddd' | 'form' | null;
  email?: string | null;
  hasClickMatch: boolean;
};

export async function applyLeadAttribution(pool: Pool, leadId: string, attr: LeadAttributionInput) {
  await ensureLeadTrackingSchema(pool);
  const t = attr.tracking;
  await pool.query(
    `UPDATE public.crm_leads
        SET gclid        = COALESCE(NULLIF(gclid, ''), NULLIF($2, '')),
            wbraid       = COALESCE(NULLIF(wbraid, ''), NULLIF($3, '')),
            gbraid       = COALESCE(NULLIF(gbraid, ''), NULLIF($4, '')),
            fbclid       = COALESCE(NULLIF(fbclid, ''), NULLIF($5, '')),
            ttclid       = COALESCE(NULLIF(ttclid, ''), NULLIF($6, '')),
            keyword      = COALESCE(NULLIF(keyword, ''), NULLIF($7, '')),
            matchtype    = COALESCE(NULLIF(matchtype, ''), NULLIF($8, '')),
            device       = COALESCE(NULLIF(device, ''), NULLIF($9, '')),
            network      = COALESCE(NULLIF(network, ''), NULLIF($10, '')),
            placement    = COALESCE(NULLIF(placement, ''), NULLIF($11, '')),
            click_code   = COALESCE(NULLIF(click_code, ''), NULLIF($12, '')),
            ddd          = COALESCE(NULLIF(ddd, ''), NULLIF($13, '')),
            regiao_uf    = COALESCE(NULLIF(regiao_uf, ''), NULLIF($14, '')),
            regiao_cidade = COALESCE(NULLIF(regiao_cidade, ''), NULLIF($15, '')),
            regiao_fonte = COALESCE(NULLIF(regiao_fonte, ''), NULLIF($16, '')),
            email        = COALESCE(NULLIF(email, ''), NULLIF($18, '')),
            first_origin_at = COALESCE(first_origin_at, CASE WHEN $17 THEN NOW() ELSE NULL END),
            updated_at   = NOW()
      WHERE id = $1`,
    [
      leadId,
      t.gclid ?? null,
      t.wbraid ?? null,
      t.gbraid ?? null,
      t.fbclid ?? null,
      t.ttclid ?? null,
      t.keyword ?? null,
      t.matchtype ?? null,
      t.device ?? null,
      t.network ?? null,
      t.placement ?? null,
      t.click_code ?? null,
      attr.ddd ?? null,
      attr.regiaoUf ?? null,
      attr.regiaoCidade ?? null,
      attr.regiaoFonte ?? null,
      attr.hasClickMatch || Boolean(t.gclid || t.fbclid || t.ttclid),
      attr.email ?? null,
    ],
  ).catch(err => console.error('[lead-tracking applyLeadAttribution]', err?.message ?? err));
}

// ── Histórico imutável de toques ─────────────────────────────────────────────

export type TrackingEventInput = {
  leadId: string;
  clientId: string;
  /** ctwa | link_click | utm_texto | contexto | organico | formulario */
  eventType: string;
  origin?: string | null;
  canal?: string | null;
  externalId?: string | null;
  ctwaClid?: string | null;
  sourceId?: string | null;
  sourceUrl?: string | null;
  tracking?: MergedTracking | null;
  campaignName?: string | null;
  adsetName?: string | null;
  adName?: string | null;
  creativeName?: string | null;
  ddd?: string | null;
  regiaoUf?: string | null;
  regiaoCidade?: string | null;
  raw?: unknown;
};

export async function recordTrackingEvent(pool: Pool, evt: TrackingEventInput) {
  await ensureLeadTrackingSchema(pool);
  const t = evt.tracking ?? {};
  await pool.query(
    `INSERT INTO public.lead_tracking_events
       (lead_id, client_id, event_type, origin, canal, external_id,
        click_id, click_code, ctwa_clid, source_id, source_url,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        gclid, wbraid, gbraid, fbclid, ttclid,
        keyword, matchtype, device, network, placement,
        campaign_name, adset_name, ad_name, creative_name,
        geo_country, geo_region, geo_city, ddd, regiao_uf, regiao_cidade, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
     ON CONFLICT DO NOTHING`,
    [
      evt.leadId,
      evt.clientId,
      evt.eventType,
      evt.origin ?? null,
      evt.canal ?? null,
      evt.externalId ?? null,
      t.click_id ?? null,
      t.click_code ?? null,
      evt.ctwaClid ?? null,
      evt.sourceId ?? null,
      evt.sourceUrl ?? t.source_url ?? null,
      t.utm_source ?? null,
      t.utm_medium ?? null,
      t.utm_campaign ?? null,
      t.utm_content ?? null,
      t.utm_term ?? null,
      t.gclid ?? null,
      t.wbraid ?? null,
      t.gbraid ?? null,
      t.fbclid ?? null,
      t.ttclid ?? null,
      t.keyword ?? null,
      t.matchtype ?? null,
      t.device ?? null,
      t.network ?? null,
      t.placement ?? null,
      evt.campaignName ?? null,
      evt.adsetName ?? null,
      evt.adName ?? null,
      evt.creativeName ?? null,
      t.geo_country ?? null,
      t.geo_region ?? null,
      t.geo_city ?? null,
      evt.ddd ?? null,
      evt.regiaoUf ?? null,
      evt.regiaoCidade ?? null,
      evt.raw === undefined ? null : JSON.stringify(evt.raw),
    ],
  ).catch(err => console.error('[lead-tracking recordTrackingEvent]', err?.message ?? err));
}

// ── Geo por headers da Vercel (zero API externa) ─────────────────────────────

export function geoFromHeaders(headers: Headers): { country: string | null; region: string | null; city: string | null } {
  const decode = (v: string | null) => {
    if (!v) return null;
    try { return decodeURIComponent(v); } catch { return v; }
  };
  return {
    country: decode(headers.get('x-vercel-ip-country')),
    region: decode(headers.get('x-vercel-ip-country-region')),
    city: decode(headers.get('x-vercel-ip-city')),
  };
}
