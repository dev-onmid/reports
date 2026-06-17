import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { randomUUID } from 'crypto';
import { logAiUsage } from '@/lib/ai-usage-logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Format helpers ─────────────────────────────────────────────────────────────

function brl(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function num(n: number) { return n.toLocaleString('pt-BR'); }

// Use these when 0 means "data not available", not "actually zero"
function brlOrDash(n: number) { return n > 0 ? brl(n) : '—'; }
function numOrDash(n: number) { return n > 0 ? num(n) : '—'; }

function deltaInfo(current: number, prev: number): { label: string; up: boolean; hasData: boolean } {
  if (!prev) return { label: '—', up: true, hasData: false };
  const diff = ((current - prev) / prev) * 100;
  return { label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')}%`, up: diff >= 0, hasData: true };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const PRIMARY      = '#55f52f';   // graphic fills only (bars, borders, squares)
const PRIMARY_TEXT = '#1a8a00';   // green as readable text on white (5.4:1 contrast)
const CANVAS       = '#EEF1F5';
const CARD         = '#FFFFFF';
const BG           = '#F7F8FA';
const ROW          = '#F1F5F9';
const BORDER       = '#D6DEE8';
const INVERSE      = '#FFFFFF';
const FG           = '#0F172A';   // near-black — titles, values
const MUTED        = '#334155';   // cinza chumbo — body text, labels, secondary
const RED          = '#e52020';
const BLUE         = '#0B84FF';
const ORANGE       = '#FF6B35';

const INTER = 'var(--font-inter), Inter, sans-serif';
const BEBAS = "var(--font-bebas), 'Bebas Neue', sans-serif";

// ── Types ──────────────────────────────────────────────────────────────────────

type Bairro      = { bairro: string; pedidos: number; faturamento: number };
type Product     = { nome: string; qtd: number; total: number };
type Faixa       = { label: string; count: number };
type DiaDaSemana = { dia: string; pedidos: number; pct: number };

type CampanhaDetalhada = {
  nome: string;
  tipo: string;
  metricas: {
    investimento: number;
    impressoes: number;
    alcance: number;
    cliques: number;
    frequencia: number;
    conversas: number;
    compras: number;
    valor_compras: number;
    purchase_roas: number;
  };
};

type MetaAdsFull = {
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  campanhas: CampanhaDetalhada[];
};

type Creative = {
  nome: string;
  spend: number;
  resultado: number;
  thumbnail_url: string | null;
};

type InstagramData = {
  username: string;
  followers: number;
  reach: number;
  impressions: number;
  profile_views: number;
  website_clicks: number;
  accounts_engaged: number;
};

type ParsedData = {
  ativos:          number;
  inativos:        number;
  potenciais:      number;
  faturamento:     number;
  pedidos_ativos:  number;
  ticket:          number;
  uma_compra:      number;
  recorrentes:     number;
  produtos:        Product[];
  inativos_faixas: Faixa[];
  por_dia:         DiaDaSemana[];
};

type DiagJson = {
  diagnostico:                string;
  forcas:                     Array<{ titulo: string; descricao: string }>;
  pontos_fortes:              string[];
  pontos_atencao:             string[];
  plano:                      Array<{ acao: string; objetivo: string; publico: string; mensagem: string }>;
  insight_campanha_conversa:  string;
  insight_campanha_conversao: string;
  frase_fechamento:           string;
  jornada:                    string[];
};

// ── CSV helpers ────────────────────────────────────────────────────────────────

function detectType(filename: string): 'ativos' | 'inativos' | 'potenciais' | 'produtos' | 'pedidos' | 'outros' {
  const n = filename.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('inativ'))                                               return 'inativos';
  if (n.includes('ativo'))                                                return 'ativos';
  if (n.includes('potencial'))                                            return 'potenciais';
  if (n.includes('produto'))                                              return 'produtos';
  if (n.includes('pedido') || n.includes('order') || n.includes('venda')) return 'pedidos';
  return 'outros';
}

function splitCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split('\n').filter(l => l.trim() && l.trim() !== '""');
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const parse = (line: string) => line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
  return { headers: parse(lines[0]).map(h => h.toLowerCase()), rows: lines.slice(1).map(parse) };
}

function parseFloat2(s: string): number {
  return parseFloat(s.replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
}

// Files prefixed with "ant-" (or containing "anterior") belong to the previous period.
function separateFiles(files: { name: string; content: string }[]): {
  current: typeof files;
  previous: typeof files;
} {
  const current: typeof files = [];
  const previous: typeof files = [];
  for (const f of files) {
    const base = f.name.toLowerCase();
    if (base.startsWith('ant-') || base.includes('anterior')) {
      const strippedName = base.startsWith('ant-') ? f.name.slice(4) : f.name;
      previous.push({ name: strippedName, content: f.content });
    } else {
      current.push(f);
    }
  }
  return { current, previous };
}

// ── File Parsers ───────────────────────────────────────────────────────────────

function parseClientesCsvExtended(content: string): {
  count: number; faturamento: number; pedidos: number; uma_compra: number; recorrentes: number;
} {
  const { headers, rows } = splitCsv(content);
  if (!headers.length) return { count: 0, faturamento: 0, pedidos: 0, uma_compra: 0, recorrentes: 0 };

  const vIdx = headers.findIndex(h => (h.includes('valor') || h.includes('gasto') || h.includes('faturamento')) && !h.includes('pedido'));
  const pIdx = headers.findIndex(h =>
    (h.includes('pedido') || h.includes('qtd') || h.includes('quantidade')) &&
    !h.includes('ultimo') && !h.includes('data') && !h.includes('valor'),
  );

  let fat = 0, ped = 0, uma_compra = 0, recorrentes = 0;
  for (const row of rows) {
    if (vIdx >= 0) fat += parseFloat2(row[vIdx] ?? '');
    const pedCount = pIdx >= 0 ? (parseInt(row[pIdx] ?? '0') || 0) : 0;
    if (pIdx >= 0) {
      ped += pedCount;
      if (pedCount === 1) uma_compra++;
      else if (pedCount >= 2) recorrentes++;
    }
  }
  return { count: rows.length, faturamento: fat, pedidos: ped, uma_compra, recorrentes };
}

function parseInativosFaixas(content: string, refDate: Date): Faixa[] {
  const { headers, rows } = splitCsv(content);
  const dIdx = headers.findIndex(h => h.includes('ultimo') || (h.includes('data') && h.includes('pedido')));
  if (dIdx === -1) return [];

  const FAIXAS = [
    { label: '30–59 dias',   min: 30,  max: 59,       count: 0 },
    { label: '60–89 dias',   min: 60,  max: 89,       count: 0 },
    { label: '90–179 dias',  min: 90,  max: 179,      count: 0 },
    { label: '180–364 dias', min: 180, max: 364,      count: 0 },
    { label: '365+ dias',    min: 365, max: Infinity,  count: 0 },
  ];

  for (const row of rows) {
    const ds = row[dIdx] ?? '';
    if (!ds) continue;
    let d: Date | null = null;
    if (/\d{2}\/\d{2}\/\d{4}/.test(ds)) { const [dd, mm, yyyy] = ds.split('/'); d = new Date(`${yyyy}-${mm}-${dd}`); }
    else if (/\d{4}-\d{2}-\d{2}/.test(ds)) { d = new Date(ds); }
    if (!d || isNaN(d.getTime())) continue;
    const dias = Math.floor((refDate.getTime() - d.getTime()) / 86_400_000);
    const f = FAIXAS.find(x => dias >= x.min && dias <= x.max);
    if (f) f.count++;
  }
  return FAIXAS.filter(f => f.count > 0).map(({ label, count }) => ({ label, count }));
}

function parseProducts(content: string): Product[] {
  const isBase64 = content.startsWith('data:');
  let rows: Record<string, unknown>[];

  if (isBase64) {
    const b64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
    try {
      const wb = XLSX.read(b64, { type: 'base64' });
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
    } catch { return []; }
  } else {
    const { headers, rows: r } = splitCsv(content);
    rows = r.map(cols => Object.fromEntries(headers.map((h, i) => [h, cols[i]])));
  }

  if (!rows.length) return [];
  const keys = Object.keys(rows[0]).map(k => k.toLowerCase());
  const get  = (kw: string[]) => Object.keys(rows[0])[keys.findIndex(k => kw.some(w => k.includes(w))) ?? -1];
  const nKey = get(['produto', 'nome', 'item', 'descri']);
  const qKey = get(['qtd', 'quantidade', 'vendid']);
  const tKey = get(['total', 'faturamento', 'valor']);
  if (!nKey) return [];

  return rows
    .map(r => ({
      nome:  String(r[nKey] ?? '').trim(),
      qtd:   qKey ? parseInt(String(r[qKey] ?? '0').replace(/\D/g, '')) || 0 : 0,
      total: tKey ? parseFloat2(String(r[tKey] ?? '0')) : 0,
    }))
    .filter(p => p.nome && p.nome.length > 1)
    .sort((a, b) => b.qtd - a.qtd || b.total - a.total)
    .slice(0, 10);
}

function parsePedidosDia(content: string): DiaDaSemana[] {
  const { headers, rows } = splitCsv(content);
  const dIdx = headers.findIndex(h => h.includes('data') || h.includes('date'));
  if (dIdx === -1) return [];

  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const ds = row[dIdx] ?? '';
    let d: Date | null = null;
    if (/\d{2}\/\d{2}\/\d{4}/.test(ds)) { const [dd, mm, yyyy] = ds.split('/'); d = new Date(`${yyyy}-${mm}-${dd}`); }
    else if (/\d{4}-\d{2}-\d{2}/.test(ds)) { d = new Date(ds); }
    if (d && !isNaN(d.getTime())) counts[d.getDay()]++;
  }
  const max = Math.max(...counts);
  if (!max) return [];
  return DIAS.map((dia, i) => ({ dia, pedidos: counts[i], pct: (counts[i] / max) * 100 }));
}

function parseAllFiles(files: { name: string; content: string }[], refDate: Date): ParsedData {
  const out: ParsedData = {
    ativos: 0, inativos: 0, potenciais: 0, faturamento: 0, pedidos_ativos: 0, ticket: 0,
    uma_compra: 0, recorrentes: 0,
    produtos: [], inativos_faixas: [], por_dia: [],
  };
  for (const f of files) {
    const type = detectType(f.name);
    if (type === 'ativos') {
      const { count, faturamento, pedidos, uma_compra, recorrentes } = parseClientesCsvExtended(f.content);
      out.ativos = count; out.faturamento = faturamento; out.pedidos_ativos = pedidos;
      out.uma_compra = uma_compra; out.recorrentes = recorrentes;
    } else if (type === 'inativos') {
      out.inativos = parseClientesCsvExtended(f.content).count;
      out.inativos_faixas = parseInativosFaixas(f.content, refDate);
    } else if (type === 'potenciais') {
      out.potenciais = parseClientesCsvExtended(f.content).count;
    } else if (type === 'produtos') {
      out.produtos = parseProducts(f.content);
    } else if (type === 'pedidos') {
      out.por_dia = parsePedidosDia(f.content);
    }
  }
  if (out.pedidos_ativos > 0 && out.faturamento > 0) out.ticket = out.faturamento / out.pedidos_ativos;
  return out;
}

// ── DB / API fetchers ──────────────────────────────────────────────────────────

async function fetchBairros(clientId: string, from: string, to: string): Promise<Bairro[]> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(
      `SELECT bairro, COUNT(*) AS pedidos, COALESCE(SUM(COALESCE(NULLIF(valor_rs,0),0)),0) AS faturamento
       FROM public.crm_leads
       WHERE client_id=$1 AND bairro IS NOT NULL AND bairro!=''
         AND COALESCE(data,lead_date,created_at::date) BETWEEN $2 AND $3
       GROUP BY bairro ORDER BY pedidos DESC LIMIT 10`,
      [clientId, from, to],
    ).catch(() => ({ rows: [] }));
    return rows.map((r: { bairro: string; pedidos: string; faturamento: string }) => ({
      bairro: r.bairro, pedidos: parseInt(r.pedidos, 10), faturamento: parseFloat(r.faturamento),
    }));
  } finally { await pool.end(); }
}

// Combined Meta fetch: account totals + campaign details (actions/frequency) + creative thumbnails.
async function fetchMetaData(
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string, to: string,
): Promise<{ meta: MetaAdsFull | null; creatives: Creative[] }> {
  if (!connectionId || !accountIds.length) return { meta: null, creatives: [] };

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id,app_id,access_token,token_expiry FROM public.meta_connections WHERE id=$1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally { await pool.end(); }
  if (!conn) return { meta: null, creatives: [] };

  const token     = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });

  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalCliques = 0;
  const campanhas: CampanhaDetalhada[] = [];
  const adInsights: Array<{ ad_id: string; ad_name: string; spend: number; resultado: number }> = [];

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;

    // Account-level totals
    const urlAcc = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAcc.searchParams.set('fields', 'spend,impressions,reach,clicks');
    urlAcc.searchParams.set('time_range', timeRange);
    urlAcc.searchParams.set('level', 'account');
    urlAcc.searchParams.set('access_token', token);
    const resAcc = await fetch(urlAcc.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (resAcc?.ok) {
      const j = await resAcc.json() as { data?: Record<string, string>[] };
      for (const row of j.data ?? []) {
        totalSpend       += parseFloat(row.spend ?? '0');
        totalImpressions += parseInt(row.impressions ?? '0', 10);
        totalReach       += parseInt(row.reach ?? '0', 10);
        totalCliques     += parseInt(row.clicks ?? '0', 10);
      }
    }

    // Campaign-level with actions + frequency
    const urlCamp = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlCamp.searchParams.set('fields', 'campaign_name,objective,spend,impressions,reach,clicks,frequency,actions,purchase_roas');
    urlCamp.searchParams.set('time_range', timeRange);
    urlCamp.searchParams.set('level', 'campaign');
    urlCamp.searchParams.set('limit', '8');
    urlCamp.searchParams.set('access_token', token);
    const resCamp = await fetch(urlCamp.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (resCamp?.ok) {
      const j = await resCamp.json() as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) {
        const actMap: Record<string, number> = {};
        for (const a of (row.actions as Array<{ action_type: string; value: string }> ?? [])) {
          actMap[a.action_type] = (actMap[a.action_type] || 0) + parseFloat(a.value || '0');
        }
        const purchaseRoasArr = row.purchase_roas as Array<{ action_type: string; value: string }> | undefined;
        const purchase_roas   = parseFloat(purchaseRoasArr?.[0]?.value ?? '0') || 0;
        campanhas.push({
          nome: String(row.campaign_name ?? 'Sem nome'),
          tipo: String(row.objective ?? ''),
          metricas: {
            investimento:  parseFloat(String(row.spend ?? '0')),
            impressoes:    parseInt(String(row.impressions ?? '0'), 10),
            alcance:       parseInt(String(row.reach ?? '0'), 10),
            cliques:       parseInt(String(row.clicks ?? '0'), 10),
            frequencia:    parseFloat(String(row.frequency ?? '0')),
            conversas:     actMap['messaging_conversation_started_7d'] || 0,
            compras:       actMap['offsite_conversion.fb_pixel_purchase'] || 0,
            valor_compras: actMap['offsite_conversion.fb_pixel_purchase_value'] || actMap['purchase'] || 0,
            purchase_roas,
          },
        });
      }
    }

    // Ad-level for creative ranking
    const urlAd = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAd.searchParams.set('fields', 'ad_id,ad_name,spend,actions');
    urlAd.searchParams.set('time_range', timeRange);
    urlAd.searchParams.set('level', 'ad');
    urlAd.searchParams.set('limit', '20');
    urlAd.searchParams.set('access_token', token);
    const resAd = await fetch(urlAd.toString(), { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (resAd?.ok) {
      const j = await resAd.json() as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) {
        const actMap: Record<string, number> = {};
        for (const a of (row.actions as Array<{ action_type: string; value: string }> ?? [])) {
          actMap[a.action_type] = (actMap[a.action_type] || 0) + parseFloat(a.value || '0');
        }
        const resultado = (actMap['messaging_conversation_started_7d'] || 0) +
          (actMap['offsite_conversion.fb_pixel_purchase'] || 0) +
          (actMap['lead'] || 0);
        adInsights.push({
          ad_id:   String(row.ad_id || ''),
          ad_name: String(row.ad_name || 'Sem nome'),
          spend:   parseFloat(String(row.spend || '0')),
          resultado,
        });
      }
    }
  }));

  if (totalSpend === 0 && campanhas.length === 0) return { meta: null, creatives: [] };

  const meta: MetaAdsFull = {
    investimento: totalSpend,
    impressoes:   totalImpressions,
    alcance:      totalReach,
    cliques:      totalCliques,
    campanhas:    campanhas.sort((a, b) => b.metricas.investimento - a.metricas.investimento).slice(0, 5),
  };

  // Fetch thumbnails for top-5 ads by resultado then spend
  const top5 = adInsights
    .sort((a, b) => b.resultado - a.resultado || b.spend - a.spend)
    .slice(0, 5);

  const creatives: Creative[] = await Promise.all(top5.map(async (ad) => {
    if (!ad.ad_id) return { nome: ad.ad_name, spend: ad.spend, resultado: ad.resultado, thumbnail_url: null };
    // Fetch creative fields needed to resolve the best thumbnail.
    // video_id is the direct reference used by Reels/video ads; image_url is for static ads.
    // creative.thumbnail_url has an oe= expiry param — we prefer video.picture when possible.
    const creativeFields = 'image_url,thumbnail_url,video_id,object_story_spec{video_data{video_id,image_url}}';
    const url = `https://graph.facebook.com/v21.0/${ad.ad_id}?fields=creative{${creativeFields}}&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    let thumbnail_url: string | null = null;
    if (res?.ok) {
      const j = await res.json() as {
        creative?: {
          image_url?: string;
          thumbnail_url?: string;
          video_id?: string;
          object_story_spec?: { video_data?: { video_id?: string; image_url?: string } };
        };
      };
      const cr = j.creative ?? {};
      const videoId = cr.video_id ?? cr.object_story_spec?.video_data?.video_id ?? null;

      // For video/Reels ads, fetch the video object's picture — a stable CDN URL
      // (unlike creative.thumbnail_url which uses oe= expiry timestamps).
      if (videoId) {
        const vRes = await fetch(
          `https://graph.facebook.com/v21.0/${videoId}?fields=picture&access_token=${token}`,
          { signal: AbortSignal.timeout(6000) },
        ).catch(() => null);
        if (vRes?.ok) {
          const vj = await vRes.json() as { picture?: string };
          thumbnail_url = vj.picture ?? null;
        }
        // Fallback: image_url set at ad creation time (explicit thumbnail in video_data)
        if (!thumbnail_url) {
          thumbnail_url = cr.object_story_spec?.video_data?.image_url ?? null;
        }
      }
      // Static image ad or last resort
      if (!thumbnail_url) {
        thumbnail_url = cr.image_url ?? cr.thumbnail_url ?? null;
      }
    }
    return { nome: ad.ad_name, spend: ad.spend, resultado: ad.resultado, thumbnail_url };
  }));

  return { meta, creatives };
}

