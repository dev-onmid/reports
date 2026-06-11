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

// ── Design tokens ─────────────────────────────────────────────────────────────
// Report viewer always runs in dark mode (class="dark" on root html in layout.tsx).
// CSS variables resolve via globals.css; hex constants are used only for SVG fill/stroke.

const PRIMARY = '#55f52f';
const CARD    = '#1a1a1a';
const BG      = '#0e0f14';
const BORDER  = '#2a2d3a';
const FG      = '#f5f5f5';
const MUTED   = '#a0aec0';
const RED     = '#e52020';
const BLUE    = '#0B84FF';

const INTER = 'var(--font-inter), Inter, sans-serif';
const BEBAS = 'var(--font-bebas), "Bebas Neue", sans-serif';

// ── Types ──────────────────────────────────────────────────────────────────────

type Bairro    = { bairro: string; pedidos: number; faturamento: number };
type MetaAds   = { investimento: number; impressoes: number; alcance: number; cliques: number; campanhas: Array<{ nome: string; tipo: string; metricas: { investimento: number; impressoes: number; alcance: number; cliques: number } }> };
type Product   = { nome: string; qtd: number; total: number };
type Faixa     = { label: string; count: number };
type DiaDaSemana = { dia: string; pedidos: number; pct: number };

type ParsedData = {
  ativos:          number;
  inativos:        number;
  potenciais:      number;
  faturamento:     number;
  pedidos_ativos:  number;
  ticket:          number;
  produtos:        Product[];
  inativos_faixas: Faixa[];
  por_dia:         DiaDaSemana[];
};

// ── CSV helpers ────────────────────────────────────────────────────────────────

function detectType(filename: string): 'ativos' | 'inativos' | 'potenciais' | 'produtos' | 'pedidos' | 'outros' {
  const n = filename.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.includes('inativ'))                                           return 'inativos';
  if (n.includes('ativo'))                                            return 'ativos';
  if (n.includes('potencial'))                                        return 'potenciais';
  if (n.includes('produto'))                                          return 'produtos';
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

// ── File Parsers ───────────────────────────────────────────────────────────────

function parseClientesCsv(content: string): { count: number; faturamento: number; pedidos: number } {
  const { headers, rows } = splitCsv(content);
  if (!headers.length) return { count: 0, faturamento: 0, pedidos: 0 };

  const vIdx = headers.findIndex(h => (h.includes('valor') || h.includes('gasto') || h.includes('faturamento')) && !h.includes('pedido'));
  const pIdx = headers.findIndex(h => (h.includes('pedido') || h.includes('qtd') || h.includes('quantidade')) && !h.includes('ultimo') && !h.includes('data') && !h.includes('valor'));

  let fat = 0, ped = 0;
  for (const row of rows) {
    if (vIdx >= 0) fat += parseFloat2(row[vIdx] ?? '');
    if (pIdx >= 0) ped += parseInt(row[pIdx] ?? '0') || 0;
  }
  return { count: rows.length, faturamento: fat, pedidos: ped };
}

