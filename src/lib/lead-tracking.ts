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
import { resolveMetaAdHierarchy, pareceIdMeta } from '@/lib/meta-ad-resolver';
import { resolverNomesGoogle, pareceIdGoogle } from '@/lib/google-ad-resolver';
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

// ── Código INVISÍVEL ─────────────────────────────────────────────────────────
//
// O código ia na mensagem como texto ("Cód: A7X2K9"). Funciona, mas o lead vê
// — e mensagem pré-preenchida com um código estranho é atrito na hora exata em
// que ele decidiu falar com o cliente. Agora o mesmo código viaja como bits em
// caracteres de largura zero, colados no fim da mensagem: some da tela e chega
// inteiro do outro lado.
//
// ⚠️ Dois caracteres só, e de propósito: ZWSP (U+200B) = 0 e ZWNJ (U+200C) = 1.
// O ZWJ (U+200D) ficou de fora porque é o que une sequências de emoji — um
// código que caísse no meio de um emoji seria remontado pelo cliente de
// WhatsApp e voltaria corrompido.
//
// ⚠️ Isto é BEST-EFFORT, não garantia: o lead pode apagar a mensagem inteira e
// escrever a dele, e aí não há código nenhum para ler. Quem cobre esse caso é
// `matchClickByWindow` (a janela de tempo), não este código.
const ZW_ZERO = '\u200B';
const ZW_UM = '\u200C';
const BITS_POR_SIMBOLO = 5; // 31 símbolos no alfabeto cabem em 5 bits
const BITS_TOTAIS = CODE_LENGTH * BITS_POR_SIMBOLO;

/** Converte o código legível na sequência invisível que vai na mensagem. */
export function encodeClickCodeInvisible(code: string): string {
  let bits = '';
  for (const ch of String(code ?? '').toUpperCase()) {
    const idx = CODE_ALPHABET.indexOf(ch);
    if (idx < 0) return ''; // código fora do alfabeto: não inventa bits
    bits += idx.toString(2).padStart(BITS_POR_SIMBOLO, '0');
  }
  if (bits.length !== BITS_TOTAIS) return '';
  return [...bits].map(b => (b === '1' ? ZW_UM : ZW_ZERO)).join('');
}

/**
 * Lê o código invisível de volta.
 *
 * ⚠️ Varre TODAS as sequências candidatas, não só a primeira: se o cliente de
 * WhatsApp inserir um caractere de largura zero por conta própria (acontece em
 * emoji e em texto bidirecional), a primeira sequência pode ser lixo e a boa
 * estar logo adiante. Código decodificado errado não faz estrago — ele
 * simplesmente não casa com clique nenhum, e a janela de tempo assume.
 */
function decodeClickCodeInvisible(texto: string): string | null {
  const candidatos = texto.match(new RegExp(`[${ZW_ZERO}${ZW_UM}]{${BITS_TOTAIS},}`, 'g'));
  if (!candidatos) return null;
  // ⚠️ Do FIM para o começo, e dentro da sequência os ÚLTIMOS bits: o código é
  // colado no fim da mensagem. Ler do começo erraria se o cliente de WhatsApp
  // grudasse um caractere de largura zero antes dele (a sequência viraria 31
  // caracteres e o recorte sairia deslocado em um bit).
  for (const bruto of [...candidatos].reverse()) {
    const bits = [...bruto].slice(-BITS_TOTAIS).map(c => (c === ZW_UM ? '1' : '0')).join('');
    let code = '';
    let valido = true;
    for (let i = 0; i < CODE_LENGTH; i++) {
      const idx = parseInt(bits.slice(i * BITS_POR_SIMBOLO, (i + 1) * BITS_POR_SIMBOLO), 2);
      if (!(idx >= 0 && idx < CODE_ALPHABET.length)) { valido = false; break; }
      code += CODE_ALPHABET[idx];
    }
    if (valido) return code;
  }
  return null;
}

/**
 * Extrai o código da mensagem. Tenta o invisível (formato atual) e cai no
 * texto "Cód: XXXXXX" — que o `/r/` não escreve mais, mas ainda pode chegar de
 * quem clicou antes do deploy e só foi mandar a mensagem depois.
 */
