import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import { makeServerPool } from '@/lib/server-db';
import { getFreshMetaToken } from '@/lib/meta-token';
import { randomUUID } from 'crypto';

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
  return { label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`, up: diff >= 0, hasData: true };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const PRIMARY      = '#55f52f';   // graphic fills only (bars, borders, squares)
const PRIMARY_TEXT = '#1a8a00';   // green as readable text on white (5.4:1 contrast)
const CARD         = '#F7F8FA';
const BG           = '#FFFFFF';
const BORDER       = '#E2E8F0';
const FG           = '#111827';   // near-black — titles, values
const MUTED        = '#374151';   // cinza chumbo — body text, labels, secondary
const RED          = '#DC2626';
const BLUE         = '#0B84FF';
const ORANGE       = '#FF6B35';

const INTER = 'var(--font-inter), Inter, sans-serif';
const BEBAS = 'var(--font-bebas), "Bebas Neue", sans-serif';

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
    const url = `https://graph.facebook.com/v21.0/${ad.ad_id}?fields=creative{thumbnail_url}&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    let thumbnail_url: string | null = null;
    if (res?.ok) {
      const j = await res.json() as { creative?: { thumbnail_url?: string } };
      thumbnail_url = j.creative?.thumbnail_url ?? null;
    }
    return { nome: ad.ad_name, spend: ad.spend, resultado: ad.resultado, thumbnail_url };
  }));

  return { meta, creatives };
}

async function fetchInstagramInsights(
  connectionId: string | null | undefined,
  from: string, to: string,
): Promise<InstagramData | null> {
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

  // Discover Instagram Business accounts via Facebook Pages
  const pagesUrl = new URL('https://graph.facebook.com/v21.0/me/accounts');
  pagesUrl.searchParams.set('fields', 'id,name,instagram_business_account{id,username,followers_count}');
  pagesUrl.searchParams.set('access_token', token);
  const pagesRes = await fetch(pagesUrl.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!pagesRes?.ok) return null;

  const pagesData = await pagesRes.json() as {
    data?: Array<{ instagram_business_account?: { id: string; username: string; followers_count: number } }>;
  };
  const igAccounts = (pagesData.data ?? [])
    .map(p => p.instagram_business_account)
    .filter((a): a is { id: string; username: string; followers_count: number } => !!a);
  if (!igAccounts.length) return null;

  const ig = igAccounts[0];

  // Fetch profile-level insights for the period
  const insUrl = new URL(`https://graph.facebook.com/v21.0/${ig.id}/insights`);
  insUrl.searchParams.set('metric', 'reach,impressions,profile_views,website_clicks,accounts_engaged');
  insUrl.searchParams.set('period', 'total_over_range');
  insUrl.searchParams.set('since', from);
  insUrl.searchParams.set('until', to);
  insUrl.searchParams.set('access_token', token);
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

  return { username: ig.username, followers: ig.followers_count, reach, impressions, profile_views, website_clicks, accounts_engaged };
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

// Comparison bar chart for sVisaoGeral — paired horizontal bars, div-based inline HTML
function compBarsHtml(
  metrics: Array<{ label: string; cur: number; prv: number; fmt: (n: number) => string }>,
): string {
  const rows = metrics.map(m => {
    const d = deltaInfo(m.cur, m.prv);
    const maxVal = Math.max(m.cur, m.prv, 1);
    const curPct = (m.cur / maxVal * 100).toFixed(1);
    const prvPct = (m.prv / maxVal * 100).toFixed(1);
    const deltaColor = d.up ? PRIMARY : RED;
    const deltaHtml  = d.hasData
      ? `<span style="font-size:11px;font-weight:700;color:${deltaColor};font-family:${INTER};margin-left:8px">${d.up ? '↑' : '↓'} ${d.label}</span>`
      : '';
    return `
    <div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${MUTED};font-family:${INTER}">${m.label}</span>
        ${deltaHtml}
      </div>
      <!-- Período atual -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">
        <span style="font-size:11px;font-weight:700;color:${PRIMARY_TEXT};width:50px;text-align:right;flex-shrink:0;font-family:${INTER}">ATUAL</span>
        <div style="flex:1;height:10px;background:${BORDER};overflow:hidden">
          <div style="height:100%;background:${PRIMARY};width:${curPct}%;box-shadow:0 0 6px ${PRIMARY}60"></div>
        </div>
        <span style="font-size:13px;font-weight:700;color:${FG};width:130px;font-family:${INTER};flex-shrink:0">${m.cur > 0 ? m.fmt(m.cur) : '—'}</span>
      </div>
      <!-- Período anterior -->
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:${MUTED};width:50px;text-align:right;flex-shrink:0;font-family:${INTER}">ANT.</span>
        <div style="flex:1;height:10px;background:${BORDER};overflow:hidden">
          <div style="height:100%;background:${MUTED};opacity:0.35;width:${prvPct}%"></div>
        </div>
        <span style="font-size:13px;color:${MUTED};width:130px;font-family:${INTER};flex-shrink:0">${m.prv > 0 ? m.fmt(m.prv) : '—'}</span>
      </div>
    </div>`;
  }).join('');
  return rows;
}

// ── HTML component helpers ─────────────────────────────────────────────────────

// ── Core layout primitives ────────────────────────────────────────────────────

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
      <h2 style="font-family:${BEBAS};font-size:34px;color:${FG};margin:0;line-height:1;letter-spacing:0.02em">${thesis}</h2>
      <p style="font-size:11px;font-weight:600;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;margin:5px 0 0;font-family:${INTER}">${context}</p>
    </div>
  </div>
</div>`;
}

/** Legacy alias so old call-sites keep compiling — thesis + sub */
function secTitle(title: string, sub: string): string { return sectionHeader(title, sub); }

/** Hero KPI — ONE per slide, the anchor metric */
function kpiHero(label: string, value: string, sub: string, color = PRIMARY): string {
  const isEmpty = value === '—';
  const textColor = color === PRIMARY ? PRIMARY_TEXT : color;
  return `<div style="position:relative;overflow:hidden;border:1px solid ${color}40;background:${CARD};padding:28px 28px 24px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${color},${color}00)"></div>
  <div style="position:absolute;top:0;left:0;width:14px;height:14px;background:${color}"></div>
  <p style="font-size:10px;font-weight:700;color:${textColor};text-transform:uppercase;letter-spacing:0.12em;font-family:${INTER};margin:4px 0 10px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '40' : '76'}px;color:${isEmpty ? MUTED : FG};line-height:0.9;margin:0 0 10px;letter-spacing:0.01em">${value}</p>
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
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '28' : '38'}px;color:${isEmpty ? MUTED : FG};line-height:1;margin:0 0 5px">${value}</p>
  <p style="font-size:11px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${context}</p>
