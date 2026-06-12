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

const PRIMARY = '#55f52f';
const CARD    = '#1a1a1a';
const BG      = '#0e0f14';
const BORDER  = '#2a2d3a';
const FG      = '#f5f5f5';
const MUTED   = '#a0aec0';
const RED     = '#e52020';
const BLUE    = '#0B84FF';
const ORANGE  = '#FF6B35';

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
        <span style="font-size:11px;font-weight:700;color:${PRIMARY};width:50px;text-align:right;flex-shrink:0;font-family:${INTER}">ATUAL</span>
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

function wrapSlide(body: string, idx: number, total: number, tag?: string): string {
  const tagHtml = tag
    ? `<span style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};border:1px solid ${BORDER};padding:2px 8px">${tag}</span>`
    : '';
  return `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${BORDER};flex-shrink:0">
    <span style="font-family:${BEBAS};font-size:22px;color:${PRIMARY};letter-spacing:0.06em">ONMID</span>
    <div style="display:flex;align-items:center;gap:12px">${tagHtml}<span style="font-size:11px;color:${MUTED};font-family:${INTER};font-weight:600">${idx} / ${total}</span></div>
  </div>
  <div style="flex:1;padding:36px 48px 40px">${body}</div>
</div>`;
}

function secTitle(title: string, sub: string): string {
  return `<div style="display:flex;gap:14px;margin-bottom:24px;align-items:flex-start">
  <div style="width:4px;flex-shrink:0;background:${PRIMARY};margin-top:2px;align-self:stretch;min-height:36px"></div>
  <div>
    <h2 style="font-family:${BEBAS};font-size:32px;color:${FG};margin:0;line-height:1;letter-spacing:0.02em">${title}</h2>
    <p style="font-size:11px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;margin:4px 0 0;font-family:${INTER}">${sub}</p>
  </div>
</div>`;
}

function kpi(label: string, value: string, context: string, accentColor = PRIMARY): string {
  const isEmpty = value === '—';
  return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};border-radius:2px;background:${CARD};padding:24px 22px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:4px 0 10px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '32' : '42'}px;color:${isEmpty ? MUTED : FG};line-height:1;margin:0 0 6px">${value}</p>
  <p style="font-size:12px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${context}</p>
</div>`;
}

function kpiWithDelta(label: string, value: string, prevValue: string, delta: { label: string; up: boolean; hasData: boolean }, accentColor = PRIMARY): string {
  const isEmpty = value === '—';
  const deltaHtml = delta.hasData
    ? `<span style="font-size:11px;font-weight:700;color:${delta.up ? PRIMARY : RED};font-family:${INTER};margin-left:6px">${delta.up ? '↑' : '↓'} ${delta.label}</span>`
    : '';
  const prevHtml = prevValue && prevValue !== '—'
    ? `<span style="font-size:11px;color:${MUTED};font-family:${INTER}">ant: ${prevValue}</span>`
    : (isEmpty ? `<span style="font-size:11px;color:${MUTED};font-family:${INTER}">Dado não integrado neste período</span>` : '');
  return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};border-radius:2px;background:${CARD};padding:24px 22px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:4px 0 10px">${label}</p>
  <p style="font-family:${BEBAS};font-size:${isEmpty ? '32' : '42'}px;color:${isEmpty ? MUTED : FG};line-height:1;margin:0 0 8px">${value}${deltaHtml}</p>
  <p style="font-size:12px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${prevHtml}</p>
</div>`;
}

function hbar(label: string, value: string, pct: number, hi: boolean, barH = 6): string {
  const barColor = hi ? PRIMARY : `${PRIMARY}40`;
  const glow = hi ? `box-shadow:0 0 8px ${PRIMARY}80` : '';
  return `<div style="margin-bottom:12px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
    <span style="font-size:12px;font-weight:600;color:${FG};font-family:${INTER}">${label}</span>
    <span style="font-size:12px;font-weight:700;color:${hi ? PRIMARY : MUTED};font-family:${INTER}">${value}</span>
  </div>
  <div style="height:${barH}px;background:${BORDER};overflow:hidden">
    <div style="height:100%;background:${barColor};width:${Math.min(pct, 100).toFixed(1)}%;${glow}"></div>
  </div>
</div>`;
}

function insight(title: string, text: string): string {
  return `<div style="border:1px solid ${PRIMARY}4D;background:${PRIMARY}14;border-radius:2px;padding:14px 16px;margin-top:10px">
  <p style="font-size:10px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 5px">${title}</p>
  <p style="font-size:13px;color:${FG};line-height:1.6;margin:0;font-family:${INTER}">${text}</p>
</div>`;
}

function tableRow(cells: { text: string; right?: boolean; bold?: boolean; color?: string }[], stripe: boolean): string {
  const bg = stripe ? CARD : BG;
  const tds = cells.map(c =>
    `<td style="padding:10px 16px;font-size:13px;font-family:${INTER};text-align:${c.right ? 'right' : 'left'};font-weight:${c.bold ? '700' : '400'};color:${c.color ?? FG}">${c.text}</td>`,
  ).join('');
  return `<tr style="background:${bg};border-bottom:1px solid ${BORDER}">${tds}</tr>`;
}

// ── Slide builders ────────────────────────────────────────────────────────────

