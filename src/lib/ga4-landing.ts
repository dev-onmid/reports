// ── GA4 · métricas de landing page (Data API) ────────────────────────────────
//
// As LPs da ONMID (~/Documents/lps) mandam eventos padronizados para o GA4
// via GTM (PROMPT-RASTREIO-GTM.md): click_whatsapp, click_telefone, click_cta,
// view_secao, lead_form, form_inicio, lead_form_erro, lead_confirmado,
// video_play e scroll, com parâmetros registrados como dimensões
// personalizadas de evento (posicao, secao, peca, veiculo, material...).
// Este módulo lê isso pela Data API e devolve um relatório pronto para o
// dashboard, em quatro blocos: visão geral, tráfego pago, audiência e
// comportamento na página. Funções puras (parse/agregação) ficam separadas
// para teste.
//
// Custo (advertiserAdCost) só vem quando a propriedade está vinculada ao
// Google Ads; Meta aparece só pelas UTMs (sessionCampaignName). Idade e
// gênero dependem do Google Signals e do limite de privacidade do GA4 —
// em LP pequena costumam vir vazios, e o painel esconde o bloco.

export type Ga4Linha = { valor: string; n: number };
export type Ga4Detalhe = { param: string; rotulo: string; linhas: Ga4Linha[] };
export type Ga4Dia = { date: string; sessoes: number; contatos: number };
export type Ga4Origem = { origem: string; midia: string; sessoes: number; contatos: number };

/** Uma linha de corte com qualidade: sessões, engajamento, tempo e conversões (+ custo no Google Ads). */
export type Ga4Seg = {
  valor: string;
  sub?: string;
  sessoes: number;
  /** sessões engajadas (>10 s, 2+ páginas ou conversão) */
  engajadas: number;
  /** segundos de engajamento somados (userEngagementDuration) */
  tempo: number;
  /** eventos-chave (keyEvents) — uma sessão pode ter vários */
  conversoes: number;
  /** sessões com pelo menos um evento-chave (sessionKeyEventRate × sessões) — base da taxa */
  sessoesConv: number;
  custo?: number;
  cliques?: number;
};
export type Ga4Celula = { dia: number; hora: number; sessoes: number; conversoes: number };
export type Ga4Funil = { visitantes: number; formInicio: number; formErro: number; leadForm: number; leadConfirmado: number };

export type Ga4Totais = {
  sessoes: number;
  usuarios: number;
  novos: number;
  pageviews: number;
  engajadas: number;
  /** segundos de engajamento somados — média = tempo / sessoes */
  tempo: number;
  whatsapp: number;
  telefone: number;
  cta: number;
  leadForm: number;
  video: number;
  /** whatsapp + telefone + lead_form */
  contatos: number;
  /** contatos / sessoes (0–1) */
  taxaContato: number;
};

export type Ga4Pago = {
  canais: Ga4Seg[];
  /** sessionCampaignName (Google, Meta via UTM, qualquer origem) */
  campanhas: Ga4Seg[];
  /** sessionGoogleAdsCampaignName, com custo e cliques do Ads */
  googleAds: Ga4Seg[];
  palavras: Ga4Seg[];
  termos: Ga4Seg[];
};
export type Ga4Audiencia = {
  dispositivos: Ga4Seg[];
  cidades: Ga4Seg[];
  novosRecorrentes: Ga4Seg[];
  idades: Ga4Seg[];
  generos: Ga4Seg[];
  semanaHora: Ga4Celula[];
};
export type Ga4Comportamento = {
  paginasEntrada: Ga4Seg[];
  /** percentScrolled → usuários que chegaram a cada marca */
  rolagem: Ga4Linha[];
  /** customEvent:secao → usuários que viram cada seção */
  secoes: Ga4Linha[];
  funil: Ga4Funil;
  videos: Ga4Linha[];
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
  pago: Ga4Pago;
  audiencia: Ga4Audiencia;
  comportamento: Ga4Comportamento;
};

export const EVENTOS_CONTATO = ['click_whatsapp', 'click_telefone', 'lead_form'] as const;
export const EVENTOS_LIDOS = ['click_whatsapp', 'click_telefone', 'click_cta', 'lead_form', 'video_play'] as const;
export const EVENTOS_FUNIL = ['form_inicio', 'lead_form_erro', 'lead_form', 'lead_confirmado'] as const;

