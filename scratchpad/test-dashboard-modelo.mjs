// Testes do modelo editavel do dashboard, agora por ELEMENTO.
//
// O foco e mesclarModelo/normalizarModelo: sao as funcoes que decidem o que
// acontece quando o CODIGO muda depois de alguem ja ter salvo um modelo. Errar
// aqui produz o pior tipo de bug: metrica nova que nunca aparece, tela que tenta
// renderizar elemento morto, ou — o caso desta rodada — modelo salvo no formato
// antigo (por BLOCO) que apaga as cores ja escolhidas.
//
// Compilar antes. ⚠️ tsc por arquivo NAO serve mais: dashboard-modelo agora
// importa dashboard-elementos em runtime (ELEMENTOS gera o layout de fabrica), e
// o alias @/ ficaria sem resolver. O esbuild resolve pelo tsconfig:
//   npx esbuild scratchpad/entry-dashboard.ts --bundle --format=esm \
//     --outfile=scratchpad/build-modelo/dashboard-modelo.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-dashboard-modelo.mjs

import assert from 'node:assert';
import {
  MODELO_PADRAO_FOOD, BLOCOS_FOOD, modeloPadrao, definicaoBloco, caminhoDoElemento,
  mesclarModelo, elementosVisiveis, normalizarModelo,
} from './build-modelo/dashboard-modelo.mjs';
import {
  ELEMENTOS, LIMITE, definicaoElemento, elementosDoBloco, suporta, normalizarEstilos,
  estiloDe, elementoVisivel, textoDe, styleTexto, styleValor, styleFundo,
} from './build-modelo/dashboard-modelo.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ───────────────────────────── catalogo de elementos
eq(ELEMENTOS.length, MODELO_PADRAO_FOOD.elementos.length, 'catalogo e padrao tem os mesmos elementos');
ok(ELEMENTOS.length >= 20, 'a granularidade e por metrica, nao por bloco');

const vistos = new Set();
for (const e of ELEMENTOS) {
  ok(!vistos.has(e.id), `id duplicado no catalogo: ${e.id}`);
  vistos.add(e.id);
  ok(e.id.includes('.'), `id do elemento e "bloco.elemento": ${e.id}`);
  ok(BLOCOS_FOOD.some(b => b.id === e.bloco), `${e.id} aponta para bloco existente`);
  ok(e.w >= e.minW && e.h >= e.minH, `${e.id} nasce nao menor que o proprio minimo`);
  ok(e.x >= 0 && e.x + e.w <= 12, `${e.id} cabe nas 12 colunas`);
  ok(e.suporta.includes('visivel'), `${e.id} pode ser ocultado`);
}

// Nenhum elemento se sobrepoe a outro no layout de fabrica — sobreposicao faria
// o RGL empurrar os vizinhos assim que a tela abrisse, e o layout "de fabrica"
// nunca seria o que esta escrito aqui.
for (let i = 0; i < ELEMENTOS.length; i++) {
  for (let j = i + 1; j < ELEMENTOS.length; j++) {
    const a = ELEMENTOS[i], b = ELEMENTOS[j];
    const colide = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    ok(!colide, `${a.id} e ${b.id} se sobrepoem no layout de fabrica`);
  }
}

eq(definicaoElemento('vendas.receita').rotulo, 'Receita', 'acha elemento por id');
eq(definicaoElemento('nao.existe'), null, 'id desconhecido devolve null');
eq(elementosDoBloco('vendas').length, 5, 'vendas tem titulo + 4 metricas');
eq(suporta('vendas.receita', 'corValor'), true, 'metrica aceita cor de valor');
eq(suporta('vendas.titulo', 'corValor'), false, 'cabecalho nao tem "valor" para colorir');
eq(suporta('quando_vendem.mapa', 'texto'), false, 'grafico nao tem rotulo editavel');

