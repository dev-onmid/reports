// Testes do modelo editavel do dashboard (dashboard-modelo.ts).
//
// O foco e mesclarModelo: e a funcao que decide o que acontece quando o CODIGO
// muda depois de alguem ja ter salvo um modelo. Errar aqui produz o pior tipo de
// bug: bloco novo que nunca aparece, ou tela que tenta renderizar bloco morto.
//
// Compilar antes:
//   npx tsc src/lib/dashboard-modelo.ts --outDir scratchpad/build-modelo \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build-modelo/dashboard-modelo.js scratchpad/build-modelo/dashboard-modelo.mjs
//   node scratchpad/test-dashboard-modelo.mjs

import assert from 'node:assert';
import {
  MODELO_PADRAO_FOOD, BLOCOS_FOOD, modeloPadrao, definicaoBloco, tituloDoBloco,
  mesclarModelo, blocosVisiveis, normalizarModelo,
} from './build-modelo/dashboard-modelo.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ───────────────────────────────── catalogo
eq(BLOCOS_FOOD.length, MODELO_PADRAO_FOOD.blocos.length, 'catalogo e padrao tem os mesmos blocos');
for (const b of MODELO_PADRAO_FOOD.blocos) {
  ok(definicaoBloco(b.id) !== null, `bloco ${b.id} do padrao existe no catalogo`);
}
eq(new Set(BLOCOS_FOOD.map(b => b.id)).size, BLOCOS_FOOD.length, 'sem id duplicado no catalogo');
eq(modeloPadrao('leads').blocos, [], 'lead-gen ainda nao tem editor');
eq(modeloPadrao('food').blocos.length, 7, 'food tem 7 blocos');

// Nenhum bloco do padrao nasce menor que o proprio minimo.
for (const b of MODELO_PADRAO_FOOD.blocos) {
  const d = definicaoBloco(b.id);
  ok(b.w >= d.minW, `${b.id}: largura padrao >= minima`);
  ok(b.h >= d.minH, `${b.id}: altura padrao >= minima`);
}

// ───────────────────────────────── titulo
eq(tituloDoBloco({ id: 'vendas', visivel: true }), 'Vendas', 'sem titulo custom usa o de fabrica');
eq(tituloDoBloco({ id: 'vendas', titulo: 'Faturamento da loja', visivel: true }), 'Faturamento da loja', 'titulo custom vence');
eq(tituloDoBloco({ id: 'vendas', titulo: '   ', visivel: true }), 'Vendas', 'titulo so com espaco cai no de fabrica');

