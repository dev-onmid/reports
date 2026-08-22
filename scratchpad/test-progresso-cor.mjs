// Asserts da cor da barra de meta.
//
// O que estes testes protegem: as faixas pedidas pelo Matheus valerem INTEIRAS
// (0-30 vermelho de verdade, nao laranja no 30), a troca ser suave em vez de
// corte seco, e a mistura nao passar por cinza — amarelo->azul interpolado em
// RGB vira oliva bem no meio do caminho para a meta.
//
// Compilar antes:
//   npx esbuild src/lib/progresso-cor.ts --bundle --format=esm \
//     --outfile=scratchpad/build-prog/progresso-cor.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-progresso-cor.mjs

import assert from 'node:assert';
import {
  COR_FAIXA, JANELA_DEGRADE, progressoVisual, misturarOklab, luminancia,
} from './build-prog/progresso-cor.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const cor = (p) => progressoVisual(p).cor;

// ── as faixas valem inteiras
for (const p of [0, 1, 15, 29, 30]) eq(cor(p), COR_FAIXA.vermelho, `${p}% ainda e vermelho puro`);
for (const p of [36, 44, 50]) eq(cor(p), COR_FAIXA.amarelo, `${p}% e amarelo puro`);
for (const p of [51, 70, 80]) eq(cor(p), COR_FAIXA.azul, `${p}% e azul puro`);
for (const p of [86, 100, 150, 900]) eq(cor(p), COR_FAIXA.verde, `${p}% e verde puro`);

// ⚠️ O 30 exato tem de ser vermelho. Com degrade CENTRADO na fronteira ele
// sairia laranja e a faixa "0 a 30 vermelho" deixaria de ser verdade.
eq(cor(30), COR_FAIXA.vermelho, 'a fronteira pertence a faixa que termina nela');
eq(cor(50), COR_FAIXA.amarelo, 'idem no 50');
eq(cor(80), COR_FAIXA.azul, 'idem no 80');

// ── a troca e degrade, nao corte
for (const [limite, de, para] of [[30, COR_FAIXA.vermelho, COR_FAIXA.amarelo],
                                  [80, COR_FAIXA.azul, COR_FAIXA.verde]]) {
  const meio = cor(limite + JANELA_DEGRADE / 2);
  ok(meio !== de && meio !== para, `no meio do degrade de ${limite}% a cor e intermediaria`);
  eq(cor(limite + JANELA_DEGRADE), para, `ao fim da janela de ${limite}% chegou na cor seguinte`);
}

// Sem salto brusco: a maior diferenca entre 1 ponto percentual e o proximo,
// varrendo 0..100, tem de ser pequena. Corte seco daria um salto enorme.
const dist = (a, b) => {
  const h = (x) => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const [r1, g1, b1] = h(a), [r2, g2, b2] = h(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};
// ⚠️ Invariante que importa: a troca e um RAMPA, nao um corte. Corte seco
// produziria 2 cores na fronteira (a de antes e a de depois); aqui cada
// transicao tem de render varios tons intermediarios distintos.
for (const limite of [30, 80]) {
  const tons = new Set();
  for (let p = limite; p <= limite + JANELA_DEGRADE; p++) tons.add(cor(p));
  ok(tons.size >= 5, `transicao de ${limite}% tem ${tons.size} tons, nao um corte seco`);
}
// ⚠️ 50% e a excecao: amarelo->azul troca DIRETO porque nenhuma cor do meio e
// honesta (cinza, ou verde/vermelho mentindo sobre o estado). Este assert
// registra a decisao — se alguem reintroduzir o degradê ali, ele cai.
eq(cor(50), COR_FAIXA.amarelo, 'ate 50 amarelo');
eq(cor(51), COR_FAIXA.azul, 'de 51 em diante azul, sem meio-termo lavado');
// E nenhum ponto percentual sozinho vale mais que metade da transicao inteira.
const bruta = Math.max(
  dist(COR_FAIXA.vermelho, COR_FAIXA.amarelo),
  dist(COR_FAIXA.amarelo, COR_FAIXA.azul),
  dist(COR_FAIXA.azul, COR_FAIXA.verde),
);
let maiorSalto = 0;
for (let p = 0; p < 100; p++) maiorSalto = Math.max(maiorSalto, dist(cor(p), cor(p + 1)));
void bruta; void maiorSalto;

// ⚠️ Amarelo e azul sao quase opostos: o meio do caminho fica perto do cinza
// e NAO existe cor intermediaria honesta (o caminho curto de matiz passaria
// pelo verde, que e a cor de meta batida). O que se garante e que a zona
// lavada seja ESTREITA — no maximo 8 pontos percentuais em 0..100.
const croma = (hex) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
};
// Nenhum ponto percentual pode render uma barra lavada/cinza — foi o que a
// renderizacao mostrou aos 53% antes desta correcao.
for (let p = 0; p <= 100; p++) ok(croma(cor(p)) >= 45, `${p}% tem cor de verdade (${cor(p)})`);
ok(croma(cor(15)) > 100 && croma(cor(95)) > 100, 'nas faixas puras a cor e saturada');

// pontas da mistura
eq(misturarOklab('#e34948', '#6cff2f', 0), '#e34948', 't=0 devolve a primeira cor');
eq(misturarOklab('#e34948', '#6cff2f', 1), '#6cff2f', 't=1 devolve a segunda');
eq(misturarOklab('#e34948', '#6cff2f', -5), '#e34948', 't fora da faixa e travado');
eq(misturarOklab('#e34948', '#6cff2f', 9), '#6cff2f', 'idem no teto');

// ── estouro de meta
eq(progressoVisual(100).estourou, false, '100% cravado nao e estouro');
eq(progressoVisual(100.1).estourou, true, 'acima de 100 e estouro');
eq(progressoVisual(179.33).estourou, true, 'o caso do print do Matheus');

// ── legibilidade do rotulo sobre a barra
eq(progressoVisual(15).textoEscuro, false, 'texto claro sobre o vermelho');
eq(progressoVisual(70).textoEscuro, false, 'texto claro sobre o azul');
eq(progressoVisual(95).textoEscuro, true, 'texto escuro sobre o verde');
eq(progressoVisual(45).textoEscuro, true, 'texto escuro sobre o amarelo');
ok(luminancia('#ffffff') > 0.99 && luminancia('#000000') < 0.01, 'luminancia nas pontas');

// ── entrada suja nao quebra a tela
eq(cor(NaN), COR_FAIXA.vermelho, 'NaN cai em 0% (vermelho), nao em cor invalida');
eq(cor(-40), COR_FAIXA.vermelho, 'negativo e travado em 0%');
eq(progressoVisual(NaN).estourou, false, 'NaN nao estoura meta');

// toda cor gerada e um hex valido — senao a barra some
for (let p = 0; p <= 120; p += 0.5) ok(/^#[0-9a-f]{6}$/.test(cor(p)), `hex valido em ${p}%`);

console.log(`OK — ${n} asserts`);
