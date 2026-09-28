// Recompilar antes de rodar (ver test-codigo-invisivel.mjs).
import { matchClickByWindow, JANELA_ATRIBUICAO_MIN } from './build/lead-tracking.mjs';

let n = 0, falhas = 0;
const ok = (cond, nome) => { n++; if (!cond) { falhas++; console.log('  ✗', nome); } };

/** Pool de mentira: responde por FORMATO da query, como o Postgres responderia. */
function poolFake({ cliques = [], concorrentes = 0 }) {
  const vistas = [];
  return {
    vistas,
    query: async (sql) => {
      vistas.push(sql);
      if (/FROM public\.link_redirect_clicks/.test(sql)) return { rows: cliques.slice(0, 2) };
      if (/COUNT\(\*\)::text AS concorrentes/.test(sql)) return { rows: [{ concorrentes: String(concorrentes) }] };
      return { rows: [] }; // DDL do ensure
    },
  };
}
const clique = (id) => ({ id, utm_source: 'google', gclid: 'G1', geo_region: 'PR' });
const agora = new Date('2026-09-28T12:00:00Z');
const chamar = (cfg, extra = {}) =>
  matchClickByWindow(poolFake(cfg), { clientId: 'c1', quando: agora, ...extra });

// ── O caso que a régua existe para resolver ────────────────────────────────
ok((await chamar({ cliques: [clique('k1')], concorrentes: 0 }))?.id === 'k1',
   'um clique sozinho + nenhum lead concorrente → atribui');

// ── Trava 1: dois candidatos ───────────────────────────────────────────────
ok(await chamar({ cliques: [clique('k1'), clique('k2')], concorrentes: 0 }) === null,
   'DOIS cliques na janela → não atribui (não dá para saber qual é este lead)');

// ── Trava 2: outro lead disputando ─────────────────────────────────────────
ok(await chamar({ cliques: [clique('k1')], concorrentes: 1 }) === null,
   'um clique mas OUTRO lead nasceu na janela → não atribui');
ok(await chamar({ cliques: [clique('k1')], concorrentes: 5 }) === null,
   'vários leads concorrentes → não atribui');

// ── Nada para atribuir ─────────────────────────────────────────────────────
ok(await chamar({ cliques: [], concorrentes: 0 }) === null, 'nenhum clique na janela → null');

// ── A trava 2 não é consultada à toa ───────────────────────────────────────
{
  const p = poolFake({ cliques: [clique('a'), clique('b')], concorrentes: 0 });
  await matchClickByWindow(p, { clientId: 'c1', quando: agora });
  ok(!p.vistas.some(q => /concorrentes/.test(q)),
     'com ambiguidade de clique, nem chega a contar lead concorrente');
}

// ── Janela: padrão e limites ───────────────────────────────────────────────
ok(JANELA_ATRIBUICAO_MIN === 2, 'janela padrão de 2 minutos');
{
  const capturar = async (janelaMin) => {
    const p = poolFake({ cliques: [clique('k')], concorrentes: 0 });
    const orig = p.query;
    let params = null;
    p.query = async (sql, args) => { if (/link_redirect_clicks/.test(sql)) params = args; return orig(sql, args); };
    await matchClickByWindow(p, { clientId: 'c1', quando: agora, janelaMin });
    return params?.[2];
  };
  ok(await capturar(undefined) === '2', 'sem parâmetro usa 2 min');
  ok(await capturar(5) === '5', 'aceita janela explícita');
  ok(await capturar(0) === '1', 'janela 0 é elevada ao piso de 1 min');
  ok(await capturar(-10) === '1', 'janela negativa não vira intervalo maluco');
  ok(await capturar(9999) === '60', 'janela absurda é limitada a 60 min');
}

// ── Data inválida não derruba nem vira intervalo infinito ──────────────────
ok((await chamar({ cliques: [clique('k1')], concorrentes: 0 }, { quando: new Date('nao-e-data') }))?.id === 'k1',
   'data inválida cai no relógio atual em vez de quebrar');

console.log(falhas === 0 ? `\n✅ ${n} asserts OK` : `\n❌ ${falhas} de ${n} falharam`);
process.exit(falhas === 0 ? 0 : 1);
