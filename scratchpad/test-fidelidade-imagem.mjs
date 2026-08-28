// node scratchpad/test-fidelidade-imagem.mjs
// (recompilar antes: npx esbuild src/lib/fidelidade.ts --outfile=scratchpad/build/fidelidade.mjs --format=esm)
import assert from 'node:assert/strict';
import { limparVariacoes, imagemDaVariacao, tokenDeMidiaValido } from './build/fidelidade.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

// ── token ────────────────────────────────────────────────────────────────
ok(tokenDeMidiaValido(A), '32 hex é token');
ok(!tokenDeMidiaValido('a'.repeat(31)), '31 chars não é token');
ok(!tokenDeMidiaValido('A'.repeat(32)), 'maiúscula não é token (o gerador é lowercase)');
ok(!tokenDeMidiaValido('/api/midia/' + A), 'URL inteira não é token — guardamos só o id');
ok(!tokenDeMidiaValido(null), 'null não é token');
ok(!tokenDeMidiaValido(123), 'número não é token');

// ── pareamento texto × arte ──────────────────────────────────────────────
eq(limparVariacoes(['oi', 'ola'], [A, B], null),
  [{ texto: 'oi', imagem: A }, { texto: 'ola', imagem: B }], 'par simples');

// ⚠️ O caso que motivou `limparVariacoes`: a variação DO MEIO vazia. Com dois
// arrays paralelos filtrados em separado, a arte da 3ª colaria no texto da 2ª.
eq(limparVariacoes(['oi', '', 'tchau'], [A, B, C], null),
  [{ texto: 'oi', imagem: A }, { texto: 'tchau', imagem: C }],
  'texto vazio leva a PRÓPRIA arte embora — a de C fica com "tchau", não a de B');

eq(limparVariacoes(['  ', 'so esse'], [A, B], null),
  [{ texto: 'so esse', imagem: B }], 'variação só com espaço é descartada');

eq(limparVariacoes(['a', 'b', 'c', 'd'], [A, B, C, A], null).length, 3, 'teto de 3 variações');
eq(limparVariacoes(['oi'], [], null), [{ texto: 'oi', imagem: null }], 'sem imagem nenhuma');
eq(limparVariacoes(['oi'], ['lixo'], null), [{ texto: 'oi', imagem: null }],
  'token inválido é descartado em vez de virar URL quebrada');
eq(limparVariacoes(['oi'], [A, B, C], null), [{ texto: 'oi', imagem: A }],
  'mais imagens que textos: sobra ignorada');
eq(limparVariacoes([], [A], null, { permitirVazio: true }), [],
  'rascunho sem texto não inventa variação para segurar a arte');
eq(limparVariacoes('nada', 'nada', null, { permitirVazio: true }), [], 'entrada não-array não quebra');

// Fallback de leitura antiga: sem texto e sem permitirVazio, cai no padrão do
// modelo — e padrão de fábrica não tem arte.
const padrao = limparVariacoes([], [], 'inativo');
ok(padrao.length > 0, 'linha antiga sem mensagem cai no texto de fábrica');
ok(padrao.every(v => v.imagem === null), 'texto de fábrica nunca traz arte');

// ── escolha da arte no envio ─────────────────────────────────────────────
eq(imagemDaVariacao([A, B, C], 1), B, 'cada variação usa a própria arte');
eq(imagemDaVariacao([A, null, null], 2), A,
  'uma arte só serve as três — o gestor não precisa repetir o upload');
eq(imagemDaVariacao([null, B, null], 0), B, 'cai na primeira preenchida, não na posição');
eq(imagemDaVariacao([null, null, null], 0), null, 'nenhuma arte = texto puro');
eq(imagemDaVariacao([], 0), null, 'array vazio = texto puro');
eq(imagemDaVariacao(null, 0), null, 'null = texto puro');
eq(imagemDaVariacao([A, B], 5), A, 'índice fora da faixa cai no fallback, não estoura');
eq(imagemDaVariacao(['lixo', B], 0), B, 'token inválido na posição própria cai no válido seguinte');

console.log(`ok — ${n} asserts`);
