// Recompilar ANTES de rodar:
// npx tsc src/lib/aba-persistida.ts --outDir scratchpad/build --module esnext --target es2022 --moduleResolution bundler --skipLibCheck && mv scratchpad/build/aba-persistida.js scratchpad/build/aba-persistida.mjs
import assert from 'node:assert/strict';
import { escolherAba, chaveDaAba } from './build/aba-persistida.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
const ABAS = ['usuarios', 'permissoes', 'ia', 'logs'];

// ── ordem de prioridade ──
eq(escolherAba({ url: 'ia' }, ABAS, 'usuarios'), 'ia', 'URL manda');
eq(escolherAba({ salva: 'logs' }, ABAS, 'usuarios'), 'logs', 'sem URL, vale a salva');
eq(escolherAba({ url: 'ia', salva: 'logs' }, ABAS, 'usuarios'), 'ia', 'URL vence a salva');
eq(escolherAba({}, ABAS, 'usuarios'), 'usuarios', 'sem nada, o padrão');
eq(escolherAba({ forcada: 'logs', url: 'ia', salva: 'permissoes' }, ABAS, 'usuarios'), 'logs',
   'deep-link forçado vence tudo — é o caso do CRM abrindo em ?lead=');

// ── lixo nunca vira aba ──
eq(escolherAba({ url: 'inexistente' }, ABAS, 'usuarios'), 'usuarios', 'aba inválida na URL cai no padrão');
eq(escolherAba({ url: 'inexistente', salva: 'ia' }, ABAS, 'usuarios'), 'ia',
   '⚠️ URL inválida não pode ENGOLIR a salva — tem de continuar procurando');
eq(escolherAba({ salva: 'apagada' }, ABAS, 'usuarios'), 'usuarios', 'aba removida do código cai no padrão');
eq(escolherAba({ url: '', salva: null, forcada: undefined }, ABAS, 'usuarios'), 'usuarios', 'vazio/null/undefined');

// ── normalizar: rótulo antigo não pode cair no default ──
const legado = (v) => (v === 'delivery' || v === 'lps' ? 'rastreio' : v);
const TABS = ['planejamento', 'rastreio', 'crm'];
eq(escolherAba({ url: 'delivery' }, TABS, 'planejamento', legado), 'rastreio', 'link antigo migra');
eq(escolherAba({ url: 'lps' }, TABS, 'planejamento', legado), 'rastreio');
eq(escolherAba({ url: 'crm' }, TABS, 'planejamento', legado), 'crm', 'normalizar não estraga o que já é válido');

// ── chave namespaced: duas telas com ?tab= não colidem na localStorage ──
assert.notEqual(chaveDaAba('configuracoes'), chaveDaAba('cliente')); n++;
eq(chaveDaAba('configuracoes'), 'aba:configuracoes');

console.log(`✅ ${n} asserts`);
