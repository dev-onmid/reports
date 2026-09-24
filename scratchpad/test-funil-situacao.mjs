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
eq(Object.keys(FUNIL_VAZIO).length, 15, 'FUNIL_VAZIO tem os 15 campos (com naoLeads)');
console.log(`OK — ${n} asserts (situação)`);

// ── Fase 3: situação gravada na COLUNA (dropdown composto do editor) ─────────
import { situacaoEfetiva, valorOpcaoEditor, opcaoDoValor, OPCOES_EDITOR, situacaoDoLead, construirMapaEtapas } from './build/funil-etapas.mjs';
eq(situacaoEfetiva('nenhuma', 'Não Atende'), null, "'nenhuma' cala a regex do rótulo");
eq(situacaoEfetiva('parado', 'Frio'), 'parado', 'explícita vence um rótulo sem regex');
eq(situacaoEfetiva(null, 'Não Atende'), 'tentativa', 'NULL cai na auto-classificação');
eq(situacaoEfetiva(undefined, 'Em Atendimento'), null, 'ausente + rótulo neutro = nada');
const stagesF3 = [
  { funnelId: 'f', label: 'Frio', etapa: 'qualificado', situacao: 'parado' },
  { funnelId: 'f', label: 'Não Atende', etapa: 'contato', situacao: 'nenhuma' },
  { funnelId: 'f', label: 'Ligar Depois', etapa: 'contato', situacao: null },
];
const mapaF3 = construirMapaEtapas(stagesF3);
eq(situacaoDoLead({ status: 'Frio', funnelId: 'f' }, mapaF3), 'parado', 'lead herda a situação explícita da coluna');
eq(situacaoDoLead({ status: 'Não Atende', funnelId: 'f' }, mapaF3), null, "coluna 'nenhuma' cala a regex no lead");
eq(situacaoDoLead({ status: 'Ligar Depois', funnelId: 'f' }, mapaF3), 'tentativa', 'coluna NULL → regex');
eq(situacaoDoLead({ status: 'Não Contactado', funnelId: 'g' }, mapaF3), 'tentativa', 'status sem coluna cadastrada → regex no texto cru');
const f3 = contarFunil([
  L('Frio', { funnelId: 'f' }), L('Não Atende', { funnelId: 'f' }), L('Ligar Depois', { funnelId: 'f' }),
], stagesF3);
eq([f3.contatos, f3.qualificados, f3.semResposta, f3.pararamResponder, f3.emAtendimento], [3, 1, 1, 1, 0], 'contarFunil lê a situação da coluna (Frio=parado, Não Atende calada, Ligar Depois pela regex)');
eq(OPCOES_EDITOR.length, 9, '6 graus + 2 compostas + Não lead');
eq(OPCOES_EDITOR.map(o => o.valor), ['contato', 'contato:tentativa', 'qualificado', 'qualificado:parado', 'agendamento', 'comparecimento', 'fechamento', 'perdido', 'nao_lead'], 'ordem das opções');
eq(valorOpcaoEditor('contato', 'tentativa', 'x'), 'contato:tentativa', 'explícito composto');
eq(valorOpcaoEditor(null, null, 'Não Atende'), 'contato:tentativa', 'auto: grau e situação pelo nome');
eq(valorOpcaoEditor(null, null, 'Não Retorna'), 'qualificado:parado', 'auto: Não Retorna = qualificado · parado');
eq(valorOpcaoEditor('agendamento', 'tentativa', 'x'), 'agendamento', 'situação fora do grau cai no grau puro');
eq(valorOpcaoEditor('contato', 'nenhuma', 'Não Atende'), 'contato', "'nenhuma' explícito vence o nome");
eq(opcaoDoValor('qualificado:parado'), { etapa: 'qualificado', situacao: 'parado' }, 'valor composto → grau + situação');
eq(opcaoDoValor('fechamento'), { etapa: 'fechamento', situacao: 'nenhuma' }, "grau puro → situação 'nenhuma' (persistida, não NULL)");
eq(opcaoDoValor('lixo'), { etapa: 'contato', situacao: 'nenhuma' }, 'valor desconhecido cai no padrão');
console.log(`OK — ${n} asserts (situação + fase 3)`);

// ── "Não lead" (Paciente / já é cliente): fora de toda contagem, salvo com rastro ─
import { leadNaEtapa, etapaDoLead, contarFunilPorStage, ETAPAS_PADRAO, OPCOES_EDITOR as OPC2 } from './build/funil-etapas.mjs';
eq(classificarEtapa('Não Lead'), 'nao_lead', 'Não Lead');
eq(classificarEtapa('Já sou cliente'), 'nao_lead', 'já sou cliente');
eq(classificarEtapa('Fechado'), 'fechamento', 'Fechado segue fechamento');
// "Paciente" saiu do padrao em 2026-09-24 (virou generico); quem carrega o grau
// agora e "Nao e Lead". A classificacao de "Paciente" por TEXTO segue valendo —
// e o que cobre cliente de clinica que ja tem a coluna criada.
eq(ETAPAS_PADRAO.find(e => e.label === 'Não é Lead').etapa, 'nao_lead', 'semente Não é Lead = não lead');
eq(classificarEtapa('Paciente'), 'nao_lead', 'Paciente segue fora da contagem pelo texto');
const fNL = contarFunil([
  L('Paciente'), L('Paciente', { fechou: true, receita: 500 }),          // sem rastro: fora, mesmo com "fechou"
  L('Paciente', { rastreado: true, receita: 900 }),                       // com rastro: fechamento
  L('Entrada do lead'), L('Fechado', { fechou: true, receita: 100 }),
], []);
eq([fNL.contatos, fNL.fechamentos, fNL.naoLeads, fNL.receita], [3, 2, 2, 1000], 'Paciente sem rastro fora de tudo (nem receita); com rastro conta como venda');
eq(leadNaEtapa(etapaDoLead(L('Paciente'), construirMapaEtapas([])), 'contato', 'alcancou'), false, 'modal: não-lead não aparece em Leads');
eq(leadNaEtapa(etapaDoLead(L('Paciente'), construirMapaEtapas([])), 'nao_lead', 'alcancou'), true, 'modal: aparece só em nao_lead');
eq(leadNaEtapa(etapaDoLead(L('Paciente', { rastreado: true }), construirMapaEtapas([])), 'fechamento', 'alcancou'), true, 'com rastro é fechamento');
// Kanban real: coluna "Paciente" não vira degrau e os leads dela não contam
const kanban = [
  { funnelId: 'f', label: 'Entrada', etapa: 'contato', position: 0 }, { funnelId: 'f', label: 'Agendado', etapa: 'agendamento', position: 1 },
  { funnelId: 'f', label: 'Fechado', etapa: 'fechamento', position: 2 }, { funnelId: 'f', label: 'Paciente', etapa: 'nao_lead', position: 3 },
];
const fs = contarFunilPorStage(kanban, [L('Entrada', { funnelId: 'f' }), L('Paciente', { funnelId: 'f' }), L('Paciente', { funnelId: 'f', rastreado: true }), L('Fechado', { funnelId: 'f' })]);
eq(fs.degraus.map(d => d.label), ['Entrada', 'Agendado', 'Fechado'], 'Paciente não é degrau');
eq(fs.degraus.map(d => d.alcancaram), [3, 2, 2], 'sem rastro fora; com rastro chega ao fechamento');
eq(OPC2.some(o => o.valor === 'nao_lead'), true, 'dropdown do editor oferece Não lead');
console.log(`OK — ${n} asserts (situação + fase 3 + não-lead)`);
