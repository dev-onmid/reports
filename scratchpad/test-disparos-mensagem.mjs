/**
 * Compile antes de rodar:
 *   npx esbuild src/lib/disparos-mensagem.ts --bundle --outfile=scratchpad/build/disparos-mensagem.mjs --format=esm --platform=node --alias:@=./src
 *   npx esbuild src/lib/contatos-arquivo.ts --bundle --outfile=scratchpad/build/contatos-arquivo.mjs --format=esm --platform=node --external:xlsx
 *   npx esbuild src/lib/whatsapp-texto.ts --outdir=scratchpad/build --format=esm --platform=node --out-extension:.js=.mjs
 *   node scratchpad/test-disparos-mensagem.mjs
 */
import assert from 'node:assert/strict';
import { montarMensagem, formatarNome, primeiroNomeDe, usaNome } from './build/disparos-mensagem.mjs';
import { linhasDaPlanilha } from './build/contatos-arquivo.mjs';
import { humanizarTexto } from './build/whatsapp-texto.mjs';
let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — veio ${JSON.stringify(a)}`); n++; };
const P = '5543999991111';

// caixa do nome
eq(formatarNome('MARIA APARECIDA DA SILVA'), 'Maria Aparecida da Silva', 'tudo maiúsculo vira título, partícula minúscula');
eq(formatarNome('joão dos santos'), 'João dos Santos', 'tudo minúsculo vira título');
eq(formatarNome('McDonald Souza'), 'McDonald Souza', 'caixa mista fica como digitada');
eq(formatarNome('  ana   paula  '), 'Ana Paula', 'espaços colapsados');
eq(formatarNome(''), '', 'vazio');
eq(formatarNome(null), '', 'null');
eq(formatarNome('123'), '', 'sem letra não é nome');
eq(primeiroNomeDe('MARIA APARECIDA'), 'Maria', 'primeiro nome formatado');

// montagem com nome
eq(montarMensagem('Oi {primeiro_nome}, tudo bem?', { phone: P, name: 'MARIA SILVA' }), 'Oi Maria, tudo bem?', 'primeiro_nome');
eq(montarMensagem('Oi {nome}!', { phone: P, name: 'maria silva' }), 'Oi Maria Silva!', 'nome completo formatado');
eq(montarMensagem('Seu fone {telefone}', { phone: P, name: 'X' }), `Seu fone ${P}`, 'telefone');
eq(montarMensagem('Oi  {nome} ,  olha *isso*', { phone: P, name: 'Ana' }), 'Oi  Ana ,  olha *isso*', 'com nome a mensagem sai EXATAMENTE como escrita');

// montagem SEM nome — frase recomposta
eq(montarMensagem('Oi {primeiro_nome}, tudo bem?', { phone: P, name: '' }), 'Oi, tudo bem?', 'sem nome: "Oi, tudo bem?"');
eq(montarMensagem('Olá {nome}! 😊', { phone: P, name: null }), 'Olá! 😊', 'sem nome antes de exclamação');
eq(montarMensagem('{primeiro_nome}, olha só a promo', { phone: P, name: '' }), 'Olha só a promo', 'começava com o nome: sobe a maiúscula');
eq(montarMensagem('Oi {nome} tudo bem', { phone: P, name: '' }), 'Oi tudo bem', 'espaço duplo some');
eq(montarMensagem('🌯 *Pediu um, leva dois!*\n\nOi {primeiro_nome}, corre lá', { phone: P, name: '' }), '🌯 *Pediu um, leva dois!*\n\nOi, corre lá', 'parágrafos e negrito preservados sem nome');
eq(montarMensagem('Promo de hoje, corre', { phone: P, name: '' }), 'Promo de hoje, corre', 'sem variável de nome: intacta');
eq(usaNome('Oi {primeiro_nome}'), true, 'usaNome primeiro_nome'); eq(usaNome('fone {telefone}'), false, 'usaNome falso');

// a limpeza da IA não come a variável
eq(humanizarTexto('Oi {primeiro_nome}, tudo bem?'), 'Oi {primeiro_nome}, tudo bem?', 'humanizar preserva {primeiro_nome}');
eq(humanizarTexto('_Oi_ {primeiro_nome}'), 'Oi {primeiro_nome}', 'tira itálico mas não a variável');

// planilha COMPLETA: nome antes do telefone, colunas a mais, cabeçalho
const planilha = [
  ['Nome', 'E-mail', 'Cidade', 'Telefone', 'Observação'],
  ['MARIA SILVA', 'maria@x.com', 'Londrina', '(43) 9 9999-1111', 'cliente antiga'],
  ['joão', '', 'Cambé', '43988887777', ''],
  ['', 'sem@nome.com', 'Ibiporã', '+55 43 97777-6666', ''],
  ['Sem Telefone', 'a@b.com', 'X', '', ''],
];
const lidos = linhasDaPlanilha(planilha);
eq(lidos.length, 3, 'linha sem telefone fica de fora');
eq(lidos.map(c => c.nome), ['MARIA SILVA', 'joão', null], 'acha a coluna Nome mesmo antes do telefone');
eq(lidos.map(c => c.telefone), ['(43) 9 9999-1111', '43988887777', '+55 43 97777-6666'], 'acha a coluna Telefone em qualquer posição');
const semCabecalho = linhasDaPlanilha([['Ana Paula', 'ana@x.com', '43 9 9123-4567'], ['43 9 9765-4321', 'Bruno']]);
eq(semCabecalho.map(c => [c.nome, c.telefone]), [['Ana Paula', '43 9 9123-4567'], ['Bruno', '43 9 9765-4321']], 'sem cabeçalho: telefone e nome achados pela forma');
console.log(`\n✅ ${n} asserts passaram`);