type InstagramPost = {
  id: string;
  caption: string;
  mediaType: string; // IMAGE | VIDEO | CAROUSEL_ALBUM | REELS
  thumbnailUrl: string | null;
  permalink: string;
  timestamp: string;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  videoViews: number;
};

type InstagramFull = { insights: InstagramData; posts: InstagramPost[] };

// Per-media insights — reach/saved work for all types; video_views/plays only apply to video/reels.
// Uses the Graph API batch endpoint so N posts cost 1-2 HTTP round trips instead of N.
async function fetchInstagramPostInsightsBatch(
  mediaItems: Array<{ id: string; isVideo: boolean }>,
  token: string,
): Promise<Map<string, { reach: number; saves: number; videoViews: number }>> {
  const result = new Map<string, { reach: number; saves: number; videoViews: number }>();
  if (!mediaItems.length) return result;

  const runBatch = async (items: Array<{ id: string; isVideo: boolean }>, metric: string, apply: (id: string, name: string, val: number) => void) => {
    const batch = items.map(m => ({ method: 'GET', relative_url: `${m.id}/insights?metric=${metric}&period=lifetime` }));
    try {
      const body = new URLSearchParams({ access_token: token, batch: JSON.stringify(batch) });
      const res = await fetch('https://graph.facebook.com/v21.0/', { method: 'POST', body, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return;
      const respItems: Array<{ code: number; body: string } | null> = await res.json();
      for (let i = 0; i < items.length; i++) {
        if (respItems[i]?.code !== 200) continue;
        try {
          const d = JSON.parse(respItems[i]!.body) as { data?: { name: string; values?: { value: number }[] }[] };
          for (const m of d.data ?? []) apply(items[i].id, m.name, m.values?.[0]?.value ?? 0);
        } catch { /* skip malformed item */ }
      }
    } catch { /* network/timeout — leave defaults */ }
  };

  for (const m of mediaItems) result.set(m.id, { reach: 0, saves: 0, videoViews: 0 });
  await runBatch(mediaItems, 'reach,saved', (id, name, val) => {
    const r = result.get(id)!;
    if (name === 'reach') r.reach = val;
    if (name === 'saved') r.saves = val;
  });
  const videoItems = mediaItems.filter(m => m.isVideo);
  if (videoItems.length) {
    await runBatch(videoItems, 'video_views,plays', (id, name, val) => {
      const r = result.get(id)!;
      if (name === 'video_views' || name === 'plays') r.videoViews = Math.max(r.videoViews, val);
    });
  }
  return result;
}

async function fetchInstagramData(
  connectionId: string | null | undefined,
  from: string, to: string,
): Promise<InstagramFull | null> {
  if (!connectionId) return null;

  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT id,app_id,access_token,token_expiry FROM public.meta_connections WHERE id=$1`,
      [connectionId],
    );
    conn = rows[0] ?? null;
  } finally { await pool.end(); }
  if (!conn) return null;

  const token = await getFreshMetaToken(conn);

  // Discover Instagram Business accounts via Facebook Pages (page access_token needed for media/insights calls)
  const pagesUrl = new URL('https://graph.facebook.com/v21.0/me/accounts');
  pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,followers_count}');
  pagesUrl.searchParams.set('access_token', token);
  const pagesRes = await fetch(pagesUrl.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!pagesRes?.ok) return null;

  const pagesData = await pagesRes.json() as {
    data?: Array<{ access_token: string; instagram_business_account?: { id: string; username: string; followers_count: number } }>;
  };
  const page = (pagesData.data ?? []).find(p => p.instagram_business_account);
  if (!page?.instagram_business_account) return null;
  const ig = page.instagram_business_account;
  const pageToken = page.access_token;

  // Fetch profile-level insights for the period
  const insUrl = new URL(`https://graph.facebook.com/v21.0/${ig.id}/insights`);
  insUrl.searchParams.set('metric', 'reach,impressions,profile_views,website_clicks,accounts_engaged');
  insUrl.searchParams.set('period', 'total_over_range');
  insUrl.searchParams.set('since', from);
  insUrl.searchParams.set('until', to);
  insUrl.searchParams.set('access_token', pageToken);
  const insRes = await fetch(insUrl.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);

  let reach = 0, impressions = 0, profile_views = 0, website_clicks = 0, accounts_engaged = 0;
  if (insRes?.ok) {
    const insData = await insRes.json() as {
      data?: Array<{ name: string; values: Array<{ value: number }> }>;
    };
    for (const m of insData.data ?? []) {
      const val = typeof m.values?.[0]?.value === 'number' ? m.values[0].value : 0;
      if (m.name === 'reach')             reach = val;
      else if (m.name === 'impressions')  impressions = val;
      else if (m.name === 'profile_views') profile_views = val;
      else if (m.name === 'website_clicks') website_clicks = val;
      else if (m.name === 'accounts_engaged') accounts_engaged = val;
    }
  }

  if (reach === 0 && impressions === 0 && ig.followers_count === 0) return null;

  const insights: InstagramData = { username: ig.username, followers: ig.followers_count, reach, impressions, profile_views, website_clicks, accounts_engaged };

  // Last posts published within the report period (newest first, capped at 12)
  let posts: InstagramPost[] = [];
  try {
    const since = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
    const until = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);
    const mediaUrl = new URL(`https://graph.facebook.com/v21.0/${ig.id}/media`);
    mediaUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count');
    mediaUrl.searchParams.set('limit', '12');
    mediaUrl.searchParams.set('since', String(since));
    mediaUrl.searchParams.set('until', String(until));
    mediaUrl.searchParams.set('access_token', pageToken);
    const mediaRes = await fetch(mediaUrl.toString(), { signal: AbortSignal.timeout(15000) }).catch(() => null);

    if (mediaRes?.ok) {
      const mediaData = await mediaRes.json() as { data?: Record<string, unknown>[] };
      const media = (mediaData.data ?? []) as Array<{
        id: string; caption?: string; media_type?: string; media_product_type?: string;
        media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string;
        like_count?: number; comments_count?: number;
      }>;

      const mediaForInsights = media.map(m => ({
        id: m.id,
        isVideo: m.media_product_type === 'REELS' || m.media_type === 'VIDEO',
      }));
      const postInsights = await fetchInstagramPostInsightsBatch(mediaForInsights, pageToken);

      posts = media.map(m => {
        const isVideo = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
        const ins = postInsights.get(m.id) ?? { reach: 0, saves: 0, videoViews: 0 };
        return {
          id: m.id,
          caption: m.caption ?? '',
          mediaType: m.media_product_type ?? m.media_type ?? 'IMAGE',
          thumbnailUrl: m.thumbnail_url ?? (!isVideo ? m.media_url ?? null : null),
          permalink: m.permalink ?? '',
          timestamp: m.timestamp ?? '',
          likes: m.like_count ?? 0,
          comments: m.comments_count ?? 0,
          reach: ins.reach,
          saves: ins.saves,
          videoViews: ins.videoViews,
        };
      });
    }
  } catch { /* posts are a bonus — insights above still return */ }

  return { insights, posts };
}

// ── Slide audit (dev-only warnings) ───────────────────────────────────────────

function auditSlide(html: string, id: string): string {
  if (process.env.NODE_ENV === 'production') return html;
  const warns: string[] = [];
  const cards = (html.match(new RegExp(`background:${CARD}`, 'g')) ?? []).length;
  if (cards > 8) warns.push(`${id}: ${cards} cards (>8)`);
  if (!(html.includes('data-conclusion') || html.includes('CONCLUSÃO') || html.includes('LEITURA')))
    warns.push(`${id}: sem conclusão`);
  const dashes = (html.match(/>—</g) ?? []).length;
  if (dashes > 4) warns.push(`${id}: ${dashes} valores ausentes`);
  if (warns.length) console.warn('[slideAudit]', warns.join(' | '));
  return html;
}

// ── SVG chart helpers ─────────────────────────────────────────────────────────

function ptCart(cx: number, cy: number, r: number, deg: number) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function donutPath(cx: number, cy: number, outer: number, inner: number, a1: number, a2: number): string {
  const safe = a2 - a1 >= 360 ? a1 + 359.99 : a2;
  const os = ptCart(cx, cy, outer, safe), oe = ptCart(cx, cy, outer, a1);
  const is = ptCart(cx, cy, inner, a1), ie = ptCart(cx, cy, inner, safe);
  const arc = safe - a1 <= 180 ? '0' : '1';
  return `M ${os.x.toFixed(1)} ${os.y.toFixed(1)} A ${outer} ${outer} 0 ${arc} 0 ${oe.x.toFixed(1)} ${oe.y.toFixed(1)} L ${is.x.toFixed(1)} ${is.y.toFixed(1)} A ${inner} ${inner} 0 ${arc} 1 ${ie.x.toFixed(1)} ${ie.y.toFixed(1)} Z`;
}

// s=320 → outer=140 (s/2−20), inner=64 (s/5). Centro circle r=56 (inner−8).
function donutSvg(slices: { label: string; value: number; color: string }[], s = 320): string {
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (!total) return '';
  const outerR = Math.round(s / 2 - 20);
  const innerR = Math.round(s / 5);
  let c = 0;
  const paths = slices.map(sl => {
    const angle = (sl.value / total) * 360;
    const p = donutPath(s / 2, s / 2, outerR, innerR, c, c + angle);
    c += angle;
    return `<path d="${p}" fill="${sl.color}" stroke="rgba(0,0,0,0.35)" stroke-width="1" style="filter:drop-shadow(0 0 8px ${sl.color}80)"/>`;
  });
  return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" style="flex-shrink:0">
    ${paths.join('')}
    <circle cx="${s / 2}" cy="${s / 2}" r="${innerR - 8}" fill="${CARD}"/>
  </svg>`;
}

// ── HTML component helpers ─────────────────────────────────────────────────────

// ── Core layout primitives ────────────────────────────────────────────────────

/** Premium header (onmid wordmark + toggle, "NN/TT" counter with green underline) — same style as the cover. */
function richHeader(idx: number, total: number): string {
  return `<div style="height:92px;padding:34px 48px 0;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:${INTER};font-size:34px;font-weight:900;letter-spacing:-0.06em;color:${FG};line-height:1">onmid</span>
      <span style="width:44px;height:22px;border-radius:999px;background:${PRIMARY};display:inline-flex;align-items:center;justify-content:flex-end;padding-right:4px;box-sizing:border-box;box-shadow:0 8px 20px ${PRIMARY}55">
        <span style="width:14px;height:14px;border-radius:50%;background:#FFFFFF;display:block"></span>
      </span>
      <span style="font-size:9px;font-weight:700;color:${MUTED};align-self:flex-start;margin-top:1px">®</span>
    </div>
    <div style="font-family:${INTER};font-size:22px;font-weight:900;color:${FG};line-height:1;text-align:right">
      ${String(idx).padStart(2, '0')}/${String(total).padStart(2, '0')}
      <div style="height:2px;background:${PRIMARY};margin-top:9px;width:58px;margin-left:auto"></div>
    </div>
  </div>`;
}

/** Premium footer (toggle pill + ONMID Reports wordmark) — same style as the cover. */
function richFooter(): string {
  return `<div style="height:56px;border-top:1px solid ${BORDER};display:flex;align-items:center;padding:0 48px;gap:12px;flex-shrink:0">
    <span style="width:34px;height:18px;border-radius:999px;background:${PRIMARY};display:inline-flex;align-items:center;justify-content:flex-end;padding-right:3px;box-sizing:border-box"><span style="width:11px;height:11px;border-radius:50%;background:#FFFFFF"></span></span>
    <span style="font-family:${INTER};font-size:13px;font-weight:900;color:${FG};letter-spacing:.03em">ONMID</span>
    <span style="font-family:${INTER};font-size:13px;color:#163461">Reports</span>
  </div>`;
}

function wrapSlide(body: string, idx: number, total: number, tag?: string): string {
  const tagHtml = tag
    ? `<span style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};border:1px solid ${BORDER};padding:2px 8px">${tag}</span>`
    : '';
  return `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${BORDER};flex-shrink:0">
    <span style="font-family:${BEBAS};font-size:22px;color:${PRIMARY};letter-spacing:0.06em">ONMID</span>
    <div style="display:flex;align-items:center;gap:12px">${tagHtml}<span style="font-size:11px;color:${MUTED};font-family:${INTER};font-weight:600">${idx} / ${total}</span></div>
  </div>
  <div style="flex:1;padding:32px 48px 0;display:flex;flex-direction:column">${body}</div>
</div>`;
}

/** Thesis-driven section header — title should be a conclusion, not a label */
function sectionHeader(thesis: string, context: string): string {
  return `<div style="margin-bottom:22px">
  <div style="display:flex;gap:14px;align-items:flex-start">
    <div style="width:4px;flex-shrink:0;background:${PRIMARY};align-self:stretch;min-height:42px;margin-top:2px"></div>
    <div>
      <h2 style="font-family:${BEBAS};font-size:36px;color:${FG};margin:0;line-height:1;letter-spacing:0.02em">${thesis}</h2>
      <p style="font-size:11px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;margin:5px 0 0;font-family:${INTER}">${context}</p>
    </div>
  </div>
</div>`;
}

/** Hero KPI — ONE per slide, the anchor metric */
function kpiHero(label: string, value: string, sub: string, color = PRIMARY): string {
  const isEmpty = value === '—';
  const textColor = color === PRIMARY ? PRIMARY_TEXT : color;
  return `<div style="position:relative;overflow:hidden;border:1px solid ${color}40;background:${CARD};padding:28px 28px 24px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${color},${color}00)"></div>
  <div style="position:absolute;top:0;left:0;width:14px;height:14px;background:${color}"></div>
  <p style="font-size:10px;font-weight:700;color:${textColor};text-transform:uppercase;letter-spacing:0.12em;font-family:${INTER};margin:4px 0 10px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '36' : '60'}px;color:${isEmpty ? MUTED : FG};line-height:0.9;margin:0 0 10px;letter-spacing:0.01em">${value}</p>
  <p style="font-size:13px;color:${MUTED};font-family:${INTER};line-height:1.5;margin:0">${sub}</p>
</div>`;
}

/** Secondary KPI card with corner-square motif */
function kpi(label: string, value: string, context: string, accentColor = PRIMARY): string {
  const isEmpty = value === '—';
  return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};background:${CARD};padding:20px 18px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:4px 0 8px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '24' : '36'}px;color:${isEmpty ? MUTED : FG};line-height:1;margin:0 0 5px">${value}</p>
  <p style="font-size:11px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${context}</p>
</div>`;
}

function hbar(label: string, value: string, pct: number, hi: boolean, barH = 6): string {
  const barColor = hi ? PRIMARY : `${PRIMARY}30`;
  return `<div style="margin-bottom:11px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
    <span style="font-size:12px;font-weight:${hi ? '700' : '500'};color:${hi ? FG : MUTED};font-family:${INTER}">${label}</span>
    <span style="font-size:12px;font-weight:700;color:${hi ? FG : MUTED};font-family:${INTER}">${value}</span>
  </div>
  <div style="height:${barH}px;background:${BORDER};overflow:hidden">
    <div style="height:100%;background:${barColor};width:${Math.min(pct,100).toFixed(1)}%"></div>
  </div>
</div>`;
}

/** Full-width bottom conclusion banner — every content slide should end with one */
function thesisBanner(text: string, type: 'insight'|'warning'|'neutral' = 'insight'): string {
  const color     = type === 'warning' ? RED : type === 'neutral' ? MUTED : PRIMARY;
  const textColor = type === 'insight' ? PRIMARY_TEXT : color;
  return `<div data-conclusion="1" style="margin-top:auto;padding-top:16px;padding-bottom:28px">
  <div style="border-left:3px solid ${color};background:${color}0D;padding:12px 20px;display:flex;align-items:center;gap:14px">
    <span style="font-size:10px;font-weight:800;color:${textColor};text-transform:uppercase;letter-spacing:0.12em;font-family:${INTER};flex-shrink:0">Conclusão</span>
    <span style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.6">${text}</span>
  </div>
</div>`;
}

function insight(title: string, text: string, color = PRIMARY): string {
  const textColor = color === PRIMARY ? PRIMARY_TEXT : color;
  return `<div style="border:1px solid ${color}40;background:${color}0D;padding:13px 15px;margin-top:10px">
  <p style="font-size:10px;font-weight:700;color:${textColor};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 5px">${title}</p>
  <p style="font-size:12px;color:${FG};line-height:1.6;margin:0;font-family:${INTER}">${text}</p>
</div>`;
}

/** Campaign/product rank card — winner gets full weight, others get reduced weight */
function rankCard(rank: number, title: string, metrics: Array<{label:string;value:string}>, status: 'winner'|'loser'|'normal'): string {
  const accent     = status === 'winner' ? PRIMARY : status === 'loser' ? RED : BORDER;
  const accentText = status === 'winner' ? PRIMARY_TEXT : status === 'loser' ? RED : MUTED;
  const badge      = status === 'winner' ? `<span style="font-size:9px;font-weight:800;color:${INVERSE};background:${PRIMARY};padding:2px 7px;letter-spacing:0.08em;font-family:${INTER}">CAMPEÃ</span>`
                   : status === 'loser'  ? `<span style="font-size:9px;font-weight:800;color:#FFFFFF;background:${RED};padding:2px 7px;letter-spacing:0.08em;font-family:${INTER}">ATENÇÃO</span>`
                   : '';
  const opacity = status === 'normal' ? 'opacity:0.72' : '';
  const rows = metrics.map(m =>
    `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid ${BORDER};font-family:${INTER}">
      <span style="font-size:11px;color:${MUTED}">${m.label}</span>
      <span style="font-size:11px;font-weight:700;color:${FG}">${m.value}</span>
    </div>`,
  ).join('');
  return `<div style="position:relative;overflow:hidden;border:1px solid ${accent}60;background:${CARD};padding:16px;${opacity}">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accent}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accent}"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin:4px 0 12px;gap:8px">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:${BEBAS};font-size:26px;color:${accentText};line-height:1">#${rank}</span>
      <span style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};line-height:1.3">${title}</span>
    </div>
    ${badge}
  </div>
  <div>${rows}</div>
