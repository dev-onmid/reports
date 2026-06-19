import { readTabular, normalizeHeader, parseFloat2 } from './delivery-report-builder';

// ── Types ─────────────────────────────────────────────────────────────────────

type RawLeadRow = {
  id: string;
  updatedAt: number; // timestamp, used to resolve duplicates across files
  city: string;
  channel: string;
  stage: string;
  status: 'GANHO' | 'PERDIDO' | 'ABERTO';
  value: number;
};

export type CityChannelAgg = {
  city: string;
  channel: string;
  total: number;
  ganho: number;
  perdido: number;
  aberto: number;
  valorGanho: number;
  custoEstimado: number;
  cpa: number | null;
};

export type LeadFunnelResult = {
  citySummary: CityChannelAgg[];
  byCityChannel: CityChannelAgg[];
  stageByChannel: Map<string, Map<string, number>>;
  cplPerChannelBucket: { meta: number; google: number };
};

// Channels whose CRM label is known to be wrong and must be relabeled before
// any aggregation — e.g. a client stopped tracking "Indicação" but the CRM
// still defaults to it, when in reality every one of those leads is Instagram.
const CHANNEL_ALIASES: Record<string, string> = {
  indicacao: 'Instagram',
};

function normalizeChannel(raw: string): string {
  const key = normalizeHeader(raw);
  if (CHANNEL_ALIASES[key]) return CHANNEL_ALIASES[key];
  return raw.trim() || 'Não informado';
}

// Buckets a channel label against the ad platform that actually paid for it,
// so spend (only known at Meta/Google account level) can be allocated back.
function classifyChannelBucket(channel: string): 'meta' | 'google' | 'outro' {
  const n = normalizeHeader(channel);
  if (n.includes('google')) return 'google';
  if (n.includes('face') || n.includes('insta') || n.includes('meta')) return 'meta';
  return 'outro';
}

function parseBrDateTime(value: string): number {
  const m = value.trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return 0;
  const [, d, mo, y, h = '0', mi = '0'] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)).getTime();
}

function findCol(headers: string[], ...keywords: string[]): number {
  return headers.findIndex(h => keywords.some(k => h.includes(k)));
}

function normalizeStatus(raw: string): 'GANHO' | 'PERDIDO' | 'ABERTO' {
  const n = normalizeHeader(raw);
  if (n.includes('ganho')) return 'GANHO';
  if (n.includes('perdido')) return 'PERDIDO';
  return 'ABERTO';
}

// ── Parse ─────────────────────────────────────────────────────────────────────

// Recognizes generic "deal export" spreadsheets (Pipedrive-style) by header
// shape — works for any client whose CRM export has cidade/origem/etapa/situação
// columns, not just one hardcoded client.
export function parseLeadRows(files: { name: string; content: string }[]): RawLeadRow[] {
  const all: RawLeadRow[] = [];
  for (const file of files) {
    const { headers, rows } = readTabular(file.content);
    if (!headers.length) continue;

    const idCol       = findCol(headers, 'id');
    const updatedCol  = findCol(headers, 'ultima');
    const createdCol  = findCol(headers, 'data de criacao', 'data de criação');
    const cityCol     = findCol(headers, 'cidade');
    const channelCol  = findCol(headers, 'origem', 'canal');
    const stageCol    = findCol(headers, 'etapa');
    const statusCol   = findCol(headers, 'situacao', 'situação');
    const valueCol    = findCol(headers, 'valor');

    if (idCol < 0 || cityCol < 0 || statusCol < 0) continue; // not this kind of file

    for (const row of rows) {
      const id = (row[idCol] ?? '').trim();
      if (!id) continue;
      const updatedRaw = updatedCol >= 0 ? row[updatedCol] : (createdCol >= 0 ? row[createdCol] : '');
      all.push({
        id,
        updatedAt: parseBrDateTime(updatedRaw ?? ''),
        city:    (cityCol >= 0 ? row[cityCol] : '').trim() || 'Não informado',
        channel: normalizeChannel(channelCol >= 0 ? row[channelCol] : ''),
        stage:   (stageCol >= 0 ? row[stageCol] : '').trim() || 'Sem etapa',
        status:  normalizeStatus(row[statusCol]),
        value:   valueCol >= 0 ? parseFloat2(row[valueCol]) : 0,
      });
    }
  }
  return all;
}

// Same lead can appear in several monthly exports (status changes over time,
// e.g. a "resgate" months later) — the most recently updated row wins.
export function mergeLeadRows(rows: RawLeadRow[]): RawLeadRow[] {
  const byId = new Map<string, RawLeadRow>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev || row.updatedAt >= prev.updatedAt) byId.set(row.id, row);
  }
  return Array.from(byId.values());
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

