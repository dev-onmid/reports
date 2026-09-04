// ── GA4 · métricas de landing page (Data API) ────────────────────────────────
//
// As LPs da ONMID (~/Documents/lps) mandam eventos padronizados para o GA4
// via GTM (PROMPT-RASTREIO-GTM.md): click_whatsapp, click_telefone, click_cta,
// view_secao, lead_form, com parâmetros registrados como dimensões
// personalizadas de evento (posicao, peca, veiculo, material, espessura...).
// Este módulo lê isso pela Data API e devolve um relatório pronto para o
// dashboard. Funções puras (parse/agregação) ficam separadas para teste.

export type Ga4Linha = { valor: string; n: number };
export type Ga4Detalhe = { param: string; rotulo: string; linhas: Ga4Linha[] };
export type Ga4Dia = { date: string; sessoes: number; contatos: number };
export type Ga4Origem = { origem: string; midia: string; sessoes: number; contatos: number };

export type Ga4Totais = {
  sessoes: number;
  usuarios: number;
  pageviews: number;
  whatsapp: number;
  telefone: number;
  cta: number;
  leadForm: number;
  /** whatsapp + telefone + lead_form */
  contatos: number;
  /** contatos / sessoes (0–1) */
  taxaContato: number;
};

export type Ga4Relatorio = {
  propertyId: string;
  nome: string;
  atual: Ga4Totais;
  anterior: Ga4Totais;
  origens: Ga4Origem[];
  posicoes: Ga4Linha[];
  detalhes: Ga4Detalhe[];
  diario: Ga4Dia[];
};

export const EVENTOS_CONTATO = ['click_whatsapp', 'click_telefone', 'lead_form'] as const;
export const EVENTOS_LIDOS = ['click_whatsapp', 'click_telefone', 'click_cta', 'lead_form'] as const;

/** Parâmetros que viram "o que o visitante procura" — só os que a LP preenche aparecem. */
export const DETALHES: Array<{ param: string; rotulo: string }> = [
  { param: 'peca', rotulo: 'Peças mais pedidas' },
  { param: 'veiculo', rotulo: 'Veículos' },
  { param: 'material', rotulo: 'Materiais' },
  { param: 'espessura', rotulo: 'Espessuras' },
  { param: 'cta_id', rotulo: 'Botões clicados' },
];

// ── tipos mínimos da resposta da Data API ─────────────────────────────────────
export type Ga4Row = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
export type Ga4Report = { rows?: Ga4Row[]; dimensionHeaders?: Array<{ name: string }>; metricHeaders?: Array<{ name: string }> };

const num = (v: string | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };

export function totaisVazios(): Ga4Totais {
  return { sessoes: 0, usuarios: 0, pageviews: 0, whatsapp: 0, telefone: 0, cta: 0, leadForm: 0, contatos: 0, taxaContato: 0 };
}

function fechaTotais(t: Ga4Totais): Ga4Totais {
  t.contatos = t.whatsapp + t.telefone + t.leadForm;
  t.taxaContato = t.sessoes > 0 ? t.contatos / t.sessoes : 0;
  return t;
}

/**
 * Relatório de totais com DUAS faixas de data (dateRange dimension):
 * linhas "date_range_0" = atual, "date_range_1" = anterior.
 * Métricas na ordem: sessions, totalUsers, screenPageViews.
 */
export function parseTotais(rep: Ga4Report | null): { atual: Ga4Totais; anterior: Ga4Totais } {
  const atual = totaisVazios(), anterior = totaisVazios();
  for (const r of rep?.rows ?? []) {
    const faixa = r.dimensionValues?.[0]?.value ?? 'date_range_0';
    const alvo = faixa === 'date_range_1' ? anterior : atual;
    alvo.sessoes += num(r.metricValues?.[0]?.value);
    alvo.usuarios += num(r.metricValues?.[1]?.value);
    alvo.pageviews += num(r.metricValues?.[2]?.value);
  }
  return { atual, anterior };
}