</div>`;
}

/** 2×2 decision matrix — Impacto × Esforço */
function decisionMatrix(cells: {label:string;color:string;axis:string;items:string[]}[]): string {
  const q = cells.map(c => `<div style="border:1px solid ${c.color}30;background:${c.color}0A;padding:14px;display:flex;flex-direction:column;gap:6px">
    <p style="font-size:9px;font-weight:800;color:${c.color};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 4px">${c.label}</p>
    ${c.items.slice(0,2).map(item =>
      `<div style="font-size:11px;color:${FG};font-family:${INTER};line-height:1.4;padding:5px 0;border-bottom:1px solid ${BORDER}">${item}</div>`,
    ).join('')}
  </div>`).join('');
  return `<div>
  <div style="display:flex;gap:4px;margin-bottom:4px">
    <div style="width:60px;flex-shrink:0"></div>
    <div style="flex:1;text-align:center;font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER}">Esforço Baixo</div>
    <div style="flex:1;text-align:center;font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER}">Esforço Alto</div>
  </div>
  <div style="display:flex;gap:4px">
    <div style="display:flex;flex-direction:column;justify-content:space-around;width:60px;flex-shrink:0">
      <div style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};transform:rotate(-90deg);transform-origin:center;white-space:nowrap">↑ Impacto Alto</div>
      <div style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};transform:rotate(-90deg);transform-origin:center;white-space:nowrap">↓ Impacto Baixo</div>
    </div>
    <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:4px;height:300px">${q}</div>
  </div>
</div>`;
}

/** 5-step horizontal journey bar */
function journeyBar(steps: string[]): string {
  const LABELS: Record<string,string> = {
    descoberta:'Descoberta', primeira_compra:'1ª Compra',
    recompra:'Recompra', reativacao_leve:'Reat. Leve', reativacao_forte:'Reat. Forte',
  };
  return `<div style="display:flex;align-items:stretch;margin-bottom:20px">
    ${steps.map((s, i) => `<div style="flex:1;text-align:center;padding:8px 4px;background:${i===0?PRIMARY:CARD};border:1px solid ${i===0?PRIMARY:BORDER};margin-right:-1px;position:relative">
      <p style="font-size:10px;font-weight:700;color:${i===0?INVERSE:MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:${INTER};margin:0">${LABELS[s]??s}</p>
    </div>`).join('')}
  </div>`;
}

// ── Slide builders ────────────────────────────────────────────────────────────

// ── Slide builders — Executive Layout Recipes ─────────────────────────────────

function sCapa(
  d: ParsedData, meta: MetaAdsFull | null, clientName: string,
  periodo: string, prevPeriodo: string, diag: DiagJson, total: number,
): string {
  void d;
  void meta;

  const apoio = `Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para o próximo ciclo.`;
  const objetivo = diag.diagnostico || diag.frase_fechamento || `Apresentar uma leitura clara dos resultados do período, entender o que compôs o faturamento, quais públicos e produtos tiveram maior força e quais oportunidades podem ser aproveitadas para aumentar recorrência, reativar clientes e otimizar campanhas.`;

  const chartPath = 'M0 86 C46 72 42 34 86 44 C120 52 130 12 164 20 C198 28 190 70 232 62 C270 54 270 18 308 28 C342 38 330 72 378 46 C410 30 414 8 446 12';
  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;left:-110px;bottom:-130px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}33 0%,${PRIMARY}16 38%,transparent 72%);pointer-events:none"></div>
  <div style="position:absolute;right:96px;top:88px;width:520px;height:520px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.68),rgba(255,255,255,.2));opacity:.72;pointer-events:none"></div>

  ${richHeader(1, total)}

  <div style="position:relative;z-index:1;flex:1;padding:82px 48px 68px;display:grid;grid-template-columns:650px 1fr;column-gap:40px">
    <div style="display:flex;flex-direction:column;min-width:0">
      <h1 style="font-family:${INTER};font-size:58px;font-weight:900;letter-spacing:-0.045em;color:${FG};line-height:1.04;margin:0 0 20px">
        Relatório de Performance —<br>${clientName}
      </h1>
      <p style="font-family:${INTER};font-size:20px;font-weight:500;color:#163461;line-height:1.48;margin:0 0 34px;max-width:590px">${apoio}</p>

      <div style="display:flex;flex-direction:column;gap:18px;margin-top:4px">
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:48px;height:48px;border-radius:15px;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v5M8 2v5M3 10h18"></path>
            </svg>
          </div>
          <p style="font-family:${INTER};font-size:18px;color:#14305B;margin:0"><strong style="color:${FG}">Período analisado:</strong> ${periodo}</p>
        </div>
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:48px;height:48px;border-radius:15px;background:${BLUE}12;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>
            </svg>
          </div>
          <p style="font-family:${INTER};font-size:18px;color:#14305B;margin:0"><strong style="color:${FG}">Comparativo:</strong> ${prevPeriodo || 'Período anterior não informado'}</p>
        </div>
      </div>
    </div>

    <div style="position:relative;min-height:440px">
      <div style="position:absolute;right:70px;top:10px;width:360px;height:150px;border-radius:18px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 42px rgba(15,23,42,.09);padding:22px">
        <div style="display:flex;gap:8px;margin-bottom:16px"><span style="width:10px;height:10px;border-radius:50%;background:${PRIMARY}"></span><span style="width:10px;height:10px;border-radius:50%;background:${PRIMARY}55"></span><span style="width:10px;height:10px;border-radius:50%;background:#D7DEE8"></span></div>
        <svg viewBox="0 0 460 110" width="100%" height="86">
          <rect x="0" y="4" width="460" height="104" fill="#F8FAFD" stroke="#E6EDF6"/>
          <path d="${chartPath}" fill="none" stroke="${BLUE}" stroke-width="3" stroke-linecap="round"/>
          <path d="${chartPath} L446 108 L0 108 Z" fill="${BLUE}" opacity=".10"/>
        </svg>
      </div>

      <div style="position:absolute;left:56px;top:144px;width:230px;height:112px;border-radius:17px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.10);display:flex;align-items:center;gap:18px;padding:18px">
        <div style="width:72px;height:72px;border-radius:50%;background:conic-gradient(${PRIMARY} 0 68%,${PRIMARY}55 68% 82%,#DBEAFE 82% 100%);position:relative;flex-shrink:0"><span style="position:absolute;inset:21px;border-radius:50%;background:#FFFFFF"></span></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:12px"><span style="height:8px;border-radius:8px;background:${PRIMARY};width:18px"></span><span style="height:8px;border-radius:8px;background:#D9E2EE;width:86px"></span><span style="height:8px;border-radius:8px;background:#D9E2EE;width:64px"></span></div>
      </div>

      <div style="position:absolute;right:0;top:250px;width:196px;height:112px;border-radius:15px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.09);display:flex;align-items:flex-end;gap:14px;padding:22px 24px">
        ${[34, 50, 66, 84, 104].map((h, i) => `<span style="width:15px;height:${h}px;border-radius:5px;background:${PRIMARY};opacity:${0.38 + i * 0.14}"></span>`).join('')}
      </div>

      <div style="position:absolute;right:212px;top:220px;width:230px;height:112px;border-radius:15px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.09);display:grid;grid-template-columns:96px 1fr;gap:15px;padding:14px">
        <div style="border-radius:13px;background:linear-gradient(135deg,#FDE68A,#F97316);position:relative;overflow:hidden">
          <span style="position:absolute;left:15px;top:18px;width:26px;height:26px;border-radius:50%;background:#22C55E"></span>
          <span style="position:absolute;right:14px;top:26px;width:34px;height:24px;border-radius:14px;background:#FEF3C7"></span>
          <span style="position:absolute;left:24px;bottom:18px;width:48px;height:28px;border-radius:16px;background:#B45309"></span>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;justify-content:center"><span style="height:9px;border-radius:9px;background:#D9E2EE;width:92px"></span><span style="height:9px;border-radius:9px;background:#D9E2EE;width:70px"></span><span style="height:9px;border-radius:9px;background:#D9E2EE;width:52px"></span><span style="height:17px;border-radius:9px;background:${PRIMARY};width:54px;margin-top:4px"></span></div>
      </div>

      <div style="position:absolute;left:104px;bottom:38px;width:210px;height:112px;border-radius:15px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.08);padding:12px">
        <div style="height:88px;border-radius:12px;background:#EFF6FF;position:relative;overflow:hidden">
          <svg viewBox="0 0 210 88" width="100%" height="88"><path d="M0 62 L48 28 L96 46 L144 18 L210 56" fill="none" stroke="#BFDBFE" stroke-width="12"/><path d="M30 78 L86 28 L138 52 L190 10" fill="none" stroke="#93C5FD" stroke-width="2"/></svg>
          <span style="position:absolute;left:58px;top:38px;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${PRIMARY}"><span style="position:absolute;inset:7px;border-radius:50%;background:#FFFFFF"></span></span>
          <span style="position:absolute;right:52px;top:22px;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${PRIMARY}"><span style="position:absolute;inset:7px;border-radius:50%;background:#FFFFFF"></span></span>
        </div>
      </div>

      <div style="position:absolute;right:34px;bottom:30px;width:220px;height:96px;border-radius:14px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 38px rgba(15,23,42,.08);padding:18px">
        <svg viewBox="0 0 196 58" width="100%" height="58"><path d="M0 42 C22 20 34 54 54 28 C76 4 92 54 112 32 C132 10 144 34 160 18 C178 0 186 24 196 8" fill="none" stroke="${BLUE}" stroke-width="2.4"/><path d="M0 42 C22 20 34 54 54 28 C76 4 92 54 112 32 C132 10 144 34 160 18 C178 0 186 24 196 8 L196 58 L0 58 Z" fill="${BLUE}" opacity=".10"/></svg>
      </div>

      <div style="position:absolute;right:24px;top:104px;width:96px;height:96px;border-radius:50%;background:${PRIMARY}18;box-shadow:0 14px 36px ${PRIMARY}22;display:flex;align-items:center;justify-content:center">
        <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13c0-4 3-7 8-7s8 3 8 7"></path><path d="M5 13h14l-1 5H6z"></path><path d="M8 7l1-3M16 7l-1-3M10 5h4"></path></svg>
      </div>
    </div>
  </div>

  <div data-conclusion="1" style="position:absolute;right:70px;bottom:78px;width:850px;min-height:116px;border-radius:18px;background:#FFFFFF;border:1px solid #E7ECF3;box-shadow:0 18px 42px rgba(15,23,42,.08);display:grid;grid-template-columns:112px 1fr;align-items:center;padding:26px 34px">
    <div style="width:78px;height:78px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="4"></circle><path d="M12 12l7-7"></path><path d="M16 5h3v3"></path></svg>
    </div>
    <div style="border-left:2px solid ${PRIMARY};padding-left:24px">
      <p style="font-family:${INTER};font-size:22px;font-weight:900;color:${FG};margin:0 0 8px">Objetivo do relatório</p>
      <p style="font-family:${INTER};font-size:16px;font-weight:500;color:#163461;line-height:1.55;margin:0">${objetivo}</p>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sCapa');
}

function sVisaoGeral(
  d: ParsedData, prevD: ParsedData | null, idx: number, total: number,
  periodo: string, prevPeriodo: string,
): string {
  const dFat    = deltaInfo(d.faturamento,    prevD?.faturamento    ?? 0);
  const dPed    = deltaInfo(d.pedidos_ativos, prevD?.pedidos_ativos ?? 0);
  const dTicket = deltaInfo(d.ticket,         prevD?.ticket         ?? 0);
  const hasCompare = !!prevD && (prevD.faturamento > 0 || prevD.pedidos_ativos > 0 || prevD.ticket > 0);

  const periodParts = (label: string, fallback: string) => {
    const [month, year] = (label || fallback).split('/');
    return { month: month || fallback, year: year || '' };
  };
  const curPeriod = periodParts(periodo, 'Atual');
  const cmpPeriod = periodParts(prevPeriodo, 'Comparativo');
  const brl2 = (n: number) => n > 0
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

  const icon = (name: 'calendar'|'money'|'cart'|'tag'|'chart'|'bulb', color: string) => {
    const paths: Record<string, string> = {
      calendar: '<rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v5M8 2v5M3 10h18"></path>',
      money:    '<circle cx="12" cy="12" r="8"></circle><path d="M12 7v10M9 9.5c0-1.2 1.2-2 3-2s3 .8 3 2-1.2 2-3 2-3 .8-3 2 1.2 2 3 2 3-.8 3-2"></path>',
      cart:     '<path d="M4 5h2l2 11h9l2-8H7"></path><circle cx="10" cy="20" r="1.5"></circle><circle cx="17" cy="20" r="1.5"></circle>',
      tag:      '<path d="M20 10l-8 8-8-8V4h6l10 10z"></path><circle cx="8" cy="8" r="1.4"></circle>',
      chart:    '<path d="M4 19V9"></path><path d="M10 19V5"></path><path d="M16 19v-8"></path><path d="M22 19H2"></path>',
      bulb:     '<path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z"></path><path d="M4 10H2M22 10h-2M5 4l1.5 1.5M19 4l-1.5 1.5"></path>',
    };
    return `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
  };

  const circle = (name: 'calendar'|'money'|'cart'|'tag'|'chart'|'bulb', color: string, bg: string, size = 76) =>
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon(name, color)}</div>`;

  const metricCard = (label: string, value: string, name: 'money'|'cart'|'tag', color: string, bg: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:22px 24px;display:flex;align-items:center;gap:22px;min-width:0">
      ${circle(name, color, bg, 80)}
      <div style="min-width:0">
        <p style="font-family:${INTER};font-size:18px;font-weight:500;color:#163461;margin:0 0 10px">${label}</p>
        <p style="font-family:${INTER};font-size:34px;font-weight:900;letter-spacing:-0.035em;color:${FG};line-height:1;margin:0;white-space:nowrap">${value}</p>
      </div>
    </div>`;

  const periodLabel = (label: { month: string; year: string }, color: string, bg: string, borderColor: string) =>
    `<div style="width:185px;display:flex;align-items:center;gap:16px;padding-left:22px;border-left:3px solid ${borderColor};box-sizing:border-box;flex-shrink:0">
      ${circle('calendar', color, bg, 72)}
      <div>
        <p style="font-family:${INTER};font-size:25px;font-weight:900;color:${FG};line-height:1;margin:0 0 8px">${label.month}</p>
        ${label.year ? `<p style="font-family:${INTER};font-size:20px;font-weight:500;color:#163461;line-height:1;margin:0">${label.year}</p>` : ''}
      </div>
    </div>`;

  const metricRow = (label: { month: string; year: string }, source: ParsedData, color: string, bg: string, borderColor: string) =>
    `<div style="display:grid;grid-template-columns:185px repeat(3,1fr);gap:18px;align-items:stretch">
      ${periodLabel(label, color, bg, borderColor)}
      ${metricCard('Faturamento', brl2(source.faturamento), 'money', color, bg)}
      ${metricCard('Pedidos', numOrDash(source.pedidos_ativos), 'cart', color, bg)}
      ${metricCard('Ticket médio', brl2(source.ticket), 'tag', color, bg)}
    </div>`;

  const deltaCell = (label: string, dlt: { label: string; up: boolean; hasData: boolean }, name: 'money'|'cart'|'tag'|'chart') => {
    const color = dlt.up ? PRIMARY_TEXT : BLUE;
    const bg = dlt.up ? `${PRIMARY}16` : `${BLUE}12`;
    return `<div style="flex:1;display:flex;align-items:center;gap:20px;padding:0 30px;min-width:0">
      ${circle(name, color, bg, 74)}
      <div>
        <p style="font-family:${INTER};font-size:16px;font-weight:500;color:#163461;margin:0 0 7px">${label}</p>
        <p style="font-family:${INTER};font-size:37px;font-weight:900;letter-spacing:-0.035em;color:${color};line-height:1;margin:0">
          ${dlt.hasData ? dlt.label : '—'} ${dlt.hasData ? (dlt.up ? '↑' : '↓') : ''}
        </p>
      </div>
    </div>`;
  };

  const insightPara1 = hasCompare && dFat.hasData
    ? `${curPeriod.month} ficou ${dFat.up ? 'acima' : 'abaixo'} de ${cmpPeriod.month} em faturamento (${dFat.label}). Pedidos ${dPed.up ? 'subiram' : 'caíram'} ${dPed.hasData ? dPed.label : '—'} e o ticket médio ${dTicket.up ? 'avançou' : 'recuou'} ${dTicket.hasData ? dTicket.label : '—'}.`
    : `Base ativa de ${numOrDash(d.ativos)} clientes gerou ${brlOrDash(d.faturamento)} com ticket médio de ${brlOrDash(d.ticket)}.`;
  const insightPara2 = `O foco para o próximo ciclo deve ser aumentar a frequência de compra, recuperar clientes inativos e converter melhor quem já demonstrou interesse.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:56px 48px 0;display:flex;flex-direction:column">
    <div style="margin-bottom:26px">
      <h1 style="font-family:${INTER};font-size:58px;font-weight:900;letter-spacing:-0.045em;color:${FG};line-height:1.04;margin:0 0 10px">Visão geral do mês</h1>
      <p style="font-family:${INTER};font-size:22px;font-weight:500;color:#163461;line-height:1.35;margin:0">
        ${hasCompare ? `Comparativo de ${curPeriod.month} com ${cmpPeriod.month}${curPeriod.year ? ` de ${curPeriod.year}` : ''}` : `Resultado de ${periodo}`}
      </p>
    </div>

    <div style="display:flex;flex-direction:column;gap:18px;flex:1">
      ${metricRow(curPeriod, d, PRIMARY_TEXT, `${PRIMARY}16`, PRIMARY)}
      ${hasCompare && prevD ? metricRow(cmpPeriod, prevD, BLUE, `${BLUE}12`, BLUE) : ''}

      ${hasCompare ? `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.06);min-height:118px;display:flex;align-items:center;overflow:hidden">
        <div style="width:210px;padding:0 34px;box-sizing:border-box">
          <p style="font-family:${INTER};font-size:22px;font-weight:900;color:${FG};line-height:1.1;margin:0 0 10px">Comparativo</p>
          <p style="font-family:${INTER};font-size:18px;font-weight:500;color:#163461;line-height:1;margin:0">${curPeriod.month} vs. ${cmpPeriod.month}</p>
        </div>
        ${deltaCell('Faturamento', dFat, 'chart')}
        <div style="width:1px;height:78px;background:${BORDER}"></div>
        ${deltaCell('Pedidos', dPed, 'cart')}
        <div style="width:1px;height:78px;background:${BORDER}"></div>
        ${deltaCell('Ticket médio', dTicket, 'tag')}
      </div>` : ''}

      <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.06);display:grid;grid-template-columns:120px 1fr;align-items:center;padding:26px 34px;margin-top:${hasCompare ? '2' : '18'}px">
        ${circle('bulb', PRIMARY_TEXT, `${PRIMARY}16`, 78)}
        <div style="border-left:2px solid ${PRIMARY};padding-left:30px">
          <p style="font-family:${INTER};font-size:23px;font-weight:900;color:${FG};line-height:1;margin:0 0 14px">Leitura principal</p>
          <p style="font-family:${INTER};font-size:17px;font-weight:500;color:#163461;line-height:1.55;margin:0 0 10px">${insightPara1}</p>
          <p style="font-family:${INTER};font-size:17px;font-weight:500;color:#163461;line-height:1.55;margin:0">${insightPara2}</p>
        </div>
      </div>
    </div>
  </div>
  <div style="height:32px;flex-shrink:0"></div>
</div>`;
  return auditSlide(body, 'sVisaoGeral');
}

