// Asserts do relatório de landing page (GA4) — parse e consolidação, sem rede.
// Compilar antes:
//   npx esbuild src/lib/ga4-landing.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build-ga4/ga4-landing.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-ga4-landing.mjs
import assert from 'node:assert/strict';
import { parseTotais, parseEventos, parseOrigens, parseLinhas, parseDiario, consolidar, faixasDoPeriodo, totaisVazios } from './build-ga4/ga4-landing.mjs';

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
    row(['date_range_0', 'click_whatsapp'], [30]), row(['date_range_0', 'click_telefone'], [10]), row(['date_range_0', 'click_cta'], [50]), row(['date_range_0', 'scroll'], [999]),
    row(['date_range_1', 'click_whatsapp'], [5]), row(['date_range_1', 'lead_form'], [2]),
  ] }, base);
  assert.equal(r.atual.whatsapp, 30); assert.equal(r.atual.telefone, 10); assert.equal(r.atual.cta, 50);
  assert.equal(r.atual.contatos, 40); assert.equal(r.atual.taxaContato, 0.2);
  assert.equal(r.anterior.contatos, 7); assert.equal(r.anterior.taxaContato, 0.07);
});
t('taxa de contato com zero sessões é 0 (não NaN/Infinity)', () => {
  const r = parseEventos({ rows: [row(['date_range_0', 'click_whatsapp'], [3])] }, parseTotais(null));
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

console.log(`${n} asserts ok`);
