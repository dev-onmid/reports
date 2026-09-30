// Asserts dos destinos de campanha do Google Ads (agregação pura, sem rede).
// Compilar antes:
//   npx esbuild src/lib/google-destinos.ts --bundle --format=esm --platform=node --external:pg \
//     --outfile=scratchpad/build-dest/google-destinos.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-google-destinos.mjs
import assert from 'node:assert/strict';
import { normalizarUrl, agregarDestinos, porDestino } from './build-dest/google-destinos.mjs';

let n = 0; const t = (nome, fn) => { fn(); n++; };

t('normalizarUrl tira query/fragment, barra final e caixa do host', () => {
  assert.equal(normalizarUrl('https://WWW.Saac.com.br/assistencia/?utm_source=google#x'), 'https://www.saac.com.br/assistencia');
  assert.equal(normalizarUrl('https://site.com'), 'https://site.com/');
  assert.equal(normalizarUrl('lixo sem url'), 'lixo sem url');
});

const camp = (id, name, type, urls, clicks, cost, conv) => ({ campaign: { id, name, status: 'ENABLED', advertisingChannelType: type }, adGroupAd: { ad: { finalUrls: urls } }, metrics: { clicks, costMicros: cost * 1e6, conversions: conv } });
t('agrega várias linhas da mesma campanha: URLs únicas normalizadas e métricas somadas', () => {
  const r = agregarDestinos([
    camp('1', 'Pesquisa', 'SEARCH', ['https://a.com/lp?gclid=1'], 10, 5, 1),
    camp('1', 'Pesquisa', 'SEARCH', ['https://a.com/lp/', 'https://a.com/outra'], 5, 2.5, 0.5),
  ], []);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].urls, ['https://a.com/lp', 'https://a.com/outra']);
  assert.deepEqual(r[0].hosts, ['a.com']);
  assert.equal(r[0].cliques, 15); assert.equal(r[0].custo, 7.5); assert.equal(r[0].conversoes, 1.5);
});
t('Performance Max entra pelo asset_group e ordena por custo', () => {
  const pmax = { campaign: { id: '2', name: 'PMax', status: 'ENABLED', advertisingChannelType: 'PERFORMANCE_MAX' }, assetGroup: { finalUrls: ['https://b.com/'] }, metrics: { clicks: 100, costMicros: 900e6, conversions: 9 } };
  const r = agregarDestinos([camp('1', 'Pesquisa', 'SEARCH', ['https://a.com/lp'], 10, 5, 1)], [pmax]);
  assert.deepEqual(r.map(c => c.campanha), ['PMax', 'Pesquisa']);
  assert.deepEqual(r[0].urls, ['https://b.com/']);
});
t('linha sem campaign.id é ignorada', () => {
  assert.equal(agregarDestinos([{ metrics: { clicks: 1 } }], []).length, 0);
});
t('porDestino inverte: URL → campanhas, dividindo métricas entre os destinos da campanha', () => {
  const c = agregarDestinos([camp('1', 'A', 'SEARCH', ['https://x.com/1', 'https://x.com/2'], 20, 10, 2), camp('2', 'B', 'SEARCH', ['https://x.com/1'], 30, 15, 3)], []);
  const d = porDestino(c);
  assert.equal(d[0].url, 'https://x.com/1'); assert.deepEqual(d[0].campanhas.sort(), ['A', 'B']);
  assert.equal(d[0].cliques, 40); assert.equal(d[0].custo, 20);
  assert.equal(d[1].url, 'https://x.com/2'); assert.equal(d[1].cliques, 10);
});

console.log(`${n} asserts ok`);
