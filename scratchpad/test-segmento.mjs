// Asserts do perfil por segmento.
//
// O que protegem: o segmento novo (clinicas) existir de verdade em todo lugar
// que decide o que a tela mostra, e a regra de selecao MISTA continuar caindo
// no lead-gen — somar recorrencia de pedidos com funil de leads produz um
// agregado que nao descreve nenhum dos dois.
//
// Compilar antes:
//   npx esbuild src/lib/dashboard-segmento.ts --bundle --format=esm \
//     --outfile=scratchpad/build-seg/dashboard-segmento.mjs --tsconfig=tsconfig.json
//   node scratchpad/test-segmento.mjs

import assert from 'node:assert';
import {
  normalizarSegmento, perfilDoSegmento, perfilDaSelecao,
  blocoVisivel, ordemDoBloco, kpisComMetaPermitida, definicaoKpi, rotuloKpi,
} from './build-seg/dashboard-segmento.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── normalizacao do valor de clients.dashboard_type
eq(normalizarSegmento('clinicas'), 'clinicas', 'clinicas e reconhecido');
eq(normalizarSegmento('clinica'), 'clinicas', 'singular tambem cai em clinicas');
eq(normalizarSegmento('food'), 'food', 'food intocado');
eq(normalizarSegmento('delivery'), 'food', 'alias legado de food intocado');
for (const v of ['leads', 'branding', 'conversao', '', null, undefined, 42, {}]) {
  eq(normalizarSegmento(v), 'leads', `"${String(v)}" cai no lead-gen`);
}

// ── o perfil de clinicas e COPIA do lead-gen (pedido do Matheus), com
//    identidade propria para poder divergir depois sem mexer nos outros.
const leads = perfilDoSegmento('leads');
const clin = perfilDoSegmento('clinicas');
eq(clin.segmento, 'clinicas', 'tem segmento proprio');
eq(clin.rotuloSegmento, 'Clínicas', 'tem rotulo proprio');
eq(clin.kpisTopo, leads.kpisTopo, 'mesmos KPIs do lead-gen');
eq(clin.metasSugeridas, leads.metasSugeridas, 'mesmas metas sugeridas');
eq(clin.blocos.map(b => b.bloco), leads.blocos.map(b => b.bloco), 'mesma ordem de blocos');
ok(clin !== leads, 'e um objeto proprio, nao a mesma referencia');

// ⚠️ Mexer no perfil de clinicas NAO pode vazar para o lead-gen.
clin.kpisTopo.push('seguidores');
eq(perfilDoSegmento('leads').kpisTopo.includes('seguidores'), false,
   'alterar clinicas nao contamina lead-gen');

// ── selecao: so assume o perfil quando TODOS sao dele
eq(perfilDaSelecao(['clinicas', 'clinicas']).segmento, 'clinicas', 'so clinicas -> clinicas');
eq(perfilDaSelecao(['food', 'food']).segmento, 'food', 'so food -> food');
eq(perfilDaSelecao(['leads']).segmento, 'leads', 'so leads -> leads');
eq(perfilDaSelecao(['clinicas', 'food']).segmento, 'leads', 'mista clinicas+food -> lead-gen');
eq(perfilDaSelecao(['clinicas', 'leads']).segmento, 'leads', 'mista clinicas+leads -> lead-gen');
eq(perfilDaSelecao(['food', 'leads']).segmento, 'leads', 'mista food+leads -> lead-gen');
eq(perfilDaSelecao([]).segmento, 'leads', 'selecao vazia -> lead-gen');

// ── blocos: clinicas ve o que o lead-gen ve
for (const b of ['resultado_negocio', 'kpis_topo', 'funil_leads', 'instagram', 'google_ads']) {
  eq(blocoVisivel(perfilDoSegmento('clinicas'), b), true, `clinicas mostra ${b}`);
  eq(ordemDoBloco(perfilDoSegmento('clinicas'), b), ordemDoBloco(leads, b), `${b} na mesma posicao`);
}
eq(blocoVisivel(perfilDoSegmento('clinicas'), 'mix_produtos'), false, 'clinicas nao mostra bloco de food');
eq(ordemDoBloco(perfilDoSegmento('clinicas'), 'mix_produtos'), Infinity, 'bloco ausente vai pro fim');

// ── metas continuam valendo para qualquer segmento
const comMeta = kpisComMetaPermitida().map(k => k.chave);
ok(comMeta.includes('faturamento') && comMeta.includes('seguidores'),
   'meta nao e exclusiva de segmento');
eq(definicaoKpi('cpl').menorMelhor, true, 'custo: menor e melhor');
eq(rotuloKpi(perfilDoSegmento('clinicas'), 'cpl'), 'CPL médio', 'clinicas herda o vocabulario de lead-gen');

console.log(`OK — ${n} asserts`);