</div>`;
}

function kpiWithDelta(label: string, value: string, prevValue: string, delta: { label: string; up: boolean; hasData: boolean }, accentColor = PRIMARY): string {
  const isEmpty = value === '—';
  const deltaHtml = delta.hasData
    ? `<span style="font-size:11px;font-weight:700;color:${delta.up ? PRIMARY : RED};font-family:${INTER};margin-left:6px">${delta.up ? '↑' : '↓'} ${delta.label}</span>`
    : '';
  const prevHtml = prevValue && prevValue !== '—'
    ? `<span style="font-size:11px;color:${MUTED};font-family:${INTER}">ant: ${prevValue}</span>`
    : (isEmpty ? `<span style="font-size:11px;color:${MUTED};font-family:${INTER}">Dado não integrado</span>` : '');
  return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};background:${CARD};padding:20px 18px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:4px 0 8px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '28' : '38'}px;color:${isEmpty ? MUTED : FG};line-height:1;margin:0 0 7px">${value}${deltaHtml}</p>
  <p style="font-size:11px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${prevHtml}</p>
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
  const badge      = status === 'winner' ? `<span style="font-size:9px;font-weight:800;color:${BG};background:${PRIMARY};padding:2px 7px;letter-spacing:0.08em;font-family:${INTER}">CAMPEÃ</span>`
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
      <p style="font-size:10px;font-weight:700;color:${i===0?BG:MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:${INTER};margin:0">${LABELS[s]??s}</p>
    </div>`).join('')}
  </div>`;
}

function tableRow(cells: { text: string; right?: boolean; bold?: boolean; color?: string }[], stripe: boolean): string {
  const bg = stripe ? CARD : BG;
  const tds = cells.map(c =>
    `<td style="padding:9px 14px;font-size:12px;font-family:${INTER};text-align:${c.right?'right':'left'};font-weight:${c.bold?'700':'400'};color:${c.color??FG}">${c.text}</td>`,
  ).join('');
  return `<tr style="background:${bg};border-bottom:1px solid ${BORDER}">${tds}</tr>`;
}

// ── Slide builders ────────────────────────────────────────────────────────────

// ── Slide builders — Executive Layout Recipes ─────────────────────────────────

function sCapa(
  d: ParsedData, meta: MetaAdsFull | null, clientName: string,
  periodo: string, prevPeriodo: string, diag: DiagJson, total: number,
): string {
  const prevLine = prevPeriodo
    ? `<span style="font-size:12px;color:${MUTED};font-family:${INTER}"> · vs. ${prevPeriodo}</span>` : '';

  const fechamento = diag.frase_fechamento
    ? `<div style="margin-top:24px;border-left:3px solid ${PRIMARY};padding:12px 18px;background:${PRIMARY}0D">
        <p style="font-size:14px;color:${FG};font-family:${INTER};line-height:1.65;margin:0;font-style:italic">"${diag.frase_fechamento}"</p>
      </div>` : '';

  // Right side: hero metric + 3 secondary KPIs
  const heroHtml = d.faturamento > 0
    ? kpiHero('Faturamento do Período', brlOrDash(d.faturamento), `${numOrDash(d.pedidos_ativos)} pedidos · ticket médio ${brlOrDash(d.ticket)}`)
    : d.ativos > 0
    ? kpiHero('Clientes Ativos', numOrDash(d.ativos), `${numOrDash(d.inativos)} inativos · ${numOrDash(d.potenciais)} potenciais`)
    : meta
    ? kpiHero('Investimento Meta Ads', brlOrDash(meta.investimento), `${numOrDash(meta.alcance)} pessoas alcançadas`, BLUE)
    : '';

  const secondary = [
    d.ticket > 0    && kpi('Ticket Médio', brlOrDash(d.ticket), 'por pedido — clientes ativos'),
    d.ativos > 0    && kpi('Clientes Ativos', numOrDash(d.ativos), `${numOrDash(d.inativos)} inativos`),
    meta            && kpi('Meta Ads', brlOrDash(meta.investimento), `${numOrDash(meta.cliques)} cliques`, BLUE),
  ].filter(Boolean) as string[];

  const body = `<div style="flex:1;display:flex;gap:0;align-items:stretch">
  <!-- Identity side -->
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding-right:48px;border-right:1px solid ${BORDER};position:relative;overflow:hidden">
    <div style="position:absolute;bottom:-80px;left:-80px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}0F,transparent 70%)"></div>
    <p style="font-size:10px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.16em;font-family:${INTER};margin:0 0 14px">Relatório de Performance — Delivery</p>
    <h1 style="font-family:${BEBAS};font-size:72px;color:${FG};margin:0;line-height:0.9;letter-spacing:0.02em">${clientName}</h1>
    <p style="font-size:14px;color:${MUTED};margin:14px 0 0;font-family:${INTER}">${periodo}${prevLine}</p>
    ${fechamento}
  </div>
  <!-- Metrics side -->
  <div style="width:560px;flex-shrink:0;display:flex;flex-direction:column;justify-content:center;padding-left:48px;gap:14px">
    ${heroHtml}
    ${secondary.length ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(secondary.length,3)},1fr);gap:10px">${secondary.join('')}</div>` : ''}
  </div>
