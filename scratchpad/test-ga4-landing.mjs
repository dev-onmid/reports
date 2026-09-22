// Asserts do relatório de landing page (GA4) — parse e consolidação, sem rede.
// Compilar antes:
//   npx esbuild src/lib/ga4-landing.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build-ga4/ga4-landing.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-ga4-landing.mjs
import assert from 'node:assert/strict';
import { parseTotais, parseEventos, parseOrigens, parseLinhas, parseDiario, parseSeg, parseSemanaHora, parseFunil, ordenaRolagem, somaSeg, categoriaConversao, juntaConversoes, parseConvTotais, completaTotais, consolidar, faixasDoPeriodo, totaisVazios } from './build-ga4/ga4-landing.mjs';

let n = 0; const t = (nome, fn) => { fn(); n++; };
const row = (dims, mets) => ({ dimensionValues: dims.map(v => ({ value: v })), metricValues: mets.map(v => ({ value: String(v) })) });

// faixas: período atual e o anterior com o mesmo tamanho, colados
t('faixas: 30 dias → anterior termina na véspera e tem 30 dias', () => {
  const f = faixasDoPeriodo('range:2026-08-05:2026-09-03');
  assert.deepEqual(f.atual, { startDate: '2026-08-05', endDate: '2026-09-03' });
  assert.deepEqual(f.anterior, { startDate: '2026-07-06', endDate: '2026-08-04' });
});
t('faixas: 1 dia → anterior é o dia anterior', () => {
  const f = faixasDoPeriodo('range:2026-09-04:2026-09-04');
  assert.deepEqual(f.anterior, { startDate: '2026-09-03', endDate: '2026-09-03' });
});

// totais com duas faixas (dateRange vira a primeira dimensão)
t('parseTotais separa atual e anterior pelo date_range', () => {
  const r = parseTotais({ rows: [row(['date_range_0'], [120, 100, 300]), row(['date_range_1'], [80, 70, 200])] });
  assert.equal(r.atual.sessoes, 120); assert.equal(r.atual.usuarios, 100); assert.equal(r.atual.pageviews, 300);
  assert.equal(r.anterior.sessoes, 80);
});
t('parseTotais sem linhas → zeros, não quebra', () => {
  const r = parseTotais(null); assert.equal(r.atual.sessoes, 0); assert.equal(r.anterior.usuarios, 0);
});
t('parseEventos fecha contatos e taxa; evento desconhecido é ignorado', () => {
  const base = parseTotais({ rows: [row(['date_range_0'], [200, 150, 400]), row(['date_range_1'], [100, 90, 200])] });
  const r = parseEventos({ rows: [
    row(['click_whatsapp', 'date_range_0'], [30]), row(['click_telefone', 'date_range_0'], [10]), row(['click_cta', 'date_range_0'], [50]), row(['scroll', 'date_range_0'], [999]),
    row(['click_whatsapp', 'date_range_1'], [5]), row(['lead_form', 'date_range_1'], [2]),
  ] }, base);
  assert.equal(r.atual.whatsapp, 30); assert.equal(r.atual.telefone, 10); assert.equal(r.atual.cta, 50);
  assert.equal(r.atual.contatos, 40); assert.equal(r.atual.taxaContato, 0.2);
  assert.equal(r.anterior.contatos, 7); assert.equal(r.anterior.taxaContato, 0.07);
});
t('parseEventos lê a faixa pelo cabeçalho: resposta REAL do GA4 traz [eventName, dateRange]', () => {
  const rep = { dimensionHeaders: [{ name: 'eventName' }, { name: 'dateRange' }], rows: [
    row(['click_cta', 'date_range_0'], [13]), row(['click_whatsapp', 'date_range_0'], [11]), row(['click_whatsapp', 'date_range_1'], [4]),
  ] };
  const r = parseEventos(rep, parseTotais({ dimensionHeaders: [{ name: 'dateRange' }], rows: [row(['date_range_0'], [91, 79, 111])] }));
  assert.equal(r.atual.whatsapp, 11); assert.equal(r.atual.cta, 13); assert.equal(r.anterior.whatsapp, 4);
});
t('taxa de contato com zero sessões é 0 (não NaN/Infinity)', () => {
  const r = parseEventos({ rows: [row(['click_whatsapp', 'date_range_0'], [3])] }, parseTotais(null));
  assert.equal(r.atual.taxaContato, 0); assert.equal(r.atual.contatos, 3);
});

