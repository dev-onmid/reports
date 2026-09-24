// Testes de APLICAR MODELO num funil que ja existe (crm-funil-modelos.ts).
//
// ⚠️ Esta e a funcao mais perigosa do CRM: `crm_leads.status` e TEXTO livre, e
// apagar uma coluna sem levar os leads junto deixa cada um com um status que
// nao existe mais — o Kanban agrupa por rotulo e os esconde. Todo assert aqui
// existe para garantir que nenhum lead fique sem destino.
//
// Compilar antes (a lib e TS, com alias @/ que o Node nao resolve):
//   bash scratchpad/build-modelos.sh

//   node scratchpad/test-aplicar-modelo.mjs

import assert from 'node:assert';
import {
  planejarAplicacaoModelo, destinoSugerido, MANTER_COLUNA,
} from './build/crm-funil-modelos.mjs';
import { ETAPAS_PADRAO } from './build/funil-etapas.mjs';

let n = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };
const ok = (c, msg) => { assert.ok(c, msg); n++; };

const st = (id, label, etapa, leads = 0, position = 0) => ({ id, label, position, etapa_funil: etapa, leads });
const mod = (label, etapa) => ({ label, color: '#fff', etapa_funil: etapa });

// Modelo generico (o padrao novo, resumido)
const generico = [
  mod('Leads', 'contato'),
  mod('Engajados (Respondidos)', 'qualificado'),
  mod('Oportunidade', 'agendamento'),
  mod('Ganho', 'fechamento'),
  mod('Sem Interesse', 'perdido'),
  mod('Não é Lead', 'nao_lead'),
];

// ── 1. Funil de clinica recebendo o generico ────────────────────────────────
const clinica = [
  st('a', 'Em Atendimento', 'qualificado', 40, 0),
  st('b', 'Agendado', 'agendamento', 12, 1),
  st('c', 'Reagendado', 'agendamento', 3, 2),
  st('d', 'Fechado', 'fechamento', 7, 3),
  st('e', 'Paciente', 'nao_lead', 5, 4),
  st('f', 'Sem Interesse', 'perdido', 9, 5),
];
const p1 = planejarAplicacaoModelo(clinica, generico, {});

ok(p1.manter.some(m => m.label === 'Sem Interesse'), 'coluna com o mesmo rotulo continua (nao e recriada)');
eq(p1.manter.length, 1, 'so "Sem Interesse" coincide de rotulo');
eq(p1.criar.map(c => c.label), ['Leads', 'Engajados (Respondidos)', 'Oportunidade', 'Ganho', 'Não é Lead'],
  'as demais colunas do modelo sao criadas, na ordem do modelo');
eq(p1.remover.length, 5, 'as 5 colunas de clinica fora do modelo saem');

// ⚠️ O CORACAO: destino preserva o POSTO do lead no funil.
const destino = Object.fromEntries(p1.remover.map(r => [r.label, r.destino]));
eq(destino['Em Atendimento'], 'Engajados (Respondidos)', 'qualificado -> qualificado');
eq(destino['Agendado'], 'Oportunidade', 'agendamento -> agendamento');
eq(destino['Reagendado'], 'Oportunidade', 'dois agendamentos caem na mesma coluna');
eq(destino['Fechado'], 'Ganho', 'fechamento -> fechamento (venda nao vira topo de funil)');
eq(destino['Paciente'], 'Não é Lead', 'nao_lead -> nao_lead (segue fora da contagem)');
eq(p1.leadsAfetados, 40 + 12 + 3 + 7 + 5, 'soma os leads de todas as colunas que saem');
ok(p1.remover.every(r => r.destino), 'NENHUMA coluna sai sem destino');

// ── 2. Conservar coluna fora do modelo ──────────────────────────────────────
const p2 = planejarAplicacaoModelo(clinica, generico, { 'Agendado': MANTER_COLUNA });
ok(!p2.remover.some(r => r.label === 'Agendado'), 'coluna conservada nao entra em remover');
ok(p2.conservar.some(c => c.label === 'Agendado' && c.leads === 12), 'entra em conservar, com os leads');
eq(p2.leadsAfetados, p1.leadsAfetados - 12, 'leads da conservada saem da conta de afetados');
ok(p2.conservar[0].posicao >= generico.length, 'conservada vai para o fim do board');

