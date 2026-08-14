// Testes dos helpers de série/heatmap/frequência do modo Food (derivados dos
// pedidos), em cardapioweb-recorrencia.ts. Foco nas BORDAS BRT: pedido feito de
// madrugada UTC não pode vazar de dia, e o último dia BRT do período entra
// inteiro (fim exclusivo à meia-noite BRT).
//
// Compilar antes (o Node não lê TS):
//   npx esbuild src/lib/cardapioweb-recorrencia.ts --outfile=scratchpad/build/cardapioweb-recorrencia.mjs --format=esm --log-level=warning
//   node scratchpad/test-delivery-food.mjs
//
// ATENÇÃO: rodar sem recompilar exercita o código ANTIGO e dá falso "OK".

import assert from 'node:assert';
import {
  serieDiaria, heatmapPedidos, distribuicaoFrequencia, FAIXAS_HEATMAP,
} from './build/cardapioweb-recorrencia.mjs';

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

const P = { de: '2026-07-01', ate: '2026-07-31' };
const brtDow = (isoUtc) => new Date(Date.parse(isoUtc) - 3 * 3600000).getUTCDay();

// Um pedido "lite" mínimo.
const ped = (created_at, total, status = 'confirmed') =>
  ({ created_at, total, status, sales_channel: 'app', customer_id: null, customer_name: null, customer_phone: null });

const pedidos = [
  ped('2026-07-10T15:00:00Z', 100),   // BRT 12:00 dia 10 · faixa 10–14
  ped('2026-07-10T23:30:00Z', 50),    // BRT 20:30 dia 10 · faixa 18–22
  ped('2026-07-10T16:00:00Z', 10),    // BRT 13:00 dia 10 · faixa 10–14 (mesma célula do 1º)
  ped('2026-07-31T02:00:00Z', 30),    // BRT 2026-07-30 23:00 → NÃO vaza pro dia 31
  ped('2026-08-01T02:00:00Z', 999),   // BRT 2026-07-31 23:00 → último dia BRT entra inteiro
  ped('2026-06-30T12:00:00Z', 777),   // fora do período (antes do início) → excluído
  ped('2026-07-15T18:00:00Z', 200, 'canceled'), // cancelado → nunca conta
];

// ───────────────────────────────────────────── série diária
const serie = serieDiaria(pedidos, P);
eq(serie, [
  { data: '2026-07-10', receita: 160, pedidos: 3 },
  { data: '2026-07-30', receita: 30, pedidos: 1 },
  { data: '2026-07-31', receita: 999, pedidos: 1 },
], 'série: agrupa por dia BRT, soma receita/pedidos, só dias com pedido, ordenada');
ok(!serie.some(p => p.data === '2026-06-30'), 'pedido de junho fica fora');
ok(!serie.some(p => p.pedidos === 0), 'nenhum dia zerado entra na série');

// ───────────────────────────────────────────── heatmap
const hm = heatmapPedidos(pedidos, P);
eq(hm.faixas, FAIXAS_HEATMAP.map(f => f.label), 'faixas na ordem do catálogo');
eq(hm.matriz.length, 6, '6 faixas de horário');
eq(hm.matriz[0].length, 7, '7 dias da semana');
const totalCelulas = hm.matriz.flat().reduce((s, v) => s + v, 0);
eq(totalCelulas, 5, 'soma das células = pedidos válidos no período (cancelado e fora fora)');
eq(hm.max, 2, 'célula mais quente = 2 (os dois pedidos das 10–14 de sexta)');
// A faixa 10–14 (índice 2) no dia da semana do pedido das 13h deve valer 2.
const dowDia10 = brtDow('2026-07-10T16:00:00Z');
eq(hm.matriz[2][dowDia10], 2, 'faixa 10–14 no dia 10 acumula os 2 pedidos');
// O pedido UTC 07-31T02:00 mora no dia da semana de 30/jul (BRT), não 31.
const dow30 = brtDow('2026-07-31T02:00:00Z');
eq(hm.matriz[5][dow30], 1, 'pedido de madrugada UTC cai no dia BRT anterior');

// heatmap vazio → max 0 (a UI mostra BlocoVazio)
const vazio = heatmapPedidos([], P);
eq(vazio.max, 0, 'sem pedidos → max 0');

// ───────────────────────────────────────────── frequência
const freq = distribuicaoFrequencia([
  { pedidos: 1 }, { pedidos: 1 }, { pedidos: 2 }, { pedidos: 4 },
  { pedidos: 5 }, { pedidos: 9 }, { pedidos: 10 }, { pedidos: 50 },
]);
eq(freq.map(f => f.clientes), [2, 2, 2, 2], 'baldes inclusivos: 1 / 2–4 / 5–9 / 10+');
eq(freq.map(f => f.chave), ['1', '2-4', '5-9', '10+'], 'chaves estáveis dos baldes');
eq(distribuicaoFrequencia([]).map(f => f.clientes), [0, 0, 0, 0], 'base vazia → tudo zero');
// Taxa de recorrência (calculada no adaptador) = (total - 1-pedido) / total.
const total = freq.reduce((s, f) => s + f.clientes, 0);
const um = freq.find(f => f.chave === '1').clientes;
eq((total - um) / total, 0.75, 'taxa de recorrência: 6 de 8 voltaram = 75%');

console.log(`\n✅ ${n} asserts OK`);
