/**
 * Integração Datalytics (CRM externo) — extração tolerante do payload de webhook.
 *
 * ⚠️ O shape EXATO do webhook deles é desconhecido — só conhecemos o
 * vocabulário da API (phoneWithDialCode, stageId, name, utm_*, gclid…).
 * Por isso a extração é por TABELA DE ALIASES, case-insensitive, olhando
 * também 1 nível dentro de wrappers comuns (`lead`/`data`/`body`). O payload
 * cru vai SEMPRE pro `datalytics_log` — depois do primeiro "Testar
 * requisição" real, é AQUI (e só aqui) que se ajustam os aliases.
 *
 * Pura e client-safe: sem pg, sem fetch.
 */

import { chaveTelefone } from '@/lib/importacao-origem';

export type EtapaRecebida =
  /** Nome legível da etapa — dá pra espelhar no Kanban e classificar no funil. */
  | { label: string }
  /** Só um id opaco (stageId) sem nome — loga e NÃO cria coluna lixo. */
  | { idOpaco: string }
  | null;

export type TrackingDatalytics = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  fbclid: string | null;
  matchtype: string | null;
  device: string | null;
  network: string | null;
  placement: string | null;
};

export type LeadDatalytics = {
  /** Chave de casamento (padrão chaveTelefone: dígitos, sem DDI 55, mín. 10). */
  telefone: string | null;
  /** Como veio no payload — é o que gravamos em `numero` ao criar. */
  telefoneBruto: string | null;
  nome: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  valor: number | null;
  observacao: string | null;
  etapa: EtapaRecebida;
  /** Id do lead no Datalytics, se vier — dedupe de eventos e external_id. */
  idExterno: string | null;
  isQualified: boolean | null;
  tracking: TrackingDatalytics;
};

/** Acha o primeiro alias presente (case-insensitive), como string não-vazia. */
function texto(obj: Record<string, unknown>, aliases: string[]): string | null {
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase();
    if (!aliases.includes(kl)) continue;
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s && s.toLowerCase() !== 'null' && s.toLowerCase() !== 'undefined') return s;
  }
  return null;
}

/** Aceita "1.234,56" (BR), "1234.56" e número cru. Lixo → null. */
export function parseValor(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  // Formato BR: vírgula decimal (com ou sem pontos de milhar).
  const br = /^-?[\d.]+,\d{1,2}$/.test(s);
  const limpo = br ? s.replace(/\./g, '').replace(',', '.') : s.replace(/[^\d.-]/g, '');
  const n = Number(limpo);
  return isFinite(n) && limpo !== '' ? n : null;
}

function parseBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'sim') return true;
  if (s === 'false' || s === '0' || s === 'nao' || s === 'não') return false;
  return null;
}

/**
 * Achata o payload: campos da raiz + campos de wrappers comuns 1 nível abaixo.
 * A raiz VENCE em conflito (é onde o vocabulário conhecido mora).
 */
function achatar(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const base = raw as Record<string, unknown>;
  const plano: Record<string, unknown> = {};
  for (const wrapper of ['body', 'payload', 'data', 'lead']) {
    const w = base[wrapper];
    if (typeof w === 'object' && w !== null && !Array.isArray(w)) {
      Object.assign(plano, w as Record<string, unknown>);
    }
  }
  Object.assign(plano, base);
  return plano;
}

/**
 * Resolve a etapa: nome legível vence; só stageId → idOpaco.
 * Sem depender de campo de "evento": etapa presente = mudança de etapa,
 * ausente = lead novo — o mesmo caminho de código trata os dois, o que torna
 * o receptor robusto ao shape desconhecido do webhook.
 */
export function resolverEtapa(plano: Record<string, unknown>): EtapaRecebida {
  const label = texto(plano, ['stage', 'stagename', 'stage_name', 'etapa', 'etapa_nome', 'stagetitle', 'funnelstage', 'funnel_stage']);
  if (label) return { label };
  const id = texto(plano, ['stageid', 'stage_id']);
  if (id) return { idOpaco: id };
  return null;
}

export function extrairLeadDatalytics(raw: unknown): LeadDatalytics {
  const p = achatar(raw);

  const telefoneBruto = texto(p, ['phonewithdialcode', 'phone', 'telefone', 'whatsapp', 'celular', 'phone_with_dial_code']);

  return {
    telefone: chaveTelefone(telefoneBruto),
    telefoneBruto,
    nome: texto(p, ['name', 'nome', 'lead_name', 'leadname']),
    email: texto(p, ['email', 'e_mail']),
    cidade: texto(p, ['city', 'cidade']),
    estado: texto(p, ['state', 'estado', 'uf']),
    valor: parseValor(p['value'] ?? p['valor']),
    observacao: texto(p, ['obs', 'observacao', 'observação', 'notes', 'note']),
    etapa: resolverEtapa(p),
    idExterno: texto(p, ['id', 'leadid', 'lead_id', '_id']),
    isQualified: parseBool(p['isQualified'] ?? p['isqualified'] ?? p['is_qualified']),
    tracking: {
      utm_source: texto(p, ['utm_source']),
      utm_medium: texto(p, ['utm_medium']),
      utm_campaign: texto(p, ['utm_campaign']),
      utm_content: texto(p, ['utm_content']),
      utm_term: texto(p, ['utm_term']),
      gclid: texto(p, ['gclid']),
      fbclid: texto(p, ['fbclid']),
      matchtype: texto(p, ['matchtype', 'match_type']),
      device: texto(p, ['device']),
      network: texto(p, ['network']),
      placement: texto(p, ['placement']),
    },
  };
}