function sCapa(
  d: ParsedData, meta: MetaAdsFull | null, clientName: string,
  periodo: string, prevPeriodo: string, diag: DiagJson, total: number,
): string {
  const cards: string[] = [];
  if (d.faturamento > 0) cards.push(kpi('Faturamento', brlOrDash(d.faturamento), `${numOrDash(d.pedidos_ativos)} pedidos no período`));
  if (d.ticket > 0)      cards.push(kpi('Ticket Médio', brlOrDash(d.ticket), 'por pedido (clientes ativos)'));
  if (d.ativos > 0)      cards.push(kpi('Clientes Ativos', numOrDash(d.ativos), `${numOrDash(d.inativos)} inativos · ${numOrDash(d.potenciais)} potenciais`));
  if (meta)              cards.push(kpi('Investimento Meta', brlOrDash(meta.investimento), `${numOrDash(meta.cliques)} cliques · alcance ${numOrDash(meta.alcance)}`, BLUE));

  const prevLine = prevPeriodo ? `<span style="font-size:12px;color:${MUTED};font-family:${INTER}"> · comparado com ${prevPeriodo}</span>` : '';
  const fechamento = diag.frase_fechamento
    ? `<div style="margin-top:22px;border-left:3px solid ${PRIMARY};padding:12px 18px;background:${PRIMARY}0D">
        <p style="font-size:15px;color:${FG};font-family:${INTER};line-height:1.6;margin:0;font-style:italic">"${diag.frase_fechamento}"</p>
      </div>`
    : '';

  const body = `<div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:28px;position:relative">
  <div style="position:absolute;top:-100px;right:-100px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}1A,transparent 70%);pointer-events:none"></div>
  <div>
    <p style="font-size:11px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.14em;font-family:${INTER};margin:0 0 10px">Relatório de Performance — Delivery</p>
    <h1 style="font-family:${BEBAS};font-size:76px;color:${FG};margin:0;line-height:0.92;letter-spacing:0.02em">${clientName}</h1>
    <p style="font-size:15px;color:${MUTED};margin:14px 0 0;font-family:${INTER}">${periodo}${prevLine}</p>
    ${fechamento}
  </div>
  ${cards.length ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(cards.length, 4)},1fr);gap:14px">${cards.join('')}</div>` : ''}
