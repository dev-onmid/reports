// Compilar antes:
//   npx esbuild src/lib/planejamento-canais.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build-can/planejamento-canais.mjs
import { calcularPlanoCanais, normalizarCanais, CANAIS } from './build-can/planejamento-canais.mjs';

let n = 0, f = 0;
const ok = (c, nome) => { n++; if (!c) { f++; console.log('  ✗', nome); } };
const perto = (a, b) => Math.abs(a - b) < 0.01;

// ── O caso que motivou a feature: CPL diferente por canal ──────────────────
// 64 leads, 4 vendas, meta de R$30.000 — os números da tela do Adriano Moleiro.
const p = calcularPlanoCanais(
  [{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 30, cpl: 60 }],
  64, 4, 30000,
);
ok(perto(p.linhas[0].leads, 44.8), 'Meta leva 70% dos 64 leads');
ok(perto(p.linhas[1].leads, 19.2), 'Google leva 30%');
ok(perto(p.linhas[0].investimento, 896), 'investimento Meta = 44,8 × R$20');
ok(perto(p.linhas[1].investimento, 1152), 'investimento Google = 19,2 × R$60');
ok(perto(p.investimentoTotal, 2048), 'investimento total soma os dois');

// ⚠️ O coração da coisa: ponderada, não simples.
ok(perto(p.cplGeral, 32), 'CPL geral é a média PONDERADA (2048 ÷ 64 = 32)');
ok(!perto(p.cplGeral, 40), 'e NÃO a média simples de 20 e 60, que daria 40');

const extremo = calcularPlanoCanais([{ id: 'meta', share: 90, cpl: 20 }, { id: 'google', share: 10, cpl: 60 }], 100, 10, 0);
ok(perto(extremo.cplGeral, 24), 'com 90/10 a ponderada dá 24 — a simples ainda diria 40');

// ── Soma que não fecha 100% não é normalizada em silêncio ──────────────────
const falta = calcularPlanoCanais([{ id: 'meta', share: 70, cpl: 20 }, { id: 'google', share: 20, cpl: 60 }], 100, 5, 0);
ok(perto(falta.somaShare, 90), 'a soma reportada é 90, não 100');
ok(falta.completo === false, 'o plano se declara incompleto');
ok(perto(falta.leadsSemCanal, 10), '10 leads ficam SEM canal, visíveis');
ok(perto(falta.linhas[0].leads, 70), 'a fatia do Meta continua 70 — não foi inflada para 77,8');
ok(perto(falta.investimentoTotal, 2600), 'o investimento sai incompleto de propósito (1400 + 1200)');

const passou = calcularPlanoCanais([{ id: 'meta', share: 80, cpl: 10 }, { id: 'google', share: 40, cpl: 10 }], 100, 5, 0);
ok(perto(passou.somaShare, 120), 'soma acima de 100 também é reportada como está');
ok(passou.completo === false, 'e o plano segue incompleto');
ok(passou.leadsSemCanal === 0, 'passar de 100 não gera lead negativo sem canal');

// ── Divisões por zero nunca viram 0 nem Infinity ───────────────────────────
const semVenda = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 25 }], 40, 0, 10000);
ok(semVenda.linhas[0].cac === null, 'sem venda o CAC é null, não 0 nem Infinity');
ok(semVenda.linhas[0].pctFaturamento !== null, 'com meta, o % do faturamento existe');
const semMeta = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 25 }], 40, 2, 0);
ok(semMeta.linhas[0].pctFaturamento === null, 'sem meta de faturamento o % é null');
ok(calcularPlanoCanais([], 50, 5, 1000).cplGeral === null, 'sem canal nenhum o CPL geral é null');
ok(calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 20 }], 0, 0, 0).cplGeral === null, 'sem lead o CPL geral é null');

// ── % do faturamento e CAC ─────────────────────────────────────────────────
const c = calcularPlanoCanais([{ id: 'meta', share: 100, cpl: 30 }], 64, 4, 30000);
ok(perto(c.linhas[0].investimento, 1920), 'bate com o INV. PLANEJADO da tela hoje (64 × 30)');
ok(perto(c.linhas[0].cac, 480), 'e com o CAC da tela (1920 ÷ 4)');
ok(perto(c.linhas[0].pctFaturamento, 0.064), 'investimento é 6,4% do faturamento planejado');
ok(perto(c.cplGeral, 30), 'canal único: o CPL geral é o do próprio canal');

// ── Entrada suja não derruba ───────────────────────────────────────────────
ok(normalizarCanais(null).length === 0, 'null vira lista vazia');
ok(normalizarCanais('texto').length === 0, 'string vira lista vazia');
ok(normalizarCanais([{ id: 'kwai', share: 50, cpl: 10 }]).length === 0, 'canal fora do catálogo é descartado');
ok(normalizarCanais([{ id: 'meta', share: 50, cpl: 1 }, { id: 'meta', share: 30, cpl: 2 }]).length === 1, 'canal repetido entra uma vez só');
ok(normalizarCanais([{ id: 'meta', share: 150, cpl: 10 }])[0].share === 100, 'share acima de 100 é travado em 100');
ok(normalizarCanais([{ id: 'meta', share: -5, cpl: -3 }])[0].cpl === 0, 'negativo vira 0 — CPL negativo não existe');
ok(normalizarCanais([{ id: 'google', share: 'abc', cpl: null }])[0].share === 0, 'lixo vira 0, não NaN');
ok(CANAIS.length === 3 && CANAIS.every(x => ['meta','google','tiktok'].includes(x.id)), 'catálogo: Meta, Google e TikTok');

console.log(f === 0 ? `\n✅ ${n} asserts OK` : `\n❌ ${f} de ${n} falharam`);
process.exit(f === 0 ? 0 : 1);
