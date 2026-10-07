// Testes da leitura de Google Sheets (google-sheets.ts) e do parser de "Fechou?".
//
// Compilar antes:
//   npx tsc src/lib/google-sheets.ts src/lib/importacao-origem.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   for f in google-sheets importacao-origem; do mv scratchpad/build/$f.js scratchpad/build/$f.mjs; done
//   node scratchpad/test-google-sheets.mjs
import assert from 'node:assert';
import { extrairSheetId, urlExportXlsx, normalizarNomeAba, resolverAbaDoMes,
  escolherAbas, abasCompativeis, MAX_ABAS_POR_RODADA, periodoDaAba } from './build/google-sheets.mjs';
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


// ---------------------------------------------------------------------------
// escolherAbas — o gestor escolhe as abas (pedido do Matheus, 2026-09-28).
// Abas reais da Odonto First, na ordem em que a planilha as lista.
// ---------------------------------------------------------------------------
const ABAS = ['RESUMO', 'SETEMBRO 2026', 'AGOSTO 2026', 'JULHO 2026', 'JUNHO 26', 'MAI26', 'FUNIL ATUAL'];
const SET = new Date(2026, 8, 15); // setembro/2026

// padrão (config antiga, sem escolha): só o mês — é o comportamento de antes
eq(escolherAbas(ABAS, {}, SET).abas, ['SETEMBRO 2026'], 'sem escolha, só a aba do mês');
eq(escolherAbas(ABAS, { fixas: null, seguirMes: true }, SET).abas, ['SETEMBRO 2026'], 'fixas null = só o mês');

// ⚠️ UNIÃO, não "ou": marcar histórico não pode fazer o mês corrente sumir
eq(escolherAbas(ABAS, { fixas: ['JULHO 2026', 'AGOSTO 2026'], seguirMes: true }, SET).abas,
  ['JULHO 2026', 'AGOSTO 2026', 'SETEMBRO 2026'],
  'histórico SOMA ao mês atual e sai da mais ANTIGA para a mais nova');

// só as escolhidas, quando o gestor desliga o acompanhamento do mês
eq(escolherAbas(ABAS, { fixas: ['JULHO 2026'], seguirMes: false }, SET).abas, ['JULHO 2026'],
  'sem seguirMes, só as escolhidas');
eq(escolherAbas(ABAS, { fixas: [], seguirMes: false }, SET).abas, [], 'nada escolhido e sem mês = nada');

// a mesma aba marcada e sendo a do mês não entra duas vezes
eq(escolherAbas(ABAS, { fixas: ['SETEMBRO 2026'], seguirMes: true }, SET).abas, ['SETEMBRO 2026'],
  'a aba do mês marcada à mão não duplica');

// ⚠️ a clínica renomeia a aba: a escolha casa sem acento/caixa/espaço
eq(escolherAbas(['Setembro 2026', 'agosto  2026'], { fixas: ['AGOSTO 2026'], seguirMes: false }, SET).abas,
  ['agosto  2026'], 'casa a escolha mesmo com caixa e espaço diferentes');

// aba escolhida que sumiu não derruba o resto
{
  const r = escolherAbas(ABAS, { fixas: ['MARÇO 2026', 'JULHO 2026'], seguirMes: false }, SET);
  eq(r.abas, ['JULHO 2026'], 'a que existe entra');
  eq(r.sumidas, ['MARÇO 2026'], 'a que sumiu é reportada, não vira erro');
}

// teto por rodada
{
  const muitas = Array.from({ length: 20 }, (_, i) => `ABA ${i}`);
  const r = escolherAbas(muitas, { fixas: muitas, seguirMes: false }, SET);
  eq(r.abas.length, MAX_ABAS_POR_RODADA, 'corta no teto');
  eq(r.cortadas.length, 20 - MAX_ABAS_POR_RODADA, 'diz o que ficou de fora');
  eq(r.abas[0], 'ABA 0', 'aba sem mês no nome mantém a ordem da planilha');
}

