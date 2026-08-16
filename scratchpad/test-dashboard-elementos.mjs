// Testes do estilo por elemento (dashboard-elementos.ts).
//
// "Liberdade total" foi decisao do Matheus: cor em hex livre e tamanho em px
// livre. O que NAO pode e entrada invalida virar cor impossivel, fonte de 900px
// ou elemento fantasma — e o que estes asserts guardam.
//
// Compilar antes:
//   npx tsc src/lib/dashboard-elementos.ts --outDir scratchpad/build-elem \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build-elem/dashboard-elementos.js scratchpad/build-elem/dashboard-elementos.mjs
//   node scratchpad/test-dashboard-elementos.mjs

import assert from 'node:assert';
import {
  ELEMENTOS, LIMITE, definicaoElemento, elementosDoBloco, normalizarEstilos,
  estiloDe, elementoVisivel, textoDe, ordenarElementos,
  styleTexto, styleValor, styleFundo,
} from './build-elem/dashboard-elementos.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ───────────────────────────────── catalogo
eq(new Set(ELEMENTOS.map(e => e.id)).size, ELEMENTOS.length, 'sem id de elemento duplicado');
ok(ELEMENTOS.every(e => e.id.includes('.')), 'id sempre no formato bloco.elemento');
ok(ELEMENTOS.every(e => e.id.startsWith(e.bloco + '.')), 'prefixo do id casa com o bloco');
ok(definicaoElemento('resultado.faturamento') !== null, 'faturamento existe');
eq(definicaoElemento('nao.existe'), null, 'elemento desconhecido -> null');

// O pedido central do Matheus: mexer no Faturamento sem tocar no Ticket.
const doResultado = elementosDoBloco('resultado').map(e => e.id);
ok(doResultado.includes('resultado.faturamento'), 'faturamento e endereçavel');
ok(doResultado.includes('resultado.ticket'), 'ticket e endereçavel');
ok(doResultado.length >= 3, 'bloco resultado tem titulo + 2 metricas');

// Cabecalho nao oferece "valor" — nao existe valor num titulo.
const tituloDef = definicaoElemento('vendas.titulo');
ok(!tituloDef.suporta.includes('corValor'), 'titulo nao oferece cor de valor');
ok(tituloDef.suporta.includes('icone'), 'titulo oferece troca de icone');
ok(definicaoElemento('vendas.receita').suporta.includes('corValor'), 'metrica oferece cor de valor');

// ───────────────────────────────── normalizarEstilos
eq(normalizarEstilos(null), {}, 'null -> vazio');
eq(normalizarEstilos('texto'), {}, 'string -> vazio');
eq(normalizarEstilos({ 'nao.existe': { corTexto: '#ffffff' } }), {}, 'elemento fantasma e descartado');

