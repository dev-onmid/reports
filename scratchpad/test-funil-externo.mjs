// Régua do funil quando o CRM externo manda.
//
// Compilar antes:
//   npx tsc src/lib/funil-externo.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   for f in funil-externo funil-etapas; do mv -f scratchpad/build/$f.js scratchpad/build/$f.mjs; done
//   sed -i '' "s#'@/lib/funil-etapas'#'./funil-etapas.mjs'#" scratchpad/build/funil-externo.mjs
//   node scratchpad/test-funil-externo.mjs

import assert from 'node:assert';
import { planejarFunil, normalizarRotulo } from './build/funil-externo.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const et = (id, label, position) => ({ id, label, position });
const PADRAO = [
  et('p0', 'Em Atendimento', 0), et('p1', 'Agendado', 1), et('p2', 'Reagendado', 2),
  et('p3', 'Fechado', 3), et('p4', 'Paciente', 4), et('p5', 'Não Retorna', 5),
  et('p6', 'Distante', 6), et('p7', 'Sem Interesse', 7), et('p8', 'Desqualificado', 8),
];
const SEM_USO = new Map();
const SULTS = ['Novo lead', 'Abordagem D1', 'Reunião Agendada', 'Contrato', 'Perca'];

// ═══ funil virgem: adota o do CRM externo por inteiro
{
  const p = planejarFunil(PADRAO, SULTS, SEM_USO);
  eq(p.modo, 'adotado', 'funil intocado é adotado');
  eq(p.preservadas, [], 'nada preservado');
  eq(p.remover.length, 9, 'as 9 etapas de clínica saem');
  eq(p.criar.map(c => c.label), SULTS, 'cria as 5 do SULTS');
  eq(p.criar.map(c => c.position), [0, 1, 2, 3, 4], 'NA ORDEM do funil de lá');
  eq(p.reposicionar, [], 'nada a reposicionar — tudo é novo');
}

// ⚠️ O caso do print: UM lead numa etapa padrão não pode bloquear a adoção.
// A decisão é por etapa — a usada fica, as outras 8 saem.
{
  const uso = new Map([['em atendimento', { leads: 1, gatilhos: 0 }]]);
  const p = planejarFunil(PADRAO, SULTS, uso);
  eq(p.modo, 'mesclado', 'sobrou etapa em uso');
  eq(p.preservadas, ['Em Atendimento'], 'a etapa com lead é preservada');
  eq(p.remover.length, 8, 'as outras 8 de clínica saem');
  ok(!p.remover.includes('p0'), 'a que tem lead NUNCA é removida');
  eq(p.criar.map(c => c.position), [0, 1, 2, 3, 4], 'as do SULTS assumem o começo');
  const pos = Object.fromEntries(p.reposicionar.map(r => [r.id, r.position]));
  eq(pos.p0, 5, 'a preservada vai para depois das do externo');
}

// ⚠️ gatilho de automação protege tanto quanto lead
{
  const uso = new Map([['agendado', { leads: 0, gatilhos: 1 }]]);
  const p = planejarFunil(PADRAO, SULTS, uso);
  eq(p.preservadas, ['Agendado'], 'etapa com gatilho é preservada');
  ok(!p.remover.includes('p1'), 'não é removida');
  eq(p.remover.length, 8, 'as demais saem');
}

// ⚠️ ordem relativa das preservadas é mantida
{
  const uso = new Map([
    ['fechado', { leads: 3, gatilhos: 0 }],
    ['em atendimento', { leads: 1, gatilhos: 0 }],
  ]);
  const p = planejarFunil(PADRAO, SULTS, uso);
  eq(p.preservadas, ['Em Atendimento', 'Fechado'], 'na ordem em que estavam');
  const pos = Object.fromEntries(p.reposicionar.map(r => [r.id, r.position]));
  eq(pos.p0, 5, 'Em Atendimento primeiro entre as preservadas');
  eq(pos.p3, 6, 'Fechado depois');
}