export function extractClickCode(text: string | null | undefined): string | null {
  const s = String(text ?? '');
  const invisivel = decodeClickCodeInvisible(s);
  if (invisivel) return invisivel;
  const match = s.match(CLICK_CODE_REGEX);
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
  // ValueTrack do Google (chegam pelo final_url_suffix da conta): a LP repassa a
  // URL inteira e é daqui que sai a PALAVRA-CHAVE. Sem eles, campanha aparecia
  // no lead e a keyword se perdia (caso CondoStore, 29/09/2026).
  keyword?: string;
  matchtype?: string;
  device?: string;
  network?: string;
  placement?: string;
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
       ADD COLUMN IF NOT EXISTS regiao_fonte TEXT,
       ADD COLUMN IF NOT EXISTS utm_source TEXT,
       ADD COLUMN IF NOT EXISTS utm_medium TEXT,
       ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
       ADD COLUMN IF NOT EXISTS utm_content TEXT,
       ADD COLUMN IF NOT EXISTS utm_term TEXT,
       ADD COLUMN IF NOT EXISTS source_url TEXT,
       ADD COLUMN IF NOT EXISTS city TEXT`,
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

// ⚠️ Dentro de uma URL dá para ler também os ValueTrack do Google — é assim que a
// palavra-chave chega das LPs. Fora de URL (texto solto de mensagem) a lista
// segue a curta de propósito: "device=" escrito numa conversa não é atribuição.
// ⚠️ keyword NUNCA sai de utm_term (o template Meta põe o nome do conjunto lá).
const URL_PARAM_KEYS = [
  ...TEXT_PARAM_KEYS,
  'keyword', 'matchtype', 'device', 'network', 'placement',
] as const;

export function extractTrackingFromText(text: string): TextTracking {
  const urls = String(text ?? '').match(/https?:\/\/[^\s]+/g) ?? [];
  for (const url of urls) {
    try {
      const u = new URL(url);
      const out: TextTracking = {};
      let found = false;
      for (const key of URL_PARAM_KEYS) {
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

/**
 * Janela padrão da atribuição por tempo. Dois minutos porque é o intervalo real
 * entre clicar no botão de WhatsApp e mandar a primeira mensagem — e porque o
 * risco de dois leads caírem na mesma janela cresce com ela (medido em 28/09:
 * 2 min ≈ 1,2% de colisão no cliente de 9 leads/dia e 8,4% no de 63/dia).
 */
export const JANELA_ATRIBUICAO_MIN = 2;

/**
 * Silêncio a partir do qual um lead ANTIGO volta a ser candidato à janela.
 *
 * ⚠️ Lead que volta depois de meses é atribuição legítima — e das mais valiosas
 * (é o remarketing funcionando). A primeira versão desta janela só aceitava
 * lead NOVO, o que deixava as duas pontas incoerentes: pelo código o retorno
 * era atribuído normalmente, pela janela não.
 *
 * ⚠️ Mas "voltou" tem de ser silêncio de verdade, não conversa em andamento.
 * Medido em 28/09 sobre 30 dias de mensagens recebidas: **9.961** são conversa
 * do mesmo dia, 429 são retomada de 1 a 7 dias e só **18** são retorno de 7+
 * dias. Aceitar a conversa em andamento poria 9.961 mensagens/mês disputando
 * clique — é dela que a guarda protege. Aceitar 7+ dias custa 1% a mais de
 * candidatos (18 sobre 1.852) e resolve o caso real.
 *
 * A régua olha a última mensagem em QUALQUER direção, não só as recebidas: se
 * o atendente falou com a pessoa há 3 dias e ela responde hoje, isso é resposta
 * a follow-up, não reentrada por anúncio.
 */
export const DORMENCIA_REENTRADA_DIAS = 7;

/**
 * Casa clique ↔ lead pela JANELA DE TEMPO, quando o código não chegou (o lead
 * apagou a mensagem pré-preenchida e escreveu a dele).
 *
 * ⚠️⚠️ Isto é INFERÊNCIA, não prova — e por isso recusa qualquer ambiguidade
 * em vez de escolher a mais provável. Atribuir errado é PIOR que não atribuir:
 * a Biblioteca de Criativos, o funil por canal e a decisão de verba saem todos
 * daqui, e um palpite silencioso contamina os três sem deixar rastro. As duas
 * travas:
 *
 *  1. Exatamente UM clique sem dono na janela. Dois cliques = dois candidatos,
 *     e não há como saber qual é este lead.
 *  2. Nenhum OUTRO lead do mesmo cliente nascido na janela. Se dois leads
 *     entram juntos, o clique pode ser do outro.
 *
 * Quem decide que a conversa é NOVA é o chamador (com a régua de identidade de
 * lead-identity.ts) — mensagem de lead que já existe nunca chega aqui, senão a
 * janela roubaria a atribuição de um lead antigo.
 */
export async function matchClickByWindow(
  pool: Pool,
  opts: { clientId: string; quando: Date | string; janelaMin?: number },
): Promise<ClickTracking | null> {
  await ensureLeadTrackingSchema(pool);
  const janela = Math.max(1, Math.min(opts.janelaMin ?? JANELA_ATRIBUICAO_MIN, 60));
  // Aceita Date ou ISO porque o webhook normaliza o carimbo do provedor em
  // string (parseProviderTimestamp). Carimbo ilegível cai no relógio atual em
  // vez de virar um intervalo inválido no SQL.
  const bruto = opts.quando instanceof Date ? opts.quando : new Date(String(opts.quando ?? ''));
  const fim = Number.isNaN(bruto.getTime()) ? new Date() : bruto;

  // Trava 1 — LIMIT 2 de propósito: só precisamos saber se é exatamente um.
  const { rows: cliques } = await pool.query<ClickTracking>(
    `SELECT k.id, k.redirect_id, k.click_code, k.url,
            k.utm_source, k.utm_medium, k.utm_campaign, k.utm_content, k.utm_term,
            k.gclid, k.wbraid, k.gbraid, k.fbclid, k.ttclid, k.msclkid,
            k.keyword, k.matchtype, k.device, k.network, k.placement, k.loc_physical,
            k.geo_country, k.geo_region, k.geo_city, k.created_at
       FROM public.link_redirect_clicks k
       JOIN public.link_redirects r ON r.id = k.redirect_id
      WHERE r.client_id = $1
        AND k.lead_id IS NULL
        AND k.created_at BETWEEN $2::timestamptz - ($3 || ' minutes')::interval AND $2::timestamptz
      ORDER BY k.created_at DESC
      LIMIT 2`,
    [opts.clientId, fim.toISOString(), String(janela)],
  );
  if (cliques.length !== 1) return null;

  // Trava 2 — concorrente nascido na mesma janela. O lead desta mensagem ainda
  // não existe (a janela roda ANTES do upsert), então tudo que contar aqui é
  // outro lead disputando o mesmo clique.
  //
  // ⚠️ RESÍDUO CONHECIDO: conta lead CRIADO na janela, não lead que VOLTOU da
  // dormência — depois que a mensagem dele passa pelo upsert, ele fica
  // indistinguível de quem está no meio de uma conversa. Cobrir isso exigiria
  // uma régua que não tenho como tornar sólida. O tamanho do resíduo está
  // medido: reentrada de 7+ dias são 18 mensagens em 30 dias (~0,6/dia), então
  // duas delas no MESMO cliente dentro de 2 minutos é ruído estatístico. A
  // combinação perigosa de verdade — um retornante e um lead novo juntos — está
  // coberta, porque o lead novo é contado aqui.
  const { rows: [{ concorrentes }] } = await pool.query<{ concorrentes: string }>(
    `SELECT COUNT(*)::text AS concorrentes
       FROM public.crm_leads
      WHERE client_id = $1
        AND created_at BETWEEN $2::timestamptz - ($3 || ' minutes')::interval AND $2::timestamptz`,
    [opts.clientId, fim.toISOString(), String(janela)],
  );
  if (Number(concorrentes) > 0) return null;

  return cliques[0];
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
    const src = t.utm_source.toLowerCase().trim();
    // ⚠️ O parâmetro AUTOMÁTICO da Meta manda `{{site_source_name}}`, que é uma
    // SIGLA de duas/três letras: ig, fb, msg, an. Elas precisam casar INTEIRAS —
    // "ig" como substring casaria em "digital", "an" em "banner". Sem isto o
    // lead ficava com origem "ig" crua, virando um canal novo no donut em vez
    // de somar com Instagram (medido em 14/09 no 1º lead que chegou assim).
    if (src === 'ig') return 'instagram';
    if (src === 'fb' || src === 'msg' || src === 'an') return 'meta';
    if (src.includes('google') || src.includes('adwords')) return 'google';
    if (src.includes('instagram')) return 'instagram';
    if (src.includes('facebook') || src.includes('face') || src.includes('fb')) return 'meta';
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
  /**
   * Nomes de campanha/conjunto/anúncio já traduzidos a partir dos IDs.
   * ⚠️ Colunas SEPARADAS dos `utm_*`: o UTM guarda o que a URL trouxe de fato
   * (às vezes um ID), e estes guardam o nome legível. Sobrescrever o UTM com o
   * nome faria o campo "UTM campaign" mentir sobre o que chegou no link.
   */
  nomes?: { campaign?: string | null; adset?: string | null; ad?: string | null } | null;
  /**
   * Dono do lead. Necessário para traduzir ID de anúncio em NOME — sem ele a
   * tradução é pulada (o token de anúncio é por cliente).
   */
  clientId?: string | null;
  /**
   * Cidade DECLARADA pela pessoa (formulário). ⚠️ Coluna separada de
   * `regiao_cidade` de propósito: aquela guarda também a REGIÃO do DDD
   * ("Bauru / Marília"), que domina a base (medido em 13/09: 10.551 de 12.441).
   * Misturar as duas faria a tela chamar de Cidade um endereço que ninguém
   * informou.
   */
  city?: string | null;
  email?: string | null;
  hasClickMatch: boolean;
};

/**
 * Traduz ID de campanha/conjunto/anúncio para NOME.
 *
 * ⚠️ Mora AQUI, e não em cada rota, porque ID chega por porta que ninguém
 * previu. Medido em 14/09: a rota da LP traduzia só o Google (o comentário
 * dizia que a Meta "sempre manda nome"), e 3 dos 5 leads com ID vieram pelo
 * DATALYTICS — porta que nem sabia do problema. Como todas as portas passam
 * por `applyLeadAttribution`, a régua num lugar só é o que impede a próxima
 * de esquecer.
 *
 * ⚠️ Só roda quando algum UTM É um ID (nome de campanha nunca é só dígitos),
 * então lead de WhatsApp sem UTM não paga nada. Best-effort: falha de Graph
 * ou de GAQL nunca derruba a gravação do lead — o ID fica, que é pior de ler
 * mas continua sendo rastreio.
 */
type NomesDeAnuncio = { campaign?: string | null; adset?: string | null; ad?: string | null };

async function resolverNomesDosIds(
  pool: Pool, clientId: string, t: MergedTracking,
): Promise<NomesDeAnuncio> {
  const out: NomesDeAnuncio = {};

  // Meta: o anúncio (utm_content no parâmetro automático) devolve a hierarquia
  // inteira numa chamada só, com cache.
  if (pareceIdMeta(t.utm_content)) {
    const m = await resolveMetaAdHierarchy(pool, clientId, t.utm_content!).catch(() => null);
    if (m) {
      if (m.campaign_name) out.campaign = m.campaign_name;
      if (m.adset_name) out.adset = m.adset_name;
      if (m.ad_name) out.ad = m.ad_name;
    }
  }

  // Google: o ValueTrack não tem macro de nome, então campanha/grupo vêm por id.
  if (!out.campaign && pareceIdGoogle(t.utm_campaign)) {
    const g = await resolverNomesGoogle(pool, clientId, {
      campaignId: t.utm_campaign, adgroupId: pareceIdGoogle(t.utm_term) ? t.utm_term : null,
    }).catch(() => null);
    if (g?.campaign_name) out.campaign = g.campaign_name;
    if (g?.adgroup_name && !out.adset) out.adset = g.adgroup_name;
  }

  return out;
}

export async function applyLeadAttribution(pool: Pool, leadId: string, attr: LeadAttributionInput) {
  await ensureLeadTrackingSchema(pool);
  const t = attr.tracking;

  // Nome explícito do chamador vence; só o que faltar é resolvido aqui.
  let nomes: NomesDeAnuncio = attr.nomes ?? {};
  const faltaAlgum = !nomes.campaign || !nomes.adset || !nomes.ad;
  if (attr.clientId && faltaAlgum) {
    const achados: NomesDeAnuncio = await resolverNomesDosIds(pool, attr.clientId, t).catch(() => ({}));
    nomes = { campaign: nomes.campaign ?? achados.campaign, adset: nomes.adset ?? achados.adset, ad: nomes.ad ?? achados.ad };
  }
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
            -- ⚠️ UTMs e URL de origem entram AQUI, não só no histórico. Medido em
            -- 13/09: 80 leads (79 da Cost Odonto via Datalytics + 1 de LP) tinham os
            -- UTMs em lead_tracking_events e NADA no cadastro — e é o cadastro que a
            -- tela "Fonte de captura" lê. As portas que fazem INSERT próprio (LP,
            -- Datalytics) dependem desta função para o rastreio; sem estas linhas o
            -- dado chegava e se perdia no caminho. Fill-blanks: first-touch vence.
            utm_source   = COALESCE(NULLIF(utm_source, ''), NULLIF($19, '')),
            utm_medium   = COALESCE(NULLIF(utm_medium, ''), NULLIF($20, '')),
            utm_campaign = COALESCE(NULLIF(utm_campaign, ''), NULLIF($21, '')),
            utm_content  = COALESCE(NULLIF(utm_content, ''), NULLIF($22, '')),
            utm_term     = COALESCE(NULLIF(utm_term, ''), NULLIF($23, '')),
            source_url   = COALESCE(NULLIF(source_url, ''), NULLIF($24, '')),
            city         = COALESCE(NULLIF(city, ''), NULLIF($25, '')),
            campaign_name = COALESCE(NULLIF(campaign_name, ''), NULLIF($26, '')),
            adset_name   = COALESCE(NULLIF(adset_name, ''), NULLIF($27, '')),
            ad_name      = COALESCE(NULLIF(ad_name, ''), NULLIF($28, '')),
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
      t.utm_source ?? null,
      t.utm_medium ?? null,
      t.utm_campaign ?? null,
      t.utm_content ?? null,
      t.utm_term ?? null,
      t.source_url ?? null,
      attr.city ?? null,
      nomes.campaign ?? null,
      nomes.adset ?? null,
      nomes.ad ?? null,
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