export function buildLeadFunnelByCity(
  rows: RawLeadRow[],
  spend: { meta: number; google: number },
): LeadFunnelResult {
  const leadsPerBucket = { meta: 0, google: 0 };
  for (const r of rows) {
    const bucket = classifyChannelBucket(r.channel);
    if (bucket === 'meta') leadsPerBucket.meta++;
    if (bucket === 'google') leadsPerBucket.google++;
  }
  const cplMeta   = leadsPerBucket.meta   > 0 ? spend.meta   / leadsPerBucket.meta   : 0;
  const cplGoogle = leadsPerBucket.google > 0 ? spend.google / leadsPerBucket.google : 0;

  const cityChannelMap = new Map<string, CityChannelAgg>();
  const stageByChannel = new Map<string, Map<string, number>>();

  for (const r of rows) {
    const key = `${r.city}␟${r.channel}`;
    const agg = cityChannelMap.get(key) ?? {
      city: r.city, channel: r.channel,
      total: 0, ganho: 0, perdido: 0, aberto: 0, valorGanho: 0, custoEstimado: 0, cpa: null,
    };
    agg.total++;
    if (r.status === 'GANHO') { agg.ganho++; agg.valorGanho += r.value; }
    else if (r.status === 'PERDIDO') agg.perdido++;
    else agg.aberto++;
    cityChannelMap.set(key, agg);

    const stages = stageByChannel.get(r.channel) ?? new Map<string, number>();
    stages.set(r.stage, (stages.get(r.stage) ?? 0) + 1);
    stageByChannel.set(r.channel, stages);
  }

  for (const agg of cityChannelMap.values()) {
    const bucket = classifyChannelBucket(agg.channel);
    const cpl = bucket === 'meta' ? cplMeta : bucket === 'google' ? cplGoogle : 0;
    agg.custoEstimado = cpl * agg.total;
    agg.cpa = agg.ganho > 0 ? agg.custoEstimado / agg.ganho : null;
  }

  const byCityChannel = Array.from(cityChannelMap.values()).sort((a, b) => b.total - a.total);

  const cityMap = new Map<string, CityChannelAgg>();
  for (const agg of byCityChannel) {
    const c = cityMap.get(agg.city) ?? {
      city: agg.city, channel: '—',
      total: 0, ganho: 0, perdido: 0, aberto: 0, valorGanho: 0, custoEstimado: 0, cpa: null,
    };
    c.total += agg.total; c.ganho += agg.ganho; c.perdido += agg.perdido; c.aberto += agg.aberto;
    c.valorGanho += agg.valorGanho; c.custoEstimado += agg.custoEstimado;
    cityMap.set(agg.city, c);
  }
  for (const c of cityMap.values()) c.cpa = c.ganho > 0 ? c.custoEstimado / c.ganho : null;
  const citySummary = Array.from(cityMap.values()).sort((a, b) => b.total - a.total);

  return { citySummary, byCityChannel, stageByChannel, cplPerChannelBucket: { meta: cplMeta, google: cplGoogle } };
}

// ── Format for AI prompt ──────────────────────────────────────────────────────

const TOP_CITIES = 15;

export function formatLeadFunnelForPrompt(result: LeadFunnelResult, brl: (n: number) => string): string {
  if (!result.citySummary.length) return '';

  const top  = result.citySummary.slice(0, TOP_CITIES);
  const rest = result.citySummary.slice(TOP_CITIES);

  const lines: string[] = [
    'CRUZAMENTO DE LEADS POR CIDADE E CANAL (já calculado a partir da planilha de CRM do cliente — reproduza estes números exatamente, não recalcule nem arredonde diferente):',
    `Custo por lead estimado — Google: ${brl(result.cplPerChannelBucket.google)} | Meta (Instagram/Facebook): ${brl(result.cplPerChannelBucket.meta)}`,
    '',
    `Por cidade (top ${Math.min(TOP_CITIES, result.citySummary.length)} por volume de leads):`,
  ];

  for (const c of top) {
    lines.push(`- ${c.city}: ${c.total} leads | ${c.ganho} ganhos | ${c.perdido} perdidos | ${c.aberto} em aberto | custo estimado ${brl(c.custoEstimado)} | CPA ${c.cpa !== null ? brl(c.cpa) : '—'} | faturamento ganho ${brl(c.valorGanho)}`);
    const channels = result.byCityChannel.filter(x => x.city === c.city);
    for (const ch of channels) {
      lines.push(`    • ${ch.channel}: ${ch.total} leads | ${ch.ganho} ganhos | custo estimado ${brl(ch.custoEstimado)} | CPA ${ch.cpa !== null ? brl(ch.cpa) : '—'}`);
    }
  }

  if (rest.length) {
    const restTotal = rest.reduce((acc, c) => acc + c.total, 0);
    lines.push(`- Outras ${rest.length} cidades agrupadas: ${restTotal} leads`);
  }

  lines.push('', 'Funil por canal (etapa em que cada lead está/ficou, somando todas as cidades):');
  for (const [channel, stages] of result.stageByChannel.entries()) {
    const parts = Array.from(stages.entries()).sort((a, b) => b[1] - a[1]).map(([stage, n]) => `${stage}: ${n}`);
    lines.push(`- ${channel}: ${parts.join(' | ')}`);
  }

  return lines.join('\n');
}
