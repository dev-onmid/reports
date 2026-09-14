// Testes do funil pelas ETAPAS REAIS do Kanban (funil-etapas.ts).
//
// Compilar antes:
//   npx tsc src/lib/funil-etapas.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/funil-etapas.js scratchpad/build/funil-etapas.mjs
//   node scratchpad/test-funil-por-stage.mjs

import assert from 'node:assert';
import {
  construirLadder, indiceStageDoLead, contarFunilPorStage, corDaEtapa,
  fracaoStatusReconhecido, PISO_STATUS_RECONHECIDO,
} from './build/funil-etapas.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// Kanban de clínica: 5 colunas úteis + 2 de perda, num funil só.
const F = 'f1';
const stagesClinica = [
  { funnelId: F, label: 'Novo',                position: 0, etapa: null },            // contato
  { funnelId: F, label: 'Em Atendimento',      position: 1, etapa: 'qualificado' },
  { funnelId: F, label: 'Avaliação Agendada',  position: 2, etapa: 'agendamento' },
  { funnelId: F, label: 'Avaliação Realizada', position: 3, etapa: 'comparecimento' },
  { funnelId: F, label: 'Fechado',             position: 4, etapa: 'fechamento' },
  { funnelId: F, label: 'Sem Interesse',       position: 5, etapa: 'perdido' },
  { funnelId: F, label: 'Desqualificado',      position: 6, etapa: 'perdido' },
];
const lead = (o = {}) => ({
  status: o.status ?? 'Novo', funnelId: o.funnelId ?? F,
  agendou: !!o.agendou, compareceu: !!o.compareceu, fechou: !!o.fechou,
  dataAgendada: o.dataAgendada ?? null, dataLead: o.dataLead ?? null,
  receita: o.receita ?? 0, tipo: o.tipo,
});

// ---------------------------------------------------------------- construirLadder
{
  const L = construirLadder(stagesClinica, []);
  eq(L.degraus.map(d => d.label),
    ['Novo', 'Em Atendimento', 'Avaliação Agendada', 'Avaliação Realizada', 'Fechado'],
    'ladder tira perdido e ordena por posto (aqui posto == posição)');
  eq(L.degraus.length, 5, '5 degraus (2 de perda fora)');
  // Cor = cor do DEGRAU (corDaEtapa), não a cor crua do banco.
  eq(L.degraus[0].color, corDaEtapa('contato'), 'Novo pega cor de contato');
  eq(L.degraus[4].color, corDaEtapa('fechamento'), 'Fechado pega verde do fechamento');
}

// ------------------------------------------------------------ indiceStageDoLead
{
  const L = construirLadder(stagesClinica, []);
  const idx = (o) => indiceStageDoLead(lead(o), L).idx;
  eq(idx({ status: 'Novo' }), 0, 'match direto: Novo=0');
  eq(idx({ status: 'Avaliação Agendada' }), 2, 'match direto: Agendada=2');
  eq(idx({ status: 'Fechado' }), 4, 'match direto: Fechado=4');
  // Órfão de planilha classifica e cai no degrau da etapa.
  eq(idx({ status: 'Avaliação Efetivada' }), 4, 'orfao "efetivada" -> fechamento=4');
  eq(idx({ status: 'Reagendado' }), 2, 'orfao "reagendado" -> agendamento=2');
  // Booleano só AVANÇA: status parado em Novo, mas compareceu.
  eq(idx({ status: 'Novo', compareceu: true }), 3, 'compareceu empurra p/ comparecimento=3');
  eq(idx({ status: 'Avaliação Realizada', fechou: true }), 4, 'fechou empurra p/ 4');
  // Booleano NÃO regride: já em Fechado, sem booleanos, fica em 4.
  eq(idx({ status: 'Fechado' }), 4, 'nao regride');
  // Perdido: paralelo, piso 0.
  const p = indiceStageDoLead(lead({ status: 'Sem Interesse' }), L);
  eq(p.perdido, true, 'Sem Interesse é perdido');
  eq(p.idx, 0, 'perdido sem avanço fica em contato');
  // Perdido que chegou a comparecer conta nas etapas alcançadas.
  const p2 = indiceStageDoLead(lead({ status: 'Desqualificado', compareceu: true }), L);
  eq(p2.perdido, true, 'desqualificado perdido');
  eq(p2.idx, 3, 'mas compareceu -> alcançou comparecimento');
}

// --------------------------------------------------------------- contarFunilPorStage
{
  const leads = [
    lead({ status: 'Novo' }),                                   // 0
    lead({ status: 'Em Atendimento' }),                         // 1
    lead({ status: 'Avaliação Agendada' }),                     // 2
    lead({ status: 'Avaliação Realizada' }),                    // 3
    lead({ status: 'Fechado', receita: 1000 }),                 // 4
    lead({ status: 'Sem Interesse' }),                          // perdido, idx0
  ];
  const { degraus, perdidos } = contarFunilPorStage(stagesClinica, leads);
  eq(degraus.map(d => d.alcancaram), [6, 4, 3, 2, 1], 'cumulativo não-crescente (idx 0,1,2,3,4,0)');
  eq(degraus.map(d => d.atuais), [2, 1, 1, 1, 1], 'ocupação: Novo tem 2 (1 novo + 1 perdido)');
  eq(perdidos, 1, '1 perdido');
  // Topo = todos os não-venda.
  eq(degraus[0].alcancaram, 6, 'contatos = base inteira');
}

