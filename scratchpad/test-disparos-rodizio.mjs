/**
 * Compile antes de rodar:
 *   npx esbuild src/lib/disparos-rodizio.ts src/lib/whatsapp-texto.ts src/lib/cardapioweb-recorrencia.ts \
 *     --outdir=scratchpad/build --format=esm --platform=node
 *   npx esbuild src/lib/disparos-chip.ts --bundle --outfile=scratchpad/build/disparos-chip.mjs \
 *     --format=esm --platform=node --external:pg
 *   node scratchpad/test-disparos-rodizio.mjs
 *
 * ⚠️ Rodar sem recompilar exercita o código ANTIGO e dá falso "OK" (lição de
 * 2026-08-11 com o test-funil-etapas).
 */
import assert from 'node:assert/strict';
import { lerImagens, gravarImagens, doRodizio, parDoRodizio, combinacoesRodizio } from './build/disparos-rodizio.mjs';
import { humanizarTexto, tirarMarcacao } from './build/whatsapp-texto.mjs';
import { pedeParaParar, chaveOptout } from './build/disparos-chip.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — veio ${JSON.stringify(a)}`); n++; };

// ─────────────────────────────── lerImagens ───────────────────────────────
eq(lerImagens(null), [], 'null vira lista vazia');
eq(lerImagens(''), [], 'vazio vira lista vazia');
eq(lerImagens('   '), [], 'só espaço vira lista vazia');
eq(lerImagens('data:image/jpeg;base64,AAA'), ['data:image/jpeg;base64,AAA'], 'string crua = uma imagem');
eq(lerImagens('["a","b","c"]'), ['a', 'b', 'c'], 'array JSON = três imagens');
eq(lerImagens('["a"]'), ['a'], 'array de um');
eq(lerImagens('["a","","  ","b"]'), ['a', 'b'], 'imagem vazia no array é descartada');
eq(lerImagens('[isso nao e json'), ['[isso nao e json'], 'começa com [ mas não é JSON: trata como string crua');
eq(lerImagens('[]'), [], 'array vazio vira lista vazia');
eq(lerImagens('[1,2]'), [], 'array de números (não-string) não entra na roda');

// ─────────────────────────── gravarImagens (par) ───────────────────────────
eq(gravarImagens([]), null, 'nenhuma imagem grava NULL');
eq(gravarImagens(['a']), 'a', 'uma imagem grava string crua');
eq(gravarImagens(['a', 'b']), '["a","b"]', 'várias gravam array JSON');
eq(gravarImagens(['a', '', '  ']), 'a', 'vazios são filtrados antes de decidir o formato');
// Round-trip: o que grava tem que voltar igual pelo leitor.
for (const caso of [[], ['a'], ['a', 'b'], ['data:image/png;base64,X', 'data:image/png;base64,Y']]) {
  eq(lerImagens(gravarImagens(caso)), caso, `round-trip de ${caso.length} imagem(ns)`);
}

// ──────────────────────────────── doRodizio ────────────────────────────────
eq(doRodizio([], 0), null, 'lista vazia não estoura');
eq(doRodizio(['a'], 0), 'a', 'uma imagem, índice 0');
eq(doRodizio(['a'], 999), 'a', 'uma imagem sempre volta ela');
eq(['a', 'b', 'c'].map((_, i) => doRodizio(['a', 'b', 'c'], i)), ['a', 'b', 'c'], 'gira na ordem');
eq(doRodizio(['a', 'b', 'c'], 3), 'a', 'volta ao começo depois da última');
eq(doRodizio(['a', 'b', 'c'], 4), 'b', 'continua girando');
eq(doRodizio(['a', 'b'], -1), 'b', 'índice negativo não quebra (vira a última)');
eq(doRodizio(['a', 'b'], NaN), 'a', 'NaN cai no índice 0 em vez de undefined');
// Campanha antiga: message_index alto e image_index zerado — a imagem começa do início.
eq(doRodizio(['x', 'y'], 0), 'x', 'image_index próprio começa do zero mesmo com message_index alto');

