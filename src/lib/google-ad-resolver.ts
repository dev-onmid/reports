/**
 * Traduz ID de campanha/grupo/anúncio do Google Ads para o NOME.
 *
 * O ValueTrack do Google só entrega ID ({campaignid}, {adgroupid}, {creative})
 * — não existe macro de nome, ao contrário do Meta ({{campaign.name}}). Sem
 * traduzir, o lead chega com "22334455" no lugar de "Revenda Londrina Search"
 * e alguém precisa abrir o painel do Google para saber do que se trata.
 *
 * Espelha meta-ad-resolver: cache longo (nome muda pouco), cai para o cache
 * velho quando a API falha, e NUNCA lança — resolver nome é enfeite, perder o
 * lead por causa disso não é aceitável.
 */

import type { Pool } from 'pg';
import { lunaGoogleSearch, resolveGoogleAccountIds } from '@/lib/luna-tools';

export type GoogleAdNomes = {
  campaign_name: string | null;
  adgroup_name: string | null;
  ad_name: string | null;
};

// 30 dias: renomear campanha é raro, e nome velho é melhor que ID cru.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let schemaOk: Promise<void> | null = null;

export function ensureGoogleAdCacheSchema(pool: Pool): Promise<void> {
  if (!schemaOk) {
    schemaOk = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.google_ad_nome_cache (
          campaign_id TEXT NOT NULL,
          adgroup_id  TEXT NOT NULL DEFAULT '',
          client_id   TEXT NOT NULL,
          campaign_name TEXT,
          adgroup_name  TEXT,
          fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (client_id, campaign_id, adgroup_id)
        )
      `);
    })().catch(err => { schemaOk = null; throw err; });
  }
  return schemaOk;
}

const soDigitos = (v: string | null | undefined) =>
  v && /^\d+$/.test(v.trim()) ? v.trim() : null;

/**
 * Resolve os nomes a partir dos IDs. Devolve null quando não há o que fazer
 * (id ausente, cliente sem conta Google, API fora) — o chamador então mantém
 * o que já tinha.
 */
export async function resolverNomesGoogle(
  pool: Pool,
  clientId: string,
  ids: { campaignId?: string | null; adgroupId?: string | null },
): Promise<GoogleAdNomes | null> {
  const campaignId = soDigitos(ids.campaignId);
  const adgroupId = soDigitos(ids.adgroupId);
  if (!campaignId) return null;

  try {
    await ensureGoogleAdCacheSchema(pool);

    const { rows: [cache] } = await pool.query<{
      campaign_name: string | null; adgroup_name: string | null; fetched_at: string;
    }>(
      `SELECT campaign_name, adgroup_name, fetched_at
         FROM public.google_ad_nome_cache
        WHERE client_id = $1 AND campaign_id = $2 AND adgroup_id = $3`,
      [clientId, campaignId, adgroupId ?? ''],
    );
    const fresco = cache && (Date.now() - new Date(cache.fetched_at).getTime()) < CACHE_TTL_MS;
    if (fresco) {
      return { campaign_name: cache.campaign_name, adgroup_name: cache.adgroup_name, ad_name: null };
    }

    const contas = await resolveGoogleAccountIds(pool as never, clientId);
    if (!contas.length) {
      // Cliente sem conta Google vinculada: melhor devolver nome velho que nada.
      return cache
        ? { campaign_name: cache.campaign_name, adgroup_name: cache.adgroup_name, ad_name: null }
        : null;
    }

    // Consulta ESTRUTURAL, sem segments.date: filtro de data OMITE a linha da
    // campanha que ainda não veiculou no período — exatamente o caso de uma
    // campanha nova, que é quando mais se precisa do nome.
    const query = adgroupId
      ? `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name
           FROM ad_group WHERE campaign.id = ${campaignId} AND ad_group.id = ${adgroupId} LIMIT 1`
      : `SELECT campaign.id, campaign.name FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`;

    // Teto de tempo: esta resolução acontece DENTRO da requisição do formulário.
    // O lead já está gravado neste ponto, então nome é o único prejuízo — mas o
    // visitante está esperando a resposta para ser levado ao WhatsApp, e Google
    // lento não pode virar formulário travado. Só a PRIMEIRA conversão de cada
    // campanha paga isso; depois o cache de 30 dias responde local.
    const comTeto = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);

    let nomes: GoogleAdNomes | null = null;
    for (const conta of contas) {
      const r = await comTeto(lunaGoogleSearch(conta, query), 4000);
      const linha = r?.results?.[0];
      if (!linha) continue;
      nomes = {
        campaign_name: linha.campaign?.name ?? null,
        adgroup_name: linha.adGroup?.name ?? linha.ad_group?.name ?? null,
        ad_name: null,
      };
      break;
    }

    if (!nomes) {
      return cache
        ? { campaign_name: cache.campaign_name, adgroup_name: cache.adgroup_name, ad_name: null }
        : null;
    }

    await pool.query(
      `INSERT INTO public.google_ad_nome_cache
         (client_id, campaign_id, adgroup_id, campaign_name, adgroup_name, fetched_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (client_id, campaign_id, adgroup_id) DO UPDATE SET
         campaign_name = EXCLUDED.campaign_name,
         adgroup_name  = EXCLUDED.adgroup_name,
         fetched_at = NOW()`,
      [clientId, campaignId, adgroupId ?? '', nomes.campaign_name, nomes.adgroup_name],
    ).catch(() => null);

    return nomes;
  } catch (err) {
    console.error('[google-ad-resolver]', err);
    return null;   // nome é enfeite: nunca derruba quem chamou
  }
}

/**
 * O ValueTrack manda ID em utm_campaign. Se o valor é só dígitos, é ID —
 * texto é nome escrito à mão e deve ser respeitado como veio.
 */
export function pareceIdGoogle(valor: string | null | undefined): boolean {
  return !!valor && /^\d{6,}$/.test(valor.trim());
}