</div>`;
  return auditSlide(wrapSlide(body, 1, total), 'sCapa');
}

function sVisaoGeral(d: ParsedData, prevD: ParsedData | null, idx: number, total: number): string {
  const dFat    = deltaInfo(d.faturamento,    prevD?.faturamento    ?? 0);
  const dPed    = deltaInfo(d.pedidos_ativos, prevD?.pedidos_ativos ?? 0);
  const dTicket = deltaInfo(d.ticket,         prevD?.ticket         ?? 0);

  // Dynamic thesis title
  let thesis = 'Resultado do período em faturamento, pedidos e ticket';
  if (dFat.hasData) {
    const dir = dFat.up ? 'cresceu' : 'caiu';
    thesis = `Faturamento ${dir} ${dFat.label} — ${dTicket.up ? 'ticket sustenta a margem' : 'ticket caiu junto com o volume'}`;
  }

  // LEFT: comparison bars or secondary KPIs
  let leftContent: string;
  if (prevD) {
    leftContent = compBarsHtml([
      { label: 'Faturamento', cur: d.faturamento, prv: prevD.faturamento, fmt: brl },
      { label: 'Total de Pedidos', cur: d.pedidos_ativos, prv: prevD.pedidos_ativos, fmt: num },
      { label: 'Ticket Médio', cur: d.ticket, prv: prevD.ticket, fmt: brl },
    ]);
  } else {
    const freq = d.ativos > 0 && d.pedidos_ativos > 0 ? (d.pedidos_ativos / d.ativos).toFixed(1) : '—';
    leftContent = `
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:16px">
        ${kpi('Clientes Ativos', numOrDash(d.ativos), 'compraram no período')}
        ${kpi('Inativos', numOrDash(d.inativos), 'sem pedido no período', RED)}
        ${kpi('Potenciais', numOrDash(d.potenciais), 'nunca compraram', BLUE)}
        ${kpi('Freq. Média', freq === '—' ? '—' : `${freq}×`, 'pedidos por cliente ativo')}
      </div>
      ${insight('Sem comparativo', 'Para exibir variação vs mês anterior, envie os CSVs com prefixo ant- (ex: ant-ativos.csv).')}`;
  }

  // RIGHT: hero faturamento + 3 KPI chips
  const rightContent = `
    ${kpiHero('Faturamento', brlOrDash(d.faturamento), `${numOrDash(d.pedidos_ativos)} pedidos no período`)}
    <div style="display:grid;grid-template-columns:1fr;gap:10px;margin-top:12px">
      ${kpiWithDelta('Pedidos', numOrDash(d.pedidos_ativos), prevD ? numOrDash(prevD.pedidos_ativos) : '', dPed)}
      ${kpiWithDelta('Ticket Médio', brlOrDash(d.ticket), prevD ? brlOrDash(prevD.ticket) : '', dTicket)}
    </div>`;

  const conclusion = dFat.hasData
    ? `${dFat.up ? 'Crescimento confirmado' : 'Queda identificada'}: ${dFat.label} vs período anterior. ${dTicket.up ? 'O ticket médio subiu — sinal de upgrade no mix de produtos.' : 'O ticket médio caiu — revisar o mix e promoções.'}`
    : `Base ativa de ${numOrDash(d.ativos)} clientes gerou ${brlOrDash(d.faturamento)} com ticket médio de ${brlOrDash(d.ticket)}.`;

  const body = `