/** Relatório de eventos com duas faixas: dims [dateRange, eventName], métrica eventCount. */
export function parseEventos(rep: Ga4Report | null, alvo: { atual: Ga4Totais; anterior: Ga4Totais }) {
  for (const r of rep?.rows ?? []) {
    const faixa = r.dimensionValues?.[0]?.value ?? 'date_range_0';
    const ev = r.dimensionValues?.[1]?.value ?? '';
    const n = num(r.metricValues?.[0]?.value);
    const t = faixa === 'date_range_1' ? alvo.anterior : alvo.atual;
    if (ev === 'click_whatsapp') t.whatsapp += n;
    else if (ev === 'click_telefone') t.telefone += n;
    else if (ev === 'click_cta') t.cta += n;
    else if (ev === 'lead_form') t.leadForm += n;
  }
  fechaTotais(alvo.atual); fechaTotais(alvo.anterior);
  return alvo;
}

/** dims [sessionSource, sessionMedium], métricas [sessions, keyEvents]. */
export function parseOrigens(rep: Ga4Report | null): Ga4Origem[] {
  return (rep?.rows ?? []).map(r => ({
    origem: r.dimensionValues?.[0]?.value || '(direto)',
    midia: r.dimensionValues?.[1]?.value || '(nenhuma)',
    sessoes: num(r.metricValues?.[0]?.value),
    contatos: num(r.metricValues?.[1]?.value),
  })).sort((a, b) => b.sessoes - a.sessoes);
}

/** Uma dimensão + eventCount → linhas ordenadas, sem "(not set)". */
export function parseLinhas(rep: Ga4Report | null, limite = 10): Ga4Linha[] {
  return (rep?.rows ?? [])
    .map(r => ({ valor: r.dimensionValues?.[0]?.value ?? '', n: num(r.metricValues?.[0]?.value) }))
    .filter(l => l.valor && l.valor !== '(not set)' && l.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limite);
}