// origens, linhas, diário
t('parseOrigens ordena por sessões e rotula vazio como direto', () => {
  const r = parseOrigens({ rows: [row(['', ''], [5, 1]), row(['google', 'cpc'], [50, 9])] });
  assert.equal(r[0].origem, 'google'); assert.equal(r[0].contatos, 9);
  assert.equal(r[1].origem, '(direto)'); assert.equal(r[1].midia, '(nenhuma)');
});
t('parseLinhas tira (not set) e zeros, ordena e limita', () => {
  const r = parseLinhas({ rows: [row(['(not set)'], [99]), row(['hero'], [3]), row(['nav'], [7]), row(['rodape'], [0])] }, 1);
  assert.deepEqual(r, [{ valor: 'nav', n: 7 }]);
});
t('parseDiario converte AAAAMMDD e ordena', () => {
  const r = parseDiario({ rows: [row(['20260903'], [10, 2]), row(['20260901'], [4, 0])] });
  assert.equal(r[0].date, '2026-09-01'); assert.equal(r[1].contatos, 2);
});

// consolidação de duas LPs do mesmo cliente
const rel = (id, wa, sess) => ({
  propertyId: id, nome: `LP ${id}`,
  atual: { ...totaisVazios(), sessoes: sess, usuarios: sess, whatsapp: wa, contatos: wa, taxaContato: wa / sess },
  anterior: totaisVazios(),
  origens: [{ origem: 'google', midia: 'cpc', sessoes: sess, contatos: wa }],
  posicoes: [{ valor: 'nav', n: wa }],
  detalhes: id === '1' ? [{ param: 'peca', rotulo: 'Peças mais pedidas', linhas: [{ valor: 'Caçamba', n: wa }] }] : [{ param: 'material', rotulo: 'Materiais', linhas: [{ valor: 'Aço', n: wa }] }],
  diario: [{ date: '2026-09-01', sessoes: sess, contatos: wa }],
  pago: {
    canais: [{ valor: 'Paid Search', sessoes: sess, engajadas: sess / 2, tempo: sess * 30, conversoes: wa, sessoesConv: wa, whatsapp: wa, formulario: 1, telefone: 0 }],
    campanhas: [], palavras: [], termos: [],
    googleAds: [{ valor: 'Pesquisa', sessoes: sess, engajadas: 0, tempo: 0, conversoes: wa, sessoesConv: wa, whatsapp: wa, formulario: 1, telefone: 0, custo: 100, cliques: sess }],
  },
  audiencia: { dispositivos: [{ valor: 'mobile', sessoes: sess, engajadas: 0, tempo: 0, conversoes: wa, sessoesConv: wa, whatsapp: wa, formulario: 1, telefone: 0 }], cidades: [], novosRecorrentes: [], idades: [], generos: [], semanaHora: [{ dia: 1, hora: 10, sessoes: sess, conversoes: wa }] },
  comportamento: { paginasEntrada: [], rolagem: [{ valor: '90', n: 5 }, { valor: '25', n: 50 }], secoes: [{ valor: 'form', n: 20 }], funil: { visitantes: sess, formInicio: 10, formErro: 1, leadForm: 5, leadConfirmado: 4 }, videos: [] },
});
t('consolidar soma totais, origens, posições e diário; taxa recalculada no total', () => {
  const c = consolidar([rel('1', 10, 100), rel('2', 30, 100)]);
  assert.equal(c.atual.sessoes, 200); assert.equal(c.atual.contatos, 40); assert.equal(c.atual.taxaContato, 0.2);
  assert.deepEqual(c.origens, [{ origem: 'google', midia: 'cpc', sessoes: 200, contatos: 40 }]);
  assert.deepEqual(c.posicoes, [{ valor: 'nav', n: 40 }]);
  assert.deepEqual(c.diario, [{ date: '2026-09-01', sessoes: 200, contatos: 40 }]);
  assert.equal(c.propriedades.length, 2);
});
t('consolidar mantém só os detalhes que alguma LP preencheu, na ordem canônica', () => {
  const c = consolidar([rel('1', 10, 100), rel('2', 30, 100)]);
  assert.deepEqual(c.detalhes.map(d => d.param), ['peca', 'material']);
  assert.deepEqual(c.detalhes[1].linhas, [{ valor: 'Aço', n: 30 }]);
});
t('consolidar de uma LP só = a própria LP', () => {
  const c = consolidar([rel('1', 10, 100)]);
  assert.equal(c.atual.taxaContato, 0.1); assert.equal(c.propriedades[0].nome, 'LP 1');
});

