// Testes da listagem por etapa (modal do Funil de Performance).
//
// O que importa aqui e a RECONCILIACAO: o total listado no modo cumulativo tem
// de ser exatamente o numero que o card mostra. Se contarFunil e leadNaEtapa
// divergirem, o usuario clica em "19" e ve outra coisa.
//
// Compilar antes (igual ao test-funil-etapas.mjs):
//   npx tsc src/lib/funil-etapas.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/funil-etapas.js scratchpad/build/funil-etapas.mjs
//   node scratchpad/test-funil-modal.mjs

import assert from 'node:assert';
import {
  contarFunil, construirMapaEtapas, etapaDoLead, leadNaEtapa, ETAPAS_PADRAO,
} from './build/funil-etapas.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const F = 'f1';
const stages = ETAPAS_PADRAO.map(e => ({ funnelId: F, label: e.label, etapa: e.etapa }));
const mapa = construirMapaEtapas(stages);

const lead = (o = {}) => ({
  status: null, funnelId: F, compareceu: false, fechou: false,
  agendou: false, dataAgendada: null, receita: 0, ...o,
});

// ------------------------------------------------------------- etapaDoLead
eq(etapaDoLead(lead({ status: 'Em Atendimento' }), mapa).posto, 1, 'em atendimento = posto 1');
eq(etapaDoLead(lead({ status: 'Agendado' }), mapa).posto, 2, 'agendado = posto 2');
eq(etapaDoLead(lead({ status: 'Comprou' }), mapa).posto, 4, 'comprou = posto 4');
eq(etapaDoLead(lead({ status: 'Desqualificado' }), mapa).perdido, true, 'desqualificado e perdido');
// Perdido segue sendo um CONTATO (piso 0) mas nao sobe nenhum degrau — e o que
// mantem a listagem de "Contatos" batendo com o card, que conta todo lead.
eq(etapaDoLead(lead({ status: 'Desqualificado' }), mapa).posto, 0, 'perdido fica no piso, sem subir degrau');
ok(!leadNaEtapa(etapaDoLead(lead({ status: 'Desqualificado' }), mapa), 'qualificado', 'alcancou'),
  'perdido nao entra em qualificado');

// Overrides dos booleanos avancam o posto mesmo com status atrasado.
eq(etapaDoLead(lead({ status: 'Em Atendimento', fechou: true }), mapa).posto, 4, 'fechou vence status');
eq(etapaDoLead(lead({ status: 'Em Atendimento', compareceu: true }), mapa).posto, 3, 'compareceu vence status');
eq(etapaDoLead(lead({ status: 'Em Atendimento', dataAgendada: '2026-08-01' }), mapa).posto, 2, 'data_agendada agenda');
// Status mais avancado que os booleanos nao regride.
eq(etapaDoLead(lead({ status: 'Comprou', agendou: true }), mapa).posto, 4, 'status avancado nao regride');

// ------------------------------------------------------------- leadNaEtapa
const fechado = etapaDoLead(lead({ status: 'Comprou' }), mapa);
ok(leadNaEtapa(fechado, 'agendamento', 'alcancou'), 'quem fechou CHEGOU em agendamento');
ok(!leadNaEtapa(fechado, 'agendamento', 'atual'), 'quem fechou nao esta PARADO em agendamento');
ok(leadNaEtapa(fechado, 'fechamento', 'atual'), 'quem fechou esta parado em fechamento');
ok(leadNaEtapa(fechado, 'contato', 'alcancou'), 'todo mundo chegou em contato');
ok(!leadNaEtapa(fechado, 'contato', 'atual'), 'quem avancou nao esta parado em contato');

const novo = etapaDoLead(lead({ status: 'Não Contactado' }), mapa);
ok(leadNaEtapa(novo, 'contato', 'atual'), 'lead cru esta parado em contato');
ok(!leadNaEtapa(novo, 'qualificado', 'alcancou'), 'lead cru nao chegou em qualificado');

