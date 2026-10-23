// Testes das janelas de período da dashboard (cliente) × servidor (period-utils).
// Compilar antes (a lib é TS e o Node não lê TS direto):
//   rm -rf scratchpad/build-periodo && npx tsc src/lib/dashboard-periodo.ts src/lib/period-utils.ts src/lib/optimizer-period-range.ts \
//     --outDir scratchpad/build-periodo --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   cd scratchpad/build-periodo && for f in *.js; do sed -i '' "s#from '@/lib/\([a-z-]*\)'#from './\1.js'#g" "$f"; done && cd ../..
//   node scratchpad/test-dashboard-periodo.mjs
import assert from 'node:assert/strict';
import { faixaAtual, faixaAnterior, rotuloComparacao, fracaoMetaMensal, mesesNaFaixa, rotuloMetaParcial, faixaComparacao, rotuloComparacaoModo } from './build-periodo/dashboard-periodo.js';
import { resolveGaqlPeriod, resolveMetaPeriod, inicioDoMesMenos } from './build-periodo/period-utils.js';
const ref = new Date('2026-09-23T15:00:00Z');
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
eq(faixaAtual('last_3m', undefined, undefined, ref), { from: '2026-07-01', to: '2026-09-23' }, '3 meses = jul→hoje');
eq(faixaAtual('last_6m', undefined, undefined, ref), { from: '2026-04-01', to: '2026-09-23' }, '6 meses = abr→hoje');
eq(faixaAtual('this_year', undefined, undefined, ref), { from: '2026-01-01', to: '2026-09-23' }, 'ano = 1/jan→hoje');
eq(faixaAtual('all_time', undefined, undefined, ref), { from: '2023-10-01', to: '2026-09-23' }, 'todo período = 36 meses');
eq(inicioDoMesMenos('2026-01-15', 2), '2025-11-01', 'virada de ano pra trás');
eq(faixaAnterior('last_3m', { from: '2026-07-01', to: '2026-09-23' }), { from: '2026-04-01', to: '2026-06-23' }, '3m anterior');
eq(faixaAnterior('last_6m', { from: '2026-04-01', to: '2026-09-23' }), { from: '2025-10-01', to: '2026-03-23' }, '6m anterior cruza o ano');
eq(faixaAnterior('this_year', { from: '2026-01-01', to: '2026-09-23' }), { from: '2025-01-01', to: '2025-09-23' }, 'ano anterior');
eq(faixaAnterior('last_3m', { from: '2026-03-01', to: '2026-05-31' }), { from: '2025-12-01', to: '2026-02-28' }, 'dia 31 → 28 em fevereiro');
eq(faixaAnterior('all_time', { from: '2023-10-01', to: '2026-09-23' }), null, 'todo período sem anterior');
eq(rotuloComparacao('last_3m', { from: '2026-04-01', to: '2026-06-23' }), 'vs abr–jun', 'rótulo 3m');
eq(rotuloComparacao('last_6m', { from: '2025-10-01', to: '2026-03-23' }), 'vs out/25–mar/26', 'rótulo 6m');
eq(rotuloComparacao('this_year', { from: '2025-01-01', to: '2025-09-23' }), 'vs mesmo período de 2025', 'rótulo ano');
eq(rotuloComparacao('all_time', null), '', 'sem rótulo');
eq(mesesNaFaixa({ from: '2026-07-01', to: '2026-09-23' }), 3, '3 meses na faixa');
assert.ok(Math.abs(fracaoMetaMensal('last_3m', { from: '2026-07-01', to: '2026-09-23' }) - (2 + 23/30)) < 1e-9, '3m = 2 + 23/30'); n++;
assert.ok(Math.abs(fracaoMetaMensal('this_year', { from: '2026-01-01', to: '2026-09-23' }) - (8 + 23/30)) < 1e-9, 'ano = 8 + 23/30'); n++;
eq(fracaoMetaMensal('this_month', { from: '2026-09-01', to: '2026-09-23' }), 23/30, 'this_month intocado');
eq(rotuloMetaParcial('all_time'), 'Esperado em 36 meses', 'rótulo meta');
for (const p of ['last_3m','last_6m','this_year','all_time','last_90d']) { const g = resolveGaqlPeriod(p); assert.ok(g.startsWith("segments.date BETWEEN '"), `${p} → BETWEEN`); n++; }
eq(resolveGaqlPeriod('this_month'), 'segments.date DURING THIS_MONTH', 'antigos seguem DURING');
for (const p of ['last_3m','last_6m','this_year','all_time']) { const [, s, u] = resolveMetaPeriod(p).split(':'); eq({ from: s, to: u }, faixaAtual(p), `servidor == cliente em ${p}`); }
// Comparativo escolhido (2026-10-23)
const out = { from: '2026-10-01', to: '2026-10-23' };
eq(faixaComparacao('mes_anterior', 'this_month', out), { from: '2026-09-01', to: '2026-09-23' }, 'mês anterior: mesmos dias');
eq(faixaComparacao('ano_anterior', 'this_month', out), { from: '2025-10-01', to: '2025-10-23' }, 'ano anterior: mesmos dias');
eq(faixaComparacao('datas', 'this_month', out, { from: '2026-07-01', to: '2026-07-31' }), { from: '2026-07-01', to: '2026-07-31' }, 'datas escolhidas');
eq(faixaComparacao('datas', 'this_month', out, { from: '2026-07-31', to: '2026-07-01' }), { from: '2026-07-01', to: '2026-07-31' }, 'datas invertidas viram intervalo');
eq(faixaComparacao('datas', 'this_month', out, { from: '', to: '' }), faixaAnterior('this_month', out), 'datas incompletas → automático');
eq(faixaComparacao('auto', 'last_30d', { from: '2026-09-23', to: '2026-10-22' }), faixaAnterior('last_30d', { from: '2026-09-23', to: '2026-10-22' }), 'auto = faixaAnterior');
eq(faixaComparacao('mes_anterior', 'custom', { from: '2026-03-01', to: '2026-03-31' }), { from: '2026-02-01', to: '2026-02-28' }, 'março → fevereiro, dia cortado no fim do mês');
eq(rotuloComparacaoModo('ano_anterior', 'this_month', { from: '2025-10-01', to: '2025-10-23' }), 'vs 1–23/out/25', 'rótulo ano anterior');
eq(rotuloComparacaoModo('mes_anterior', 'this_month', { from: '2026-09-01', to: '2026-09-23' }), 'vs 1–23/set', 'rótulo mês anterior');
eq(rotuloComparacaoModo('datas', 'this_month', { from: '2026-07-15', to: '2026-08-14' }), 'vs 15/07/26–14/08/26', 'rótulo datas cruzando mês');
console.log(`OK — ${n} asserts`);