// ═══ segunda varredura: já adotado, nada muda
{
  const atuais = SULTS.map((l, i) => et(`s${i}`, l, i));
  const p = planejarFunil(atuais, SULTS, SEM_USO);
  eq(p.modo, 'adotado', 'segue gerenciado');
  eq(p.criar, [], 'nada a criar');
  eq(p.remover, [], 'nada a remover');
  eq(p.reposicionar, [], 'nada a reposicionar — idempotente');
}

// ═══ o caso que motivou tudo: etapas anexadas FORA DE ORDEM são reordenadas
{
  const bagunçado = [
    ...PADRAO,
    et('x1', 'Perca', 9), et('x2', 'Novo lead', 10),
    et('x3', 'Reunião Agendada', 11), et('x4', 'Abordagem D1', 12),
  ];
  const p = planejarFunil(bagunçado, SULTS, SEM_USO);
  eq(p.modo, 'adotado', 'padrão intocado + etapas da integração = gerenciado');
  eq(p.remover.length, 9, 'as fantasmas de clínica saem');
  eq(p.criar.map(c => c.label), ['Contrato'], 'só a que faltava é criada');
  const pos = Object.fromEntries(p.reposicionar.map(r => [r.id, r.position]));
  eq(pos.x2, 0, 'Novo lead vai para a posição 0');
  eq(pos.x4, 1, 'Abordagem D1 para 1');
  eq(pos.x3, 2, 'Reunião Agendada para 2');
  eq(pos.x1, 4, 'Perca vai para o fim');
}

// ═══ etapa criada pelo gestor: sem uso, não é padrão → fica, mas no fim
{
  const comCustom = [...PADRAO, et('g1', 'Visita Técnica', 9)];
  const p = planejarFunil(comCustom, SULTS, SEM_USO);
  eq(p.modo, 'mesclado', 'etapa de gestor sobrevive');
  eq(p.preservadas, ['Visita Técnica'], 'preservada por não ser padrão');
  ok(!p.remover.includes('g1'), 'nunca removida');
  eq(p.remover.length, 9, 'as 9 padrão sem uso saem');
  const pos = Object.fromEntries(p.reposicionar.map(r => [r.id, r.position]));
  eq(pos.g1, 5, 'vai para depois das 5 do SULTS');
}

// ═══ acento e caixa não duplicam coluna
{
  const atuais = [et('a', 'REUNIÃO AGENDADA', 0), et('b', 'novo lead', 1)];
  const p = planejarFunil(atuais, ['Novo lead', 'Reunião Agendada'], SEM_USO);
  eq(p.criar, [], 'não recria etapa que já existe com outra grafia');
  eq(p.modo, 'adotado', 'gerenciado');
  const pos = Object.fromEntries(p.reposicionar.map(r => [r.id, r.position]));
  eq(pos.b, 0, 'novo lead vai pra 0');
  eq(pos.a, 1, 'reunião agendada pra 1');
}
eq(normalizarRotulo('  Reunião   Agendada '), 'reuniao agendada', 'normalização');

// ═══ bordas
eq(planejarFunil(PADRAO, [], SEM_USO).criar, [], 'sem etapas externas não cria nada');
eq(planejarFunil(PADRAO, [], SEM_USO).remover, [], 'e não remove nada');
eq(planejarFunil(PADRAO, ['  ', ''], SEM_USO).criar, [], 'rótulo vazio é ignorado');
{
  const p = planejarFunil([], SULTS, SEM_USO);
  eq(p.modo, 'adotado', 'funil sem etapa nenhuma é gerenciado');
  eq(p.criar.map(c => c.position), [0, 1, 2, 3, 4], 'cria tudo em ordem');
}
// etapa semântica é classificada, não inventada
{
  const p = planejarFunil([], ['Novo lead', 'Reunião Agendada', 'Contrato', 'Perca'], SEM_USO);
  const m = Object.fromEntries(p.criar.map(c => [c.label, c.etapa]));
  ok(m['Perca'] === 'perdido', 'Perca é perda');
  ok(m['Reunião Agendada'] === 'agendamento', 'Reunião Agendada é agendamento');
  ok(m['Contrato'] === 'fechamento' || m['Contrato'] === 'contato', `Contrato classificado como ${m['Contrato']}`);
}

console.log(`ok — ${n} asserts`);
