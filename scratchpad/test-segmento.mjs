// Asserts do perfil por segmento — os 4 tipos de dashboard (2026-09-29).
//
// O que protegem: `leads` continua sendo o "Leads + R$" (a carteira inteira já
// estava nele); `leads_cpl` esconde receita e mantém metas; `branding` tira
// metas, receita e funil; valores legados (conversao/clinicas) caem no padrão;
// seleção mista cai no mais completo.
//
// Compilar antes:
//   npx esbuild src/lib/dashboard-segmento.ts --bundle --format=esm \
//     --outfile=scratchpad/build-seg/dashboard-segmento.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-segmento.mjs

import assert from 'node:assert';
import {
  normalizarSegmento, perfilDoSegmento, perfilDaSelecao, OPCOES_TIPO_DASHBOARD,
  blocoVisivel, kpisComMetaPermitida, definicaoKpi,
} from './build-seg/dashboard-segmento.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── normalização
eq(normalizarSegmento('leads'), 'leads', 'leads e o padrao com R$');
eq(normalizarSegmento('leads_cpl'), 'leads_cpl', 'leads sem R$');
eq(normalizarSegmento('branding'), 'branding', 'branding reconhecido');
eq(normalizarSegmento('food'), 'food', 'food');
eq(normalizarSegmento('delivery'), 'food', 'delivery alias de food');
for (const v of ['conversao', 'clinicas', 'clinica', '', null, undefined, 42, {}]) {
  eq(normalizarSegmento(v), 'leads', `legado/lixo ${JSON.stringify(v)} cai no padrao`);
}

// ── flags dos perfis
const p = (s) => perfilDoSegmento(s);
eq([p('leads').receita, p('leads').metas, p('leads').funil], [true, true, true], 'Leads + R$ completo');
eq([p('leads_cpl').receita, p('leads_cpl').metas, p('leads_cpl').funil], [false, true, true], 'Leads: sem receita, com metas');
eq([p('branding').receita, p('branding').metas, p('branding').funil], [false, false, false], 'Branding: so trafego');
eq([p('food').receita, p('food').metas, p('food').funil], [true, true, true], 'Food intocado');
ok(!p('leads_cpl').metasSugeridas.includes('faturamento'), 'Leads nao sugere meta de faturamento');
ok(p('leads_cpl').metasSugeridas.includes('cpl'), 'Leads sugere meta de CPL');
eq(p('branding').metasSugeridas, [], 'Branding sem metas');
ok(!blocoVisivel(p('branding'), 'funil_leads'), 'Branding sem funil');
ok(blocoVisivel(p('branding'), 'midia_paga'), 'Branding mostra midia paga');
eq(p('leads').rotuloSegmento, 'Leads + R$', 'rotulo do padrao');
eq(p('leads_cpl').rotuloSegmento, 'Leads', 'rotulo do sem R$');

// ⚠️ spread raso: mexer no perfil Leads nao pode vazar para Leads + R$
p('leads_cpl').blocos.push({ bloco: 'mix_produtos' });
ok(!blocoVisivel(p('leads'), 'mix_produtos'), 'alterar Leads nao contamina Leads + R$');
p('leads_cpl').blocos.pop();

// ── opções dos seletores: 4, na ordem pedida, sem clinicas/conversao
eq(OPCOES_TIPO_DASHBOARD.map(o => o.rotulo), ['Leads', 'Leads + R$', 'Branding', 'Food / Delivery'], 'ordem das opcoes');
eq(OPCOES_TIPO_DASHBOARD.map(o => o.valor), ['leads_cpl', 'leads', 'branding', 'food'], 'valores das opcoes');

// ── seleção
eq(perfilDaSelecao(['leads_cpl', 'leads_cpl']).segmento, 'leads_cpl', 'so Leads -> Leads');
eq(perfilDaSelecao(['branding']).segmento, 'branding', 'so Branding -> Branding');
eq(perfilDaSelecao(['food', 'food']).segmento, 'food', 'so food -> food');
eq(perfilDaSelecao(['leads_cpl', 'leads']).segmento, 'leads', 'mista cai no completo');
eq(perfilDaSelecao(['branding', 'leads_cpl']).segmento, 'leads', 'mista cai no completo');
eq(perfilDaSelecao(['food', 'leads']).segmento, 'leads', 'mista food+leads -> padrao');
eq(perfilDaSelecao([]).segmento, 'leads', 'vazia -> padrao');

// ── metas continuam valendo para qualquer segmento
const comMeta = kpisComMetaPermitida().map(k => k.chave);
ok(comMeta.includes('faturamento') && comMeta.includes('cpl'), 'meta nao e exclusiva de segmento');
eq(definicaoKpi('cpl').menorMelhor, true, 'custo: menor e melhor');

console.log(`OK — ${n} asserts`);