// cortes com qualidade (tráfego pago, audiência, comportamento)
t('parseSeg: 2ª dimensão vira sub, métricas na ordem sessions/engaged/duração/keyEvents', () => {
  const r = parseSeg({ rows: [row(['[ON] Pesquisa', 'google / cpc'], [100, 60, 3000, 12, 0.08]), row(['(not set)', 'x'], [999, 0, 0, 0])] });
  assert.deepEqual(r, [{ valor: '[ON] Pesquisa', sub: 'google / cpc', sessoes: 100, engajadas: 60, tempo: 3000, conversoes: 12, sessoesConv: 8, whatsapp: 0, formulario: 0, telefone: 0 }]);
});
t('parseSeg comCusto lê custo e cliques; linha só com custo (0 sessões) fica', () => {
  const r = parseSeg({ rows: [row(['PMax'], [0, 0, 0, 0, 0, 55.5, 30])] }, { comCusto: true });
  assert.equal(r[0].custo, 55.5); assert.equal(r[0].cliques, 30);
});
t('parseSeg manterVazios guarda "(other)"/"Unassigned" dos canais', () => {
  assert.equal(parseSeg({ rows: [row(['(other)'], [5, 1, 1, 0, 0])] }, { manterVazios: true }).length, 1);
  assert.equal(parseSeg({ rows: [row(['(other)'], [5, 1, 1, 0, 0])] }).length, 0);
});
t('parseSemanaHora converte dia/hora e descarta célula vazia', () => {
  const r = parseSemanaHora({ rows: [row(['1', '15'], [59, 26]), row(['2', '3'], [0, 0])] });
  assert.deepEqual(r, [{ dia: 1, hora: 15, sessoes: 59, conversoes: 26 }]);
});
t('parseFunil soma por evento e usa visitantes do total', () => {
  const f = parseFunil({ rows: [row(['form_inicio'], [7]), row(['lead_form'], [6]), row(['lead_form_erro'], [2]), row(['lead_confirmado'], [6])] }, 79);
  assert.deepEqual(f, { visitantes: 79, formInicio: 7, formErro: 2, leadForm: 6, leadConfirmado: 6 });
});
t('ordenaRolagem põe as marcas em ordem numérica', () => {
  assert.deepEqual(ordenaRolagem([{ valor: '90', n: 1 }, { valor: '25', n: 9 }, { valor: '50', n: 5 }]).map(l => l.valor), ['25', '50', '90']);
});
t('somaSeg junta pelo par valor+sub e soma custo só onde existe', () => {
  const r = somaSeg([[{ valor: 'A', sessoes: 1, engajadas: 1, tempo: 10, conversoes: 1, sessoesConv: 1, whatsapp: 1, formulario: 0, telefone: 0, custo: 5 }], [{ valor: 'A', sessoes: 2, engajadas: 0, tempo: 5, conversoes: 0, sessoesConv: 0, whatsapp: 2, formulario: 1, telefone: 0, custo: 7 }, { valor: 'A', sub: 'x', sessoes: 9, engajadas: 0, tempo: 0, conversoes: 0, sessoesConv: 0, whatsapp: 0, formulario: 0, telefone: 0 }]]);
  assert.equal(r[0].sub, 'x'); assert.equal(r[1].sessoes, 3); assert.equal(r[1].custo, 12); assert.equal(r[1].sessoesConv, 1); assert.equal(r[1].whatsapp, 3); assert.equal(r[1].formulario, 1); assert.equal(r[0].custo, undefined);
});
t('consolidar soma pago, audiência, semana×hora e funil de duas LPs', () => {
  const c = consolidar([rel('1', 10, 100), rel('2', 30, 100)]);
  assert.equal(c.pago.googleAds[0].custo, 200); assert.equal(c.pago.canais[0].sessoes, 200);
  assert.equal(c.audiencia.dispositivos[0].conversoes, 40);
  assert.deepEqual(c.audiencia.semanaHora, [{ dia: 1, hora: 10, sessoes: 200, conversoes: 40 }]);
  assert.deepEqual(c.comportamento.rolagem.map(l => l.valor), ['25', '90']);
  assert.equal(c.comportamento.funil.leadForm, 10); assert.equal(c.comportamento.funil.visitantes, 200);
});