</div>`;
  return wrapSlide(body, 1, total);
}

// ── Visão Geral — KPIs com comparativo + paired bar chart (≥75% da área útil) ──

function sVisaoGeral(d: ParsedData, prevD: ParsedData | null, idx: number, total: number): string {
  const dFat    = deltaInfo(d.faturamento,    prevD?.faturamento    ?? 0);
  const dPed    = deltaInfo(d.pedidos_ativos, prevD?.pedidos_ativos ?? 0);
  const dTicket = deltaInfo(d.ticket,         prevD?.ticket         ?? 0);

  const kpiRow = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px">
    ${kpiWithDelta('Faturamento', brlOrDash(d.faturamento), prevD ? brlOrDash(prevD.faturamento) : '', dFat)}
    ${kpiWithDelta('Pedidos', numOrDash(d.pedidos_ativos), prevD ? numOrDash(prevD.pedidos_ativos) : '', dPed)}
    ${kpiWithDelta('Ticket Médio', brlOrDash(d.ticket), prevD ? brlOrDash(prevD.ticket) : '', dTicket)}
  </div>`;

  let bottomSection: string;
  if (prevD) {
    const bars = compBarsHtml([
      { label: 'Faturamento', cur: d.faturamento, prv: prevD.faturamento, fmt: brl },
      { label: 'Total de Pedidos', cur: d.pedidos_ativos, prv: prevD.pedidos_ativos, fmt: num },
      { label: 'Ticket Médio', cur: d.ticket, prv: prevD.ticket, fmt: brl },
    ]);
    bottomSection = `
      <div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:20px 24px">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:${MUTED};font-family:${INTER};margin:0 0 18px">
          Comparativo — Período Atual vs Anterior
        </p>
        ${bars}
      </div>
      <p style="font-size:11px;color:${MUTED};font-family:${INTER};margin-top:12px">
        Dados anteriores via arquivos <code style="background:${CARD};padding:1px 5px;font-size:10px">ant-*.csv</code>
      </p>`;
  } else {
    // Sem período anterior — preenche com métricas secundárias e insight
    const tot = d.ativos + d.inativos + d.potenciais;
    const pA  = tot ? (d.ativos / tot * 100).toFixed(1) : '—';
    const mediaPerAtivo = d.ativos > 0 && d.pedidos_ativos > 0
      ? `${(d.pedidos_ativos / d.ativos).toFixed(1)} ped/cliente`
      : 'Aguardando integração';
    bottomSection = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
        ${kpi('Ativos na Base', numOrDash(d.ativos), `${pA}% do total cadastrado`)}
        ${kpi('Pedidos por Ativo', d.pedidos_ativos > 0 && d.ativos > 0 ? (d.pedidos_ativos / d.ativos).toFixed(1) : '—', mediaPerAtivo)}
        ${kpi('Inativos', numOrDash(d.inativos), 'clientes sem compra no período', RED)}
      </div>
      ${insight('Como ler estes dados', 'Esses números refletem apenas os clientes do arquivo enviado. Para exibir comparativo com período anterior, envie os arquivos com o prefixo ant- (ex: ant-ativos.csv).')}`;
  }

  const body = `
${secTitle('Visão Geral do Período', 'Faturamento, pedidos e ticket médio — clientes ativos')}
${kpiRow}
${bottomSection}`;
  return wrapSlide(body, idx, total);
}

function sPorDia(d: ParsedData, idx: number, total: number): string {
  const sorted = [...d.por_dia].sort((a, b) => b.pedidos - a.pedidos);
  const top2   = new Set(sorted.slice(0, 2).map(x => x.dia));
  const bars   = d.por_dia.map(x => hbar(x.dia, num(x.pedidos), x.pct, top2.has(x.dia))).join('');

  const body = `
${secTitle('Comportamento por Dia da Semana', 'Distribuição de pedidos — identifica padrões de demanda')}
<div style="display:grid;grid-template-columns:2fr 1fr;gap:28px">
  <div>${bars}</div>
  <div>
    ${insight('Dias Fortes', `${sorted[0]?.dia ?? '—'} e ${sorted[1]?.dia ?? '—'} concentram os maiores volumes. Lance campanhas na quarta/quinta para alimentar os picos do fim de semana.`)}
    ${insight('Oportunidade', `${sorted[sorted.length - 1]?.dia ?? '—'} está mais fraco — uma promoção específica para esse dia equilibra o volume semanal e dilui custos fixos.`)}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sRegioes(bairros: Bairro[], idx: number, total: number): string {
  const rows = bairros.map((b, i) => tableRow([
    { text: b.bairro },
    { text: num(b.pedidos), right: true, bold: true, color: PRIMARY },
    { text: brl(b.faturamento), right: true, color: MUTED },
  ], i % 2 === 0)).join('');

  const top2 = bairros.slice(0, 2);
  const mid  = bairros.slice(2, 5);

  const body = `
${secTitle('Regiões com Maior Volume', 'Bairros rankeados por pedidos — dados do CRM')}
<div style="display:grid;grid-template-columns:3fr 2fr;gap:28px">
  <table style="width:100%;border-collapse:collapse;border:1px solid ${BORDER};overflow:hidden">
    <thead>
      <tr style="background:${CARD};border-bottom:1px solid ${BORDER}">
        <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Bairro</th>
        <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Pedidos</th>
        <th style="padding:10px 16px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${MUTED};font-family:${INTER}">Faturamento</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="display:flex;flex-direction:column;gap:10px">
    ${top2.length ? `<div style="border:1px solid ${PRIMARY}4D;background:${PRIMARY}14;border-radius:2px;padding:14px 16px">
      <p style="font-size:10px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 5px">Fortalecer</p>
      <p style="font-size:13px;color:${FG};line-height:1.5;margin:0;font-family:${INTER}">${top2.map(b => b.bairro).join(', ')} — já têm demanda consolidada. Segmente anúncios Meta para esses bairros e aumente o ticket com combo exclusivo.</p>
    </div>` : ''}
    ${mid.length ? `<div style="border:1px solid ${BLUE}4D;background:${BLUE}0F;border-radius:2px;padding:14px 16px">
      <p style="font-size:10px;font-weight:700;color:${BLUE};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 5px">Estimular</p>
      <p style="font-size:13px;color:${FG};line-height:1.5;margin:0;font-family:${INTER}">${mid.map(b => b.bairro).join(', ')} — potencial subutilizado. Lance campanha de reconhecimento de marca nesses bairros para construir base.</p>
    </div>` : ''}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

// ── Base — donut 320px + legenda grande + distribuição 1x/2x+ ─────────────────

function sBase(d: ParsedData, idx: number, total: number): string {
  const tot = d.ativos + d.inativos + d.potenciais;
  const pA  = tot ? (d.ativos     / tot * 100).toFixed(1) : '0';
  const pI  = tot ? (d.inativos   / tot * 100).toFixed(1) : '0';
  const pP  = tot ? (d.potenciais / tot * 100).toFixed(1) : '0';

  // Default s=320 → outer=140, inner=64
  const donut = donutSvg([
    { label: 'Ativos',       value: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     value: d.inativos,   color: RED },
    { label: 'Em Potencial', value: d.potenciais, color: BLUE },
  ]);

  const legend = [
    { label: 'Ativos',       pct: pA, count: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     pct: pI, count: d.inativos,   color: RED },
    { label: 'Em Potencial', pct: pP, count: d.potenciais, color: BLUE },
  ].map(l => `<div style="display:flex;align-items:center;gap:14px;padding:14px 0;border-bottom:1px solid ${BORDER}">
    <div style="width:10px;height:10px;border-radius:2px;background:${l.color};flex-shrink:0"></div>
    <span style="flex:1;font-size:14px;font-weight:600;color:${FG};font-family:${INTER}">${l.label}</span>
    <span style="font-size:24px;font-family:${BEBAS};color:${FG};line-height:1">${numOrDash(l.count)}</span>
    <span style="font-size:13px;font-weight:700;color:${l.color};font-family:${INTER};min-width:44px;text-align:right">${l.pct}%</span>
  </div>`).join('');

  const hasDistrib = d.uma_compra > 0 || d.recorrentes > 0;
  const distribHtml = hasDistrib ? (() => {
    const totalAtivos = d.uma_compra + d.recorrentes;
    const pUma = totalAtivos ? (d.uma_compra / totalAtivos * 100).toFixed(1) : '0';
    const pRec = totalAtivos ? (d.recorrentes / totalAtivos * 100).toFixed(1) : '0';
    const pUmaNum = parseFloat(pUma);
    return `<div style="margin-top:20px;border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px 18px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 14px">Frequência de Compra — Clientes Ativos</p>
      <div style="display:flex;gap:32px;align-items:center">
        <div style="text-align:center">
          <p style="font-family:${BEBAS};font-size:36px;color:${FG};margin:0;line-height:1">${num(d.uma_compra)}</p>
          <p style="font-size:12px;font-weight:700;color:${ORANGE};font-family:${INTER};margin:4px 0 0">1× — ${pUma}%</p>
        </div>
        <div style="width:1px;height:48px;background:${BORDER}"></div>
        <div style="text-align:center">
          <p style="font-family:${BEBAS};font-size:36px;color:${FG};margin:0;line-height:1">${num(d.recorrentes)}</p>
          <p style="font-size:12px;font-weight:700;color:${PRIMARY};font-family:${INTER};margin:4px 0 0">2×+ — ${pRec}%</p>
        </div>
        <div style="flex:1;height:10px;background:${BORDER};overflow:hidden;align-self:center">
          <div style="height:100%;background:${PRIMARY};width:${pRec}%;box-shadow:0 0 6px ${PRIMARY}60"></div>
        </div>
        <div style="font-size:12px;color:${MUTED};font-family:${INTER};line-height:1.5;max-width:220px">
          ${pUmaNum > 50 ? `${num(d.uma_compra)} clientes compraram só 1×. Foco em converter a 2ª compra.` : `Alta recorrência: ${pRec}% dos ativos já recompraram.`}
        </div>
      </div>
    </div>`;
  })() : '';

  const body = `
${secTitle('Base de Clientes', `Total de ${numOrDash(tot)} clientes cadastrados`)}
<div style="display:flex;gap:40px;align-items:flex-start">
  ${donut}
  <div style="flex:1">
    ${legend}
    ${distribHtml}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sInativos(d: ParsedData, idx: number, total: number): string {
  const max   = Math.max(...d.inativos_faixas.map(f => f.count));
  const bars  = d.inativos_faixas.map(f => hbar(f.label, num(f.count), max ? f.count / max * 100 : 0, f.count === max)).join('');
  const maior = d.inativos_faixas.reduce((a, b) => a.count > b.count ? a : b);
  const portaEntrada = d.produtos[0];

  const body = `
${secTitle('Inativos e Potenciais', `${numOrDash(d.inativos)} inativos · ${numOrDash(d.potenciais)} potenciais — distribuídos por tempo de ausência`)}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">
  <div>
    ${bars}
    ${d.potenciais > 0 ? `<div style="margin-top:14px;padding:14px 16px;background:${BLUE}0F;border:1px solid ${BLUE}30;border-radius:2px">
      <p style="font-size:10px;font-weight:700;color:${BLUE};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 6px">Em Potencial (nunca compraram)</p>
      <p style="font-size:24px;font-family:${BEBAS};color:${FG};margin:0;line-height:1">${num(d.potenciais)} <span style="font-size:13px;color:${MUTED};font-family:${INTER};font-weight:400">clientes sem pedido</span></p>
    </div>` : ''}
  </div>
  <div>
    ${insight('Prioridade de Reativação', `A maior concentração está em ${maior.label} com ${num(maior.count)} clientes. Eles têm memória do produto — uma oferta personalizada tem alta chance de retorno.`)}
    ${portaEntrada && portaEntrada.qtd > 0 ? `<div style="margin-top:12px;border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 8px">Porta de Entrada Sugerida</p>
      <p style="font-family:${BEBAS};font-size:24px;color:${PRIMARY};margin:0 0 4px;line-height:1">${portaEntrada.nome}</p>
      <p style="font-size:12px;color:${MUTED};font-family:${INTER};margin:0">${num(portaEntrada.qtd)} pedidos no período${portaEntrada.total ? ` · ${brl(portaEntrada.total)}` : ''} — produto mais reconhecido para reativação.</p>
    </div>` : ''}
    <div style="margin-top:12px;border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 8px">Sugestão de Mensagem</p>
      <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.6;margin:0">"Faz tempo que você não aparece! Preparamos um mimo especial pra você voltar. Use o cupom <strong style="color:${PRIMARY}">VOLTEI</strong> e ganhe desconto no próximo pedido. Válido por 7 dias!"</p>
    </div>
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

// ── Produtos — barras 12px, estado vazio explícito se todos qtd=0 ─────────────

function sProdutos(d: ParsedData, idx: number, total: number): string {
  const allZeroQty = d.produtos.every(p => p.qtd === 0);

  if (allZeroQty) {
    // Modo catálogo — sem ranking falso de 0 pedidos
    const catalogCards = d.produtos.slice(0, 8).map(p =>
      `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:14px 16px">
        <p style="font-size:13px;font-weight:600;color:${FG};font-family:${INTER};margin:0 0 6px">${p.nome}</p>
        ${p.total > 0 ? `<p style="font-size:12px;color:${MUTED};font-family:${INTER};margin:0">${brl(p.total)}</p>` : ''}
      </div>`,
    ).join('');
    const body = `
${secTitle('Produtos Cadastrados', 'Catálogo identificado — volume de vendas não capturado neste arquivo')}
<div style="border:1px solid ${ORANGE}30;background:${ORANGE}0A;border-radius:2px;padding:14px 16px;margin-bottom:20px">
  <p style="font-size:13px;color:${ORANGE};font-family:${INTER};margin:0">Volume de pedidos não disponível neste arquivo. Para exibir o ranking de vendas, envie uma planilha com coluna de quantidade vendida.</p>
</div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${catalogCards}</div>`;
    return wrapSlide(body, idx, total);
  }

  const max  = Math.max(...d.produtos.map(p => p.qtd));
  // barH=12 para ranking de produtos (mais denso e visível)
  const bars = d.produtos.slice(0, 8).map((p, i) =>
    hbar(p.nome, `${num(p.qtd)} ped${p.total > 0 ? ` · ${brl(p.total)}` : ''}`, max ? p.qtd / max * 100 : 0, i < 3, 12),
  ).join('');

  const top4 = d.produtos.slice(0, 4);
  const combos: Array<{ a: string; b: string }> = [];
  if (top4[0] && top4[1]) combos.push({ a: top4[0].nome, b: top4[1].nome });
  if (top4[2] && top4[3]) combos.push({ a: top4[2].nome, b: top4[3].nome });
  if (top4[0] && top4[2]) combos.push({ a: top4[0].nome, b: top4[2].nome });
  if (top4[1] && top4[3]) combos.push({ a: top4[1].nome, b: top4[3].nome });

  const comboGrid = combos.slice(0, 4).map(c =>
    `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:12px 14px">
      <p style="font-size:10px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:0.08em;font-family:${INTER};margin:0 0 6px">Combo</p>
      <p style="font-size:13px;font-weight:600;color:${FG};font-family:${INTER};margin:0;line-height:1.4">${c.a} <span style="color:${MUTED}">+</span> ${c.b}</p>
    </div>`,
  ).join('');

  const body = `
${secTitle('Produtos Mais Vendidos', 'Ranking por quantidade de pedidos')}
<div style="display:grid;grid-template-columns:3fr 2fr;gap:28px">
  <div>${bars}</div>
  <div>
    ${d.produtos[0] ? insight('Produto Estrela', `"${d.produtos[0].nome}" lidera com ${num(d.produtos[0].qtd)} pedidos. Use-o como âncora em combos para elevar o ticket médio.`) : ''}
    ${combos.length ? `
    <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:14px 0 8px">Combos Sugeridos</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${comboGrid}</div>` : ''}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sMetaAds(meta: MetaAdsFull, idx: number, total: number): string {
  const cpl = meta.cliques ? brl(meta.investimento / meta.cliques) : '—';

  const campCards = meta.campanhas.map(c => {
    const m = c.metricas;
    const isConversa  = m.conversas > 0 || c.tipo.toLowerCase().includes('messages');
    const isConversao = m.compras > 0 || c.tipo.toLowerCase().includes('conversions');
    const accentColor = isConversa ? PRIMARY : isConversao ? ORANGE : BLUE;

    const metricsRows: string[] = [
      `<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Investido</span><span style="font-weight:700;color:${FG}">${brlOrDash(m.investimento)}</span></div>`,
      `<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Alcance</span><span style="font-weight:700;color:${FG}">${numOrDash(m.alcance)}</span></div>`,
    ];
    if (m.frequencia > 0) metricsRows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Frequência</span><span style="font-weight:700;color:${FG}">${m.frequencia.toFixed(1)}×</span></div>`);
    if (isConversa && m.conversas > 0) {
      metricsRows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Conversas</span><span style="font-weight:700;color:${PRIMARY}">${num(Math.round(m.conversas))}</span></div>`);
      metricsRows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0"><span style="color:${MUTED}">Custo/conversa</span><span style="font-weight:700;color:${FG}">${brl(m.investimento / m.conversas)}</span></div>`);
    }
    if (isConversao && m.compras > 0) {
      metricsRows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Compras</span><span style="font-weight:700;color:${ORANGE}">${num(Math.round(m.compras))}</span></div>`);
      if (m.purchase_roas > 0) metricsRows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0"><span style="color:${MUTED}">ROAS</span><span style="font-weight:700;color:${ORANGE}">${m.purchase_roas.toFixed(2)}×</span></div>`);
    }

    const typeLabel = isConversa ? 'CONVERSA' : isConversao ? 'CONVERSÃO' : 'TRÁFEGO';
    return `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:18px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
      <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin:4px 0 12px">
        <p style="font-size:13px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3;max-width:70%">${c.nome}</p>
        <span style="font-size:9px;font-weight:700;color:${accentColor};text-transform:uppercase;letter-spacing:0.08em;font-family:${INTER};border:1px solid ${accentColor}40;padding:2px 6px;flex-shrink:0">${typeLabel}</span>
      </div>
      <div style="display:flex;flex-direction:column">${metricsRows.join('')}</div>
    </div>`;
  }).join('');

  const body = `
${secTitle('Meta Ads — Tráfego Pago', 'Investimento e resultados das campanhas no período')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px">
  ${kpi('Investimento', brlOrDash(meta.investimento), 'total em anúncios no período', BLUE)}
  ${kpi('Impressões', numOrDash(meta.impressoes), 'exibições dos anúncios', BLUE)}
  ${kpi('Alcance', numOrDash(meta.alcance), 'pessoas únicas impactadas', BLUE)}
  ${kpi('CPL', cpl, `${numOrDash(meta.cliques)} cliques no período`, BLUE)}
</div>
${meta.campanhas.length ? `
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 12px">Campanhas Ativas</p>
  <div style="display:grid;grid-template-columns:repeat(${Math.min(meta.campanhas.length, 3)},1fr);gap:14px">${campCards}</div>
` : ''}`;
  return wrapSlide(body, idx, total);
}

