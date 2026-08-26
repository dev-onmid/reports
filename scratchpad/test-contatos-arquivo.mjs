// Leitura de planilha de contatos (contatos-arquivo.ts).
//
//   npx esbuild src/lib/contatos-arquivo.ts --outfile=scratchpad/build/contatos-arquivo.mjs --format=esm --log-level=warning
//   node scratchpad/test-contatos-arquivo.mjs

import assert from 'node:assert';
import { linhasDaPlanilha, parseNumero, parseData } from './build/contatos-arquivo.mjs';

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const ok = (c, msg) => { assert.ok(c, msg); n++; };

// ── Sem cabecalho: telefone + nome, na ordem que vier ────────────────────────
{
  const r = linhasDaPlanilha([['5543999990000', 'Ana']]);
  eq(r.length, 1, 'linha simples entra');
  eq(r[0].telefone, '5543999990000', 'telefone');
  eq(r[0].nome, 'Ana', 'nome');
  eq(linhasDaPlanilha([['Ana', '43 9999-0000']])[0].nome, 'Ana', 'ordem invertida idem');
  eq(linhasDaPlanilha([['5543999990000']])[0].nome, null, 'so telefone: sem nome');
  eq(linhasDaPlanilha([[], ['', '', '']]).length, 0, 'linhas vazias somem');
  eq(linhasDaPlanilha([['123', 'Ana']]).length, 0, 'numero curto demais nao e telefone');
  eq(linhasDaPlanilha([['5543999990000', '2026-08-01', '199,90']])[0].nome, null,
    'celula sem letras nunca vira nome');
  eq(linhasDaPlanilha([null, undefined, 'texto']).length, 0, 'linha que nao e array nao quebra');
}

// ── Planilha COM cabecalho e historico ───────────────────────────────────────
{
  const r = linhasDaPlanilha([
    ['Nome do cliente', 'Celular', 'Qtd pedidos', 'Total gasto', 'Data do último pedido'],
    ['Maria Souza', '(43) 99999-0000', '1', 'R$ 80,00', '20/08/2026'],
    ['Bruno Lima', '5511988887777', '5', 'R$ 1.234,56', '10/07/2026'],
    ['Sem telefone', '', '2', '50', '01/01/2026'],
  ]);
  eq(r.length, 2, 'cabecalho e linha sem telefone caem fora');
  eq(r[0].nome, 'Maria Souza', 'coluna do nome pelo rotulo');
  eq(r[0].pedidos, 1, 'nº de pedidos');
  eq(r[0].totalGasto, 80, 'total gasto em R$');
  eq(r[1].totalGasto, 1234.56, '⚠️ R$ 1.234,56 e mil e duzentos, nao 1,23');
  ok(r[0].ultimaCompra.startsWith('2026-08-20'), 'dd/mm/aaaa lido como data brasileira');
}

// ── Sem cabecalho: historico NAO e adivinhado ────────────────────────────────
{
  const r = linhasDaPlanilha([['5543999990000', 'Ana', '3']]);
  eq(r[0].nome, 'Ana', 'nome ainda e achado');
  eq(r[0].pedidos, null, '⚠️ sem rotulo, "3" pode ser numero da casa — nao vira pedidos');
}

// ── Numeros nos dois formatos ────────────────────────────────────────────────
{
  eq(parseNumero('R$ 1.234,56'), 1234.56, 'formato BR');
  eq(parseNumero('1,234.56'), 1234.56, 'formato US');
  eq(parseNumero('80'), 80, 'inteiro');
  eq(parseNumero(''), null, 'vazio nao e numero');
  eq(parseNumero('abc'), null, 'texto nao e numero');
}

// ── Datas ────────────────────────────────────────────────────────────────────
{
  // ⚠️ dd/mm vem antes de mm/dd: ler 03/08 como 8 de marco jogaria o cliente
  // de "comprou semana passada" para "sumido ha cinco meses".
  ok(parseData('03/08/2026').startsWith('2026-08-03'), '03/08 e 3 de agosto');
  ok(parseData('2026-08-03').startsWith('2026-08-03'), 'ISO tambem');
  ok(parseData('01/08/26').startsWith('2026-08-01'), 'ano com 2 digitos');
  eq(parseData('nao e data'), null, 'texto nao vira data');
  eq(parseData('5'), null, '⚠️ "5" e numero de pedidos, nao serial do Excel');
  ok(parseData('46000') !== null, 'serial do Excel acima de 20000 vira data');
}

console.log(`OK — ${n} asserts`);