${sectionHeader(thesis, 'Faturamento · Pedidos · Ticket — clientes ativos no período')}
<div style="display:grid;grid-template-columns:1fr 380px;gap:28px;flex:1">
  <div>${leftContent}</div>
  <div>${rightContent}</div>
</div>
${thesisBanner(conclusion)}`;
  return auditSlide(wrapSlide(body, idx, total), 'sVisaoGeral');
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
    return `<tr style="background:${i%2===0?CARD:BG};border-bottom:1px solid ${BORDER}">
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
  const pA  = tot ? (d.ativos  / tot * 100).toFixed(0) : '0';
  const pI  = tot ? (d.inativos / tot * 100).toFixed(0) : '0';
  const pP  = tot ? (d.potenciais / tot * 100).toFixed(0) : '0';

  const totalAtivos = d.uma_compra + d.recorrentes;
  const pRec = totalAtivos ? (d.recorrentes / totalAtivos * 100).toFixed(0) : '0';
  const pUma = totalAtivos ? (d.uma_compra / totalAtivos * 100).toFixed(0) : '0';
  const hasDistrib = d.uma_compra > 0 || d.recorrentes > 0;

  // Thesis: frequency-driven if data available
  const thesis = hasDistrib
    ? (parseInt(pUma) > 50
        ? `${pUma}% comprou só uma vez — converter a 2ª compra é o maior ganho do mês`
        : `${pRec}% da base ativa já recompra — a recorrência sustenta o resultado`)
    : `Base total de ${numOrDash(tot)} clientes — ${pA}% ativos, ${pI}% inativos`;

  const donut = donutSvg([
    { label: 'Ativos',       value: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     value: d.inativos,   color: RED },
    { label: 'Em Potencial', value: d.potenciais, color: BLUE },
  ]);

  const legend = [
    { label: 'Ativos',       pct: pA, count: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     pct: pI, count: d.inativos,   color: RED },
    { label: 'Em Potencial', pct: pP, count: d.potenciais, color: BLUE },
  ].map(l => `<div style="display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid ${BORDER}">
    <div style="width:8px;height:8px;background:${l.color};flex-shrink:0"></div>
    <span style="flex:1;font-size:13px;font-weight:600;color:${FG};font-family:${INTER}">${l.label}</span>
    <span style="font-size:28px;font-family:${BEBAS};color:${FG};line-height:1">${numOrDash(l.count)}</span>
    <span style="font-size:12px;font-weight:700;color:${l.color};font-family:${INTER};width:40px;text-align:right">${l.pct}%</span>
  </div>`).join('');

  // Right side: hero stats for 1x vs 2x+
  const rightContent = hasDistrib ? `
    <div style="margin-bottom:14px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 14px">Frequência de Compra</p>
      <div style="display:flex;gap:0">
        <div style="flex:1;border:1px solid ${ORANGE}40;background:${ORANGE}0A;padding:16px;text-align:center">
          <p style="font-family:${BEBAS};font-size:52px;color:${FG};margin:0;line-height:1">${num(d.uma_compra)}</p>
          <p style="font-size:11px;font-weight:700;color:${ORANGE};font-family:${INTER};margin:5px 0 0">1× — ${pUma}%</p>
        </div>
        <div style="flex:1;border:1px solid ${PRIMARY}40;background:${PRIMARY}0A;padding:16px;text-align:center;border-left:none">
          <p style="font-family:${BEBAS};font-size:52px;color:${FG};margin:0;line-height:1">${num(d.recorrentes)}</p>
          <p style="font-size:11px;font-weight:700;color:${PRIMARY};font-family:${INTER};margin:5px 0 0">2×+ — ${pRec}%</p>
        </div>
      </div>
    </div>
    ${parseInt(pUma) > 50
      ? insight('Oportunidade clara', `${num(d.uma_compra)} clientes compraram só 1 vez. Uma campanha de 2ª compra com cupom pode converter 20–30% deles.`, ORANGE)
      : insight('Recorrência saudável', `${pRec}% dos ativos já recompraram. Foco em aumentar a frequência e elevar o ticket médio por pedido.`, PRIMARY)}`
    : insight('Frequência não mapeada', 'A coluna de quantidade de pedidos não foi encontrada nos CSVs. Para ver distribuição 1× vs 2×+, inclua uma coluna "qtd_pedidos" no arquivo de ativos.');

  const conclusion = hasDistrib
    ? (parseInt(pUma) > 50
      ? `Prioridade: campanha de 2ª compra para ${num(d.uma_compra)} clientes que compraram só 1× — é a maior oportunidade de crescimento disponível.`
      : `Base de recorrência sólida (${pRec}%). Estratégia: aumentar frequência e ticket dos ${num(d.recorrentes)} clientes fiéis.`)
    : `Base total: ${numOrDash(tot)} cadastros. ${pA}% ativos, ${pI}% inativos — os inativos recentes são o maior ativo escondido.`;

  const body = `
${sectionHeader(thesis, `Total: ${numOrDash(tot)} clientes cadastrados`)}
<div style="display:grid;grid-template-columns:360px 1fr;gap:32px;flex:1;align-items:start">
  <div>
    ${donut}
    ${legend}
  </div>
  <div>${rightContent}</div>
</div>
${thesisBanner(conclusion)}`;
  return auditSlide(wrapSlide(body, idx, total), 'sBase');
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