// ── Diagnóstico A — texto + pontos fortes/atenção (slide 1 de 2) ──────────────

function sDiagnosticoA(diag: DiagJson, idx: number, total: number): string {
  const colLabel = (text: string) =>
    `<p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 12px">${text}</p>`;

  const fortes = diag.pontos_fortes.slice(0, 4).map(p =>
    `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid ${BORDER}">
      <div style="width:20px;height:20px;background:${PRIMARY}20;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:${PRIMARY}">✓</div>
      <span style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.5">${p}</span>
    </div>`,
  ).join('');

  const atencao = diag.pontos_atencao.slice(0, 3).map(p =>
    `<div style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid ${BORDER}">
      <div style="width:20px;height:20px;background:${RED}20;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:${RED}">!</div>
      <span style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.5">${p}</span>
    </div>`,
  ).join('');

  const fechamento = diag.frase_fechamento
    ? `<div style="margin-top:20px;border:1px solid ${PRIMARY}4D;background:${PRIMARY}0D;border-radius:2px;padding:16px 20px">
        <p style="font-size:10px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:.1em;font-family:${INTER};margin:0 0 6px">Objetivo do Próximo Mês</p>
        <p style="font-size:15px;color:${FG};font-family:${INTER};line-height:1.6;margin:0;font-style:italic">"${diag.frase_fechamento}"</p>
      </div>`
    : '';

  const body = `
${secTitle('Diagnóstico do Período', 'Análise dos dados e pontos de atenção')}
<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:20px 24px;margin-bottom:24px">
  <p style="font-size:15px;color:${FG};font-family:${INTER};line-height:1.75;margin:0">${diag.diagnostico}</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:32px">
  <div>
    ${colLabel('Pontos Fortes')}
    ${fortes}
  </div>
  <div>
    ${colLabel('Pontos de Atenção')}
    ${atencao}
    ${fechamento}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

// ── Diagnóstico B — plano 5 passos + criativos (slide 2 de 2) ────────────────

function sDiagnosticoPlan(diag: DiagJson, creatives: Creative[], idx: number, total: number): string {
  const planoItems = diag.plano.slice(0, 5);

  const cardHtml = (p: typeof planoItems[0], i: number) =>
    `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px;position:relative;overflow:hidden;display:flex;flex-direction:column;gap:8px">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${PRIMARY}"></div>
      <div style="width:26px;height:26px;background:${PRIMARY};border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:13px;font-weight:800;color:#0e0f14;font-family:${INTER}">${i + 1}</span>
      </div>
      <p style="font-size:13px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      ${p.objetivo ? `<p style="font-size:11px;color:${PRIMARY};font-family:${INTER};margin:0;line-height:1.4"><strong>Objetivo:</strong> ${p.objetivo}</p>` : ''}
      ${p.publico ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4"><strong style="color:${FG}">Público:</strong> ${p.publico}</p>` : ''}
    </div>`;

  // 3+2 grid layout
  const row1 = planoItems.slice(0, 3).map((p, i) => cardHtml(p, i)).join('');
  const row2 = planoItems.slice(3, 5).map((p, i) => cardHtml(p, i + 3)).join('');

  const planoHtml = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px">${row1}</div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:68%">${row2}</div>`;

  const creativesHtml = creatives.length > 0
    ? `<div style="display:flex;flex-direction:column;gap:8px">
        <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 4px">Top Criativos</p>
        ${creatives.slice(0, 3).map(c => `
          <div style="display:flex;gap:10px;align-items:center;padding:10px;background:${CARD};border:1px solid ${BORDER};border-radius:2px">
            ${c.thumbnail_url
              ? `<img src="${c.thumbnail_url}" style="width:48px;height:48px;object-fit:cover;border-radius:2px;flex-shrink:0" />`
              : `<div style="width:48px;height:48px;background:${BORDER};border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:${MUTED};font-size:20px">🎨</div>`
            }
            <div style="flex:1;min-width:0">
              <p style="font-size:11px;font-weight:600;color:${FG};font-family:${INTER};margin:0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</p>
              <p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:3px 0 0">${brlOrDash(c.spend)}${c.resultado > 0 ? ` · ${num(Math.round(c.resultado))} result.` : ''}</p>
            </div>
          </div>`).join('')}
      </div>`
    : '';

  const body = `
${secTitle('Plano de Ação — Próximo Mês', '5 ações estratégicas baseadas nos dados do período')}
<div style="display:grid;grid-template-columns:${creatives.length > 0 ? '1fr 220px' : '1fr'};gap:24px;align-items:start">
  <div>${planoHtml}</div>
  ${creatives.length > 0 ? `<div>${creativesHtml}</div>` : ''}
</div>`;
  return wrapSlide(body, idx, total);
}

// ── Expanded slides ───────────────────────────────────────────────────────────

function sDestaqueCampanhas(meta: MetaAdsFull, diag: DiagJson, idx: number, total: number): string {
  const campanhasConversa  = meta.campanhas.filter(c => c.metricas.conversas > 0 || c.tipo.toLowerCase().includes('messages'));
  const campanhasConversao = meta.campanhas.filter(c => c.metricas.compras > 0 || c.tipo.toLowerCase().includes('conversions'));
  const campanhasOther     = meta.campanhas.filter(c => !campanhasConversa.includes(c) && !campanhasConversao.includes(c));

  function campSection(title: string, color: string, camps: CampanhaDetalhada[], insightText: string) {
    if (!camps.length) return '';
    const cards = camps.map(c => {
      const m = c.metricas;
      const rows: string[] = [
        `<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Investido</span><span style="font-weight:700;color:${FG}">${brlOrDash(m.investimento)}</span></div>`,
        `<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Alcance</span><span style="font-weight:700;color:${FG}">${numOrDash(m.alcance)}</span></div>`,
        `<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Freq.</span><span style="font-weight:700;color:${FG}">${m.frequencia.toFixed(1)}×</span></div>`,
      ];
      if (m.conversas > 0) rows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Conversas</span><span style="font-weight:700;color:${PRIMARY}">${num(Math.round(m.conversas))}</span></div>`);
      if (m.conversas > 0) rows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Custo/conv.</span><span style="font-weight:700;color:${FG}">${brl(m.investimento / m.conversas)}</span></div>`);
      if (m.compras > 0) rows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0;border-bottom:1px solid ${BORDER}"><span style="color:${MUTED}">Compras</span><span style="font-weight:700;color:${ORANGE}">${num(Math.round(m.compras))}</span></div>`);
      if (m.purchase_roas > 0) rows.push(`<div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER};padding:5px 0"><span style="color:${MUTED}">ROAS</span><span style="font-weight:700;color:${ORANGE}">${m.purchase_roas.toFixed(2)}×</span></div>`);
      return `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px;position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${color}"></div>
        <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:4px 0 12px;line-height:1.3">${c.nome}</p>
        <div>${rows.join('')}</div>
      </div>`;
    }).join('');
    return `<div style="margin-bottom:22px">
      <p style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 10px">— ${title}</p>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(camps.length, 3)},1fr);gap:12px;margin-bottom:10px">${cards}</div>
      ${insightText ? `<div style="border:1px solid ${color}40;background:${color}0D;border-radius:2px;padding:12px 16px">
        <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.6;margin:0">${insightText}</p>
      </div>` : ''}
    </div>`;
  }

  const body = `
${secTitle('Destaque de Campanhas', 'Análise expandida por tipo de campanha e objetivo')}
${campSection('Campanhas de Conversa', PRIMARY, campanhasConversa, diag.insight_campanha_conversa)}
${campSection('Campanhas de Conversão', ORANGE, campanhasConversao, diag.insight_campanha_conversao)}
${campSection('Demais Campanhas', BLUE, campanhasOther, '')}`;
  return wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA');
}