/** Parâmetros que viram "o que o visitante procura" — só os que a LP preenche aparecem. */
export const DETALHES: Array<{ param: string; rotulo: string }> = [
  { param: 'peca', rotulo: 'Peças mais pedidas' },
  { param: 'veiculo', rotulo: 'Veículos' },
  { param: 'material', rotulo: 'Materiais' },
  { param: 'espessura', rotulo: 'Espessuras' },
  { param: 'palestra', rotulo: 'Palestras pedidas' },
  { param: 'cta_id', rotulo: 'Botões clicados' },
];

// ── tipos mínimos da resposta da Data API ─────────────────────────────────────
export type Ga4Row = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };
export type Ga4Report = { rows?: Ga4Row[]; dimensionHeaders?: Array<{ name: string }>; metricHeaders?: Array<{ name: string }> };

const num = (v: string | undefined) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const VAZIOS = new Set(['', '(not set)', '(not provided)', 'unknown', '(other)']);

export function totaisVazios(): Ga4Totais {
  return { sessoes: 0, usuarios: 0, novos: 0, pageviews: 0, engajadas: 0, tempo: 0, whatsapp: 0, telefone: 0, cta: 0, leadForm: 0, video: 0, contatos: 0, taxaContato: 0 };
}

function fechaTotais(t: Ga4Totais): Ga4Totais {
  t.contatos = t.whatsapp + t.telefone + t.leadForm;
  t.taxaContato = t.sessoes > 0 ? t.contatos / t.sessoes : 0;
  return t;
}

/** Métricas do relatório de totais, na ordem em que parseTotais as lê. */
export const METRICAS_TOTAIS = ['sessions', 'totalUsers', 'screenPageViews', 'newUsers', 'engagedSessions', 'userEngagementDuration'] as const;

/**
 * Posição de uma dimensão pelo cabeçalho da resposta. Com DUAS faixas de data
 * o GA4 acrescenta a dimensão `dateRange` como ÚLTIMA coluna (não a primeira —
 * ler por posição fixa zerava todos os eventos). `padrao` só vale para
 * resposta sem cabeçalho (testes antigos / relatório vazio).
 */
export function indiceDim(rep: Ga4Report | null, nome: string, padrao: number): number {
  const i = rep?.dimensionHeaders?.findIndex(h => h.name === nome) ?? -1;
  return i >= 0 ? i : padrao;
}

/**
 * Relatório de totais com DUAS faixas de data (dateRange dimension):
 * linhas "date_range_0" = atual, "date_range_1" = anterior.
 * Métricas na ordem de METRICAS_TOTAIS.
 */
export function parseTotais(rep: Ga4Report | null): { atual: Ga4Totais; anterior: Ga4Totais } {
  const atual = totaisVazios(), anterior = totaisVazios();
  const iFaixa = indiceDim(rep, 'dateRange', 0);
  for (const r of rep?.rows ?? []) {
    const faixa = r.dimensionValues?.[iFaixa]?.value ?? 'date_range_0';
    const alvo = faixa === 'date_range_1' ? anterior : atual;
    const m = (i: number) => num(r.metricValues?.[i]?.value);
    alvo.sessoes += m(0); alvo.usuarios += m(1); alvo.pageviews += m(2);
    alvo.novos += m(3); alvo.engajadas += m(4); alvo.tempo += m(5);
  }
  return { atual, anterior };
}