function sPorDia(d: ParsedData, idx: number, total: number): string {
  const sorted = [...d.por_dia].sort((a, b) => b.pedidos - a.pedidos);
  const top2   = new Set(sorted.slice(0, 2).map(x => x.dia));
  const weakest = sorted[sorted.length - 1];
  const totalPed = d.por_dia.reduce((s, x) => s + x.pedidos, 0);
  const top2pct  = totalPed ? Math.round((sorted[0].pedidos + (sorted[1]?.pedidos ?? 0)) / totalPed * 100) : 0;

  const thesis = sorted[0]
    ? `${sorted[0].dia} e ${sorted[1]?.dia ?? '—'} concentram ${top2pct}% dos pedidos da semana`
    : 'Distribuição de pedidos por dia da semana';

  const bars = d.por_dia.map(x => hbar(x.dia, num(x.pedidos), x.pct, top2.has(x.dia), 10)).join('');

  const body = `
${sectionHeader(thesis, 'Pedidos por dia da semana — identifica picos e vales operacionais')}
<div style="display:grid;grid-template-columns:1fr 320px;gap:32px;flex:1">
  <div style="padding-top:8px">${bars}</div>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${insight('Pico de demanda', `${sorted[0]?.dia ?? '—'} e ${sorted[1]?.dia ?? '—'} são os dias mais fortes. Lance campanhas na quarta ou quinta para aquecer a demanda antes do pico.`, PRIMARY)}
    ${weakest ? insight('Dia mais fraco', `${weakest.dia} tem o menor volume (${num(weakest.pedidos)} pedidos). Um cupom ou oferta exclusiva nesse dia equilibra o fluxo semanal.`, ORANGE) : ''}
  </div>
</div>
${thesisBanner(`Concentre investimento nos dias ${sorted[0]?.dia ?? '—'} e ${sorted[1]?.dia ?? '—'} — eles sozinhos justificam ${top2pct}% do volume.`)}`;
  return auditSlide(wrapSlide(body, idx, total), 'sPorDia');
}

function sRegioes(bairros: Bairro[], idx: number, total: number): string {
  const top3total = bairros.slice(0, 3).reduce((s, b) => s + b.pedidos, 0);
  const grandTotal = bairros.reduce((s, b) => s + b.pedidos, 0);
  const top3pct = grandTotal ? Math.round(top3total / grandTotal * 100) : 0;

  const thesis = bairros[0]
    ? `${bairros[0].bairro} lidera com ${num(bairros[0].pedidos)} pedidos — fortalecer antes de expandir`
    : 'Distribuição de pedidos por bairro';

  const maxPed = bairros[0]?.pedidos ?? 1;
  const tableRows = bairros.map((b, i) => {
    const barW = Math.round(b.pedidos / maxPed * 100);
    return `<tr style="background:${i%2===0?CARD:ROW};border-bottom:1px solid ${BORDER}">
      <td style="padding:9px 14px;font-size:13px;font-family:${INTER};color:${i<2?FG:MUTED};font-weight:${i<2?'600':'400'}">${b.bairro}</td>
      <td style="padding:9px 14px;width:180px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:${BORDER};overflow:hidden">
            <div style="height:100%;background:${i===0?PRIMARY:PRIMARY+'50'};width:${barW}%"></div>
          </div>
          <span style="font-size:12px;font-weight:700;color:${i===0?PRIMARY:MUTED};font-family:${INTER};min-width:32px;text-align:right">${num(b.pedidos)}</span>
        </div>
      </td>
      <td style="padding:9px 14px;text-align:right;font-size:12px;color:${MUTED};font-family:${INTER}">${brl(b.faturamento)}</td>
    </tr>`;
  }).join('');

  const top2 = bairros.slice(0, 2);
  const mid  = bairros.slice(2, 5);

  const body = `
${sectionHeader(thesis, `${bairros.length} bairros · top 3 concentram ${top3pct}% dos pedidos — CRM`)}
<div style="display:grid;grid-template-columns:1fr 300px;gap:28px;flex:1">
  <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};height:fit-content">
    <thead><tr style="background:${CARD};border-bottom:1px solid ${BORDER}">
      <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Bairro</th>
      <th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Pedidos</th>
      <th style="padding:9px 14px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Faturamento</th>
    </tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${top2.length ? insight('Fortalecer', `${top2.map(b=>b.bairro).join(' e ')} — demanda consolidada. Segmente Meta para esses bairros e eleve o ticket com combo exclusivo.`, PRIMARY) : ''}
    ${mid.length ? insight('Estimular', `${mid.map(b=>b.bairro).join(', ')} — volume crescente. Lance campanha de reconhecimento para construir presença antes de escalar.`, BLUE) : ''}
  </div>
</div>
${thesisBanner(`Os 3 bairros mais fortes concentram ${top3pct}% dos pedidos — toda campanha local deve começar por eles.`)}`;
  return auditSlide(wrapSlide(body, idx, total), 'sRegioes');
}

