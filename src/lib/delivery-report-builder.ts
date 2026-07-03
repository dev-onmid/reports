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
// Per-unit costs (CPC, CPM, custo por lead/conversa/compra) are often under R$1 —
// rounding to 0 decimals would show "R$ 0" for a real R$0,26 CPC. Use this instead
// of brl() for any "custo por X" / CPC / CPM metric.
function brlPrecise(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n: number) { return n.toLocaleString('pt-BR'); }

// Use these when 0 means "data not available", not "actually zero"
function brlOrDash(n: number) { return n > 0 ? brl(n) : '—'; }
function brlPreciseOrDash(n: number) { return n > 0 ? brlPrecise(n) : '—'; }
function numOrDash(n: number) { return n > 0 ? num(n) : '—'; }

function cleanJsonString(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i] + value[i + 1];
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += value[i];
  }
  return out;
}

function sanitizeJsonValue<T>(value: T): T {
  if (typeof value === 'string') return cleanJsonString(value) as T;
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item)]),
    ) as T;
  }
  return value;
}

function deltaInfo(current: number, prev: number): { label: string; up: boolean; hasData: boolean } {
  if (!prev) return { label: '—', up: true, hasData: false };
  const diff = ((current - prev) / prev) * 100;
  return { label: `${diff >= 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')}%`, up: diff >= 0, hasData: true };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const PRIMARY      = '#55f52f';   // graphic fills only (bars, borders, squares)
const PRIMARY_TEXT = '#1a8a00';   // green as readable text on white (5.4:1 contrast)
export const CANVAS = '#EEF1F5';
const CARD         = '#FFFFFF';
const BG           = '#F7F8FA';
const ROW          = '#F1F5F9';
const BORDER       = '#D6DEE8';
const FG           = '#0F172A';   // near-black — titles, values
const MUTED        = '#334155';   // cinza chumbo — body text, labels, secondary
const RED          = '#e52020';
const BLUE         = '#0B84FF';
const GOOGLE_BLUE  = '#4285F4';

export const INTER = 'var(--font-inter), Inter, sans-serif';
const BEBAS = "var(--font-bebas), 'Bebas Neue', sans-serif";
export const FONT_LINK = `<style>@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@100..900&display=swap');@font-face{font-family:Inter Fallback;src:local(Arial);ascent-override:90.44%;descent-override:22.52%;line-gap-override:0%;size-adjust:107.12%}@font-face{font-family:Bebas Neue Fallback;src:local(Arial);ascent-override:117.32%;descent-override:39.11%;line-gap-override:0%;size-adjust:76.72%}:root{--font-inter:"Inter","Inter Fallback";--font-bebas:"Bebas Neue","Bebas Neue Fallback";}.onmid-report h1{line-height:1.08!important;letter-spacing:.01em!important}.onmid-report :is(strong,b,th,[style*="font-weight:700"],[style*="font-weight:800"],[style*="font-weight:850"],[style*="font-weight:900"],[style*="font-weight:950"]):not(h1):not(h2){letter-spacing:.004em!important}.onmid-report :is(h3,h4,h5,h6){letter-spacing:.002em!important}</style>`;
const REPORT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function nextMonthName(periodo: string): string {
  const [monthName] = periodo.split('/');
  const index = REPORT_MONTHS.findIndex((month) => month.toLowerCase() === monthName.toLowerCase());
  return REPORT_MONTHS[(index >= 0 ? index + 1 : 5) % REPORT_MONTHS.length];
}

// ── Types ──────────────────────────────────────────────────────────────────────

// ── Report covers ────────────────────────────────────────────────────────────
// Static background art for the capa (cover) slide. `dark` controls whether the
// overlaid title/text switches to white — these images fill the whole slide, the
// left ~45% of each one is a flat color reserved for the text block.
export type ReportCover = { id: string; url: string; dark: boolean };

export const REPORT_COVERS: ReportCover[] = [
  { id: 'light',           url: '/report-covers/cover-light.png',           dark: false },
  { id: 'dark-green',      url: '/report-covers/cover-dark-green.png',      dark: true },
  { id: 'dark-navy-green', url: '/report-covers/cover-dark-navy-green.png', dark: true },
  { id: 'dark-navy',       url: '/report-covers/cover-dark-navy.png',       dark: true },
  { id: 'dark-purple',     url: '/report-covers/cover-dark-purple.png',     dark: true },
];

// `seed` rotates through the list deterministically (sequential round-robin) when
// no explicit coverId is chosen — callers typically pass a count of reports already
// generated so each new report advances to the next cover instead of repeating one.
export function resolveReportCover(coverId: string | null | undefined, seed: number): ReportCover {
  const found = coverId ? REPORT_COVERS.find(c => c.id === coverId) : undefined;
  if (found) return found;
  const index = ((seed % REPORT_COVERS.length) + REPORT_COVERS.length) % REPORT_COVERS.length;
  return REPORT_COVERS[index];
}

// Total reports generated so far, across all clients — used as the rotation seed so
// each new report (regardless of template) advances to the next cover in sequence.
export async function fetchReportRotationSeed(): Promise<number> {
  const pool = makeServerPool();
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM public.diagnostic_reports`);
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  } finally {
    await pool.end();
  }
}

export type Bairro = { bairro: string; pedidos: number; faturamento: number };
type Product     = { nome: string; qtd: number; total: number };
type Faixa       = { label: string; count: number };
type DiaDaSemana = { dia: string; pedidos: number; pct: number };

export type CampanhaDetalhada = {
  nome: string;
  tipo: string;
  metricas: {
    investimento: number;
    impressoes: number;
    alcance: number;
    cliques: number;
    frequencia: number;
    leads: number;
    conversas: number;
    compras: number;
    valor_compras: number;
    purchase_roas: number;
    visitas_pagina: number;       // landing_page_view — pessoas que de fato abriram o cardápio
    iniciaram_checkout: number;   // initiate_checkout
  };
};

export type MetaBreakdownLevel = 'campaign' | 'adset';

export type MetaAdsFull = {
  investimento: number;
  impressoes: number;
  alcance: number;
  cliques: number;
  campanhas: CampanhaDetalhada[];
  nivel: MetaBreakdownLevel;
};

export type CampanhaGoogleDetalhada = {
  nome: string;
  tipo: string; // campaign.advertising_channel_type (SEARCH, DISPLAY, SHOPPING, PERFORMANCE_MAX...)
  metricas: {
    investimento: number;
    impressoes: number;
    cliques: number;
    conversoes: number;
    valorConversoes: number;
  };
};

export type GoogleAdsFull = {
  investimento: number;
  impressoes: number;
  cliques: number;
  conversoes: number;
  valorConversoes: number;
  campanhas: CampanhaGoogleDetalhada[];
};

export type Creative = {
  nome: string;
  spend: number;
  resultado: number;
  purchaseValue?: number;
  campaign_name?: string;
  adset_name?: string;
  objective?: string;
  impressions?: number;
  reach?: number;
  clicks?: number;
  ctr?: number;
  thumbnail_url: string | null;
  media_url: string | null; // playable video source (mp4) or full-size static image — click target
};

export type InstagramData = {
  username: string;
  followers: number;
  followers_period?: number;
  reach: number;
  impressions: number;
  profile_views: number;
  website_clicks: number;
  accounts_engaged: number;
  previous?: InstagramPeriodMetrics | null;
};

export type InstagramPeriodMetrics = {
  followers_period: number;
  reach: number;
  impressions: number;
  profile_views: number;
  website_clicks: number;
  accounts_engaged: number;
};

export type ParsedData = {
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
  entregas_por_dia?: DiaDaSemana[];
};

export type DiagJson = {
  insight_campanha_conversa:  string;
  insight_campanha_conversao: string;
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
  return { headers: parse(lines[0]).map(normalizeHeader), rows: lines.slice(1).map(parse) };
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function readTabular(content: string): { headers: string[]; rows: string[][] } {
  if (content.startsWith('data:')) {
    const b64 = content.includes(';base64,') ? content.split(';base64,')[1] : content;
    try {
      const wb = XLSX.read(b64, { type: 'base64' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, defval: '', raw: false });
      const [headerRow, ...bodyRows] = rawRows.filter(row => row.some(cell => String(cell ?? '').trim()));
      if (!headerRow) return { headers: [], rows: [] };
      return {
        headers: headerRow.map(normalizeHeader),
        rows: bodyRows.map(row => headerRow.map((_, index) => String(row[index] ?? '').trim())),
      };
    } catch {
      return { headers: [], rows: [] };
    }
  }
  return splitCsv(content);
}

export function parseFloat2(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let s = String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[R$\s]/g, '')
    .trim();
  if (!s) return 0;

  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    s = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (comma >= 0) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (dot >= 0 && /\.\d{3}(\D|$)/.test(s)) {
    s = s.replace(/\./g, '');
  }

  return parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
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
  const { headers, rows } = readTabular(content);
  if (!headers.length) return { count: 0, faturamento: 0, pedidos: 0, uma_compra: 0, recorrentes: 0 };

  const vIdx = headers.findIndex(h =>
    h.includes('valor') ||
    h.includes('gasto') ||
    h.includes('faturamento') ||
    h.includes('receita') ||
    h.includes('revenue') ||
    h.includes('total pago') ||
    h.includes('total comprado') ||
    h.includes('total vendido'),
  );
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

// ── Adaptive file interpretation (AI) ───────────────────────────────────────────
// Cardápios digitais (Goomer, Anota Aí, iFood etc.) não têm formato padrão — cada
// restaurante exporta com nomes de arquivo e colunas diferentes. Em vez de exigir que
// o nome do arquivo contenha uma palavra-chave (detectType) e que as colunas usem
// termos previstos, cada arquivo é lido uma vez e mandado pro Claude, que devolve
// quais seções (clientes/produtos/pedidos_dia) ele consegue alimentar e qual coluna
// (dentre as normalizadas por normalizeHeader) corresponde a cada campo. A agregação
// em si (somas, contagens, faixas de inatividade) continua sendo feita aqui, de forma
// determinística, a partir do mapeamento que a IA devolveu — a IA nunca faz conta.

type ClienteSecao = {
  tipo: 'clientes';
  segmento: 'ativos' | 'inativos' | 'potenciais' | 'misto';
  colunaValor: string | null;
  colunaPedidos: string | null;
  colunaUltimaData: string | null;
  colunaStatus: string | null;
  valoresStatus: { ativos?: string; inativos?: string; potenciais?: string } | null;
};
type ProdutoSecao = { tipo: 'produtos'; colunaNome: string; colunaQtd: string | null; colunaTotal: string | null };
type PedidosDiaSecao = { tipo: 'pedidos_dia'; colunaData: string };
type FileSection = ClienteSecao | ProdutoSecao | PedidosDiaSecao;

type FileInterpretation = { filename: string; sections: FileSection[]; aviso?: string };

const FAIXAS_INATIVIDADE = [
  { label: '30–59 dias',   min: 30,  max: 59 },
  { label: '60–89 dias',   min: 60,  max: 89 },
  { label: '90–179 dias',  min: 90,  max: 179 },
  { label: '180–364 dias', min: 180, max: 364 },
  { label: '365+ dias',    min: 365, max: Infinity },
];

function parseDateFlexible(raw: string): Date | null {
  const ds = (raw ?? '').trim();
  if (!ds) return null;
  let d: Date | null = null;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(ds)) { const [dd, mm, yyyy] = ds.split('/'); d = new Date(`${yyyy}-${mm}-${dd}`); }
  else if (/^\d{4}-\d{2}-\d{2}/.test(ds)) { d = new Date(ds); }
  return d && !isNaN(d.getTime()) ? d : null;
}

function isValidFileSection(s: unknown): s is FileSection {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  if (o.tipo === 'clientes') return typeof o.segmento === 'string' && ['ativos', 'inativos', 'potenciais', 'misto'].includes(o.segmento as string);
  if (o.tipo === 'produtos') return typeof o.colunaNome === 'string' && o.colunaNome.length > 0;
  if (o.tipo === 'pedidos_dia') return typeof o.colunaData === 'string' && o.colunaData.length > 0;
  return false;
}

async function interpretDeliveryFile(file: { name: string; content: string }): Promise<FileInterpretation> {
  const { headers, rows } = readTabular(file.content);
  if (!headers.length) return { filename: file.name, sections: [], aviso: 'Planilha vazia ou em formato não reconhecido.' };

  const sample = rows.slice(0, 8);
  const schema = `{
  "secoes": [
    { "tipo": "clientes", "segmento": "ativos"|"inativos"|"potenciais"|"misto", "colunaValor": string|null, "colunaPedidos": string|null, "colunaUltimaData": string|null, "colunaStatus": string|null, "valoresStatus": {"ativos": string, "inativos": string, "potenciais": string} | null },
    { "tipo": "produtos", "colunaNome": string, "colunaQtd": string|null, "colunaTotal": string|null },
    { "tipo": "pedidos_dia", "colunaData": string }
  ],
  "aviso": string | null
}`;
  const prompt = `Arquivo: "${file.name}"
Total de linhas de dados: ${rows.length}
Colunas encontradas: ${JSON.stringify(headers)}
Amostra de linhas (até 8): ${JSON.stringify(sample)}

Identifique quais das seguintes informações esta planilha de delivery (exportada de plataformas como Goomer, Anota Aí, iFood etc, sem formato padrão) pode fornecer. Uma planilha pode conter mais de uma seção ao mesmo tempo (ex: pedidos com cliente, produto e data juntos).

Tipos possíveis de seção:
- "clientes": lista de clientes, com valor gasto e/ou nº de pedidos. Se houver coluna de status/situação com valores tipo ativo/inativo/potencial, use segmento "misto" e preencha colunaStatus + valoresStatus (o texto exato de cada valor, ex: "Ativo"). Caso contrário, decida o segmento pelo nome do arquivo e pelo conteúdo (potenciais = nunca compraram/sem pedidos; inativos = têm data de último pedido antiga; ativos = compraram recentemente).
- "produtos": lista de produtos vendidos, com nome e, se houver, quantidade e valor total.
- "pedidos_dia": linhas de pedidos com uma coluna de data, para calcular distribuição por dia da semana.

Se não for possível identificar nada com confiança, devolva "secoes": [] e explique em "aviso" (frase curta, em português, para mostrar ao usuário).

Regras: use exatamente o texto de uma das colunas listadas em "Colunas encontradas" em cada campo "coluna*" — nunca invente nomes de coluna. Responda APENAS com JSON válido, sem markdown, seguindo este schema:
${schema}`;

  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system:     'Você interpreta planilhas de delivery de restaurantes com estrutura variada. Responda APENAS com JSON válido, sem markdown, sem texto extra.',
      messages:   [{ role: 'user', content: prompt }],
    });
    void logAiUsage({ source: 'report_delivery_csv', model: 'claude-haiku-4-5-20251001', inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens });

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()) as { secoes?: unknown[]; aviso?: string | null };
    const secoes = (Array.isArray(parsed.secoes) ? parsed.secoes : []).filter(isValidFileSection);
    return {
      filename: file.name,
      sections: secoes,
      aviso: secoes.length ? undefined : (parsed.aviso ?? 'Não foi possível identificar o conteúdo desta planilha.'),
    };
  } catch (e) {
    console.error(`[delivery] falha ao interpretar "${file.name}":`, e);
    return { filename: file.name, sections: [], aviso: 'Erro ao interpretar esta planilha — tente novamente.' };
  }
}

function matchStatusSegmento(
  rawStatus: string, valoresStatus: ClienteSecao['valoresStatus'],
): 'ativos' | 'inativos' | 'potenciais' | null {
  if (!valoresStatus) return null;
  const status = normalizeHeader(rawStatus);
  if (!status) return null;
  for (const seg of ['ativos', 'inativos', 'potenciais'] as const) {
    const expected = valoresStatus[seg];
    if (expected && (status.includes(normalizeHeader(expected)) || normalizeHeader(expected).includes(status))) return seg;
  }
  return null;
}

function aggregateClientesSection(
  headers: string[], rows: string[][], section: ClienteSecao, refDate: Date,
): {
  buckets: Record<'ativos' | 'inativos' | 'potenciais', { count: number; fat: number; ped: number; uma: number; recorrentes: number }>;
  faixas: Faixa[];
} {
  const valorIdx = section.colunaValor ? headers.indexOf(section.colunaValor) : -1;
  const pedidosIdx = section.colunaPedidos ? headers.indexOf(section.colunaPedidos) : -1;
  const dataIdx = section.colunaUltimaData ? headers.indexOf(section.colunaUltimaData) : -1;
  const statusIdx = section.colunaStatus ? headers.indexOf(section.colunaStatus) : -1;

  const buckets = {
    ativos:     { count: 0, fat: 0, ped: 0, uma: 0, recorrentes: 0 },
    inativos:   { count: 0, fat: 0, ped: 0, uma: 0, recorrentes: 0 },
    potenciais: { count: 0, fat: 0, ped: 0, uma: 0, recorrentes: 0 },
  };
  const faixasCount = new Map<string, number>();

  for (const row of rows) {
    const seg = section.segmento === 'misto'
      ? (statusIdx >= 0 ? matchStatusSegmento(row[statusIdx] ?? '', section.valoresStatus) : null)
      : section.segmento;
    if (!seg) continue;

    const b = buckets[seg];
    b.count++;
    const fat = valorIdx >= 0 ? parseFloat2(row[valorIdx] ?? '') : 0;
    const pedCount = pedidosIdx >= 0 ? (parseInt(row[pedidosIdx] ?? '0') || 0) : 0;
    b.fat += fat;
    if (pedidosIdx >= 0) {
      b.ped += pedCount;
      if (pedCount === 1) b.uma++;
      else if (pedCount >= 2) b.recorrentes++;
    }

    if (seg === 'inativos' && dataIdx >= 0) {
      const d = parseDateFlexible(row[dataIdx] ?? '');
      if (d) {
        const dias = Math.floor((refDate.getTime() - d.getTime()) / 86_400_000);
        const faixa = FAIXAS_INATIVIDADE.find(f => dias >= f.min && dias <= f.max);
        if (faixa) faixasCount.set(faixa.label, (faixasCount.get(faixa.label) ?? 0) + 1);
      }
    }
  }

  const faixas = FAIXAS_INATIVIDADE
    .map(f => ({ label: f.label, count: faixasCount.get(f.label) ?? 0 }))
    .filter(f => f.count > 0);

  return { buckets, faixas };
}

function aggregateProdutosSection(headers: string[], rows: string[][], section: ProdutoSecao): Product[] {
  const nameIdx = headers.indexOf(section.colunaNome);
  if (nameIdx === -1) return [];
  const qtdIdx = section.colunaQtd ? headers.indexOf(section.colunaQtd) : -1;
  const totalIdx = section.colunaTotal ? headers.indexOf(section.colunaTotal) : -1;

  return rows
    .map(row => ({
      nome:  String(row[nameIdx] ?? '').trim(),
      // Sem coluna de quantidade, cada linha é um item de pedido — conta como 1 unidade.
      qtd:   qtdIdx >= 0 ? (parseInt(String(row[qtdIdx] ?? '0').replace(/\D/g, '')) || 0) : 1,
      total: totalIdx >= 0 ? parseFloat2(row[totalIdx] ?? '') : 0,
    }))
    .filter(p => p.nome && p.nome.length > 1);
}

function aggregatePedidosDiaSection(headers: string[], rows: string[][], section: PedidosDiaSecao): number[] | null {
  const dataIdx = headers.indexOf(section.colunaData);
  if (dataIdx === -1) return null;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    const d = parseDateFlexible(row[dataIdx] ?? '');
    if (d) counts[d.getDay()]++;
  }
  return counts;
}

async function parseAllFilesAdaptive(
  files: { name: string; content: string }[], refDate: Date,
): Promise<{ data: ParsedData; avisos: string[] }> {
  const empty = (): ParsedData => ({
    ativos: 0, inativos: 0, potenciais: 0, faturamento: 0, pedidos_ativos: 0, ticket: 0,
    uma_compra: 0, recorrentes: 0, produtos: [], inativos_faixas: [], por_dia: [],
  });
  if (!files.length) return { data: empty(), avisos: [] };
  if (process.env.SKIP_AI === 'true') return { data: parseAllFiles(files, refDate), avisos: [] };

  const interpretations = await Promise.all(files.map(interpretDeliveryFile));

  const out = empty();
  const avisos: string[] = [];
  const produtosMap = new Map<string, Product>();
  const diaCounts = [0, 0, 0, 0, 0, 0, 0];
  let hasDia = false;
  const faixasMap = new Map<string, number>();

  for (let idx = 0; idx < files.length; idx++) {
    const file = files[idx];
    const interp = interpretations[idx];
    if (!interp.sections.length) {
      avisos.push(`"${file.name}": ${interp.aviso ?? 'não foi possível identificar o conteúdo desta planilha.'}`);
      continue;
    }

    const { headers, rows } = readTabular(file.content);
    if (!headers.length) { avisos.push(`"${file.name}": planilha vazia ou ilegível.`); continue; }

    for (const section of interp.sections) {
      if (section.tipo === 'clientes') {
        const { buckets, faixas } = aggregateClientesSection(headers, rows, section, refDate);
        for (const seg of ['ativos', 'inativos', 'potenciais'] as const) {
          const b = buckets[seg];
          if (!b.count) continue;
          out[seg] += b.count;
          if (seg === 'ativos') {
            out.faturamento += b.fat; out.pedidos_ativos += b.ped;
            out.uma_compra += b.uma; out.recorrentes += b.recorrentes;
          }
        }
        for (const f of faixas) faixasMap.set(f.label, (faixasMap.get(f.label) ?? 0) + f.count);
      } else if (section.tipo === 'produtos') {
        for (const p of aggregateProdutosSection(headers, rows, section)) {
          const key = p.nome.toLowerCase();
          const cur = produtosMap.get(key) ?? { nome: p.nome, qtd: 0, total: 0 };
          cur.qtd += p.qtd; cur.total += p.total;
          produtosMap.set(key, cur);
        }
      } else if (section.tipo === 'pedidos_dia') {
        const counts = aggregatePedidosDiaSection(headers, rows, section);
        if (counts) { hasDia = true; counts.forEach((c, i) => { diaCounts[i] += c; }); }
      }
    }
  }

  out.produtos = [...produtosMap.values()].sort((a, b) => b.qtd - a.qtd || b.total - a.total).slice(0, 10);
  if (hasDia) {
    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const max = Math.max(...diaCounts);
    if (max) out.por_dia = DIAS.map((dia, i) => ({ dia, pedidos: diaCounts[i], pct: (diaCounts[i] / max) * 100 }));
  }
  out.inativos_faixas = FAIXAS_INATIVIDADE
    .map(f => ({ label: f.label, count: faixasMap.get(f.label) ?? 0 }))
    .filter(f => f.count > 0);
  if (out.pedidos_ativos > 0 && out.faturamento > 0) out.ticket = out.faturamento / out.pedidos_ativos;

  return { data: out, avisos };
}

// ── DB / API fetchers ──────────────────────────────────────────────────────────

export async function fetchBairros(clientId: string, from: string, to: string): Promise<Bairro[]> {
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

// ── Meta objective → result metric mapping ──────────────────────────────────
// A creative's "result" and "cost per result" must match its CAMPAIGN OBJECTIVE
// (Vendas/Leads/Tráfego/Engajamento/Alcance/Mensagens) — never a fixed "leads"/CPL
// label. Maps both the new Outcome-Driven Ads (ODAX) objective strings (OUTCOME_SALES,
// OUTCOME_TRAFFIC, OUTCOME_LEADS, OUTCOME_ENGAGEMENT, OUTCOME_AWARENESS,
// OUTCOME_APP_PROMOTION) and the legacy pre-ODAX ones (CONVERSIONS, LINK_CLICKS,
// LEAD_GENERATION, POST_ENGAGEMENT, BRAND_AWARENESS, REACH, MESSAGES...).
type ObjectiveCategory = 'vendas' | 'leads' | 'mensagens' | 'trafego' | 'engajamento' | 'alcance';

function categorizeMetaObjective(raw: string | undefined): ObjectiveCategory {
  // Accepts both the real Meta API enum (OUTCOME_SALES, LINK_CLICKS...) and PT-BR words,
  // in case `objective` ever arrives pre-translated (legacy/cached data, other callers).
  const o = (raw ?? '').toUpperCase();
  if (o.includes('SALES') || o.includes('CONVERSION') || o.includes('CATALOG') || o.includes('VENDA') || o.includes('COMPRA')) return 'vendas';
  if (o.includes('LEAD')) return 'leads';
  if (o.includes('MESSAGE') || o.includes('MENSAGEM') || o.includes('CONVERSA') || o.includes('WHATSAPP')) return 'mensagens';
  if (o.includes('ENGAGEMENT') || o.includes('VIDEO_VIEW') || o.includes('ENGAJAMENTO')) return 'engajamento';
  if (o.includes('AWARENESS') || o.includes('ALCANCE') || o.includes('RECONHECIMENTO') || (o.includes('REACH') && !o.includes('TRAFFIC'))) return 'alcance';
  return 'trafego'; // TRAFFIC, LINK_CLICKS, or unrecognized — clicks/CTR are always meaningful
}

// ── Google Ads campaign type → objective-style mapping ──────────────────────
// Google Ads has no "objective" field like Meta — campaigns are typed by channel
// (SEARCH/DISPLAY/SHOPPING/PERFORMANCE_MAX/VIDEO...). We use the channel type as a
// proxy for funnel stage, refined by whether the campaign actually has tracked
// conversions/conversion value, so a Search campaign with no conversion tracking
// still reads as "tráfego" rather than being miscategorized as "vendas".
type GoogleCampaignKind = 'vendas' | 'leads' | 'trafego' | 'alcance';

const GOOGLE_CHANNEL_LABEL: Record<string, string> = {
  SEARCH: 'Pesquisa', DISPLAY: 'Display', SHOPPING: 'Shopping', VIDEO: 'Vídeo',
  PERFORMANCE_MAX: 'Performance Max', DEMAND_GEN: 'Demand Gen', DISCOVERY: 'Discovery',
  LOCAL: 'Local', LOCAL_SERVICES: 'Serviços Locais', SMART: 'Smart', TRAVEL: 'Viagens',
  MULTI_CHANNEL: 'Multicanal', APP: 'App', HOTEL: 'Hotel',
};

function categorizeGoogleCampaign(channelType: string | undefined, conversions: number, conversionsValue: number): GoogleCampaignKind {
  const t = (channelType ?? '').toUpperCase();
  if (t === 'SHOPPING') return 'vendas';
  if (['DISPLAY', 'VIDEO', 'DEMAND_GEN', 'DISCOVERY', 'SMART'].includes(t)) return 'alcance';
  if (conversionsValue > 0) return 'vendas';
  if (conversions > 0) return 'leads';
  return 'trafego'; // SEARCH, PERFORMANCE_MAX, or unrecognized without conversion data
}

const OBJECTIVE_META: Record<ObjectiveCategory, {
  label: string; resultWord: string; costLabel: string; actionKeys: string[];
}> = {
  // costLabel stays short on purpose — it renders inside a ~110px-wide metric box
  // alongside an icon; "Custo por venda" truncates, "Custo/venda" fits cleanly.
  vendas:      { label: 'Vendas',           resultWord: 'vendas',      costLabel: 'Custo/venda',    actionKeys: ['offsite_conversion.fb_pixel_purchase', 'omni_purchase', 'purchase'] },
  leads:       { label: 'Geração de leads', resultWord: 'leads',       costLabel: 'CPL',            actionKeys: ['onsite_conversion.lead_grouped', 'onsite_conversion.lead', 'offsite_conversion.fb_pixel_lead', 'lead'] },
  mensagens:   { label: 'Conversas',        resultWord: 'conversas',   costLabel: 'Custo/conversa', actionKeys: ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.messaging_conversation_started', 'omni_messaging_conversation_started_7d', 'omni_messaging_conversation_started', 'messaging_conversation_started_7d', 'messaging_conversation_started'] },
  trafego:     { label: 'Tráfego',          resultWord: 'cliques',     costLabel: 'CPC',            actionKeys: ['link_click'] },
  engajamento: { label: 'Engajamento',      resultWord: 'engajamentos', costLabel: 'Custo/engaj.',  actionKeys: ['post_engagement', 'page_engagement'] },
  alcance:     { label: 'Alcance',          resultWord: 'pessoas alcançadas', costLabel: 'CPM',     actionKeys: [] },
};

type CampaignKind = 'mensagens' | 'leads' | 'vendas' | 'trafego' | 'alcance' | 'engajamento';

// These are NOT additive — Meta reports the same underlying conversion under several
// action_type aliases at once (bare / onsite_conversion.* / omni_* namespaces, plus
// different click-attribution windows), so summing all of them multiplies the real
// count by however many aliases happen to be present (we saw a real 31 inflate to 60+
// this way). Ordered most-canonical-first; firstActionValue() picks the first one Meta
// actually reported for that account instead of adding them together.
const MESSAGE_ACTION_KEYS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started',
  'omni_messaging_conversation_started_7d',
  'omni_messaging_conversation_started',
  'messaging_conversation_started_7d',
  'messaging_conversation_started',
];

const LEAD_ACTION_KEYS = ['onsite_conversion.lead_grouped', 'onsite_conversion.lead', 'offsite_conversion.fb_pixel_lead', 'lead'];

// Picks the value for the first key Meta actually reported, in priority order — see
// note above MESSAGE_ACTION_KEYS on why these aliases must not be summed together.
function firstActionValue(actMap: Record<string, number>, keys: string[]): number {
  for (const key of keys) {
    if (actMap[key] !== undefined) return actMap[key];
  }
  return 0;
}

function addInsightActions(target: Record<string, number>, rows: unknown): void {
  for (const action of (rows as Array<{ action_type: string; value: string }> ?? [])) {
    target[action.action_type] = (target[action.action_type] || 0) + parseFloat(action.value || '0');
  }
}

// The real Meta objective (from the API) is the ONLY thing that decides a campaign's
// segment/kind — never the campaign name, and never what it happened to achieve. Name
// regexes only kick in as a fallback when the objective itself is missing/unrecognized
// (categorizeMetaObjective default of 'trafego').
function campaignKindFor(c: CampanhaDetalhada): CampaignKind {
  const m = c.metricas;
  const objective = categorizeMetaObjective(c.tipo);

  // The declared objective is the source of truth for which segment a campaign
  // belongs to — never what it happened to achieve. A Reach-objective campaign that
  // drove a bonus purchase (Meta cross-attributes a lot) must still be filed under
  // Alcance, not Vendas — otherwise its card shows CPA/ROAS for an objective it was
  // never optimized for, and its real alcance metrics (CPM, pessoas atingidas) vanish.
  // A previous "what it achieved wins" override caused exactly that kind of Alcance/
  // Vendas misclassification — do not reintroduce it for these unambiguous objectives.
  if (objective === 'leads')     return 'leads';
  if (objective === 'mensagens') return 'mensagens';
  if (objective === 'vendas')    return 'vendas';
  if (objective === 'alcance')   return 'alcance';

  // 'engajamento' (Meta's OUTCOME_ENGAGEMENT) is genuinely ambiguous — unlike the
  // categories above, the API reports the SAME objective string for click-to-WhatsApp/
  // Messenger/Instagram-Direct message campaigns as it does for plain post/video
  // engagement campaigns; there's no separate "Mensagens" objective in the ODAX model
  // for these. So only here — never for Alcance/Tráfego/Vendas — the actual result
  // (conversas iniciadas or lead) is used to tell them apart.
  if (objective === 'engajamento') {
    if (m.conversas > 0) return 'mensagens';
    if (m.leads > 0)     return 'leads';
    return 'engajamento';
  }

  // objective came back 'trafego' (i.e. unrecognized) — only then fall back to the name.
  const name = c.nome.toLowerCase();
  if (/(venda|convers[aã]o|compra|prato digital)/i.test(name)) return 'vendas';
  if (/(whats|mensagem|conversa)/i.test(name)) return 'mensagens';
  if (/(lead|formul[aá]rio|cadastro)/i.test(name)) return 'leads';
  if (/(topo|alcance|reconhecimento|awareness|reach)/i.test(name)) return 'alcance';
  return 'trafego';
}

// Combined Meta fetch: account totals + campaign details (actions/frequency) + creative thumbnails.
export async function fetchMetaData(
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string, to: string,
  breakdownLevel: MetaBreakdownLevel = 'campaign',
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
  const adInsights: Array<{
    ad_id: string;
    ad_name: string;
    campaign_name: string;
    adset_name: string;
    objective: string;
    spend: number;
    resultado: number;
    purchaseValue: number;
    impressions: number;
    reach: number;
    clicks: number;
    ctr: number;
  }> = [];

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

    // Campaign- or adset-level with actions + frequency, depending on breakdownLevel
    const urlCamp = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlCamp.searchParams.set('fields', 'campaign_name,adset_name,objective,spend,impressions,reach,clicks,frequency,actions,conversions,cost_per_action_type,purchase_roas');
    urlCamp.searchParams.set('time_range', timeRange);
    urlCamp.searchParams.set('level', breakdownLevel);
    // High enough to capture every campaign an account ran in the period — the resumo
    // slide sums leads/conversas/compras across ALL of `campanhas`, so truncating this
    // list (it used to be limit=8, further sliced to 5) silently dropped real results
    // from the totals instead of just trimming which ones get a detail card later.
    urlCamp.searchParams.set('limit', '100');
    urlCamp.searchParams.set('access_token', token);
    const resCamp = await fetch(urlCamp.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (resCamp?.ok) {
      const j = await resCamp.json() as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) {
        const actMap: Record<string, number> = {};
        addInsightActions(actMap, row.actions);
        addInsightActions(actMap, row.conversions);
        const purchaseRoasArr = row.purchase_roas as Array<{ action_type: string; value: string }> | undefined;
        const purchase_roas   = parseFloat(purchaseRoasArr?.[0]?.value ?? '0') || 0;
        const investimento    = parseFloat(String(row.spend ?? '0'));
        const leads = firstActionValue(actMap, LEAD_ACTION_KEYS);
        const conversas = firstActionValue(actMap, MESSAGE_ACTION_KEYS);
        const valorComprasApi =
          actMap['offsite_conversion.fb_pixel_purchase_value'] ||
          actMap['omni_purchase_value'] ||
          actMap['purchase_value'] ||
          0;
        const nomeField = breakdownLevel === 'adset' ? row.adset_name : row.campaign_name;
        campanhas.push({
          nome: String(nomeField ?? row.campaign_name ?? 'Sem nome'),
          tipo: String(row.objective ?? ''),
          metricas: {
            investimento,
            impressoes:    parseInt(String(row.impressions ?? '0'), 10),
            alcance:       parseInt(String(row.reach ?? '0'), 10),
            cliques:       parseInt(String(row.clicks ?? '0'), 10),
            frequencia:    parseFloat(String(row.frequency ?? '0')),
            leads,
            conversas,
            compras:       actMap['offsite_conversion.fb_pixel_purchase'] || actMap['purchase'] || actMap['omni_purchase'] || 0,
            valor_compras: valorComprasApi || (purchase_roas > 0 ? investimento * purchase_roas : 0),
            purchase_roas,
            visitas_pagina:     actMap['landing_page_view'] || 0,
            iniciaram_checkout: actMap['offsite_conversion.fb_pixel_initiate_checkout'] || actMap['initiate_checkout'] || 0,
          },
        });
      }
    }

    // Ad-level for creative ranking. `objective` is requested directly so the result
    // metric always reflects the REAL campaign objective — never a guessed/fixed one.
    // action_values is needed to rank Vendas creatives by actual revenue/ROAS, not just
    // a raw purchase count.
    const urlAd = new URL(`https://graph.facebook.com/v21.0/${acct}/insights`);
    urlAd.searchParams.set('fields', 'ad_id,ad_name,campaign_name,adset_name,objective,spend,impressions,reach,clicks,ctr,actions,conversions,action_values,cost_per_action_type,purchase_roas');
    urlAd.searchParams.set('time_range', timeRange);
    urlAd.searchParams.set('level', 'ad');
    urlAd.searchParams.set('limit', '20');
    urlAd.searchParams.set('access_token', token);
    const resAd = await fetch(urlAd.toString(), { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (resAd?.ok) {
      const j = await resAd.json() as { data?: Record<string, unknown>[] };
      for (const row of j.data ?? []) {
        const actMap: Record<string, number> = {};
        const valueMap: Record<string, number> = {};
        addInsightActions(actMap, row.actions);
        addInsightActions(actMap, row.conversions);
        addInsightActions(valueMap, row.action_values);
        const objectiveRaw = String(row.objective || '');
        const category = categorizeMetaObjective(objectiveRaw);
        const om = OBJECTIVE_META[category];
        const investimento = parseFloat(String(row.spend || '0'));
        const purchaseRoasArr = row.purchase_roas as Array<{ action_type: string; value: string }> | undefined;
        const purchaseRoas = parseFloat(purchaseRoasArr?.[0]?.value ?? '0') || 0;
        const resultado = category === 'trafego'
          ? parseInt(String(row.clicks || '0'), 10)
          : category === 'alcance'
          ? parseInt(String(row.reach || '0'), 10)
          : firstActionValue(actMap, om.actionKeys);
        const purchaseValue = category === 'vendas'
          ? (valueMap['offsite_conversion.fb_pixel_purchase_value'] || valueMap['omni_purchase_value'] || valueMap['purchase_value'] || (purchaseRoas > 0 ? investimento * purchaseRoas : 0))
          : 0;
        adInsights.push({
          ad_id:         String(row.ad_id || ''),
          ad_name:       String(row.ad_name || 'Sem nome'),
          campaign_name: String(row.campaign_name || 'Meta Ads'),
          adset_name:    String(row.adset_name || '—'),
          objective:     objectiveRaw,
          spend:         investimento,
          resultado,
          purchaseValue,
          impressions:   parseInt(String(row.impressions || '0'), 10),
          reach:         parseInt(String(row.reach || '0'), 10),
          clicks:        parseInt(String(row.clicks || '0'), 10),
          ctr:           parseFloat(String(row.ctr || '0')),
        });
      }
    }
  }));

  if (totalSpend === 0 && campanhas.length === 0) return { meta: null, creatives: [] };

  // Keep every campaign here, sorted by spend — sMetaAdsResumo sums leads/conversas/
  // compras across the FULL list, and sMetaAdsCampanhas paginates through all of them
  // (4 per slide) rather than silently hiding whichever ones don't fit on one slide.
  const meta: MetaAdsFull = {
    investimento: totalSpend,
    impressoes:   totalImpressions,
    alcance:      totalReach,
    cliques:      totalCliques,
    campanhas:    campanhas.sort((a, b) => b.metricas.investimento - a.metricas.investimento),
    nivel:        breakdownLevel,
  };

  // Pick top creatives PER OBJECTIVE CATEGORY (Vendas/Leads/Mensagens/Tráfego/Engajamento/
  // Alcance), not one flat ranking by raw volume — a global "highest resultado" sort lets
  // Alcance ads (whose resultado = reach, naturally in the tens of thousands) permanently
  // crowd out every Vendas/Leads ad (whose resultado is a small purchase/lead count), even
  // when those ads are the ones that actually made money. Each category is ranked by the
  // metric that matters for that objective: Vendas by revenue, Leads/Mensagens by lowest
  // cost per result, Tráfego by CTR, Engajamento by engagement count, Alcance by reach.
  const rankWithinCategory = (category: ObjectiveCategory, list: typeof adInsights) => {
    if (category === 'vendas') {
      return [...list].sort((a, b) => (b.purchaseValue || b.resultado) - (a.purchaseValue || a.resultado));
    }
    if (category === 'leads' || category === 'mensagens') {
      const withResult = list.filter(a => a.resultado > 0).sort((a, b) => (a.spend / a.resultado) - (b.spend / b.resultado));
      const withoutResult = list.filter(a => a.resultado === 0).sort((a, b) => b.spend - a.spend);
      return [...withResult, ...withoutResult];
    }
    if (category === 'trafego') return [...list].sort((a, b) => (b.ctr || 0) - (a.ctr || 0) || b.clicks - a.clicks);
    if (category === 'engajamento') return [...list].sort((a, b) => b.resultado - a.resultado);
    return [...list].sort((a, b) => b.resultado - a.resultado); // alcance — reach is the right metric here
  };

  const byCategory = new Map<ObjectiveCategory, typeof adInsights>();
  for (const ad of adInsights) {
    const cat = categorizeMetaObjective(ad.objective);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(ad);
  }
  // Categories with more spend get more representation in the final list (closer to how
  // much the client actually invested in that objective), but every active category gets
  // at least 1 slot — so a small Vendas push never gets fully omitted by a big Alcance one.
  const PER_CATEGORY_CAP = 6;
  const orderedCategories = [...byCategory.entries()]
    .sort((a, b) => b[1].reduce((s, x) => s + x.spend, 0) - a[1].reduce((s, x) => s + x.spend, 0));
  const topByCategory = orderedCategories.flatMap(([cat, list]) => rankWithinCategory(cat, list).slice(0, PER_CATEGORY_CAP)).slice(0, 6);

  const creatives: Creative[] = await Promise.all(topByCategory.map(async (ad) => {
    if (!ad.ad_id) return { nome: ad.ad_name, spend: ad.spend, resultado: ad.resultado, purchaseValue: ad.purchaseValue, campaign_name: ad.campaign_name, adset_name: ad.adset_name, objective: ad.objective, impressions: ad.impressions, reach: ad.reach, clicks: ad.clicks, ctr: ad.ctr, thumbnail_url: null, media_url: null };
    // Fetch creative fields needed to resolve the best thumbnail.
    // video_id is the direct reference used by Reels/video ads; image_url is for static ads.
    // creative.thumbnail_url has an oe= expiry param — we prefer video.picture when possible.
    const creativeFields = 'image_url,thumbnail_url,video_id,object_story_spec{video_data{video_id,image_url}}';
    const url = `https://graph.facebook.com/v21.0/${ad.ad_id}?fields=creative{${creativeFields}}&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    let thumbnail_url: string | null = null;
    let media_url: string | null = null;
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

      // For video/Reels ads, fetch the video object's picture (stable CDN thumbnail) and
      // source (the playable mp4 file) — `source` is what we link to so the click actually
      // plays the ad, not just shows the cover frame.
      if (videoId) {
        const vRes = await fetch(
          `https://graph.facebook.com/v21.0/${videoId}?fields=picture,source&access_token=${token}`,
          { signal: AbortSignal.timeout(6000) },
        ).catch(() => null);
        if (vRes?.ok) {
          const vj = await vRes.json() as { picture?: string; source?: string };
          thumbnail_url = vj.picture ?? null;
          media_url = vj.source ?? null;
        }
        // Fallback: image_url set at ad creation time (explicit thumbnail in video_data)
        if (!thumbnail_url) {
          thumbnail_url = cr.object_story_spec?.video_data?.image_url ?? null;
        }
      }
      // Static image ad or last resort — the full-size image is itself the click target.
      if (!thumbnail_url) {
        thumbnail_url = cr.image_url ?? cr.thumbnail_url ?? null;
      }
      if (!media_url) {
        media_url = cr.image_url ?? thumbnail_url ?? null;
      }
    }
    return {
      nome: ad.ad_name,
      spend: ad.spend,
      resultado: ad.resultado,
      purchaseValue: ad.purchaseValue,
      campaign_name: ad.campaign_name,
      adset_name: ad.adset_name,
      objective: ad.objective,
      impressions: ad.impressions,
      reach: ad.reach,
      clicks: ad.clicks,
      ctr: ad.ctr,
      thumbnail_url,
      media_url,
    };
  }));

  return { meta, creatives };
}