/** Relatório de eventos com duas faixas: dims [eventName, dateRange] (lidas pelo cabeçalho), métrica eventCount. */
export function parseEventos(rep: Ga4Report | null, alvo: { atual: Ga4Totais; anterior: Ga4Totais }) {
  const iFaixa = indiceDim(rep, 'dateRange', 1);
  const iEvento = indiceDim(rep, 'eventName', 0);
  for (const r of rep?.rows ?? []) {
    const faixa = r.dimensionValues?.[iFaixa]?.value ?? 'date_range_0';
    const ev = r.dimensionValues?.[iEvento]?.value ?? '';
    const n = num(r.metricValues?.[0]?.value);
    const t = faixa === 'date_range_1' ? alvo.anterior : alvo.atual;
    if (ev === 'click_whatsapp') t.whatsapp += n;
    else if (ev === 'click_telefone') t.telefone += n;
    else if (ev === 'click_cta') t.cta += n;
    else if (ev === 'lead_form') t.leadForm += n;
    else if (ev === 'video_play') t.video += n;
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

/** Uma dimensão + uma métrica → linhas ordenadas, sem "(not set)". */
export function parseLinhas(rep: Ga4Report | null, limite = 10): Ga4Linha[] {
  return (rep?.rows ?? [])
    .map(r => ({ valor: r.dimensionValues?.[0]?.value ?? '', n: num(r.metricValues?.[0]?.value) }))
    .filter(l => !VAZIOS.has(l.valor) && l.n > 0)
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

/** Métricas dos cortes com qualidade, na ordem em que parseSeg as lê. */
export const METRICAS_SEG = ['sessions', 'engagedSessions', 'userEngagementDuration', 'keyEvents', 'sessionKeyEventRate'] as const;
export const METRICAS_ADS = [...METRICAS_SEG, 'advertiserAdCost', 'advertiserAdClicks'] as const;

/**
 * 1ª dimensão = valor; as demais viram `sub` ("google / cpc").
 * Métricas na ordem de METRICAS_SEG (+ custo e cliques quando `comCusto`).
 * A taxa vira contagem (sessoesConv) para poder somar propriedades.
 */
export function parseSeg(rep: Ga4Report | null, opts: { limite?: number; comCusto?: boolean; manterVazios?: boolean } = {}): Ga4Seg[] {
  const { limite = 10, comCusto = false, manterVazios = false } = opts;
  return (rep?.rows ?? [])
    .map(r => {
      const dv = (r.dimensionValues ?? []).map(d => d.value ?? '');
      const m = (i: number) => num(r.metricValues?.[i]?.value);
      const s: Ga4Seg = { valor: dv[0] ?? '', sessoes: m(0), engajadas: m(1), tempo: m(2), conversoes: m(3), sessoesConv: Math.round(m(4) * m(0)) };
      if (dv.length > 1) s.sub = dv.slice(1).join(' / ');
      if (comCusto) { s.custo = m(5); s.cliques = m(6); }
      return s;
    })
    .filter(s => (manterVazios || !VAZIOS.has(s.valor)) && (s.sessoes > 0 || (s.custo ?? 0) > 0))
    .sort((a, b) => b.sessoes - a.sessoes)
    .slice(0, limite);
}

/** dims [dayOfWeek (0=domingo), hour], métricas [sessions, keyEvents]. */
export function parseSemanaHora(rep: Ga4Report | null): Ga4Celula[] {
  return (rep?.rows ?? []).map(r => ({
    dia: num(r.dimensionValues?.[0]?.value),
    hora: num(r.dimensionValues?.[1]?.value),
    sessoes: num(r.metricValues?.[0]?.value),
    conversoes: num(r.metricValues?.[1]?.value),
  })).filter(c => c.sessoes > 0 || c.conversoes > 0);
}

/** dim eventName, métrica totalUsers (pessoas, não cliques) — filtrado em EVENTOS_FUNIL. */
export function parseFunil(rep: Ga4Report | null, visitantes: number): Ga4Funil {
  const f: Ga4Funil = { visitantes, formInicio: 0, formErro: 0, leadForm: 0, leadConfirmado: 0 };
  for (const r of rep?.rows ?? []) {
    const ev = r.dimensionValues?.[0]?.value ?? '';
    const n = num(r.metricValues?.[0]?.value);
    if (ev === 'form_inicio') f.formInicio += n;
    else if (ev === 'lead_form_erro') f.formErro += n;
    else if (ev === 'lead_form') f.leadForm += n;
    else if (ev === 'lead_confirmado') f.leadConfirmado += n;
  }
  return f;
}

/** Rolagem na ordem das marcas (25, 50, 75, 90), não por volume. */
export function ordenaRolagem(l: Ga4Linha[]): Ga4Linha[] {
  return [...l].sort((a, b) => Number(a.valor) - Number(b.valor));
}

// ── agregação de várias propriedades (cliente com mais de uma LP) ─────────────
function somaTotais(lista: Ga4Totais[]): Ga4Totais {
  const t = totaisVazios();
  for (const x of lista) {
    t.sessoes += x.sessoes; t.usuarios += x.usuarios; t.novos += x.novos; t.pageviews += x.pageviews;
    t.engajadas += x.engajadas; t.tempo += x.tempo;
    t.whatsapp += x.whatsapp; t.telefone += x.telefone; t.cta += x.cta; t.leadForm += x.leadForm; t.video += x.video;
  }
  return fechaTotais(t);
}
function somaLinhas(listas: Ga4Linha[][], limite = 10): Ga4Linha[] {
  const m = new Map<string, number>();
  for (const l of listas) for (const x of l) m.set(x.valor, (m.get(x.valor) ?? 0) + x.n);
  return [...m].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n).slice(0, limite);
}
export function somaSeg(listas: Ga4Seg[][], limite = 10): Ga4Seg[] {
  const m = new Map<string, Ga4Seg>();
  for (const l of listas) for (const s of l) {
    const k = `${s.valor}|${s.sub ?? ''}`; const cur = m.get(k);
    if (!cur) { m.set(k, { ...s }); continue; }
    cur.sessoes += s.sessoes; cur.engajadas += s.engajadas; cur.tempo += s.tempo; cur.conversoes += s.conversoes; cur.sessoesConv += s.sessoesConv;
    if (s.custo !== undefined) cur.custo = (cur.custo ?? 0) + s.custo;
    if (s.cliques !== undefined) cur.cliques = (cur.cliques ?? 0) + s.cliques;
  }
  return [...m.values()].sort((a, b) => b.sessoes - a.sessoes).slice(0, limite);
}
function somaCelulas(listas: Ga4Celula[][]): Ga4Celula[] {
  const m = new Map<string, Ga4Celula>();
  for (const l of listas) for (const c of l) {
    const k = `${c.dia}|${c.hora}`; const cur = m.get(k);
    if (cur) { cur.sessoes += c.sessoes; cur.conversoes += c.conversoes; } else m.set(k, { ...c });
  }
  return [...m.values()];
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
  const pago = (k: keyof Ga4Pago, limite = 12) => somaSeg(rels.map(r => r.pago[k]), limite);
  const aud = (k: Exclude<keyof Ga4Audiencia, 'semanaHora'>, limite = 10) => somaSeg(rels.map(r => r.audiencia[k]), limite);
  const funis = rels.map(r => r.comportamento.funil);
  const soma = (k: keyof Ga4Funil) => funis.reduce((s, f) => s + f[k], 0);
  return {
    atual: somaTotais(rels.map(r => r.atual)),
    anterior: somaTotais(rels.map(r => r.anterior)),
    origens: [...origens.values()].sort((a, b) => b.sessoes - a.sessoes).slice(0, 12),
    posicoes: somaLinhas(rels.map(r => r.posicoes)),
    detalhes,
    diario: [...diario.values()].sort((a, b) => a.date.localeCompare(b.date)),
    pago: { canais: pago('canais', 10), campanhas: pago('campanhas'), googleAds: pago('googleAds'), palavras: pago('palavras', 15), termos: pago('termos', 15) },
    audiencia: {
      dispositivos: aud('dispositivos'), cidades: aud('cidades', 12), novosRecorrentes: aud('novosRecorrentes'),
      idades: aud('idades'), generos: aud('generos'),
      semanaHora: somaCelulas(rels.map(r => r.audiencia.semanaHora)),
    },
    comportamento: {
      paginasEntrada: somaSeg(rels.map(r => r.comportamento.paginasEntrada)),
      rolagem: ordenaRolagem(somaLinhas(rels.map(r => r.comportamento.rolagem))),
      secoes: somaLinhas(rels.map(r => r.comportamento.secoes), 12),
      funil: { visitantes: soma('visitantes'), formInicio: soma('formInicio'), formErro: soma('formErro'), leadForm: soma('leadForm'), leadConfirmado: soma('leadConfirmado') },
      videos: somaLinhas(rels.map(r => r.comportamento.videos)),
    },
    propriedades: rels.map(r => ({ propertyId: r.propertyId, nome: r.nome, atual: r.atual })),
  };
}

// ── acesso à Data API ─────────────────────────────────────────────────────────
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';

type Faixa = { startDate: string; endDate: string };
type Pedido = Record<string, unknown>;

async function post<T>(url: string, token: string, body: unknown): Promise<T | null> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!res) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`[ga4] ${url.split('/').pop()} ${res.status}`, txt.slice(0, 300));
    return null;
  }
  return res.json() as Promise<T>;
}