{
  const e = normalizarEstilos({ 'vendas.receita': {
    texto: 'Faturamento bruto', corTexto: '#ff0000', corValor: '#00FF00',
    tamanhoTexto: 18, tamanhoValor: 40, tamanhoIcone: 28, icone: 'Wallet', visivel: true,
  } })['vendas.receita'];
  eq(e.texto, 'Faturamento bruto', 'texto custom preservado');
  eq(e.corTexto, '#ff0000', 'hex minusculo aceito');
  eq(e.corValor, '#00FF00', 'hex maiusculo aceito');
  eq([e.tamanhoTexto, e.tamanhoValor, e.tamanhoIcone], [18, 40, 28], 'tamanhos preservados');
  eq(e.icone, 'Wallet', 'icone preservado');
}
{
  // Cor invalida NAO pode virar cor — vira null (herda o padrao).
  const e = normalizarEstilos({ 'vendas.receita': {
    corTexto: 'vermelho', corValor: '#GGGGGG', corIcone: '#fff', corFundo: 'rgb(1,2,3)',
  } })['vendas.receita'];
  eq([e.corTexto, e.corValor, e.corIcone, e.corFundo], [null, null, null, null], 'hex invalido -> null');
}
{
  // Liberdade total tem teto de sanidade.
  const e = normalizarEstilos({ 'vendas.receita': { tamanhoTexto: 900, tamanhoValor: 1, tamanhoIcone: -5 } })['vendas.receita'];
  eq(e.tamanhoTexto, LIMITE.texto[1], 'texto gigante e limitado ao maximo');
  eq(e.tamanhoValor, LIMITE.valor[0], 'valor minusculo sobe ao minimo');
  eq(e.tamanhoIcone, LIMITE.icone[0], 'icone negativo sobe ao minimo');
  ok(LIMITE.texto[0] >= 8, 'minimo de texto e legivel');
}
{
  const e = normalizarEstilos({ 'vendas.receita': { tamanhoTexto: 'abc', ordem: 'x' } })['vendas.receita'];
  eq(e.tamanhoTexto, null, 'tamanho nao numerico -> null');
  eq(e.ordem, null, 'ordem nao numerica -> null');
}
{
  const e = normalizarEstilos({ 'vendas.receita': { texto: 'x'.repeat(200) } })['vendas.receita'];
  eq(e.texto.length, 80, 'texto cortado em 80 chars');
}
{
  const e = normalizarEstilos({ 'vendas.receita': { texto: '   ' } })['vendas.receita'];
  eq(e.texto, null, 'texto so com espaco -> null (usa o de fabrica)');
}

// ───────────────────────────────── leitura
{
  const est = normalizarEstilos({
    'vendas.receita': { texto: 'Receita bruta' },
    'vendas.pedidos': { visivel: false },
  });
  eq(textoDe(est, 'vendas.receita', 'Receita'), 'Receita bruta', 'texto custom vence');
  eq(textoDe(est, 'vendas.ticket', 'Ticket médio'), 'Ticket médio', 'sem custom usa o de fabrica');
  eq(elementoVisivel(est, 'vendas.pedidos'), false, 'oculto respeitado');
  eq(elementoVisivel(est, 'vendas.receita'), true, 'sem flag = visivel');
  eq(elementoVisivel(est, 'nunca.tocado'), true, 'elemento nunca editado = visivel');
  eq(estiloDe(est, 'nunca.tocado'), {}, 'elemento nunca editado devolve estilo vazio');
}

// ───────────────────────────────── ordenacao
{
  const ids = ['a', 'b', 'c', 'd'];
  eq(ordenarElementos({}, ids), ids, 'sem customizacao mantem a ordem de fabrica');
}
{
  // Mover UM elemento nao pode embaralhar os outros.
  const est = { c: { ordem: 0 } };
  eq(ordenarElementos(est, ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd'], 'elemento movido vai pra frente, resto preserva ordem');
}
{
  const est = { a: { ordem: 10 } };
  eq(ordenarElementos(est, ['a', 'b', 'c']), ['b', 'c', 'a'], 'elemento empurrado pro fim');
}

// ───────────────────────────────── style inline
eq(styleTexto({}), {}, 'estilo vazio nao emite CSS (herda)');
eq(styleTexto({ corTexto: '#ff0000', tamanhoTexto: 20 }), { color: '#ff0000', fontSize: '20px' }, 'texto');
eq(styleFundo({}), {}, 'sem cor de fundo nao emite');
eq(styleFundo({ corFundo: '#101010' }), { backgroundColor: '#101010' }, 'fundo');
{
  // Valor grande precisa de line-height, senao o glifo e cortado na caixa.
  const s = styleValor({ tamanhoValor: 64 });
  eq(s.fontSize, '64px', 'tamanho do valor');
  ok(typeof s.lineHeight === 'number' && s.lineHeight <= 1.2, 'valor grande recebe line-height apertado');
  eq(styleValor({ corValor: '#abcdef' }).lineHeight, undefined, 'so cor nao mexe no line-height');
}

console.log(`OK — ${n} asserts`);