function sDiagnosticoFat(diag: DiagJson, d: ParsedData, bairros: Bairro[], idx: number, total: number): string {
  const forcas = diag.forcas.length
    ? diag.forcas.slice(0, 4)
    : [
        { titulo: 'Recorrência', descricao: d.recorrentes > 0 ? `${num(d.recorrentes)} clientes já recompraram — base de recorrência ativa.` : 'Ampliar programas de fidelidade para converter compradores únicos.' },
        { titulo: 'Produtos', descricao: d.produtos[0] && d.produtos[0].qtd > 0 ? `"${d.produtos[0].nome}" é âncora com ${num(d.produtos[0].qtd)} pedidos.` : 'Identificar produto âncora para campanhas de entrada.' },
        { titulo: 'Dias Fortes', descricao: d.por_dia.length ? `Pico em ${[...d.por_dia].sort((a, b) => b.pedidos - a.pedidos)[0]?.dia ?? '—'} — concentrar esforços nesse dia.` : 'Mapear os dias de pico para otimizar campanhas.' },
        { titulo: 'Regiões', descricao: bairros[0] ? `${bairros[0].bairro} lidera com ${num(bairros[0].pedidos)} pedidos.` : 'Concentrar entrega em zonas de maior demanda.' },
      ];

  const forcaCards = forcas.map((f, i) => {
    const colors = [PRIMARY, BLUE, ORANGE, RED];
    const c = colors[i % colors.length];
    return `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:20px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;width:100%;height:2px;background:${c}"></div>
      <p style="font-family:${BEBAS};font-size:22px;color:${c};margin:4px 0 10px;letter-spacing:0.04em">${f.titulo}</p>
      <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.6;margin:0">${f.descricao}</p>
    </div>`;
  }).join('');

  const sidebar = `
    <div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px;margin-bottom:12px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 12px">Base de Clientes</p>
      ${[
        { label: 'Ativos',       value: numOrDash(d.ativos),     color: PRIMARY },
        { label: 'Inativos',     value: numOrDash(d.inativos),   color: RED },
        { label: 'Em Potencial', value: numOrDash(d.potenciais), color: BLUE },
      ].map(item => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${BORDER};font-family:${INTER}">
        <span style="font-size:12px;color:${MUTED}">${item.label}</span>
        <span style="font-size:18px;font-family:${BEBAS};color:${item.color};line-height:1">${item.value}</span>
      </div>`).join('')}
    </div>
    ${bairros[0] ? `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 10px">Top Regiões</p>
      ${bairros.slice(0, 4).map((b, i) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid ${BORDER};font-family:${INTER}">
        <span style="font-size:12px;color:${i === 0 ? FG : MUTED}">${b.bairro}</span>
        <span style="font-size:12px;font-weight:700;color:${i === 0 ? PRIMARY : MUTED}">${num(b.pedidos)} ped.</span>
      </div>`).join('')}
    </div>` : ''}`;

  const body = `
${secTitle('Diagnóstico de Faturamento', 'As 4 forças que explicam o resultado do período')}
<div style="display:grid;grid-template-columns:1fr 280px;gap:20px;align-items:start">
  <div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-bottom:20px">${forcaCards}</div>
    ${diag.diagnostico ? `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px 20px">
      <p style="font-size:14px;color:${FG};font-family:${INTER};line-height:1.7;margin:0">${diag.diagnostico}</p>
    </div>` : ''}
  </div>
  <div>${sidebar}</div>
</div>`;
  return wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA');
}