// WhatsApp x formulário separados
t('categoriaConversao entende nomes padrão e antigos', () => {
  const c = n => categoriaConversao(n);
  assert.equal(c('click_whatsapp'), 'whatsapp'); assert.equal(c('envio_whatsapp'), 'whatsapp'); assert.equal(c('click_whatsapp_topo'), 'whatsapp');
  assert.equal(c('lead_form'), 'formulario'); assert.equal(c('lead_confirmado'), 'formulario'); assert.equal(c('form_contato_enviado'), 'formulario');
  assert.equal(c('Solicitou_orçamento'), 'formulario'); assert.equal(c('click_telefone'), 'telefone');
  assert.equal(c('purchase'), null); assert.equal(c('lead_form_erro'), null); assert.equal(c('click_maps'), null);
});
t('juntaConversoes soma por tipo pela chave valor+sub (eventName é a última dimensão)', () => {
  const segs = parseSeg({ rows: [row(['dentista'], [815, 450, 4000, 246, 0.28]), row(['facetas'], [47, 20, 600, 0, 0])] });
  juntaConversoes(segs, { rows: [row(['dentista', 'envio_whatsapp'], [244]), row(['dentista', 'form_contato_enviado'], [2]), row(['dentista', 'purchase'], [9]), row(['nao-listada', 'envio_whatsapp'], [5])] });
  assert.equal(segs[0].whatsapp, 244); assert.equal(segs[0].formulario, 2); assert.equal(segs[1].whatsapp, 0);
  const c = parseSeg({ rows: [row(['Camp', 'google / cpc'], [10, 5, 50, 3, 0.2])] });
  juntaConversoes(c, { rows: [row(['Camp', 'google / cpc', 'lead_confirmado'], [3])] });
  assert.equal(c[0].formulario, 3);
});
t('site fora do padrão: totais vêm dos eventos-chave classificados', () => {
  const tot = parseEventos({ rows: [] }, parseTotais({ rows: [row(['date_range_0'], [2690, 2338, 3158])] }));
  const porTipo = parseConvTotais({ dimensionHeaders: [{ name: 'eventName' }, { name: 'dateRange' }], rows: [row(['envio_whatsapp', 'date_range_0'], [637]), row(['form_contato_enviado', 'date_range_0'], [8]), row(['envio_whatsapp', 'date_range_1'], [752])] });
  completaTotais(tot.atual, porTipo.atual);
  assert.equal(tot.atual.whatsapp, 637); assert.equal(tot.atual.leadForm, 8); assert.equal(tot.atual.contatos, 645);
  assert.equal(porTipo.anterior.whatsapp, 752);
});
t('site no padrão: evento padrão não é sobrescrito pelo evento-chave', () => {
  const tot = parseEventos({ rows: [row(['click_whatsapp', 'date_range_0'], [11])] }, parseTotais({ rows: [row(['date_range_0'], [91, 79, 111])] }));
  completaTotais(tot.atual, { whatsapp: 99, formulario: 6, telefone: 0 });
  assert.equal(tot.atual.whatsapp, 11); assert.equal(tot.atual.leadForm, 6);
});

console.log(`${n} asserts ok`);