// ───────────────────────────── estilos: liberdade total com sanidade
const bruto = {
  'vendas.receita': {
    texto: '  Faturamento bruto  ', corValor: '#ff0000', corTexto: 'vermelho',
    tamanhoValor: 500, tamanhoTexto: 2, tamanhoIcone: 40, icone: 'Wallet', visivel: false,
  },
  'elemento.fantasma': { corValor: '#ff0000' },
  'vendas.pedidos': 'não é objeto',
};
const est = normalizarEstilos(bruto);
eq(Object.keys(est), ['vendas.receita'], 'elemento fora do catalogo e lixo sao descartados');
eq(est['vendas.receita'].texto, 'Faturamento bruto', 'texto e aparado');
eq(est['vendas.receita'].corValor, '#ff0000', 'hex valido passa');
eq(est['vendas.receita'].corTexto, null, 'cor invalida vira null (herda o padrao), nao quebra a tela');
eq(est['vendas.receita'].tamanhoValor, LIMITE.valor[1], '500px e capado no teto de sanidade');
eq(est['vendas.receita'].tamanhoTexto, LIMITE.texto[0], '2px e elevado ao piso legivel');
eq(est['vendas.receita'].visivel, false, 'visivel:false e respeitado');
eq(normalizarEstilos(null), {}, 'nulo vira objeto vazio');
eq(normalizarEstilos('x'), {}, 'string vira objeto vazio');

eq(estiloDe({}, 'vendas.receita'), {}, 'sem estilo devolve objeto vazio, nao undefined');
eq(elementoVisivel({}, 'vendas.receita'), true, 'ausencia de estilo = visivel');
eq(elementoVisivel(est, 'vendas.receita'), false, 'oculto continua oculto');
eq(textoDe(est, 'vendas.receita', 'Receita'), 'Faturamento bruto', 'texto custom vence o de fabrica');
eq(textoDe({}, 'vendas.receita', 'Receita'), 'Receita', 'sem custom cai no de fabrica');
eq(textoDe({ 'vendas.receita': { texto: '   ' } }, 'vendas.receita', 'Receita'), 'Receita', 'texto so de espaco nao apaga o rotulo');

eq(styleTexto({}), {}, 'estilo vazio nao injeta CSS nenhum');
eq(styleValor({ tamanhoValor: 44 }), { fontSize: '44px', lineHeight: 1.05 }, 'valor grande ganha line-height, senao o glifo e cortado');
eq(styleFundo({ corFundo: '#101010' }), { backgroundColor: '#101010' }, 'fundo custom vira style inline');
eq(styleFundo({}), {}, 'sem fundo custom nao injeta nada');

// ───────────────────────────── mesclarModelo
const padrao = modeloPadrao('food');
eq(mesclarModelo(null, padrao).elementos.length, ELEMENTOS.length, 'sem modelo salvo, tudo de fabrica');

// Elemento NOVO no codigo entra com a posicao de fabrica. Sem isso, metrica nova
// ficaria invisivel para quem ja salvou um modelo.
const salvoIncompleto = {
  segmento: 'food',
  elementos: [{ id: 'vendas.receita', x: 4, y: 9, w: 5, h: 3, visivel: false }],
};
const fundido = mesclarModelo(salvoIncompleto, padrao);
eq(fundido.elementos.length, ELEMENTOS.length, 'elemento novo do codigo entra na fusao');
const receita = fundido.elementos.find(e => e.id === 'vendas.receita');
eq([receita.x, receita.y, receita.w, receita.h], [4, 9, 5, 3], 'posicao salva vence o padrao');
eq(receita.visivel, false, 'visibilidade salva vence o padrao');
const novos = fundido.elementos.find(e => e.id === 'vendas.novos');
const defNovos = definicaoElemento('vendas.novos');
eq([novos.x, novos.y], [defNovos.x, defNovos.y], 'elemento nao salvo fica na posicao de fabrica');

// Elemento que saiu do codigo e descartado — a tela nunca tenta renderizar algo
// que nao existe mais.
const comMorto = mesclarModelo(
  { segmento: 'food', elementos: [...padrao.elementos, { id: 'bloco.morto', x: 0, y: 0, w: 3, h: 2, visivel: true }] },
  padrao,
);
ok(!comMorto.elementos.some(e => e.id === 'bloco.morto'), 'elemento morto e descartado');

