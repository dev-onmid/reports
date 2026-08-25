// Leitura de planilha de contatos (contatos-arquivo.ts).
//
//   npx esbuild src/lib/contatos-arquivo.ts --outfile=scratchpad/build/contatos-arquivo.mjs --format=esm --log-level=warning
//   node scratchpad/test-contatos-arquivo.mjs

import assert from 'node:assert';
import { linhasDaPlanilha } from './build/contatos-arquivo.mjs';

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// ⚠️ Planilha de cliente vem como vier. O cabecalho e a linha sem telefone
// precisam cair fora SOZINHOS — pedir um modelo padronizado e depois processar
// o arquivo errado seria pior que nao aceitar planilha.
eq(linhasDaPlanilha([
  ['Nome do cliente', 'Celular', 'Observacao'],
  ['Maria Souza', '(43) 99999-0000', 'VIP'],
  ['João Pedro', '5511988887777', ''],
  ['Sem telefone', '', 'ignorar'],
  ['', '5543912345678', ''],
]), '(43) 99999-0000,Maria Souza\n5511988887777,João Pedro\n5543912345678',
  'cabecalho e linha sem telefone caem fora; coluna do nome e achada sozinha');

eq(linhasDaPlanilha([['5543999990000', 'Ana']]), '5543999990000,Ana',
  'telefone na primeira coluna tambem funciona');
eq(linhasDaPlanilha([['Ana', '43 9999-0000']]), '43 9999-0000,Ana',
  'ordem invertida idem');
eq(linhasDaPlanilha([['5543999990000']]), '5543999990000', 'so telefone: sem nome');
eq(linhasDaPlanilha([[], ['', '', '']]), '', 'linhas vazias somem');
eq(linhasDaPlanilha([['123', 'Ana']]), '', 'numero curto demais nao e telefone');
// Data e valor nao podem virar nome.
eq(linhasDaPlanilha([['5543999990000', '2026-08-01', '199,90']]), '5543999990000',
  'celula sem letras nunca vira nome');
eq(linhasDaPlanilha([['5543999990000', '2026-08-01', 'Ana Paula']]), '5543999990000,Ana Paula',
  'e o nome de verdade e achado mesmo depois da data');
eq(linhasDaPlanilha([null, undefined, 'texto']), '', 'linha que nao e array nao quebra');

console.log(`OK — ${n} asserts`);
