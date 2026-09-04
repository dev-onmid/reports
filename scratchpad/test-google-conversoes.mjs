// Asserts das ações de conversão do Google Ads (lib pura, sem rede).
// Compilar antes:
//   npx esbuild src/lib/google-conversion-actions.ts --bundle --format=esm --platform=node --external:pg \
//     --outfile=scratchpad/build-conv/google-conversion-actions.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-google-conversoes.mjs
import assert from 'node:assert/strict';
import { parseSendTo, normalizarNome, acharPorNome, linhaParaConversao, operacaoCriar } from './build-conv/google-conversion-actions.mjs';

let n = 0; const t = (nome, fn) => { fn(); n++; };

// parseSendTo — formatos reais do snippet do Google
t('send_to com aspas simples', () => {
  const r = parseSendTo("gtag('event', 'conversion', {'send_to': 'AW-123456789/AbCdEfGhIjKlMnOp'});");
  assert.deepEqual(r, { conversionId: 'AW-123456789', rotulo: 'AbCdEfGhIjKlMnOp', sendTo: 'AW-123456789/AbCdEfGhIjKlMnOp' });
});
t('send_to com aspas duplas e espaços', () => {
  const r = parseSendTo('gtag("event", "conversion", { "send_to" : "AW-987/xyz_-1" })');
  assert.equal(r.conversionId, 'AW-987'); assert.equal(r.rotulo, 'xyz_-1');
});
t('snippet sem send_to → vazio, não quebra', () => {
  assert.deepEqual(parseSendTo('<!-- nada -->'), { conversionId: '', rotulo: '', sendTo: '' });
  assert.deepEqual(parseSendTo(null), { conversionId: '', rotulo: '', sendTo: '' });
});
t('send_to sem rótulo (remarketing) → rótulo vazio', () => {
  assert.deepEqual(parseSendTo("{'send_to': 'AW-1'}"), { conversionId: 'AW-1', rotulo: '', sendTo: 'AW-1' });
});

// normalizarNome / acharPorNome — idempotência por nome
t('nome ignora caixa, acento e espaço duplo', () => {
  assert.equal(normalizarNome('  Lead  LP Cinfél '), 'lead lp cinfel');
});
t('acharPorNome acha variação e não acha nome diferente', () => {
  const lista = [{ nome: 'Lead - LP Cinfel' }, { nome: 'Compra' }];
  assert.equal(acharPorNome(lista, 'lead - lp CINFEL').nome, 'Lead - LP Cinfel');
  assert.equal(acharPorNome(lista, 'Lead - LP Cinfel Parts'), undefined);
});

// linhaParaConversao — shape REAL do googleAds:search
const linha = {
  conversionAction: {
    resourceName: 'customers/111/conversionActions/222', id: '222', name: 'Lead - LP', status: 'ENABLED', type: 'WEBPAGE',
    category: 'LEAD', countingType: 'ONE_PER_CLICK', primaryForGoal: true,
    tagSnippets: [
      { type: 'WEBPAGE', pageFormat: 'AMP', eventSnippet: "<amp-analytics> 'send_to': 'AW-555/amp' </amp-analytics>" },
      { type: 'WEBPAGE', pageFormat: 'HTML', eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-555/html'});" },
    ],
  },
};
t('prefere o snippet HTML ao AMP', () => {
  const c = linhaParaConversao(linha);
  assert.equal(c.sendTo, 'AW-555/html'); assert.equal(c.id, '222'); assert.equal(c.principal, true); assert.equal(c.contagem, 'ONE_PER_CLICK');
});
t('cross-account: AW- é da MCC, não do customer id (vem do snippet)', () => {
  assert.equal(linhaParaConversao(linha).conversionId, 'AW-555');
});
t('linha sem snippet → campos vazios', () => {
  const c = linhaParaConversao({ conversionAction: { id: '1', name: 'x' } });
  assert.equal(c.sendTo, ''); assert.equal(c.principal, false);
});

// operacaoCriar — payload do mutate
t('padrões: LEAD, uma por clique, principal, sem valor, BRL', () => {
  const op = operacaoCriar({ nome: '  Lead - LP Cinfel ' }).create;
  assert.equal(op.name, 'Lead - LP Cinfel'); assert.equal(op.category, 'LEAD'); assert.equal(op.countingType, 'ONE_PER_CLICK');
  assert.equal(op.primaryForGoal, true); assert.equal(op.type, 'WEBPAGE'); assert.equal(op.status, 'ENABLED');
  assert.deepEqual(op.valueSettings, { defaultValue: 0, defaultCurrencyCode: 'BRL', alwaysUseDefaultValue: false });
});
t('valor positivo entra arredondado; negativo/NaN vira 0', () => {
  assert.equal(operacaoCriar({ nome: 'a', valor: 150.456 }).create.valueSettings.defaultValue, 150.46);
  assert.equal(operacaoCriar({ nome: 'a', valor: -3 }).create.valueSettings.defaultValue, 0);
  assert.equal(operacaoCriar({ nome: 'a', valor: NaN }).create.valueSettings.defaultValue, 0);
});
t('categoria e contagem explícitas são respeitadas', () => {
  const op = operacaoCriar({ nome: 'a', categoria: 'CONTACT', contagem: 'MANY_PER_CLICK' }).create;
  assert.equal(op.category, 'CONTACT'); assert.equal(op.countingType, 'MANY_PER_CLICK');
});

console.log(`${n} asserts ok`);
