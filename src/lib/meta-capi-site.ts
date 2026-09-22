// ── Meta · API de Conversões para lead de SITE ───────────────────────────────
//
// O `enviarEventoMeta` de conversions.ts serve o fluxo de WhatsApp
// (action_source 'business_messaging' + messaging_channel + page_id, só com o
// telefone). Lead que chega de formulário de site é outro contexto: precisa de
// `action_source: 'website'`, da URL da página e do MÁXIMO de sinal de
// correspondência — é isso que levanta a "qualidade de correspondência" do
// Gerenciador de Eventos (o Pixel sozinho costuma ficar em 5–7; com e-mail,
// telefone, fbp/fbc, IP e user agent passa de 9).
//
// Dedupe: o mesmo `event_id` viaja no Pixel do navegador (parâmetro eventID) e
// aqui. A Meta junta os dois e conta UM evento — é assim que se ganha cobertura
// (o servidor não é bloqueado) sem contar duas vezes.
//
// Tudo que identifica pessoa vai em SHA-256, como a Meta exige. Nada de dado
// pessoal em texto puro sai daqui.

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { getConversionConfig, registrarLogConversao } from '@/lib/conversions';

const GRAPH = 'https://graph.facebook.com/v18.0';

export type LeadSite = {
  clientId: string;
  leadId?: string | null;
  eventName?: string;          // Lead (padrão), Contact, Schedule...
  eventId: string;             // o mesmo do Pixel no navegador
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  cidade?: string | null;
  estado?: string | null;
  pageUrl?: string | null;
  fbp?: string | null;         // cookie _fbp
  fbc?: string | null;         // cookie _fbc
  fbclid?: string | null;      // se não houver _fbc, monta a partir dele
  ip?: string | null;
  userAgent?: string | null;
  valor?: number | null;
  eventTime?: number;          // segundos; padrão = agora
};

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
/** Normalização da Meta: sem espaços nas pontas, minúsculo, sem acento. */
const limpo = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

export function hashEmail(email: string): string | null {
  const e = limpo(email).replace(/\s/g, '');
  return /.+@.+\..+/.test(e) ? sha(e) : null;
}

/** Telefone só com dígitos e DDI (55 quando o número é brasileiro sem DDI). */
export function hashTelefone(tel: string): string | null {
  const d = tel.replace(/\D/g, '');
  if (d.length < 10) return null;
  return sha(d.startsWith('55') ? d : `55${d}`);
}

/** "Maria da Silva" → fn=maria, ln=silva (a Meta compara os dois separados). */
export function hashNome(nome: string): { fn?: string; ln?: string } {
  const partes = limpo(nome).split(/\s+/).filter(p => p.length > 1);
  if (partes.length === 0) return {};
  const fn = sha(partes[0]);
  return partes.length > 1 ? { fn, ln: sha(partes[partes.length - 1]) } : { fn };
}

/** Sem cookie _fbc, a Meta aceita montá-lo do fbclid: fb.1.<ms>.<fbclid>. */
export function fbcDeFbclid(fbclid: string, agora = Date.now()): string {
  return `fb.1.${agora}.${fbclid}`;
}

/** Só o 1º IP do X-Forwarded-For; a Meta recusa a lista inteira. */
export function primeiroIp(xff: string | null | undefined): string | null {
  const ip = (xff ?? '').split(',')[0]?.trim();
  return ip || null;
}

export function montarUserData(lead: LeadSite, agora = Date.now()): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  const em = lead.email ? hashEmail(lead.email) : null;
  const ph = lead.telefone ? hashTelefone(lead.telefone) : null;
  if (em) u.em = [em];
  if (ph) u.ph = [ph];
  if (lead.nome) {
    const { fn, ln } = hashNome(lead.nome);
    if (fn) u.fn = [fn];
    if (ln) u.ln = [ln];
  }
  if (lead.cidade) u.ct = [sha(limpo(lead.cidade).replace(/\s/g, ''))];
  if (lead.estado) u.st = [sha(limpo(lead.estado).replace(/\s/g, ''))];
  u.country = [sha('br')];
  // external_id liga o mesmo lead entre eventos (site, CRM, venda depois)
  const externo = lead.leadId ?? (ph ?? em);
  if (externo) u.external_id = [sha(String(externo))];
  if (lead.fbp) u.fbp = lead.fbp;
  const fbc = lead.fbc || (lead.fbclid ? fbcDeFbclid(lead.fbclid, agora) : null);
  if (fbc) u.fbc = fbc;
  if (lead.ip) u.client_ip_address = lead.ip;
  if (lead.userAgent) u.client_user_agent = lead.userAgent;
  return u;
}

/** Quantos sinais de correspondência o evento leva — para log e diagnóstico. */
export function sinais(userData: Record<string, unknown>): string[] {
  return Object.keys(userData).filter(k => k !== 'country');
}

export type ResultadoCapi = { enviado: boolean; motivo?: string; status?: number; sinais?: string[] };

/**
 * Manda um evento de site para a API de Conversões da Meta.
 * Silencioso quando o cliente não tem Pixel/token configurado — a captura do
 * lead nunca pode falhar por causa disso.
 */
export async function enviarLeadSiteParaMeta(pool: Pool, lead: LeadSite): Promise<ResultadoCapi> {
  try {
    const cfg = await getConversionConfig(pool, lead.clientId);
    if (!cfg?.meta_pixel_id || !cfg?.meta_access_token) return { enviado: false, motivo: 'sem_pixel' };
    if (cfg.meta_ativo === false) return { enviado: false, motivo: 'meta_desativado' };
    const userData = montarUserData(lead);
    if (!userData.em && !userData.ph) return { enviado: false, motivo: 'sem_contato' };

    const eventName = lead.eventName || 'Lead';
    const evento: Record<string, unknown> = {
      event_name: eventName,
      event_time: lead.eventTime ?? Math.floor(Date.now() / 1000),
      event_id: lead.eventId,
      action_source: 'website',
      user_data: userData,
      custom_data: { currency: 'BRL', value: lead.valor ?? 0 },
    };
    if (lead.pageUrl) evento.event_source_url = lead.pageUrl.slice(0, 1000);

    const payload: Record<string, unknown> = { data: [evento], access_token: cfg.meta_access_token };
    if (cfg.meta_test_event_code) payload.test_event_code = cfg.meta_test_event_code;

    const res = await fetch(`${GRAPH}/${cfg.meta_pixel_id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const corpo = await res.text().catch(() => '');
    await registrarLogConversao(pool, {
      clientId: lead.clientId, leadId: lead.leadId ?? null, plataforma: 'meta',
      eventName, eventId: lead.eventId,
      telefoneHash: (userData.ph as string[] | undefined)?.[0] ?? null,
      valor: lead.valor ?? null, statusResposta: res.status,
      respostaBody: `[site ${sinais(userData).join('+')}] ${corpo}`.slice(0, 2000), sucesso: res.ok,
    }).catch(() => {});
    return { enviado: res.ok, status: res.status, sinais: sinais(userData) };
  } catch (e) {
    console.error('[meta-capi-site]', e instanceof Error ? e.message : e);
    return { enviado: false, motivo: 'erro' };
  }
}
