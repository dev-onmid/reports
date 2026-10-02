/**
 * Compile antes de rodar:
 *   npx esbuild src/lib/disparos-log.ts --bundle --outfile=scratchpad/build/disparos-log.mjs --format=esm --platform=node --external:pg --alias:@=./src
 *   node scratchpad/test-disparos-log.mjs
 */
import assert from 'node:assert/strict';
import { diffCampanha, descreverMudanca, ROTULO_CAMPO, CAMPOS_AUDITADOS } from './build/disparos-log.mjs';
let n = 0;
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — veio ${JSON.stringify(a)}`); n++; };

const antes = { name: 'Promo', message: 'Oi', messages: ['a', 'b'], interval_min: 90, interval_max: 210, daily_limit: 70, label_nome: null, label_id: null, active_days: '1,2,4', ends_at: new Date('2026-10-31T23:59:00Z'), status: 'running' };
eq(diffCampanha(antes, { ...antes }), [], 'sem mudança = lista vazia');
eq(diffCampanha(antes, { ...antes, daily_limit: 120 }), [{ campo: 'daily_limit', rotulo: 'Limite diário', de: 70, para: 120 }], 'uma mudança numérica com rótulo');
eq(diffCampanha(antes, { ...antes, label_nome: 'ATMOS', label_id: '21' }).map(m => m.campo), ['label_nome'], 'label_id não entra sozinho, label_nome conta a história');
eq(diffCampanha(antes, { ...antes, messages: ['a', 'b', 'c'] }).length, 1, 'variações: array comparado por conteúdo');
eq(diffCampanha(antes, { ...antes, messages: ['a', 'b'] }), [], 'array igual em outra instância não é mudança');
eq(diffCampanha(antes, { ...antes, ends_at: new Date('2026-10-31T23:59:00Z') }), [], 'Date igual não é mudança');
eq(diffCampanha(antes, { ...antes, ends_at: null }).length, 1, 'tirar o término é mudança');
eq(diffCampanha({ ...antes, image_url: '' }, { ...antes, image_url: null }), [], 'vazio e null são a mesma coisa');
const longa = 'x'.repeat(400);
const m = diffCampanha(antes, { ...antes, message: longa })[0];
eq(m.para.length, 300, 'texto longo é resumido em 300 chars no registro');
eq(descreverMudanca({ campo: 'daily_limit', rotulo: 'Limite diário', de: 70, para: 120 }), 'Limite diário: 70 → 120', 'descrição legível');
eq(descreverMudanca({ campo: 'messages', rotulo: 'Variações de mensagem', de: ['a'], para: ['a', 'b'] }), 'Variações de mensagem: 1 item(ns) → 2 item(ns)', 'array vira contagem');
eq(descreverMudanca({ campo: 'ends_at', rotulo: 'Término', de: null, para: '2026-10-31' }), 'Término: (vazio) → 2026-10-31', 'null vira (vazio)');
eq(CAMPOS_AUDITADOS.every(c => ROTULO_CAMPO[c]), true, 'todo campo auditado tem rótulo');
eq(CAMPOS_AUDITADOS.includes('label_id'), false, 'label_id fora dos auditados (ruído)');
console.log(`\n✅ ${n} asserts passaram`);