/** dim date (AAAAMMDD), métricas [sessions, keyEvents]. */
export function parseDiario(rep: Ga4Report | null): Ga4Dia[] {
  return (rep?.rows ?? []).map(r => {
    const d = r.dimensionValues?.[0]?.value ?? '';
    return { date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d, sessoes: num(r.metricValues?.[0]?.value), contatos: num(r.metricValues?.[1]?.value) };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

// ── agregação de várias propriedades (cliente com mais de uma LP) ─────────────
function somaTotais(lista: Ga4Totais[]): Ga4Totais {
  const t = totaisVazios();
  for (const x of lista) { t.sessoes += x.sessoes; t.usuarios += x.usuarios; t.pageviews += x.pageviews; t.whatsapp += x.whatsapp; t.telefone += x.telefone; t.cta += x.cta; t.leadForm += x.leadForm; }
  return fechaTotais(t);
}
function somaLinhas(listas: Ga4Linha[][], limite = 10): Ga4Linha[] {
  const m = new Map<string, number>();
  for (const l of listas) for (const x of l) m.set(x.valor, (m.get(x.valor) ?? 0) + x.n);
  return [...m].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n).slice(0, limite);
}

export type Ga4Consolidado = Omit<Ga4Relatorio, 'propertyId' | 'nome'> & { propriedades: Array<{ propertyId: string; nome: string; atual: Ga4Totais }> };

export function consolidar(rels: Ga4Relatorio[]): Ga4Consolidado {
  const origens = new Map<string, Ga4Origem>();
  for (const r of rels) for (const o of r.origens) {
    const k = `${o.origem}|${o.midia}`; const cur = origens.get(k);
    if (cur) { cur.sessoes += o.sessoes; cur.contatos += o.contatos; } else origens.set(k, { ...o });
  }
  const diario = new Map<string, Ga4Dia>();
  for (const r of rels) for (const d of r.diario) {
    const cur = diario.get(d.date);
    if (cur) { cur.sessoes += d.sessoes; cur.contatos += d.contatos; } else diario.set(d.date, { ...d });
  }
  const detalhes: Ga4Detalhe[] = [];
  for (const def of DETALHES) {
    const linhas = somaLinhas(rels.map(r => r.detalhes.find(d => d.param === def.param)?.linhas ?? []));
    if (linhas.length) detalhes.push({ param: def.param, rotulo: def.rotulo, linhas });
  }
  return {
    atual: somaTotais(rels.map(r => r.atual)),
    anterior: somaTotais(rels.map(r => r.anterior)),
    origens: [...origens.values()].sort((a, b) => b.sessoes - a.sessoes).slice(0, 12),
    posicoes: somaLinhas(rels.map(r => r.posicoes)),
    detalhes,
    diario: [...diario.values()].sort((a, b) => a.date.localeCompare(b.date)),
    propriedades: rels.map(r => ({ propertyId: r.propertyId, nome: r.nome, atual: r.atual })),
  };
}

// ── acesso à Data API ─────────────────────────────────────────────────────────
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

type Faixa = { startDate: string; endDate: string };

async function runReport(propertyId: string, token: string, body: Record<string, unknown>): Promise<Ga4Report | null> {
  const res = await fetch(`${DATA_API}/properties/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!res) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`[ga4] runReport ${propertyId} ${res.status}`, txt.slice(0, 300));
    return null;
  }
  return res.json() as Promise<Ga4Report>;
}

const filtroEvento = (nomes: readonly string[]) => ({ filter: { fieldName: 'eventName', inListFilter: { values: [...nomes] } } });
const filtroUm = (nome: string) => ({ filter: { fieldName: 'eventName', stringFilter: { value: nome } } });

export async function relatorioLanding(propertyId: string, nome: string, token: string, atual: Faixa, anterior: Faixa): Promise<Ga4Relatorio> {
  const duas = [atual, anterior];
  const [totRep, evRep, origRep, posRep, diaRep, ...detReps] = await Promise.all([
    runReport(propertyId, token, { dateRanges: duas, metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'screenPageViews' }] }),
    runReport(propertyId, token, { dateRanges: duas, dimensions: [{ name: 'eventName' }], metrics: [{ name: 'eventCount' }], dimensionFilter: filtroEvento(EVENTOS_LIDOS) }),
    runReport(propertyId, token, { dateRanges: [atual], dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: 12, orderBys: [{ metric: { metricName: 'sessions' }, desc: true }] }),
    runReport(propertyId, token, { dateRanges: [atual], dimensions: [{ name: 'customEvent:posicao' }], metrics: [{ name: 'eventCount' }], dimensionFilter: filtroEvento(EVENTOS_CONTATO), limit: 12 }),
    runReport(propertyId, token, { dateRanges: [atual], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'keyEvents' }], limit: 400 }),
    ...DETALHES.map(d => runReport(propertyId, token, {
      dateRanges: [atual], dimensions: [{ name: `customEvent:${d.param}` }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: d.param === 'cta_id' ? filtroUm('click_cta') : filtroUm('click_whatsapp'), limit: 10,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    })),
  ]);
  // Com 2 faixas o GA4 acrescenta a dimensão dateRange como PRIMEIRA coluna.
  const totais = parseEventos(evRep, parseTotais(totRep));
  const detalhes: Ga4Detalhe[] = [];
  DETALHES.forEach((d, i) => { const linhas = parseLinhas(detReps[i]); if (linhas.length) detalhes.push({ param: d.param, rotulo: d.rotulo, linhas }); });
  return {
    propertyId, nome,
    atual: totais.atual, anterior: totais.anterior,
    origens: parseOrigens(origRep),
    posicoes: parseLinhas(posRep, 12),
    detalhes,
    diario: parseDiario(diaRep),
  };
}

// ── faixas de data a partir do período do dashboard ("range:AAAA-MM-DD:AAAA-MM-DD") ──
export function faixasDoPeriodo(metaPeriod: string): { atual: Faixa; anterior: Faixa } {
  const [, since, until] = metaPeriod.split(':');
  const ini = new Date(`${since}T00:00:00Z`), fim = new Date(`${until}T00:00:00Z`);
  const dias = Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
  const antFim = new Date(ini.getTime() - 86400000);
  const antIni = new Date(antFim.getTime() - (dias - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { atual: { startDate: since, endDate: until }, anterior: { startDate: iso(antIni), endDate: iso(antFim) } };
}
