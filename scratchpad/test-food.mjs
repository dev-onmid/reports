// Testes do modo Food/Delivery: perfil por segmento + dicionario de metricas.
//
// O foco e a REGRA DE DADO AUSENTE: metrica derivada sem denominador tem de
// devolver null (renderizado "—"), nunca 0% nem 100%. Foi o bug do print 04 do
// briefing, onde CMV nao cadastrado virava margem de 100% em todas as linhas.
//
// Compilar antes:
//   npx tsc src/lib/dashboard-segmento.ts src/lib/metricas-food.ts \
//     --outDir scratchpad/build-food --module esnext --target es2022 \
//     --moduleResolution bundler --skipLibCheck
//   (renomear os .js para .mjs — ver comando no final deste cabecalho)
//   node scratchpad/test-food.mjs

import assert from 'node:assert';
import {
  normalizarSegmento, perfilDoSegmento, perfilDaSelecao, blocoVisivel,
  configDoBloco, ordemDoBloco, kpisComMetaPermitida, definicaoKpi,
} from './build-food/dashboard-segmento.mjs';
import {
  razao, calcularFaturamento, ticketMedio, conversaoCatalogo, taxaRecorrencia,
  taxaFidelidade, roas, custoPorPedido, cac, margem, tempoMedioParaPedir,
  variacao, formatarMetrica, formatarVariacao, SEM_DADO,
  cortarSerieNoUltimoDado, rotuloAtualizacao, taxaPassagem, ETAPAS_FUNIL_FOOD,
} from './build-food/metricas-food.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ───────────────────────────────────────────── segmento
eq(normalizarSegmento('food'), 'food', 'food');
eq(normalizarSegmento('delivery'), 'food', 'delivery e alias de food');
eq(normalizarSegmento('leads'), 'leads', 'leads');
eq(normalizarSegmento('branding'), 'leads', 'valor legado cai em leads');
eq(normalizarSegmento(null), 'leads', 'nulo cai em leads');
eq(normalizarSegmento(undefined), 'leads', 'ausente cai em leads');

const food = perfilDoSegmento('food');
const leads = perfilDoSegmento('leads');

// O que o briefing manda SAIR do modo food.
ok(!blocoVisivel(food, 'funil_leads'), 'food nao mostra funil de leads');
ok(blocoVisivel(leads, 'funil_leads'), 'lead-gen mostra funil de leads');
ok(blocoVisivel(food, 'funil_unificado'), 'food mostra o funil unificado');
ok(!blocoVisivel(leads, 'funil_unificado'), 'lead-gen nao mostra funil unificado');
ok(!food.kpisTopo.includes('agendamentos'), 'agendamentos some no food (sem equivalente)');
ok(leads.kpisTopo.includes('agendamentos'), 'agendamentos existe no lead-gen');
ok(!food.kpisTopo.includes('cpl'), 'CPL sai do food');
ok(food.kpisTopo.includes('custo_por_pedido'), 'e vira custo por pedido');
ok(!food.kpisTopo.includes('conversao_geral'), 'conversao geral sai do food');
ok(food.kpisTopo.includes('conversao_catalogo'), 'e vira conversao do catalogo');

// Blocos novos do food.
for (const b of ['decomposicao_receita', 'clientes_retencao', 'mix_produtos', 'campanhas_whatsapp']) {
  ok(blocoVisivel(food, b), `food tem ${b}`);
  ok(!blocoVisivel(leads, b), `lead-gen nao tem ${b}`);
}

// Comportamento de colapso pedido pelo briefing.
eq(configDoBloco(food, 'instagram')?.colapsado, true, 'instagram recolhido no food');
eq(configDoBloco(food, 'google_ads')?.autoColapsaVazio, true, 'google colapsa sozinho sem investimento');
eq(configDoBloco(leads, 'instagram')?.colapsado, undefined, 'instagram aberto no lead-gen');

// Ordem da secao 6: funil unificado e a peca central, vem antes de clientes/mix.
ok(ordemDoBloco(food, 'resultado_negocio') < ordemDoBloco(food, 'decomposicao_receita'), 'resultado antes da decomposicao');
ok(ordemDoBloco(food, 'decomposicao_receita') < ordemDoBloco(food, 'funil_unificado'), 'decomposicao antes do funil');
ok(ordemDoBloco(food, 'funil_unificado') < ordemDoBloco(food, 'clientes_retencao'), 'funil antes de clientes');
ok(ordemDoBloco(food, 'clientes_retencao') < ordemDoBloco(food, 'mix_produtos'), 'clientes antes do mix');
ok(ordemDoBloco(food, 'instagram') > ordemDoBloco(food, 'midia_paga'), 'instagram depois da midia paga');

