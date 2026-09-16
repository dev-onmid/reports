// node scratchpad/test-lead-qualificacao.mjs
import assert from 'node:assert';
import { minimoEngajamento, estaEngajado, devoMoverParaEngajado, MIN_MSGS_ENGAJADO_PADRAO }
  from './build/lead-qualificacao.mjs';
let n = 0; const eq = (a,b,m) => { assert.strictEqual(a,b,m); n++; };
const ok = (c,m) => { assert.ok(c,m); n++; };

eq(MIN_MSGS_ENGAJADO_PADRAO, 3, 'padrão é 3 (medido), não o palpite de 8');
eq(minimoEngajamento(null), 3, 'sem config cai no padrão');
eq(minimoEngajamento(undefined), 3, 'undefined cai no padrão');
eq(minimoEngajamento(8), 8, 'cliente pode exigir mais');
eq(minimoEngajamento(0), 1, 'zero viraria "todo lead é engajado" — piso de 1');
eq(minimoEngajamento(-5), 1, 'negativo idem');
eq(minimoEngajamento(999), 20, 'teto: acima de 20 o sinal nunca dispararia');
eq(minimoEngajamento(3.7), 3, 'fracionado trunca');
eq(minimoEngajamento(NaN), 3, 'NaN cai no padrão em vez de virar comparação sempre-falsa');

ok(!estaEngajado(2), '2 mensagens não engaja no padrão');
ok(estaEngajado(3), '3 mensagens engaja');
ok(estaEngajado(50), 'muitas mensagens engaja');
ok(!estaEngajado(5, 8), 'respeita o mínimo configurado do cliente');
ok(estaEngajado(8, 8), 'no limite configurado, engaja');

// ⚠️ o coração da trava: engajamento NUNCA puxa o lead para trás no funil
ok(devoMoverParaEngajado({ engajado: true, postoAtual: 0, postoEngajado: 1, jaEstaNaColuna: false }),
  'lead na entrada avança para Engajado');
ok(!devoMoverParaEngajado({ engajado: true, postoAtual: 3, postoEngajado: 1, jaEstaNaColuna: false }),
  'lead em Agendado NÃO volta para Engajado ao responder');
ok(!devoMoverParaEngajado({ engajado: true, postoAtual: 1, postoEngajado: 1, jaEstaNaColuna: false }),
  'mesmo grau não move (evita vaivém entre colunas irmãs)');
ok(!devoMoverParaEngajado({ engajado: true, postoAtual: 0, postoEngajado: 1, jaEstaNaColuna: true }),
  'quem já está na coluna não é movido de novo');
ok(!devoMoverParaEngajado({ engajado: false, postoAtual: 0, postoEngajado: 1, jaEstaNaColuna: false }),
  'sem engajamento não move');

// ⚠️ posições do seed: únicas e sequenciais. Um empate (que EU introduzi ao inserir a
// coluna Engajado) faz duas colunas disputarem o mesmo lugar no board, e a ordem passa
// a depender de desempate do banco.
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/lib/funil-etapas.ts', import.meta.url), 'utf8');
  const bloco = src.slice(src.indexOf('ETAPAS_PADRAO'), src.indexOf('];', src.indexOf('ETAPAS_PADRAO')));
  const pos = [...bloco.matchAll(/position: (\d+)/g)].map(m => Number(m[1]));
  const labels = [...bloco.matchAll(/label: '([^']+)'/g)].map(m => m[1]);
  eq(new Set(pos).size, pos.length, 'ETAPAS_PADRAO: nenhuma posição repetida');
  assert.deepStrictEqual(pos, [...pos].sort((a, b) => a - b), 'posições em ordem crescente'); n++;
  eq(pos[0], 0, 'primeira posição é 0');
  eq(labels[1], 'Engajado', 'Engajado é a SEGUNDA coluna, logo após a entrada');
  eq(pos[pos.length - 1], pos.length - 1, 'posições são sequenciais, sem buraco');
}

console.log(`OK — ${n} asserts`);