// Registro de VENDA não entra no funil (só receita, contada alhures).
{
  const leads = [lead({ status: 'Novo' }), lead({ tipo: 'venda', receita: 500 })];
  const { degraus } = contarFunilPorStage(stagesClinica, leads);
  eq(degraus[0].alcancaram, 1, 'venda-ledger fora do funil');
}

// ------------------------------------------------- funil com etapas faltando
// Cliente que só tem Novo -> Contato feito -> Fechado (sem agendamento/comparec.)
{
  const G = 'g1';
  const st = [
    { funnelId: G, label: 'Novo',         position: 0, etapa: 'contato' },
    { funnelId: G, label: 'Contato feito', position: 1, etapa: 'qualificado' },
    { funnelId: G, label: 'Fechado',      position: 2, etapa: 'fechamento' },
  ];
  const L = construirLadder(st, []);
  eq(L.degraus.length, 3, '3 degraus');
  // Lead que "compareceu" (boolean) mas o funil não tem comparecimento:
  // cai no maior degrau até o posto de comparecimento = Contato feito (1).
  const r = indiceStageDoLead({ ...lead({ status: 'Novo', compareceu: true }), funnelId: G }, L);
  eq(r.idx, 1, 'sem etapa de comparecimento, projeta no degrau imediatamente abaixo');
}

// --------------------------------------------- escolha do funil dominante
{
  const A = 'a', B = 'b';
  const st = [
    { funnelId: A, label: 'A1', position: 0, etapa: 'contato' },
    { funnelId: A, label: 'A2', position: 1, etapa: 'fechamento' },
    { funnelId: B, label: 'B1', position: 0, etapa: 'contato' },
    { funnelId: B, label: 'B2', position: 1, etapa: 'qualificado' },
    { funnelId: B, label: 'B3', position: 2, etapa: 'fechamento' },
  ];
  // Mais leads no funil A -> escolhe A (mesmo B tendo mais etapas).
  const leadsA = [
    { ...lead({ status: 'A1' }), funnelId: A },
    { ...lead({ status: 'A1' }), funnelId: A },
    { ...lead({ status: 'B1' }), funnelId: B },
  ];
  eq(construirLadder(st, leadsA).degraus.map(d => d.label), ['A1', 'A2'], 'funil com mais leads vence');
  // Sem funnel_id em lead nenhum -> escolhe o com mais etapas (B).
  const semFid = [{ ...lead({ status: 'x' }), funnelId: null }];
  eq(construirLadder(st, semFid).degraus.map(d => d.label), ['B1', 'B2', 'B3'], 'sem lead com funil, mais etapas vence');
}

// ---------------------------------------------- board SULTS: posição ≠ funil
// Board real (CondoStore): o ganho "Contrato" fica na 3ª coluna e a cadência de
// entrada "Abordagem D1/D2" no fim. Ordenar por POSIÇÃO jogaria Contrato pro meio
// da escada; por POSTO, a escada sai monotônica e o ganho fica no fim.
{
  const S = 's1';
  const boardSults = [
    { funnelId: S, label: 'Novo lead',         position: 0,  etapa: 'contato' },
    { funnelId: S, label: 'Reunião Realizada', position: 1,  etapa: 'comparecimento' },
    { funnelId: S, label: 'Contrato',          position: 2,  etapa: 'fechamento' },
    { funnelId: S, label: 'Perca',             position: 3,  etapa: 'perdido' },
    { funnelId: S, label: 'Abordagem D1',      position: 8,  etapa: 'contato' },
    { funnelId: S, label: 'Abordagem D2',      position: 9,  etapa: 'contato' },
    { funnelId: S, label: 'Reunião Agendada',  position: 11, etapa: 'agendamento' },
    { funnelId: S, label: 'Em Atendimento',    position: 16, etapa: 'qualificado' },
  ];
  const slead = (o = {}) => ({ ...lead(o), funnelId: S });
  const L = construirLadder(boardSults, []);
  // Colunas irmãs colapsam: as 3 de contato viram 1, ordenadas por posto, ganho no fim.
  eq(L.degraus.map(d => d.label),
    ['Novo lead', 'Em Atendimento', 'Reunião Agendada', 'Reunião Realizada', 'Contrato'],
    'um degrau por etapa: entrada colapsada, ganho no fim (não uma coluna por degrau)');
  // O ganho é o ÚLTIMO degrau: fechou projeta no fim, não no meio (bug de posição).
  eq(indiceStageDoLead(slead({ status: 'Novo lead', fechou: true }), L).idx, 4,
    'fechou alcança o degrau de fechamento (Contrato, o último)');
  // Compareceu (sem fechar) para ANTES do Contrato — não conta como ganho.
  eq(indiceStageDoLead(slead({ status: 'Reunião Realizada' }), L).idx, 3,
    'comparecimento fica abaixo do fechamento');
  // "Abordagem D2" é tentativa de contato → cai no degrau de contato (o 1º), não num próprio.
  eq(indiceStageDoLead(slead({ status: 'Abordagem D2' }), L).idx, 0, 'Abordagem colapsa em contato = degrau 0');
}

