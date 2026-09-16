// node scratchpad/test-schema-memo.mjs
import assert from 'node:assert';
import { memoizarSchema, memoizarSchemaPorChave } from './build/schema-memo.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// roda UMA vez, mesmo com N chamadas — é o que impede o ALTER TABLE por request
{
  let vezes = 0;
  const f = memoizarSchema(async () => { vezes++; });
  await Promise.all([f({}), f({}), f({})]);
  await f({});
  eq(vezes, 1, 'DDL roda uma vez para 4 chamadas (3 concorrentes + 1 depois)');
}
// chamadas concorrentes compartilham a MESMA promise (não disparam 3 ALTERs em paralelo)
{
  let vezes = 0; let liberar;
  const trava = new Promise(r => { liberar = r; });
  const f = memoizarSchema(async () => { vezes++; await trava; });
  const a = f({}), b = f({});
  eq(vezes, 1, 'segunda chamada durante a primeira não dispara DDL novo');
  liberar(); await Promise.all([a, b]);
}
// erro limpa o cache — senão falha transitória congelaria schema velho para sempre
{
  let vezes = 0;
  const f = memoizarSchema(async () => { vezes++; if (vezes === 1) throw new Error('rede caiu'); });
  await assert.rejects(() => f({}), /rede caiu/); n++;
  await f({});
  eq(vezes, 2, 'depois de falhar, a próxima chamada tenta de novo');
  await f({});
  eq(vezes, 2, 'e após o sucesso volta a ser memoizada');
}
// o pool é o da PRIMEIRA chamada (documentado no helper)
{
  const vistos = [];
  const f = memoizarSchema(async p => { vistos.push(p); });
  await f('pool-1'); await f('pool-2');
  assert.deepStrictEqual(vistos, ['pool-1'], 'usa o pool da primeira chamada, não o da segunda'); n++;
}
// variante por chave: uma vez POR cliente, sem vazar entre clientes
{
  let vezes = 0; const porChave = [];
  const f = memoizarSchemaPorChave(async c => { vezes++; porChave.push(c); });
  await Promise.all([f('cliA'), f('cliA'), f('cliB')]);
  eq(vezes, 2, 'roda uma vez por chave distinta');
  assert.deepStrictEqual(porChave.sort(), ['cliA', 'cliB']); n++;
}
// ⚠️ chave vinda de request não pode encostar em Object.prototype
{
  let vezes = 0;
  const f = memoizarSchemaPorChave(async () => { vezes++; });
  await f('__proto__'); await f('constructor'); await f('__proto__');
  eq(vezes, 2, 'chaves perigosas são tratadas como chave normal (Map, não objeto)');
}
console.log(`OK — ${n} asserts`);