/** Dimensões personalizadas registradas na propriedade ("customEvent:posicao"...). */
async function dimensoesPersonalizadas(propertyId: string, token: string): Promise<Set<string>> {
  const res = await fetch(`${DATA_API}/properties/${propertyId}/metadata`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res?.ok) return new Set();
  const j = await res.json().catch(() => null) as { dimensions?: Array<{ apiName?: string }> } | null;
  return new Set((j?.dimensions ?? []).map(d => d.apiName ?? '').filter(n => n.startsWith('customEvent:')));
}

/**
 * Roda os pedidos em lotes de 5 (batchRunReports — o GA4 limita pedidos
 * simultâneos por propriedade; o lote conta como 1). Se um lote falhar,
 * repete os pedidos dele um a um para não perder os bons.
 * Devolve na ordem dos pedidos; null = aquele relatório falhou.
 */
async function rodaLotes(propertyId: string, token: string, pedidos: Pedido[]): Promise<Array<Ga4Report | null>> {
  const lotes: Pedido[][] = [];
  for (let i = 0; i < pedidos.length; i += 5) lotes.push(pedidos.slice(i, i + 5));
  const saida: Array<Ga4Report | null> = [];
  for (let i = 0; i < lotes.length; i += 3) {
    const partes = await Promise.all(lotes.slice(i, i + 3).map(async lote => {
      const j = await post<{ reports?: Ga4Report[] }>(`${DATA_API}/properties/${propertyId}:batchRunReports`, token, { requests: lote });
      if (j?.reports?.length === lote.length) return j.reports;
      return Promise.all(lote.map(p => post<Ga4Report>(`${DATA_API}/properties/${propertyId}:runReport`, token, p)));
    }));
    for (const p of partes) saida.push(...p);
  }
  return saida;
}

