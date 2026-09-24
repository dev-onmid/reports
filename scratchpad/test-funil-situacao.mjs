// Situação da coluna (linhas cinza da planilha) + Distante = perda.
// Compilar antes igual ao test-funil-etapas.mjs, depois: node scratchpad/test-funil-situacao.mjs
import assert from 'node:assert/strict';
import { classificarEtapa, situacaoDaEtapa, contarFunil, somarFunis, FUNIL_VAZIO } from './build/funil-etapas.mjs';
let n=0; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++;};
eq(classificarEtapa('Distante'), 'perdido', 'Distante = perda');
eq(classificarEtapa('Não Retorna'), 'qualificado', 'Não retorna segue engajado');
eq(situacaoDaEtapa('Não Atende'), 'tentativa', 'não atende');
eq(situacaoDaEtapa('Não Contactado'), 'tentativa', 'não contactado');
eq(situacaoDaEtapa('Ligar Depois'), 'tentativa', 'ligar depois');
eq(situacaoDaEtapa('Não Retorna'), 'parado', 'não retorna = parado');
eq(situacaoDaEtapa('Resgate'), null, 'resgate não é situação');
eq(situacaoDaEtapa('Já Teve Agendamento'), null, 'já teve agendamento não é situação');
eq(situacaoDaEtapa('Em Atendimento'), null, 'em atendimento não é situação (é o normal)');
const L = (status, extra={}) => ({ status, funnelId: null, compareceu: false, fechou: false, agendou: false, dataAgendada: null, receita: 0, ...extra });
const f = contarFunil([
  L('Não Atende'), L('Não Contactado'), L('Ligar Depois'),   // topo, tentativa → sem resposta
  L('Entrada do lead'), L('Resgate'),                          // topo, normal
  L('Engajado'), L('Em Atendimento'),                          // posto 1, em atendimento
  L('Não Retorna'),                                            // posto 1, parado
  L('Distante'), L('Sem Interesse'),                           // perdidos
  L('Agendado', { agendou: true }), L('Fechado', { fechou: true, receita: 100 }),
], []);
eq([f.contatos, f.perdidos, f.semResposta, f.emAtendimento, f.pararamResponder], [12, 2, 3, 2, 1], 'contadores da planilha');
eq([f.qualificados, f.agendamentos, f.fechamentos], [5, 2, 1], 'escada intocada (Engajado+EmAtend+NãoRetorna+Agendado+Fechado)');
const s = somarFunis([f, f]);
eq([s.semResposta, s.emAtendimento, s.pararamResponder], [6, 4, 2], 'somarFunis carrega os três');
eq(Object.keys(FUNIL_VAZIO).length, 14, 'FUNIL_VAZIO tem os 14 campos');
console.log(`OK — ${n} asserts (situação)`);