// ───────────────── parDoRodizio: TODOS os pares, sem repetir ───────────────
// ⚠️ O teste central desta feature. Simula os envios de verdade e exige que o
// ciclo produza textos × imagens pares DISTINTOS — 5 textos com 5 imagens têm
// que dar 25, não 5 (que era o defeito).
for (const [m, nImg] of [[5,5],[5,4],[5,3],[4,2],[6,4],[3,3],[2,2],[1,5],[5,1],[7,7],[6,6],[8,6],[9,6],[12,8],[1,1]]) {
  const vistos = new Set();
  const total = m * nImg;
  for (let i = 0; i < total; i++) {
    const { mensagem, imagem } = parDoRodizio(i, m, nImg);
    ok(mensagem >= 0 && mensagem < m, `texto dentro do intervalo (${m}x${nImg})`);
    ok(imagem >= 0 && imagem < nImg, `imagem dentro do intervalo (${m}x${nImg})`);
    vistos.add(mensagem + '|' + imagem);
  }
  eq(vistos.size, total, `${m} textos x ${nImg} imagens => ${total} pares distintos`);
  // E o ciclo tem que FECHAR: o envio seguinte repete o primeiro par.
  const p0 = parDoRodizio(0, m, nImg);
  const pN = parDoRodizio(total, m, nImg);
  eq([pN.mensagem, pN.imagem], [p0.mensagem, p0.imagem], `o ciclo fecha em ${total} (${m}x${nImg})`);
}

// O caso que originou o pedido: 5 e 5 não pode travar texto1 <-> imagem1.
const paresDe5 = [...Array(25)].map((_, i) => parDoRodizio(i, 5, 5));
const imagensDoTexto0 = new Set(paresDe5.filter(p => p.mensagem === 0).map(p => p.imagem));
eq(imagensDoTexto0.size, 5, 'o texto 1 passa por TODAS as 5 imagens (era sempre a mesma)');

// A imagem precisa trocar a cada envio — senão parece que o rodízio não anda.
let trocas = 0;
for (let i = 1; i < 25; i++) if (paresDe5[i].imagem !== paresDe5[i-1].imagem) trocas++;
eq(trocas, 24, 'a imagem muda em TODOS os envios consecutivos');

// O texto continua girando de um em um, como já girava antes.
eq(paresDe5.slice(0, 6).map(p => p.mensagem), [0,1,2,3,4,0], 'o texto mantém o giro de sempre');

// Bordas: sem imagem, índice gigante, índice inválido.
eq(parDoRodizio(10, 5, 0), { mensagem: 0, imagem: 0 }, 'sem imagem não estoura');
ok(parDoRodizio(999999, 5, 5).imagem < 5, 'índice alto (campanha antiga) continua válido');
eq(parDoRodizio(NaN, 5, 5), { mensagem: 0, imagem: 0 }, 'índice inválido cai no primeiro par');
eq(parDoRodizio(-3, 5, 5), { mensagem: 0, imagem: 0 }, 'índice negativo não gera posição fora da lista');

// ───────────────────────── combinacoesRodizio ─────────────────────────────
eq(combinacoesRodizio(5, 5), 25, '5 textos com 5 imagens = 25 combinações');
eq(combinacoesRodizio(5, 4), 20, '5 com 4 = 20');
eq(combinacoesRodizio(5, 3), 15, '5 com 3 = 15');
eq(combinacoesRodizio(4, 2), 8, '4 com 2 = 8 (antes travava em 4)');
eq(combinacoesRodizio(6, 4), 24, '6 com 4 = 24 (antes travava em 12)');
eq(combinacoesRodizio(5, 1), 5, 'uma imagem só: manda o nº de textos');
eq(combinacoesRodizio(1, 1), 1, 'um e um = um');
eq(combinacoesRodizio(5, 0), 5, 'sem imagem: só os textos');
eq(combinacoesRodizio(0, 0), 1, 'nada configurado não vira 0 nem NaN');

// ────────────────────────── pedeParaParar (opt-out) ────────────────────────
// Positivos — pedidos reais de parar.
for (const t of [
  'pare', 'PARE', 'parar', ' para ', 'Stop', 'sair', 'cancelar', 'descadastrar',
  'pare de mandar mensagem', 'para de me mandar isso', 'parem de enviar',
  'não quero receber mais nada', 'nao quero mais', 'não quero mais mensagens',
  'me tira dessa lista', 'me remova da lista por favor', 'me exclui da lista',
  'quero sair da lista', 'remover meu número', 'não me mande mais nada',
  'descadastre meu numero', 'não tenho interesse',
]) ok(pedeParaParar(t), `deve ser opt-out: "${t}"`);