function sMetaAds(meta: MetaAdsFull, idx: number, total: number): string {
  const cpc = meta.cliques ? brl(meta.investimento / meta.cliques) : '—';

  // Rank campaigns: winner = highest resultado (conversas+compras), loser = highest spend + lowest resultado
  const ranked = [...meta.campanhas].map(c => ({
    ...c,
    score: c.metricas.conversas + c.metricas.compras * 3 + (c.metricas.purchase_roas > 0 ? c.metricas.purchase_roas : 0),
  })).sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  const loser  = ranked.length > 1
    ? [...ranked].sort((a, b) => b.metricas.investimento - b.score - (a.metricas.investimento - a.score))[ranked.length - 1]
    : null;

  const thesis = winner
    ? `Uma campanha concentra o retorno — priorizar a verba de "${winner.nome.slice(0,30)}${winner.nome.length>30?'…':''}" aumenta o ROAS`
    : 'Investimento em Meta Ads — resultados e alcance no período';

  function campMetrics(c: typeof ranked[0]): Array<{label:string;value:string}> {
    const m = c.metricas;
    const rows: Array<{label:string;value:string}> = [
      { label: 'Investido', value: brlOrDash(m.investimento) },
      { label: 'Alcance',   value: numOrDash(m.alcance) },
    ];
    if (m.frequencia > 0) rows.push({ label: 'Freq.', value: `${m.frequencia.toFixed(1)}×` });
    if (m.conversas > 0)  rows.push({ label: 'Conversas', value: num(Math.round(m.conversas)) });
    if (m.compras > 0)    rows.push({ label: 'Compras', value: num(Math.round(m.compras)) });
    if (m.purchase_roas > 0) rows.push({ label: 'ROAS', value: `${m.purchase_roas.toFixed(2)}×` });
    return rows;
  }

  const winnerCard = winner
    ? rankCard(1, winner.nome, campMetrics(winner), 'winner')
    : '';
  const otherCards = ranked.slice(1).map((c, i) =>
    rankCard(i + 2, c.nome, campMetrics(c), c === loser ? 'loser' : 'normal'),
  ).join('');

  const conclusion = winner
    ? (winner.metricas.purchase_roas > 2
        ? `ROAS de ${winner.metricas.purchase_roas.toFixed(1)}× na campanha vencedora — cada real investido retornou ${brl(winner.metricas.purchase_roas)}. Escalar o orçamento nessa campanha.`
        : winner.metricas.conversas > 0
        ? `${num(Math.round(winner.metricas.conversas))} conversas iniciadas na campanha líder — nutrição via WhatsApp converte esses contatos em pedidos.`
        : `Campanha líder investiu ${brlOrDash(winner.metricas.investimento)} e alcançou ${numOrDash(winner.metricas.alcance)} pessoas.`)
    : `Total investido: ${brlOrDash(meta.investimento)} · alcance de ${numOrDash(meta.alcance)} pessoas · ${numOrDash(meta.cliques)} cliques.`;

  const body = `
${sectionHeader(thesis, 'Meta Ads — investimento e resultados por campanha')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
  ${kpi('Investimento', brlOrDash(meta.investimento), 'total em anúncios', BLUE)}
  ${kpi('Alcance', numOrDash(meta.alcance), 'pessoas únicas', BLUE)}
  ${kpi('Impressões', numOrDash(meta.impressoes), 'exibições totais', BLUE)}
  ${kpi('CPC', cpc, `${numOrDash(meta.cliques)} cliques`, BLUE)}
</div>
${ranked.length ? `<div style="display:grid;grid-template-columns:${ranked.length > 1 ? '1fr 1fr' : '1fr'};gap:14px">
  <div>${winnerCard}</div>
  ${ranked.length > 1 ? `<div style="display:grid;grid-template-columns:1fr;gap:10px">${otherCards}</div>` : ''}
</div>` : ''}
${thesisBanner(conclusion, 'insight')}`;
  return auditSlide(wrapSlide(body, idx, total), 'sMetaAds');
}

