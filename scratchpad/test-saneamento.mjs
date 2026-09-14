// Testes do plano de saneamento dos Kanbans (crm-saneamento.ts, parte pura).
//
// Compilar antes:
//   npx tsc src/lib/crm-saneamento.ts src/lib/funil-etapas.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   npx esbuild src/lib/crm-saneamento.ts --bundle --platform=node --format=esm \
//     --external:pg --outfile=scratchpad/build/crm-saneamento.mjs
//   node scratchpad/test-saneamento.mjs

import assert from 'node:assert';
import { planejarSaneamento } from './build/crm-saneamento.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const s = (id, label, position) => ({ id, label, position });

// Caso principal: funil padrao com Fechado E Comprou → Comprou absorvido
{
  const p = planejarSaneamento([
    s('s1', 'Em Atendimento', 0), s('s2', 'Agendado', 1),
    s('s3', 'Fechado', 3), s('s4', 'Comprou', 4), s('s5', 'Paciente', 5),
  ]);
  eq(p.migrarLeads, [{ de: 'Comprou', para: 'Fechado' }], 'leads de Comprou migram pra Fechado');
  eq(p.deletarStages, ['s4'], 'coluna Comprou excluida');
  eq(p.ganhoFinal, 'Fechado', 'ganho final e Fechado');
  eq(p.ganhosAbsorvidos, ['Comprou'], 'Comprou registrado como absorvido');
}

// So Fechado → nada a fazer
{
  const p = planejarSaneamento([s('s1', 'Em Atendimento', 0), s('s2', 'Fechado', 1)]);
  eq(p.migrarLeads, [], 'so Fechado: sem migracao');
  eq(p.deletarStages, [], 'so Fechado: sem exclusao');
}

// So Comprou (cliente excluiu Fechado) → NAO mexe: e o unico ganho dele
{
  const p = planejarSaneamento([s('s1', 'Em Atendimento', 0), s('s2', 'Comprou', 1)]);
  eq(p.migrarLeads, [], 'so Comprou: fica como esta');
  eq(p.deletarStages, [], 'so Comprou: nada excluido');
  eq(p.ganhoFinal, null, 'sem Fechado nao ha realinhamento');
}

// Caixa/acento: "COMPROU" e "fechado" tambem casam
{
  const p = planejarSaneamento([s('a', 'fechado', 0), s('b', 'COMPROU', 1)]);
  eq(p.migrarLeads, [{ de: 'COMPROU', para: 'fechado' }], 'casamento sem caixa');
  eq(p.deletarStages, ['b'], 'COMPROU excluido');
}

// Colunas gemeas (mesmo rotulo normalizado) → fica a de menor posicao
{
  const p = planejarSaneamento([
    s('a', 'Agendado', 1), s('b', 'Agendado', 3), s('c', 'agendado ', 5),
  ]);
  eq(p.deletarStages.sort(), ['b', 'c'], 'gemeas excluidas, primeira fica');
  // 'Agendado' identico nao precisa migrar (mesmo texto); 'agendado ' precisa
  eq(p.migrarLeads, [{ de: 'agendado ', para: 'Agendado' }], 'variacao de grafia migra leads');
}

// Gemeas de Fechado + Comprou juntos: dedupe primeiro, merge depois
{
  const p = planejarSaneamento([
    s('f1', 'Fechado', 0), s('f2', 'Fechado', 2), s('c1', 'Comprou', 3),
  ]);
  eq(p.deletarStages.sort(), ['c1', 'f2'], 'gemea de Fechado e Comprou saem');
  eq(p.migrarLeads, [{ de: 'Comprou', para: 'Fechado' }], 'merge depois do dedupe');
}

// Funil ja saneado → plano vazio (idempotencia)
{
  const p = planejarSaneamento([
    s('s1', 'Em Atendimento', 0), s('s2', 'Agendado', 1), s('s3', 'Fechado', 2),
    s('s4', 'Paciente', 3), s('s5', 'Desqualificado', 4),
  ]);
  ok(p.migrarLeads.length === 0 && p.deletarStages.length === 0, 'idempotente');
}

// Funil vazio nao explode
{
  const p = planejarSaneamento([]);
  eq(p.deletarStages, [], 'vazio ok');
}


// ── Etapa de espelho vazia (rodada de 2026-09-14) ──
{
  const st = (id, label, position, color, leads) => ({ id, label, position, color, leads });
  const plano = planejarSaneamento([
    st('a', 'Contato', 10, '#94a3b8', 262),            // espelho EM USO — fica
    st('b', 'Produção', 21, '#94a3b8', 0),             // espelho vazio — sai
    st('c', 'Carteira Bronze', 24, '#94a3b8', 0),      // espelho vazio — sai
    st('d', 'Em Atendimento', 0, '#0ea5e9', 1394),     // seed em uso — fica
    st('e', 'Desqualificado', 9, '#dc2626', 0),        // seed VAZIO mas do gestor — FICA
  ]);
  assert.deepStrictEqual(plano.deletarStages.sort(), ['b','c'], 'só as de espelho vazias saem');
  assert.deepStrictEqual(plano.espelhosVazios.sort(), ['Carteira Bronze','Produção'], 'relatório traz os rótulos');
  assert.ok(!plano.migrarLeads.some(m => m.de === 'Produção'), 'etapa vazia não gera migração de lead');
  n += 3;
}
{
  // ⚠️ Etapa de espelho SEM a contagem: `undefined` é "não sei", não "vazio".
  // Chamador que não informa a contagem NÃO autoriza remoção — senão um caller
  // desatento apagaria a coluna cheia do cliente.
  const plano = planejarSaneamento([{ id: 'x', label: 'Follow-up', position: 1, color: '#94a3b8' }]);
  assert.deepStrictEqual(plano.deletarStages, [], 'sem contagem não remove nada');
  n += 1;
}
{
  // Cor nula (instalação antiga) nunca é confundida com espelho.
  const plano = planejarSaneamento([{ id: 'y', label: 'Novo', position: 1, color: null, leads: 0 }]);
  assert.deepStrictEqual(plano.deletarStages, [], 'cor nula não é espelho');
  n += 1;
}

console.log(`OK — ${n} asserts`);