// Selecao mista nao vira food (agregado que nao descreve nenhum dos dois).
eq(perfilDaSelecao(['food', 'food']).segmento, 'food', 'todos food -> food');
eq(perfilDaSelecao(['food', 'leads']).segmento, 'leads', 'mista -> lead-gen');
eq(perfilDaSelecao([]).segmento, 'leads', 'selecao vazia -> lead-gen');

// Metas sao cross-segmento: seguidores tem de estar disponivel mesmo no food.
const chavesComMeta = kpisComMetaPermitida().map(k => k.chave);
ok(chavesComMeta.includes('seguidores'), 'seguidores aceita meta (pedido do Matheus)');
ok(chavesComMeta.includes('faturamento') && chavesComMeta.includes('pedidos'), 'faturamento e pedidos aceitam meta');
eq(food.metasSugeridas, ['faturamento', 'pedidos'], 'food sugere ambos (resposta da Q3)');
eq(definicaoKpi('custo_por_pedido').menorMelhor, true, 'custo por pedido: menor e melhor');
eq(definicaoKpi('conversao_catalogo').formato, 'percentual', 'conversao e percentual');

// ───────────────────────────────────────────── razao / dado ausente
eq(razao(10, 0), null, 'divisao por zero -> null, nunca Infinity');
eq(razao(0, 10), 0, 'zero legitimo sobre base valida e 0');
eq(razao(10, NaN), null, 'NaN -> null');

// ───────────────────────────────────────────── faturamento
const comp = { produtos: 260, entrega: 28, servico: 15, adicionais: 8, maquineta: 6.34, descontos: 4 };
eq(calcularFaturamento(comp, ['produtos', 'entrega', 'servico', 'adicionais', 'maquineta', 'descontos']),
  260 + 28 + 15 + 8 - 6.34 - 4, 'todas as parcelas: taxas somam, maquineta e desconto subtraem');
eq(calcularFaturamento(comp, ['produtos']), 260, 'so produtos');
// O toggle precisa MUDAR o numero, senao e decorativo.
ok(calcularFaturamento(comp, ['produtos', 'entrega']) !== calcularFaturamento(comp, ['produtos']),
  'desligar componente muda o faturamento');
eq(calcularFaturamento(comp, ['descontos']), -4, 'desconto sozinho e negativo');
eq(calcularFaturamento({ produtos: 100, maquineta: -5 }, ['produtos', 'maquineta']), 95,
  'maquineta ja negativa na fonte nao vira positiva');
eq(calcularFaturamento({}, ['produtos']), 0, 'componente ausente conta zero');

// ───────────────────────────────────────────── metricas da secao 7
eq(ticketMedio(4248.7, 41), 4248.7 / 41, 'ticket medio');
eq(ticketMedio(4248.7, 0), null, 'ticket sem pedidos -> null (nao 0)');
eq(conversaoCatalogo(41, 1137), 41 / 1137, 'conversao do catalogo');
eq(conversaoCatalogo(41, 0), null, 'conversao sem visitantes -> null');
eq(taxaRecorrencia(41, 38), 41 / 38, 'recorrencia');
eq(taxaFidelidade(3, 38), 3 / 38, 'fidelidade');
eq(taxaFidelidade(3, 0), null, 'fidelidade sem clientes -> null');
eq(roas(338.88, 112.89), 338.88 / 112.89, 'roas');
eq(roas(338.88, 0), null, 'roas sem investimento -> null');
eq(custoPorPedido(112.89, 6), 112.89 / 6, 'custo por pedido');
eq(custoPorPedido(112.89, 0), null, 'custo por pedido sem pedido atribuido -> null');
eq(cac(112.89, 35), 112.89 / 35, 'cac');
eq(cac(112.89, 0), null, 'cac sem novo cliente -> null');