// ── Instagram Insights ────────────────────────────────────────────────────────

function sInstagram(ig: InstagramData, idx: number, total: number): string {
  const engRate = ig.reach > 0 ? (ig.accounts_engaged / ig.reach) * 100 : 0;

  const IG_COLOR = '#E1306C';

  const metricRow = (label: string, value: string, sub: string) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid ${BORDER}">
      <div>
        <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0">${label}</p>
        <p style="font-size:10px;color:${MUTED};font-family:${INTER};margin:2px 0 0">${sub}</p>
      </div>
      <span style="font-family:${BEBAS};font-size:28px;color:${FG};letter-spacing:0.04em">${value}</span>
    </div>`;

  const body = `
${sectionHeader(
  ig.reach > 0
    ? `@${ig.username} alcançou ${numOrDash(ig.reach)} pessoas — o orgânico aquece antes do anúncio`
    : `@${ig.username} · visibilidade orgânica no período`,
  'Instagram Business Insights · alcance, engajamento e conversão para o perfil'
)}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;flex:1;align-items:start">
  <div>
    ${kpiHero('Alcance', numOrDash(ig.reach), 'contas únicas atingidas no período', IG_COLOR)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">
      ${kpi('Seguidores', numOrDash(ig.followers), 'total acumulado', IG_COLOR)}
      ${kpi('Impressões', numOrDash(ig.impressions), 'exibições totais', MUTED)}
    </div>
  </div>
  <div style="border:1px solid ${BORDER};background:${CARD};padding:0 16px">
    <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:14px 0 2px">Métricas de Conversão Orgânica</p>
    ${metricRow('Contas Engajadas', numOrDash(ig.accounts_engaged), `${engRate.toFixed(1)}% taxa de engajamento`)}
    ${metricRow('Visitas ao Perfil', numOrDash(ig.profile_views), 'acessos ao perfil no período')}
    ${metricRow('Cliques no link da bio', numOrDash(ig.website_clicks), 'acesso ao site / cardápio')}
  </div>
</div>
${thesisBanner(
  ig.accounts_engaged > 0
    ? `${numOrDash(ig.accounts_engaged)} contas engajaram com o perfil (${engRate.toFixed(1)}% do alcance). Audiência orgânica aquecida converte melhor em campanhas pagas.`
    : `Perfil @${ig.username} alcançou ${numOrDash(ig.reach)} pessoas de forma orgânica no período — base pronta para ser convertida via anúncio.`
)}`;

  return auditSlide(wrapSlide(body, idx, total), 'sInstagram');
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
          <span style="font-size:12px;font-weight:800;color:${BG};font-family:${INTER}">${i+1}</span>
        </div>
        <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      </div>
      ${p.objetivo ? `<p style="font-size:11px;color:${PRIMARY};font-family:${INTER};margin:0;line-height:1.4">Obj: ${p.objetivo}</p>` : ''}
      ${p.publico  ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4">Para: ${p.publico}</p>` : ''}
      ${p.mensagem ? `<div style="padding:6px 8px;background:${BG};border:1px solid ${BORDER}">
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
        : `<div style="width:100%;aspect-ratio:16/9;background:${BG};display:flex;align-items:center;justify-content:center">
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

function sDestaqueCampanhas(meta: MetaAdsFull, diag: DiagJson, idx: number, total: number): string {
  const conversa  = meta.campanhas.filter(c => c.metricas.conversas > 0 || c.tipo.toLowerCase().includes('messages'));
  const conversao = meta.campanhas.filter(c => c.metricas.compras > 0 || c.tipo.toLowerCase().includes('conversions'));
  const others    = meta.campanhas.filter(c => !conversa.includes(c) && !conversao.includes(c));

  function sectionConversa(camps: CampanhaDetalhada[]) {
    if (!camps.length) return '';
    const sorted = [...camps].sort((a, b) => b.metricas.conversas - a.metricas.conversas);
    const cards = sorted.map((c, i) => {
      const m = c.metricas;
      const metrics: Array<{label:string;value:string}> = [
        { label: 'Investido',     value: brlOrDash(m.investimento) },
        { label: 'Alcance',       value: numOrDash(m.alcance) },
        { label: 'Freq.',         value: `${m.frequencia.toFixed(1)}×` },
        { label: 'Mensagens',     value: m.conversas > 0 ? num(Math.round(m.conversas)) : '—' },
        { label: 'Custo/msg',     value: m.conversas > 0 && m.investimento > 0 ? brl(m.investimento / m.conversas) : '—' },
      ];
      return rankCard(i + 1, c.nome, metrics, i === 0 ? 'winner' : 'normal');
    }).join('');
    return `<div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="width:3px;height:14px;background:${PRIMARY}"></div>
        <p style="font-size:10px;font-weight:700;color:${PRIMARY_TEXT};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0">Campanhas de Conversa — métrica: mensagens iniciadas</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(sorted.length,3)},1fr);gap:10px;margin-bottom:8px">${cards}</div>
      ${diag.insight_campanha_conversa ? insight('Análise', diag.insight_campanha_conversa, PRIMARY) : ''}
    </div>`;
  }

  function sectionVendas(camps: CampanhaDetalhada[]) {
    if (!camps.length) return '';
    const sorted = [...camps].sort((a, b) => b.metricas.purchase_roas - a.metricas.purchase_roas);
    const cards = sorted.map((c, i) => {
      const m = c.metricas;
      const metrics: Array<{label:string;value:string}> = [
        { label: 'Investido',     value: brlOrDash(m.investimento) },
        { label: 'Valor vendas',  value: m.valor_compras > 0 ? brl(m.valor_compras) : '—' },
        { label: 'Vendas',        value: m.compras > 0 ? num(Math.round(m.compras)) : '—' },
        { label: 'ROAS',          value: m.purchase_roas > 0 ? `${m.purchase_roas.toFixed(2)}×` : '—' },
        { label: 'Custo/venda',   value: m.compras > 0 && m.investimento > 0 ? brl(m.investimento / m.compras) : '—' },
      ];
      return rankCard(i + 1, c.nome, metrics, i === 0 ? 'winner' : 'normal');
    }).join('');
    return `<div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="width:3px;height:14px;background:${ORANGE}"></div>
        <p style="font-size:10px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0">Campanhas de Vendas — métrica: valor e quantidade de vendas</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(sorted.length,3)},1fr);gap:10px;margin-bottom:8px">${cards}</div>
      ${diag.insight_campanha_conversao ? insight('Análise', diag.insight_campanha_conversao, ORANGE) : ''}
    </div>`;
  }

  function sectionOthers(camps: CampanhaDetalhada[]) {
    if (!camps.length) return '';
    const cards = camps.map((c, i) => {
      const m = c.metricas;
      const metrics: Array<{label:string;value:string}> = [
        { label: 'Investido', value: brlOrDash(m.investimento) },
        { label: 'Alcance',   value: numOrDash(m.alcance) },
        { label: 'Cliques',   value: numOrDash(m.cliques) },
        { label: 'Freq.',     value: `${m.frequencia.toFixed(1)}×` },
      ];
      return rankCard(i + 1, c.nome, metrics, i === 0 ? 'winner' : 'normal');
    }).join('');
    return `<div style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <div style="width:3px;height:14px;background:${BLUE}"></div>
        <p style="font-size:10px;font-weight:700;color:${BLUE};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0">Demais Campanhas — alcance e engajamento</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(camps.length,3)},1fr);gap:10px">${cards}</div>
    </div>`;
  }

  const body = `
${sectionHeader('Cada campanha tem um objetivo — compare pelo custo por resultado, não pelo investimento', 'Análise expandida Meta Ads por tipo de campanha')}
<div style="flex:1;overflow:hidden">
  ${sectionConversa(conversa)}
  ${sectionVendas(conversao)}
  ${sectionOthers(others)}
</div>
${thesisBanner('Conversa = custo por mensagem. Venda = ROAS e valor gerado. Nunca misture as métricas de sucesso entre tipos de campanha.', 'neutral')}`;
  return auditSlide(wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA'), 'sDestaqueCampanhas');
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
            <span style="font-size:12px;font-weight:800;color:${BG};font-family:${INTER}">${i+1}</span>
          </div>
          ${etapa ? `<span style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;font-family:${INTER};border:1px solid ${BORDER};padding:2px 5px">${etapa}</span>` : ''}
        </div>
      </div>
      <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      ${p.objetivo ? `<p style="font-size:11px;color:${accent};font-family:${INTER};margin:0;line-height:1.4">Obj: ${p.objetivo}</p>` : ''}
      ${p.publico  ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4">Para: ${p.publico}</p>` : ''}
      ${p.mensagem ? `<div style="padding:5px 8px;background:${BG};border:1px solid ${BORDER}">
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

  const [bairros, { meta, creatives }, instagram] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaData(connectionId, accountIds, from, to),
    fetchInstagramInsights(connectionId, from, to),
  ]);

  console.log(`[delivery] ${clientName} | fat:${brlOrDash(data.faturamento)} ativos:${data.ativos} prod:${data.produtos.length} bairros:${bairros.length} meta:${meta ? 'sim' : 'não'} ig:${instagram ? `@${instagram.username}` : 'não'} criativos:${creatives.length} prev:${hasPrev}`);

  const diag = await fetchDiagnosis(data, prevData, meta, bairros, clientName, periodo, agencyContext);

  const hasVisao       = data.faturamento > 0 || data.pedidos_ativos > 0;
  const hasDia         = data.por_dia.length > 0;
  const hasBase        = data.ativos > 0 || data.inativos > 0 || data.potenciais > 0;
  const hasInat        = data.inativos_faixas.length > 0;
  const hasProd        = data.produtos.length > 0;
  const hasRegiao      = bairros.length > 0;
  const hasMeta        = meta !== null;
  const hasInstagram   = instagram !== null;
  const hasDestaques   = hasMeta && meta!.campanhas.length > 0;
  const hasDiagFat     = hasBase || hasRegiao;
  const hasPlanoDetalh = diag.plano.length > 0;
  const hasCriativos   = creatives.length > 0;

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
    + 2                           // sDiagnosticoA + sDiagnosticoPlan
    + (hasDestaques   ? 1 : 0)
    + (hasCriativos   ? 1 : 0)
    + (hasDiagFat     ? 1 : 0)
    + (hasPlanoDetalh ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total));
  if (hasVisao)       slides.push(sVisaoGeral(data, prevData, ++i, total));
  if (hasDia)         slides.push(sPorDia(data, ++i, total));
  if (hasRegiao)      slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)        slides.push(sBase(data, ++i, total));
  if (hasInat)        slides.push(sInativos(data, ++i, total));
  if (hasProd)        slides.push(sProdutos(data, ++i, total));
  if (hasMeta)        slides.push(sMetaAds(meta!, ++i, total));
  if (hasInstagram)   slides.push(sInstagram(instagram!, ++i, total));
  slides.push(sDiagnosticoA(diag, ++i, total));
  slides.push(sDiagnosticoPlan(diag, ++i, total));
  if (hasDestaques)   slides.push(sDestaqueCampanhas(meta!, diag, ++i, total));
  if (hasCriativos)   slides.push(sCriativos(creatives, ++i, total));
  if (hasDiagFat)     slides.push(sDiagnosticoFat(diag, data, bairros, ++i, total));
  if (hasPlanoDetalh) slides.push(sPlanoDetalhado(diag, ++i, total));

  return { html: `<div style="background:${BG};padding:28px;font-family:${INTER}">${slides.join('')}</div>` };
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