// ── Teto: fica com as MAIS RECENTES, nunca com as mais antigas (2026-10-07) ──
// Planilha REAL da Romanza: 39 abas, 35 marcadas. Antes o corte levava as 12 mais
// antigas e "OUT 2026" (o mês corrente) ficava de fora — a rotina importava 2024
// todo dia e a tela do cliente parava no passado.
{
  const TODAS = ["LEADS 26 Á 25","CADASTROS","OUT 2026","SET 2026","AGOS2026","JUL2026","JUN2026","FORMS | GOOGLE","MAI2026","MAR2026","ABR2026","FEV2026","JAN2026","DEZ2025","FUNIL ATUAL","MAI25","FEV25","ABR25","MAR25","OUT2025","JAN25","NOV2025","AGOS25","SET2025","JUL25","JUN25","FEV24","DEZ24","NOV24","OUT24","SET24","AGT24","JUL242","JUL24","JUN24","MAI24","ABR24","MAR24","JAN24"];
  const FIXAS = TODAS.filter(a => a !== 'OUT 2026' && a !== 'LEADS 26 Á 25' && a !== 'CADASTROS' && a !== 'FUNIL ATUAL');
  const OUT = new Date(2026, 9, 7);
  const r = escolherAbas(TODAS, { fixas: FIXAS, seguirMes: true }, OUT);
  eq(r.abas.includes('OUT 2026'), true, 'o mês corrente NUNCA é cortado');
  eq(r.abas.length, MAX_ABAS_POR_RODADA, 'respeita o teto');
  eq(r.abas.at(-1), 'OUT 2026', 'importa por último a aba mais nova (a última a escrever vence)');
  eq(r.abas[0], 'NOV2025', 'os 12 meses mais recentes, em ordem crescente');
  eq(r.cortadas.includes('JAN24'), true, 'o que sai é o mais antigo');
  eq(r.abas.includes('JAN24'), false, 'aba de 2024 não ocupa vaga do mês corrente');
}

// Mês atual entra mesmo quando TODAS as vagas seriam de abas mais recentes que
// ele não existem — e mesmo sem estar nas fixas.
{
  const todas = ['JAN2026','FEV2026','MAR2026','ABR2026','MAI2026','JUN2026','JUL2026','AGO2026','SET2026','OUT2026','NOV2025','DEZ2025','OUT2025'];
  const r = escolherAbas(todas, { fixas: todas, seguirMes: true }, new Date(2026, 9, 7));
  eq(r.abas.includes('OUT2026'), true, 'mês corrente garantido');
  eq(r.abas.length, MAX_ABAS_POR_RODADA, 'teto respeitado');
}

// ── periodoDaAba: abreviação truncada e apelidos (planilhas reais) ────────────
{
  // "AGOS" é prefixo de AGOSTO truncado em 4 letras — a versão antiga só aceitava
  // 3 letras ou o nome inteiro, e devolvia null para metade da planilha da Romanza.
  eq(periodoDaAba('AGOS2026'), { ano: 2026, mes: 7 }, 'AGOS2026 é agosto/2026');
  eq(periodoDaAba('AGOS25'), { ano: 2025, mes: 7 }, 'AGOS25 é agosto/2025');
  eq(periodoDaAba('SETE 26'), { ano: 2026, mes: 8 }, 'SETE 26 é setembro/2026');
  eq(periodoDaAba('AGT24'), { ano: 2024, mes: 7 }, 'AGT é apelido visto em planilha real');
  eq(periodoDaAba('SET 2026'), { ano: 2026, mes: 8 }, 'formato com espaço segue valendo');
  eq(periodoDaAba('JUL242'), null, 'número que não é ano não vira data');
  eq(periodoDaAba('CADASTROS'), null, 'aba que não é mês continua sem data');
  eq(periodoDaAba('FUNIL ATUAL'), null, 'aba de resumo não vira mês');
  eq(periodoDaAba('OUT'), { ano: 0, mes: 9 }, 'sem ano: mês conhecido, ano 0');
  // ⚠️ Prefixo curto demais casaria mês errado: "MA" serve para março e maio.
  eq(periodoDaAba('MA2026'), null, 'duas letras não bastam');
}

// aba de resumo marcada por engano continua sendo escolha do gestor — quem a
// barra é a checagem de cabeçalho, não esta função
eq(escolherAbas(ABAS, { fixas: ['RESUMO'], seguirMes: false }, SET).abas, ['RESUMO'],
  'escolher uma aba fora do padrão de mês é permitido aqui');

// ---------------------------------------------------------------------------
// abasCompativeis — impede que UMA aba com layout diferente derrube o lote todo
// ---------------------------------------------------------------------------
const MAPA = { name: 'Nome', phone: 'Número', revenue: 'Valor R$', closed: 'Fechou?', clinic: 'Unidade' };
const CAB = {
  'SETEMBRO 2026': ['Data', 'Nome', 'Número', 'Valor R$', 'Fechou?'],
  'JULHO 2026': ['Data', 'Nome', 'Número'],            // sem valor nem fechou
  'RESUMO': ['Indicador', 'Total'],                     // aba de resumo
};
{
  const r = abasCompativeis(CAB, ['SETEMBRO 2026', 'JULHO 2026', 'RESUMO'], MAPA);
  eq(r.ok, ['SETEMBRO 2026'], 'só a aba com todas as colunas entra');
  eq(r.incompativeis.map(i => i.aba), ['JULHO 2026', 'RESUMO'], 'as outras são separadas');
  eq(r.incompativeis[0].faltam, ['Valor R$', 'Fechou?'], 'diz QUAIS colunas faltam');
}
// ⚠️ `clinic` fica de fora da exigência: o sync não manda essa coluna
eq(abasCompativeis({ A: ['Nome', 'Número', 'Valor R$', 'Fechou?'] }, ['A'], MAPA).ok, ['A'],
  'a coluna de clínica não é exigida (o sync não a envia)');
