/**
 * npx esbuild src/lib/disparos-lid.ts --outdir=scratchpad/build --format=esm --platform=node --out-extension:.js=.mjs
 * node scratchpad/test-disparos-lid.mjs
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { candidatosPn, parseLidMapping, jidLid, lerLidDoDisco } from './build/disparos-lid.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, `${m} — veio ${JSON.stringify(a)}`); n++; };

// candidatosPn — as duas formas do celular brasileiro
eq(candidatosPn('5543996273051'), ['5543996273051', '554396273051'], 'com o 9 gera também a forma sem o 9');
eq(candidatosPn('554396273051'), ['554396273051', '5543996273051'], 'sem o 9 gera também a forma com o 9');
eq(candidatosPn('+55 (43) 99627-3051'), ['5543996273051', '554396273051'], 'formatado é normalizado');
eq(candidatosPn('554333334444'), ['554333334444', '5543933334444'], 'fixo (8 dígitos) ainda ganha a variante — inofensivo, só não existe arquivo');
eq(candidatosPn('14155552671'), ['14155552671'], 'estrangeiro: só a forma crua');
eq(candidatosPn(''), [], 'vazio não gera candidato');

// parseLidMapping — o formato real do Baileys é uma string JSON
eq(parseLidMapping('"209504360788187"'), '209504360788187', 'string JSON');
eq(parseLidMapping('209504360788187'), '209504360788187', 'texto cru');
eq(parseLidMapping('"abc"'), null, 'sem dígitos não é LID');
eq(parseLidMapping(''), null, 'vazio');
eq(jidLid('209504360788187'), '209504360788187@lid', 'monta o JID @lid');

// lerLidDoDisco — contra um diretório real, no formato que a Evolution grava
const dir = await mkdtemp(path.join(tmpdir(), 'evo-'));
const uuid = 'ac6e02a3-ec42-426a-99f3-52ee7dcb06db';
await mkdir(path.join(dir, uuid));
await writeFile(path.join(dir, uuid, 'lid-mapping-554396273051.json'), '"209504360788187"');
await writeFile(path.join(dir, uuid, 'lid-mapping-5567996552813.json'), '"17884344524893"');

eq((await lerLidDoDisco({ dir, instanceUuid: uuid, phone: '5543996273051' }))?.lid, '209504360788187', 'acha o arquivo SEM o 9 a partir do telefone COM o 9');
eq((await lerLidDoDisco({ dir, instanceUuid: uuid, phone: '556796552813' }))?.lid, '17884344524893', 'acha o arquivo COM o 9 a partir do telefone SEM o 9');
eq(await lerLidDoDisco({ dir, instanceUuid: uuid, phone: '5511999990000' }), null, 'número sem mapeamento devolve null, sem lançar');
eq(await lerLidDoDisco({ dir, instanceUuid: 'uuid-inexistente', phone: '5543996273051' }), null, 'instância sem diretório devolve null');

console.log(`\n✅ ${n} asserts passaram`);

// saúde da coleção regular — os três estados reais observados em produção
import { avaliarColecaoRegular } from './build/disparos-lid.mjs';
const matheusAntes = JSON.stringify({ version: 1, hash: {}, indexValueMap: { 'ZkUM': { valueMac: {} } } });
const tokiomaki = JSON.stringify({ version: 8, hash: {}, indexValueMap: Object.fromEntries([...Array(18)].map((_, i) => ['k' + i, {}])) });
eq(avaliarColecaoRegular(matheusAntes).ok, false, 'regular com 1 entrada (so a nossa) = sem sincronia');
eq(avaliarColecaoRegular(tokiomaki).ok, true, 'regular com 18 entradas = saudavel');
eq(avaliarColecaoRegular('{"version":0}').ok, false, 'sem indexValueMap = sem sincronia');
eq(avaliarColecaoRegular('nao e json').ok, false, 'lixo = ilegivel, sem lançar');
console.log(`✅ ${n} asserts passaram (com saúde)`);