// ── MARGEM: o caso do print 04. Sem CMV nao existe margem 100%.
eq(margem(1000, null), null, 'CMV nulo -> null, NUNCA 100%');
eq(margem(1000, undefined), null, 'CMV ausente -> null');
ok(margem(1000, null) !== 1, 'margem sem CMV nao pode ser 1 (100%)');
eq(margem(1000, 400), 0.6, 'margem com CMV real');
eq(margem(1000, 0), 1, 'CMV explicitamente zero e custo real (100% legitimo)');
eq(margem(0, 100), null, 'receita zero -> null');

eq(tempoMedioParaPedir([60, 120, 180]), 120, 'tempo medio para pedir');
eq(tempoMedioParaPedir([]), null, 'sem amostra -> null');
eq(tempoMedioParaPedir([NaN, -5, 100]), 100, 'descarta invalido e negativo');

// ───────────────────────────────────────────── comparacao
eq(variacao(110, 100), 0.1, 'variacao +10%');
eq(variacao(90, 100), -0.1, 'variacao -10%');
eq(variacao(50, 0), null, 'sem base anterior -> null, nao +infinito');
eq(variacao(0, 100), -1, 'caiu a zero e -100% legitimo');

// ───────────────────────────────────────────── formatacao centralizada
eq(formatarMetrica(null, 'moeda'), SEM_DADO, 'null vira travessao em moeda');
eq(formatarMetrica(null, 'percentual'), SEM_DADO, 'null vira travessao em percentual');
eq(formatarMetrica(null, 'inteiro'), SEM_DADO, 'null vira travessao em inteiro');
ok(formatarMetrica(0.036, 'percentual').startsWith('3,6'), 'fracao vira 3,6%');
ok(formatarMetrica(6.02, 'multiplicador').includes('x'), 'multiplicador tem x');
ok(formatarMetrica(4248.7, 'moeda').includes('R$'), 'moeda em BRL');
eq(formatarVariacao(null), SEM_DADO, 'variacao nula vira travessao');
ok(formatarVariacao(0.123).startsWith('+'), 'variacao positiva leva sinal');

// ───────────────────────────────────────────── nao plotar futuro como zero
const serie = [{ v: 5 }, { v: 8 }, { v: 3 }, { v: null }, { v: null }];
eq(cortarSerieNoUltimoDado(serie, p => p.v !== null).length, 3, 'serie corta no ultimo dia com dado');
eq(cortarSerieNoUltimoDado([{ v: null }], p => p.v !== null).length, 0, 'serie sem dado fica vazia');

// ───────────────────────────────────────────── carimbo de sincronizacao
const agora = new Date('2026-08-12T14:00:00Z');
eq(rotuloAtualizacao(null, agora), 'nunca sincronizado', 'sem sync');
eq(rotuloAtualizacao('2026-08-12T13:30:00Z', agora), 'atualizado há 30 min', '30 min');
eq(rotuloAtualizacao('2026-08-12T11:00:00Z', agora), 'atualizado há 3h', '3 horas');
eq(rotuloAtualizacao('2026-08-10T14:00:00Z', agora), 'atualizado há 2d', '2 dias');

// ───────────────────────────────────────────── funil unificado
eq(ETAPAS_FUNIL_FOOD.length, 5, 'cinco etapas');
eq(ETAPAS_FUNIL_FOOD[2], 'visitantes_catalogo', 'visitantes e o elo do meio');
const funilCheio = { impressoes: 120824, cliques: 20824, visitantes_catalogo: 6256, pedidos: 6, receita: 338.66 };
eq(taxaPassagem(funilCheio, 'impressoes', 'cliques'), 20824 / 120824, 'CTR');
eq(taxaPassagem(funilCheio, 'visitantes_catalogo', 'pedidos'), 6 / 6256, 'conversao do catalogo');
// O elo que hoje NAO temos: sem visitantes, as taxas em volta somem — nao viram 0%.
const funilSemVisitante = { ...funilCheio, visitantes_catalogo: null };
eq(taxaPassagem(funilSemVisitante, 'cliques', 'visitantes_catalogo'), null, 'sem visitantes -> null');
eq(taxaPassagem(funilSemVisitante, 'visitantes_catalogo', 'pedidos'), null, 'sem visitantes a jusante tambem e null');
eq(taxaPassagem(funilSemVisitante, 'impressoes', 'cliques'), 20824 / 120824, 'as demais taxas seguem valendo');

console.log(`OK — ${n} asserts`);