// sem mapeamento, nada a exigir
eq(abasCompativeis({ A: [] }, ['A'], null).ok, ['A'], 'sem de-para, toda aba passa');

// ⚠️ Cabeçalho de planilha de cliente vem com espaço sobrando. Caso REAL que
// derrubou a importação de um cliente que já rodava: o de-para guardava
// " Data de agendamento " (com espaços) e a comparação reprovava a aba.
eq(abasCompativeis({ A: [' Data de agendamento ', 'Nome'] }, ['A'], { scheduledDate: ' Data de agendamento ', name: 'Nome' }).ok,
  ['A'], 'coluna com espaço nas pontas casa consigo mesma');
eq(abasCompativeis({ A: ['Data de agendamento'] }, ['A'], { scheduledDate: ' Data de agendamento ' }).ok,
  ['A'], 'de-para com espaço casa cabeçalho sem espaço');
eq(abasCompativeis({ A: [' Nome '] }, ['A'], { name: 'Nome' }).ok, ['A'], 'e o contrário também');
eq(abasCompativeis({ A: ['Nome'] }, ['A'], { name: 'Telefone' }).incompativeis[0].faltam, ['Telefone'],
  'coluna de verdade ausente continua reprovando');


// ---------------------------------------------------------------------------
// ⚠️⚠️ A ORDEM das abas é cronológica crescente, não a da planilha.
// Medido em produção: importando SETEMBRO e depois AGOSTO da Odonto First, o
// paciente que fechou em setembro (R$ 19.423,70) aparecia em agosto ainda sem
// valor — e a linha de agosto, por ser a última a escrever, ZEROU a receita.
// ---------------------------------------------------------------------------
eq(periodoDaAba('SETEMBRO 2026'), { ano: 2026, mes: 8 }, 'mês por extenso com ano de 4');
eq(periodoDaAba('MAI26'), { ano: 2026, mes: 4 }, 'mês curto com ano de 2');
eq(periodoDaAba('JUNHO 26'), { ano: 2026, mes: 5 }, 'extenso com ano de 2');
eq(periodoDaAba('SET'), { ano: 0, mes: 8 }, 'sem ano: mês conhecido, ano não');
eq(periodoDaAba('RESUMO'), null, 'aba que não é de mês');
eq(periodoDaAba('TIKTOK'), null, 'aba de outro assunto');
eq(periodoDaAba('FUNIL ATUAL'), null, '"FUNIL ATUAL" não casa com nenhum mês');

// o caso exato que perdeu a receita em produção
eq(escolherAbas(['SETEMBRO 2026', 'AGOSTO 2026'], { fixas: ['AGOSTO 2026'], seguirMes: true }, SET).abas,
  ['AGOSTO 2026', 'SETEMBRO 2026'],
  'agosto entra ANTES de setembro, para a versão mais nova do lead escrever por último');

// vira o ano corretamente
eq(escolherAbas(['JANEIRO 2026', 'DEZEMBRO 2025', 'NOVEMBRO 2025'],
  { fixas: ['JANEIRO 2026', 'DEZEMBRO 2025', 'NOVEMBRO 2025'], seguirMes: false }, SET).abas,
  ['NOVEMBRO 2025', 'DEZEMBRO 2025', 'JANEIRO 2026'], 'ordena atravessando a virada do ano');

// aba sem ano fica antes das datadas (não dá para saber de quando é)
eq(escolherAbas(['SETEMBRO 2026', 'SET'], { fixas: ['SETEMBRO 2026', 'SET'], seguirMes: false }, SET).abas,
  ['SET', 'SETEMBRO 2026'], 'mês sem ano perde para o mês datado');

// aba que não é de mês vai primeiro — se for de leads, perde para qualquer mês
eq(escolherAbas(['SETEMBRO 2026', 'RESUMO'], { fixas: ['SETEMBRO 2026', 'RESUMO'], seguirMes: false }, SET).abas,
  ['RESUMO', 'SETEMBRO 2026'], 'aba sem data entra antes das datadas');

console.log(`✓ ${n} asserts de Google Sheets / Fechou? passaram`);