function parseInativosFaixas(content: string, refDate: Date): Faixa[] {
  const { headers, rows } = splitCsv(content);
  const dIdx = headers.findIndex(h => h.includes('ultimo') || (h.includes('data') && h.includes('pedido')));
  if (dIdx === -1) return [];

  const FAIXAS = [
    { label: '30–59 dias',  min: 30,  max: 59,        count: 0 },
    { label: '60–89 dias',  min: 60,  max: 89,        count: 0 },
    { label: '90–179 dias', min: 90,  max: 179,       count: 0 },
    { label: '180–364 dias',min: 180, max: 364,       count: 0 },
    { label: '365+ dias',   min: 365, max: Infinity,  count: 0 },
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
  const out: ParsedData = { ativos: 0, inativos: 0, potenciais: 0, faturamento: 0, pedidos_ativos: 0, ticket: 0, produtos: [], inativos_faixas: [], por_dia: [] };
  for (const f of files) {
    const type = detectType(f.name);
    if (type === 'ativos') {
      const { count, faturamento, pedidos } = parseClientesCsv(f.content);
      out.ativos = count; out.faturamento = faturamento; out.pedidos_ativos = pedidos;
    } else if (type === 'inativos') {
      out.inativos = parseClientesCsv(f.content).count;
      out.inativos_faixas = parseInativosFaixas(f.content, refDate);
    } else if (type === 'potenciais') {
      out.potenciais = parseClientesCsv(f.content).count;
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

async function fetchMetaAds(connectionId: string | null | undefined, accountIds: string[], from: string, to: string): Promise<MetaAds | null> {
  if (!connectionId || !accountIds.length) return null;
  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  try {
    const { rows } = await pool.query(`SELECT id,app_id,access_token,token_expiry FROM public.meta_connections WHERE id=$1`, [connectionId]);
    conn = rows[0] ?? null;
  } finally { await pool.end(); }
  if (!conn) return null;

  const token     = await getFreshMetaToken(conn);
  const timeRange = JSON.stringify({ since: from, until: to });
  let totalSpend = 0, totalImpressions = 0, totalReach = 0, totalCliques = 0;
  const campaigns: MetaAds['campanhas'] = [];

  await Promise.allSettled(accountIds.map(async (accountId) => {
    const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
    const sig  = AbortSignal.timeout(12000);

    const urlAcc = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAcc.searchParams.set('fields', 'spend,impressions,reach,clicks');
    urlAcc.searchParams.set('time_range', timeRange);
    urlAcc.searchParams.set('level', 'account');
    urlAcc.searchParams.set('access_token', token);
    const resAcc = await fetch(urlAcc.toString(), { signal: sig }).catch(() => null);
    if (resAcc?.ok) {
      const j = await resAcc.json() as { data?: Record<string, string>[] };
      for (const row of j.data ?? []) {
        totalSpend       += parseFloat(row.spend ?? '0');
        totalImpressions += parseInt(row.impressions ?? '0', 10);
        totalReach       += parseInt(row.reach ?? '0', 10);
        totalCliques     += parseInt(row.clicks ?? '0', 10);
      }
    }

    const urlCamp = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlCamp.searchParams.set('fields', 'campaign_name,objective,spend,impressions,reach,clicks');
    urlCamp.searchParams.set('time_range', timeRange);
    urlCamp.searchParams.set('level', 'campaign');
    urlCamp.searchParams.set('limit', '5');
    urlCamp.searchParams.set('access_token', token);
    const resCamp = await fetch(urlCamp.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!resCamp?.ok) return;
    const j = await resCamp.json() as { data?: Record<string, string>[] };
    for (const row of j.data ?? []) {
      campaigns.push({
        nome: String(row.campaign_name ?? 'Sem nome'), tipo: String(row.objective ?? ''),
        metricas: { investimento: parseFloat(row.spend ?? '0'), impressoes: parseInt(row.impressions ?? '0', 10), alcance: parseInt(row.reach ?? '0', 10), cliques: parseInt(row.clicks ?? '0', 10) },
      });
    }
  }));

  if (totalSpend === 0 && campaigns.length === 0) return null;
  return { investimento: totalSpend, impressoes: totalImpressions, alcance: totalReach, cliques: totalCliques, campanhas: campaigns.slice(0, 3) };
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

function donutSvg(slices: { label: string; value: number; color: string }[], s = 220): string {
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (!total) return '';
  let c = 0;
  const paths = slices.map(sl => {
    const angle = (sl.value / total) * 360;
    const p = donutPath(s / 2, s / 2, s / 2 - 6, s / 3, c, c + angle);
    c += angle;
    return `<path d="${p}" fill="${sl.color}" stroke="${BG}" stroke-width="2" style="filter:drop-shadow(0 0 6px ${sl.color}80)"/>`;
  });
  return `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" style="flex-shrink:0">
    ${paths.join('')}
    <circle cx="${s / 2}" cy="${s / 2}" r="${Math.round(s / 3 - 8)}" fill="${CARD}"/>
  </svg>`;
}

// ── HTML component helpers ─────────────────────────────────────────────────────

function wrapSlide(body: string, idx: number, total: number): string {
  return `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column">
  <div style="height:52px;padding:0 48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${BORDER};flex-shrink:0">
    <span style="font-family:${BEBAS};font-size:22px;color:${PRIMARY};letter-spacing:0.06em">ONMID</span>
    <span style="font-size:11px;color:${MUTED};font-family:${INTER};font-weight:600">${idx} / ${total}</span>
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
  return `<div style="position:relative;overflow:hidden;border:1px solid ${BORDER};border-radius:2px;background:${CARD};padding:20px 22px;box-sizing:border-box">
  <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${accentColor}"></div>
  <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${accentColor}"></div>
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:4px 0 8px">${label}</p>
  <p style="font-family:${BEBAS};font-size:38px;color:${FG};line-height:1;margin:0 0 4px">${value}</p>
  <p style="font-size:12px;color:${MUTED};font-family:${INTER};line-height:1.4;margin:0">${context}</p>
</div>`;
}

function hbar(label: string, value: string, pct: number, hi: boolean): string {
  const barColor = hi ? PRIMARY : `${PRIMARY}40`;
  const glow = hi ? `box-shadow:0 0 8px ${PRIMARY}80` : '';
  return `<div style="margin-bottom:10px">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
    <span style="font-size:12px;font-weight:600;color:${FG};font-family:${INTER}">${label}</span>
    <span style="font-size:12px;font-weight:700;color:${hi ? PRIMARY : MUTED};font-family:${INTER}">${value}</span>
  </div>
  <div style="height:6px;background:${BORDER};overflow:hidden">
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
  const bg = stripe ? `${CARD}` : BG;
  const tds = cells.map(c =>
    `<td style="padding:10px 16px;font-size:13px;font-family:${INTER};text-align:${c.right ? 'right' : 'left'};font-weight:${c.bold ? '700' : '400'};color:${c.color ?? FG}">${c.text}</td>`
  ).join('');
  return `<tr style="background:${bg};border-bottom:1px solid ${BORDER}">${tds}</tr>`;
}

// ── Slide builders (TypeScript — zero AI tokens) ───────────────────────────────

function sCapa(d: ParsedData, meta: MetaAds | null, clientName: string, periodo: string, total: number): string {
  const cards: string[] = [];
  if (d.faturamento > 0) cards.push(kpi('Faturamento', brl(d.faturamento), `${num(d.pedidos_ativos)} pedidos`));
  if (d.ticket > 0)      cards.push(kpi('Ticket Médio', brl(d.ticket), 'por pedido (clientes ativos)'));
  if (d.ativos > 0)      cards.push(kpi('Clientes Ativos', num(d.ativos), `${num(d.inativos)} inativos · ${num(d.potenciais)} potenciais`));
  if (meta)              cards.push(kpi('Investimento Meta', brl(meta.investimento), `${num(meta.cliques)} cliques · ${num(meta.alcance)} alcance`, BLUE));

  const body = `<div style="display:flex;flex-direction:column;justify-content:center;height:100%;gap:28px;position:relative">
  <div style="position:absolute;top:-100px;right:-100px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}1A,transparent 70%);pointer-events:none"></div>
  <div>
    <p style="font-size:11px;font-weight:700;color:${PRIMARY};text-transform:uppercase;letter-spacing:0.14em;font-family:${INTER};margin:0 0 10px">Relatório de Performance — Delivery</p>
    <h1 style="font-family:${BEBAS};font-size:72px;color:${FG};margin:0;line-height:0.92;letter-spacing:0.02em">${clientName}</h1>
    <p style="font-size:15px;color:${MUTED};margin:14px 0 0;font-family:${INTER}">${periodo}</p>
  </div>
  ${cards.length ? `<div style="display:grid;grid-template-columns:repeat(${Math.min(cards.length, 4)},1fr);gap:14px">${cards.join('')}</div>` : ''}
</div>`;
  return wrapSlide(body, 1, total);
}

function sVisaoGeral(d: ParsedData, idx: number, total: number): string {
  const body = `
${secTitle('Visão Geral do Período', 'Faturamento, pedidos e ticket médio — clientes ativos')}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
  ${kpi('Faturamento', brl(d.faturamento), 'soma do valor gasto pelos clientes ativos')}
  ${kpi('Pedidos', num(d.pedidos_ativos), 'total de pedidos realizados no período')}
  ${kpi('Ticket Médio', brl(d.ticket), 'faturamento ÷ pedidos')}
</div>`;
  return wrapSlide(body, idx, total);
}

function sPorDia(d: ParsedData, idx: number, total: number): string {
  const sorted = [...d.por_dia].sort((a, b) => b.pedidos - a.pedidos);
  const top2   = new Set(sorted.slice(0, 2).map(x => x.dia));
  const bars   = d.por_dia.map(x => hbar(x.dia, num(x.pedidos), x.pct, top2.has(x.dia))).join('');
  const body = `
${secTitle('Pedidos por Dia da Semana', 'Distribuição de pedidos ao longo da semana')}
<div style="display:grid;grid-template-columns:2fr 1fr;gap:28px">
  <div>${bars}</div>
  <div>
    ${insight('Dias Fortes', `${sorted[0]?.dia} e ${sorted[1]?.dia} concentram os maiores volumes. Priorize campanhas na quarta/quinta para alimentar os picos.`)}
    ${insight('Oportunidade', `${sorted[sorted.length-1]?.dia} e ${sorted[sorted.length-2]?.dia} estão mais fracos — uma promoção específica nesses dias equilibra o volume semanal.`)}
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sBase(d: ParsedData, idx: number, total: number): string {
  const tot = d.ativos + d.inativos + d.potenciais;
  const pA  = tot ? (d.ativos     / tot * 100).toFixed(1) : '0';
  const pI  = tot ? (d.inativos   / tot * 100).toFixed(1) : '0';
  const pP  = tot ? (d.potenciais / tot * 100).toFixed(1) : '0';

  const donut = donutSvg([
    { label: 'Ativos',       value: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     value: d.inativos,   color: RED },
    { label: 'Em Potencial', value: d.potenciais, color: BLUE },
  ]);

  const legend = [
    { label: 'Ativos',       pct: pA, count: d.ativos,     color: PRIMARY },
    { label: 'Inativos',     pct: pI, count: d.inativos,   color: RED },
    { label: 'Em Potencial', pct: pP, count: d.potenciais, color: BLUE },
  ].map(l => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid ${BORDER}">
    <div style="width:10px;height:10px;border-radius:2px;background:${l.color};flex-shrink:0"></div>
    <span style="flex:1;font-size:13px;font-weight:600;color:${FG};font-family:${INTER}">${l.label}</span>
    <span style="font-size:20px;font-family:${BEBAS};color:${FG};line-height:1">${num(l.count)}</span>
    <span style="font-size:12px;font-weight:700;color:${l.color};font-family:${INTER};min-width:40px;text-align:right">${l.pct}%</span>
  </div>`).join('');

  const body = `
${secTitle('Base de Clientes', `Total de ${num(tot)} clientes cadastrados`)}
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
  ${kpi('Ativos', num(d.ativos), `${pA}% da base — compraram no período`)}
  ${kpi('Inativos', num(d.inativos), `${pI}% — pararam de comprar`, RED)}
  ${kpi('Em Potencial', num(d.potenciais), `${pP}% — nunca compraram`, BLUE)}
</div>
<div style="display:flex;gap:40px;align-items:center">
  ${donut}
  <div style="flex:1">${legend}</div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sInativos(d: ParsedData, idx: number, total: number): string {
  const max   = Math.max(...d.inativos_faixas.map(f => f.count));
  const bars  = d.inativos_faixas.map(f => hbar(f.label, num(f.count), max ? f.count / max * 100 : 0, f.count === max)).join('');
  const maior = d.inativos_faixas.reduce((a, b) => a.count > b.count ? a : b);
  const body = `
${secTitle('Clientes Inativos por Faixa', `${num(d.inativos)} clientes sem comprar — distribuídos por tempo de ausência`)}
<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px">
  <div>${bars}</div>
  <div>
    ${insight('Prioridade de Reativação', `A maior concentração está em ${maior.label} com ${num(maior.count)} clientes. Comece por eles — são os mais receptivos a uma oferta de retorno.`)}
    <div style="margin-top:12px;border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px">
      <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 8px">Sugestão de Mensagem</p>
      <p style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.6;margin:0">"Faz tempo que você não aparece! Preparamos um mimo especial pra você voltar. Use o cupom <strong style="color:${PRIMARY}">VOLTEI</strong> e ganhe desconto no próximo pedido. Válido por 7 dias!"</p>
    </div>
  </div>
</div>`;
  return wrapSlide(body, idx, total);
}

function sProdutos(d: ParsedData, idx: number, total: number): string {
  const max  = Math.max(...d.produtos.map(p => p.qtd));
  const bars = d.produtos.slice(0, 8).map((p, i) =>
    hbar(p.nome, `${num(p.qtd)} ped${p.total ? ` · ${brl(p.total)}` : ''}`, max ? p.qtd / max * 100 : 0, i < 3)
  ).join('');
  const body = `
${secTitle('Produtos Mais Vendidos', 'Ranking por quantidade de pedidos')}
<div style="display:grid;grid-template-columns:3fr 2fr;gap:28px">
  <div>${bars}</div>
  <div>
    ${d.produtos[0] ? insight('Produto Estrela', `"${d.produtos[0].nome}" lidera com ${num(d.produtos[0].qtd)} pedidos. Use-o como âncora em combos para elevar o ticket médio.`) : ''}
    ${d.produtos[1] ? insight('Combo Sugerido', `"${d.produtos[0]?.nome}" + "${d.produtos[1]?.nome}" — os dois mais pedidos juntos aumentam o ticket e o valor percebido.`) : ''}
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

  const body = `
${secTitle('Regiões com Maior Volume', 'Bairros rankeados por pedidos — dados do CRM')}
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
${bairros[0] ? insight('Fortalecer onde há demanda', `${bairros[0].bairro} lidera com ${num(bairros[0].pedidos)} pedidos. Segmente campanhas Meta para este bairro e os 2 seguintes para maximizar retorno.`) : ''}`;
  return wrapSlide(body, idx, total);
}

function sMetaAds(meta: MetaAds, idx: number, total: number): string {
  const cpl = meta.cliques ? brl(meta.investimento / meta.cliques) : '—';
  const campCards = meta.campanhas.map(c =>
    `<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px;position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${BLUE}"></div>
      <div style="position:absolute;top:0;left:0;width:12px;height:12px;background:${BLUE}"></div>
      <p style="font-size:12px;font-weight:700;color:${FG};font-family:${INTER};margin:4px 0 10px;line-height:1.3">${c.nome}</p>
      <div style="display:flex;flex-direction:column;gap:5px">
        <div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER}"><span style="color:${MUTED}">Investido</span><span style="font-weight:700;color:${FG}">${brl(c.metricas.investimento)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER}"><span style="color:${MUTED}">Alcance</span><span style="font-weight:700;color:${FG}">${num(c.metricas.alcance)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;font-family:${INTER}"><span style="color:${MUTED}">Cliques</span><span style="font-weight:700;color:${FG}">${num(c.metricas.cliques)}</span></div>
      </div>
    </div>`
  ).join('');

  const body = `
${secTitle('Meta Ads — Tráfego Pago', 'Investimento e resultados das campanhas no período')}
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
  ${kpi('Investimento', brl(meta.investimento), 'total investido em anúncios', BLUE)}
  ${kpi('Impressões', num(meta.impressoes), 'vezes que os anúncios foram vistos', BLUE)}
  ${kpi('Alcance', num(meta.alcance), 'pessoas únicas impactadas', BLUE)}
  ${kpi('Cliques', num(meta.cliques), `${cpl} por clique (CPL)`, BLUE)}
</div>
${meta.campanhas.length ? `
  <p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 10px">Campanhas Ativas</p>
  <div style="display:grid;grid-template-columns:repeat(${Math.min(meta.campanhas.length, 3)},1fr);gap:12px">${campCards}</div>
` : ''}`;
  return wrapSlide(body, idx, total);
}

// ── Diagnosis (Claude — JSON only, ~300 tokens) ────────────────────────────────

type DiagJson = {
  diagnostico: string;
  pontos_fortes: string[];
  pontos_atencao: string[];
  plano: Array<{ acao: string; motivo: string }>;
};

async function fetchDiagnosis(d: ParsedData, meta: MetaAds | null, bairros: Bairro[], clientName: string, periodo: string, agencyContext: string): Promise<DiagJson> {
  const summary = {
    cliente: clientName, periodo,
    faturamento: d.faturamento, pedidos: d.pedidos_ativos, ticket: Math.round(d.ticket),
    ativos: d.ativos, inativos: d.inativos, potenciais: d.potenciais,
    top_produtos: d.produtos.slice(0, 3).map(p => `${p.nome} (${p.qtd}x)`),
    top_bairro: bairros[0]?.bairro ?? null,
    meta_ads: meta ? { investimento: meta.investimento, alcance: meta.alcance, cliques: meta.cliques } : null,
    contexto_agencia: agencyContext || null,
  };

  const msg = await anthropic.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 1200,
    system:     'Analista de marketing de delivery. Responda APENAS com JSON válido. Sem markdown, sem texto extra.',
    messages:   [{ role: 'user', content: `DADOS:\n${JSON.stringify(summary, null, 2)}\n\nRetorne:\n{"diagnostico":"2-3 frases sobre o estado do negócio","pontos_fortes":["...","...","..."],"pontos_atencao":["...","..."],"plano":[{"acao":"...","motivo":"..."},{"acao":"...","motivo":"..."},{"acao":"...","motivo":"..."},{"acao":"...","motivo":"..."},{"acao":"...","motivo":"..."}]}` }],
  });

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  try {
    return JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()) as DiagJson;
  } catch {
    return { diagnostico: 'Análise indisponível.', pontos_fortes: [], pontos_atencao: [], plano: [] };
  }
}

function sDiagnostico(diag: DiagJson, idx: number, total: number): string {
  const colLabel = (text: string) =>
    `<p style="font-size:10px;font-weight:700;color:${MUTED};text-transform:uppercase;letter-spacing:0.1em;font-family:${INTER};margin:0 0 10px">${text}</p>`;

  const fortes = diag.pontos_fortes.map(p =>
    `<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid ${BORDER}">
      <div style="width:20px;height:20px;background:${PRIMARY}20;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:${PRIMARY}">✓</div>
      <span style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.4">${p}</span>
    </div>`
  ).join('');

  const atencao = diag.pontos_atencao.map(p =>
    `<div style="display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px solid ${BORDER}">
      <div style="width:20px;height:20px;background:${RED}20;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;color:${RED}">!</div>
      <span style="font-size:13px;color:${FG};font-family:${INTER};line-height:1.4">${p}</span>
    </div>`
  ).join('');

  const plano = diag.plano.map((p, i) =>
    `<div style="display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid ${BORDER}">
      <div style="width:26px;height:26px;background:${PRIMARY};border-radius:2px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <span style="font-size:13px;font-weight:800;color:#0e0f14;font-family:${INTER}">${i + 1}</span>
      </div>
      <div>
        <div style="font-size:13px;font-weight:700;color:${FG};font-family:${INTER}">${p.acao}</div>
        <div style="font-size:12px;color:${MUTED};font-family:${INTER};margin-top:3px">${p.motivo}</div>
      </div>
    </div>`
  ).join('');

  const body = `
${secTitle('Diagnóstico e Plano de Ação', 'Análise do período e próximos passos')}
<div style="border:1px solid ${BORDER};background:${CARD};border-radius:2px;padding:16px 20px;margin-bottom:22px">
  <p style="font-size:14px;color:${FG};font-family:${INTER};line-height:1.7;margin:0">${diag.diagnostico}</p>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1.6fr;gap:24px">
  <div>${colLabel('Pontos Fortes')}${fortes}</div>
  <div>${colLabel('Atenção')}${atencao}</div>
  <div>${colLabel('Plano para o Próximo Mês')}${plano}</div>
</div>`;
  return wrapSlide(body, idx, total);
}

// ── Public builder ─────────────────────────────────────────────────────────────

export async function buildDeliveryReport(opts: {
  clientId:      string;
  clientName:    string;
  from:          string;
  to:            string;
  csvFiles:      { name: string; content: string }[];
  agencyContext?: string;
  connectionId?: string | null;
  accountIds?:   string[];
}): Promise<{ html: string }> {
  const { clientId, clientName, from, to, csvFiles = [], agencyContext = '', connectionId, accountIds = [] } = opts;

  const fromDate  = new Date(from + 'T12:00:00');
  const toDate    = new Date(to + 'T12:00:00');
  const MONTHS    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo   = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;

  // Parse files + fetch API/DB in parallel
  const data = parseAllFiles(csvFiles, toDate);
  const [bairros, meta] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaAds(connectionId, accountIds, from, to),
  ]);

  console.log(`[delivery] ${clientName} | ativos:${data.ativos} inativos:${data.inativos} pot:${data.potenciais} fat:${brl(data.faturamento)} prod:${data.produtos.length} bairros:${bairros.length} meta:${meta ? 'sim' : 'não'}`);

  // Claude writes ONLY the diagnosis (JSON, ~300 tokens)
  const diag = await fetchDiagnosis(data, meta, bairros, clientName, periodo, agencyContext);

  // Determine active slides
  const hasVisao   = data.faturamento > 0 || data.pedidos_ativos > 0;
  const hasDia     = data.por_dia.length > 0;
  const hasBase    = data.ativos > 0 || data.inativos > 0 || data.potenciais > 0;
  const hasInat    = data.inativos_faixas.length > 0;
  const hasProd    = data.produtos.length > 0;
  const hasRegiao  = bairros.length > 0;
  const hasMeta    = meta !== null;

  const total = 1 + (hasVisao ? 1 : 0) + (hasDia ? 1 : 0) + (hasBase ? 1 : 0) + (hasInat ? 1 : 0) + (hasProd ? 1 : 0) + (hasRegiao ? 1 : 0) + (hasMeta ? 1 : 0) + 1;

  const slides: string[] = [];
  let i = 1;
  slides.push(sCapa(data, meta, clientName, periodo, total));
  if (hasVisao)  slides.push(sVisaoGeral(data, ++i, total));
  if (hasDia)    slides.push(sPorDia(data, ++i, total));
  if (hasBase)   slides.push(sBase(data, ++i, total));
  if (hasInat)   slides.push(sInativos(data, ++i, total));
  if (hasProd)   slides.push(sProdutos(data, ++i, total));
  if (hasRegiao) slides.push(sRegioes(bairros, ++i, total));
  if (hasMeta)   slides.push(sMetaAds(meta!, ++i, total));
  slides.push(sDiagnostico(diag, ++i, total));

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
