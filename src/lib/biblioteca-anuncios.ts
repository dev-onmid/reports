// Biblioteca de Anúncios — coleta na Graph (server-only) + cache por cliente.
//
// Uma conta = 4 a 8 chamadas: insights level=ad no período (só quem entregou),
// detalhes dos anúncios em lote (`?ids=`), segmentação dos conjuntos e capa dos
// vídeos. O resultado fica em `biblioteca_anuncios_cache` por (cliente, dias),
// com TTL de 6h — a tela abre de graça e a carteira inteira (40+ contas) é
// coletada em rodadas com orçamento de tempo (ver a rota).

import type { Pool } from 'pg';
import { getClientMetaAdsToken } from '@/lib/meta-ad-resolver';
import {
  CIDADES_BASE, alertaDeCidade, cidadesCitadas, cortarTexto, statusDaMeta,
  type AnuncioRow, type TipoAnuncio,
} from '@/lib/biblioteca-anuncios-ui';

export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GRAPH = 'https://graph.facebook.com/v21.0';
const TIMEOUT_MS = 20_000;

let schemaReady: Promise<void> | null = null;
export function ensureBibliotecaSchema(pool: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS public.biblioteca_anuncios_cache (
        client_id  TEXT NOT NULL,
        account_id TEXT NOT NULL,
        days       INT  NOT NULL,
        payload    JSONB NOT NULL DEFAULT '[]'::jsonb,
        erro       TEXT,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (client_id, account_id, days)
      )
    `).then(() => undefined).catch(err => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

export type ContaMeta = { client_id: string; client_name: string; account_id: string };

/** Contas de anúncio Meta da carteira (ou de um cliente), com o nome do cliente. */
export async function listarContasMeta(pool: Pool, clientId?: string): Promise<ContaMeta[]> {
  const { rows } = await pool.query<ContaMeta>(
    `SELECT l.client_id, c.name AS client_name, l.account_id
       FROM public.client_account_links l
       JOIN public.clients c ON c.id = l.client_id
      WHERE l.platform IN ('meta_ads', 'meta')
        AND l.account_id IS NOT NULL
        AND ($1::text IS NULL OR l.client_id = $1)
        AND ($1::text IS NOT NULL OR COALESCE(c.status, 'Ativo') NOT IN ('Arquivado', 'Inativo'))
      ORDER BY c.name, l.account_id`,
    [clientId ?? null],
  );
  // O mesmo act_ pode estar em dois clientes (Cinfel/Cinfel Filial): coleta uma vez só.
  const vistos = new Set<string>();
  return rows.filter(r => {
    const act = r.account_id.startsWith('act_') ? r.account_id : `act_${r.account_id}`;
    if (vistos.has(act)) return false;
    vistos.add(act);
    r.account_id = act;
    return true;
  });
}

export type CacheRow = { client_id: string; account_id: string; payload: AnuncioRow[]; erro: string | null; fetched_at: string };

export async function lerCache(pool: Pool, days: number, contas: ContaMeta[]): Promise<Map<string, CacheRow>> {
  if (contas.length === 0) return new Map();
  const { rows } = await pool.query<CacheRow>(
    `SELECT client_id, account_id, payload, erro, fetched_at
       FROM public.biblioteca_anuncios_cache
      WHERE days = $1 AND account_id = ANY($2::text[])`,
    [days, contas.map(c => c.account_id)],
  );
  return new Map(rows.map(r => [r.account_id, r]));
}

export function cacheFresco(row: CacheRow | undefined): boolean {
  return !!row && Date.now() - new Date(row.fetched_at).getTime() < CACHE_TTL_MS;
}

async function graphGet<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const json = await res.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !json || json.error) {
    throw new Error(json?.error?.message ?? `Graph HTTP ${res.status}`);
  }
  return json;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any>;

function fmtDate(d: Date): string { return d.toISOString().slice(0, 10); }

type GeoLido = { nomes: string[]; cityIds: string[]; temPin: boolean };

/**
 * Cidades/regiões que o conjunto mira. Cidade com nome vem pronta; pin de raio
 * (`custom_locations`) traz só `primary_city_id`, resolvido depois em lote.
 */
function lerGeo(geo: Any | undefined): GeoLido {
  const out: GeoLido = { nomes: [], cityIds: [], temPin: false };
  if (!geo) return out;
  for (const c of geo.cities ?? []) if (c?.name) out.nomes.push(String(c.name));
  for (const r of geo.regions ?? []) if (r?.name) out.nomes.push(String(r.name));
  for (const z of geo.zips ?? []) if (z?.primary_city) out.nomes.push(String(z.primary_city));
  for (const p of geo.custom_locations ?? []) {
    out.temPin = true;
    if (p?.primary_city_id) out.cityIds.push(String(p.primary_city_id));
  }
  out.nomes = [...new Set(out.nomes)];
  return out;
}

/** Nome das cidades por id (search?type=adgeolocationmeta), uma chamada para a conta toda. */
async function resolverCidadesPorId(token: string, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const r = await graphGet<{ cities?: Record<string, Any> }>(`${GRAPH}/search?` + new URLSearchParams({
    type: 'adgeolocationmeta', cities: JSON.stringify(ids), access_token: token,
  })).catch(() => ({} as { cities?: Record<string, Any> }));
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(r.cities ?? {})) if (c?.name) out[id] = String(c.name);
  return out;
}

type PaginaInsights = { data?: Any[]; paging?: { next?: string } };

function tipoDoCriativo(cr: Any): TipoAnuncio {
  const spec = cr?.object_story_spec ?? {};
  if (cr?.video_id || spec.video_data) return 'video';
  if (spec.link_data?.child_attachments?.length > 1) return 'carrossel';
  if (cr?.image_url || cr?.image_hash || spec.link_data || spec.photo_data) return 'imagem';
  return cr?.thumbnail_url ? 'imagem' : 'outro';
}

/**
 * Coleta os anúncios que ENTREGARAM na conta no período (insights nível ad).
 * Anúncio sem impressão não aparece — a biblioteca é do que rodou, não do que existe.
 */
export async function coletarAnunciosDaConta(
  token: string, conta: ContaMeta, days: number,
): Promise<AnuncioRow[]> {
  const since = fmtDate(new Date(Date.now() - days * 86_400_000));
  const until = fmtDate(new Date());

  // 1) entrega por anúncio
  const insights: Any[] = [];
  let proxima: string | null = `${GRAPH}/${conta.account_id}/insights?` + new URLSearchParams({
    level: 'ad',
    time_range: JSON.stringify({ since, until }),
    fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions',
    limit: '200',
    access_token: token,
  });
  for (let pagina = 0; proxima && pagina < 12; pagina++) {
    const atual: string = proxima;
    const r: PaginaInsights = await graphGet<PaginaInsights>(atual);
    insights.push(...(r.data ?? []));
    proxima = r.paging?.next ?? null;
  }
  if (insights.length === 0) return [];

  // 2) detalhes dos anúncios (lotes de 50)
  const detalhes: Record<string, Any> = {};
  const adIds = insights.map(i => String(i.ad_id));
  for (let i = 0; i < adIds.length; i += 50) {
    const lote = adIds.slice(i, i + 50);
    const r = await graphGet<Record<string, Any>>(`${GRAPH}/?` + new URLSearchParams({
      ids: lote.join(','),
      fields: 'name,effective_status,created_time,preview_shareable_link,creative{id,thumbnail_url,image_url,image_hash,video_id,title,body,name,object_story_spec,effective_object_story_id}',
      access_token: token,
    }));
    Object.assign(detalhes, r);
  }

  // 3) segmentação geográfica dos conjuntos (+ nome das cidades dos pins)
  const adsetIds = [...new Set(insights.map(i => String(i.adset_id)).filter(Boolean))];
  const geoPorAdset: Record<string, GeoLido> = {};
  for (let i = 0; i < adsetIds.length; i += 50) {
    const lote = adsetIds.slice(i, i + 50);
    const r = await graphGet<Record<string, Any>>(`${GRAPH}/?` + new URLSearchParams({
      ids: lote.join(','), fields: 'targeting{geo_locations}', access_token: token,
    })).catch(() => ({} as Record<string, Any>));
    for (const id of lote) geoPorAdset[id] = lerGeo(r[id]?.targeting?.geo_locations);
  }
  const cityIds = [...new Set(Object.values(geoPorAdset).flatMap(g => g.cityIds))];
  const nomePorCityId = await resolverCidadesPorId(token, cityIds);
  for (const g of Object.values(geoPorAdset)) {
    for (const id of g.cityIds) if (nomePorCityId[id]) g.nomes.push(nomePorCityId[id]);
    g.nomes = [...new Set(g.nomes)];
  }

  // 4) capa (maior que o thumbnail de 64px) e duração dos vídeos
  const videoIds = [...new Set(Object.values(detalhes)
    .map(d => d?.creative?.video_id ?? d?.creative?.object_story_spec?.video_data?.video_id)
    .filter(Boolean).map(String))];
  const videos: Record<string, Any> = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const lote = videoIds.slice(i, i + 50);
    const r = await graphGet<Record<string, Any>>(`${GRAPH}/?` + new URLSearchParams({
      ids: lote.join(','), fields: 'picture,length', access_token: token,
    })).catch(() => ({} as Record<string, Any>));
    Object.assign(videos, r);
  }

  // Catálogo de cidades = base + tudo que a própria conta segmenta.
  const catalogo = [...new Set([...CIDADES_BASE, ...Object.values(geoPorAdset).flatMap(g => g.nomes)])];

  return insights.map(ins => {
    const adId = String(ins.ad_id);
    const d = detalhes[adId] ?? {};
    const cr: Any = d.creative ?? {};
    const spec: Any = cr.object_story_spec ?? {};
    const vd: Any = spec.video_data ?? {};
    const ld: Any = spec.link_data ?? {};
    const videoId = cr.video_id ?? vd.video_id;
    const video = videoId ? videos[String(videoId)] : undefined;
    const tipo = tipoDoCriativo(cr);
    const acoes: Any[] = ins.actions ?? [];
    const acao = (t: string) => Number(acoes.find(a => a.action_type === t)?.value ?? 0);

    const titulo = String(cr.title ?? vd.title ?? ld.name ?? '');
    const corpo = String(cr.body ?? vd.message ?? ld.message ?? '');
    const geo = geoPorAdset[String(ins.adset_id)] ?? { nomes: [], cityIds: [], temPin: false };
    const cidadesAlvo = [...new Set([
      ...geo.nomes,
      ...cidadesCitadas(`${ins.campaign_name ?? ''} ${ins.adset_name ?? ''}`, catalogo),
    ])];
    const citadas = cidadesCitadas(`${d.name ?? ins.ad_name ?? ''} ${titulo} ${corpo} ${cr.name ?? ''}`, catalogo);
    // Pin cuja cidade não se resolveu: alvo indeterminável, alerta fica mudo.
    const alvoIndefinido = geo.temPin && geo.nomes.length === 0;

    return {
      client_id: conta.client_id,
      client_name: conta.client_name,
      account_id: conta.account_id,
      ad_id: adId,
      ad_name: cortarTexto(String(d.name ?? ins.ad_name ?? adId), 200),
      campaign_id: String(ins.campaign_id ?? ''),
      campaign_name: cortarTexto(String(ins.campaign_name ?? ''), 200),
      adset_id: String(ins.adset_id ?? ''),
      adset_name: cortarTexto(String(ins.adset_name ?? ''), 200),
      spend: Number(ins.spend ?? 0),
      impressions: Number(ins.impressions ?? 0),
      clicks: Number(ins.clicks ?? 0),
      leads: acao('lead'),
      conversas: acao('onsite_conversion.messaging_conversation_started_7d'),
      status: statusDaMeta(d.effective_status),
      created_time: d.created_time ? String(d.created_time).slice(0, 10) : null,
      preview_url: d.preview_shareable_link ?? null,
      thumb_url: video?.picture ?? cr.image_url ?? ld.picture ?? cr.thumbnail_url ?? null,
      tipo,
      duracao_seg: video?.length ? Math.round(Number(video.length)) : null,
      titulo: cortarTexto(titulo, 200),
      corpo: cortarTexto(corpo.replace(/\s+/g, ' '), 300),
      cidades_alvo: cidadesAlvo,
      cidades_citadas: citadas,
      alerta: alertaDeCidade(cidadesAlvo, citadas, catalogo, { alvoIndefinido }),
    } satisfies AnuncioRow;
  });
}

/** Coleta uma conta e grava no cache (erro também é gravado, para a tela mostrar). */
export async function coletarEGravar(pool: Pool, conta: ContaMeta, days: number): Promise<CacheRow> {
  let payload: AnuncioRow[] = [];
  let erro: string | null = null;
  try {
    const token = await getClientMetaAdsToken(pool, conta.client_id);
    if (!token) throw new Error('Conta Meta sem conexão válida');
    payload = await coletarAnunciosDaConta(token, conta, days);
  } catch (err) {
    erro = err instanceof Error ? err.message.slice(0, 300) : String(err);
  }
  let rows: Array<{ fetched_at: string; payload: AnuncioRow[] }> = [];
  try {
    ({ rows } = await pool.query<{ fetched_at: string; payload: AnuncioRow[] }>(
    `INSERT INTO public.biblioteca_anuncios_cache (client_id, account_id, days, payload, erro, fetched_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
     ON CONFLICT (client_id, account_id, days) DO UPDATE SET
       -- coleta que falhou não apaga a última boa: a tela mostra o dado velho + o erro
       payload = CASE WHEN EXCLUDED.erro IS NULL THEN EXCLUDED.payload ELSE biblioteca_anuncios_cache.payload END,
       erro = EXCLUDED.erro,
       fetched_at = NOW()
     RETURNING fetched_at, payload`,
    [conta.client_id, conta.account_id, days, JSON.stringify(payload), erro],
    ));
  } catch (err) {
    // Gravar falhou (ex.: JSON recusado pelo Postgres): a conta volta com o erro
    // e o que foi coletado, sem derrubar a resposta das outras contas.
    erro = erro ?? `cache: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
  }
  return {
    client_id: conta.client_id,
    account_id: conta.account_id,
    payload: rows[0]?.payload ?? payload,
    erro,
    fetched_at: rows[0]?.fetched_at ?? new Date().toISOString(),
  };
}