const filtroEvento = (nomes: readonly string[]) => ({ filter: { fieldName: 'eventName', inListFilter: { values: [...nomes] } } });
const filtroUm = (nome: string) => ({ filter: { fieldName: 'eventName', stringFilter: { value: nome } } });
const metricas = (nomes: readonly string[]) => nomes.map(name => ({ name }));
const dims = (...nomes: string[]) => nomes.map(name => ({ name }));
const porSessoes = [{ metric: { metricName: 'sessions' }, desc: true }];

export async function relatorioLanding(propertyId: string, nome: string, token: string, atual: Faixa, anterior: Faixa): Promise<Ga4Relatorio> {
  const duas = [atual, anterior];
  const um = [atual];
  const custom = await dimensoesPersonalizadas(propertyId, token);
  const tem = (p: string) => custom.has(`customEvent:${p}`);
  const seg = (d: string[], limite = 12, m: readonly string[] = METRICAS_SEG): Pedido =>
    ({ dateRanges: um, dimensions: dims(...d), metrics: metricas(m), limit: limite, orderBys: porSessoes });

  // Pedidos nomeados — a ordem aqui é a ordem das respostas. Dimensão
  // personalizada só entra se estiver registrada (senão o lote inteiro dá 400).
  const pedidos: Array<[string, Pedido]> = [
    ['totais', { dateRanges: duas, metrics: metricas(METRICAS_TOTAIS) }],
    ['eventos', { dateRanges: duas, dimensions: dims('eventName'), metrics: metricas(['eventCount']), dimensionFilter: filtroEvento(EVENTOS_LIDOS) }],
    ['origens', { dateRanges: um, dimensions: dims('sessionSource', 'sessionMedium'), metrics: metricas(['sessions', 'keyEvents']), limit: 12, orderBys: porSessoes }],
    ['diario', { dateRanges: um, dimensions: dims('date'), metrics: metricas(['sessions', 'keyEvents']), limit: 400 }],
    // tráfego pago
    ['canais', seg(['sessionDefaultChannelGroup'])],
    ['campanhas', seg(['sessionCampaignName', 'sessionSourceMedium'], 20)],
    ['googleAds', seg(['sessionGoogleAdsCampaignName'], 20, METRICAS_ADS)],
    ['palavras', seg(['sessionGoogleAdsKeyword'], 25)],
    ['termos', seg(['sessionGoogleAdsQuery'], 25)],
    // audiência
    ['dispositivos', seg(['deviceCategory'])],
    ['cidades', seg(['city'], 15)],
    ['novosRecorrentes', seg(['newVsReturning'])],
    ['idades', seg(['userAgeBracket'])],
    ['generos', seg(['userGender'])],
    ['semanaHora', { dateRanges: um, dimensions: dims('dayOfWeek', 'hour'), metrics: metricas(['sessions', 'keyEvents']), limit: 200 }],
    // comportamento
    ['paginasEntrada', seg(['landingPage'])],
    ['rolagem', { dateRanges: um, dimensions: dims('percentScrolled'), metrics: metricas(['totalUsers']), dimensionFilter: filtroUm('scroll') }],
    ['funil', { dateRanges: um, dimensions: dims('eventName'), metrics: metricas(['totalUsers']), dimensionFilter: filtroEvento(EVENTOS_FUNIL) }],
  ];
  if (tem('posicao')) pedidos.push(['posicoes', { dateRanges: um, dimensions: dims('customEvent:posicao'), metrics: metricas(['eventCount']), dimensionFilter: filtroEvento(EVENTOS_CONTATO), limit: 12 }]);
  if (tem('secao')) pedidos.push(['secoes', { dateRanges: um, dimensions: dims('customEvent:secao'), metrics: metricas(['totalUsers']), dimensionFilter: filtroUm('view_secao'), limit: 15 }]);
  const video = tem('video_titulo') ? 'video_titulo' : tem('video_id') ? 'video_id' : '';
  if (video) pedidos.push(['videos', { dateRanges: um, dimensions: dims(`customEvent:${video}`), metrics: metricas(['eventCount']), dimensionFilter: filtroUm('video_play'), limit: 10 }]);
  for (const d of DETALHES) if (tem(d.param)) pedidos.push([`det:${d.param}`, {
    dateRanges: um, dimensions: dims(`customEvent:${d.param}`), metrics: metricas(['eventCount']),
    dimensionFilter: d.param === 'cta_id' ? filtroUm('click_cta') : filtroUm('click_whatsapp'), limit: 10,
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  }]);

  const respostas = await rodaLotes(propertyId, token, pedidos.map(p => p[1]));
  const R = new Map(pedidos.map(([k], i) => [k, respostas[i] ?? null]));
  const r = (k: string) => R.get(k) ?? null;

  // Com 2 faixas o GA4 acrescenta a dimensão dateRange (ver indiceDim).
  const totais = parseEventos(r('eventos'), parseTotais(r('totais')));
  const detalhes: Ga4Detalhe[] = [];
  for (const d of DETALHES) { const linhas = parseLinhas(r(`det:${d.param}`)); if (linhas.length) detalhes.push({ param: d.param, rotulo: d.rotulo, linhas }); }
  return {
    propertyId, nome,
    atual: totais.atual, anterior: totais.anterior,
    origens: parseOrigens(r('origens')),
    posicoes: parseLinhas(r('posicoes'), 12),
    detalhes,
    diario: parseDiario(r('diario')),
    pago: {
      canais: parseSeg(r('canais'), { manterVazios: true }),
      campanhas: parseSeg(r('campanhas'), { limite: 12 }).filter(s => !/^\((direct|organic|referral)\)$/.test(s.valor)),
      googleAds: parseSeg(r('googleAds'), { limite: 12, comCusto: true }),
      palavras: parseSeg(r('palavras'), { limite: 15 }),
      termos: parseSeg(r('termos'), { limite: 15 }),
    },
    audiencia: {
      dispositivos: parseSeg(r('dispositivos')),
      cidades: parseSeg(r('cidades'), { limite: 12 }),
      novosRecorrentes: parseSeg(r('novosRecorrentes')),
      idades: parseSeg(r('idades')),
      generos: parseSeg(r('generos')),
      semanaHora: parseSemanaHora(r('semanaHora')),
    },
    comportamento: {
      paginasEntrada: parseSeg(r('paginasEntrada')),
      rolagem: ordenaRolagem(parseLinhas(r('rolagem'))),
      secoes: parseLinhas(r('secoes'), 12),
      funil: parseFunil(r('funil'), totais.atual.usuarios),
      videos: parseLinhas(r('videos')),
    },
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