// Perdido e paralelo nos DOIS modos: quem foi desqualificado depois de
// comparecer continua contando no comparecimento alcancado.
const perdidoQueCompareceu = etapaDoLead(lead({ status: 'Sem Interesse', compareceu: true }), mapa);
ok(leadNaEtapa(perdidoQueCompareceu, 'perdido', 'alcancou'), 'perdido aparece em perdido');
ok(leadNaEtapa(perdidoQueCompareceu, 'perdido', 'atual'), 'perdido independe do modo');
ok(leadNaEtapa(perdidoQueCompareceu, 'comparecimento', 'alcancou'), 'perdido que compareceu conta no comparecimento');
ok(!leadNaEtapa(perdidoQueCompareceu, 'fechamento', 'alcancou'), 'mas nao no fechamento');

// ----------------------------------------- RECONCILIACAO com contarFunil
// Base heterogenea de proposito: status crus, booleanos, perdidos, orfaos.
const base = [
  lead({ status: 'Não Contactado' }),
  lead({ status: 'Não Contactado' }),
  lead({ status: 'Em Atendimento' }),
  lead({ status: 'Em Atendimento', agendou: true }),
  lead({ status: 'Agendado' }),
  lead({ status: 'Reagendado' }),
  lead({ status: 'Agendado', compareceu: true }),
  lead({ status: 'Fechado', receita: 1000 }),
  lead({ status: 'Comprou', receita: 2500 }),
  lead({ status: 'Sem Interesse' }),
  lead({ status: 'Desqualificado', compareceu: true }),
  lead({ status: 'Status Inventado Que Nao Existe' }), // orfao -> classifica pelo texto
  lead({ status: null }),
  lead({ status: 'Em Atendimento', funnelId: null }), // legado sem funnel_id
];

const contagem = contarFunil(base, stages);
const postos = base.map(l => etapaDoLead(l, mapa));
const contarPor = (etapa, modo) => postos.filter(p => leadNaEtapa(p, etapa, modo)).length;

eq(contarPor('contato', 'alcancou'), contagem.contatos, 'reconcilia contatos');
eq(contarPor('qualificado', 'alcancou'), contagem.qualificados, 'reconcilia qualificados');
eq(contarPor('agendamento', 'alcancou'), contagem.agendamentos, 'reconcilia agendamentos');
eq(contarPor('comparecimento', 'alcancou'), contagem.comparecimentos, 'reconcilia comparecimentos');
eq(contarPor('fechamento', 'alcancou'), contagem.fechamentos, 'reconcilia fechamentos');
eq(contarPor('perdido', 'alcancou'), contagem.perdidos, 'reconcilia perdidos');

// O modo "parado aqui" particiona a base: cada lead tem exatamente um posto.
const somaAtual = ['contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento']
  .reduce((s, e) => s + contarPor(e, 'atual'), 0);
eq(somaAtual, base.length, 'os 5 degraus em modo "parado" particionam a base');

// "Parado" nunca e maior que "chegou" — subconjunto por construcao.
for (const e of ['contato', 'qualificado', 'agendamento', 'comparecimento', 'fechamento']) {
  ok(contarPor(e, 'atual') <= contarPor(e, 'alcancou'), `parados <= chegaram em ${e}`);
}

// O funil e nao-crescente: cada degrau tem no maximo o do anterior.
ok(contagem.contatos >= contagem.qualificados, 'contatos >= qualificados');
ok(contagem.qualificados >= contagem.agendamentos, 'qualificados >= agendamentos');
ok(contagem.agendamentos >= contagem.comparecimentos, 'agendamentos >= comparecimentos');
ok(contagem.comparecimentos >= contagem.fechamentos, 'comparecimentos >= fechamentos');

// ------------------------------------ cliente com funil PROPRIO (sem stages)
// Vocabulario de planilha, nenhum stage cadastrado -> classificacao pelo texto.
const mapaVazio = construirMapaEtapas([]);
const clinica = [
  { ...lead({ status: 'Avaliação Agendada' }), funnelId: null },
  { ...lead({ status: 'Avaliação Realizada' }), funnelId: null },
  { ...lead({ status: 'Avaliação Com Falta' }), funnelId: null },
];
const pClinica = clinica.map(l => etapaDoLead(l, mapaVazio));
eq(pClinica.map(p => p.posto), [2, 3, 2], 'planilha sem stage classifica pelo texto');
eq(
  pClinica.filter(p => leadNaEtapa(p, 'agendamento', 'alcancou')).length,
  contarFunil(clinica, []).agendamentos,
  'reconcilia tambem sem stages cadastrados',
);

console.log(`OK — ${n} asserts`);
