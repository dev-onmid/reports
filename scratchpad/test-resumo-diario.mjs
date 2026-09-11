/**
 * Asserts da lib pura + geração dos 3 textos a partir dos dados REAIS de 10/09.
 * Compilar antes:
 *   npx esbuild src/lib/resumo-diario.ts --format=esm --outfile=scratchpad/build/resumo-diario.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import * as R from './build/resumo-diario.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); n++; };

// ── classificação Meta: NOME vence OBJETIVO
eq(R.classificarMeta('[ON] [FORMS] [MARINGÁ]', 'OUTCOME_LEADS', 0, 0), 'lead', 'forms');
eq(R.classificarMeta('[ON] [CWB] [TRÁFEGO] [AMPLO]', 'LINK_CLICKS', 0, 0), 'trafego', 'tráfego');
eq(R.classificarMeta('[ON] [ALCANCE] [GLEBA]', 'OUTCOME_AWARENESS', 0, 0), 'branding', 'alcance');
eq(R.classificarMeta('[ON] [VENDAS] [ANOTA AÍ]', 'OUTCOME_SALES', 0, 4), 'venda', 'vendas');
// ⚠️ o [VENDA] aqui é assunto do anúncio, não objetivo — LEAD tem de vencer
eq(R.classificarMeta('🟥 [ON] [FORMS] [DIRETO] [JUNH] [VENDA] #3', 'OUTCOME_LEADS', 1, 0), 'lead', 'forms vence venda');
// ⚠️ [ENGAJAMENTO] não é branding: nomeia o objetivo da Meta
eq(R.classificarMeta('[ON] [ENGAJAMENTO] [AMPLO]', 'OUTCOME_ENGAGEMENT', 14, 0), 'lead', 'engajamento com conversa = lead');
eq(R.classificarMeta('[ON] [ENGAJAMENTO] [AMPLO] 4.0', 'OUTCOME_ENGAGEMENT', 0, 0), 'engajamento', 'engajamento sem resultado');
eq(R.classificarMeta('[ON] [ENGAJAMENTO] [WHATSAPP]', 'OUTCOME_ENGAGEMENT', 10, 0), 'lead', 'whatsapp vence engajamento');
eq(R.classificarMeta('[ON] [LON/CAM/IBI] - VISITAS AO PERFIL / ENGAJAMENTO', 'OUTCOME_ENGAGEMENT', 0, 0), 'branding', 'visitas ao perfil');
eq(R.classificarMeta('(bot) Campaña de Mensajes - Santos', 'OUTCOME_ENGAGEMENT', 9, 0), 'lead', 'mensajes');
eq(R.classificarMeta('[ON] FEIRAS ONGOING -- VÁRIAS', 'LINK_CLICKS', 12, 0), 'trafego', 'sem marcador cai no objetivo');

// ── classificação Google: CANAL vence NOME
eq(R.classificarGoogle('[ON] [TRÁFEGO] [SEARCH] [IMPLANTES]', 'SEARCH', 1), 'lead', 'search vence nome tráfego');
eq(R.classificarGoogle('[ON] [SEARCH] [CLICKS] [TRAF]', 'SEARCH', 0), 'lead', 'search vence clicks');
eq(R.classificarGoogle('[ON] [MAX-CLICKS] [CANECAS]', 'SEARCH', 12), 'lead', 'max-clicks não é tráfego');
eq(R.classificarGoogle('[ON] [PANINO77] [VIEW] [YT]', 'VIDEO', 0), 'branding', 'vídeo é branding');

// ── régua de CPL (meta do cliente)
eq(R.statusCpl(7.63, 12), 'ok', 'abaixo da meta');
eq(R.statusCpl(12, 12), 'ok', 'exatamente na meta é ok');
eq(R.statusCpl(18, 12), 'atencao', '50% acima ainda é atenção');
eq(R.statusCpl(18.01, 12), 'fora', 'acima de 50% é fora');
eq(R.statusCpl(50, null), 'sem_meta', 'sem meta não julga');
eq(R.statusCpl(null, 12), 'sem_resultado', 'sem lead não tem cpl');

// ── régua de custo por compra (teto global R$ 12) — independente do CPL
eq(R.TETO_CUSTO_COMPRA, 12, 'teto é 12');
eq(R.statusCustoCompra(11.02, 7.4), 'ok', 'dentro do teto');
eq(R.statusCustoCompra(12, 1), 'ok', 'exatamente no teto é ok');
eq(R.statusCustoCompra(34.61, 1.7), 'fora', 'acima do teto sem ROI');
eq(R.statusCustoCompra(34.61, 10.9), 'ok', 'ROI acima de 10x salva');
eq(R.statusCustoCompra(34.61, 10), 'fora', 'ROI exatamente 10x NÃO salva');

// ── rótulo de dia (sem depender de fuso)
eq(R.rotularDia('2026-09-10'), 'quinta-feira, 10/09', 'quinta');
eq(R.rotularDia('2026-09-09'), 'quarta-feira, 09/09', 'quarta');
eq(R.rotularDia('2026-01-01'), 'quinta-feira, 01/01', 'virada de ano');

// ── trava de data relativa
ok(R.contemDataRelativa('Leads ontem: 4'), 'pega ontem');
ok(R.contemDataRelativa('Prioridade de HOJE'), 'pega hoje');
ok(!R.contemDataRelativa('Leads em 09/09: 4'), 'data literal passa');

// ── janela: fim de semana não envia; segunda pega a semana anterior inteira
const seg = R.decidirJanela('2026-09-14'); // segunda
eq(seg.enviar, true, 'segunda envia');
eq(seg.tipo, 'semanal', 'segunda é semanal');
eq(seg.atual.inicio, '2026-09-07', 'semana começa na segunda anterior');
eq(seg.atual.fim, '2026-09-13', 'semana termina no domingo');
eq(seg.anterior.inicio, '2026-08-31', 'comparação é a semana antes');
eq(seg.anterior.fim, '2026-09-06', 'comparação termina no domingo anterior');
eq(R.diasDo(seg.atual).length, 7, 'sete dias');

const ter = R.decidirJanela('2026-09-15'); // terça
eq(ter.tipo, 'diario', 'terça é diária');
eq(ter.atual.inicio, '2026-09-14', 'terça olha a segunda');
eq(ter.anterior.inicio, '2026-09-13', 'compara com domingo');

const sex = R.decidirJanela('2026-09-11'); // sexta
eq(sex.tipo, 'diario', 'sexta é diária');
eq(sex.atual.fim, '2026-09-10', 'sexta olha a quinta');

eq(R.decidirJanela('2026-09-12').enviar, false, 'sábado não envia');
eq(R.decidirJanela('2026-09-13').enviar, false, 'domingo não envia');
// virada de mês e de ano na janela semanal
eq(R.decidirJanela('2026-01-05').atual.inicio, '2025-12-29', 'semana atravessa o ano');

// ── rótulo de período
eq(R.rotularPeriodo({ inicio: '2026-09-10', fim: '2026-09-10' }), 'quinta-feira, 10/09', 'dia único');
eq(R.rotularPeriodo({ inicio: '2026-09-07', fim: '2026-09-13' }), '07/09 a 13/09 (7 dias)', 'intervalo');
eq(R.rotuloCurto({ inicio: '2026-09-07', fim: '2026-09-13' }), '07/09–13/09', 'rótulo curto de intervalo');

// ── agrupamento: classificação é por CAMPANHA na janela, não por dia
const conta = {
  clientId: 'c1', nome: 'Teste', cplMeta: 10, tipoDashboard: 'leads', accountId: 'act_1',
  campanhas: [
    { dia: '2026-09-10', nome: '[ON] [TDW] [X]', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 50, resultados: 0, compras: 0, receita: 0, cliques: 10, alcance: 100, impressoes: 200 },
    { dia: '2026-09-09', nome: '[ON] [TDW] [X]', objetivo: 'OUTCOME_ENGAGEMENT', gasto: 40, resultados: 8, compras: 0, receita: 0, cliques: 12, alcance: 120, impressoes: 240 },
  ],
};
const ag = R.agruparPorTipo(conta, k => R.classificarMeta(k.nome, k.objetivo, k.resultados, k.compras));
eq(R.baldeDo(ag, '2026-09-10', 'lead').gasto, 50, 'dia sem resultado continua no balde de lead');
eq(R.baldeDo(ag, '2026-09-10', 'engajamento').gasto, 0, 'não vazou para engajamento');
eq(R.baldeDoPeriodo(ag, { inicio: '2026-09-09', fim: '2026-09-10' }, 'lead').gasto, 90, 'período soma os dois dias');
eq(R.baldeDoPeriodo(ag, { inicio: '2026-09-09', fim: '2026-09-10' }, 'lead').resultados, 8, 'resultados somam');
// ⚠️ na janela semanal, campanha com um dia zerado NÃO pode entrar no radar
const agregada = R.agregarCampanhas(R.baldeDoPeriodo(ag, { inicio: '2026-09-09', fim: '2026-09-10' }, 'lead'));
eq(agregada.length, 1, 'as duas linhas viram uma campanha');
eq(agregada[0].resultados, 8, 'resultados da campanha somados');
eq(agregada.filter(k => k.resultados === 0).length, 0, 'campanha não entra no radar de desperdício');

// ── texto gerado com os dados REAIS de 10/09
// Só roda quando os dumps existem (são gerados por uma coleta manual); sem eles
// os asserts puros acima continuam valendo sozinhos.
if (!fs.existsSync('scratchpad/_campanhas.json') || !fs.existsSync('scratchpad/_google-camp.json')) {
  console.log(`OK — ${n} asserts (parte de dados reais pulada: dumps ausentes)`);
  process.exit(0);
}
const M = JSON.parse(fs.readFileSync('scratchpad/_campanhas.json', 'utf8'));
const G = JSON.parse(fs.readFileSync('scratchpad/_google-camp.json', 'utf8'));
const linhaLead = (nome, meta, b, b2) => {
  const cpl = b.resultados > 0 ? b.gasto / b.resultados : null;
  return { nome, cpl, meta, status: R.statusCpl(cpl, meta), resultados: b.resultados, resultadosAnterior: b2.resultados, gasto: b.gasto };
};
const simples = (nome, b) => ({ nome, gasto: b.gasto, cliques: b.cliques, alcance: b.alcance, impressoes: b.impressoes, resultados: b.resultados });

const leads = [], vendas = [], semCompra = [], desp = [], traf = [], brand = [], eng = [];
let mG = 0, mR = 0, mGa = 0, mRa = 0, vG = 0, vC = 0, vRc = 0, vGa = 0, vCa = 0, vRa = 0, totalMeta = 0;
const vistos = new Set();
for (const c of M.contas) {
  if (vistos.has(c.account_id)) continue;
  vistos.add(c.account_id);
  const campanhas = c.campanhas.map(k => ({ ...k, resultados: k.conversas + k.leads }));
  const d = R.agruparPorTipo({ ...c, campanhas }, k => R.classificarMeta(k.nome, k.objetivo, k.resultados, k.compras));
  const L = R.baldeDo(d, M.d1, 'lead'), L2 = R.baldeDo(d, M.d2, 'lead');
  const V = R.baldeDo(d, M.d1, 'venda'), V2 = R.baldeDo(d, M.d2, 'venda');
  for (const t of ['lead', 'venda', 'trafego', 'branding', 'engajamento']) totalMeta += R.baldeDo(d, M.d1, t).gasto;
  mG += L.gasto; mR += L.resultados; mGa += L2.gasto; mRa += L2.resultados;
  vG += V.gasto; vC += V.compras; vRc += V.receita; vGa += V2.gasto; vCa += V2.compras; vRa += V2.receita;
  if (L.gasto > 0) leads.push(linhaLead(c.name, c.cpl_meta, L, L2));
  if (V.gasto > 0) {
    const custo = V.compras > 0 ? V.gasto / V.compras : null;
    const roi = V.gasto > 0 ? V.receita / V.gasto : 0;
    const l = { nome: c.name, custo, status: R.statusCustoCompra(custo, roi), compras: V.compras, comprasAnterior: V2.compras, receita: V.receita, roi, gasto: V.gasto, conversas: V.resultados };
    (custo === null ? semCompra : vendas).push(l);
  }
  const perdidas = L.campanhas.filter(k => k.resultados === 0);
  if (perdidas.length) desp.push({ nome: c.name, gasto: perdidas.reduce((s, k) => s + k.gasto, 0), campanhas: perdidas.length, cliques: perdidas.reduce((s, k) => s + k.cliques, 0) });
  for (const [t, arr] of [['trafego', traf], ['branding', brand], ['engajamento', eng]]) {
    const b = R.baldeDo(d, M.d1, t); if (b.gasto > 0) arr.push(simples(c.name, b));
  }
}

const gL = [], gS = [], gB = [];
let gG = 0, gC = 0, gGa = 0, gCa = 0, totalGoogle = 0;
for (const c of G.contas) {
  const d = R.agruparPorTipo({ ...c, campanhas: c.campanhas.map(k => ({ ...k, resultados: k.conversoes, compras: 0, receita: 0, alcance: 0 })) },
    k => R.classificarGoogle(k.nome, k.canal, k.resultados));
  const P = R.baldeDo(d, G.d1, 'lead'), P2 = R.baldeDo(d, G.d2, 'lead');
  for (const t of ['lead', 'trafego', 'branding']) totalGoogle += R.baldeDo(d, G.d1, t).gasto;
  gG += P.gasto; gC += P.resultados; gGa += P2.gasto; gCa += P2.resultados;
  if (P.gasto > 0) { const l = linhaLead(c.name, c.cpl_meta, P, P2); if (l.cpl === null) gS.push(simples(c.name, P)); else gL.push(l); }
  for (const t of ['branding', 'trafego']) { const b = R.baldeDo(d, G.d1, t); if (b.gasto > 0) gB.push(simples(c.name, b)); }
}

const P1 = { inicio: M.d1, fim: M.d1 }, P2 = { inicio: M.d2, fim: M.d2 };
const porGasto = a => a.sort((x, y) => y.gasto - x.gasto);
const textos = {
  leads: R.montarResumoLeads({ atual: P1, anterior: P2, gasto: mG, resultados: mR, gastoAnterior: mGa, resultadosAnterior: mRa, linhas: leads, desperdicio: porGasto(desp) }),
  venda: R.montarResumoVenda({ atual: P1, anterior: P2, gasto: vG, compras: vC, receita: vRc, gastoAnterior: vGa, comprasAnterior: vCa, receitaAnterior: vRa, linhas: porGasto(vendas), semCompra: porGasto(semCompra), trafego: porGasto(traf), branding: porGasto(brand), engajamento: porGasto(eng) }),
  google: R.montarResumoGoogle({ atual: P1, anterior: P2, gasto: gG, conversoes: gC, gastoAnterior: gGa, conversoesAnterior: gCa, cplMediaMeta: mR > 0 ? mG / mR : null, linhas: gL, semConversao: porGasto(gS), branding: porGasto(gB), totalMeta, totalGoogle }),
};

for (const [rot, t] of Object.entries(textos)) {
  ok(!R.contemDataRelativa(t), `${rot} sem data relativa`);
  ok(t.length < 4000, `${rot} cabe numa mensagem (${t.length})`);
}
// Confere contra os números conferidos manualmente em 10/09.
eq((mG / mR).toFixed(2), '10.80', 'CPL geral bate');
eq((vG / vC).toFixed(2), '27.44', 'custo por compra geral bate');
eq((gG / gC).toFixed(2), '37.23', 'custo por conversão Google bate');
eq(totalMeta.toFixed(2), '3234.28', 'total Meta bate');

fs.writeFileSync('scratchpad/_textos.json', JSON.stringify(textos, null, 2));
console.log(`OK — ${n} asserts`);
console.log('tamanhos:', Object.fromEntries(Object.entries(textos).map(([k, v]) => [k, v.length])));
