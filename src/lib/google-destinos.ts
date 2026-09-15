// ── Google Ads: destinos (URLs finais) das campanhas ativas ─────────────────
//
// Consumidor: o rastreio das landing pages (~/Documents/lps, `bin/gtag ads
// destinos <cliente>`). Pergunta que responde: "para onde cada campanha manda
// o clique?" — para conferir se CADA destino tem GTM/GA4/conversão.
//
// Duas fontes, porque a estrutura muda por tipo de campanha:
//   - ad_group_ad.ad.final_urls  → Pesquisa, Display, Vídeo, Demand Gen...
//   - asset_group.final_urls     → Performance Max (não tem ad_group_ad)
// Métricas dos últimos 30 dias somadas por campanha (a URL não tem métrica
// própria confiável: o mesmo anúncio pode ter várias URLs finais).

import { gadsSearch, type GoogleAdsAccess } from '@/lib/google-offline-conversions';

export type DestinoCampanha = {
  campanhaId: string;
  campanha: string;
  tipo: string;
  status: string;
  urls: string[];
  hosts: string[];
  cliques: number;
  custo: number;
  conversoes: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>;

/** Normaliza uma URL final: tira query/fragment de rastreio, mantém host + path. */
export function normalizarUrl(u: string): string {
  try {
    const url = new URL(u.trim());
    let path = url.pathname.replace(/\/+$/, '');
    if (!path) path = '/';
    return `${url.protocol}//${url.hostname.toLowerCase()}${path}`;
  } catch {
    return u.trim();
  }
}

/** Agrega linhas (de ad_group_ad ou asset_group) por campanha. */
export function agregarDestinos(linhasAnuncios: Linha[], linhasAssetGroups: Linha[]): DestinoCampanha[] {
  const porCampanha = new Map<string, DestinoCampanha & { _urls: Set<string> }>();
  const pega = (r: Linha, urls: string[]) => {
    const c = r.campaign ?? {};
    const id = String(c.id ?? '');
    if (!id) return;
    let d = porCampanha.get(id);
    if (!d) {
      d = { campanhaId: id, campanha: String(c.name ?? ''), tipo: String(c.advertisingChannelType ?? ''), status: String(c.status ?? ''), urls: [], hosts: [], cliques: 0, custo: 0, conversoes: 0, _urls: new Set() };
      porCampanha.set(id, d);
    }
    for (const u of urls) if (u) d._urls.add(normalizarUrl(String(u)));
    const m = r.metrics ?? {};
    d.cliques += Number(m.clicks ?? 0);
    d.custo += Number(m.costMicros ?? 0) / 1e6;
    d.conversoes += Number(m.conversions ?? 0);
  };
  for (const r of linhasAnuncios) pega(r, r.adGroupAd?.ad?.finalUrls ?? []);
  for (const r of linhasAssetGroups) pega(r, r.assetGroup?.finalUrls ?? []);
  return [...porCampanha.values()].map(d => {
    const urls = [...d._urls].sort();
    const hosts = [...new Set(urls.map(u => { try { return new URL(u).hostname; } catch { return u; } }))].sort();
    return { campanhaId: d.campanhaId, campanha: d.campanha, tipo: d.tipo, status: d.status, urls, hosts, cliques: d.cliques, custo: Number(d.custo.toFixed(2)), conversoes: Number(d.conversoes.toFixed(2)) };
  }).sort((a, b) => b.custo - a.custo);
}

/** Visão por destino: cada URL com as campanhas que apontam para ela. */
export function porDestino(campanhas: DestinoCampanha[]): Array<{ url: string; campanhas: string[]; cliques: number; custo: number }> {
  const m = new Map<string, { url: string; campanhas: string[]; cliques: number; custo: number }>();
  for (const c of campanhas) {
    for (const u of c.urls) {
      const cur = m.get(u) ?? { url: u, campanhas: [], cliques: 0, custo: 0 };
      cur.campanhas.push(c.campanha);
      // sem métrica por URL: divide a campanha igualmente entre os seus destinos
      cur.cliques += c.urls.length ? c.cliques / c.urls.length : 0;
      cur.custo += c.urls.length ? c.custo / c.urls.length : 0;
      m.set(u, cur);
    }
  }
  return [...m.values()].map(d => ({ ...d, cliques: Math.round(d.cliques), custo: Number(d.custo.toFixed(2)) })).sort((a, b) => b.custo - a.custo);
}

const GAQL_ANUNCIOS = `
  SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
         ad_group_ad.ad.final_urls, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM ad_group_ad
   WHERE campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'
     AND segments.date DURING LAST_30_DAYS`;
const GAQL_ASSET_GROUPS = `
  SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
         asset_group.final_urls, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM asset_group
   WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'
     AND segments.date DURING LAST_30_DAYS`;

export async function listarDestinos(access: GoogleAdsAccess): Promise<DestinoCampanha[] | null> {
  const [anuncios, assets] = await Promise.all([
    gadsSearch(access.customerId, GAQL_ANUNCIOS, access.token, access.loginCustomerId),
    gadsSearch(access.customerId, GAQL_ASSET_GROUPS, access.token, access.loginCustomerId),
  ]);
  if (!anuncios && !assets) return null;
  return agregarDestinos(anuncios?.results ?? [], assets?.results ?? []);
}