// ── 3. Destino escolhido a mao vence a sugestao ─────────────────────────────
const p3 = planejarAplicacaoModelo(clinica, generico, { 'Fechado': 'Leads' });
eq(p3.remover.find(r => r.label === 'Fechado').destino, 'Leads', 'destino manual respeitado');

// ── 4. Funil ja igual ao modelo: nada muda ──────────────────────────────────
const iguais = generico.map((m, i) => st(`x${i}`, m.label, m.etapa_funil, 3, i));
const p4 = planejarAplicacaoModelo(iguais, generico, {});
eq([p4.criar.length, p4.remover.length, p4.leadsAfetados], [0, 0, 0], 'funil identico ao modelo: zero mudanca');
eq(p4.manter.length, generico.length, 'todas continuam');

// ── 5. Casamento de rotulo ignora acento e caixa ────────────────────────────
// Sem isto, "Nao e Lead" viraria coluna nova E a antiga seria removida — os
// leads dariam uma volta inteira sem necessidade.
const quaseIguais = [st('y', 'nao e lead', 'nao_lead', 4, 0), st('z', 'GANHO', 'fechamento', 2, 1)];
const p5 = planejarAplicacaoModelo(quaseIguais, generico, {});
ok(!p5.remover.some(r => r.label === 'nao e lead'), '"nao e lead" casa com "Não é Lead"');
ok(!p5.remover.some(r => r.label === 'GANHO'), '"GANHO" casa com "Ganho"');
ok(p5.manter.some(m => m.label === 'nao e lead'), 'mantem o RoTULO existente, nao o do modelo');

// ── 6. destinoSugerido sem grau correspondente ──────────────────────────────
// Modelo sem coluna de comparecimento: um "Compareceu" precisa cair no posto
// mais proximo (agendamento=2 ou fechamento=4), nunca no topo.
const semComparecimento = generico;
const d6 = destinoSugerido(st('k', 'Compareceu', 'comparecimento', 1), semComparecimento);
ok(['Oportunidade', 'Ganho'].includes(d6), `comparecimento cai no posto vizinho (veio "${d6}")`);

// Modelo sem coluna de perda: perdido nao tem posto, vai para a primeira.
const semPerda = generico.filter(m => m.etapa_funil !== 'perdido');
eq(destinoSugerido(st('k', 'Perdido', 'perdido', 1), semPerda), 'Leads', 'sem coluna de perda, vai para a primeira');

// ── 7. Coluna sem grau explicito usa a auto-classificacao ───────────────────
const p7 = planejarAplicacaoModelo([st('w', 'Proposta Enviada', null, 6, 0)], generico, {});
eq(p7.remover[0].destino, 'Oportunidade', 'sem etapa_funil, classifica pelo rotulo (proposta = agendamento)');

// ── 8. Aplicar o PADRAO DO SISTEMA num funil existente ──────────────────────
// ⚠️ Regressao: o padrao nao e registro no banco, e a rota exigia um id de
// modelo salvo — era o unico "modelo" impossivel de aplicar num funil que ja
// existe. O planejador precisa trata-lo como qualquer outra lista de etapas.
const padraoComoModelo = ETAPAS_PADRAO.map(e => ({ label: e.label, color: e.color, etapa_funil: e.etapa }));
const consultivo = [
  st('c1', 'Entrada', 'contato', 10, 0),
  st('c2', 'Não Retorna', 'contato', 4, 1),
  st('c3', 'Engajado', 'qualificado', 936, 2),
  st('c4', 'Reunião Agendada', 'agendamento', 0, 3),
  st('c5', 'Proposta Enviada', 'agendamento', 0, 4),
  st('c6', 'Fechado', 'fechamento', 0, 5),
  st('c7', 'Sem Interesse', 'perdido', 0, 6),
];
const p8 = planejarAplicacaoModelo(consultivo, padraoComoModelo, {});
ok(p8.criar.length > 0, 'o padrao do sistema cria colunas num funil consultivo');
ok(p8.remover.every(r => r.destino), 'nenhuma coluna sai sem destino ao aplicar o padrao');
const d8 = Object.fromEntries(p8.remover.map(r => [r.label, r.destino]));
eq(d8['Engajado'], 'Engajados (Respondidos)', 'os 936 engajados vao para o degrau de engajamento, nao para o topo');
ok(p8.leadsAfetados >= 936, 'a previa contabiliza os 936 leads que se mexem');
ok(p8.manter.some(m => m.label === 'Sem Interesse'), '"Sem Interesse" coincide e continua');

console.log(`OK — ${n} asserts (aplicar modelo)`);
