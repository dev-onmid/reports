// Recompilar antes: npx esbuild src/lib/crm-conversation-sync.ts --bundle --platform=node --format=esm --external:pg --outfile=scratchpad/build/crm-conversation-sync.mjs --alias:@=./src
import assert from 'node:assert/strict';
import { ensureCrmMessagesSchema } from './build/crm-conversation-sync.mjs';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// client falso: grava tudo que recebe; falha no statement marcado
function fakePool({ falharEm = null, falharConexao = false } = {}) {
  const log = []; let conectados = 0, liberados = 0;
  const client = {
    async query(sql) {
      log.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      if (falharEm && sql.includes(falharEm)) throw new Error('boom: ' + falharEm);
      if (sql.startsWith('SELECT 1 FROM public.crm_messages')) return { rowCount: 0, rows: [] };
      return { rowCount: 0, rows: [] };
    },
    release() { liberados++; },
  };
  return {
    log, get conectados() { return conectados; }, get liberados() { return liberados; },
    async connect() { conectados++; if (falharConexao) throw new Error('sem conexão'); return client; },
    async query() { throw new Error('pool.query NÃO deve ser usado: statement avulso cai em outro backend no pooler'); },
  };
}

// 1) caminho feliz: BEGIN → SET LOCAL → ... → COMMIT, tudo no MESMO client
{
  const pool = fakePool();
  await ensureCrmMessagesSchema(pool);
  const l = pool.log;
  ok(l[0] === 'BEGIN', 'abre transação primeiro');
  ok(l[1].startsWith('SET LOCAL lock_timeout'), 'lock_timeout é SET LOCAL, dentro da transação');
  ok(l[2].startsWith('SET LOCAL statement_timeout'), 'statement_timeout é SET LOCAL');
  ok(l.at(-1) === 'COMMIT', 'fecha com COMMIT');
  ok(l.some(s => s.startsWith('CREATE TABLE IF NOT')), 'CREATE TABLE passou');
  ok(l.some(s => s.startsWith('ALTER TABLE public.crm_messages')), 'ALTERs passaram');
  ok(l.filter(s => s === 'SAVEPOINT sp').length >= 10, 'cada statement tem sua savepoint');
  ok(!l.some(s => s.startsWith('UPDATE')), 'sem linha pendente, o UPDATE legado NÃO roda');
  ok(pool.conectados === 1 && pool.liberados === 1, 'um client, liberado no fim');
}

// 2) statement que falha: ROLLBACK TO savepoint e o resto CONTINUA até o COMMIT
{
  const pool = fakePool({ falharEm: 'DROP CONSTRAINT IF EXISTS crm_messages_contact_id_fkey' });
  // memo já resolvido no teste 1 → preciso de módulo fresco; reimporto com query string
  const m = await import(`./build/crm-conversation-sync.mjs?t=${Date.now()}`);
  await m.ensureCrmMessagesSchema(pool);
  const l = pool.log;
  const i = l.findIndex(s => s.startsWith('ALTER TABLE public.crm_messages DROP'));
  ok(i > 0 && l[i + 1] === 'ROLLBACK TO SAVEPOINT sp', 'falha volta à savepoint');
  ok(l.slice(i + 2).some(s => s.startsWith('CREATE INDEX IF NOT')), 'statements seguintes ainda rodam');
  ok(l.at(-1) === 'COMMIT', 'transação fecha com COMMIT mesmo com um statement falho');
  ok(!l.includes('ROLLBACK'), 'nunca faz ROLLBACK total por falha de um statement');
  ok(pool.liberados === 1, 'client liberado');
}

// 3) memoização: 3 chamadas concorrentes = 1 conexão
{
  const m = await import(`./build/crm-conversation-sync.mjs?t=${Date.now() + 1}`);
  const pool = fakePool();
  await Promise.all([m.ensureCrmMessagesSchema(pool), m.ensureCrmMessagesSchema(pool), m.ensureCrmMessagesSchema(pool)]);
  ok(pool.conectados === 1, '3 chamadas concorrentes → 1 conexão (era o bug: N conexões disputando o lock)');
  await m.ensureCrmMessagesSchema(pool);
  ok(pool.conectados === 1, 'chamada posterior não reconecta');
}

// 4) cooldown: falha de conexão NÃO gera tempestade — a chamada seguinte resolve sem tocar o pool
{
  const m = await import(`./build/crm-conversation-sync.mjs?t=${Date.now() + 2}`);
  const pool = fakePool({ falharConexao: true });
  const orig = console.error; const erros = []; console.error = (...a) => erros.push(a.join(' '));
  await m.ensureCrmMessagesSchema(pool);                // 1ª: falha, engolida + logada
  await m.ensureCrmMessagesSchema(pool);                // 2ª: dentro do cooldown
  await m.ensureCrmMessagesSchema(pool);                // 3ª: idem
  console.error = orig;
  ok(pool.conectados === 1, 'depois da falha, chamadas seguintes NÃO reconectam (cooldown)');
  ok(erros.length === 1 && erros[0].includes('nova tentativa em 60s'), 'falha é logada uma vez, com o aviso do cooldown');
}

console.log(`OK — ${n} asserts`);