// ------------------------------------------------- colapso de colunas irmãs
// Várias colunas do MESMO degrau (as 7 "Abordagem" de contato) viram UM degrau.
{
  const S = 's2';
  const board = [
    { funnelId: S, label: 'Novo lead',      position: 0, etapa: 'contato' },
    { funnelId: S, label: 'Abordagem D1',   position: 1, etapa: 'contato' },
    { funnelId: S, label: 'Abordagem D2',   position: 2, etapa: 'contato' },
    { funnelId: S, label: 'Em Atendimento', position: 3, etapa: 'qualificado' },
    { funnelId: S, label: 'Contrato',       position: 4, etapa: 'fechamento' },
  ];
  const sl = (status) => ({ ...lead({ status }), funnelId: S });
  const L = construirLadder(board, []);
  eq(L.degraus.map(d => d.label), ['Novo lead', 'Em Atendimento', 'Contrato'],
    '3 colunas de contato colapsam em 1 degrau, rotulado pela 1ª ("Novo lead")');
  eq(L.degraus.length, 3, 'um degrau por etapa presente, não por coluna');
  const r = contarFunilPorStage(board, [
    sl('Novo lead'), sl('Abordagem D1'), sl('Abordagem D2'), sl('Em Atendimento'), sl('Contrato'),
  ]);
  eq(r.degraus.map(d => d.atuais), [3, 1, 1], 'os 3 de contato ficam no MESMO degrau');
  eq(r.degraus.map(d => d.alcancaram), [5, 2, 1], 'cumulativo: 5 no topo, 2 passaram de contato');
}

// ------------------------------------------- porta: Kanban precisa REPRESENTAR
// Cliente de planilha: status importados não casam as colunas-semente. O funil
// real mentiria; o piso de reconhecimento faz cair no semântico (degraus vazios).
{
  const K = 'k1';
  const board = [
    { funnelId: K, label: 'Em Atendimento', position: 0, etapa: 'qualificado' },
    { funnelId: K, label: 'Agendado',       position: 1, etapa: 'agendamento' },
    { funnelId: K, label: 'Fechado',        position: 2, etapa: 'fechamento' },
  ];
  const klead = (status) => ({ ...lead({ status }), funnelId: K });
  // Base de planilha: quase nada casa os rótulos do board.
  const planilha = [
    klead('Não Contactado'), klead('Avaliação Realizada'), klead('Avaliação Com Falta'),
    klead(''), klead('Avaliação Efetivada'), klead('Em Atendimento'), // só 1 casa
  ];
  const L = construirLadder(board, planilha);
  ok(fracaoStatusReconhecido(L, planilha) < PISO_STATUS_RECONHECIDO,
    'planilha: reconhecimento abaixo do piso');
  eq(contarFunilPorStage(board, planilha).degraus.length, 0,
    'abaixo do piso -> vazio (chamador cai no semântico)');

  // Mesmo board, base NATIVA (status = nome da coluna): passa e conta.
  const nativa = [klead('Em Atendimento'), klead('Agendado'), klead('Fechado'), klead('Em Atendimento')];
  ok(fracaoStatusReconhecido(construirLadder(board, nativa), nativa) >= PISO_STATUS_RECONHECIDO,
    'nativa: reconhecimento acima do piso');
  const rn = contarFunilPorStage(board, nativa);
  eq(rn.degraus.length, 3, 'base nativa -> funil real vale');
  eq(rn.degraus.map(d => d.alcancaram), [4, 2, 1], 'cumulativo do funil real (2 dos 4 passam de Em Atendimento)');
}

// fracaoStatusReconhecido: venda-ledger fora da conta; sem lead -> 0.
{
  const K = 'k2';
  const board = [{ funnelId: K, label: 'Novo', position: 0, etapa: 'contato' }];
  const L = construirLadder(board, []);
  eq(fracaoStatusReconhecido(L, []), 0, 'sem lead -> 0 (não 0/0)');
  const mix = [
    { ...lead({ status: 'Novo' }), funnelId: K },
    { ...lead({ status: 'venda', tipo: 'venda' }), funnelId: K },
  ];
  eq(fracaoStatusReconhecido(L, mix), 1, 'venda não entra no denominador');
}

console.log(`OK — ${n} asserts (funil por etapa do Kanban)`);
