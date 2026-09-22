// Asserts do CAPI de site (hashes e user_data), sem rede nem banco.
// Compilar antes:
//   npx esbuild src/lib/meta-capi-site.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build-capi/meta-capi-site.mjs --tsconfig=tsconfig.json \
//     --external:pg --external:google-ads-api --external:googleapis
//   node scratchpad/test-meta-capi.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hashEmail, hashTelefone, hashNome, fbcDeFbclid, primeiroIp, montarUserData, sinais } from './build-capi/meta-capi-site.mjs';

let n = 0; const t = (nome, fn) => { fn(); n++; };
const sha = v => createHash('sha256').update(v).digest('hex');

t('e-mail: minúsculo, sem espaço, sha256 — e o inválido não vai', () => {
  assert.equal(hashEmail('  Joao@ONMID.app '), sha('joao@onmid.app'));
  assert.equal(hashEmail('não-é-email'), null);
});
t('telefone: só dígitos com DDI 55; curto demais não vai', () => {
  assert.equal(hashTelefone('(43) 99974-5480'), sha('5543999745480'));
  assert.equal(hashTelefone('+55 43 99974-5480'), sha('5543999745480'));
  assert.equal(hashTelefone('9997'), null);
});
t('nome: primeiro e último, sem acento, separados', () => {
  assert.deepEqual(hashNome('Mônica da Silva'), { fn: sha('monica'), ln: sha('silva') });
  assert.deepEqual(hashNome('Claudinéia'), { fn: sha('claudineia') });
  assert.deepEqual(hashNome('  '), {});
});
t('fbc montado do fbclid no formato da Meta', () => {
  assert.equal(fbcDeFbclid('AbC123', 1700000000000), 'fb.1.1700000000000.AbC123');
});
t('IP: só o primeiro do X-Forwarded-For', () => {
  assert.equal(primeiroIp('201.1.2.3, 172.16.0.1'), '201.1.2.3');
  assert.equal(primeiroIp(''), null);
  assert.equal(primeiroIp(null), null);
});
t('user_data completo leva os sinais que elevam a correspondência', () => {
  const u = montarUserData({ clientId: 'c', leadId: 'lead-1', eventId: 'e1', nome: 'Maria Souza',
    email: 'maria@x.com', telefone: '43999990000', cidade: 'São José', estado: 'SC',
    fbp: 'fb.1.1.2', fbclid: 'XyZ', ip: '200.1.1.1', userAgent: 'Mozilla' }, 1700000000000);
  assert.deepEqual(u.em, [sha('maria@x.com')]);
  assert.deepEqual(u.ph, [sha('5543999990000')]);
  assert.deepEqual(u.fn, [sha('maria')]); assert.deepEqual(u.ln, [sha('souza')]);
  assert.deepEqual(u.ct, [sha('saojose')]);          // sem acento e sem espaço
  assert.deepEqual(u.st, [sha('sc')]);
  assert.deepEqual(u.country, [sha('br')]);
  assert.deepEqual(u.external_id, [sha('lead-1')]);
  assert.equal(u.fbc, 'fb.1.1700000000000.XyZ');      // sem cookie, monta do fbclid
  assert.equal(u.client_ip_address, '200.1.1.1');
  assert.deepEqual(sinais(u).sort(), ['client_ip_address','client_user_agent','ct','em','external_id','fbc','fbp','fn','ln','ph','st']);
});
t('cookie _fbc real tem prioridade sobre o fbclid da URL', () => {
  const u = montarUserData({ clientId: 'c', eventId: 'e', telefone: '43999990000', fbc: 'fb.1.9.REAL', fbclid: 'OUTRO' });
  assert.equal(u.fbc, 'fb.1.9.REAL');
});
t('sem nome/cidade não inventa campo; external_id cai no telefone', () => {
  const u = montarUserData({ clientId: 'c', eventId: 'e', telefone: '43999990000' });
  assert.equal(u.fn, undefined); assert.equal(u.ct, undefined);
  assert.deepEqual(u.external_id, [sha(sha('5543999990000'))]);
});
t('nada identificável em texto puro no que sai', () => {
  const u = montarUserData({ clientId: 'c', eventId: 'e', nome: 'Maria', email: 'maria@x.com', telefone: '43999990000', cidade: 'Londrina' });
  const txt = JSON.stringify(u);
  for (const v of ['maria', 'Maria', 'maria@x.com', '43999990000', 'Londrina', 'londrina']) assert.ok(!txt.includes(v), `vazou: ${v}`);
});

console.log(`${n} asserts ok`);
