// Testes do SQL da LEI de contagem (lead-contagem.ts).
//
// Nao ha banco aqui: o que se testa e o TEXTO do predicado — que e onde os
// erros desta lib moram (rotulo faltando na lista, COALESCE esquecido num IN
// que viraria NULL e sumiria com milhares de leads).
//
// Compilar antes (a lib e TS e o Node nao le TS direto):
//   npx tsc src/lib/lead-contagem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/lead-contagem.js scratchpad/build/lead-contagem.mjs
//   node scratchpad/test-lead-contagem.mjs

import assert from 'node:assert';
import { naoLeadSql, portaSql, rastroPagoSql, leadContaSql } from './build/lead-contagem.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// ── "Nao e lead": a lista casa por TEXTO do status ──────────────────────────
// ⚠️ O funil exclui pelo GRAU (`etapa_funil = 'nao_lead'`), mas a dashboard
// exclui por aqui, pelo texto. Rotulo do padrao que falte nesta lista sai do
// funil e CONTINUA contando na dashboard — divergencia silenciosa entre as
// duas telas, que e exatamente o bug que este teste existe para pegar.
const nl = naoLeadSql('l').toLowerCase();
ok(nl.includes("'não é lead'"), 'casa "não é lead" (rotulo do padrao generico)');
ok(nl.includes("'nao e lead'"), 'casa "nao e lead" (sem acento)');
ok(nl.includes("'paciente'"), 'casa "paciente" (padrao antigo de clinica, ainda vivo em cliente existente)');
ok(nl.includes("'não lead'") && nl.includes("'nao lead'"), 'casa "nao lead" nas duas grafias');
ok(nl.includes("'já é cliente'") && nl.includes("'ja e cliente'"), 'casa "ja e cliente"');

// ⚠️ COALESCE obrigatorio: `NULL IN (...)` e NULL e `NOT (NULL AND x)` e NULL —
// lead com status vazio (planilha grava NULL aos milhares) sumiria de tudo.
ok(/^\s*coalesce\(/.test(nl), 'envolvido em COALESCE (status NULL nao pode anular o predicado)');
ok(nl.includes('false)'), 'default do COALESCE e FALSE (na duvida, o lead CONTA)');

// ── Alias: todo predicado tem que qualificar as colunas quando recebe alias ──
ok(naoLeadSql('l').includes('l.status'), 'naoLeadSql respeita o alias');
ok(!naoLeadSql('').includes('.status'), 'sem alias nao inventa prefixo');
ok(rastroPagoSql('l').includes('l.ctwa_clid'), 'rastroPagoSql respeita o alias');
ok(portaSql('l').includes('l.porta'), 'portaSql respeita o alias');

// ── Rastro pago: os identificadores que provam trafego pago ─────────────────
const rp = rastroPagoSql('l');
for (const c of ['ctwa_clid', 'click_code', 'source_id', 'gclid', 'fbclid', 'wbraid', 'gbraid', 'campaign_name']) {
  ok(rp.includes(c), `rastro pago considera ${c}`);
}

// ── A lei completa ──────────────────────────────────────────────────────────
const lc = leadContaSql('l');
ok(lc.includes('planilha') && lc.includes('crm_externo') && lc.includes('formulario'),
  'portas validadas contam sempre');
ok(lc.includes("= 'chat'"), 'chat tem regra propria');
ok(lc.includes('NOT ('), 'nao-lead sai da contagem');

console.log(`OK — ${n} asserts (lei de contagem)`);