function sBase(d: ParsedData, idx: number, total: number): string {
  const tot = d.ativos + d.inativos + d.potenciais;
  const pct1 = (n: number) => tot ? (n / tot * 100).toFixed(1).replace('.', ',') : '0,0';
  const pA = pct1(d.ativos), pI = pct1(d.inativos), pP = pct1(d.potenciais);
  const pIraw = tot ? d.inativos / tot * 100 : 0;

  const totalAtivos = d.uma_compra + d.recorrentes;
  const pRec = totalAtivos ? Math.round(d.recorrentes / totalAtivos * 100) : 0;
  const pUma = totalAtivos ? Math.round(d.uma_compra  / totalAtivos * 100) : 0;
  const hasDistrib = d.uma_compra > 0 || d.recorrentes > 0;

  // ── Custom donut with pct labels inside each segment + center icon ────────
  const DS = 312;
  const VB = DS + 56; // extra canvas margin so outside-ring % labels on thin slices don't clip
  const dcx = VB / 2, dcy = VB / 2;
  const outerR = 136, innerR = 74, midR = (outerR + innerR) / 2;

  const ICO_USERS = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  const ICO_USER_X = '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/>';
  const ICO_USER_STAR = '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polygon points="19 7.5 20.1 9.9 22.7 10.2 20.8 12 21.3 14.5 19 13.2 16.7 14.5 17.2 12 15.3 10.2 17.9 9.9"/>';

  const donutWrap = (() => {
    if (!tot) return '';
    const slices = [
      { value: d.ativos,     color: PRIMARY,    textColor: '#0a4d00' },
      { value: d.inativos,   color: '#f87171',  textColor: '#ffffff' },
      { value: d.potenciais, color: '#4ade80',  textColor: '#14532d' },
    ];
    let angle = 0;
    const paths: string[] = [];
    const labels: string[] = [];
    for (const sl of slices) {
      if (!sl.value) continue;
      const sliceAngle = (sl.value / tot) * 360;
      paths.push(`<path d="${donutPath(dcx, dcy, outerR, innerR, angle, angle + sliceAngle)}" fill="${sl.color}"/>`);
      const pct = sl.value / tot * 100;
      // Small slices can't fit a readable label inside the ring — place those just outside instead.
      const rad = ((angle + sliceAngle / 2) - 90) * Math.PI / 180;
      const labelR = pct >= 8 ? midR : outerR + 22;
      const lx = dcx + labelR * Math.cos(rad);
      const ly = dcy + labelR * Math.sin(rad);
      const fill = pct >= 8 ? sl.textColor : sl.color;
      labels.push(`<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="800" font-family="${INTER}" fill="${fill}">${pct.toFixed(1).replace('.', ',')}%</text>`);
      angle += sliceAngle;
    }
    return `<div style="position:relative;width:${VB}px;height:${VB}px;flex-shrink:0">
      <svg viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">
        ${paths.join('\n        ')}
        <circle cx="${dcx}" cy="${dcy}" r="${innerR - 6}" fill="${CARD}"/>
        ${labels.join('\n        ')}
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
        <div style="width:${(innerR - 6) * 2 - 16}px;height:${(innerR - 6) * 2 - 16}px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICO_USERS}</svg>
        </div>
      </div>
    </div>`;
  })();

  // ── Top stat cards ─────────────────────────────────────────────────────────
  const topCard = (label: string, value: string, icoPath: string, bg: string, tc: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:18px 22px;display:flex;align-items:center;gap:16px;flex:1;min-width:0">
      <div style="width:48px;height:48px;border-radius:50%;background:${bg}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${tc}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icoPath}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};margin:0 0 4px">${label}</p>
        <p style="font-family:${INTER};font-size:30px;font-weight:900;letter-spacing:-0.03em;color:${tc};line-height:1;margin:0">${value}</p>
      </div>
    </div>`;

  // ── Legend blocks (dot + label, then big value + pct below) ───────────────
  const legendRows = [
    { label: 'Clientes ativos',       count: d.ativos,     pct: pA, dotColor: PRIMARY,   numColor: PRIMARY_TEXT },
    { label: 'Clientes inativos',     count: d.inativos,   pct: pI, dotColor: '#f87171', numColor: '#dc2626'    },
    { label: 'Clientes em potencial', count: d.potenciais, pct: pP, dotColor: '#4ade80', numColor: '#16a34a'    },
  ].map(l => `
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:11px;height:11px;border-radius:50%;background:${l.dotColor};flex-shrink:0;display:inline-block"></span>
        <span style="font-size:15px;font-weight:700;color:${FG};font-family:${INTER}">${l.label}</span>
      </div>
      <div style="padding-left:21px;display:flex;align-items:baseline;gap:8px">
        <span style="font-family:${INTER};font-size:26px;font-weight:900;letter-spacing:-0.02em;color:${FG};line-height:1">${numOrDash(l.count)}</span>
        <span style="font-size:14px;font-weight:600;color:${l.numColor};font-family:${INTER}">(${l.pct}%)</span>
      </div>
    </div>`).join('');

  // ── Sub-metrics ────────────────────────────────────────────────────────────
  const ICO_CART   = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_USER1  = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
  const ICO_USERS2 = ICO_USERS;

  const subMetric = (ico: string, value: string, label: string) =>
    `<div style="display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;flex:1">
      <div style="width:48px;height:48px;border-radius:50%;background:${PRIMARY}18;display:flex;align-items:center;justify-content:center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <p style="font-family:${INTER};font-size:28px;font-weight:900;letter-spacing:-0.02em;color:${PRIMARY_TEXT};line-height:1;margin:0">${value}</p>
      <p style="font-size:13px;font-weight:500;color:#163461;font-family:${INTER};margin:0;line-height:1.35">${label}</p>
    </div>`;

  // ── Segment cards ──────────────────────────────────────────────────────────
  const ICO_BAG    = '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>';
  const ICO_REPEAT = '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
  const ICO_VIP    = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>';

  const segCard = (ico: string, title: string, sub: string, ac: string, tc: string) =>
    `<div style="background:${ac}0D;border:1px solid ${ac}22;border-radius:14px;padding:16px 18px;display:flex;align-items:flex-start;gap:12px;flex:1">
      <div style="width:38px;height:38px;border-radius:50%;background:${ac}1C;flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-top:1px">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${tc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <div>
        <p style="font-size:14px;font-weight:700;color:${tc};font-family:${INTER};margin:0 0 4px">${title}</p>
        <p style="font-size:12px;color:#163461;font-family:${INTER};margin:0;line-height:1.4">${sub}</p>
      </div>
    </div>`;

  // ── Insight texts ──────────────────────────────────────────────────────────
  const leftQuote = pIraw > 50
    ? `A base inativa representa o maior ativo e a principal alavanca de crescimento por reativação.`
    : `Base ativa sólida. Estratégia: aumentar frequência dos ${numOrDash(d.recorrentes)} clientes fiéis.`;

  const rightConclusion = hasDistrib
    ? (pUma > 50
        ? `A base ativa já mostra potencial real de recorrência, mas o grupo com apenas 1 pedido precisa ser trabalhado rápido para não virar inativo.`
        : `Recorrência de ${pRec}% na base ativa. Foco em aumentar ticket e frequência dos clientes já fiéis.`)
    : `Base total de ${numOrDash(tot)} cadastros — inativos recentes são o maior ativo para reativação imediata.`;

  // ── Slide body ─────────────────────────────────────────────────────────────
  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:56px 48px 0;display:flex;flex-direction:column">

    <div style="flex-shrink:0;display:flex;align-items:flex-start;gap:32px;margin-bottom:24px">
      <div style="flex:0 0 380px">
        <h1 style="font-family:${INTER};font-size:42px;font-weight:900;color:${FG};line-height:1.08;margin:0 0 10px;letter-spacing:-0.03em">Base de clientes e<br>clientes ativos</h1>
        <p style="font-size:15px;font-weight:500;color:#163461;font-family:${INTER};margin:0;line-height:1.4">Onde está a maior oportunidade de relacionamento</p>
      </div>
      <div style="flex:1;display:flex;gap:14px;align-items:stretch">
        ${topCard('Clientes ativos',       numOrDash(d.ativos),     ICO_USERS,    PRIMARY,   PRIMARY_TEXT)}
        ${topCard('Clientes inativos',     numOrDash(d.inativos),   ICO_USER_X,   '#f87171', '#dc2626'   )}
        ${topCard('Clientes em potencial', numOrDash(d.potenciais), ICO_USER_STAR,'#4ade80', '#16a34a'   )}
      </div>
    </div>

    <div style="flex:1;display:grid;grid-template-columns:1fr 1.15fr;gap:24px;min-height:0;padding-bottom:32px">

      <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:30px;display:flex;flex-direction:column;gap:24px">
        <div style="flex:1;display:flex;align-items:center;justify-content:center;gap:40px">
          ${donutWrap}
          <div style="display:flex;flex-direction:column;gap:22px;min-width:0">${legendRows}</div>
        </div>
        <div style="border-left:3px solid ${PRIMARY};padding-left:16px">
          <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.55;margin:0">${leftQuote}</p>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px">

        <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:22px 26px">
          <p style="font-size:16px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 18px">Dentro da base ativa</p>
          <div style="display:flex;align-items:flex-start;gap:4px">
            ${subMetric(ICO_CART,   numOrDash(d.pedidos_ativos),                              'pedidos<br>registrados'  )}
            <div style="width:1px;background:${BORDER};align-self:stretch;margin:0 8px"></div>
            ${subMetric(ICO_USER1,  hasDistrib ? numOrDash(d.uma_compra)  : '—', 'Clientes com<br>1 pedido'    )}
            <div style="width:1px;background:${BORDER};align-self:stretch;margin:0 8px"></div>
            ${subMetric(ICO_USERS2, hasDistrib ? numOrDash(d.recorrentes) : '—', 'Clientes com mais<br>de 1 pedido'  )}
          </div>
        </div>

        <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:22px 26px">
          <p style="font-size:16px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 16px">Como segmentar os ativos</p>
          <div style="display:flex;gap:12px">
            ${segCard(ICO_BAG,    'Primeira compra',   'incentivar segunda compra',     BLUE,          '#1d4ed8'    )}
            ${segCard(ICO_REPEAT, 'Recorrentes',       'estimular combos e favoritos',  PRIMARY_TEXT,  PRIMARY_TEXT)}
            ${segCard(ICO_VIP,    'Muito recorrentes', 'comunicação VIP e fidelidade',  '#7c3aed',     '#7c3aed'    )}
          </div>
        </div>

        <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);display:flex;align-items:flex-start;gap:16px;padding:20px 26px;margin-top:auto">
          <div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div>
          <div style="border-left:2px solid ${PRIMARY};padding-left:18px">
            <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.6;margin:0">${rightConclusion}</p>
          </div>
        </div>

      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;

  return auditSlide(body, 'sBase');
}

function sInativos(d: ParsedData, idx: number, total: number): string {
  const max    = Math.max(...d.inativos_faixas.map(f => f.count), 1);
  const maior  = d.inativos_faixas.reduce((a, b) => a.count > b.count ? a : b, { label: '—', count: 0 });
  const porta  = d.produtos.find(p => p.qtd > 0);

  // Prioritize near-term inactive (recoverable) vs long-term (harder to win back)
  const shortTerm = d.inativos_faixas.filter(f => f.label.startsWith('30') || f.label.startsWith('60'));
  const shortCount = shortTerm.reduce((s, f) => s + f.count, 0);

  const thesis = shortCount > 0
    ? `${num(shortCount)} inativos recentes — eles têm memória da marca e são os mais fáceis de reativar`
    : `A base inativa é o maior ativo escondido do mês`;

  const bars = d.inativos_faixas.map(f =>
    hbar(f.label, num(f.count), f.count / max * 100, f.count === maior.count, 10),
  ).join('');

  const body = `
${sectionHeader(thesis, `${numOrDash(d.inativos)} inativos · ${numOrDash(d.potenciais)} potenciais — distribuição por tempo de ausência`)}
<div style="display:grid;grid-template-columns:1fr 340px;gap:32px;flex:1">
  <div>
    <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 14px">Inatividade por Faixa de Tempo</p>
    ${bars}
    ${d.potenciais > 0 ? `<div style="margin-top:14px;padding:12px 14px;background:${BLUE}0F;border:1px solid ${BLUE}30">
      <p style="font-size:10px;font-weight:700;color:${BLUE};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 4px">Em Potencial — nunca compraram</p>
      <p style="font-size:28px;font-family:${BEBAS};color:${FG};margin:0;line-height:1">${num(d.potenciais)} <span style="font-size:12px;color:${MUTED};font-family:${INTER};font-weight:400">clientes cadastrados sem pedido</span></p>
    </div>` : ''}
  </div>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${insight('Prioridade de reativação', `Foco em ${maior.label} — ${num(maior.count)} clientes. Ainda têm memória do produto. Uma oferta personalizada tem 25–40% de taxa de retorno.`, PRIMARY)}
    ${porta ? `<div style="border:1px solid ${BORDER};background:${CARD};padding:14px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 6px">Porta de Entrada</p>
      <p style="font-family:${BEBAS};font-size:22px;color:${PRIMARY};margin:0 0 4px;line-height:1">${porta.nome}</p>
      <p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0">${num(porta.qtd)} pedidos — produto âncora para reativação</p>
    </div>` : ''}
    <div style="border:1px solid ${BORDER};background:${CARD};padding:14px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 6px">Mensagem Sugerida</p>
      <p style="font-size:12px;color:${FG};font-family:${INTER};line-height:1.6;margin:0;font-style:italic">"Faz tempo que você não aparece! Use o cupom <strong style="color:${PRIMARY};font-style:normal">VOLTEI</strong> e ganhe desconto no próximo pedido. Válido por 7 dias."</p>
    </div>
  </div>
</div>
${thesisBanner(`Reativar ${num(shortCount || d.inativos)} inativos com um cupom personalizado pode gerar ${brlOrDash(d.ticket * Math.round((shortCount || d.inativos) * 0.25))} em receita incremental no próximo mês.`, 'insight')}`;
  return auditSlide(wrapSlide(body, idx, total), 'sInativos');
}

function sProdutos(d: ParsedData, idx: number, total: number): string {
  const allZeroQty = d.produtos.every(p => p.qtd === 0);

  if (allZeroQty) {
    const catalogCards = d.produtos.slice(0, 8).map(p =>
      `<div style="border:1px solid ${BORDER};background:${CARD};padding:12px 14px">
        <p style="font-size:13px;font-weight:600;color:${FG};font-family:${INTER};margin:0 0 4px">${p.nome}</p>
        ${p.total > 0 ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0">${brl(p.total)}</p>` : ''}
      </div>`,
    ).join('');
    const body = `
${sectionHeader('Catálogo identificado — volume de vendas não capturado neste arquivo', 'Produtos cadastrados')}
<div style="border-left:3px solid ${ORANGE};background:${ORANGE}0A;padding:10px 16px;margin-bottom:18px">
  <p style="font-size:12px;color:${ORANGE};font-family:${INTER};margin:0">Arquivo de produtos sem coluna de quantidade vendida. Para exibir o ranking, inclua uma coluna "qtd" ou "qtd_vendida".</p>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${catalogCards}</div>
${thesisBanner('Sem dados de volume, não é possível identificar o produto âncora. Integre o relatório de vendas para descobrir.', 'neutral')}`;
    return auditSlide(wrapSlide(body, idx, total), 'sProdutos');
  }

  const max  = Math.max(...d.produtos.map(p => p.qtd), 1);
  const topProd = d.produtos[0];
  const topPct  = d.pedidos_ativos > 0 ? Math.round(topProd.qtd / d.pedidos_ativos * 100) : 0;
  const thesis  = topProd
    ? `"${topProd.nome}" responde por ${topPct}% dos pedidos — é o produto âncora do negócio`
    : 'Ranking de produtos por volume de pedidos';

  const bars = d.produtos.slice(0, 8).map((p, i) =>
    hbar(p.nome, `${num(p.qtd)} ped${p.total > 0 ? ` · ${brl(p.total)}` : ''}`, p.qtd / max * 100, i < 3, 12),
  ).join('');

  // Combo suggestions from top 4
  const top4 = d.produtos.slice(0, 4);
  const combos = [
    top4[0] && top4[1] ? `${top4[0].nome} + ${top4[1].nome}` : null,
    top4[0] && top4[2] ? `${top4[0].nome} + ${top4[2].nome}` : null,
    top4[2] && top4[3] ? `${top4[2].nome} + ${top4[3].nome}` : null,
  ].filter(Boolean) as string[];

  const body = `
${sectionHeader(thesis, 'Ranking por volume de pedidos no período')}
<div style="display:grid;grid-template-columns:1fr 320px;gap:32px;flex:1">
  <div style="padding-top:8px">${bars}</div>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${topProd ? `${kpiHero('Produto #1', topProd.nome.length > 16 ? topProd.nome.slice(0,16)+'…' : topProd.nome, `${num(topProd.qtd)} pedidos · ${brlOrDash(topProd.total)}`, ORANGE)}` : ''}
    ${combos.length ? `<div>
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:10px 0 8px">Combos Sugeridos</p>
      ${combos.map(c => `<div style="border:1px solid ${BORDER};background:${CARD};padding:10px 12px;margin-bottom:6px">
        <p style="font-size:11px;font-weight:700;color:${ORANGE};font-family:${INTER};margin:0 0 2px;text-transform:uppercase;letter-spacing:.08em">Combo</p>
        <p style="font-size:12px;font-weight:600;color:${FG};font-family:${INTER};margin:0">${c}</p>
      </div>`).join('')}
    </div>` : ''}
  </div>
</div>
${thesisBanner(`Use "${topProd?.nome ?? '—'}" como âncora em campanhas de upsell — oferecer um segundo item junto eleva o ticket sem aumentar o esforço de aquisição.`)}`;
  return auditSlide(wrapSlide(body, idx, total), 'sProdutos');
}

// Cleans bracket-tagged ad-platform campaign names (e.g. "[ON] [WHATS] [ANIVERSÁRIO] [MAIO]")
// into a readable label. Drops agency/noise tags; keeps the rest in original order.
const CAMPAIGN_NAME_MAP: Record<string, string> = {
  WHATS: 'WhatsApp', WHATSAPP: 'WhatsApp', IFOOD: 'iFood',
};
const CAMPAIGN_NOISE_TAGS = new Set(['ON', 'ONMID', 'AD', 'ADS']);
const MONTH_NAMES_LC = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function cleanCampaignTags(raw: string): string[] {
  const matches = [...raw.matchAll(/\[([^\]]+)\]/g)].map(m => m[1].trim());
  const tags = matches.length > 0 ? matches : [raw];
  return tags
    .filter(t => t && !CAMPAIGN_NOISE_TAGS.has(t.toUpperCase()))
    .map(t => CAMPAIGN_NAME_MAP[t.toUpperCase()] ?? t
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/(^|\s)\S/g, c => c.toUpperCase()));
}

function cleanCampaignName(raw: string): string {
  return cleanCampaignTags(raw).join(' ');
}

function cleanCampaignHighlightTitle(raw: string): string {
  let tags = cleanCampaignTags(raw);
  if (tags.length > 1 && MONTH_NAMES_LC.includes(tags[tags.length - 1].toLowerCase())) {
    tags = tags.slice(0, -1);
  }
  if (tags.length > 2 && ['Vendas', 'Reconhecimento', 'Alcance'].includes(tags[0])) {
    tags = tags.slice(1);
  }
  return tags.join(' ') || raw;
}

function sMetaAdsResumo(meta: MetaAdsFull, idx: number, total: number): string {
  const totalConversas = meta.campanhas.reduce((s, c) => s + c.metricas.conversas, 0);
  const totalCompras   = meta.campanhas.reduce((s, c) => s + c.metricas.compras, 0);
  const brlC = (n: number) => n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

  // ── Top KPI card (icon circle + label + big number) ───────────────────────
  const bigKpi = (label: string, value: string, ico: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:18px 22px;display:flex;align-items:center;gap:16px;flex:1;min-width:0">
      <div style="width:48px;height:48px;border-radius:50%;background:${PRIMARY}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};margin:0 0 4px">${label}</p>
        <p style="font-family:${INTER};font-size:28px;font-weight:900;letter-spacing:-0.025em;color:${FG};line-height:1;margin:0;white-space:nowrap">${value}</p>
      </div>
    </div>`;

  const ICO_MONEY  = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_EYE    = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_USERS  = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  const ICO_CURSOR = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_CHAT   = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  const ICO_CART   = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_LIST   = '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';

  const row1 = [
    bigKpi('Investimento',    brlC(meta.investimento),       ICO_MONEY ),
    bigKpi('Impressões',      numOrDash(meta.impressoes),    ICO_EYE   ),
    bigKpi('Alcance somado',  numOrDash(meta.alcance),       ICO_USERS ),
    bigKpi('Cliques no link', numOrDash(meta.cliques),       ICO_CURSOR),
  ];

  // ── Campaign bullet list (cleaned names) ───────────────────────────────────
  const bulletCols = Math.min(4, Math.max(2, Math.ceil(meta.campanhas.length / 2)));
  const bullets = meta.campanhas.map(c =>
    `<div style="display:flex;align-items:flex-start;gap:8px">
      <div style="width:6px;height:6px;border-radius:50%;background:${BLUE};flex-shrink:0;margin-top:7px"></div>
      <span style="font-size:13px;font-weight:500;color:${FG};font-family:${INTER};line-height:1.4">${cleanCampaignName(c.nome)}</span>
    </div>`,
  ).join('');

  // ── Highlight cards: best conversation campaign + best sales campaign ─────
  const chatCampaign  = [...meta.campanhas].filter(c => c.metricas.conversas > 0).sort((a, b) => b.metricas.conversas - a.metricas.conversas)[0];
  const salesCampaign = [...meta.campanhas].filter(c => c.metricas.compras > 0 && c !== chatCampaign).sort((a, b) => b.metricas.valor_compras - a.metricas.valor_compras)[0];

  const highlightMetric = (label: string, value: string) =>
    `<div style="flex:1;min-width:0">
      <p style="font-size:11px;font-weight:600;color:${MUTED};font-family:${INTER};margin:0 0 4px;line-height:1.3">${label}</p>
      <p style="font-family:${INTER};font-size:18px;font-weight:800;color:${FG};margin:0;white-space:nowrap">${value}</p>
    </div>`;

  const highlightDivider = `<div style="width:1px;background:${BORDER};align-self:stretch"></div>`;

  const highlightCard = (ico: string, filled: boolean, title: string, metrics: string[], insight: string) =>
    `<div style="flex:1;background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:22px 26px;display:flex;flex-direction:column;gap:16px;min-width:0">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:46px;height:46px;border-radius:50%;background:${PRIMARY}1A;flex-shrink:0;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="${filled ? PRIMARY_TEXT : 'none'}" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
        </div>
        <div style="border-left:2px solid ${PRIMARY};padding-left:14px">
          <p style="font-size:17px;font-weight:800;color:${FG};font-family:${INTER};margin:0">${title}</p>
        </div>
      </div>
      <div style="display:flex;align-items:flex-start;gap:14px">
        ${metrics.map((m, i) => i === 0 ? m : highlightDivider + m).join('')}
      </div>
      <p style="font-size:13px;font-weight:500;color:#163461;font-family:${INTER};margin:0;display:flex;align-items:flex-start;gap:8px">
        <span style="color:${PRIMARY_TEXT};flex-shrink:0">→</span> ${insight}
      </p>
    </div>`;

  const ICO_WHATSAPP_PATH = '<path d="M3 21l1.65-4.95A8.5 8.5 0 1 1 8.05 19.4z"></path><path d="M8.5 9.5a.5.5 0 0 1 1 0v1a.5.5 0 0 1-1 0z"></path>';

  let highlightSection = '';
  if (chatCampaign || salesCampaign) {
    const cards: string[] = [];
    if (chatCampaign) {
      const m = chatCampaign.metricas;
      const custoConversa = m.conversas > 0 ? m.investimento / m.conversas : 0;
      cards.push(highlightCard(
        ICO_WHATSAPP_PATH,
        true,
        cleanCampaignHighlightTitle(chatCampaign.nome),
        [
          highlightMetric('Investimento', brlC(m.investimento)),
          highlightMetric('Conversas iniciadas', num(Math.round(m.conversas))),
          highlightMetric('Custo por conversa', brlC(custoConversa)),
          highlightMetric('Cliques no link', numOrDash(m.cliques)),
          highlightMetric('Frequência', m.frequencia.toFixed(2).replace('.', ',')),
        ],
        `${num(Math.round(m.conversas))} conversas iniciadas a um custo de ${brlC(custoConversa)} cada, com frequência de ${m.frequencia.toFixed(2).replace('.', ',')}.`,
      ));
    }
    if (salesCampaign) {
      const m = salesCampaign.metricas;
      const custoCompra = m.compras > 0 ? m.investimento / m.compras : 0;
      cards.push(highlightCard(
        ICO_CART,
        false,
        cleanCampaignHighlightTitle(salesCampaign.nome),
        [
          highlightMetric('Investimento', brlC(m.investimento)),
          highlightMetric('Compras registradas', num(Math.round(m.compras))),
          highlightMetric('Custo por compra', brlC(custoCompra)),
          highlightMetric('Valor de compra', brlC(m.valor_compras)),
          highlightMetric('ROAS', m.purchase_roas.toFixed(2).replace('.', ',')),
        ],
        `ROAS de ${m.purchase_roas.toFixed(2).replace('.', ',')} — ${m.purchase_roas >= 3 ? 'boa relação entre investimento e retorno' : 'abaixo do ideal, vale revisar criativos e público'}.`,
      ));
    }
    highlightSection = `<div style="display:flex;gap:16px">${cards.join('')}</div>`;
  }

  // ── Final recommendation ───────────────────────────────────────────────────
  const recommendation = totalConversas > 0 && totalCompras > 0
    ? 'separar campanhas por objetivo — reconhecimento, venda direta, WhatsApp, reativação e remarketing.'
    : totalCompras > 0
    ? `manter o foco em campanhas de conversão — ROAS é a métrica central para avaliar o retorno de cada uma.`
    : totalConversas > 0
    ? `priorizar campanhas de conversa — custo por mensagem é a métrica principal para relacionamento via WhatsApp.`
    : `${brlOrDash(meta.investimento)} investidos em ${meta.campanhas.length} campanha${meta.campanhas.length !== 1 ? 's' : ''} com alcance de ${numOrDash(meta.alcance)} pessoas únicas.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:56px 48px 0;display:flex;flex-direction:column;gap:16px">

    <div style="flex-shrink:0">
      <h1 style="font-family:${INTER};font-size:46px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">Resumo de tráfego pago</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Visibilidade, cliques e destaques das campanhas do período</p>
    </div>

    <div style="display:flex;gap:16px;flex-shrink:0">
      ${row1.join('')}
    </div>

    <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:18px 26px;display:flex;align-items:center;gap:24px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:14px;flex-shrink:0">
        <div style="width:44px;height:44px;border-radius:50%;background:${BLUE}10;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${BLUE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICO_LIST}</svg>
        </div>
        <div>
          <p style="font-size:15px;font-weight:800;color:${FG};font-family:${INTER};margin:0">Campanhas<br>analisadas</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${bulletCols},1fr);gap:8px 28px;flex:1;min-width:0">
        ${bullets}
      </div>
    </div>

    ${highlightSection}

    <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 10px 26px rgba(15,23,42,.06);display:flex;align-items:flex-start;gap:16px;padding:20px 26px">
      <div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_TARGET}</svg>
      </div>
      <div style="border-left:2px solid ${PRIMARY};padding-left:18px">
        <p style="font-size:15px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px">Recomendação</p>
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.5;margin:0">${recommendation}</p>
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sMetaAdsResumo');
}

// ── Instagram Insights ────────────────────────────────────────────────────────

function sInstagram(ig: InstagramData, idx: number, total: number): string {
  void idx; void total; // page counter intentionally suppressed on this slide — see header below

  const engRate = ig.reach > 0 ? (ig.accounts_engaged / ig.reach) * 100 : 0;

  const ICO_USERS_IG  = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  const ICO_SIGNAL    = '<circle cx="12" cy="12" r="2"/><path d="M16.24 16.24a6 6 0 0 0 0-8.49"/><path d="M7.76 7.76a6 6 0 0 0 0 8.49"/><path d="M19.07 19.07a10 10 0 0 0 0-14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/>';
  const ICO_EYE_IG    = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_USER_IG   = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
  const ICO_CURSOR_IG = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_HEART_IG  = '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>';
  const ICO_TREND     = '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';

  const igGlyph = (size: number, color: string) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="6"/><circle cx="12" cy="12" r="4.5"/><circle cx="17.2" cy="6.8" r="1.1" fill="${color}" stroke="none"/>
    </svg>`;

  const metricCard = (label: string, enLabel: string, value: string, icoPath: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:20px 22px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:46px;height:46px;border-radius:50%;background:${PRIMARY}1A;flex-shrink:0;display:flex;align-items:center;justify-content:center">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icoPath}</svg>
        </div>
        <p style="font-size:15px;font-weight:700;color:${FG};font-family:${INTER};margin:0">${label} <span style="font-weight:400;color:${MUTED};font-size:13px">(${enLabel})</span></p>
      </div>
      <div>
        <p style="font-family:${INTER};font-size:32px;font-weight:900;letter-spacing:-0.02em;color:${FG};margin:0 0 8px">${value}</p>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:16px;height:2px;background:${PRIMARY};display:inline-block"></span>
          <span style="font-size:12px;color:${MUTED};font-family:${INTER}">mês anterior</span>
        </div>
      </div>
    </div>`;

  const insightText = ig.accounts_engaged > 0
    ? `${numOrDash(ig.accounts_engaged)} contas engajaram com o perfil @${ig.username} (${engRate.toFixed(1)}% do alcance). Audiência orgânica aquecida converte melhor em campanhas pagas.`
    : `Perfil @${ig.username} alcançou ${numOrDash(ig.reach)} pessoas de forma orgânica no período — base pronta para ser convertida via anúncio.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">

  <!-- Decorative composition — top right -->
  <div style="position:absolute;right:-40px;bottom:-60px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}1A 0%,transparent 70%);pointer-events:none"></div>
  <svg style="position:absolute;right:0;top:0;width:540px;height:520px;pointer-events:none" viewBox="0 0 540 520" fill="none">
    <path d="M540 40 C 430 90, 460 220, 360 260 C 280 292, 300 400, 200 460" stroke="#D6DEE8" stroke-width="1.4" opacity=".6"/>
    <path d="M540 110 C 450 150, 470 250, 390 300" stroke="#D6DEE8" stroke-width="1.4" opacity=".5"/>
    ${Array.from({ length: 18 }).map((_, i) => `<circle cx="${440 + (i % 6) * 14}" cy="${430 + Math.floor(i / 6) * 14}" r="1.6" fill="${BORDER}"/>`).join('')}
  </svg>
  <div style="position:absolute;right:160px;top:64px;width:190px;height:108px;background:${CARD};border:1px solid #E7ECF3;border-radius:14px;box-shadow:0 14px 30px rgba(15,23,42,.08);padding:14px">
    <svg viewBox="0 0 160 70" width="100%" height="100%">
      <polyline points="0,58 26,40 52,46 78,18 104,26 130,6 158,12" fill="none" stroke="${PRIMARY}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="158" cy="12" r="4" fill="${PRIMARY}"/>
    </svg>
  </div>
  <div style="position:absolute;right:36px;top:50px;width:128px;height:128px;border-radius:50%;border:1px solid ${PRIMARY}30;display:flex;align-items:center;justify-content:center">
    <div style="width:92px;height:92px;border-radius:50%;border:1px solid ${PRIMARY}45;display:flex;align-items:center;justify-content:center">
      <div style="width:64px;height:64px;border-radius:50%;background:${PRIMARY}1A;box-shadow:0 10px 28px ${PRIMARY}33;display:flex;align-items:center;justify-content:center">
        ${igGlyph(34, PRIMARY_TEXT)}
      </div>
    </div>
  </div>

  <!-- Header: logo only — pagination intentionally suppressed on this slide -->
  <div style="position:relative;z-index:1;padding:34px 48px 0;flex-shrink:0">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:${INTER};font-size:30px;font-weight:900;letter-spacing:-0.05em;color:${FG};line-height:1">onmid</span>
      <span style="width:38px;height:20px;border-radius:999px;background:${PRIMARY};display:inline-flex;align-items:center;justify-content:flex-end;padding-right:4px;box-sizing:border-box">
        <span style="width:12px;height:12px;border-radius:50%;background:#FFFFFF;display:block"></span>
      </span>
    </div>
  </div>

  <div style="position:relative;z-index:1;flex:1;padding:30px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:30px">
      <h1 style="font-family:${INTER};font-size:60px;font-weight:900;color:${FG};line-height:1;margin:0 0 12px;letter-spacing:-0.03em">Instagram</h1>
      <p style="font-size:18px;font-weight:500;color:#163461;font-family:${INTER};margin:0 0 10px">Período: mês anterior</p>
      <span style="width:46px;height:3px;background:${PRIMARY};display:block"></span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:20px">
      ${metricCard('Seguidores', 'followers', numOrDash(ig.followers), ICO_USERS_IG)}
      ${metricCard('Alcance', 'reach', numOrDash(ig.reach), ICO_SIGNAL)}
      ${metricCard('Impressões', 'impressions', numOrDash(ig.impressions), ICO_EYE_IG)}
      ${metricCard('Visitas ao perfil', 'profile_views', numOrDash(ig.profile_views), ICO_USER_IG)}
      ${metricCard('Cliques no site', 'website_clicks', numOrDash(ig.website_clicks), ICO_CURSOR_IG)}
      ${metricCard('Contas engajadas', 'accounts_engaged', numOrDash(ig.accounts_engaged), ICO_HEART_IG)}
    </div>

    <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);display:flex;align-items:flex-start;gap:16px;padding:22px 28px;margin-top:auto;margin-bottom:32px">
      <div style="width:42px;height:42px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_TREND}</svg>
      </div>
      <div style="border-left:2px solid ${PRIMARY};padding-left:18px">
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.55;margin:0">${insightText}</p>
      </div>
    </div>
  </div>
</div>`;

  return auditSlide(body, 'sInstagram');
}

// ── Instagram — content panorama (last posts of the period) ──────────────────

function bestInstagramPost(posts: InstagramPost[]): InstagramPost | null {
  if (!posts.length) return null;
  const hasReach = posts.some(p => p.reach > 0);
  return [...posts].sort((a, b) => hasReach
    ? b.reach - a.reach
    : (b.likes + b.comments) - (a.likes + a.comments))[0];
}

function formatPostDate(ts: string): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '—';
  const WD = ['dom','seg','ter','qua','qui','sex','sáb'];
  return `${WD[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const ICO_HEART    = '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>';
const ICO_COMMENT  = '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>';
const ICO_PLAY      = '<polygon points="5 3 19 12 5 21 5 3"/>';
const ICO_LAYERS    = '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>';

function sInstagramPosts(posts: InstagramPost[], idx: number, total: number): string {
  const best = bestInstagramPost(posts);

  const mediaBadge = (mediaType: string) => {
    if (mediaType === 'REELS' || mediaType === 'VIDEO') return `<div style="position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="white">${ICO_PLAY}</svg></div>`;
    if (mediaType === 'CAROUSEL_ALBUM') return `<div style="position:absolute;top:8px;right:8px;width:26px;height:26px;border-radius:50%;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`;
    return '';
  };

  const postCard = (p: InstagramPost) => {
    const isBest = best && p.id === best.id;
    const thumb = p.thumbnailUrl
      ? `<img src="${p.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover" />`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#E1306C22,#F7717122);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E1306C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`;
    return `<div style="background:${CARD};border:${isBest ? `2px solid ${PRIMARY}` : '1px solid #E7ECF3'};border-radius:14px;box-shadow:0 10px 24px rgba(15,23,42,.07);overflow:hidden;display:flex;flex-direction:column">
      <div style="position:relative;width:100%;aspect-ratio:1/1;background:${ROW}">
        ${thumb}
        ${mediaBadge(p.mediaType)}
        ${isBest ? `<div style="position:absolute;top:8px;left:8px;background:${PRIMARY};color:#0a4d00;font-family:${INTER};font-size:10px;font-weight:800;padding:3px 8px;border-radius:999px">Destaque</div>` : ''}
      </div>
      <div style="padding:10px 12px">
        <p style="font-size:11px;font-weight:600;color:${MUTED};font-family:${INTER};margin:0 0 6px;text-transform:capitalize">${formatPostDate(p.timestamp)}</p>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:${FG};font-family:${INTER}"><svg width="13" height="13" viewBox="0 0 24 24" fill="#e52020" stroke="#e52020">${ICO_HEART}</svg>${num(p.likes)}</span>
          <span style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:${FG};font-family:${INTER}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${BLUE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_COMMENT}</svg>${num(p.comments)}</span>
        </div>
      </div>
    </div>`;
  };

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  ${richHeader(idx, total)}

  <div style="position:relative;z-index:1;flex:1;padding:36px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:22px">
      <h1 style="font-family:${INTER};font-size:42px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">Conteúdos do mês</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Painel dos últimos posts publicados — o que saiu, quando saiu e como performou</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:16px">
      ${posts.map(postCard).join('')}
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sInstagramPosts');
}

// ── Instagram — spotlight on the best-performing post ─────────────────────────

function sInstagramSpotlight(posts: InstagramPost[], idx: number, total: number): string {
  const best = bestInstagramPost(posts);
  if (!best) return '';

  const others = posts.filter(p => p.id !== best.id);
  const hasReach = best.reach > 0;
  const avgOthers = others.length
    ? others.reduce((s, p) => s + (hasReach ? p.reach : p.likes + p.comments), 0) / others.length
    : 0;
  const bestScore = hasReach ? best.reach : best.likes + best.comments;
  const liftPct = avgOthers > 0 ? Math.round(((bestScore - avgOthers) / avgOthers) * 100) : 0;

  const isVideo = best.mediaType === 'REELS' || best.mediaType === 'VIDEO';
  const caption = best.caption.length > 220 ? best.caption.slice(0, 220).trim() + '…' : best.caption;

  const metric = (label: string, value: string) =>
    `<div style="background:${ROW};border-radius:14px;padding:16px 18px">
      <p style="font-size:12px;font-weight:600;color:${MUTED};font-family:${INTER};margin:0 0 6px">${label}</p>
      <p style="font-family:${INTER};font-size:24px;font-weight:900;letter-spacing:-0.02em;color:${FG};margin:0">${value}</p>
    </div>`;

  const metrics = [
    metric('Curtidas', num(best.likes)),
    metric('Comentários', num(best.comments)),
    metric(hasReach ? 'Alcance' : 'Engajamento', hasReach ? num(best.reach) : num(best.likes + best.comments)),
    isVideo ? metric('Visualizações', num(best.videoViews)) : metric('Salvamentos', num(best.saves)),
  ];

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  ${richHeader(idx, total)}

  <div style="position:relative;z-index:1;flex:1;padding:36px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:22px">
      <h1 style="font-family:${INTER};font-size:42px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">Melhor conteúdo do mês</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">O post com melhor desempenho entre os publicados no período</p>
    </div>

    <div style="display:grid;grid-template-columns:340px 1fr;gap:28px;flex:1">
      <div style="position:relative;border-radius:18px;overflow:hidden;background:${ROW};box-shadow:0 14px 34px rgba(15,23,42,.10)">
        ${best.thumbnailUrl
          ? `<img src="${best.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover" />`
          : `<div style="width:100%;height:100%;min-height:340px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#E1306C22,#F7717122)"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E1306C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`}
        ${isVideo ? `<div style="position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center"><svg width="17" height="17" viewBox="0 0 24 24" fill="white">${ICO_PLAY}</svg></div>` : ''}
        <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(0deg,rgba(15,23,42,.78),transparent);padding:24px 16px 14px">
          <p style="color:white;font-family:${INTER};font-size:13px;font-weight:700;margin:0;text-transform:capitalize">${formatPostDate(best.timestamp)}</p>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:20px;min-width:0">
        <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);padding:26px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
            ${metrics.join('')}
          </div>
          ${caption ? `<p style="font-size:14px;color:#163461;font-family:${INTER};line-height:1.6;margin:0;padding-top:16px;border-top:1px solid ${BORDER}">"${caption}"</p>` : ''}
        </div>

        <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.07);display:flex;align-items:flex-start;gap:16px;padding:20px 26px">
          <div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div style="border-left:2px solid ${PRIMARY};padding-left:18px">
            <p style="font-size:15px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px">Por que esse post se destacou</p>
            <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.5;margin:0">
              ${liftPct > 0
                ? `${hasReach ? 'Alcance' : 'Engajamento'} ${liftPct}% acima da média dos outros posts do período — vale repetir o formato e o tema.`
                : `Melhor resultado do período entre os posts publicados — bom modelo para repetir formato e tema.`}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sInstagramSpotlight');
}

// ── Diagnóstico A — Decision Matrix + análise (slide 1 de 2) ─────────────────

function sDiagnosticoA(diag: DiagJson, idx: number, total: number): string {
  // Map plano + pontos to decision matrix quadrants
  const matrixCells = [
    {
      label: 'Prioridade Imediata',
      color: PRIMARY,
      axis: 'top-left',
      items: diag.plano.slice(0, 2).map(p => p.acao).filter(Boolean).length > 0
        ? diag.plano.slice(0, 2).map(p => p.acao)
        : diag.pontos_fortes.slice(0, 2),
    },
    {
      label: 'Aposta Estratégica',
      color: BLUE,
      axis: 'top-right',
      items: diag.plano.slice(2, 4).map(p => p.acao).filter(Boolean).length > 0
        ? diag.plano.slice(2, 4).map(p => p.acao)
        : diag.pontos_fortes.slice(2, 4),
    },
    {
      label: 'Manter Monitorado',
      color: MUTED,
      axis: 'bottom-left',
      items: diag.forcas.slice(0, 2).map(f => f.titulo + ': ' + f.descricao.slice(0, 50) + (f.descricao.length > 50 ? '…' : '')),
    },
    {
      label: 'Evitar Agora',
      color: RED,
      axis: 'bottom-right',
      items: diag.pontos_atencao.slice(0, 2),
    },
  ];

  const fortes = diag.pontos_fortes.slice(0, 3).map(p =>
    `<div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid ${BORDER}">
      <span style="font-size:12px;color:${PRIMARY};flex-shrink:0;margin-top:1px">✓</span>
      <span style="font-size:12px;color:${FG};font-family:${INTER};line-height:1.5">${p}</span>
    </div>`,
  ).join('');

  const atencao = diag.pontos_atencao.slice(0, 2).map(p =>
    `<div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid ${BORDER}">
      <span style="font-size:12px;color:${RED};flex-shrink:0;margin-top:1px">!</span>
      <span style="font-size:12px;color:${FG};font-family:${INTER};line-height:1.5">${p}</span>
    </div>`,
  ).join('');

  const body = `
${sectionHeader('Diagnóstico: forças, riscos e prioridades do período', 'Matriz Impacto × Esforço + pontos de atenção')}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;flex:1">
  <div>${decisionMatrix(matrixCells)}</div>
  <div style="display:flex;flex-direction:column;gap:0">
    <div style="border:1px solid ${BORDER};background:${CARD};padding:16px 20px;margin-bottom:12px">
      <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.75;margin:0">${diag.diagnostico}</p>
    </div>
    <div style="margin-bottom:6px">
      <p style="font-size:10px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 2px">Pontos Fortes</p>
      ${fortes}
    </div>
    <div style="margin-top:8px">
      <p style="font-size:10px;font-weight:700;color:${RED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 2px">Pontos de Atenção</p>
      ${atencao}
    </div>
  </div>
</div>
${diag.frase_fechamento ? thesisBanner(`"${diag.frase_fechamento}"`) : ''}`;
  return auditSlide(wrapSlide(body, idx, total), 'sDiagnosticoA');
}

// ── Diagnóstico B — plano 5 passos + criativos (slide 2 de 2) ────────────────

function sDiagnosticoPlan(diag: DiagJson, idx: number, total: number): string {
  const plano = diag.plano.slice(0, 5);

  const card = (p: typeof plano[0], i: number) =>
    `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};background:${CARD};padding:14px;display:flex;flex-direction:column;gap:7px">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${PRIMARY}"></div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:24px;height:24px;background:${PRIMARY};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <span style="font-size:12px;font-weight:800;color:${INVERSE};font-family:${INTER}">${i+1}</span>
        </div>
        <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      </div>
      ${p.objetivo ? `<p style="font-size:11px;color:${PRIMARY};font-family:${INTER};margin:0;line-height:1.4">Obj: ${p.objetivo}</p>` : ''}
      ${p.publico  ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4">Para: ${p.publico}</p>` : ''}
      ${p.mensagem ? `<div style="padding:6px 8px;background:${CARD};border:1px solid ${BORDER}">
        <p style="font-size:10px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.5;font-style:italic">"${p.mensagem.slice(0,90)}${p.mensagem.length>90?'…':''}"</p>
      </div>` : ''}
    </div>`;

  const row1 = plano.slice(0, 3).map((p, i) => card(p, i)).join('');
  const row2 = plano.slice(3, 5).map((p, i) => card(p, i + 3)).join('');

  const body = `
${sectionHeader('5 ações para o próximo mês — priorizadas por impacto nos dados', 'Plano de ação baseado no diagnóstico do período')}
<div style="flex:1;display:flex;flex-direction:column;gap:10px">
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${row1}</div>
  <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:67%">${row2}</div>
</div>
${thesisBanner('Executar estas 5 ações em sequência, da mais fácil para a mais complexa, garante resultado consistente no próximo mês.')}`;
  return auditSlide(wrapSlide(body, idx, total), 'sDiagnosticoPlan');
}

function sCriativos(creatives: Creative[], idx: number, total: number): string {
  const top = creatives.slice(0, 6);
  const best = top[0];

  const creativeCard = (c: Creative, i: number) => {
    const isFirst = i === 0;
    const accent = isFirst ? PRIMARY : BORDER;
    return `<div style="position:relative;overflow:hidden;border:1px solid ${accent};background:${CARD};display:flex;flex-direction:column">
      ${isFirst ? `<div style="position:absolute;top:0;left:0;right:0;height:2px;background:${PRIMARY}"></div>` : ''}
      ${c.thumbnail_url
        ? `<img src="${c.thumbnail_url}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block" />`
        : `<div style="width:100%;aspect-ratio:16/9;background:${CARD};display:flex;align-items:center;justify-content:center">
            <span style="font-size:10px;color:${MUTED};font-family:${INTER}">Sem thumbnail</span>
           </div>`}
      <div style="padding:10px 12px;display:flex;flex-direction:column;gap:5px">
        ${isFirst ? `<span style="font-size:9px;font-weight:800;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER}">MELHOR CRIATIVO</span>` : ''}
        <p style="font-size:11px;font-weight:700;color:${FG};font-family:${INTER};margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.nome}</p>
        <div style="display:flex;gap:12px">
          <span style="font-size:10px;color:${MUTED};font-family:${INTER}">${brlOrDash(c.spend)}</span>
          ${c.resultado > 0 ? `<span style="font-size:10px;color:${isFirst?PRIMARY:MUTED};font-family:${INTER};font-weight:${isFirst?'700':'400'}">${num(Math.round(c.resultado))} resultados</span>` : ''}
        </div>
      </div>
    </div>`;
  };

  const body = `
${sectionHeader(
  best ? `"${best.nome.slice(0,48)}${best.nome.length>48?'…':''}" lidera o desempenho — referência para os próximos criativos` : 'Análise de criativos — identifique o padrão vencedor',
  'Top criativos Meta Ads por resultado no período'
)}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;flex:1;align-items:start">
  ${top.map((c, i) => creativeCard(c, i)).join('')}
</div>
${thesisBanner(
  best
    ? `O criativo "${best.nome.slice(0,40)}${best.nome.length>40?'…':''}" deve ser referência para novas peças — replicar o formato e testar variações de copy.`
    : 'Analise o padrão visual dos criativos com maior resultado e replique o formato nos próximos anúncios.'
)}`;

  return auditSlide(wrapSlide(body, idx, total), 'sCriativos');
}

// ── Expanded slides ───────────────────────────────────────────────────────────

function sMetaAdsCampanhas(meta: MetaAdsFull, diag: DiagJson, idx: number, total: number): string {
  const isWA = (c: CampanhaDetalhada) =>
    c.metricas.conversas > 0
    || c.tipo.toLowerCase().includes('message')
    || c.tipo.toLowerCase().includes('whatsapp');

  const isSales = (c: CampanhaDetalhada) =>
    c.metricas.compras > 0
    || c.tipo.toLowerCase().includes('conversion');

  // ── Auto insight per campaign ─────────────────────────────────────────────
  function autoInsight(c: CampanhaDetalhada): string {
    const m = c.metricas;
    if (isWA(c)) {
      const cpm = m.conversas > 0 && m.investimento > 0 ? m.investimento / m.conversas : 0;
      if (m.frequencia > 5)    return `frequência de ${m.frequencia.toFixed(1)}× — audiência saturando, considere ampliar o público`;
      if (m.conversas > 300)   return `alto volume de conversas — pipeline aquecido para nutrição via WhatsApp`;
      if (cpm > 0 && cpm < 8)  return `custo por conversa eficiente (${brl(cpm)}) — campanha rentável, considere escalar`;
      return `${numOrDash(Math.round(m.conversas))} conversas com ${brlOrDash(m.investimento)} investido — monitorar qualidade dos leads`;
    }
    if (isSales(c)) {
      if (m.purchase_roas > 6)  return `ROAS de ${m.purchase_roas.toFixed(1)}× — excelente retorno, priorizar verba nessa campanha`;
      if (m.purchase_roas > 3)  return `boa relação entre investimento e retorno (ROAS ${m.purchase_roas.toFixed(1)}×)`;
      if (m.purchase_roas > 0)  return `ROAS de ${m.purchase_roas.toFixed(1)}× abaixo do ideal — revisar criativo e segmentação`;
      if (m.compras > 0)        return `${num(Math.round(m.compras))} compras registradas — monitorar ROAS nas próximas semanas`;
      return `campanha de vendas com investimento de ${brlOrDash(m.investimento)} — aguardar conversões`;
    }
    if (m.cliques > 500)        return `alto volume de cliques (${numOrDash(m.cliques)}) — audiência engajada com o criativo`;
    if (m.frequencia > 4)       return `frequência de ${m.frequencia.toFixed(1)}× — campanha de reconhecimento com boa repetição`;
    return `alcance de ${numOrDash(m.alcance)} pessoas com ${brlOrDash(m.investimento)} — campanha de visibilidade ativa`;
  }

  // ── Campaign block matching reference design ───────────────────────────────
  const ICO_WA   = '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>';
  const ICO_CART = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_ACT  = '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>';
  const ICO_ARR  = '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>';

  function metricCol(label: string, value: string, last = false): string {
    return `<div style="flex:1;padding:12px 16px;${last ? '' : `border-right:1px solid ${BORDER};`}">
      <p style="font-size:11px;font-weight:600;color:${MUTED};font-family:${INTER};margin:0 0 5px;line-height:1.2">${label}</p>
      <p style="font-family:${BEBAS};font-size:${value === '—' ? '22' : '28'}px;color:${value === '—' ? MUTED : FG};line-height:1;margin:0;letter-spacing:0.01em">${value}</p>
    </div>`;
  }

  function campBlock(c: CampanhaDetalhada): string {
    const m = c.metricas;
    const campIsWA    = isWA(c);
    const campIsSales = !campIsWA && isSales(c);
    const icoPath     = campIsWA ? ICO_WA : campIsSales ? ICO_CART : ICO_ACT;
    const iconBg      = campIsWA ? '#25D366' : campIsSales ? ORANGE : BLUE;
    const iconFg      = '#ffffff';

    let cols: string;
    if (campIsWA) {
      const cpm = m.conversas > 0 && m.investimento > 0 ? brl(m.investimento / m.conversas) : '—';
      cols = [
        metricCol('Investimento',       brlOrDash(m.investimento)),
        metricCol('Conversas iniciadas', m.conversas > 0 ? num(Math.round(m.conversas)) : '—'),
        metricCol('Custo por conversa',  cpm),
        metricCol('Cliques no link',     numOrDash(m.cliques)),
        metricCol('Frequência',          m.frequencia > 0 ? m.frequencia.toFixed(2) : '—', true),
      ].join('');
    } else if (campIsSales) {
      const cpp = m.compras > 0 && m.investimento > 0 ? brl(m.investimento / m.compras) : '—';
      cols = [
        metricCol('Investimento',       brlOrDash(m.investimento)),
        metricCol('Compras registradas', m.compras > 0 ? num(Math.round(m.compras)) : '—'),
        metricCol('Custo por compra',    cpp),
        metricCol('Valor de compra',     m.valor_compras > 0 ? brl(m.valor_compras) : '—'),
        metricCol('ROAS',                m.purchase_roas > 0 ? m.purchase_roas.toFixed(2) : '—', true),
      ].join('');
    } else {
      cols = [
        metricCol('Investimento',  brlOrDash(m.investimento)),
        metricCol('Alcance',       numOrDash(m.alcance)),
        metricCol('Impressões',    numOrDash(m.impressoes)),
        metricCol('Cliques',       numOrDash(m.cliques)),
        metricCol('Frequência',    m.frequencia > 0 ? m.frequencia.toFixed(2) : '—', true),
      ].join('');
    }

    const insightText = autoInsight(c);

    return `<div style="background:${CARD};border:1px solid ${BORDER};border-radius:16px;overflow:hidden">
      <div style="display:flex;align-items:stretch">
        <div style="width:76px;flex-shrink:0;background:${iconBg}12;display:flex;align-items:center;justify-content:center">
          <div style="width:52px;height:52px;border-radius:50%;background:${iconBg};display:flex;align-items:center;justify-content:center">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${iconFg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icoPath}</svg>
          </div>
        </div>
        <div style="width:1px;background:${BORDER};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="padding:14px 18px 12px">
            <p style="font-size:14px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${c.nome}</p>
          </div>
          <div style="display:flex;border-top:1px solid ${BORDER}">${cols}</div>
        </div>
      </div>
      <div style="border-top:1px solid ${BORDER};padding:10px 18px;display:flex;align-items:center;gap:10px;background:${ROW}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${ICO_ARR}</svg>
        <p style="font-size:12px;font-weight:500;color:${FG};font-family:${INTER};margin:0;line-height:1.4">${insightText}</p>
      </div>
    </div>`;
  }

  // ── Recommendation block ──────────────────────────────────────────────────
  const ICO_TGT = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
  const hasConversa   = meta.campanhas.some(isWA);
  const hasSales      = meta.campanhas.some(isSales);
  const recText = diag.insight_campanha_conversa && diag.insight_campanha_conversao
    ? `${diag.insight_campanha_conversa} ${diag.insight_campanha_conversao}`
    : diag.insight_campanha_conversa || diag.insight_campanha_conversao
    || (hasConversa && hasSales
        ? 'separar campanhas por objetivo — reconhecimento, venda direta, WhatsApp, reativação e remarketing'
        : hasConversa
        ? 'nutrir as conversas iniciadas via WhatsApp com sequência de follow-up para converter em pedidos'
        : 'escalar o orçamento nas campanhas com melhor ROAS e testar novos criativos para o público mais responsivo');

  const campGrid = meta.campanhas.length > 0
    ? `<div style="display:grid;grid-template-columns:${meta.campanhas.length === 1 ? '1fr' : '1fr 1fr'};gap:14px">${meta.campanhas.map(campBlock).join('')}</div>`
    : '';

  const body = `
<div style="flex:1;display:flex;flex-direction:column;padding-bottom:28px">

  <div style="flex-shrink:0;margin-bottom:18px">
    <h1 style="font-family:${INTER};font-size:36px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 6px;letter-spacing:-0.03em">Detalhamento por campanha</h1>
    <p style="font-size:13px;font-weight:500;color:${MUTED};font-family:${INTER};margin:0">Métricas individuais — cada campanha avaliada pelo seu objetivo principal</p>
  </div>

  <div style="flex:1;display:flex;flex-direction:column;gap:14px;min-height:0">
    ${campGrid}
  </div>

  <div data-conclusion="1" style="flex-shrink:0;background:${CARD};border:1px solid ${BORDER};border-radius:14px;padding:16px 20px;display:flex;align-items:center;gap:16px;margin-top:14px">
    <div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}15;border:1.5px solid ${PRIMARY}28;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICO_TGT}</svg>
    </div>
    <div>
      <p style="font-size:11px;font-weight:700;color:${PRIMARY_TEXT};text-transform:uppercase;letter-spacing:0.09em;font-family:${INTER};margin:0 0 4px">Recomendação</p>
      <p style="font-size:13px;font-weight:500;color:${FG};font-family:${INTER};line-height:1.5;margin:0">${recText}</p>
    </div>
  </div>

</div>`;
  return auditSlide(wrapSlide(body, idx, total), 'sMetaAdsCampanhas');
}

function sDiagnosticoFat(diag: DiagJson, d: ParsedData, bairros: Bairro[], idx: number, total: number): string {
  const COLORS = [PRIMARY, BLUE, ORANGE, RED];
  const forcas = (diag.forcas.length ? diag.forcas : [
    { titulo: 'Recorrência', descricao: d.recorrentes > 0 ? `${num(d.recorrentes)} clientes recompraram — base fidelizada ativa.` : 'Converter compradores únicos em recorrentes é a maior alavanca.' },
    { titulo: 'Produtos', descricao: d.produtos[0]?.qtd > 0 ? `"${d.produtos[0].nome}" lidera com ${num(d.produtos[0].qtd)} pedidos.` : 'Identificar produto âncora para campanhas de entrada.' },
    { titulo: 'Dias Fortes', descricao: d.por_dia.length ? `Pico em ${[...d.por_dia].sort((a,b)=>b.pedidos-a.pedidos)[0]?.dia??'—'} — concentrar investimento nesse dia.` : 'Mapear dias de pico para otimizar campanhas.' },
    { titulo: 'Regiões', descricao: bairros[0] ? `${bairros[0].bairro} lidera com ${num(bairros[0].pedidos)} pedidos.` : 'Concentrar entrega nas zonas de maior demanda.' },
  ]).slice(0, 4);

  // Find dominant force (longest description = most data available)
  const dominantIdx = forcas.reduce((best, f, i) => f.descricao.length > forcas[best].descricao.length ? i : best, 0);

  const forcaCards = forcas.map((f, i) => {
    const c = COLORS[i % COLORS.length];
    const isDominant = i === dominantIdx;
    return `<div style="position:relative;overflow:hidden;border:1px solid ${isDominant ? c+'60' : BORDER};background:${CARD};padding:18px">
      <div style="position:absolute;top:0;left:0;right:0;height:${isDominant?'3':'2'}px;background:${c}"></div>
      ${isDominant ? `<div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${c}"></div>` : ''}
      <p style="font-family:${BEBAS};font-size:${isDominant?'24':'20'}px;color:${c};margin:${isDominant?'4':'2'}px 0 8px;letter-spacing:0.04em">${f.titulo}</p>
      <p style="font-size:12px;color:${FG};font-family:${INTER};line-height:1.6;margin:0">${f.descricao}</p>
    </div>`;
  }).join('');

  const sidebar = `
    <div style="border:1px solid ${BORDER};background:${CARD};padding:14px;margin-bottom:10px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 10px">Base de Clientes</p>
      ${[{label:'Ativos',value:numOrDash(d.ativos),color:PRIMARY},{label:'Inativos',value:numOrDash(d.inativos),color:RED},{label:'Potenciais',value:numOrDash(d.potenciais),color:BLUE}].map(item =>
        `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${INTER}">
          <span style="font-size:11px;color:${MUTED}">${item.label}</span>
          <span style="font-size:20px;font-family:${BEBAS};color:${item.color};line-height:1">${item.value}</span>
        </div>`,
      ).join('')}
    </div>
    ${bairros.length ? `<div style="border:1px solid ${BORDER};background:${CARD};padding:14px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 8px">Top Regiões</p>
      ${bairros.slice(0,4).map((b,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid ${BORDER};font-family:${INTER}">
        <span style="font-size:11px;color:${i===0?FG:MUTED}">${b.bairro}</span>
        <span style="font-size:11px;font-weight:700;color:${i===0?PRIMARY:MUTED}">${num(b.pedidos)} ped.</span>
      </div>`).join('')}
    </div>` : ''}`;

  const body = `
${sectionHeader('Quatro forças explicam o resultado — uma delas domina', 'Diagnóstico de faturamento · análise expandida')}
<div style="display:grid;grid-template-columns:1fr 260px;gap:20px;flex:1;align-items:start">
  <div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px">${forcaCards}</div>
    ${diag.diagnostico ? `<div style="border:1px solid ${BORDER};background:${CARD};padding:14px 18px">
      <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.7;margin:0">${diag.diagnostico}</p>
    </div>` : ''}
  </div>
  <div>${sidebar}</div>
</div>
${thesisBanner(`A força "${forcas[dominantIdx]?.titulo ?? '—'}" é o principal driver do resultado. Qualquer ação de crescimento deve reforçá-la primeiro.`, 'insight')}`;
  return auditSlide(wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA'), 'sDiagnosticoFat');
}

// ── Plano Detalhado — JourneyPlanSlide com 3+2 grid ───────────────────────────

function sPlanoDetalhado(diag: DiagJson, idx: number, total: number): string {
  const jornada = diag.jornada.length
    ? diag.jornada
    : ['descoberta', 'primeira_compra', 'recompra', 'reativacao_leve', 'reativacao_forte'];

  const LABELS: Record<string,string> = {
    descoberta:'Descoberta', primeira_compra:'1ª Compra',
    recompra:'Recompra', reativacao_leve:'Reat. Leve', reativacao_forte:'Reat. Forte',
  };

  const planCard = (p: DiagJson['plano'][0], i: number) => {
    const etapa = LABELS[jornada[i] ?? ''] ?? '';
    const STEP_COLORS = [PRIMARY, PRIMARY+'CC', BLUE, ORANGE, RED+'CC'];
    const accent = STEP_COLORS[i] ?? PRIMARY;
    return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};background:${CARD};padding:14px;display:flex;flex-direction:column;gap:7px">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accent}"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:24px;height:24px;background:${accent};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span style="font-size:12px;font-weight:800;color:${INVERSE};font-family:${INTER}">${i+1}</span>
          </div>
          ${etapa ? `<span style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;font-family:${INTER};border:1px solid ${BORDER};padding:2px 5px">${etapa}</span>` : ''}
        </div>
      </div>
      <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      ${p.objetivo ? `<p style="font-size:11px;color:${accent};font-family:${INTER};margin:0;line-height:1.4">Obj: ${p.objetivo}</p>` : ''}
      ${p.publico  ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4">Para: ${p.publico}</p>` : ''}
      ${p.mensagem ? `<div style="padding:5px 8px;background:${CARD};border:1px solid ${BORDER}">
        <p style="font-size:10px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.5;font-style:italic">"${p.mensagem.slice(0,80)}${p.mensagem.length>80?'…':''}"</p>
      </div>` : ''}
    </div>`;
  };

  const cards = diag.plano.slice(0, 5).map((p, i) => planCard(p, i));

  const body = `
${sectionHeader('O próximo mês deve priorizar reativação leve e potenciais', 'Plano detalhado — estratégia por etapa da jornada')}
${journeyBar(jornada)}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px">${cards.slice(0,3).join('')}</div>
<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;max-width:67%">${cards.slice(3).join('')}</div>
${thesisBanner('Executar as ações na sequência da jornada garante que cada cliente seja abordado no momento certo com a mensagem certa.')}`;
  return auditSlide(wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA'), 'sPlanoDetalhado');
}

// ── Diagnosis (Claude — expanded JSON) ────────────────────────────────────────

async function fetchDiagnosis(
  d: ParsedData, prevD: ParsedData | null, meta: MetaAdsFull | null,
  bairros: Bairro[], clientName: string, periodo: string, agencyContext: string,
): Promise<DiagJson> {
  if (process.env.SKIP_AI === 'true') {
    return {
      diagnostico: '[Modo de teste — IA desativada]',
      forcas: [
        { titulo: 'Recorrência', descricao: 'Dado simulado para teste' },
        { titulo: 'Produtos',    descricao: 'Dado simulado para teste' },
        { titulo: 'Dias',        descricao: 'Dado simulado para teste' },
        { titulo: 'Regiões',     descricao: 'Dado simulado para teste' },
      ],
      pontos_fortes:  ['Dado simulado para teste'],
      pontos_atencao: ['Dado simulado para teste'],
      plano: [{ acao: 'Campanha de teste', objetivo: '—', publico: '—', mensagem: '—' }],
      insight_campanha_conversa:  '',
      insight_campanha_conversao: '',
      frase_fechamento: 'Modo de teste ativo — IA desativada.',
      jornada: ['descoberta', 'primeira_compra', 'recompra', 'reativacao_leve', 'reativacao_forte'],
    };
  }

  const summary = {
    cliente: clientName, periodo,
    faturamento: d.faturamento, pedidos: d.pedidos_ativos, ticket: Math.round(d.ticket),
    ativos: d.ativos, inativos: d.inativos, potenciais: d.potenciais,
    uma_compra: d.uma_compra, recorrentes: d.recorrentes,
    top_produtos: d.produtos.filter(p => p.qtd > 0).slice(0, 5).map(p => `${p.nome} (${p.qtd}x)`),
    top_bairros: bairros.slice(0, 3).map(b => `${b.bairro} (${b.pedidos} ped)`),
    dias_semana: d.por_dia.sort((a, b) => b.pedidos - a.pedidos).slice(0, 2).map(x => x.dia),
    meta_ads: meta ? {
      investimento: meta.investimento, alcance: meta.alcance, cliques: meta.cliques,
      campanhas: meta.campanhas.map(c => ({
        nome: c.nome, tipo: c.tipo,
        conversas: c.metricas.conversas, compras: c.metricas.compras,
        frequencia: c.metricas.frequencia, roas: c.metricas.purchase_roas,
      })),
    } : null,
    periodo_anterior: prevD ? { faturamento: prevD.faturamento, pedidos: prevD.pedidos_ativos, ticket: Math.round(prevD.ticket) } : null,
    contexto_agencia: agencyContext || null,
  };

  const schema = `{
  "diagnostico": "2-3 frases sobre o estado atual do negócio",
  "forcas": [
    {"titulo":"Recorrência","descricao":"..."},
    {"titulo":"Produtos","descricao":"..."},
    {"titulo":"Dias","descricao":"..."},
    {"titulo":"Regiões","descricao":"..."}
  ],
  "pontos_fortes": ["...","...","..."],
  "pontos_atencao": ["...","..."],
  "plano": [
    {"acao":"...","objetivo":"resultado esperado","publico":"quem recebe","mensagem":"texto de exemplo para disparo"},
    {"acao":"...","objetivo":"...","publico":"...","mensagem":"..."},
    {"acao":"...","objetivo":"...","publico":"...","mensagem":"..."},
    {"acao":"...","objetivo":"...","publico":"...","mensagem":"..."},
    {"acao":"...","objetivo":"...","publico":"...","mensagem":"..."}
  ],
  "insight_campanha_conversa": "análise das campanhas de conversa — 1-2 frases ou string vazia",
  "insight_campanha_conversao": "análise das campanhas de conversão — 1-2 frases ou string vazia",
  "frase_fechamento": "frase motivacional de 1 linha sobre o objetivo do próximo mês",
  "jornada": ["descoberta","primeira_compra","recompra","reativacao_leve","reativacao_forte"]
}`;

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 2500,
    system:     'Analista de marketing de delivery para restaurantes. Responda APENAS com JSON válido. Sem markdown, sem texto extra.',
    messages:   [{ role: 'user', content: `DADOS:\n${JSON.stringify(summary, null, 2)}\n\nRetorne EXATAMENTE este schema:\n${schema}` }],
  });
  void logAiUsage({ source: 'report_delivery', model: 'claude-sonnet-4-6', inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()) as DiagJson;
    return {
      diagnostico:                parsed.diagnostico                ?? 'Análise indisponível.',
      forcas:                     Array.isArray(parsed.forcas)        ? parsed.forcas : [],
      pontos_fortes:              Array.isArray(parsed.pontos_fortes) ? parsed.pontos_fortes : [],
      pontos_atencao:             Array.isArray(parsed.pontos_atencao) ? parsed.pontos_atencao : [],
      plano:                      Array.isArray(parsed.plano)         ? parsed.plano : [],
      insight_campanha_conversa:  parsed.insight_campanha_conversa  ?? '',
      insight_campanha_conversao: parsed.insight_campanha_conversao ?? '',
      frase_fechamento:           parsed.frase_fechamento            ?? '',
      jornada:                    Array.isArray(parsed.jornada)       ? parsed.jornada : ['descoberta','primeira_compra','recompra','reativacao_leve','reativacao_forte'],
    };
  } catch {
    return {
      diagnostico: 'Análise indisponível.',
      forcas: [], pontos_fortes: [], pontos_atencao: [], plano: [],
      insight_campanha_conversa: '', insight_campanha_conversao: '',
      frase_fechamento: '', jornada: [],
    };
  }
}

// ── Public builder ─────────────────────────────────────────────────────────────

export async function buildDeliveryReport(opts: {
  clientId:       string;
  clientName:     string;
  from:           string;
  to:             string;
  csvFiles:       { name: string; content: string }[];
  agencyContext?: string;
  connectionId?:  string | null;
  accountIds?:    string[];
}): Promise<{ html: string }> {
  const { clientId, clientName, from, to, csvFiles = [], agencyContext = '', connectionId, accountIds = [] } = opts;

  const fromDate = new Date(from + 'T12:00:00');
  const toDate   = new Date(to   + 'T12:00:00');
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo  = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;

  const { current: currentFiles, previous: prevFiles } = separateFiles(csvFiles);
  const hasPrev = prevFiles.length > 0;

  const data    = parseAllFiles(currentFiles, toDate);
  const prevData = hasPrev ? parseAllFiles(prevFiles, fromDate) : null;

  const prevPeriodo = hasPrev
    ? (() => {
        const pm = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
        return `${MONTHS[pm.getMonth()]}/${pm.getFullYear()}`;
      })()
    : '';

  const [bairros, { meta, creatives }, instagramFull] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaData(connectionId, accountIds, from, to),
    fetchInstagramData(connectionId, from, to),
  ]);
  const instagram = instagramFull?.insights ?? null;
  const igPosts    = instagramFull?.posts ?? [];

  console.log(`[delivery] ${clientName} | fat:${brlOrDash(data.faturamento)} ativos:${data.ativos} prod:${data.produtos.length} bairros:${bairros.length} meta:${meta ? 'sim' : 'não'} ig:${instagram ? `@${instagram.username}` : 'não'} igPosts:${igPosts.length} criativos:${creatives.length} prev:${hasPrev}`);

  const diag = await fetchDiagnosis(data, prevData, meta, bairros, clientName, periodo, agencyContext);

  const hasVisao             = data.faturamento > 0 || data.pedidos_ativos > 0;
  const hasDia               = data.por_dia.length > 0;
  const hasBase              = data.ativos > 0 || data.inativos > 0 || data.potenciais > 0;
  const hasInat              = data.inativos_faixas.length > 0;
  const hasProd              = data.produtos.length > 0;
  const hasRegiao            = bairros.length > 0;
  const hasMeta              = meta !== null;
  const hasInstagram         = instagram !== null;
  const hasInstagramPosts    = igPosts.length > 0;
  const hasInstagramSpotlight = hasInstagramPosts;
  const hasDestaques         = hasMeta && meta!.campanhas.length > 0;
  const hasDiagFat           = hasBase || hasRegiao;
  const hasPlanoDetalh       = diag.plano.length > 0;
  const hasCriativos         = creatives.length > 0;

  // Diagnóstico sempre gera 2 slides (A + Plan)
  const total = 1
    + (hasVisao      ? 1 : 0)
    + (hasDia        ? 1 : 0)
    + (hasRegiao     ? 1 : 0)
    + (hasBase       ? 1 : 0)
    + (hasInat       ? 1 : 0)
    + (hasProd       ? 1 : 0)
    + (hasMeta       ? 1 : 0)
    + (hasInstagram  ? 1 : 0)
    + (hasInstagramPosts ? 1 : 0)
    + (hasInstagramSpotlight ? 1 : 0)
    + 2                           // sDiagnosticoA + sDiagnosticoPlan
    + (hasDestaques   ? 1 : 0)
    + (hasCriativos   ? 1 : 0)
    + (hasDiagFat     ? 1 : 0)
    + (hasPlanoDetalh ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total));
  if (hasVisao)       slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo));
  if (hasDia)         slides.push(sPorDia(data, ++i, total));
  if (hasRegiao)      slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)        slides.push(sBase(data, ++i, total));
  if (hasInat)        slides.push(sInativos(data, ++i, total));
  if (hasProd)        slides.push(sProdutos(data, ++i, total));
  if (hasMeta)        slides.push(sMetaAdsResumo(meta!, ++i, total));
  if (hasInstagram)   slides.push(sInstagram(instagram!, ++i, total));
  if (hasInstagramPosts)     slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));
  slides.push(sDiagnosticoA(diag, ++i, total));
  slides.push(sDiagnosticoPlan(diag, ++i, total));
  if (hasDestaques)   slides.push(sMetaAdsCampanhas(meta!, diag, ++i, total));
  if (hasCriativos)   slides.push(sCriativos(creatives, ++i, total));
  if (hasDiagFat)     slides.push(sDiagnosticoFat(diag, data, bairros, ++i, total));
  if (hasPlanoDetalh) slides.push(sPlanoDetalhado(diag, ++i, total));

  const fontLink = `<style>@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');</style>`;
  return { html: `${fontLink}<div style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>` };
}

// ── Save to DB ─────────────────────────────────────────────────────────────────

export async function saveDeliveryReport(opts: {
  clientId:   string;
  clientName: string;
  from:       string;
  to:         string;
  data:       { html: string };
}): Promise<{ token: string; reportId: string }> {
  const { clientId, clientName, from, to, data } = opts;
  const token = randomUUID();
  const pool  = makeServerPool();
  try {
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports (client_id,client_name,period_from,period_to,template_slug,report_data,public_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [clientId, clientName, from, to, 'onmid-narrative-delivery', JSON.stringify(data), token],
    );
    return { token, reportId: rows[0].id as string };
  } finally { await pool.end(); }
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewVisaoGeral(): string {
  const cur: ParsedData = {
    ativos: 389, inativos: 0, potenciais: 0,
    faturamento: 132143.43, pedidos_ativos: 1937, ticket: 68.22,
    uma_compra: 0, recorrentes: 0, produtos: [], inativos_faixas: [], por_dia: [],
  };
  const prev: ParsedData = {
    ativos: 0, inativos: 0, potenciais: 0,
    faturamento: 134535.98, pedidos_ativos: 1980, ticket: 67.95,
    uma_compra: 0, recorrentes: 0, produtos: [], inativos_faixas: [], por_dia: [],
  };
  return sVisaoGeral(cur, prev, 2, 9, 'Maio/2026', 'Abril/2026');
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewBase(): string {
  const d: ParsedData = {
    ativos: 389, inativos: 5845, potenciais: 715,
    faturamento: 0, pedidos_ativos: 1425, ticket: 0,
    uma_compra: 156, recorrentes: 233,
    produtos: [], inativos_faixas: [], por_dia: [],
  };
  return sBase(d, 5, 9);
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewMetaAdsResumo(): string {
  const mk = (investimento: number, conversas: number, compras: number, valor_compras: number, cliques: number, frequencia: number) => ({
    investimento, impressoes: 0, alcance: 0, cliques, frequencia, conversas, compras, valor_compras,
    purchase_roas: compras > 0 ? valor_compras / investimento : 0,
  });
  const meta: MetaAdsFull = {
    investimento: 2826.62, impressoes: 583994, alcance: 240617, cliques: 1858,
    campanhas: [
      { nome: '[ON] [RECONHECIMENTO] [MAIO]', tipo: 'reconhecimento', metricas: mk(400, 0, 0, 0, 200, 2) },
      { nome: '[ON] [WHATS] [ANIVERSÁRIO] [MAIO]', tipo: 'conversas', metricas: mk(1730.85, 332, 0, 0, 1276, 5.38) },
      { nome: '[ON] [VENDAS] [IFOOD] [GUANABARA]', tipo: 'vendas', metricas: mk(300, 0, 8, 400, 150, 1.5) },
      { nome: '[ON] [VENDAS] [ANOTA AÍ] [LOW-BUDGET]', tipo: 'vendas', metricas: mk(235.90, 0, 27, 1860.27, 180, 1.8) },
      { nome: '[ON] [ALCANCE] [BURRITO FIT]', tipo: 'alcance', metricas: mk(60, 0, 0, 0, 30, 1.1) },
      { nome: '[ON] [ALCANCE] [MERCADÃO] [DA] [PROCHET]', tipo: 'alcance', metricas: mk(60, 0, 0, 0, 12, 1.0) },
      { nome: '[ON] [VENDAS] [ANOTA AÍ] [PROCHET]', tipo: 'vendas', metricas: mk(40, 0, 2, 60, 10, 1.0) },
    ],
  };
  return sMetaAdsResumo(meta, 8, 9);
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewInstagramPosts(): string {
  const mk = (id: string, likes: number, comments: number, reach: number, daysAgo: number, mediaType = 'IMAGE'): InstagramPost => ({
    id, caption: 'Hoje é dia de promoção especial! Vem conferir nosso cardápio de hoje, com ofertas exclusivas pra você que acompanha a gente por aqui 🔥',
    mediaType, thumbnailUrl: `https://picsum.photos/seed/${id}/400/400`,
    permalink: '#', timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    likes, comments, reach, saves: Math.round(likes * 0.2), videoViews: mediaType === 'VIDEO' ? reach * 2 : 0,
  });
  const posts: InstagramPost[] = [
    mk('p1', 120, 14, 3200, 1),
    mk('p2', 340, 45, 8900, 3, 'VIDEO'),
    mk('p3', 80, 6, 1800, 5),
    mk('p4', 210, 22, 4100, 7, 'CAROUSEL_ALBUM'),
    mk('p5', 95, 9, 2200, 9),
    mk('p6', 410, 60, 11200, 11, 'VIDEO'),
    mk('p7', 70, 4, 1500, 13),
    mk('p8', 150, 18, 3300, 15),
    mk('p9', 60, 3, 1200, 17),
    mk('p10', 190, 25, 3900, 19, 'CAROUSEL_ALBUM'),
    mk('p11', 100, 10, 2100, 21),
    mk('p12', 130, 16, 2800, 23),
  ];
  return sInstagramPosts(posts, 8, 10) + sInstagramSpotlight(posts, 9, 10);
}

// ── TEMP DEV PREVIEW — full report walkthrough — remove before shipping ─────
export function __devPreviewFullReport(): string {
  const data: ParsedData = {
    ativos: 389, inativos: 5845, potenciais: 715,
    faturamento: 132143.43, pedidos_ativos: 1937, ticket: 68.22,
    uma_compra: 156, recorrentes: 233,
    produtos: [
      { nome: 'X-Burguer Especial', qtd: 412, total: 18540 },
      { nome: 'Combo Família', qtd: 298, total: 22350 },
      { nome: 'Batata Frita G', qtd: 670, total: 8040 },
      { nome: 'Refrigerante Lata', qtd: 901, total: 5406 },
      { nome: 'Milkshake Chocolate', qtd: 210, total: 4200 },
    ],
    inativos_faixas: [
      { label: '30-60 dias', count: 1200 },
      { label: '60-90 dias', count: 1500 },
      { label: '90+ dias', count: 3145 },
    ],
    por_dia: [
      { dia: 'Seg', pedidos: 180, pct: 9 },
      { dia: 'Ter', pedidos: 210, pct: 11 },
      { dia: 'Qua', pedidos: 240, pct: 12 },
      { dia: 'Qui', pedidos: 290, pct: 15 },
      { dia: 'Sex', pedidos: 410, pct: 21 },
      { dia: 'Sáb', pedidos: 380, pct: 20 },
      { dia: 'Dom', pedidos: 227, pct: 12 },
    ],
  };
  const prevData: ParsedData = { ...data, faturamento: 134535.98, pedidos_ativos: 1980, ticket: 67.95 };

  const bairros: Bairro[] = [
    { bairro: 'Centro', pedidos: 520, faturamento: 35400 },
    { bairro: 'Jardim das Flores', pedidos: 410, faturamento: 28900 },
    { bairro: 'Vila Nova', pedidos: 305, faturamento: 21200 },
    { bairro: 'Boa Vista', pedidos: 240, faturamento: 16800 },
    { bairro: 'São José', pedidos: 180, faturamento: 12500 },
  ];

  const mkMetricas = (investimento: number, conversas: number, compras: number, valor_compras: number, cliques: number, frequencia: number) => ({
    investimento, impressoes: Math.round(cliques * 60), alcance: Math.round(cliques * 40), cliques, frequencia, conversas, compras, valor_compras,
    purchase_roas: investimento > 0 ? valor_compras / investimento : 0,
  });
  const meta: MetaAdsFull = {
    investimento: 2826.62, impressoes: 583994, alcance: 240617, cliques: 1858,
    campanhas: [
      { nome: '[ON] [RECONHECIMENTO] [MAIO]', tipo: 'reconhecimento', metricas: mkMetricas(400, 0, 0, 0, 200, 2) },
      { nome: '[ON] [WHATS] [ANIVERSÁRIO] [MAIO]', tipo: 'conversas', metricas: mkMetricas(1730.85, 332, 0, 0, 1276, 5.38) },
      { nome: '[ON] [VENDAS] [IFOOD] [GUANABARA]', tipo: 'vendas', metricas: mkMetricas(300, 0, 8, 400, 150, 1.5) },
      { nome: '[ON] [VENDAS] [ANOTA AÍ] [LOW-BUDGET]', tipo: 'vendas', metricas: mkMetricas(235.90, 0, 27, 1860.27, 180, 1.8) },
      { nome: '[ON] [ALCANCE] [BURRITO FIT]', tipo: 'alcance', metricas: mkMetricas(60, 0, 0, 0, 30, 1.1) },
    ],
  };

  const instagram: InstagramData = {
    username: 'picolocos.oficial', followers: 8240, reach: 42000, impressions: 61000,
    profile_views: 1850, website_clicks: 620, accounts_engaged: 3100,
  };
  const mkPost = (id: string, likes: number, comments: number, reach: number, daysAgo: number, mediaType = 'IMAGE'): InstagramPost => ({
    id, caption: 'Hoje é dia de promoção especial! Vem conferir nosso cardápio de hoje, com ofertas exclusivas pra você que acompanha a gente por aqui 🔥',
    mediaType, thumbnailUrl: `https://picsum.photos/seed/ig${id}/400/400`,
    permalink: '#', timestamp: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    likes, comments, reach, saves: Math.round(likes * 0.2), videoViews: mediaType === 'VIDEO' ? reach * 2 : 0,
  });
  const igPosts: InstagramPost[] = [
    mkPost('p1', 120, 14, 3200, 1), mkPost('p2', 340, 45, 8900, 3, 'VIDEO'),
    mkPost('p3', 80, 6, 1800, 5), mkPost('p4', 210, 22, 4100, 7, 'CAROUSEL_ALBUM'),
    mkPost('p5', 95, 9, 2200, 9), mkPost('p6', 410, 60, 11200, 11, 'VIDEO'),
    mkPost('p7', 70, 4, 1500, 13), mkPost('p8', 150, 18, 3300, 15),
  ];

  const creatives: Creative[] = [
    { nome: 'Criativo Combo Família', spend: 800, resultado: 42, thumbnail_url: 'https://picsum.photos/seed/cr1/300/300' },
    { nome: 'Criativo Promo Sexta', spend: 600, resultado: 31, thumbnail_url: 'https://picsum.photos/seed/cr2/300/300' },
    { nome: 'Criativo Anota Aí', spend: 400, resultado: 18, thumbnail_url: 'https://picsum.photos/seed/cr3/300/300' },
  ];

  const diag: DiagJson = {
    diagnostico: 'A PicoLocos manteve performance estável em maio, com leve queda no faturamento frente a abril, mas com sinais claros de oportunidade na base inativa e no tráfego pago de conversa.',
    forcas: [
      { titulo: 'Ticket médio em alta', descricao: 'O ticket médio cresceu mesmo com a leve queda em pedidos, indicando que os clientes ativos estão gastando mais por compra.' },
      { titulo: 'Base ativa engajada', descricao: 'Recorrência de 60% entre os clientes ativos mostra fidelização saudável no núcleo da base.' },
    ],
    pontos_fortes: [
      'Ticket médio subiu 0,4% mesmo com queda de pedidos.',
      'Campanha de WhatsApp Aniversário gerou 332 conversas a custo baixo.',
      'Centro e Jardim das Flores concentram quase metade do faturamento.',
    ],
    pontos_atencao: [
      '84% da base está inativa — maior alavanca de crescimento não explorada.',
      'Sexta-feira concentra 21% dos pedidos — risco de operação sobrecarregada num único dia.',
    ],
    plano: [
      { acao: 'Campanha de reativação via WhatsApp', objetivo: 'Reativar clientes inativos há 30-60 dias', publico: '1.200 clientes inativos recentes', mensagem: 'Oferta de retorno com cupom de primeira compra novamente' },
      { acao: 'Cupom de quarta-feira', objetivo: 'Equilibrar a demanda semanal', publico: 'Base ativa completa', mensagem: 'Desconto exclusivo para pedidos feitos às quartas' },
    ],
    insight_campanha_conversa: 'Campanhas de conversa via WhatsApp tiveram o menor custo por resultado do mês.',
    insight_campanha_conversao: 'Anota Aí Low Budget entregou o melhor ROAS entre as campanhas de venda direta.',
    frase_fechamento: 'Junho deve focar em recorrência: reativar a base inativa é a maior oportunidade de crescimento da PicoLocos.',
    jornada: ['Descoberta via Instagram/Meta Ads', 'Primeira compra via iFood', 'Reativação via WhatsApp', 'Fidelização com cupons recorrentes'],
  };

  const periodo = 'Maio/2026';
  const prevPeriodo = 'Abril/2026';

  const hasVisao = true, hasDia = true, hasRegiao = true, hasBase = true, hasInat = true, hasProd = true;
  const hasMeta = true, hasInstagram = true, hasInstagramPosts = true, hasInstagramSpotlight = true;
  const hasDestaques = true, hasCriativos = true, hasDiagFat = true, hasPlanoDetalh = true;

  const total = 1 + 14 + 2; // cover + 14 conditional sections (all true here) + diag A/Plan
  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, 'PicoLocos', periodo, prevPeriodo, diag, total));
  if (hasVisao)              slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo));
  if (hasDia)                slides.push(sPorDia(data, ++i, total));
  if (hasRegiao)             slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)               slides.push(sBase(data, ++i, total));
  if (hasInat)               slides.push(sInativos(data, ++i, total));
  if (hasProd)               slides.push(sProdutos(data, ++i, total));
  if (hasMeta)               slides.push(sMetaAdsResumo(meta, ++i, total));
  if (hasInstagram)          slides.push(sInstagram(instagram, ++i, total));
  if (hasInstagramPosts)     slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));
  slides.push(sDiagnosticoA(diag, ++i, total));
  slides.push(sDiagnosticoPlan(diag, ++i, total));
  if (hasDestaques)          slides.push(sMetaAdsCampanhas(meta, diag, ++i, total));
  if (hasCriativos)          slides.push(sCriativos(creatives, ++i, total));
  if (hasDiagFat)            slides.push(sDiagnosticoFat(diag, data, bairros, ++i, total));
  if (hasPlanoDetalh)        slides.push(sPlanoDetalhado(diag, ++i, total));

  const fontLink = `<style>@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap');</style>`;
  return `${fontLink}<div style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>`;
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewInstagram(): string {
  const ig: InstagramData = {
    username: 'picolocos.oficial', followers: 8240, reach: 42000, impressions: 61000,
    profile_views: 1850, website_clicks: 620, accounts_engaged: 3100,
  };
  return sInstagram(ig, 9, 17);
}