// ───────────────────────────────── mesclarModelo
{
  // Posicao salva vence o padrao.
  const salvo = { segmento: 'food', blocos: [{ id: 'vendas', x: 6, y: 20, w: 6, h: 4, visivel: true }] };
  const m = mesclarModelo(salvo, MODELO_PADRAO_FOOD);
  const v = m.blocos.find(b => b.id === 'vendas');
  eq([v.x, v.y, v.w, v.h], [6, 20, 6, 4], 'posicao e tamanho salvos vencem');
  eq(m.blocos.length, 7, 'os outros blocos continuam presentes');
}
{
  // ⚠️ O caso mais importante: bloco NOVO no codigo, modelo antigo salvo.
  const antigo = { segmento: 'food', blocos: [{ id: 'vendas', x: 0, y: 0, w: 12, h: 3, visivel: true }] };
  const m = mesclarModelo(antigo, MODELO_PADRAO_FOOD);
  eq(m.blocos.length, 7, 'blocos novos do codigo ENTRAM, nao somem');
  const novo = m.blocos.find(b => b.id === 'recorrencia');
  ok(novo && novo.visivel, 'bloco novo entra visivel');
  eq([novo.x, novo.y], [5, 13], 'bloco novo entra na posicao de fabrica');
}
{
  // Bloco que saiu do codigo tem de ser descartado.
  const comFantasma = {
    segmento: 'food',
    blocos: [
      { id: 'vendas', x: 0, y: 0, w: 12, h: 3, visivel: true },
      { id: 'bloco_que_nao_existe_mais', x: 0, y: 9, w: 12, h: 4, visivel: true },
    ],
  };
  const m = mesclarModelo(comFantasma, MODELO_PADRAO_FOOD);
  ok(!m.blocos.some(b => b.id === 'bloco_que_nao_existe_mais'), 'bloco morto e descartado');
  eq(m.blocos.length, 7, 'e nao encolhe o resto');
}
{
  // Modelo antigo nao pode espremer bloco abaixo do minimo legivel.
  const espremido = { segmento: 'food', blocos: [{ id: 'quando_vendem', x: 0, y: 0, w: 1, h: 1, visivel: true }] };
  const m = mesclarModelo(espremido, MODELO_PADRAO_FOOD);
  const b = m.blocos.find(x => x.id === 'quando_vendem');
  const d = definicaoBloco('quando_vendem');
  eq([b.w, b.h], [d.minW, d.minH], 'tamanho salvo e elevado ao minimo do bloco');
}
{
  // Ocultar persiste; e `visivel` ausente conta como visivel (modelo legado).
  const m = mesclarModelo({ segmento: 'food', blocos: [
    { id: 'ritmo', x: 0, y: 0, w: 5, h: 5, visivel: false },
    { id: 'vendas', x: 0, y: 0, w: 12, h: 3 },
  ] }, MODELO_PADRAO_FOOD);
  eq(m.blocos.find(b => b.id === 'ritmo').visivel, false, 'oculto persiste');
  eq(m.blocos.find(b => b.id === 'vendas').visivel, true, 'visivel ausente = visivel');
}
eq(mesclarModelo(null, MODELO_PADRAO_FOOD).blocos.length, 7, 'sem nada salvo devolve o padrao inteiro');
eq(mesclarModelo(undefined, MODELO_PADRAO_FOOD).blocos.length, 7, 'undefined idem');

// ───────────────────────────────── blocosVisiveis
{
  const m = mesclarModelo({ segmento: 'food', blocos: [{ id: 'kpis', x: 0, y: 3, w: 12, h: 2, visivel: false }] }, MODELO_PADRAO_FOOD);
  const vis = blocosVisiveis(m);
  eq(vis.length, 6, 'oculto sai da renderizacao');
  ok(!vis.some(b => b.id === 'kpis'), 'e nao e o errado que saiu');
  // Ordem de leitura: cima->baixo, esquerda->direita.
  const ys = vis.map(b => b.y);
  eq(ys, [...ys].sort((a, b) => a - b), 'ordenado por y');
  eq(vis[0].id, 'resultado', 'primeiro bloco e o hero');
}

// ───────────────────────────────── normalizarModelo (entrada do banco/rede)
eq(normalizarModelo(null, 'food').blocos.length, 7, 'null -> padrao');
eq(normalizarModelo('texto', 'food').blocos.length, 7, 'string -> padrao');
eq(normalizarModelo({}, 'food').blocos.length, 7, 'objeto sem blocos -> padrao');
eq(normalizarModelo({ blocos: 'nao e array' }, 'food').blocos.length, 7, 'blocos invalido -> padrao');
{
  const m = normalizarModelo({ blocos: [
    { id: 'vendas', x: 3, y: 7, w: 9, h: 4, visivel: true },
    { id: 'invalido', x: 0, y: 0, w: 12, h: 3, visivel: true },
    null,
    'lixo',
  ] }, 'food');
  eq(m.blocos.length, 7, 'entradas invalidas sao descartadas, padrao completa');
  const v = m.blocos.find(b => b.id === 'vendas');
  eq([v.x, v.y, v.w, v.h], [3, 7, 9, 4], 'entrada valida e preservada');
}
{
  const longo = 'x'.repeat(200);
  const m = normalizarModelo({ blocos: [{ id: 'vendas', x: 0, y: 0, w: 12, h: 3, visivel: true, titulo: longo }] }, 'food');
  eq(m.blocos.find(b => b.id === 'vendas').titulo.length, 60, 'titulo e cortado em 60 chars');
}

console.log(`OK — ${n} asserts`);