// ── Plano Detalhado — 3+2 grid com objetivo/público/mensagem + jornada ────────

function sPlanoDetalhado(diag: DiagJson, idx: number, total: number): string {
  const JORNADA_LABELS: Record<string, string> = {
    descoberta: 'Descoberta', primeira_compra: '1ª Compra',
    recompra: 'Recompra', reativacao_leve: 'Reativação Leve', reativacao_forte: 'Reativação Forte',
  };
  const jornada = diag.jornada.length
    ? diag.jornada
    : ['descoberta', 'primeira_compra', 'recompra', 'reativacao_leve', 'reativacao_forte'];

  const jornadaHtml = `<div style="display:flex;align-items:stretch;margin-bottom:22px;overflow:hidden">
    ${jornada.map((etapa, i) => `
      <div style="flex:1;text-align:center;background:${i === 0 ? PRIMARY : CARD};border:1px solid ${i === 0 ? PRIMARY : BORDER};padding:9px 4px;margin-right:-1px;position:relative">
        <p style="font-size:10px;font-weight:700;color:${i === 0 ? BG : MUTED};text-transform:uppercase;letter-spacing:0.06em;font-family:${INTER};margin:0;line-height:1.3">${JORNADA_LABELS[etapa] ?? etapa}</p>
      </div>`).join('')}
  </div>`;

  const planCards = diag.plano.slice(0, 5).map((p, i) => {
    const etapaLabel = JORNADA_LABELS[jornada[i] ?? ''] ?? '';
    return `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px;display:flex;flex-direction:column;gap:9px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${PRIMARY}"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
        <div style="width:28px;height:28px;background:${PRIMARY};border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <span style="font-size:14px;font-weight:800;color:#0e0f14;font-family:${INTER}">${i + 1}</span>
        </div>
        ${etapaLabel ? `<span style="font-size:9px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.08em;font-family:${INTER};border:1px solid ${BORDER};padding:2px 6px;flex-shrink:0">${etapaLabel}</span>` : ''}
      </div>
      <p style="font-size:13px;font-weight:700;color:${FG};font-family:${INTER};margin:0;line-height:1.3">${p.acao}</p>
      ${p.objetivo ? `<p style="font-size:11px;color:${PRIMARY};font-family:${INTER};margin:0;line-height:1.4"><strong>Objetivo:</strong> ${p.objetivo}</p>` : ''}
      ${p.publico ? `<p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.4"><strong style="color:${FG}">Público:</strong> ${p.publico}</p>` : ''}
      ${p.mensagem ? `<div style="margin-top:2px;padding:8px 10px;background:${BG};border-radius:2px;border:1px solid ${BORDER}">
        <p style="font-size:11px;color:${MUTED};font-family:${INTER};margin:0;line-height:1.5;font-style:italic">"${p.mensagem}"</p>
      </div>` : ''}
    </div>`;
  });

  // 3+2 rows for 5 cards
  const row1Html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px">${planCards.slice(0,3).join('')}</div>`;
  const row2Html = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;max-width:67%">${planCards.slice(3).join('')}</div>`;

  const body = `
${secTitle('Plano de Ação Detalhado', 'Estratégia campanha a campanha para o próximo mês')}
${jornadaHtml}
${row1Html}
${row2Html}`;
  return wrapSlide(body, idx, total, 'ANÁLISE EXPANDIDA');
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

  const [bairros, { meta, creatives }] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaData(connectionId, accountIds, from, to),
  ]);

  console.log(`[delivery] ${clientName} | fat:${brlOrDash(data.faturamento)} ativos:${data.ativos} prod:${data.produtos.length} bairros:${bairros.length} meta:${meta ? 'sim' : 'não'} criativos:${creatives.length} prev:${hasPrev}`);

  const diag = await fetchDiagnosis(data, prevData, meta, bairros, clientName, periodo, agencyContext);

  const hasVisao   = data.faturamento > 0 || data.pedidos_ativos > 0;
  const hasDia     = data.por_dia.length > 0;
  const hasBase    = data.ativos > 0 || data.inativos > 0 || data.potenciais > 0;
  const hasInat    = data.inativos_faixas.length > 0;
  const hasProd    = data.produtos.length > 0;
  const hasRegiao  = bairros.length > 0;
  const hasMeta    = meta !== null;
  const hasDestaques   = hasMeta && meta!.campanhas.length > 0;
  const hasDiagFat     = hasBase || hasRegiao;
  const hasPlanoDetalh = diag.plano.length > 0;

  // Diagnóstico sempre gera 2 slides (A + Plan)
  const total = 1
    + (hasVisao  ? 1 : 0)
    + (hasDia    ? 1 : 0)
    + (hasRegiao ? 1 : 0)
    + (hasBase   ? 1 : 0)
    + (hasInat   ? 1 : 0)
    + (hasProd   ? 1 : 0)
    + (hasMeta   ? 1 : 0)
    + 2                           // sDiagnosticoA + sDiagnosticoPlan
    + (hasDestaques   ? 1 : 0)
    + (hasDiagFat     ? 1 : 0)
    + (hasPlanoDetalh ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total));
  if (hasVisao)     slides.push(sVisaoGeral(data, prevData, ++i, total));
  if (hasDia)       slides.push(sPorDia(data, ++i, total));
  if (hasRegiao)    slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)      slides.push(sBase(data, ++i, total));
  if (hasInat)      slides.push(sInativos(data, ++i, total));
  if (hasProd)      slides.push(sProdutos(data, ++i, total));
  if (hasMeta)      slides.push(sMetaAds(meta!, ++i, total));
  slides.push(sDiagnosticoA(diag, ++i, total));
  slides.push(sDiagnosticoPlan(diag, creatives, ++i, total));
  if (hasDestaques)   slides.push(sDestaqueCampanhas(meta!, diag, ++i, total));
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