// ⚠️ NEGATIVOS — é aqui que um padrão frouxo silencia cliente que quer comprar.
for (const t of [
  'quero cancelar meu pedido', 'como faço pra cancelar a compra?',
  'vou sair agora, falo depois', 'preciso sair mais cedo hoje',
  'pode parar na frente de casa?', 'o pedido parou de chegar',
  'quanto custa?', 'me manda mais informações', 'quero saber mais',
  'não quero o azul, quero o vermelho', 'tem como remover a cebola?',
  'bom dia, tudo bem?', '', '   ', null, undefined,
  'parabéns pelo trabalho', 'vocês param aos domingos?',
]) ok(!pedeParaParar(t), `NÃO deve ser opt-out: "${t}"`);

ok(!pedeParaParar('a'.repeat(400) + ' pare de mandar'), 'texto muito longo não é comando de parada');

// ─────────────────────────────── chaveOptout ───────────────────────────────
// O mesmo contato nos três formatos tem que dar a MESMA chave.
const k = chaveOptout('5543999887766');
eq(chaveOptout('43999887766'), k, 'sem DDI casa com DDI');
eq(chaveOptout('4399887766'), k, 'sem o nono dígito casa também');
eq(chaveOptout('+55 (43) 99988-7766'), k, 'formatado casa');
eq(k.length, 8, 'a chave é o sufixo de 8');
eq(chaveOptout(''), null, 'vazio não gera chave');
eq(chaveOptout('123'), null, 'curto demais não gera chave');
ok(chaveOptout('5511999887766') === k, 'ATENÇÃO (documentado): DDD diferente com mesmo sufixo colide — erra para o lado de não enviar');

// ────────────────────────── humanizarTexto (IA) ───────────────────────────
eq(humanizarTexto('Oferta _imperdível_ hoje'), 'Oferta imperdível hoje', 'tira o itálico _');
eq(humanizarTexto('É *grátis* mesmo'), 'É grátis mesmo', 'tira o negrito *');
eq(humanizarTexto('preço ~antigo~ novo'), 'preço antigo novo', 'tira o riscado ~');
eq(humanizarTexto('Olha isso — é hoje'), 'Olha isso - é hoje', 'travessão vira hífen');
eq(humanizarTexto('Corre lá…'), 'Corre lá...', 'reticências viram três pontos');
eq(humanizarTexto('- primeiro\n- segundo'), 'primeiro\nsegundo', 'tira marcador de lista');
eq(humanizarTexto('1. um\n2. dois'), 'um\ndois', 'tira item numerado');
eq(humanizarTexto('## Título\ntexto'), 'Título\ntexto', 'tira cabeçalho de markdown');
eq(humanizarTexto('fala  demais   aqui'), 'fala demais aqui', 'colapsa espaço duplo');
eq(humanizarTexto('oi , tudo bem ?'), 'oi, tudo bem?', 'tira espaço antes da pontuação');
eq(humanizarTexto('a\n\n\n\nb'), 'a\n\nb', 'no máximo uma linha em branco');
eq(humanizarTexto('“aspas” e ‘simples’'), '"aspas" e \'simples\'', 'aspas curvas viram retas');
// ⚠️ As variáveis do disparador NÃO podem ser tocadas.
eq(humanizarTexto('Oi {nome}, seu fone {telefone}'), 'Oi {nome}, seu fone {telefone}', 'preserva {nome} e {telefone}');
eq(humanizarTexto('arquivo nome_do_produto aqui'), 'arquivo nome_do_produto aqui', 'underscore no MEIO da palavra fica');
eq(tirarMarcacao('_a_ e _b_'), 'a e b', 'duas marcações na mesma linha');
eq(humanizarTexto(null), '', 'null vira string vazia');
eq(humanizarTexto('   '), '', 'só espaço vira vazio');
eq(humanizarTexto('2 * 3 = 6'), '2 * 3 = 6', 'asterisco solto com espaço não é marcação');

console.log(`\n✅ ${n} asserts passaram`);