export type InstagramPost = {
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

export type InstagramFull = { insights: InstagramData; posts: InstagramPost[] };
type InstagramPageEntry = {
  id: string;
  name?: string;
  access_token: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    followers_count?: number;
  };
};
type ClientMetaLink = { connection_id: string | null; account_id: string | null };

function normalizeMetaAccountId(accountId: string | null | undefined): string {
  return String(accountId ?? '').trim().replace(/^act_/, '');
}

function uniqueNonEmpty(items: Array<string | null | undefined>): string[] {
  return [...new Set(items.map(item => String(item ?? '').trim()).filter(Boolean))];
}

async function fetchInstagramPagesForAccount(accountId: string, token: string): Promise<InstagramPageEntry[]> {
  const cleanId = normalizeMetaAccountId(accountId);
  if (!cleanId) return [];

  const url = new URL(`https://graph.facebook.com/v21.0/act_${cleanId}/promote_pages`);
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,followers_count}');
  url.searchParams.set('limit', '25');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json() as { data?: InstagramPageEntry[] };
  return data.data ?? [];
}

async function fetchInstagramUserPages(token: string): Promise<InstagramPageEntry[]> {
  const url = new URL('https://graph.facebook.com/v21.0/me/accounts');
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,followers_count}');
  url.searchParams.set('limit', '50');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
  if (!res?.ok) return [];
  const data = await res.json() as { data?: InstagramPageEntry[] };
  return data.data ?? [];
}

// Deterministic resolution: instead of "which pages COULD this ad account promote"
// (act_X/promote_pages — a broad permission-based list that, in an agency Business
// Manager, can surface OTHER clients' pages first), ask "which page do THIS account's
// OWN ads actually run as". We read the page_id straight out of a real ad's creative
// (object_story_spec.page_id, or the <page_id>_<post_id> prefix of effective_object_story_id)
// — that's a 1:1 fact tied to ads this specific client is actually running, not a guess.
async function resolveClientPageIdFromAds(accountId: string, token: string): Promise<string | null> {
  const cleanId = normalizeMetaAccountId(accountId);
  if (!cleanId) return null;

  const url = new URL(`https://graph.facebook.com/v21.0/act_${cleanId}/ads`);
  url.searchParams.set('fields', 'creative{object_story_spec{page_id},effective_object_story_id}');
  url.searchParams.set('limit', '25');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json() as {
    data?: Array<{ creative?: { object_story_spec?: { page_id?: string }; effective_object_story_id?: string } }>;
  };
  for (const ad of data.data ?? []) {
    const cr = ad.creative;
    const pageId = cr?.object_story_spec?.page_id ?? cr?.effective_object_story_id?.split('_')[0];
    if (pageId) return pageId;
  }
  return null;
}

async function fetchInstagramPageByAccountAds(accountId: string, token: string): Promise<InstagramPageEntry | null> {
  const pageId = await resolveClientPageIdFromAds(accountId, token);
  if (!pageId) return null;

  const url = new URL(`https://graph.facebook.com/v21.0/${pageId}`);
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,followers_count}');
  url.searchParams.set('access_token', token);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res?.ok) return null;
  return await res.json() as InstagramPageEntry;
}

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

