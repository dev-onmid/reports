/**
 * De qual PLATAFORMA DE MÍDIA veio o faturamento de um canal do CRM.
 *
 * Regra do Matheus (08/10/2026) para o Faturamento/ROAS dos resumos de Meta e
 * Google do relatório: "Google Ads e WhatsApp é GOOGLE; Instagram e Meta Ads é
 * META ADS". O vocabulário real dos CRMs é bagunçado ("Facebook - WhatsApp",
 * "Google/Site", "faceads", "Chatwoot - WhatsApp"…), então a leitura é por
 * palavra, sem acento nem caixa:
 *
 *  - qualquer menção a Meta/Instagram/Facebook/FB → META (inclusive
 *    "Facebook - WhatsApp": é WhatsApp que nasceu num anúncio da Meta);
 *  - Google (fora "Google Meu Negócio", que é orgânico) → GOOGLE;
 *  - WhatsApp SEM marca de rede social → GOOGLE (a regra dele);
 *  - o resto (Indicação, Fachada, Site, TV, vazio) → nenhuma.
 *
 * Pura e client-safe. Mudar a regra = mudar aqui, e os dois resumos seguem.
 */
export type PlataformaMidia = 'meta' | 'google';

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function plataformaDoCanal(canal: string | null | undefined): PlataformaMidia | null {
  const t = semAcento(String(canal ?? '')).trim();
  if (!t) return null;
  if (/\b(meta|instagram|insta|facebook|faceads|fb)\b/.test(t) || /faceads|instagram|facebook/.test(t)) return 'meta';
  if (/meu negocio|gmn\b/.test(t)) return null;
  if (/google|gads\b|adwords/.test(t)) return 'google';
  if (/whats?app|wpp\b|zap\b/.test(t)) return 'google';
  return null;
}

export type ReceitaPlataforma = { faturamento: number; vendas: number; canais: string[] };

/** Soma receita/vendas dos canais do CRM por plataforma (canal sem plataforma fica fora). */
export function receitaPorPlataforma(
  origens: Array<{ label: string; receita: number; vendas: number }>,
): Record<PlataformaMidia, ReceitaPlataforma> {
  const out: Record<PlataformaMidia, ReceitaPlataforma> = {
    meta: { faturamento: 0, vendas: 0, canais: [] },
    google: { faturamento: 0, vendas: 0, canais: [] },
  };
  for (const o of origens) {
    const p = plataformaDoCanal(o.label);
    if (!p) continue;
    out[p].faturamento += Number(o.receita) || 0;
    out[p].vendas += Number(o.vendas) || 0;
    if ((Number(o.receita) || 0) > 0) out[p].canais.push(o.label);
  }
  return out;
}

/** O que os resumos de Meta/Google mostram: faturamento do CRM e o retorno sobre o investimento. */
export type ComercialDaPlataforma = { faturamento: number; vendas: number; roas: number | null; canais: string[] };

export function comercialDaPlataforma(r: ReceitaPlataforma, investimento: number): ComercialDaPlataforma | null {
  if (r.faturamento <= 0) return null;
  return { faturamento: r.faturamento, vendas: r.vendas, roas: investimento > 0 ? r.faturamento / investimento : null, canais: r.canais };
}