// Tamanho salvo nunca abaixo do minimo legivel do elemento.
const espremido = mesclarModelo(
  { segmento: 'food', elementos: [{ id: 'quando_vendem.mapa', x: 0, y: 0, w: 1, h: 1, visivel: true }] },
  padrao,
);
const mapa = espremido.elementos.find(e => e.id === 'quando_vendem.mapa');
const defMapa = definicaoElemento('quando_vendem.mapa');
eq([mapa.w, mapa.h], [defMapa.minW, defMapa.minH], 'modelo antigo nao pode espremer o mapa ate ficar ilegivel');

// ───────────────────────────── normalizarModelo
eq(normalizarModelo(null, 'food').elementos.length, ELEMENTOS.length, 'nulo cai no padrao inteiro');
eq(normalizarModelo({ elementos: 'nao e array' }, 'food').elementos.length, ELEMENTOS.length, 'lista corrompida cai no padrao');
eq(normalizarModelo({}, 'leads').elementos, [], 'lead-gen ainda nao tem editor');

// ⚠️ O caso da migracao: modelo salvo no formato ANTIGO (por bloco). As posicoes
// nao tem como ser aproveitadas, mas as CORES/textos escolhidos sim — perde-los
// silenciosamente seria a pior forma de "atualizar".
const formatoAntigo = {
  segmento: 'food',
  blocos: [{ id: 'vendas', x: 0, y: 5, w: 12, h: 3, visivel: true, titulo: 'Faturamento' }],
  estilos: { 'vendas.receita': { corValor: '#00ff00', tamanhoValor: 40 } },
};
const migrado = normalizarModelo(formatoAntigo, 'food');
eq(migrado.elementos.length, ELEMENTOS.length, 'layout volta ao de fabrica');
eq(migrado.estilos['vendas.receita'].corValor, '#00ff00', 'a cor escolhida sobrevive a migracao');
eq(migrado.estilos['vendas.receita'].tamanhoValor, 40, 'o tamanho escolhido sobrevive a migracao');

const salvoValido = normalizarModelo(
  { segmento: 'food', elementos: [{ id: 'vendas.receita', x: 2, y: 7, w: 4, h: 2, visivel: true }], estilos: {} },
  'food',
);
eq(salvoValido.elementos.find(e => e.id === 'vendas.receita').x, 2, 'posicao valida atravessa a normalizacao');

// ───────────────────────────── visiveis e rotulos
const comOculto = {
  segmento: 'food',
  elementos: [
    { id: 'vendas.receita', x: 0, y: 6, w: 3, h: 2, visivel: false },
    { id: 'vendas.pedidos', x: 3, y: 6, w: 3, h: 2, visivel: true },
    { id: 'vendas.titulo', x: 0, y: 5, w: 12, h: 1, visivel: true },
  ],
};
const vis = elementosVisiveis(comOculto);
eq(vis.map(e => e.id), ['vendas.titulo', 'vendas.pedidos'], 'oculto sai e a ordem e de leitura (cima->baixo)');

eq(definicaoBloco('vendas').rotulo, 'Vendas', 'bloco ainda rotula o agrupamento');
eq(definicaoBloco('nao_existe'), null, 'bloco desconhecido devolve null');
eq(caminhoDoElemento('vendas.receita'), 'Vendas › Receita', 'caminho legivel para o editor');
eq(caminhoDoElemento('nao.existe'), 'nao.existe', 'id desconhecido nao quebra o rotulo');

// O padrao e uma COPIA: mexer no modelo carregado nao pode contaminar a
// constante do modulo e vazar para o proximo cliente aberto.
const p1 = modeloPadrao('food');
p1.elementos[0].x = 99;
eq(modeloPadrao('food').elementos[0].x, ELEMENTOS[0].x, 'modeloPadrao devolve copia, nao a constante');

console.log(`OK — ${n} asserts`);