export async function fetchInstagramData(
  clientId: string,
  connectionId: string | null | undefined,
  accountIds: string[],
  from: string, to: string,
): Promise<InstagramFull | null> {
  const pool = makeServerPool();
  let conn: { id: string; app_id: string; access_token: string; token_expiry: string | null } | null = null;
  let linkedAccountIds: string[] = [];
  try {
    const { rows: links } = await pool.query(
      `SELECT connection_id, account_id
         FROM public.client_account_links
        WHERE client_id = $1
          AND platform IN ('meta_ads','meta')
        ORDER BY created_at ASC`,
      [clientId],
    ).catch(() => ({ rows: [] as ClientMetaLink[] }));

    const scopedLinks = (links as ClientMetaLink[]).filter(link => link.connection_id || link.account_id);
    const preferredConnectionId =
      connectionId ??
      scopedLinks.find(link => link.connection_id)?.connection_id ??
      null;

    if (!preferredConnectionId) return null;

    linkedAccountIds = uniqueNonEmpty([
      ...scopedLinks
        .filter(link => !connectionId || !link.connection_id || link.connection_id === preferredConnectionId)
        .map(link => normalizeMetaAccountId(link.account_id)),
      ...accountIds.map(normalizeMetaAccountId),
    ]);

    const { rows } = await pool.query(
      `SELECT id,app_id,access_token,token_expiry FROM public.meta_connections WHERE id=$1`,
      [preferredConnectionId],
    );
    conn = rows[0] ?? null;
  } finally { await pool.end(); }
  if (!conn) return null;

  const token = await getFreshMetaToken(conn);

  // 1) Deterministic: the page this account's OWN ads actually run as (no guessing).
  let page: InstagramPageEntry | undefined;
  for (const accountId of linkedAccountIds) {
    const resolved = await fetchInstagramPageByAccountAds(accountId, token);
    if (resolved?.instagram_business_account) { page = resolved; break; }
  }

  // 2) Fallback only if the account has no ads yet to read a page from: the old
  // "what could this account promote" guess (may surface another client's page
  // in a shared Business Manager — kept only as a last resort).
  if (!page) {
    for (const accountId of linkedAccountIds) {
      const pages = await fetchInstagramPagesForAccount(accountId, token);
      page = pages.find(p => p.instagram_business_account);
      if (page) break;
    }
  }

  if (!page && linkedAccountIds.length === 0) {
    const pages = await fetchInstagramUserPages(token);
    page = pages.find(p => p.instagram_business_account);
  }

  if (!page?.instagram_business_account) return null;
  const ig = page.instagram_business_account;
  const pageToken = page.access_token;

  // Fetch profile-level insights for the period.
  // Keep every metric isolated: IG rejects the entire request if one metric/parameter
  // combo is invalid. In v21, reach works with period=day without metric_type, while
  // the other profile metrics use metric_type=total_value. "impressions" is deprecated
  // for many IG accounts; "views" is the current replacement.
  const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
  const rangeStart = new Date(from + 'T00:00:00Z');
  const selectedDays = Math.max(1, Math.round((new Date(to + 'T00:00:00Z').getTime() - rangeStart.getTime()) / 86400000) + 1);
  const previousEnd = new Date(rangeStart);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - selectedDays + 1);

  function makePeriodChunks(periodFrom: string, periodTo: string): Array<{ since: number; until: number }> {
    const start = new Date(periodFrom + 'T00:00:00Z');
    const endRaw = new Date(periodTo + 'T23:59:59Z');
    const end = new Date(Math.min(endRaw.getTime(), Date.now()));
    const chunks: Array<{ since: number; until: number }> = [];
    for (const cursor = new Date(start); cursor <= end;) {
      const chunkEnd = new Date(cursor);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 27);
      chunkEnd.setUTCHours(23, 59, 59, 999);
      const finalEnd = new Date(Math.min(chunkEnd.getTime(), end.getTime()));
      chunks.push({
        since: Math.floor(cursor.getTime() / 1000),
        until: Math.floor(finalEnd.getTime() / 1000),
      });
      cursor.setTime(finalEnd.getTime() + 1000);
    }
    return chunks;
  }

  async function fetchIgProfileMetricRange(metric: string, since: number, until: number, metricType?: 'total_value'): Promise<number> {
    const url = new URL(`https://graph.facebook.com/v21.0/${ig!.id}/insights`);
    url.searchParams.set('metric', metric);
    url.searchParams.set('period', 'day');
    url.searchParams.set('since', String(since));
    url.searchParams.set('until', String(until));
    if (metricType) url.searchParams.set('metric_type', metricType);
    url.searchParams.set('access_token', pageToken);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res?.ok) {
      const body = await res?.text().catch(() => '');
      console.error(`[delivery][ig-insights] falha ao buscar "${metric}" (status ${res?.status ?? 'sem resposta'}):`, body);
      return 0;
    }
    const data = await res.json() as {
      data?: Array<{ total_value?: { value: number }; values?: Array<{ value: number }> }>;
    };
    const first = data.data?.[0];
    const totalValue = first?.total_value?.value;
    if (typeof totalValue === 'number') return totalValue;
    return (first?.values ?? []).reduce((sum, item) => sum + (typeof item.value === 'number' ? item.value : 0), 0);
  }

  async function fetchIgProfileMetric(metric: string, chunks: Array<{ since: number; until: number }>, metricType?: 'total_value'): Promise<number> {
    if (!chunks.length) return 0;
    const totals = await Promise.all(
      chunks.map((chunk) => fetchIgProfileMetricRange(metric, chunk.since, chunk.until, metricType)),
    );
    const total = totals.reduce((sum, value) => sum + value, 0);
    if (total > 0 || !metricType) return total;

    // Some IG accounts reject metric_type=total_value for longer windows even when the
    // per-day series exists. Fallback to summing daily values so the selected period is
    // still represented instead of showing only followers.
    const fallbackTotals = await Promise.all(
      chunks.map((chunk) => fetchIgProfileMetricRange(metric, chunk.since, chunk.until)),
    );
    return fallbackTotals.reduce((sum, value) => sum + value, 0);
  }

  async function fetchIgPeriodMetrics(periodFrom: string, periodTo: string): Promise<InstagramPeriodMetrics> {
    const chunks = makePeriodChunks(periodFrom, periodTo);
    const [followers_period, reach, views, profile_views, website_clicks, accounts_engaged] = await Promise.all([
      fetchIgProfileMetric('follower_count', chunks),
      fetchIgProfileMetric('reach', chunks),
      fetchIgProfileMetric('views', chunks, 'total_value'),
      fetchIgProfileMetric('profile_views', chunks, 'total_value'),
      fetchIgProfileMetric('website_clicks', chunks, 'total_value'),
      fetchIgProfileMetric('accounts_engaged', chunks, 'total_value'),
    ]);
    return { followers_period, reach, impressions: views, profile_views, website_clicks, accounts_engaged };
  }

  const [currentMetrics, previousMetrics] = await Promise.all([
    fetchIgPeriodMetrics(from, to),
    fetchIgPeriodMetrics(dateOnly(previousStart), dateOnly(previousEnd)),
  ]);
  const { reach, impressions, profile_views, website_clicks, accounts_engaged } = currentMetrics;

  if (reach === 0 && impressions === 0 && (ig.followers_count ?? 0) === 0) return null;

  const insights: InstagramData = {
    username: ig.username ?? ig.id,
    followers: ig.followers_count ?? 0,
    followers_period: currentMetrics.followers_period,
    reach,
    impressions,
    profile_views,
    website_clicks,
    accounts_engaged,
    previous: previousMetrics,
  };

  // Last posts published within the report period (newest first, capped at 12)
  let posts: InstagramPost[] = [];
  try {
    const since = Math.floor(new Date(from + 'T00:00:00Z').getTime() / 1000);
    const until = Math.floor(new Date(to + 'T23:59:59Z').getTime() / 1000);
    // limit=50 covers virtually any monthly posting cadence — the old limit=12 silently
    // undercounted "Total de publicações" and the calendar for clients posting more often.
    const mediaUrl = new URL(`https://graph.facebook.com/v21.0/${ig.id}/media`);
    mediaUrl.searchParams.set('fields', 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count');
    mediaUrl.searchParams.set('limit', '50');
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

// ── HTML component helpers ─────────────────────────────────────────────────────

// ── Core layout primitives ────────────────────────────────────────────────────

const TITLE_SMALL_WORDS = new Set(['a', 'o', 'as', 'os', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com']);

function reportTitle(text: string): string {
  let wordIndex = 0;
  return text
    .split(/(<br\s*\/?>|\s+)/i)
    .map((part) => {
      if (!part || /^\s+$/.test(part) || /^<br\s*\/?>$/i.test(part)) return part;
      return part
        .split(/([—-])/)
        .map((token) => {
          if (!token || token === '—' || token === '-') return token;
          const lower = token.toLocaleLowerCase('pt-BR');
          const shouldStayLower = wordIndex > 0 && TITLE_SMALL_WORDS.has(lower);
          wordIndex += 1;
          if (shouldStayLower) return lower;
          return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
        })
        .join('');
    })
    .join('');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

// ── Slide builders ────────────────────────────────────────────────────────────

// ── Slide builders — Executive Layout Recipes ─────────────────────────────────

export function sCapa(
  d: ParsedData, meta: MetaAdsFull | null, clientName: string,
  periodo: string, prevPeriodo: string, diag: DiagJson, total: number,
  cover: ReportCover,
  titleText = 'Relatório de Performance',
  apoioText = 'Análise de faturamento, pedidos, tráfego, base de clientes, produtos e oportunidades para o próximo ciclo.',
): string {
  void d;
  void meta;
  void diag;

  const apoio = apoioText;

  // The cover art is a full-bleed background photo/illustration (left side is a flat
  // color reserved for this text block) — on dark covers the title/labels switch to
  // white since FG/MUTED were tuned for the plain light background this slide used
  // to have before covers existed.
  const titleColor   = cover.dark ? '#FFFFFF' : FG;
  const bodyColor     = cover.dark ? 'rgba(255,255,255,.86)' : '#163461';
  const labelColor    = cover.dark ? 'rgba(255,255,255,.86)' : '#14305B';
  const wordmarkColor = cover.dark ? '#FFFFFF' : FG;
  const trademarkColor = cover.dark ? 'rgba(255,255,255,.6)' : MUTED;
  const footerOnmidColor = cover.dark ? '#FFFFFF' : FG;
  const footerReportsColor = cover.dark ? 'rgba(255,255,255,.75)' : '#163461';
  const footerBorder = cover.dark ? 'rgba(255,255,255,.18)' : BORDER;

  // Background is split into separate background-* properties (instead of the
  // `background:${BG} url(...)` shorthand) on purpose — the public report viewer
  // page has a CSS rule matching `[style*="background:${BG}"]` to retheme plain
  // slide backgrounds, and that substring match would otherwise hit this string
  // too and strip the cover image out via !important.
  const body = `<div data-slide-index="1" data-slide-total="${total}" style="width:1440px;min-height:810px;background-color:${BG};background-image:url('${cover.url}');background-size:cover;background-position:center;background-repeat:no-repeat;border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="height:92px;padding:34px 48px 0;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0">
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-family:${INTER};font-size:34px;font-weight:900;letter-spacing:-0.06em;color:${wordmarkColor};line-height:1">onmid</span>
      <span style="width:44px;height:22px;border-radius:999px;background:${PRIMARY};display:inline-flex;align-items:center;justify-content:flex-end;padding-right:4px;box-sizing:border-box;box-shadow:0 8px 20px ${PRIMARY}55">
        <span style="width:14px;height:14px;border-radius:50%;background:#FFFFFF;display:block"></span>
      </span>
      <span style="font-size:9px;font-weight:700;color:${trademarkColor};align-self:flex-start;margin-top:1px">®</span>
    </div>
  </div>

  <div style="position:relative;z-index:1;flex:1;padding:82px 48px 68px;display:grid;grid-template-columns:650px 1fr;column-gap:40px">
    <div style="display:flex;flex-direction:column;min-width:0">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;letter-spacing:-0.045em;color:${titleColor};line-height:1.04;margin:0 0 20px">
        ${reportTitle(titleText)} —<br>${clientName}
      </h1>
      <p style="font-family:${INTER};font-size:20px;font-weight:500;color:${bodyColor};line-height:1.48;margin:0 0 34px;max-width:590px">${apoio}</p>

      <div style="display:flex;flex-direction:column;gap:18px;margin-top:4px">
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:48px;height:48px;border-radius:15px;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M16 2v5M8 2v5M3 10h18"></path>
            </svg>
          </div>
          <p style="font-family:${INTER};font-size:18px;color:${labelColor};margin:0"><strong style="color:${titleColor}">Período analisado:</strong> ${periodo}</p>
        </div>
        <div style="display:flex;align-items:center;gap:20px">
          <div style="width:48px;height:48px;border-radius:15px;background:${BLUE}12;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>
            </svg>
          </div>
          <p style="font-family:${INTER};font-size:18px;color:${labelColor};margin:0"><strong style="color:${titleColor}">Comparativo:</strong> ${prevPeriodo || 'Período anterior não informado'}</p>
        </div>
      </div>
    </div>
  </div>

  <div style="height:56px;border-top:1px solid ${footerBorder};display:flex;align-items:center;padding:0 48px;gap:12px;flex-shrink:0">
    <span style="width:34px;height:18px;border-radius:999px;background:${PRIMARY};display:inline-flex;align-items:center;justify-content:flex-end;padding-right:3px;box-sizing:border-box"><span style="width:11px;height:11px;border-radius:50%;background:#FFFFFF"></span></span>
    <span style="font-family:${INTER};font-size:13px;font-weight:900;color:${footerOnmidColor};letter-spacing:.03em">ONMID</span>
    <span style="font-family:${INTER};font-size:13px;color:${footerReportsColor}">Reports</span>
  </div>
</div>`;
  return auditSlide(body, 'sCapa');
}

export function sVisaoGeral(
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
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;letter-spacing:-0.045em;color:${FG};line-height:1.04;margin:0 0 10px">${reportTitle('Visão geral do mês')}</h1>
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

function sPorDia(d: ParsedData, idx: number, total: number, periodo = 'Maio/2026'): string {
  type Weekday = { short: string; label: string; value: number };
  const dayMeta = [
    { short: 'Seg', label: 'Segunda' },
    { short: 'Ter', label: 'Terça' },
    { short: 'Qua', label: 'Quarta' },
    { short: 'Qui', label: 'Quinta' },
    { short: 'Sex', label: 'Sexta' },
    { short: 'Sáb', label: 'Sábado' },
    { short: 'Dom', label: 'Domingo' },
  ];
  const dayValue = new Map(d.por_dia.map((x) => [x.dia, x.pedidos]));
  const orders: Weekday[] = dayMeta.map((day) => ({ ...day, value: dayValue.get(day.short) ?? 0 }));
  const sortedOrders = [...orders].sort((a, b) => b.value - a.value);
  const strongest = sortedOrders.filter((x) => x.value > 0).slice(0, 2);
  const weakest = [...orders].filter((x) => x.value > 0).sort((a, b) => a.value - b.value).slice(0, 2);
  const topSet = new Set(strongest.map((x) => x.short));
  const maxOrders = Math.max(...orders.map((x) => x.value), 1);
  const totalOrders = orders.reduce((sum, x) => sum + x.value, 0);
  const topPct = totalOrders && strongest.length
    ? Math.round(strongest.reduce((sum, x) => sum + x.value, 0) / totalOrders * 100)
    : 0;
  const month = (periodo.split('/')[0] || 'maio').toLowerCase();

  const deliveryValue = new Map((d.entregas_por_dia ?? []).map((x) => [x.dia, x.pedidos]));
  const deliveries: Weekday[] = (d.entregas_por_dia ?? []).length
    ? dayMeta.map((day) => ({ ...day, value: deliveryValue.get(day.short) ?? 0 }))
    : [];
  const sortedDeliveries = deliveries.length ? [...deliveries].sort((a, b) => b.value - a.value) : [];
  const topDeliverySet = new Set(sortedDeliveries.slice(0, 2).map((x) => x.short));
  const maxDeliveries = Math.max(...sortedDeliveries.map((x) => x.value), 1);

  void idx;
  void total;
  const cardTitle = (iconPath: string, title: string) => `<div style="display:flex;align-items:center;gap:14px">
    <div style="width:48px;height:48px;border-radius:50%;background:${PRIMARY}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
    </div>
    <h2 style="font-family:${INTER};font-size:22px;font-weight:950;color:#050816;letter-spacing:-0.04em;line-height:1.02;margin:0">${title}</h2>
  </div>`;
  const ICO_CAL = '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v5M8 2v5M3 10h18"/>';
  const ICO_TRUCK = '<path d="M10 17h4V5H2v12h3"/><path d="M14 8h4l4 4v5h-3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7"/><path d="M16 5h3v3"/>';
  const ICO_BULB = '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.5 14.5A6 6 0 1 1 15.5 14c-.7.7-1.1 1.4-1.2 2H9.7c-.1-.7-.5-1.2-1.2-1.5z"/><path d="M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 4.2l-1.4 1.4"/>';

  const orderColumns = orders.map((day) => {
    const height = Math.max(18, Math.round(day.value / maxOrders * 250));
    const active = topSet.has(day.short);
    return `<div style="height:318px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:12px;min-width:0">
      <p style="font-family:${INTER};font-size:18px;font-weight:950;color:#050816;margin:0;line-height:1">${day.value ? num(day.value) : '—'}</p>
      <div style="width:34px;height:${height}px;border-radius:8px 8px 0 0;background:${active ? 'linear-gradient(180deg,#10F02E,#00C81F)' : 'linear-gradient(180deg,#DBE7F7,#EEF4FC)'};box-shadow:${active ? `0 12px 22px ${PRIMARY}36` : 'none'}"></div>
      <p style="font-family:${INTER};font-size:12px;font-weight:700;color:#163461;margin:0;line-height:1.15;white-space:nowrap">${day.label}</p>
    </div>`;
  }).join('');

  const deliveryRows = sortedDeliveries.length
    ? sortedDeliveries.map((day) => {
      const width = Math.max(7, Math.round(day.value / maxDeliveries * 100));
      const active = topDeliverySet.has(day.short);
      return `<div style="display:grid;grid-template-columns:88px 1fr 44px;align-items:center;gap:12px">
        <p style="font-family:${INTER};font-size:17px;font-weight:650;color:#163461;margin:0;line-height:1">${day.label}</p>
        <div style="height:26px;background:#F4F7FB;border-radius:5px;overflow:hidden"><div style="height:100%;width:${width}%;border-radius:5px;background:${active ? 'linear-gradient(90deg,#16E52B,#00C91F)' : '#DCE8F7'}"></div></div>
        <p style="font-family:${INTER};font-size:18px;font-weight:950;color:#050816;margin:0;text-align:right;line-height:1">${num(day.value)}</p>
      </div>`;
    }).join('')
    : dayMeta.map((day) => `<div style="display:grid;grid-template-columns:88px 1fr 44px;align-items:center;gap:12px;opacity:.78">
        <p style="font-family:${INTER};font-size:17px;font-weight:650;color:#163461;margin:0;line-height:1">${day.label}</p>
        <div style="height:26px;background:#F4F7FB;border-radius:5px;overflow:hidden"><div style="height:100%;width:0%;border-radius:5px;background:#DCE8F7"></div></div>
        <p style="font-family:${INTER};font-size:18px;font-weight:950;color:#94A3B8;margin:0;text-align:right;line-height:1">—</p>
      </div>`).join('');

  const strongText = strongest.length >= 2
    ? `${strongest[0].label} e ${strongest[1].label.toLowerCase()} concentram ${topPct}% dos pedidos.`
    : `Ainda não há volume suficiente para destacar dias fortes.`;
  const deliveryText = sortedDeliveries[0]
    ? `${sortedDeliveries[0].label} também tem papel importante em entregas.`
    : `Entregas por dia ainda não foram informadas neste arquivo.`;
  const weakText = weakest.length >= 2
    ? `${weakest[0].label} e ${weakest[1].label.toLowerCase()} são os dias mais fracos e pedem campanhas específicas.`
    : `Use campanhas específicas nos dias com menor volume quando houver histórico suficiente.`;
  const opportunityItems = weakest.length >= 2
    ? [`campanhas para ${weakest[0].label.toLowerCase()} e ${weakest[1].label.toLowerCase()}`, 'combos leves', `benefícios para ${weakest.map((x) => x.label.toLowerCase()).join(' e ')}`]
    : ['campanhas de meio de semana', 'combos leves', 'benefícios para dias fracos'];
  const sideCard = (icon: string, title: string, content: string) => `<div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 18px 42px rgba(15,23,42,.075);padding:24px 26px;box-sizing:border-box;flex:1;min-height:0;overflow:hidden">
    ${cardTitle(icon, title)}
    <div style="border-left:3px solid ${PRIMARY};margin:18px 0 0 10px;padding-left:20px">${content}</div>
  </div>`;

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:#FFFFFF;border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:-95px;top:74px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle at 54% 48%,${PRIMARY}2E 0%,#DBEAFE78 35%,rgba(255,255,255,0) 72%);pointer-events:none"></div>
  <div style="position:absolute;left:-120px;bottom:-150px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}28 0%,rgba(219,234,254,.25) 44%,transparent 74%);pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:48px 42px 34px;display:flex;flex-direction:column;box-sizing:border-box">
    <div style="margin-bottom:28px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:950;color:#050816;letter-spacing:-0.06em;line-height:.98;margin:0 0 14px">${reportTitle('Comportamento por dia da semana')}</h1>
      <p style="font-family:${INTER};font-size:23px;font-weight:500;color:#163461;letter-spacing:-0.025em;margin:0">Pedidos e entregas em ${month}</p>
    </div>

    <div style="display:grid;grid-template-columns:1.24fr 1fr 0.96fr;gap:22px;align-items:stretch;min-height:0">
      <div style="height:486px;background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 18px 42px rgba(15,23,42,.075);padding:26px 28px 24px;box-sizing:border-box">
        ${cardTitle(ICO_CAL, 'Pedidos por dia')}
        <div style="height:380px;margin-top:22px;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));align-items:end;gap:10px;border-bottom:1px solid #DDE6F2;padding:0 2px 10px;box-sizing:border-box">${orderColumns}</div>
      </div>

      <div style="height:486px;background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 18px 42px rgba(15,23,42,.075);padding:26px 28px 24px;box-sizing:border-box">
        ${cardTitle(ICO_TRUCK, 'Entregas por dia')}
        <div style="height:374px;margin-top:26px;display:flex;flex-direction:column;justify-content:space-between">${deliveryRows}</div>
      </div>

      <div style="height:486px;display:flex;flex-direction:column;gap:18px">
        ${sideCard(ICO_TARGET, 'Leitura estratégica', `<p style="font-family:${INTER};font-size:15px;font-weight:500;color:#163461;line-height:1.46;margin:0">${strongText} ${deliveryText} ${weakText}</p>`)}
        ${sideCard(ICO_BULB, `Oportunidade para ${nextMonthName(periodo).toLowerCase()}`, `<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px">${opportunityItems.map((item) => `<li style="font-family:${INTER};font-size:14px;font-weight:500;color:#163461;line-height:1.22;display:flex;align-items:flex-start;gap:10px"><span style="width:7px;height:7px;border-radius:50%;background:${PRIMARY};margin-top:5px;flex-shrink:0"></span><span style="min-width:0">${item}</span></li>`).join('')}</ul>`)}
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sPorDia');
}

export function sRegioes(bairros: Bairro[], idx: number, total: number): string {
  const top = [...bairros].sort((a, b) => b.pedidos - a.pedidos).slice(0, 8);
  const top3 = top.slice(0, 3);
  const potential = top.slice(3, 8);
  const month = 'maio';
  const money = (n: number) => n > 0
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
  const shortName = (name?: string) => String(name || '—').replace('Jardim ', '').replace('Fazenda ', '').trim();

  const icon = (path: string, color = PRIMARY_TEXT, bg = `${PRIMARY}18`) =>
    `<div style="width:54px;height:54px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${path}</svg>
    </div>`;
  const ICO_PIN = '<path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/>';
  const ICO_BAG = '<path d="M6 7h12l1 14H5L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>';
  const ICO_COIN = '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.1 1-1.8 2.5-1.8s2.5.7 2.5 1.8-1 1.8-2.5 1.8-2.5.7-2.5 1.8 1 1.8 2.5 1.8 2.5-.7 2.5-1.8"/>';
  const ICO_GROW = '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/><path d="M3 21h18"/>';
  const ICO_ROCKET = '<path d="M4.5 16.5c-1.5 1.2-2 3-2 5 2 0 3.8-.5 5-2"/><path d="M9 15 4 10l4-1 7-7c2.5.7 4.3 2.5 5 5l-7 7-1 4-5-5z"/><circle cx="15" cy="7" r="2"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7"/><path d="M16 5h3v3"/>';

  const rows = top.length
    ? top.map((b, i) => `<tr style="border-bottom:${i === top.length - 1 ? '0' : '1px solid #E7ECF3'}">
        <td style="width:54px;padding:13px 0 13px 10px"><span style="width:27px;height:27px;border-radius:9px;background:${PRIMARY}18;color:${PRIMARY_TEXT};font-family:${INTER};font-size:15px;font-weight:950;display:flex;align-items:center;justify-content:center">${i + 1}</span></td>
        <td style="padding:13px 8px;font-family:${INTER};font-size:16px;font-weight:850;color:#050816;line-height:1.2">${b.bairro}</td>
        <td style="padding:13px 8px;text-align:center;font-family:${INTER};font-size:20px;font-weight:650;color:#0B1B3A">${num(b.pedidos)}</td>
        <td style="padding:13px 10px 13px 8px;text-align:right;font-family:${INTER};font-size:18px;font-weight:500;color:#0B1B3A;white-space:nowrap">${money(b.faturamento)}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="height:360px;text-align:center;font-family:${INTER};font-size:18px;color:#94A3B8">Sem bairros disponíveis neste período</td></tr>`;

  const mapPoints = [
    { x: 344, y: 78, area: 'M270 82 L322 42 L414 58 L436 112 L376 144 L285 130 Z', labelX: 323, labelY: 104, pinX: 348, pinY: 64 },
    { x: 130, y: 195, area: 'M70 214 L118 152 L202 144 L236 207 L168 244 Z', labelX: 76, labelY: 184, pinX: 200, pinY: 184 },
    { x: 391, y: 205, area: 'M310 214 L365 157 L442 178 L461 233 L396 262 Z', labelX: 406, labelY: 194, pinX: 374, pinY: 205 },
    { x: 622, y: 118, area: 'M575 121 L634 74 L719 93 L739 155 L660 180 Z', labelX: 656, labelY: 112, pinX: 639, pinY: 110 },
    { x: 688, y: 247, area: 'M614 257 L674 211 L758 228 L776 282 L702 308 Z', labelX: 617, labelY: 258, pinX: 727, pinY: 238 },
    { x: 266, y: 301, area: 'M218 317 L278 266 L354 286 L330 346 L252 366 Z', labelX: 262, labelY: 291, pinX: 258, pinY: 316 },
    { x: 601, y: 354, area: 'M548 348 L614 301 L686 324 L671 386 L586 397 Z', labelX: 583, labelY: 351, pinX: 608, pinY: 310 },
    { x: 822, y: 309, area: 'M765 315 L831 266 L910 289 L898 348 L814 359 Z', labelX: 838, labelY: 298, pinX: 801, pinY: 306 },
  ];
  const mapped = (top.length ? top : [{ bairro: '—', pedidos: 0, faturamento: 0 }]).slice(0, 8);
  const mapAreas = mapped.map((b, i) => {
    const p = mapPoints[i] ?? mapPoints[mapPoints.length - 1];
    const main = i === 0;
    return `<path d="${p.area}" fill="${main ? '#05C83A' : '#B9F7C8'}" stroke="${main ? '#0BAF35' : '#7EE899'}" stroke-width="2.2" opacity="${main ? '.92' : '.72'}" filter="url(#mapShadow)"/>
      <g transform="translate(${p.pinX - 13} ${p.pinY - 31})">
        <path d="M13 0C6 0 0 5.7 0 12.7 0 22 13 31 13 31s13-9 13-18.3C26 5.7 20 0 13 0z" fill="#12B935"/><circle cx="13" cy="12" r="4.3" fill="#FFFFFF"/>
      </g>
      <foreignObject x="${p.labelX}" y="${p.labelY}" width="154" height="52">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display:inline-flex;max-width:146px;min-height:31px;align-items:center;justify-content:center;text-align:center;background:#FFFFFF;border:1.5px solid #13B63D;border-radius:8px;box-shadow:0 5px 10px rgba(15,23,42,.13);padding:5px 10px;font-family:${INTER};font-size:14px;font-weight:850;color:#0B1B3A;line-height:1.12;box-sizing:border-box">${shortName(b.bairro)}</div>
      </foreignObject>`;
  }).join('');

  const map = `<svg viewBox="0 0 940 430" width="100%" height="100%" preserveAspectRatio="none" style="display:block">
    <defs>
      <filter id="mapShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#0F172A" flood-opacity=".12"/></filter>
      <pattern id="gridRoads" width="74" height="74" patternUnits="userSpaceOnUse">
        <path d="M0 38 H74 M36 0 V74 M10 0 L74 64 M0 68 L68 0" stroke="#DDE5EE" stroke-width="2" opacity=".55"/>
      </pattern>
    </defs>
    <rect width="940" height="430" fill="#F5F8FB"/>
    <rect width="940" height="430" fill="url(#gridRoads)" opacity=".92"/>
    <path d="M0 118 C120 42 222 88 322 25 C430 -42 588 62 712 16 C816 -22 890 18 940 42" fill="none" stroke="#E8EEF5" stroke-width="34" opacity=".78"/>
    <path d="M0 318 C120 238 210 302 322 224 C442 140 575 240 710 175 C815 125 878 148 940 176" fill="none" stroke="#E8EEF5" stroke-width="30" opacity=".82"/>
    <path d="M102 0 C65 91 90 159 13 260 C-20 303 -12 361 20 430" fill="none" stroke="#BDE2FF" stroke-width="18" opacity=".9"/>
    <path d="M0 0 H940 V430 H0 Z" fill="url(#gridRoads)" opacity=".18"/>
    ${mapAreas}
  </svg>`;

  const strongNames = top3.map((b) => shortName(b.bairro)).join(', ') || '—';
  const potentialNames = potential.map((b) => shortName(b.bairro)).join(', ') || '—';
  const strategyCard = (iconPath: string, title: string, text: string, color = PRIMARY_TEXT, bg = `${PRIMARY}18`) =>
    `<div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 14px 34px rgba(15,23,42,.065);padding:15px 18px;display:grid;grid-template-columns:58px 1fr;gap:14px;box-sizing:border-box;height:180px;overflow:hidden">
      ${icon(iconPath, color, bg).replace('width:54px;height:54px;', 'width:52px;height:52px;').replace('width="27" height="27"', 'width="25" height="25"')}
      <div style="border-left:3px solid ${color};padding-left:15px;min-width:0">
        <h3 style="font-family:${INTER};font-size:18px;font-weight:950;color:#050816;line-height:1.08;letter-spacing:-0.04em;margin:0 0 8px">${title}</h3>
        <p style="font-family:${INTER};font-size:13px;font-weight:500;color:#163461;line-height:1.34;margin:0">${text}</p>
      </div>
    </div>`;

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:#FFFFFF;border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;left:-135px;bottom:-170px;width:390px;height:390px;border-radius:50%;background:radial-gradient(circle,${PRIMARY}2E 0%,rgba(219,234,254,.24) 45%,transparent 74%);pointer-events:none"></div>
  <div style="height:92px;padding:34px 40px 0;display:flex;align-items:flex-start;justify-content:space-between;box-sizing:border-box"></div>
  <div style="flex:1;padding:22px 40px 30px;display:grid;grid-template-columns:610px 1fr;gap:28px;box-sizing:border-box">
    <div style="display:flex;flex-direction:column;min-width:0">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:950;color:#050816;letter-spacing:-0.06em;line-height:1.08;margin:0 0 14px">${reportTitle('Regiões com maior<br>volume de pedidos')}</h1>
      <p style="font-family:${INTER};font-size:22px;font-weight:500;color:#163461;letter-spacing:-0.02em;margin:0 0 24px">Bairros com maior força em ${month}</p>
      <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 18px 42px rgba(15,23,42,.075);padding:18px 18px 16px;box-sizing:border-box;flex:1;min-height:0">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <thead>
            <tr style="border-bottom:1px solid #E7ECF3">
              <th style="width:54px"></th>
              <th style="padding:0 8px 14px;text-align:left;font-family:${INTER};font-size:17px;font-weight:950;color:#050816">${icon(ICO_PIN).replace('width:54px;height:54px;', 'width:30px;height:30px;').replace('width="27" height="27"', 'width="16" height="16"')}<span style="vertical-align:middle;margin-left:8px">Bairro</span></th>
              <th style="width:130px;padding:0 8px 14px;text-align:center;font-family:${INTER};font-size:17px;font-weight:950;color:#050816">${icon(ICO_BAG).replace('width:54px;height:54px;', 'width:30px;height:30px;').replace('width="27" height="27"', 'width="16" height="16"')}<span style="vertical-align:middle;margin-left:8px">Pedidos</span></th>
              <th style="width:176px;padding:0 10px 14px 8px;text-align:right;font-family:${INTER};font-size:17px;font-weight:950;color:#050816">${icon(ICO_COIN).replace('width:54px;height:54px;', 'width:30px;height:30px;').replace('width="27" height="27"', 'width="16" height="16"')}<span style="vertical-align:middle;margin-left:8px">Faturamento</span></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div style="display:grid;grid-template-rows:285px 180px 109px;gap:18px;min-width:0">
      <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 18px 42px rgba(15,23,42,.075);overflow:hidden">${map}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
        ${strategyCard(ICO_GROW, 'Fortalecer onde já existe demanda', `${strongNames} lideram em pedidos e faturamento. Manter presença ativa, investir em visibilidade e promoções geo-segmentadas.`)}
        ${strategyCard(ICO_ROCKET, 'Estimular onde há potencial de crescimento', `${potentialNames} mostram espaço para crescer. Campanhas locais e ofertas direcionadas podem acelerar a demanda.`)}
      </div>
      <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 14px 34px rgba(15,23,42,.065);display:grid;grid-template-columns:76px 1fr;gap:16px;align-items:center;padding:14px 20px;box-sizing:border-box;overflow:hidden">
        ${icon(ICO_TARGET, BLUE, `${BLUE}16`).replace('width:54px;height:54px;', 'width:52px;height:52px;').replace('width="27" height="27"', 'width="25" height="25"')}
        <div style="border-left:3px solid ${BLUE};padding-left:18px;min-width:0">
          <h3 style="font-family:${INTER};font-size:17px;font-weight:950;color:#050816;letter-spacing:-0.035em;margin:0 0 5px">Insight para remarketing e campanhas geográficas</h3>
          <p style="font-family:${INTER};font-size:13px;font-weight:500;color:#163461;line-height:1.28;margin:0">Use segmentações por bairro para impactar novamente quem já comprou nessas regiões e criar campanhas específicas para os bairros com maior potencial de crescimento.</p>
        </div>
      </div>
    </div>
  </div>
  ${richFooter()}
</div>`;
  return auditSlide(body, 'sRegioes');
}

function sBase(d: ParsedData, idx: number, total: number): string {
  void idx;
  void total;
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
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 14px 32px rgba(15,23,42,.065);padding:24px 26px;display:flex;align-items:flex-start;gap:18px;min-width:0;min-height:128px;box-sizing:border-box">
      <div style="width:58px;height:58px;border-radius:50%;background:${bg}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="${tc}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icoPath}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:15px;font-weight:600;color:#163461;font-family:${INTER};margin:2px 0 6px">${label}</p>
        <p style="font-family:${INTER};font-size:34px;font-weight:950;letter-spacing:-0.04em;color:${tc};line-height:1;margin:0">${value}</p>
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

    <div style="flex-shrink:0;display:grid;grid-template-columns:360px minmax(0,1fr);gap:28px;align-items:start;margin-bottom:24px">
      <div>
        <h1 style="font-family:${INTER};font-size:46px;font-weight:900;color:${FG};line-height:1.08;margin:0 0 10px;letter-spacing:-0.03em">${reportTitle('Base de clientes e<br>clientes ativos')}</h1>
        <p style="font-size:15px;font-weight:500;color:#163461;font-family:${INTER};margin:0;line-height:1.4">Onde está a maior oportunidade de relacionamento</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:stretch">
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

export function sMetaAdsResumo(meta: MetaAdsFull, idx: number, total: number): string {
  void idx;
  void total;
  const ctr = meta.impressoes > 0 ? (meta.cliques / meta.impressoes) * 100 : 0;
  const cpm = meta.impressoes > 0 ? meta.investimento / (meta.impressoes / 1000) : 0;
  const cpc = meta.cliques > 0 ? meta.investimento / meta.cliques : 0;

  const campaignsBy = (kinds: CampaignKind[]) => meta.campanhas.filter(c => kinds.includes(campaignKindFor(c)));
  const sum = (campaigns: CampanhaDetalhada[], selector: (c: CampanhaDetalhada) => number) =>
    campaigns.reduce((totalValue, campaign) => totalValue + selector(campaign), 0);

  const awarenessCampaigns = campaignsBy(['alcance', 'engajamento']);
  const trafficCampaigns = campaignsBy(['trafego']);
  // Mensagens and leads are kept as two separate groups, never blended into one sum —
  // a "mensagens" campaign's conversas and a "leads" campaign's formulários are two
  // different kinds of result. Mixing them previously made WhatsApp-only accounts show
  // a "Leads de formulário" figure pulled from data that didn't represent a real form.
  const messagingCampaigns = campaignsBy(['mensagens']);
  const leadFormCampaigns = campaignsBy(['leads']);
  const leadCampaigns = [...messagingCampaigns, ...leadFormCampaigns];
  const salesCampaigns = campaignsBy(['vendas']);

  const awarenessInvestment = sum(awarenessCampaigns, c => c.metricas.investimento);
  const awarenessReach = sum(awarenessCampaigns, c => c.metricas.alcance);
  const awarenessImpressions = sum(awarenessCampaigns, c => c.metricas.impressoes);
  const awarenessCpm = awarenessImpressions > 0 ? awarenessInvestment / (awarenessImpressions / 1000) : 0;

  const trafficInvestment = sum(trafficCampaigns, c => c.metricas.investimento);
  const trafficClicks = sum(trafficCampaigns, c => c.metricas.cliques);
  const trafficImpressions = sum(trafficCampaigns, c => c.metricas.impressoes);
  const trafficReach = sum(trafficCampaigns, c => c.metricas.alcance);
  const trafficCpc = trafficClicks > 0 ? trafficInvestment / trafficClicks : 0;
  const trafficCtr = trafficImpressions > 0 ? (trafficClicks / trafficImpressions) * 100 : 0;

  const leadInvestment = sum(leadCampaigns, c => c.metricas.investimento);
  const messagingInvestment = sum(messagingCampaigns, c => c.metricas.investimento);
  const leadFormInvestment = sum(leadFormCampaigns, c => c.metricas.investimento);
  // Scoped strictly to campaigns whose declared objective is Mensagens/Leads — a
  // conversa/lead logged on an Alcance or Tráfego campaign is a bonus result of that
  // OTHER objective, not something to fold into the Leads e conversas totals here.
  const totalConversas = sum(messagingCampaigns, c => c.metricas.conversas);
  const totalFormLeads = sum(leadFormCampaigns, c => c.metricas.leads);
  const totalResultados = totalConversas + totalFormLeads;
  // CPL geral: total invested / all results (conversas + formulários combined).
  // Individual unit costs use total investment too — when results come from mixed
  // campaign types there is no clean per-type investment split, and using a subset
  // (messagingInvestment / leadFormInvestment) produced "—" whenever no pure-type
  // campaign existed.
  const cplGeral     = totalResultados > 0 ? meta.investimento / totalResultados : 0;
  const custoConversa = totalConversas  > 0 ? meta.investimento / totalConversas  : 0;
  const custoFormLead = totalFormLeads  > 0 ? meta.investimento / totalFormLeads  : 0;

  const salesInvestment = sum(salesCampaigns, c => c.metricas.investimento);
  const totalCompras = sum(salesCampaigns, c => c.metricas.compras);
  const valorCompras = sum(salesCampaigns, c => c.metricas.valor_compras);
  const visitasPagina = sum(salesCampaigns, c => c.metricas.visitas_pagina);
  const checkouts = sum(salesCampaigns, c => c.metricas.iniciaram_checkout);
  const cpa = totalCompras > 0 ? salesInvestment / totalCompras : 0;
  const roas = salesInvestment > 0 ? valorCompras / salesInvestment : 0;

  const brlC = (n: number) => n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
  const pctC = (n: number) => n > 0 ? `${n.toFixed(2).replace('.', ',')}%` : '—';
  const decC = (n: number) => n > 0 ? n.toFixed(2).replace('.', ',') : '—';
  const unitWord = meta.nivel === 'adset' ? 'conjunto' : 'campanha';
  const countLabel = (count: number) => count === 1 ? `1 ${unitWord}` : `${count} ${unitWord}s`;

  // ── Top KPI card (icon circle + label + big number) ───────────────────────
  const bigKpi = (label: string, value: string, ico: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:14px 16px;display:flex;align-items:center;gap:12px;min-width:0">
      <div style="width:44px;height:44px;border-radius:50%;background:${PRIMARY}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:12px;font-weight:700;color:#163461;font-family:${INTER};margin:0 0 5px;line-height:1.2">${label}</p>
        <p style="font-family:${INTER};font-size:22px;font-weight:900;letter-spacing:0;color:${FG};line-height:1;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value}</p>
      </div>
    </div>`;

  const ICO_MONEY  = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_EYE    = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_USERS  = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  const ICO_CURSOR = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_CART   = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
  const ICO_PERCENT = '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>';
  const ICO_CHART = '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-8"/><path d="M22 19H2"/>';

  const generalMetrics = [
    bigKpi('Investimento', brlC(meta.investimento), ICO_MONEY),
    bigKpi('Impressões', numOrDash(meta.impressoes), ICO_EYE),
    bigKpi('Alcance', numOrDash(meta.alcance), ICO_USERS),
    bigKpi('Cliques', numOrDash(meta.cliques), ICO_CURSOR),
    bigKpi('CTR', pctC(ctr), ICO_PERCENT),
    bigKpi('CPM', brlC(cpm), ICO_CHART),
    bigKpi('CPC', brlC(cpc), ICO_CURSOR),
    ...(totalResultados > 0 ? [bigKpi('CPL', brlC(cplGeral), ICO_TARGET)] : []),
  ];

  const segmentLine = (label: string, value: string) =>
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-top:1px solid rgba(148,163,184,.18);padding-top:8px">
      <span style="font-family:${INTER};font-size:11px;font-weight:700;color:${MUTED};line-height:1.15">${label}</span>
      <span style="font-family:${INTER};font-size:16px;font-weight:900;color:${FG};line-height:1;text-align:right;white-space:nowrap">${value}</span>
    </div>`;

  const segmentCard = (
    title: string,
    subtitle: string,
    icon: string,
    tint: string,
    accent: string,
    lines: Array<[string, string]>,
  ) =>
    `<div style="background:${tint};border:1px solid ${accent}33;border-radius:18px;box-shadow:0 10px 24px rgba(15,23,42,.05);padding:18px;min-width:0;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:12px;align-items:flex-start;min-height:52px">
        <div style="width:42px;height:42px;border-radius:50%;background:#FFFFFFB8;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </div>
        <div style="min-width:0">
          <p style="font-family:${INTER};font-size:15px;font-weight:900;color:${FG};margin:0 0 4px;line-height:1.1">${title}</p>
          <p style="font-family:${INTER};font-size:11px;font-weight:700;color:#475569;margin:0;line-height:1.3">${subtitle}</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${lines.map(([label, value]) => segmentLine(label, value)).join('')}
      </div>
    </div>`;

  const hasSegmentData = (campaigns: CampanhaDetalhada[], values: number[]) =>
    campaigns.length > 0 || values.some(value => value > 0);

  const leadLines: Array<[string, string]> = [
    ['Investimento', brlC(leadInvestment)],
  ];
  if (messagingCampaigns.length > 0 || totalConversas > 0) {
    leadLines.push(['Conversas iniciadas', totalConversas > 0 ? num(Math.round(totalConversas)) : '—']);
    leadLines.push(['Custo por conversa', brlC(custoConversa)]);
  }
  if (leadFormCampaigns.length > 0 || totalFormLeads > 0) {
    leadLines.push(['Leads de formulário', totalFormLeads > 0 ? num(Math.round(totalFormLeads)) : '—']);
    leadLines.push(['Custo por lead', brlC(custoFormLead)]);
  }

  const segmentCards = [
    hasSegmentData(awarenessCampaigns, [awarenessInvestment, awarenessReach, awarenessImpressions]) ? segmentCard('Alcance e topo', countLabel(awarenessCampaigns.length), ICO_TARGET, '#FFFDF2', '#B45309', [
      ['Investimento', brlC(awarenessInvestment)],
      ['Pessoas atingidas', numOrDash(awarenessReach)],
      ['CPM', brlC(awarenessCpm)],
    ]) : '',
    hasSegmentData(trafficCampaigns, [trafficInvestment, trafficClicks, trafficImpressions, trafficReach]) ? segmentCard('Tráfego de link', countLabel(trafficCampaigns.length), ICO_CURSOR, '#F4F8FF', '#2563EB', [
      ['Investimento', brlC(trafficInvestment)],
      ['Cliques', numOrDash(trafficClicks)],
      ['CPC / CTR', `${brlC(trafficCpc)} / ${pctC(trafficCtr)}`],
      ['Alcance', numOrDash(trafficReach)],
    ]) : '',
    hasSegmentData(leadCampaigns, [leadInvestment, totalConversas, totalFormLeads]) ? segmentCard('Leads e conversas', countLabel(leadCampaigns.length), ICO_USERS, '#F2FFFB', '#0F766E', leadLines) : '',
    hasSegmentData(salesCampaigns, [salesInvestment, totalCompras, valorCompras, visitasPagina, checkouts]) ? segmentCard('Vendas', countLabel(salesCampaigns.length), ICO_CART, '#F7FFF4', PRIMARY_TEXT, [
      ['Investimento', brlC(salesInvestment)],
      ['Compras / CPA', `${totalCompras > 0 ? num(Math.round(totalCompras)) : '—'} / ${brlC(cpa)}`],
      ['Valor de venda', brlC(valorCompras)],
      ['ROAS', decC(roas)],
      ['Visitas / checkouts', `${numOrDash(visitasPagina)} / ${numOrDash(checkouts)}`],
    ]) : '',
  ].filter(Boolean);
  const segmentGridColumns = Math.max(1, Math.min(segmentCards.length, 4));

  // ── Final recommendation ───────────────────────────────────────────────────
  const recommendation = roas >= 3
    ? `As campanhas de vendas apresentaram retorno positivo, com ROAS de ${decC(roas)}. Acompanhar escala mantendo controle de CPM, CPC e custo por compra.`
    : totalCompras > 0
    ? `As campanhas de vendas geraram compras, mas o ROAS de ${decC(roas)} pede atenção: acompanhar custo por compra, valor de venda e checkout antes de ampliar investimento.`
    : totalConversas > 0
    ? `As campanhas de leads e mensagens geraram conversas no período. O próximo foco é qualificar esses contatos, acompanhando custo por conversa e evolução para compra.`
    : totalFormLeads > 0
    ? `As campanhas de leads captaram formulários no período. O próximo foco é qualificar esses contatos, acompanhando CPL e evolução para compra.`
    : `${brlOrDash(meta.investimento)} investidos com ${numOrDash(meta.alcance)} pessoas alcançadas e ${numOrDash(meta.cliques)} cliques no período. Avaliar CTR, CPC e volume de conversões para orientar o próximo ciclo.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:52px 48px 0;display:flex;flex-direction:column;gap:16px">

    <div style="flex-shrink:0">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">${reportTitle('Resumo Meta Ads')}</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Métricas Meta Ads e resultados separados por objetivo de ${meta.nivel === 'adset' ? 'conjunto de anúncios' : 'campanha'}</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex-shrink:0">
      ${generalMetrics.join('')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(${segmentGridColumns},1fr);gap:14px;flex-shrink:0">
      ${segmentCards.join('')}
    </div>

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

export function sPaidTrafficResumo(meta: MetaAdsFull | null, google: GoogleAdsFull | null, idx: number, total: number): string {
  void idx;
  void total;

  const sumMeta = (selector: (c: CampanhaDetalhada) => number) =>
    (meta?.campanhas ?? []).reduce((totalValue, campaign) => totalValue + selector(campaign), 0);

  const metaSpend = meta?.investimento ?? 0;
  const metaImpressions = meta?.impressoes ?? 0;
  const metaClicks = meta?.cliques ?? 0;
  const metaReach = meta?.alcance ?? 0;
  // One result type per campaign — a "mensagens" campaign's result is its conversas,
  // a "leads" campaign's is its formulários, a "vendas" campaign's is its compras.
  // Adding all three fields together regardless of the campaign's real kind double-
  // counted accounts where a messaging campaign also carries a (non-representative)
  // leads value, inflating the headline number well past what any campaign actually
  // converted to.
  const metaResults = sumMeta(c => {
    const kind = campaignKindFor(c);
    if (kind === 'vendas')    return c.metricas.compras;
    if (kind === 'mensagens') return c.metricas.conversas;
    if (kind === 'leads')     return c.metricas.leads;
    return 0;
  });
  const metaRevenue = sumMeta(c => c.metricas.valor_compras);

  const googleSpend = google?.investimento ?? 0;
  const googleImpressions = google?.impressoes ?? 0;
  const googleClicks = google?.cliques ?? 0;
  const googleConversions = google?.conversoes ?? 0;
  const googleRevenue = google?.valorConversoes ?? 0;

  const totalSpend = metaSpend + googleSpend;
  const totalImpressions = metaImpressions + googleImpressions;
  const totalClicks = metaClicks + googleClicks;
  const totalResults = metaResults + googleConversions;
  const totalRevenue = metaRevenue + googleRevenue;
  const totalCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
  const totalCpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
  const totalCpm = totalImpressions > 0 ? totalSpend / (totalImpressions / 1000) : 0;
  const totalCpa = totalResults > 0 ? totalSpend / totalResults : 0;
  const totalRoas = totalSpend > 0 && totalRevenue > 0 ? totalRevenue / totalSpend : 0;

  const brlC = (n: number) => n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
  const pctC = (n: number) => n > 0 ? `${n.toFixed(2).replace('.', ',')}%` : '—';
  const decC = (n: number) => n > 0 ? n.toFixed(2).replace('.', ',') : '—';

  const ICO_MONEY  = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_EYE    = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_CURSOR = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
  const ICO_PERCENT = '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>';
  const ICO_CHART = '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-8"/><path d="M22 19H2"/>';
  const ICO_USERS  = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
  const ICO_META = '<path d="M6.5 15.5c2.5 0 3.2-7 5.5-7s3 7 5.5 7c1.9 0 3.5-1.6 3.5-3.5s-1.6-3.5-3.5-3.5c-2.5 0-3.2 7-5.5 7s-3-7-5.5-7C4.6 8.5 3 10.1 3 12s1.6 3.5 3.5 3.5z"/>';
  const ICO_GOOGLE = '<path d="M21.8 12.2c0-.7-.06-1.3-.18-1.9H12v3.6h5.5c-.24 1.3-.97 2.4-2.06 3.1v2.6h3.3c1.9-1.8 3.06-4.4 3.06-7.4Z"/><path d="M12 22c2.4 0 4.4-.8 5.84-2.16l-3.3-2.6c-.9.6-2.06 1-3.0.96-2.3 0-4.26-1.5-4.96-3.6H2.18v2.66C3.6 19.9 7.5 22 12 22Z"/><path d="M7.04 13.6a5.4 5.4 0 0 1 0-3.4V7.54H2.18a9.96 9.96 0 0 0 0 9.1l4.86-3.04Z"/><path d="M12 6.4c1.3 0 2.5.46 3.4 1.34l2.9-2.86C16.4 3.3 14.4 2.5 12 2.5 7.5 2.5 3.6 4.6 2.18 7.54L7.04 10.6c.7-2.1 2.66-3.6 4.96-4.2Z"/>';

  const bigKpi = (label: string, value: string, ico: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:14px 16px;display:flex;align-items:center;gap:12px;min-width:0">
      <div style="width:44px;height:44px;border-radius:50%;background:${PRIMARY}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:12px;font-weight:700;color:#163461;font-family:${INTER};margin:0 0 5px;line-height:1.2">${label}</p>
        <p style="font-family:${INTER};font-size:22px;font-weight:900;letter-spacing:0;color:${FG};line-height:1;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value}</p>
      </div>
    </div>`;

  const line = (label: string, value: string) =>
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-top:1px solid rgba(148,163,184,.2);padding-top:9px">
      <span style="font-family:${INTER};font-size:12px;font-weight:750;color:${MUTED};line-height:1.15">${label}</span>
      <span style="font-family:${INTER};font-size:17px;font-weight:950;color:${FG};line-height:1;text-align:right;white-space:nowrap">${value}</span>
    </div>`;

  const platformCard = (
    title: string,
    subtitle: string,
    icon: string,
    accent: string,
    tint: string,
    rows: Array<[string, string]>,
  ) =>
    `<div style="background:${tint};border:1px solid ${accent}33;border-left:5px solid ${accent};border-radius:18px;box-shadow:0 12px 28px rgba(15,23,42,.052);padding:22px 24px;display:flex;flex-direction:column;gap:14px;min-width:0">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:52px;height:52px;border-radius:50%;background:#FFFFFFB8;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </div>
        <div style="min-width:0">
          <p style="font-family:${INTER};font-size:20px;font-weight:950;color:${FG};margin:0 0 4px;line-height:1.1">${title}</p>
          <p style="font-family:${INTER};font-size:12px;font-weight:700;color:#475569;margin:0;line-height:1.35">${subtitle}</p>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 22px">
        ${rows.map(([label, value]) => line(label, value)).join('')}
      </div>
    </div>`;

  const metaCtr = metaImpressions > 0 ? (metaClicks / metaImpressions) * 100 : 0;
  const googleCtr = googleImpressions > 0 ? (googleClicks / googleImpressions) * 100 : 0;
  const platformCards = [
    meta ? platformCard('Meta Ads', 'Facebook, Instagram e campanhas vinculadas ao Meta', ICO_META, '#0866FF', '#F4F8FF', [
      ['Investimento', brlC(metaSpend)],
      ['Impressões', numOrDash(metaImpressions)],
      ['Alcance', numOrDash(metaReach)],
      ['Cliques', numOrDash(metaClicks)],
      ['CTR', pctC(metaCtr)],
      ['Resultados', numOrDash(metaResults)],
    ]) : '',
    google ? platformCard('Google Ads', 'Pesquisa, Display, Performance Max e demais campanhas Google', ICO_GOOGLE, GOOGLE_BLUE, '#F6FAFF', [
      ['Investimento', brlC(googleSpend)],
      ['Impressões', numOrDash(googleImpressions)],
      ['Cliques', numOrDash(googleClicks)],
      ['CTR', pctC(googleCtr)],
      ['Conversões', numOrDash(googleConversions)],
      ['Valor conversões', brlC(googleRevenue)],
    ]) : '',
  ].filter(Boolean);

  const generalMetrics = [
    bigKpi('Investimento total', brlC(totalSpend), ICO_MONEY),
    bigKpi('Impressões totais', numOrDash(totalImpressions), ICO_EYE),
    bigKpi('Cliques totais', numOrDash(totalClicks), ICO_CURSOR),
    bigKpi('CTR consolidado', pctC(totalCtr), ICO_PERCENT),
    bigKpi('CPC médio', brlC(totalCpc), ICO_CURSOR),
    bigKpi('CPM médio', brlC(totalCpm), ICO_CHART),
    bigKpi('Resultados / conversões', numOrDash(totalResults), ICO_TARGET),
    bigKpi('ROAS consolidado', decC(totalRoas), ICO_CHART),
  ];

  const recommendation = totalRevenue > 0
    ? `A mídia paga consolidada gerou ${brlC(totalRevenue)} em receita atribuída com ROAS ${decC(totalRoas)}. Comparar Meta Ads e Google Ads separadamente ajuda a decidir onde escalar verba sem misturar objetivos.`
    : totalResults > 0
    ? `A mídia paga consolidada gerou ${numOrDash(totalResults)} resultados/conversões com custo médio de ${brlC(totalCpa)}. Acompanhar a visão individual de cada plataforma antes de redistribuir orçamento.`
    : `Foram investidos ${brlC(totalSpend)} em mídia paga, com ${numOrDash(totalClicks)} cliques e CTR de ${pctC(totalCtr)}. Validar a contribuição individual de Meta Ads e Google Ads no próximo ciclo.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:52px 48px 0;display:flex;flex-direction:column;gap:16px">
    <div style="flex-shrink:0">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">${reportTitle('Resultados de Tráfego Pago')}</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Consolidado de Meta Ads e Google Ads, com leitura geral e visão individual por plataforma</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex-shrink:0">
      ${generalMetrics.join('')}
    </div>

    <div style="display:grid;grid-template-columns:${platformCards.length === 1 ? '1fr' : '1fr 1fr'};gap:18px;flex-shrink:0">
      ${platformCards.join('')}
    </div>

    <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 10px 26px rgba(15,23,42,.06);display:flex;align-items:flex-start;gap:16px;padding:20px 26px">
      <div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_USERS}</svg>
      </div>
      <div style="border-left:2px solid ${PRIMARY};padding-left:18px">
        <p style="font-size:15px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px">Leitura consolidada</p>
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.5;margin:0">${recommendation}</p>
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sPaidTrafficResumo');
}

// ── Instagram Insights ────────────────────────────────────────────────────────

export function sInstagram(ig: InstagramData, idx: number, total: number, periodLabel = 'período selecionado'): string {
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

  const compareLine = (current: number, previous: number | undefined, baseLabel = 'vs período anterior') => {
    if (!previous) {
      return { text: 'sem comparativo anterior', color: MUTED, mark: PRIMARY };
    }
    const diff = current - previous;
    const pct = previous > 0 ? (diff / previous) * 100 : 0;
    if (diff === 0) {
      return { text: `estável ${baseLabel}`, color: MUTED, mark: BORDER };
    }
    const sign = diff > 0 ? '+' : '';
    const abs = `${sign}${num(Math.round(diff))}`;
    const pctText = `${sign}${pct.toFixed(1).replace('.', ',')}%`;
    return {
      text: `${abs} (${pctText}) ${baseLabel}`,
      color: diff > 0 ? PRIMARY_TEXT : RED,
      mark: diff > 0 ? PRIMARY : RED,
    };
  };

  const metricCard = (
    label: string,
    enLabel: string,
    value: string,
    icoPath: string,
    currentCompare: number,
    previousCompare?: number,
    compareLabel = 'vs período anterior',
  ) => {
    const compare = compareLine(currentCompare, previousCompare, compareLabel);
    return (
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
          <span style="width:16px;height:2px;background:${compare.mark};display:inline-block"></span>
          <span style="font-size:12px;color:${compare.color};font-weight:700;font-family:${INTER};line-height:1.25">${compare.text}</span>
        </div>
      </div>
    </div>`);
  };

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

  <!-- Header spacing preserved; logo intentionally suppressed on this slide -->
  <div style="position:relative;z-index:1;height:64px;flex-shrink:0"></div>

  <div style="position:relative;z-index:1;flex:1;padding:30px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:30px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1;margin:0 0 12px;letter-spacing:-0.03em">Instagram</h1>
      <p style="font-size:18px;font-weight:500;color:#163461;font-family:${INTER};margin:0 0 10px">Período: ${periodLabel}</p>
      <span style="width:46px;height:3px;background:${PRIMARY};display:block"></span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:20px">
      ${metricCard('Seguidores', 'followers', numOrDash(ig.followers), ICO_USERS_IG, ig.followers_period ?? 0, ig.previous?.followers_period, 'novos vs período anterior')}
      ${metricCard('Alcance', 'reach', numOrDash(ig.reach), ICO_SIGNAL, ig.reach, ig.previous?.reach)}
      ${metricCard('Visualizações', 'views', numOrDash(ig.impressions), ICO_EYE_IG, ig.impressions, ig.previous?.impressions)}
      ${metricCard('Visitas ao perfil', 'profile_views', numOrDash(ig.profile_views), ICO_USER_IG, ig.profile_views, ig.previous?.profile_views)}
      ${metricCard('Cliques no site', 'website_clicks', numOrDash(ig.website_clicks), ICO_CURSOR_IG, ig.website_clicks, ig.previous?.website_clicks)}
      ${metricCard('Contas engajadas', 'accounts_engaged', numOrDash(ig.accounts_engaged), ICO_HEART_IG, ig.accounts_engaged, ig.previous?.accounts_engaged)}
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
const ICO_REACH     = '<circle cx="12" cy="12" r="2"/><path d="M16.24 16.24a6 6 0 0 0 0-8.49"/><path d="M7.76 7.76a6 6 0 0 0 0 8.49"/><path d="M19.07 19.07a10 10 0 0 0 0-14.14"/><path d="M4.93 4.93a10 10 0 0 0 0 14.14"/>';
const ICO_SAVE      = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>';
const ICO_SHARE     = '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/>';
const ICO_TREND     = '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';

// Shared by sInstagramPosts and sInstagramSpotlight so both slides render the exact
// same icon set, type badge style, and number formatting — same visual standard.
function igCompact(n: number): string {
  if (!n) return '—';
  if (n >= 1000000) return `${(n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (n >= 1000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return num(n);
}
function igIconSvg(paths: string, color = PRIMARY_TEXT, size = 17, fill = 'none') {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${paths}</svg>`;
}
function igMediaKind(mediaType: string): { label: string; color: string; bg: string; icon: string } {
  if (mediaType === 'REELS' || mediaType === 'VIDEO') return { label: 'Reel', color: '#FF4F8B', bg: '#FFF0F6', icon: ICO_PLAY };
  if (mediaType === 'CAROUSEL_ALBUM') return { label: 'Carrossel', color: '#7C5CFF', bg: '#F2EEFF', icon: ICO_LAYERS };
  if (mediaType === 'STORY') return { label: 'Story', color: '#F59E0B', bg: '#FFF7E6', icon: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>' };
  return { label: 'Post Feed', color: PRIMARY_TEXT, bg: '#EAFDE6', icon: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 4v16"/>' };
}
function igMediaOverlay(mediaType: string): string {
  if (mediaType === 'REELS' || mediaType === 'VIDEO') return `<div style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(15,23,42,.25)"><svg width="15" height="15" viewBox="0 0 24 24" fill="white">${ICO_PLAY}</svg></div>`;
  if (mediaType === 'CAROUSEL_ALBUM') return `<div style="position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(15,23,42,.25)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`;
  return '';
}

export function sInstagramCalendar(posts: InstagramPost[], idx: number, total: number, monthDate: Date): string {
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const month = monthDate.getMonth();
  const year = monthDate.getFullYear();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const leadingBlanks = (firstDay + 6) % 7; // Monday-first calendar

  // Slide is capped at 810px tall — a 5- or 6-row month (5-6 weeks) would push a fixed
  // 100px cell past that budget and spill onto a blank extra page when printed, so the
  // cell height (and what fits inside it) shrinks as the month needs more rows.
  const numRows = Math.ceil((leadingBlanks + daysInMonth) / 7);
  const cellHeight = numRows >= 6 ? 72 : numRows === 5 ? 88 : 100;
  const thumbSize = numRows >= 6 ? 26 : numRows === 5 ? 30 : 34;
  const clampLines = numRows >= 6 ? 2 : 3;

  type ContentKind = 'Reel' | 'Carrossel' | 'Story' | 'Feed' | 'Bastidores' | 'Oferta' | 'Prova social' | 'Institucional';
  const kindStyles: Record<ContentKind, { bg: string; border: string; color: string }> = {
    Reel:          { bg: '#EAFDE6', border: '#B9F7AE', color: PRIMARY_TEXT },
    Carrossel:     { bg: '#EAF3FF', border: '#BFDBFE', color: '#2563EB' },
    Story:         { bg: '#FFF7E6', border: '#FDE68A', color: '#B45309' },
    Feed:          { bg: '#F8FAFC', border: '#E2E8F0', color: '#475569' },
    Bastidores:    { bg: '#F5F0FF', border: '#DDD6FE', color: '#7C3AED' },
    Oferta:        { bg: '#FFF1E8', border: '#FDBA74', color: '#EA580C' },
    'Prova social': { bg: '#E6FFFB', border: '#99F6E4', color: '#0F766E' },
    Institucional: { bg: '#FFF0F6', border: '#FBCFE8', color: '#DB2777' },
  };
  const legendKinds = Object.keys(kindStyles) as ContentKind[];

  const formatKind = (p: InstagramPost): ContentKind => {
    const type = p.mediaType;
    if (type === 'REELS' || type === 'VIDEO') return 'Reel';
    if (type === 'CAROUSEL_ALBUM') return 'Carrossel';
    if (type === 'STORY') return 'Story';
    return 'Feed';
  };

  const displayKind = (p: InstagramPost): ContentKind => {
    const caption = p.caption.toLowerCase();
    if (/(promo|oferta|desconto|cupom|comb[oó]|imperd[ií]vel)/i.test(caption)) return 'Oferta';
    if (/(bastidor|equipe|making of|por tr[aá]s|rotina)/i.test(caption)) return 'Bastidores';
    if (/(depoimento|cliente|resultado|antes e depois|avalia[cç][aã]o)/i.test(caption)) return 'Prova social';
    if (/(institucional|marca|hist[oó]ria|miss[aã]o|valores)/i.test(caption)) return 'Institucional';
    return formatKind(p);
  };

  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const postsInMonth = posts.filter((p) => {
    const d = new Date(p.timestamp);
    return !isNaN(d.getTime()) && d.getMonth() === month && d.getFullYear() === year;
  });
  const postsByDay = new Map<string, InstagramPost[]>();
  for (const post of postsInMonth) {
    const key = dayKey(new Date(post.timestamp));
    postsByDay.set(key, [...(postsByDay.get(key) ?? []), post]);
  }

  const formatCounts = postsInMonth.reduce<Record<ContentKind, number>>((acc, post) => {
    const kind = formatKind(post);
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {} as Record<ContentKind, number>);
  const formatScores = postsInMonth.reduce<Record<string, { label: ContentKind; total: number; count: number }>>((acc, post) => {
    const kind = formatKind(post);
    const score = post.reach > 0 ? post.reach : post.likes + post.comments + post.saves;
    acc[kind] = acc[kind] ?? { label: kind, total: 0, count: 0 };
    acc[kind].total += score;
    acc[kind].count += 1;
    return acc;
  }, {});
  const bestFormatEntry = Object.values(formatScores).sort((a, b) => (b.total / Math.max(1, b.count)) - (a.total / Math.max(1, a.count)))[0];
  const bestFormatLabel = bestFormatEntry?.label ?? '—';
  const postingDays = new Set([...postsByDay.keys()]).size;
  const frequency = postsInMonth.length / daysInMonth;
  const frequencyLabel = `${frequency.toFixed(1).replace('.', ',')}/dia`;
  const consistency = frequency >= 0.75 ? 'Consistência boa' : frequency >= 0.35 ? 'Ritmo regular' : 'Ritmo leve';

  const pill = (kind: ContentKind) => {
    const s = kindStyles[kind] ?? kindStyles.Feed;
    return `<span style="display:inline-flex;max-width:84px;height:16px;align-items:center;border-radius:999px;border:1px solid ${s.border};background:${s.bg};color:${s.color};padding:0 7px;font-family:${INTER};font-size:8px;font-weight:850;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0">${kind}</span>`;
  };

  const truncate = (text: string, max: number) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  };

  const thumbBox = (post: InstagramPost) => {
    const s = kindStyles[displayKind(post)] ?? kindStyles.Feed;
    return post.thumbnailUrl
      ? `<div style="width:${thumbSize}px;height:${thumbSize}px;border-radius:7px;overflow:hidden;flex-shrink:0;background:${s.bg};border:1px solid ${s.border}">
          <img src="${post.thumbnailUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.parentElement.style.background='${s.bg}';this.remove()" />
        </div>`
      : `<div style="width:${thumbSize}px;height:${thumbSize}px;border-radius:7px;flex-shrink:0;background:${s.bg};border:1px solid ${s.border};display:flex;align-items:center;justify-content:center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${s.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>
        </div>`;
  };

  const dayCell = (day: number | null) => {
    if (!day) return `<div style="height:${cellHeight}px;border:1px solid #EDF1F6;background:#F8FAFC;border-radius:12px;opacity:.6"></div>`;
    const key = dayKey(new Date(year, month, day));
    const dayPosts = postsByDay.get(key) ?? [];
    if (!dayPosts.length) {
      return `<div style="height:${cellHeight}px;border:1px solid #EDF1F6;background:#FFFFFF;border-radius:12px;padding:8px;box-sizing:border-box">
        <span style="font-family:${INTER};font-size:12px;font-weight:850;color:#94A3B8;line-height:1">${day}</span>
      </div>`;
    }
    const main = dayPosts[0];
    const mainPermalink = main.permalink?.trim();
    const extraCount = dayPosts.length - 1;
    const extra = extraCount > 0 ? `<span style="font-family:${INTER};font-size:9px;font-weight:900;color:#94A3B8;flex-shrink:0">+${extraCount}</span>` : '';
    const inner = `<div style="height:${cellHeight}px;border:1px solid #DDEFE1;background:#FBFFFA;border-radius:12px;padding:8px;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:5px;flex-shrink:0">
        <span style="font-family:${INTER};font-size:12px;font-weight:850;color:${FG};line-height:1;flex-shrink:0">${day}</span>
        <div style="display:flex;align-items:center;gap:4px;min-width:0">
          ${pill(displayKind(main))}
          ${extra}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start;min-width:0;flex:1">
        ${thumbBox(main)}
        <div style="min-width:0;flex:1;display:flex;flex-direction:column">
          <p style="font-family:${INTER};font-size:9px;font-weight:650;color:#475569;line-height:1.22;margin:0;display:-webkit-box;-webkit-line-clamp:${clampLines};-webkit-box-orient:vertical;overflow:hidden">${truncate(main.caption, 78) || 'sem legenda'}</p>
        </div>
      </div>
    </div>`;
    if (!mainPermalink || mainPermalink === '#') return inner;
    return `<a href="${escapeHtmlAttr(mainPermalink)}" target="_blank" rel="noopener noreferrer" style="display:block;height:${cellHeight}px;text-decoration:none;color:inherit">${inner}</a>`;
  };

  const calendarCells: Array<number | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, n) => n + 1),
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);

  const statIcon = (paths: string) =>
    `<div style="width:40px;height:40px;border-radius:50%;background:${PRIMARY}18;display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>
    </div>`;
  const statCard = (title: string, value: string, helper: string, iconPath: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 14px 30px rgba(15,23,42,.055);padding:18px 17px;display:flex;align-items:center;gap:14px;box-sizing:border-box;flex:1">
      ${statIcon(iconPath)}
      <div style="min-width:0">
        <p style="font-family:${INTER};font-size:12px;font-weight:800;color:#64748B;margin:0 0 4px;line-height:1.1">${title}</p>
        <p style="font-family:${INTER};font-size:25px;font-weight:950;color:#050816;margin:0;line-height:1;letter-spacing:-0.04em">${value}</p>
        <p style="font-family:${INTER};font-size:10px;font-weight:700;color:#94A3B8;margin:6px 0 0;line-height:1.2">${helper}</p>
      </div>
    </div>`;

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:-100px;top:-170px;width:610px;height:540px;border-radius:50%;background:linear-gradient(135deg,rgba(226,232,240,.7),rgba(255,255,255,.12));opacity:.8;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:42px 46px 34px;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin:0 0 21px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:950;color:#050816;line-height:.95;margin:0 0 15px;letter-spacing:-0.055em">${reportTitle('Calendário de postagens')}</h1>
      <div style="width:38px;height:3px;border-radius:999px;background:${PRIMARY}"></div>
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) 292px;gap:24px;flex:1;min-height:0">
      <div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.055);padding:22px;box-sizing:border-box;display:flex;flex-direction:column;min-width:0">
        <div style="display:flex;align-items:center;gap:13px;margin-bottom:18px">
          <div style="width:42px;height:42px;border-radius:12px;background:${PRIMARY}18;display:flex;align-items:center;justify-content:center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v5M8 2v5M3 10h18"/></svg>
          </div>
          <div>
            <p style="font-family:${INTER};font-size:28px;font-weight:950;color:#050816;letter-spacing:-0.04em;line-height:1;margin:0">${MONTHS[month]} <span style="color:${PRIMARY_TEXT}">${year}</span></p>
            <p style="font-family:${INTER};font-size:12px;font-weight:700;color:#94A3B8;margin:5px 0 0">${postingDays} dia${postingDays !== 1 ? 's' : ''} com conteúdo publicado</p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:8px">
          ${['SEG','TER','QUA','QUI','SEX','SÁB','DOM'].map((d) => `<div style="font-family:${INTER};font-size:10px;font-weight:950;color:#64748B;letter-spacing:.08em;text-align:center">${d}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px">
          ${calendarCells.map(dayCell).join('')}
        </div>

        <div style="margin-top:auto;padding-top:17px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid #EEF2F7">
          ${legendKinds.map((kind) => {
            const s = kindStyles[kind];
            return `<span style="display:inline-flex;align-items:center;gap:6px;font-family:${INTER};font-size:10px;font-weight:800;color:#64748B;line-height:1"><i style="width:8px;height:8px;border-radius:50%;background:${s.color};display:block"></i>${kind}</span>`;
          }).join('')}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        ${statCard('Total de publicações', num(postsInMonth.length), '— vs mês anterior', '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v5M8 2v5M3 10h18"/>')}
        ${statCard('Reels', num(formatCounts.Reel ?? 0), '— vs mês anterior', ICO_PLAY)}
        ${statCard('Carrosséis', num(formatCounts.Carrossel ?? 0), '— vs mês anterior', ICO_LAYERS)}
        ${statCard('Melhor formato', bestFormatLabel, bestFormatEntry ? 'Maior desempenho médio' : 'Sem dados suficientes', '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>')}
        ${statCard('Frequência média', frequencyLabel, consistency, '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-8"/><path d="M22 19H2"/>')}
      </div>
    </div>
  </div>
</div>`;
  return auditSlide(body, 'sInstagramCalendar');
}

export function monthsBetweenInclusive(fromDate: Date, toDate: Date): Date[] {
  const start = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1, 12);
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1, 12);
  const months: Date[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setMonth(cursor.getMonth() + 1)) {
    months.push(new Date(cursor));
  }
  return months.length ? months : [start];
}

export function sInstagramPosts(posts: InstagramPost[], idx: number, total: number): string {
  const score = (p: InstagramPost) => (p.reach > 0 ? p.reach : 0) + (p.likes + p.comments + p.saves) * 12 + p.videoViews * 0.2;
  const featuredPosts = [...posts].sort((a, b) => score(b) - score(a)).slice(0, 4);

  const truncateCaption = (text: string, max: number) => {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  };

  // Compact pill: icon + label + value on one line. `highlight` styles the Engajamento cell.
  const metricPill = (iconPath: string, label: string, value: string, highlight = false) =>
    `<div style="height:30px;border:1px solid ${highlight ? '#DDF6D8' : '#E8EDF4'};border-radius:8px;background:${highlight ? 'linear-gradient(135deg,#F0FDEC,#FFFFFF)' : 'rgba(255,255,255,.92)'};display:flex;align-items:center;gap:5px;padding:0 7px;box-sizing:border-box;overflow:hidden">
      ${igIconSvg(iconPath, PRIMARY_TEXT, 11)}
      <div style="min-width:0;display:flex;align-items:baseline;gap:4px;overflow:hidden">
        <p style="font-family:${INTER};font-size:8.5px;font-weight:850;color:#64748B;margin:0;line-height:1;white-space:nowrap">${label}</p>
        <p style="font-family:${INTER};font-size:12px;font-weight:950;color:${highlight ? PRIMARY_TEXT : '#111827'};margin:0;line-height:1;letter-spacing:-0.02em;white-space:nowrap">${value}</p>
      </div>
    </div>`;

  const postCard = (p: InstagramPost) => {
    const kind = igMediaKind(p.mediaType);
    const interactions = p.likes + p.comments + p.saves;
    const engagement = p.reach > 0 ? (interactions / p.reach) * 100 : 0;
    const engagementText = p.reach > 0 ? `${engagement.toFixed(1).replace('.', ',')}%` : '—';
    const thumb = p.thumbnailUrl
      ? `<img src="${p.thumbnailUrl}" alt="" style="width:100%;height:100%;object-fit:cover;display:block" />`
      : `<div style="width:100%;height:100%;background:linear-gradient(135deg,#EAFDE6,#F8FAFC);display:flex;align-items:center;justify-content:center"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`;

    return `<div style="height:236px;background:${CARD};border:1px solid #E7ECF3;border-radius:14px;box-shadow:0 12px 28px rgba(15,23,42,.05);display:flex;gap:16px;padding:12px;box-sizing:border-box;overflow:hidden">
      <div style="position:relative;width:190px;border-radius:10px;background:${ROW};overflow:hidden;flex-shrink:0">
        ${thumb}
        ${igMediaOverlay(p.mediaType)}
      </div>

      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;padding-top:2px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0">
          <div style="height:24px;border-radius:7px;background:${kind.bg};color:${kind.color};display:inline-flex;align-items:center;gap:5px;padding:0 9px;font-family:${INTER};font-size:10px;font-weight:900;line-height:1;flex-shrink:0">
            ${igIconSvg(kind.icon, kind.color, 12)}
            ${kind.label}
          </div>
          <p style="font-family:${INTER};font-size:10px;font-weight:800;color:#64748B;margin:0;text-transform:capitalize;white-space:nowrap;flex-shrink:0">${formatPostDate(p.timestamp)}</p>
        </div>

        <p style="font-family:${INTER};font-size:11px;font-weight:650;color:#475569;line-height:1.3;margin:0;flex-shrink:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${truncateCaption(p.caption, 86) || 'sem legenda'}</p>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          ${metricPill(ICO_REACH, 'Alcance', igCompact(p.reach))}
          ${metricPill(ICO_SHARE, 'Interações', igCompact(interactions))}
          ${metricPill(ICO_HEART, 'Curtidas', igCompact(p.likes))}
          ${metricPill(ICO_SAVE, 'Salvamentos', igCompact(p.saves))}
          ${metricPill(ICO_COMMENT, 'Comentários', igCompact(p.comments))}
          ${metricPill(ICO_TREND, 'Engajamento', engagementText, true)}
        </div>
      </div>
    </div>`;
  };

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:-90px;top:-180px;width:620px;height:560px;border-radius:50%;background:linear-gradient(135deg,rgba(241,245,249,.72),rgba(255,255,255,.1));opacity:.78;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:42px 44px 30px;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin:0 0 18px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:950;color:#050816;line-height:.95;margin:0 0 13px;letter-spacing:-0.055em">${reportTitle('Top conteúdos do mês')}</h1>
      <p style="font-size:18px;font-weight:500;color:#6B7280;font-family:${INTER};margin:0;letter-spacing:-0.015em">Entregas dos principais posts do último mês</p>
      <div style="width:36px;height:3px;border-radius:999px;background:${PRIMARY};margin-top:13px"></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px 24px;flex:1;align-content:start">
      ${featuredPosts.map(postCard).join('')}
    </div>
  </div>
</div>`;
  return auditSlide(body, 'sInstagramPosts');
}

// ── Instagram — spotlight on the best-performing post ─────────────────────────

export function sInstagramSpotlight(posts: InstagramPost[], idx: number, total: number): string {
  const best = bestInstagramPost(posts);
  if (!best) return '';

  const others = posts.filter(p => p.id !== best.id);
  const hasReach = best.reach > 0;
  const avgOthers = others.length
    ? others.reduce((s, p) => s + (hasReach ? p.reach : p.likes + p.comments), 0) / others.length
    : 0;
  const bestScore = hasReach ? best.reach : best.likes + best.comments;
  const liftPct = avgOthers > 0 ? Math.round(((bestScore - avgOthers) / avgOthers) * 100) : 0;

  const kind = igMediaKind(best.mediaType);
  const isVideo = best.mediaType === 'REELS' || best.mediaType === 'VIDEO';
  const caption = best.caption.length > 220 ? best.caption.slice(0, 220).trim() + '…' : best.caption;
  const interactions = best.likes + best.comments + best.saves;
  const engagement = best.reach > 0 ? (interactions / best.reach) * 100 : 0;
  const engagementText = best.reach > 0 ? `${engagement.toFixed(1).replace('.', ',')}%` : '—';

  // Same icon set + pill language as "Top conteúdos do mês" — same visual standard,
  // just sized up for a hero treatment around the centered, larger thumbnail.
  const heroMetric = (iconPath: string, label: string, value: string, highlight = false) =>
    `<div style="height:62px;border:1px solid ${highlight ? '#DDF6D8' : '#E7ECF3'};border-radius:14px;background:${highlight ? 'linear-gradient(135deg,#F0FDEC,#FFFFFF)' : CARD};box-shadow:0 10px 24px rgba(15,23,42,.05);display:flex;align-items:center;gap:13px;padding:0 16px;box-sizing:border-box">
      <div style="width:36px;height:36px;border-radius:10px;background:${highlight ? `${PRIMARY}22` : `${PRIMARY}15`};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        ${igIconSvg(iconPath, PRIMARY_TEXT, 18)}
      </div>
      <div style="min-width:0">
        <p style="font-size:11px;font-weight:700;color:${MUTED};margin:0 0 2px;font-family:${INTER};line-height:1">${label}</p>
        <p style="font-size:19px;font-weight:900;color:${highlight ? PRIMARY_TEXT : FG};margin:0;font-family:${INTER};line-height:1;letter-spacing:-0.02em">${value}</p>
      </div>
    </div>`;

  const leftMetrics = [
    heroMetric(ICO_REACH, 'Alcance', hasReach ? num(best.reach) : '—'),
    heroMetric(ICO_HEART, 'Curtidas', num(best.likes)),
    heroMetric(ICO_COMMENT, 'Comentários', num(best.comments)),
  ];
  const rightMetrics = [
    heroMetric(ICO_SHARE, 'Interações', num(interactions)),
    heroMetric(ICO_SAVE, 'Salvamentos', num(best.saves)),
    heroMetric(ICO_TREND, 'Engajamento', engagementText, true),
  ];

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:44px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:16px">
      <h1 style="font-family:${INTER};font-size:44px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 6px;letter-spacing:-0.03em">${reportTitle('Melhor conteúdo do mês')}</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">O post com melhor desempenho entre os publicados no período</p>
    </div>

    <div style="display:flex;align-items:center;justify-content:center;gap:28px;flex-shrink:0;margin-bottom:16px">
      <div style="display:flex;flex-direction:column;gap:10px;width:250px;flex-shrink:0">
        ${leftMetrics.join('')}
      </div>

      <div style="position:relative;width:330px;height:380px;border-radius:22px;overflow:hidden;background:${ROW};box-shadow:0 20px 46px rgba(15,23,42,.16);flex-shrink:0">
        ${best.thumbnailUrl
          ? `<img src="${best.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover" />`
          : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#E1306C22,#F7717122)"><svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#E1306C" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICO_LAYERS}</svg></div>`}
        ${isVideo ? `<div style="position:absolute;top:16px;right:16px;width:40px;height:40px;border-radius:50%;background:rgba(15,23,42,.62);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(15,23,42,.25)"><svg width="18" height="18" viewBox="0 0 24 24" fill="white">${ICO_PLAY}</svg></div>` : ''}
        <div style="position:absolute;top:16px;left:16px;height:28px;border-radius:8px;background:${kind.bg};color:${kind.color};display:inline-flex;align-items:center;gap:6px;padding:0 12px;font-family:${INTER};font-size:11px;font-weight:900;line-height:1;box-shadow:0 6px 16px rgba(15,23,42,.12)">
          ${igIconSvg(kind.icon, kind.color, 13)}
          ${kind.label}
        </div>
        <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(0deg,rgba(15,23,42,.8),transparent);padding:26px 18px 16px">
          <p style="color:white;font-family:${INTER};font-size:14px;font-weight:700;margin:0;text-transform:capitalize">${formatPostDate(best.timestamp)}</p>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:10px;width:250px;flex-shrink:0">
        ${rightMetrics.join('')}
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:10px;max-width:1000px;margin:0 auto;width:100%">
      ${caption ? `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 12px 28px rgba(15,23,42,.06);padding:14px 20px">
        <p style="font-size:14px;color:#163461;font-family:${INTER};line-height:1.5;margin:0">"${caption}"</p>
      </div>` : ''}

      <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 12px 28px rgba(15,23,42,.06);display:flex;align-items:flex-start;gap:16px;padding:14px 20px">
        <div style="width:38px;height:38px;border-radius:50%;background:${PRIMARY}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          ${igIconSvg(ICO_TREND, PRIMARY_TEXT, 17)}
        </div>
        <div style="border-left:2px solid ${PRIMARY};padding-left:16px">
          <p style="font-size:14px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px">Por que esse post se destacou</p>
          <p style="font-size:13px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.5;margin:0">
            ${liftPct > 0
              ? `${hasReach ? 'Alcance' : 'Engajamento'} ${liftPct}% acima da média dos outros posts do período — vale repetir o formato e o tema.`
              : `Melhor resultado do período entre os posts publicados — bom modelo para repetir formato e tema.`}
          </p>
        </div>
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sInstagramSpotlight');
}

export function sCriativos(creatives: Creative[], idx: number, total: number): string {
  const cleanText = (text?: string) => String(text || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\b(on|meta|ads|maio|junho|julho|alcance|vendas|whats|leads?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const titleCase = (text: string) => text
    .toLowerCase()
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  const titleFor = (c: Creative) => {
    const clean = cleanText(c.nome) || cleanText(c.campaign_name) || c.nome || 'Criativo pago';
    const title = titleCase(clean).slice(0, 40);
    return title.length < clean.length ? `${title}…` : title;
  };
  const compact = (n?: number): string => {
    if (!n) return '—';
    if (n >= 1000000) return `${(n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (n >= 1000) return `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return num(n);
  };
  const moneyCompact = (n: number) => {
    if (!n || n <= 0) return '—';
    if (n >= 1000) return `R$ ${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: n >= 10 ? 0 : 2, maximumFractionDigits: n >= 10 ? 0 : 2 });
  };
  const pct = (n?: number) => n && n > 0 ? `${n.toFixed(2).replace('.', ',')}%` : '—';
  const cpl = (c: Creative) => c.resultado > 0 && c.spend > 0 ? c.spend / c.resultado : 0;
  const cpm = (c: Creative) => c.spend > 0 && (c.impressions ?? 0) > 0 ? c.spend / ((c.impressions ?? 0) / 1000) : 0;
  const roas = (c: Creative) => c.spend > 0 && (c.purchaseValue ?? 0) > 0 ? (c.purchaseValue ?? 0) / c.spend : 0;

  const iconSvg = (path: string, size = 14, color = PRIMARY_TEXT) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">${path}</svg>`;
  const ICO_CAMPAIGN = '<path d="M4 13a8 8 0 0 1 8-8h7v7a8 8 0 0 1-8 8H4v-7z"/><path d="M14 6l4 4"/>';
  const ICO_SET = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h7M7 16h5"/>';
  const ICO_OBJ = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>';
  const ICO_USER = '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>';
  const ICO_COIN = '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1.1 1-1.8 2.5-1.8s2.5.7 2.5 1.8-1 1.8-2.5 1.8-2.5.7-2.5 1.8 1 1.8 2.5 1.8 2.5-.7 2.5-1.8"/>';
  const ICO_TREND = '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>';
  const ICO_CURSOR = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_ALERT = '<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/>';
  const ICO_CART = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_RECEIPT = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>';

  // Each objective gets its own accent color (reused from sMetaAdsCampanhas) and a
  // one-line explanation of WHAT metric decides the ranking — this is the actual fix:
  // a Vendas section is ranked by revenue/ROAS, an Alcance section by reach/CPM, etc.
  // Mixing them into one "highest volume wins" ranking is how vanity metrics creep in.
  const styleForCategory = (cat: ObjectiveCategory) => {
    if (cat === 'vendas') return { bg: '#F7FFF4', border: '#D7F8D0', accent: PRIMARY_TEXT, iconBg: '#ECFCE8' };
    if (cat === 'trafego') return { bg: '#F6FAFF', border: '#BFDBFE', accent: '#2563EB', iconBg: '#EAF3FF' };
    if (cat === 'alcance') return { bg: '#FFFDF5', border: '#FDE68A', accent: '#B45309', iconBg: '#FFF7E6' };
    if (cat === 'mensagens' || cat === 'leads') return { bg: '#F4FFFB', border: '#99F6E4', accent: '#0F766E', iconBg: '#E6FFFB' };
    return { bg: '#FAF7FF', border: '#DDD6FE', accent: '#7C3AED', iconBg: '#F5F0FF' };
  };
  const criterionFor = (cat: ObjectiveCategory) => ({
    vendas:      'ranqueado por valor de venda e ROAS — o que realmente vendeu',
    leads:       'ranqueado por menor custo por lead',
    mensagens:   'ranqueado por menor custo por conversa',
    trafego:     'ranqueado por CTR — engajamento real com o criativo',
    engajamento: 'ranqueado por volume de engajamento',
    alcance:     'ranqueado por alcance e CPM — visibilidade da marca',
  }[cat]);

  // Single-line + ellipsis (instead of wrapping) so a long campaign/conjunto name can
  // never push the card taller than its fixed height and clip the status badge below.
  const originLine = (icon: string, label: string, value?: string) =>
    `<div style="display:flex;align-items:center;gap:10px;min-width:0">
      ${iconSvg(icon, 15)}
      <p style="font-family:${INTER};font-size:12px;color:#475569;margin:0;line-height:1.2;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><strong style="font-weight:850;color:#64748B">${label}:</strong> <span style="color:#475569">${value && value !== '—' ? value : '—'}</span></p>
    </div>`;
  const metric = (icon: string, label: string, value: string, color = PRIMARY_TEXT) =>
    `<div style="height:50px;min-width:0;overflow:hidden;border:1px solid #E8EDF4;border-radius:10px;background:#FFFFFF;display:flex;align-items:center;gap:5px;padding:0 7px;box-sizing:border-box">
      ${iconSvg(icon, 11, color)}
      <div style="min-width:0;overflow:visible">
        <p style="font-family:${INTER};font-size:8px;font-weight:850;color:#64748B;margin:0 0 4px;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</p>
        <p style="font-family:${INTER};font-size:14px;font-weight:950;color:#050816;margin:0;line-height:1.05;letter-spacing:0;white-space:normal;overflow:visible;word-break:normal">${value}</p>
      </div>
    </div>`;

  // Metric grid tailored to the objective — a Vendas creative shows revenue/ROAS, a
  // Tráfego creative shows CPC/CTR, etc. Never the same generic 6 boxes for everyone.
  const metricsFor = (c: Creative, cat: ObjectiveCategory, accent: string) => {
    if (cat === 'vendas') return [
      metric(ICO_COIN, 'Invest.', moneyCompact(c.spend), accent),
      metric(ICO_CART, 'Compras', c.resultado > 0 ? compact(Math.round(c.resultado)) : '—', accent),
      metric(ICO_COIN, 'Custo/venda', cpl(c) > 0 ? moneyCompact(cpl(c)) : '—', accent),
      metric(ICO_RECEIPT, 'Valor venda', moneyCompact(c.purchaseValue ?? 0), accent),
      metric(ICO_TREND, 'ROAS', roas(c) > 0 ? `${roas(c).toFixed(2)}×` : '—', accent),
      metric(ICO_CURSOR, 'Cliques', compact(c.clicks), accent),
    ];
    if (cat === 'leads' || cat === 'mensagens') {
      const om = OBJECTIVE_META[cat];
      return [
        metric(ICO_COIN, 'Invest.', moneyCompact(c.spend), accent),
        metric(ICO_USER, om.resultWord === 'leads' ? 'Leads' : 'Conversas', c.resultado > 0 ? compact(Math.round(c.resultado)) : '—', accent),
        metric(ICO_COIN, om.costLabel, cpl(c) > 0 ? moneyCompact(cpl(c)) : '—', accent),
        metric(ICO_TREND, 'CTR', pct(c.ctr), accent),
      ];
    }
    if (cat === 'trafego') return [
      metric(ICO_COIN, 'Invest.', moneyCompact(c.spend), accent),
      metric(ICO_CURSOR, 'Cliques', compact(c.clicks), accent),
      metric(ICO_COIN, 'CPC', c.clicks && c.spend > 0 ? moneyCompact(c.spend / c.clicks) : '—', accent),
      metric(ICO_TREND, 'CTR', pct(c.ctr), accent),
      metric(ICO_OBJ, 'Alcance', compact(c.reach), accent),
    ];
    if (cat === 'engajamento') return [
      metric(ICO_COIN, 'Invest.', moneyCompact(c.spend), accent),
      metric(ICO_USER, 'Engajamentos', c.resultado > 0 ? compact(Math.round(c.resultado)) : '—', accent),
      metric(ICO_COIN, 'Custo/engaj.', cpl(c) > 0 ? moneyCompact(cpl(c)) : '—', accent),
      metric(ICO_OBJ, 'Alcance', compact(c.reach), accent),
      metric(ICO_TREND, 'CTR', pct(c.ctr), accent),
    ];
    // alcance — volume IS the correct metric for this objective, so reach/CPM lead here.
    return [
      metric(ICO_COIN, 'Invest.', moneyCompact(c.spend), accent),
      metric(ICO_OBJ, 'Alcance', compact(c.reach), accent),
      metric(ICO_COIN, 'CPM', cpm(c) > 0 ? moneyCompact(cpm(c)) : '—', accent),
      metric(ICO_USER, 'Impress.', compact(c.impressions), accent),
      metric(ICO_CURSOR, 'Cliques', compact(c.clicks), accent),
    ];
  };

  // Status badge per category — the #1 in each group gets a badge that names the metric
  // it actually won on, instead of a blanket "Maior volume" applied regardless of goal.
  const statusFor = (c: Creative, i: number, cat: ObjectiveCategory, group: Creative[]) => {
    const winnerLabel = {
      vendas: roas(c) > 0 ? `Melhor ROAS (${roas(c).toFixed(1)}×)` : 'Mais vendas',
      leads: 'Melhor CPL', mensagens: 'Melhor custo/conversa',
      trafego: 'Melhor CTR', engajamento: 'Mais engajamento', alcance: 'Maior alcance',
    }[cat];
    if (i === 0) return { label: winnerLabel, icon: ICO_TREND, color: PRIMARY_TEXT, bg: '#ECFCE8', border: '#D7F8D0' };
    const cost = cpl(c);
    const costs = group.map(cpl).filter(v => v > 0);
    if (cost > 0 && costs.length > 1 && cost === Math.max(...costs)) {
      return { label: 'Ponto de atenção', icon: ICO_ALERT, color: RED, bg: '#FFF1F2', border: '#FECACA' };
    }
    return { label: 'Boa eficiência', icon: ICO_TREND, color: PRIMARY_TEXT, bg: '#ECFCE8', border: '#D7F8D0' };
  };

  const card = (c: Creative, i: number, cat: ObjectiveCategory, _group: Creative[], style: ReturnType<typeof styleForCategory>) => {
    const isVideo = /video|reel|narrad/i.test(c.nome);
    const preview = c.thumbnail_url
      ? `<img src="${c.thumbnail_url}" style="width:100%;height:100%;object-fit:cover;display:block" />`
      : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,${style.iconBg},#F8FAFC);color:#94A3B8;font-family:${INTER};font-size:10px;font-weight:800;text-align:center;padding:10px;box-sizing:border-box">Preview indisponível</div>`;

    return `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:14px;box-shadow:0 8px 22px rgba(15,23,42,.05);display:grid;grid-template-columns:24px 110px minmax(0,1fr);gap:10px;padding:12px;box-sizing:border-box;overflow:hidden">
      <div style="width:24px;height:28px;border-radius:7px;background:${style.accent}14;border:1px solid ${style.accent}33;display:flex;align-items:center;justify-content:center">
        <span style="font-family:${INTER};font-size:16px;font-weight:950;color:${style.accent};letter-spacing:-0.05em;line-height:1">${i + 1}º</span>
      </div>
      ${c.media_url ? `<a href="${c.media_url}" target="_blank" rel="noopener noreferrer" style="position:relative;display:block;width:110px;height:190px;border-radius:9px;background:${ROW};border:1px solid #E8EDF4;overflow:hidden;cursor:pointer">` : `<div style="position:relative;width:110px;height:190px;border-radius:9px;background:${ROW};border:1px solid #E8EDF4;overflow:hidden">`}
        ${preview}
        ${isVideo ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:32px;height:32px;border-radius:50%;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.75)"><svg width="12" height="12" viewBox="0 0 24 24" fill="white" style="margin-left:2px">${ICO_PLAY}</svg></div></div>` : ''}
      ${c.media_url ? '</a>' : '</div>'}
      <div style="min-width:0;display:flex;flex-direction:column;gap:7px">
        <h2 style="font-family:${INTER};font-size:14px;font-weight:950;color:#050816;letter-spacing:-0.03em;line-height:1.15;margin:0">${titleFor(c)}</h2>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${originLine(ICO_CAMPAIGN, 'Campanha', c.campaign_name || 'Meta Ads')}
          ${originLine(ICO_SET, 'Conjunto', c.adset_name)}
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:5px">
          ${metricsFor(c, cat, style.accent).join('')}
        </div>
      </div>
    </div>`;
  };

  // Group by real objective (in the same spend-desc priority order the fetch already
  // selected them in) — each group becomes its own labeled section with its own ranking.
  const groups = new Map<ObjectiveCategory, Creative[]>();
  for (const c of creatives) {
    const cat = categorizeMetaObjective(c.objective);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(c);
  }

  const section = ([cat, group]: [ObjectiveCategory, Creative[]]) => {
    const style = styleForCategory(cat);
    const om = OBJECTIVE_META[cat];
    return `<div style="margin-bottom:22px">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:12px">
        <div style="width:4px;height:18px;background:${style.accent};border-radius:2px;flex-shrink:0"></div>
        <p style="font-family:${INTER};font-size:16px;font-weight:900;color:#050816;margin:0">${om.label}</p>
        <p style="font-family:${INTER};font-size:12px;font-weight:600;color:#64748B;margin:0">— ${criterionFor(cat)}</p>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px 14px">
        ${group.map((c, i) => card(c, i, cat, group, style)).join('')}
      </div>
    </div>`;
  };

  const emptyState = `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 14px 34px rgba(15,23,42,.055);height:360px;display:flex;align-items:center;justify-content:center;color:#94A3B8;font-family:${INTER};font-size:16px;font-weight:800">Sem criativos pagos disponíveis neste período</div>`;
  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:-120px;top:-170px;width:640px;height:540px;border-radius:50%;background:linear-gradient(135deg,rgba(241,245,249,.74),rgba(255,255,255,.12));opacity:.78;pointer-events:none"></div>
  <div style="position:relative;z-index:1;flex:1;padding:26px 40px 24px;box-sizing:border-box;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:18px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:950;color:#050816;line-height:.95;margin:0 0 14px;letter-spacing:-0.055em">${reportTitle('Principais Criativos Meta Ads')}</h1>
      <p style="font-size:17px;font-weight:500;color:#6B7280;font-family:${INTER};margin:0;letter-spacing:-0.015em">Melhores criativos Meta Ads por objetivo — cada campanha avaliada pela métrica certa para o seu tipo</p>
      <div style="width:38px;height:3px;border-radius:999px;background:${PRIMARY};margin-top:13px"></div>
    </div>
    <div style="flex:1">
      ${groups.size ? [...groups.entries()].map(section).join('') : emptyState}
    </div>
    <div data-conclusion="1" style="height:34px;margin-top:auto;display:flex;align-items:center;gap:12px">
      <div style="width:26px;height:26px;border-radius:50%;border:2px solid ${PRIMARY_TEXT};display:flex;align-items:center;justify-content:center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${PRIMARY_TEXT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICO_OBJ}</svg>
      </div>
      <div style="width:1px;height:22px;background:#D7DEE8"></div>
      <p style="font-family:${INTER};font-size:13px;font-weight:700;color:#6B7280;margin:0">Cada objetivo é ranqueado pela métrica que realmente importa para ele — não por volume genérico.</p>
    </div>
  </div>
</div>`;

  return auditSlide(body, 'sCriativos');
}

// ── Expanded slides ───────────────────────────────────────────────────────────

export function sMetaAdsCampanhas(meta: MetaAdsFull, diag: DiagJson, idx: number, total: number, periodo = 'Maio/2026', campanhas = meta.campanhas): string {
  const campaignKind = campaignKindFor;

  const isDemand = (c: CampanhaDetalhada) => ['mensagens', 'leads'].includes(campaignKind(c));
  const isSales = (c: CampanhaDetalhada) => campaignKind(c) === 'vendas';

  const descriptionFor = (c: CampanhaDetalhada): string => {
    if (isDemand(c)) return 'Campanha de geração de demanda com foco em leads e conversas.';
    if (isSales(c)) return 'Campanha de conversão com foco em vendas e retorno sobre investimento.';
    if (campaignKind(c) === 'trafego') return 'Campanha de tráfego com foco em cliques no link e visitas ao destino.';
    return 'Campanha de topo de funil com foco em alcance e reconhecimento da marca.';
  };

  const styleFor = (c: CampanhaDetalhada) => {
    const kind = campaignKind(c);
    if (kind === 'vendas') return { bg: '#F7FFF4', border: '#D7F8D0', accent: PRIMARY_TEXT, iconBg: '#ECFCE8' };
    if (kind === 'trafego') return { bg: '#F6FAFF', border: '#BFDBFE', accent: '#2563EB', iconBg: '#EAF3FF' };
    if (kind === 'alcance') return { bg: '#FFFDF5', border: '#FDE68A', accent: '#B45309', iconBg: '#FFF7E6' };
    if (kind === 'mensagens' || kind === 'leads') return { bg: '#F4FFFB', border: '#99F6E4', accent: '#0F766E', iconBg: '#E6FFFB' };
    return { bg: '#FAF7FF', border: '#DDD6FE', accent: '#7C3AED', iconBg: '#F5F0FF' };
  };

  // ── Icons — premium green treatment, shape conveys campaign type ───────────
  const ICO_WA      = '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>';
  const ICO_DOC     = '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>';
  const ICO_ACT     = '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>';
  const ICO_MONEY   = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_CHAT    = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
  const ICO_CURSOR  = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_EYE     = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_BARS    = '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-8"/><path d="M22 19H2"/>';
  const ICO_CART    = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_RECEIPT = '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>';
  const ICO_TARGET  = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7"/><path d="M16 5h3v3"/>';

  const metricItem = (iconPath: string, label: string, value: string, accent = PRIMARY_TEXT, bg = `${PRIMARY}18`) =>
    `<div style="flex:1;display:flex;align-items:flex-start;gap:10px;min-width:0">
      <div style="width:34px;height:34px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:12px;font-weight:600;color:${FG};font-family:${INTER};margin:0 0 3px;line-height:1.25">${label}</p>
        <p style="font-size:19px;font-weight:800;color:${value === '—' ? MUTED : accent};font-family:${INTER};margin:0;line-height:1.1;letter-spacing:-0.01em">${value}</p>
      </div>
    </div>`;

  function campBlock(c: CampanhaDetalhada): string {
    const m = c.metricas;
    const kind = campaignKind(c);
    const campIsWA = kind === 'mensagens' || kind === 'leads';
    const campIsSales = kind === 'vendas';
    const style = styleFor(c);
    const icoPath = campIsWA ? ICO_WA : campIsSales ? ICO_DOC : kind === 'trafego' ? ICO_CURSOR : ICO_ACT;
    const name = cleanCampaignHighlightTitle(c.nome);

    let row1: string, row2: string;
    if (campIsWA) {
      // This campaign's own kind (mensagens vs leads) picks the headline metric — a
      // campaign isn't both at once, so showing leads+conversas added together under
      // a single "Leads" headline (the old behavior) was redundant at best, and
      // actively misleading for WhatsApp-only accounts that never used a lead form.
      const isLeadsCampaign = kind === 'leads';
      const primary      = isLeadsCampaign ? m.leads : m.conversas;
      const primaryLabel = isLeadsCampaign ? 'Leads' : 'Conversas iniciadas';
      const custoLabel   = isLeadsCampaign ? 'Custo por lead' : 'Custo/conversa';
      const custoPrimario = primary > 0 && m.investimento > 0 ? brlPrecise(m.investimento / primary) : '—';
      // Only a genuine "leads" campaign gets a secondary metric here (its bonus
      // conversas, if any). A "mensagens" campaign's m.leads is not shown at all —
      // for WhatsApp-only accounts that figure doesn't represent a real lead form,
      // it's Meta tagging the same conversation under a second action_type.
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_CHAT, primaryLabel, primary > 0 ? num(Math.round(primary)) : '—', style.accent, style.iconBg),
        metricItem(ICO_MONEY, custoLabel, custoPrimario, style.accent, style.iconBg),
      ].join('');
      row2 = [
        ...(isLeadsCampaign && m.conversas > 0 ? [metricItem(ICO_TARGET, 'Conversas iniciadas', num(Math.round(m.conversas)), style.accent, style.iconBg)] : []),
        metricItem(ICO_BARS, 'Frequência', m.frequencia > 0 ? m.frequencia.toFixed(2) : '—', style.accent, style.iconBg),
        // Bonus/derived sale — this campaign's objective is Leads/Mensagens, not
        // Vendas, so no "custo por compra" or ROAS here (that cost belongs to the
        // objective the campaign was actually optimized for). Just the raw count
        // and revenue, as a side note.
        ...(m.compras > 0 ? [
          metricItem(ICO_CART, 'Compras registradas', num(Math.round(m.compras)), style.accent, style.iconBg),
          metricItem(ICO_RECEIPT, 'Valor de venda', m.valor_compras > 0 ? brl(m.valor_compras) : '—', style.accent, style.iconBg),
        ] : []),
      ].join('');
    } else if (campIsSales) {
      const cpp = m.compras > 0 && m.investimento > 0 ? brlPrecise(m.investimento / m.compras) : '—';
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_CART, 'Compras registradas', m.compras > 0 ? num(Math.round(m.compras)) : '—', style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'Custo por compra', cpp, style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_RECEIPT, 'Valor de venda', m.valor_compras > 0 ? brl(m.valor_compras) : '—', style.accent, style.iconBg),
        metricItem(ICO_TREND, 'ROAS', m.purchase_roas > 0 ? m.purchase_roas.toFixed(2) : '—', style.accent, style.iconBg),
      ].join('');
    } else if (kind === 'trafego') {
      const cpc = m.cliques > 0 && m.investimento > 0 ? m.investimento / m.cliques : 0;
      const ctr = m.impressoes > 0 && m.cliques > 0 ? (m.cliques / m.impressoes) * 100 : 0;
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_CURSOR, 'Cliques no link', numOrDash(m.cliques), style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'CPC', brlPreciseOrDash(cpc), style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_REACH, 'Pessoas atingidas', numOrDash(m.alcance), style.accent, style.iconBg),
        metricItem(ICO_EYE, 'Impressões', numOrDash(m.impressoes), style.accent, style.iconBg),
        metricItem(ICO_TREND, 'CTR', ctr > 0 ? `${ctr.toFixed(2).replace('.', ',')}%` : '—', style.accent, style.iconBg),
      ].join('');
    } else {
      const cpm = m.impressoes > 0 && m.investimento > 0 ? m.investimento / (m.impressoes / 1000) : 0;
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_REACH, 'Pessoas atingidas', numOrDash(m.alcance), style.accent, style.iconBg),
        metricItem(ICO_EYE, 'Impressões', numOrDash(m.impressoes), style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_MONEY, 'CPM', brlPreciseOrDash(cpm), style.accent, style.iconBg),
        metricItem(ICO_BARS, 'Frequência', m.frequencia > 0 ? m.frequencia.toFixed(2) : '—', style.accent, style.iconBg),
        metricItem(ICO_CURSOR, 'Cliques', numOrDash(m.cliques), style.accent, style.iconBg),
      ].join('');
    }

    return `<div style="background:${style.bg};border:1px solid ${style.border};border-left:5px solid ${style.accent};border-radius:18px;box-shadow:0 12px 28px rgba(15,23,42,.052);padding:20px 22px;box-sizing:border-box;display:flex;flex-direction:column;min-height:200px">
      <div style="display:flex;align-items:flex-start;gap:16px;padding-bottom:20px">
        <div style="width:52px;height:52px;border-radius:50%;background:${style.iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${style.accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icoPath}</svg>
        </div>
        <div style="min-width:0">
          <p style="font-size:19px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px;line-height:1.25">${name}</p>
          <p style="font-size:13px;font-weight:500;color:#163461;font-family:${INTER};margin:0;line-height:1.45;max-width:320px">${descriptionFor(c)}</p>
        </div>
      </div>

      <div style="border-top:1px solid #EEF2F7"></div>

      <div style="padding:20px 0 4px;display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;gap:12px">${row1}</div>
        <div style="display:flex;gap:12px">${row2}</div>
      </div>
    </div>`;
  }

  const month = periodo.split('/')[0]?.toLowerCase() || periodo.toLowerCase();
  const campGrid = campanhas.length > 0
    ? `<div style="display:grid;grid-template-columns:${campanhas.length === 1 ? '1fr' : '1fr 1fr'};gap:18px 22px">${campanhas.map(campBlock).join('')}</div>`
    : '';

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:80px;top:-120px;width:560px;height:500px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.5),${PRIMARY}14,rgba(255,255,255,.1));opacity:.75;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:52px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:28px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">${reportTitle(meta.nivel === 'adset' ? 'Conjuntos de Anúncios Veiculados Meta Ads' : 'Campanhas Veiculadas Meta Ads')}</h1>
      <p data-conclusion="1" style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Desempenho ${meta.nivel === 'adset' ? 'dos conjuntos de anúncios Meta Ads' : 'das campanhas Meta Ads'} em ${month}</p>
    </div>

    <div style="flex:1;min-height:0">
      ${campGrid}
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sMetaAdsCampanhas');
}

// ── Google Ads — Resumo ───────────────────────────────────────────────────────

export function sGoogleAdsResumo(google: GoogleAdsFull, idx: number, total: number): string {
  void idx;
  void total;
  const ctr = google.impressoes > 0 ? (google.cliques / google.impressoes) * 100 : 0;
  const cpc = google.cliques > 0 ? google.investimento / google.cliques : 0;
  const custoConversao = google.conversoes > 0 ? google.investimento / google.conversoes : 0;
  const roasGeral = google.investimento > 0 ? google.valorConversoes / google.investimento : 0;

  const campaignsBy = (kinds: GoogleCampaignKind[]) => google.campanhas.filter(c => kinds.includes(categorizeGoogleCampaign(c.tipo, c.metricas.conversoes, c.metricas.valorConversoes)));
  const sum = (campaigns: CampanhaGoogleDetalhada[], selector: (c: CampanhaGoogleDetalhada) => number) =>
    campaigns.reduce((totalValue, campaign) => totalValue + selector(campaign), 0);

  const awarenessCampaigns = campaignsBy(['alcance']);
  const trafficCampaigns = campaignsBy(['trafego']);
  const leadCampaigns = campaignsBy(['leads']);
  const salesCampaigns = campaignsBy(['vendas']);

  const awarenessInvestment = sum(awarenessCampaigns, c => c.metricas.investimento);
  const awarenessImpressions = sum(awarenessCampaigns, c => c.metricas.impressoes);
  const awarenessCliques = sum(awarenessCampaigns, c => c.metricas.cliques);
  const awarenessCpm = awarenessImpressions > 0 ? awarenessInvestment / (awarenessImpressions / 1000) : 0;

  const trafficInvestment = sum(trafficCampaigns, c => c.metricas.investimento);
  const trafficClicks = sum(trafficCampaigns, c => c.metricas.cliques);
  const trafficImpressions = sum(trafficCampaigns, c => c.metricas.impressoes);
  const trafficCpc = trafficClicks > 0 ? trafficInvestment / trafficClicks : 0;
  const trafficCtr = trafficImpressions > 0 ? (trafficClicks / trafficImpressions) * 100 : 0;

  const leadInvestment = sum(leadCampaigns, c => c.metricas.investimento);
  const totalLeadConversoes = sum(leadCampaigns, c => c.metricas.conversoes);
  const custoLead = totalLeadConversoes > 0 ? leadInvestment / totalLeadConversoes : 0;

  const salesInvestment = sum(salesCampaigns, c => c.metricas.investimento);
  const totalCompras = sum(salesCampaigns, c => c.metricas.conversoes);
  const valorCompras = sum(salesCampaigns, c => c.metricas.valorConversoes);
  const cpa = totalCompras > 0 ? salesInvestment / totalCompras : 0;
  const roas = salesInvestment > 0 ? valorCompras / salesInvestment : 0;

  const brlC = (n: number) => n > 0 ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
  const pctC = (n: number) => n > 0 ? `${n.toFixed(2).replace('.', ',')}%` : '—';
  const decC = (n: number) => n > 0 ? n.toFixed(2).replace('.', ',') : '—';
  const countLabel = (count: number) => count === 1 ? '1 campanha' : `${count} campanhas`;

  const bigKpi = (label: string, value: string, ico: string) =>
    `<div style="background:${CARD};border:1px solid #E7ECF3;border-radius:16px;box-shadow:0 10px 26px rgba(15,23,42,.06);padding:14px 16px;display:flex;align-items:center;gap:12px;min-width:0">
      <div style="width:44px;height:44px;border-radius:50%;background:${GOOGLE_BLUE}1F;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${GOOGLE_BLUE}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ico}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:12px;font-weight:700;color:#163461;font-family:${INTER};margin:0 0 5px;line-height:1.2">${label}</p>
        <p style="font-family:${INTER};font-size:22px;font-weight:900;letter-spacing:0;color:${FG};line-height:1;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${value}</p>
      </div>
    </div>`;

  const ICO_MONEY  = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_EYE    = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_CURSOR = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_CART   = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_TARGET = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
  const ICO_PERCENT = '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>';

  const generalMetrics = [
    bigKpi('Investimento', brlC(google.investimento), ICO_MONEY),
    bigKpi('Impressões', numOrDash(google.impressoes), ICO_EYE),
    bigKpi('Cliques', numOrDash(google.cliques), ICO_CURSOR),
    bigKpi('CTR', pctC(ctr), ICO_PERCENT),
    bigKpi('CPC', brlC(cpc), ICO_CURSOR),
    bigKpi('Conversões', numOrDash(google.conversoes), ICO_TARGET),
    bigKpi('Custo/conversão', brlC(custoConversao), ICO_MONEY),
  ];

  const segmentLine = (label: string, value: string) =>
    `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-top:1px solid rgba(148,163,184,.18);padding-top:8px">
      <span style="font-family:${INTER};font-size:11px;font-weight:700;color:${MUTED};line-height:1.15">${label}</span>
      <span style="font-family:${INTER};font-size:16px;font-weight:900;color:${FG};line-height:1;text-align:right;white-space:nowrap">${value}</span>
    </div>`;

  const segmentCard = (
    title: string, subtitle: string, icon: string, tint: string, accent: string, lines: Array<[string, string]>,
  ) =>
    `<div style="background:${tint};border:1px solid ${accent}33;border-radius:18px;box-shadow:0 10px 24px rgba(15,23,42,.05);padding:18px;min-width:0;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;gap:12px;align-items:flex-start;min-height:52px">
        <div style="width:42px;height:42px;border-radius:50%;background:#FFFFFFB8;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
        </div>
        <div style="min-width:0">
          <p style="font-family:${INTER};font-size:15px;font-weight:900;color:${FG};margin:0 0 4px;line-height:1.1">${title}</p>
          <p style="font-family:${INTER};font-size:11px;font-weight:700;color:#475569;margin:0;line-height:1.3">${subtitle}</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${lines.map(([label, value]) => segmentLine(label, value)).join('')}
      </div>
    </div>`;

  const hasSegmentData = (campaigns: CampanhaGoogleDetalhada[], values: number[]) =>
    campaigns.length > 0 || values.some(value => value > 0);

  const segmentCards = [
    hasSegmentData(awarenessCampaigns, [awarenessInvestment, awarenessImpressions, awarenessCliques]) ? segmentCard('Display e vídeo', countLabel(awarenessCampaigns.length), ICO_TARGET, '#FFFDF2', '#B45309', [
      ['Investimento', brlC(awarenessInvestment)],
      ['Impressões', numOrDash(awarenessImpressions)],
      ['CPM', brlC(awarenessCpm)],
    ]) : '',
    hasSegmentData(trafficCampaigns, [trafficInvestment, trafficClicks, trafficImpressions]) ? segmentCard('Pesquisa / tráfego', countLabel(trafficCampaigns.length), ICO_CURSOR, '#F4F8FF', GOOGLE_BLUE, [
      ['Investimento', brlC(trafficInvestment)],
      ['Cliques', numOrDash(trafficClicks)],
      ['CPC / CTR', `${brlC(trafficCpc)} / ${pctC(trafficCtr)}`],
    ]) : '',
    hasSegmentData(leadCampaigns, [leadInvestment, totalLeadConversoes]) ? segmentCard('Geração de leads', countLabel(leadCampaigns.length), ICO_TARGET, '#F2FFFB', '#0F766E', [
      ['Investimento', brlC(leadInvestment)],
      ['Conversões', numOrDash(totalLeadConversoes)],
      ['Custo por lead', brlC(custoLead)],
    ]) : '',
    hasSegmentData(salesCampaigns, [salesInvestment, totalCompras, valorCompras]) ? segmentCard('Vendas / Shopping', countLabel(salesCampaigns.length), ICO_CART, '#F7FFF4', PRIMARY_TEXT, [
      ['Investimento', brlC(salesInvestment)],
      ['Compras / CPA', `${numOrDash(totalCompras)} / ${brlC(cpa)}`],
      ['Valor de venda', brlC(valorCompras)],
      ['ROAS', decC(roas)],
    ]) : '',
  ].filter(Boolean);
  const segmentGridColumns = Math.max(1, Math.min(segmentCards.length, 4));

  const recommendation = roas >= 3
    ? `As campanhas de Shopping/vendas apresentaram retorno positivo, com ROAS de ${decC(roas)}. Acompanhar escala mantendo controle de CPC e custo por conversão.`
    : totalCompras > 0
    ? `As campanhas de vendas geraram conversões, mas o ROAS de ${decC(roas)} pede atenção: acompanhar custo por conversão e valor médio antes de ampliar investimento.`
    : totalLeadConversoes > 0
    ? `As campanhas de geração de leads converteram no período. O próximo foco é qualificar esses contatos, acompanhando custo por lead e evolução para venda.`
    : `${brlOrDash(google.investimento)} investidos com ${numOrDash(google.cliques)} cliques e ${numOrDash(google.conversoes)} conversões no período. Avaliar CTR, CPC e volume de conversões (ROAS geral ${decC(roasGeral)}) para orientar o próximo ciclo.`;

  const body = `<div style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:60px;top:-100px;width:560px;height:480px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.55),rgba(255,255,255,.15));opacity:.7;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:52px 48px 0;display:flex;flex-direction:column;gap:16px">

    <div style="flex-shrink:0">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">${reportTitle('Resumo Google Ads')}</h1>
      <p style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Métricas gerais e resultados separados por tipo de campanha</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;flex-shrink:0">
      ${generalMetrics.join('')}
    </div>

    <div style="display:grid;grid-template-columns:repeat(${segmentGridColumns},1fr);gap:14px;flex-shrink:0">
      ${segmentCards.join('')}
    </div>

    <div data-conclusion="1" style="background:${CARD};border:1px solid #E7ECF3;border-radius:18px;box-shadow:0 10px 26px rgba(15,23,42,.06);display:flex;align-items:flex-start;gap:16px;padding:20px 26px">
      <div style="width:40px;height:40px;border-radius:50%;background:${GOOGLE_BLUE}16;display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${GOOGLE_BLUE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICO_TARGET}</svg>
      </div>
      <div style="border-left:2px solid ${GOOGLE_BLUE};padding-left:18px">
        <p style="font-size:15px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px">Recomendação</p>
        <p style="font-size:14px;font-weight:500;color:#163461;font-family:${INTER};line-height:1.5;margin:0">${recommendation}</p>
      </div>
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sGoogleAdsResumo');
}

// ── Google Ads — Campanhas ────────────────────────────────────────────────────

export function sGoogleAdsCampanhas(google: GoogleAdsFull, idx: number, total: number, periodo = 'Maio/2026', campanhas = google.campanhas): string {
  const kindFor = (c: CampanhaGoogleDetalhada) => categorizeGoogleCampaign(c.tipo, c.metricas.conversoes, c.metricas.valorConversoes);

  const styleFor = (kind: GoogleCampaignKind) => {
    if (kind === 'vendas') return { bg: '#F7FFF4', border: '#D7F8D0', accent: PRIMARY_TEXT, iconBg: '#ECFCE8' };
    if (kind === 'trafego') return { bg: '#F6FAFF', border: '#BFDBFE', accent: GOOGLE_BLUE, iconBg: '#EAF3FF' };
    if (kind === 'leads') return { bg: '#F4FFFB', border: '#99F6E4', accent: '#0F766E', iconBg: '#E6FFFB' };
    return { bg: '#FFFDF5', border: '#FDE68A', accent: '#B45309', iconBg: '#FFF7E6' };
  };

  const ICO_MONEY   = '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
  const ICO_CURSOR  = '<path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="m13 13 6 6"/>';
  const ICO_EYE     = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  const ICO_CART    = '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>';
  const ICO_TARGET  = '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12l7-7"/><path d="M16 5h3v3"/>';
  const ICO_TREND   = '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>';
  const ICO_GOOGLE  = '<path d="M21.8 12.2c0-.7-.06-1.3-.18-1.9H12v3.6h5.5c-.24 1.3-.97 2.4-2.06 3.1v2.6h3.3c1.9-1.8 3.06-4.4 3.06-7.4Z"/><path d="M12 22c2.4 0 4.4-.8 5.84-2.16l-3.3-2.6c-.9.6-2.06 1-3.0.96-2.3 0-4.26-1.5-4.96-3.6H2.18v2.66C3.6 19.9 7.5 22 12 22Z"/><path d="M7.04 13.6a5.4 5.4 0 0 1 0-3.4V7.54H2.18a9.96 9.96 0 0 0 0 9.1l4.86-3.04Z"/><path d="M12 6.4c1.3 0 2.5.46 3.4 1.34l2.9-2.86C16.4 3.3 14.4 2.5 12 2.5 7.5 2.5 3.6 4.6 2.18 7.54L7.04 10.6c.7-2.1 2.66-3.6 4.96-4.2Z"/>';

  const metricItem = (iconPath: string, label: string, value: string, accent = GOOGLE_BLUE, bg = `${GOOGLE_BLUE}18`) =>
    `<div style="flex:1;display:flex;align-items:flex-start;gap:10px;min-width:0">
      <div style="width:34px;height:34px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
      </div>
      <div style="min-width:0">
        <p style="font-size:12px;font-weight:600;color:${FG};font-family:${INTER};margin:0 0 3px;line-height:1.25">${label}</p>
        <p style="font-size:19px;font-weight:800;color:${value === '—' ? MUTED : accent};font-family:${INTER};margin:0;line-height:1.1;letter-spacing:-0.01em">${value}</p>
      </div>
    </div>`;

  function campBlock(c: CampanhaGoogleDetalhada): string {
    const m = c.metricas;
    const kind = kindFor(c);
    const style = styleFor(kind);
    const name = c.nome;
    const channelLabel = GOOGLE_CHANNEL_LABEL[(c.tipo || '').toUpperCase()] ?? 'Campanha';

    let row1: string, row2: string;
    if (kind === 'vendas') {
      const cpa = m.conversoes > 0 && m.investimento > 0 ? brlPrecise(m.investimento / m.conversoes) : '—';
      const roas = m.investimento > 0 && m.valorConversoes > 0 ? m.valorConversoes / m.investimento : 0;
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_CART, 'Conversões', numOrDash(m.conversoes), style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'Custo/conversão', cpa, style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_MONEY, 'Valor de conversão', brlOrDash(m.valorConversoes), style.accent, style.iconBg),
        metricItem(ICO_TREND, 'ROAS', roas > 0 ? roas.toFixed(2) : '—', style.accent, style.iconBg),
      ].join('');
    } else if (kind === 'leads') {
      const custoLead = m.conversoes > 0 && m.investimento > 0 ? brlPrecise(m.investimento / m.conversoes) : '—';
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_TARGET, 'Conversões', numOrDash(m.conversoes), style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'Custo por lead', custoLead, style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_CURSOR, 'Cliques', numOrDash(m.cliques), style.accent, style.iconBg),
        metricItem(ICO_EYE, 'Impressões', numOrDash(m.impressoes), style.accent, style.iconBg),
      ].join('');
    } else if (kind === 'trafego') {
      const cpc = m.cliques > 0 && m.investimento > 0 ? m.investimento / m.cliques : 0;
      const ctr = m.impressoes > 0 && m.cliques > 0 ? (m.cliques / m.impressoes) * 100 : 0;
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_CURSOR, 'Cliques', numOrDash(m.cliques), style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'CPC', brlPreciseOrDash(cpc), style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_EYE, 'Impressões', numOrDash(m.impressoes), style.accent, style.iconBg),
        metricItem(ICO_TREND, 'CTR', ctr > 0 ? `${ctr.toFixed(2).replace('.', ',')}%` : '—', style.accent, style.iconBg),
      ].join('');
    } else {
      const cpm = m.impressoes > 0 && m.investimento > 0 ? m.investimento / (m.impressoes / 1000) : 0;
      row1 = [
        metricItem(ICO_MONEY, 'Investimento', brlOrDash(m.investimento), style.accent, style.iconBg),
        metricItem(ICO_EYE, 'Impressões', numOrDash(m.impressoes), style.accent, style.iconBg),
        metricItem(ICO_MONEY, 'CPM', brlPreciseOrDash(cpm), style.accent, style.iconBg),
      ].join('');
      row2 = [
        metricItem(ICO_CURSOR, 'Cliques', numOrDash(m.cliques), style.accent, style.iconBg),
      ].join('');
    }

    return `<div style="background:${style.bg};border:1px solid ${style.border};border-left:5px solid ${style.accent};border-radius:18px;box-shadow:0 12px 28px rgba(15,23,42,.052);padding:20px 22px;box-sizing:border-box;display:flex;flex-direction:column;min-height:200px">
      <div style="display:flex;align-items:flex-start;gap:16px;padding-bottom:20px">
        <div style="width:52px;height:52px;border-radius:50%;background:${style.iconBg};display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${style.accent}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICO_GOOGLE}</svg>
        </div>
        <div style="min-width:0">
          <p style="font-size:19px;font-weight:800;color:${FG};font-family:${INTER};margin:0 0 4px;line-height:1.25">${name}</p>
          <p style="font-size:13px;font-weight:500;color:#163461;font-family:${INTER};margin:0;line-height:1.45;max-width:320px">Campanha de ${channelLabel.toLowerCase()}.</p>
        </div>
      </div>

      <div style="border-top:1px solid #EEF2F7"></div>

      <div style="padding:20px 0 4px;display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;gap:12px">${row1}</div>
        <div style="display:flex;gap:12px">${row2}</div>
      </div>
    </div>`;
  }

  const month = periodo.split('/')[0]?.toLowerCase() || periodo.toLowerCase();
  const campGrid = campanhas.length > 0
    ? `<div style="display:grid;grid-template-columns:${campanhas.length === 1 ? '1fr' : '1fr 1fr'};gap:18px 22px">${campanhas.map(campBlock).join('')}</div>`
    : '';

  const body = `<div data-slide-index="${idx}" data-slide-total="${total}" style="width:1440px;min-height:810px;background:${BG};border:1px solid ${BORDER};margin:0 auto 20px;overflow:hidden;box-sizing:border-box;page-break-after:always;display:flex;flex-direction:column;position:relative">
  <div style="position:absolute;right:80px;top:-120px;width:560px;height:500px;border-radius:50%;background:linear-gradient(135deg,rgba(219,234,254,.5),${GOOGLE_BLUE}14,rgba(255,255,255,.1));opacity:.75;pointer-events:none"></div>

  <div style="position:relative;z-index:1;flex:1;padding:52px 48px 0;display:flex;flex-direction:column">
    <div style="flex-shrink:0;margin-bottom:28px">
      <h1 style="font-family:${INTER};font-size:52px;font-weight:900;color:${FG};line-height:1.05;margin:0 0 8px;letter-spacing:-0.03em">${reportTitle('Campanhas Google Ads')}</h1>
      <p data-conclusion="1" style="font-size:16px;font-weight:500;color:#163461;font-family:${INTER};margin:0">Desempenho das campanhas em ${month}</p>
    </div>

    <div style="flex:1;min-height:0">
      ${campGrid}
    </div>
  </div>

  ${richFooter()}
</div>`;
  return auditSlide(body, 'sGoogleAdsCampanhas');
}

// ── Diagnosis (Claude — expanded JSON) ────────────────────────────────────────

async function fetchDiagnosis(
  d: ParsedData, prevD: ParsedData | null, meta: MetaAdsFull | null,
  bairros: Bairro[], clientName: string, periodo: string, agencyContext: string,
): Promise<DiagJson> {
  if (process.env.SKIP_AI === 'true') {
    return {
      insight_campanha_conversa:  '',
      insight_campanha_conversao: '',
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
  "insight_campanha_conversa": "análise das campanhas de conversa — 1-2 frases ou string vazia",
  "insight_campanha_conversao": "análise das campanhas de conversão — 1-2 frases ou string vazia"
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
      insight_campanha_conversa:  parsed.insight_campanha_conversa  ?? '',
      insight_campanha_conversao: parsed.insight_campanha_conversao ?? '',
    };
  } catch {
    return {
      insight_campanha_conversa: '', insight_campanha_conversao: '',
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
  coverId?:       string | null;
  metaLevel?:     MetaBreakdownLevel;
}): Promise<{ html: string; avisos?: string[] }> {
  const { clientId, clientName, from, to, csvFiles = [], agencyContext = '', connectionId, accountIds = [], coverId, metaLevel = 'campaign' } = opts;

  const fromDate = new Date(from + 'T12:00:00');
  const toDate   = new Date(to   + 'T12:00:00');
  const MONTHS   = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const periodo  = `${MONTHS[fromDate.getMonth()]}/${fromDate.getFullYear()}`;
  const instagramPeriodLabel = fromDate.getMonth() === toDate.getMonth() && fromDate.getFullYear() === toDate.getFullYear()
    ? periodo
    : `${periodo} a ${MONTHS[toDate.getMonth()]}/${toDate.getFullYear()}`;

  const { current: currentFiles, previous: prevFiles } = separateFiles(csvFiles);
  const hasPrev = prevFiles.length > 0;

  const [{ data, avisos }, prevResult] = await Promise.all([
    parseAllFilesAdaptive(currentFiles, toDate),
    hasPrev ? parseAllFilesAdaptive(prevFiles, fromDate) : Promise.resolve(null),
  ]);
  const prevData = prevResult?.data ?? null;
  if (prevResult?.avisos.length) avisos.push(...prevResult.avisos.map(a => `Período anterior — ${a}`));

  const prevPeriodo = hasPrev
    ? (() => {
        const pm = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
        return `${MONTHS[pm.getMonth()]}/${pm.getFullYear()}`;
      })()
    : '';

  const [bairros, { meta, creatives }, instagramFull, rotationSeed] = await Promise.all([
    fetchBairros(clientId, from, to),
    fetchMetaData(connectionId, accountIds, from, to, metaLevel),
    fetchInstagramData(clientId, connectionId, accountIds, from, to),
    fetchReportRotationSeed(),
  ]);
  const instagram = instagramFull?.insights ?? null;
  const igPosts    = instagramFull?.posts ?? [];
  const instagramCalendarMonths = monthsBetweenInclusive(fromDate, toDate);
  const cover = resolveReportCover(coverId, rotationSeed);

  console.log(`[delivery] ${clientName} | fat:${brlOrDash(data.faturamento)} ativos:${data.ativos} prod:${data.produtos.length} bairros:${bairros.length} meta:${meta ? 'sim' : 'não'} ig:${instagram ? `@${instagram.username}` : 'não'} igPosts:${igPosts.length} criativos:${creatives.length} prev:${hasPrev}`);

  const diag = await fetchDiagnosis(data, prevData, meta, bairros, clientName, periodo, agencyContext);

  const hasVisao             = data.faturamento > 0 || data.pedidos_ativos > 0;
  const hasDia               = data.por_dia.length > 0;
  const hasBase              = data.ativos > 0 || data.inativos > 0 || data.potenciais > 0;
  const hasInat              = data.inativos_faixas.length > 0;
  const hasRegiao            = bairros.length > 0;
  const hasMeta              = meta !== null;
  const hasInstagram         = instagram !== null;
  const hasInstagramPosts    = igPosts.length > 0;
  const hasInstagramSpotlight = hasInstagramPosts;
  const hasDestaques         = hasMeta && meta!.campanhas.length > 0;
  const hasCriativos         = creatives.length > 0;
  const destaquePages        = hasDestaques ? Math.ceil(meta!.campanhas.length / 4) : 0;

  const total = 1
    + (hasVisao      ? 1 : 0)
    + (hasDia        ? 1 : 0)
    + (hasRegiao     ? 1 : 0)
    + (hasBase       ? 1 : 0)
    + (hasInat       ? 1 : 0)
    + (hasMeta       ? 1 : 0)
    + (hasInstagram  ? 1 : 0)
    + (hasInstagramPosts ? instagramCalendarMonths.length : 0)
    + (hasInstagramPosts ? 1 : 0)
    + (hasInstagramSpotlight ? 1 : 0)
    + destaquePages
    + (hasCriativos   ? 1 : 0);

  const slides: string[] = [];
  let i = 1;

  // Slides are grouped into topic blocks — base de clientes/produtos, depois tráfego
  // pago (resumo + campanhas + criativos) inteiro, depois Instagram inteiro — em vez de
  // intercalar assuntos. Cada bloco fica de uma vez só, sem voltar a um assunto anterior.
  slides.push(sCapa(data, meta, clientName, periodo, prevPeriodo, diag, total, cover));

  // ── Bloco: base de clientes / produtos ────────────────────────────────────
  if (hasVisao)       slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo));
  if (hasDia)         slides.push(sPorDia(data, ++i, total, periodo));
  if (hasRegiao)      slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)        slides.push(sBase(data, ++i, total));
  if (hasInat)        slides.push(sInativos(data, ++i, total));

  // ── Bloco: tráfego pago (Meta Ads) ─────────────────────────────────────────
  if (hasMeta)        slides.push(sMetaAdsResumo(meta!, ++i, total));
  if (hasDestaques) {
    for (let start = 0; start < meta!.campanhas.length; start += 4) {
      slides.push(sMetaAdsCampanhas(meta!, diag, ++i, total, periodo, meta!.campanhas.slice(start, start + 4)));
    }
  }
  if (hasCriativos)   slides.push(sCriativos(creatives, ++i, total));

  // ── Bloco: Instagram ───────────────────────────────────────────────────────
  if (hasInstagram)   slides.push(sInstagram(instagram!, ++i, total, instagramPeriodLabel));
  if (hasInstagramPosts) {
    for (const monthDate of instagramCalendarMonths) {
      slides.push(sInstagramCalendar(igPosts, ++i, total, monthDate));
    }
  }
  if (hasInstagramPosts)     slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));

  return {
    html: `${FONT_LINK}<div class="onmid-report" style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>`,
    avisos: avisos.length ? avisos : undefined,
  };
}

// ── Save to DB ─────────────────────────────────────────────────────────────────

export async function saveDeliveryReport(opts: {
  clientId:    string;
  clientName:  string;
  from:        string;
  to:          string;
  data:        { html: string };
  generatedBy?: string;
  configId?:   string;
}): Promise<{ token: string; reportId: string }> {
  const { clientId, clientName, from, to, data, generatedBy = 'manual', configId } = opts;
  const token = randomUUID();
  const pool  = makeServerPool();
  try {
    const safeData = sanitizeJsonValue(data);
    const { rows } = await pool.query(
      `INSERT INTO public.diagnostic_reports (client_id,client_name,period_from,period_to,template_slug,report_data,public_token,generated_by,config_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [clientId, clientName, from, to, 'onmid-narrative-delivery', safeData, token, generatedBy, configId ?? null],
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
  const mk = (
    investimento: number, conversas: number, compras: number, valor_compras: number,
    cliques: number, frequencia: number, visitas_pagina = 0, iniciaram_checkout = 0, leads = 0,
  ) => ({
    investimento, impressoes: 0, alcance: 0, cliques, frequencia, leads, conversas, compras, valor_compras,
    purchase_roas: compras > 0 ? valor_compras / investimento : 0,
    visitas_pagina, iniciaram_checkout,
  });
  const meta: MetaAdsFull = {
    investimento: 2826.62, impressoes: 583994, alcance: 240617, cliques: 1858,
    campanhas: [
      { nome: '[ON] [RECONHECIMENTO] [MAIO]', tipo: 'reconhecimento', metricas: mk(400, 0, 0, 0, 200, 2, 150, 0) },
      { nome: '[ON] [WHATS] [ANIVERSÁRIO] [MAIO]', tipo: 'conversas', metricas: mk(1730.85, 332, 0, 0, 1276, 5.38, 980, 0) },
      { nome: '[ON] [VENDAS] [IFOOD] [GUANABARA]', tipo: 'vendas', metricas: mk(300, 0, 8, 400, 150, 1.5, 120, 18) },
      { nome: '[ON] [VENDAS] [ANOTA AÍ] [LOW-BUDGET]', tipo: 'vendas', metricas: mk(235.90, 0, 27, 1860.27, 180, 1.8, 140, 41) },
      { nome: '[ON] [ALCANCE] [BURRITO FIT]', tipo: 'alcance', metricas: mk(60, 0, 0, 0, 30, 1.1, 22, 0) },
      { nome: '[ON] [ALCANCE] [MERCADÃO] [DA] [PROCHET]', tipo: 'alcance', metricas: mk(60, 0, 0, 0, 12, 1.0, 9, 0) },
      { nome: '[ON] [VENDAS] [ANOTA AÍ] [PROCHET]', tipo: 'vendas', metricas: mk(40, 0, 2, 60, 10, 1.0, 8, 3) },
    ],
    nivel: 'campaign',
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
  const monthDate = new Date();
  return sInstagramCalendar(posts, 8, 11, monthDate) + sInstagramPosts(posts, 9, 11) + sInstagramSpotlight(posts, 10, 11);
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
      { dia: 'Seg', pedidos: 182, pct: 9 },
      { dia: 'Ter', pedidos: 157, pct: 8 },
      { dia: 'Qua', pedidos: 146, pct: 8 },
      { dia: 'Qui', pedidos: 230, pct: 12 },
      { dia: 'Sex', pedidos: 426, pct: 22 },
      { dia: 'Sáb', pedidos: 460, pct: 24 },
      { dia: 'Dom', pedidos: 336, pct: 17 },
    ],
    entregas_por_dia: [
      { dia: 'Dom', pedidos: 151, pct: 21 },
      { dia: 'Sex', pedidos: 132, pct: 19 },
      { dia: 'Sáb', pedidos: 123, pct: 17 },
      { dia: 'Seg', pedidos: 95, pct: 13 },
      { dia: 'Qui', pedidos: 86, pct: 12 },
      { dia: 'Ter', pedidos: 63, pct: 9 },
      { dia: 'Qua', pedidos: 59, pct: 8 },
    ],
  };
  const prevData: ParsedData = { ...data, faturamento: 134535.98, pedidos_ativos: 1980, ticket: 67.95 };

  const bairros: Bairro[] = [
    { bairro: 'Centro', pedidos: 108, faturamento: 8030.25 },
    { bairro: 'Gleba Fazenda Palhano', pedidos: 70, faturamento: 5089 },
    { bairro: 'Palhano 1', pedidos: 66, faturamento: 5080.94 },
    { bairro: 'Aurora', pedidos: 37, faturamento: 2126.57 },
    { bairro: 'Terra Bonita', pedidos: 34, faturamento: 3486.10 },
    { bairro: 'Palhano 2', pedidos: 25, faturamento: 1771.22 },
    { bairro: 'Jardim Higienópolis', pedidos: 18, faturamento: 1097.51 },
    { bairro: 'Guanabara', pedidos: 14, faturamento: 918.45 },
  ];

  const mkMetricas = (
    investimento: number, conversas: number, compras: number, valor_compras: number,
    cliques: number, frequencia: number, visitas_pagina = 0, iniciaram_checkout = 0, leads = 0,
  ) => ({
    investimento, impressoes: Math.round(cliques * 60), alcance: Math.round(cliques * 40), cliques, frequencia, leads, conversas, compras, valor_compras,
    purchase_roas: investimento > 0 ? valor_compras / investimento : 0,
    visitas_pagina, iniciaram_checkout,
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
    nivel: 'campaign',
  };

  const instagram: InstagramData = {
    username: 'picolocos.oficial', followers: 8240, followers_period: 180, reach: 42000, impressions: 61000,
    profile_views: 1850, website_clicks: 620, accounts_engaged: 3100,
    previous: { followers_period: 126, reach: 36500, impressions: 54800, profile_views: 1620, website_clicks: 710, accounts_engaged: 2800 },
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
    { nome: '[ON] [LEADS] Loja pronta em condomínio', spend: 1492, resultado: 48, campaign_name: 'Meta Ads | Captação de leads | Franquias', adset_name: 'Interesse em franquias | Londrina', objective: 'Leads', reach: 38200, clicks: 1420, ctr: 2.84, thumbnail_url: 'https://picsum.photos/seed/cr1/420/520', media_url: 'https://picsum.photos/seed/cr1/420/520' },
    { nome: '[ON] [VIDEO] Vídeo narrado oportunidade', spend: 914, resultado: 32, campaign_name: 'Meta Ads | Geração de demanda', adset_name: 'Empreendedorismo | Maringá', objective: 'Leads', reach: 24700, clicks: 960, ctr: 2.17, thumbnail_url: 'https://picsum.photos/seed/cr2/420/520', media_url: 'https://picsum.photos/seed/cr2/420/520' },
    { nome: '[ON] [PROVA SOCIAL] Depoimento de franqueado', spend: 738, resultado: 21, campaign_name: 'Meta Ads | Prova social', adset_name: 'Lookalike | Curitiba', objective: 'Leads', reach: 18900, clicks: 740, ctr: 1.96, thumbnail_url: 'https://picsum.photos/seed/cr3/420/520', media_url: 'https://picsum.photos/seed/cr3/420/520' },
    { nome: '[ON] [CARROSSEL] Modelo de negócio', spend: 812, resultado: 15, campaign_name: 'Meta Ads | Conversão', adset_name: 'Interesses amplos | Curitiba', objective: 'Leads', reach: 21300, clicks: 615, ctr: 1.72, thumbnail_url: 'https://picsum.photos/seed/cr4/420/520', media_url: 'https://picsum.photos/seed/cr4/420/520' },
  ];

  const diag: DiagJson = {
    insight_campanha_conversa: 'Campanhas de conversa via WhatsApp tiveram o menor custo por resultado do mês.',
    insight_campanha_conversao: 'Anota Aí Low Budget entregou o melhor ROAS entre as campanhas de venda direta.',
  };

  const periodo = 'Maio/2026';
  const prevPeriodo = 'Abril/2026';

  const hasVisao = true, hasDia = true, hasRegiao = true, hasBase = true, hasInat = true;
  const hasMeta = true, hasInstagram = true, hasInstagramPosts = true, hasInstagramSpotlight = true;
  const hasDestaques = true, hasCriativos = true;
  const instagramCalendarMonths = monthsBetweenInclusive(new Date(2026, 2, 1, 12), new Date(2026, 4, 31, 12));
  const destaquePages = Math.ceil(meta.campanhas.length / 4);

  const total = 11 + instagramCalendarMonths.length + destaquePages; // cover + non-calendar sections + one calendar per month
  const slides: string[] = [];
  let i = 1;

  slides.push(sCapa(data, meta, 'PicoLocos', periodo, prevPeriodo, diag, total, REPORT_COVERS[0]));
  // ── Bloco: base de clientes / produtos ────────────────────────────────────
  if (hasVisao)              slides.push(sVisaoGeral(data, prevData, ++i, total, periodo, prevPeriodo));
  if (hasDia)                slides.push(sPorDia(data, ++i, total, periodo));
  if (hasRegiao)             slides.push(sRegioes(bairros, ++i, total));
  if (hasBase)               slides.push(sBase(data, ++i, total));
  if (hasInat)               slides.push(sInativos(data, ++i, total));
  // ── Bloco: tráfego pago (Meta Ads) ─────────────────────────────────────────
  if (hasMeta)               slides.push(sMetaAdsResumo(meta, ++i, total));
  if (hasDestaques) {
    for (let start = 0; start < meta.campanhas.length; start += 4) {
      slides.push(sMetaAdsCampanhas(meta, diag, ++i, total, periodo, meta.campanhas.slice(start, start + 4)));
    }
  }
  if (hasCriativos)          slides.push(sCriativos(creatives, ++i, total));
  // ── Bloco: Instagram ───────────────────────────────────────────────────────
  if (hasInstagram)          slides.push(sInstagram(instagram, ++i, total, 'Março/2026 a Maio/2026'));
  if (hasInstagramPosts) {
    for (const monthDate of instagramCalendarMonths) {
      slides.push(sInstagramCalendar(igPosts, ++i, total, monthDate));
    }
  }
  if (hasInstagramPosts)     slides.push(sInstagramPosts(igPosts, ++i, total));
  if (hasInstagramSpotlight) slides.push(sInstagramSpotlight(igPosts, ++i, total));

  return `${FONT_LINK}<div class="onmid-report" style="background:${CANVAS};padding:28px;font-family:${INTER}">${slides.join('')}</div>`;
}

// ── TEMP DEV PREVIEW — remove before shipping ───────────────────────────────
export function __devPreviewInstagram(): string {
  const ig: InstagramData = {
    username: 'picolocos.oficial', followers: 8240, followers_period: 180, reach: 42000, impressions: 61000,
    profile_views: 1850, website_clicks: 620, accounts_engaged: 3100,
    previous: { followers_period: 126, reach: 36500, impressions: 54800, profile_views: 1620, website_clicks: 710, accounts_engaged: 2800 },
  };
  return sInstagram(ig, 9, 17, 'Maio/2026');
}
