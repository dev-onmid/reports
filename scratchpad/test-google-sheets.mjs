// Testes da leitura de Google Sheets (google-sheets.ts) e do parser de "Fechou?".
//
// Compilar antes:
//   npx tsc src/lib/google-sheets.ts src/lib/importacao-origem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   for f in google-sheets importacao-origem; do mv scratchpad/build/$f.js scratchpad/build/$f.mjs; done
//   node scratchpad/test-google-sheets.mjs
import assert from 'node:assert';
import { extrairSheetId, urlExportXlsx, normalizarNomeAba, resolverAbaDoMes } from './build/google-sheets.mjs';
import { parseFechou } from './build/importacao-origem.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ── id da planilha a partir do que o gestor cola ────────────────────────────
{
  const real = 'https://docs.google.com/spreadsheets/d/1s1_Gd46uyiEWS_XBZmQBGmBTQ1IAYKyYOjc3sNxDyxk/edit?gid=573445941#gid=573445941';
  eq(extrairSheetId(real), '1s1_Gd46uyiEWS_XBZmQBGmBTQ1IAYKyYOjc3sNxDyxk', 'link com gid e âncora');
  eq(extrairSheetId('https://docs.google.com/spreadsheets/d/1s1_Gd46uyiEWS_XBZmQBGmBTQ1IAYKyYOjc3sNxDyxk/edit'),
    '1s1_Gd46uyiEWS_XBZmQBGmBTQ1IAYKyYOjc3sNxDyxk', 'link simples');
  eq(extrairSheetId('https://docs.google.com/document/d/1s1_Gd46uyiEWS_XBZmQBGmBTQ1IAYKyYOjc/edit'), null,
    'link de DOC não é planilha');
  eq(extrairSheetId(''), null, 'vazio');
  eq(extrairSheetId(null), null, 'null');
  ok(urlExportXlsx('abc').includes('format=xlsx'), 'export pede xlsx');
}

// ── a aba do mês, com os nomes REAIS da planilha da Odonto First ────────────
{
  const abas = ['SETEMBRO 2026', 'AGOSTO 2026', 'JULHO 2026', 'JUNHO 26', 'MAI26', 'ABR26',
    'MAR26', 'JAN26', 'FEV26', 'OUT', 'SET', 'JUL', 'TIKTOK', 'JUN', 'FUNIL ATUAL',
    'ON-PAINEL', 'NOV', 'CRIATIVOS', 'DEZ', 'AGO', 'FUNIL  META'];

  eq(resolverAbaDoMes(abas, new Date(2026, 8, 28)).aba, 'SETEMBRO 2026', 'setembro/26 → mês por extenso + ano');
  eq(resolverAbaDoMes(abas, new Date(2026, 7, 15)).aba, 'AGOSTO 2026', 'agosto/26');
  eq(resolverAbaDoMes(abas, new Date(2026, 5, 10)).aba, 'JUNHO 26', 'junho/26 → ano de 2 dígitos');
  eq(resolverAbaDoMes(abas, new Date(2026, 4, 3)).aba, 'MAI26', 'maio/26 → abreviação colada no ano');

  // ⚠️⚠️ O caso perigoso: em outubro/2026 a aba do mês ainda não nasceu, e existe
  // uma `OUT` ANTIGA (207 linhas do ano anterior). Como a planilha já usa ano em
  // outras abas, a sem ano NÃO pode casar — senão a rotina importaria a base do
  // ano passado como se fosse do mês corrente, todo dia, em silêncio.
  const out = resolverAbaDoMes(abas, new Date(2026, 9, 1));
  eq(out.aba, null, 'outubro NÃO cai na aba OUT antiga');
  eq(out.motivo, 'nao_encontrada', 'e diz que não encontrou, em vez de chutar');

  // Mas numa planilha que nunca usou ano, a aba sem ano é a certa.
  eq(resolverAbaDoMes(['OUT', 'NOV', 'DEZ'], new Date(2026, 9, 1)).aba, 'OUT',
    'planilha sem ano nenhum: a aba do mês vale');
  eq(resolverAbaDoMes(['OUT', 'NOV', 'DEZ'], new Date(2026, 9, 1)).motivo, 'so_mes', 'e o motivo diz isso');

  // Ano explícito VENCE o sem ano.
  eq(resolverAbaDoMes(['SET', 'SETEMBRO 2026'], new Date(2026, 8, 1)).aba, 'SETEMBRO 2026',
    'com ano ganha de sem ano');
  eq(resolverAbaDoMes(['SETEMBRO 2026', 'SET'], new Date(2026, 8, 1)).aba, 'SETEMBRO 2026',
    'e a ordem da lista não muda isso');

  // ⚠️ Ano DIFERENTE não casa: setembro/2027 não pode ler a aba de 2026.
  eq(resolverAbaDoMes(['SETEMBRO 2026'], new Date(2027, 8, 1)).aba, null, 'ano diferente não casa');
  eq(resolverAbaDoMes(['MAI26'], new Date(2027, 4, 1)).aba, null, 'ano curto diferente não casa');

  // ⚠️ Prefixo, nunca "contém" — senão aba de resumo vira base de leads.
  eq(resolverAbaDoMes(['PRODUTOS', 'FUNIL ATUAL', 'CRIATIVOS'], new Date(2026, 9, 1)).aba, null,
    'PRODUTOS não vira outubro');
  eq(resolverAbaDoMes(['ANOTACOES'], new Date(2026, 7, 1)).aba, null, 'ANOTACOES não vira agosto');

  // Sem aba nenhuma que sirva, diz o porquê em vez de chutar.
  eq(resolverAbaDoMes([], new Date(2026, 0, 1)), { aba: null, motivo: 'nao_encontrada' }, 'lista vazia');

  // Março com cedilha e acento na aba.
  eq(resolverAbaDoMes(['MARÇO 2026'], new Date(2026, 2, 5)).aba, 'MARÇO 2026', 'acento e cedilha');
  eq(normalizarNomeAba('Março 2026'), 'MARCO2026', 'normalização');
}

// ── "Fechou?" — o vocabulário real é EMOJI ─────────────────────────────────
{
  eq(parseFechou('✅'), true, 'check verde fecha');
  eq(parseFechou('❌'), false, 'x vermelho não fecha');
  eq(parseFechou(''), null, '⚠️ vazio é AUSÊNCIA de informação, não "não fechou"');
  eq(parseFechou('   '), null, 'só espaço idem');
  eq(parseFechou(null), null, 'null idem');
  eq(parseFechou('Sim'), true, 'sim');
  eq(parseFechou('NÃO'), false, 'não com acento e caixa alta');
  eq(parseFechou('nao'), false, 'nao sem acento');
  eq(parseFechou('x'), true, 'x marcado fecha');
  eq(parseFechou('-'), false, 'traço é não');
  eq(parseFechou('talvez'), null, 'texto que não é sim nem não não inventa');
  eq(parseFechou('Fechado'), true, 'fechado');
  eq(parseFechou('perdido'), false, 'perdido');
}

console.log(`✓ ${n} asserts de Google Sheets / Fechou? passaram`);
