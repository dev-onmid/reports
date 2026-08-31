// Recompilar ANTES de rodar:
// npx tsc src/lib/radar-tabela.ts --outDir scratchpad/build --module esnext --target es2022 --moduleResolution bundler --skipLibCheck && mv scratchpad/build/radar-tabela.js scratchpad/build/radar-tabela.mjs
import assert from 'node:assert/strict';
import {
  situacaoDaMeta, casaSituacao, ordenarLinhas, filtrarLinhas,
  categoriasDisponiveis, proximaOrdem, pctDaMetrica,
} from './build/radar-tabela.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };

function linha(nome, over = {}) {
  return {
    nome, categoria: 'Clínica', metaTarget: 0,
    resultado: 0, pctResult: null, leads: 0, pctLeads: null,
    cpl: 0, pctCpl: null, cac: 0, pctCac: null,
    fechamentos: 0, pctFechamentos: null, investimento: 0, ...over,
  };
}

// ── situação: as faixas batem com a legenda da tela ──
eq(situacaoDaMeta(100), 'ok');
eq(situacaoDaMeta(75), 'ok', 'fronteira 75 é OK');
eq(situacaoDaMeta(74), 'abaixo');
eq(situacaoDaMeta(30), 'abaixo', 'fronteira 30 ainda é laranja');
eq(situacaoDaMeta(29), 'critico');
eq(situacaoDaMeta(0), 'critico', 'zero medido É crítico');
eq(situacaoDaMeta(null), 'sem_meta', 'sem meta NÃO é crítico');
eq(situacaoDaMeta(NaN), 'sem_meta');

// ── "abaixo" é guarda-chuva; "sem meta" nunca entra ──
ok(casaSituacao(50, 'abaixo'));
ok(casaSituacao(10, 'abaixo'), 'crítico também não está batendo');
ok(!casaSituacao(80, 'abaixo'));
ok(!casaSituacao(null, 'abaixo'), '⚠️ sem meta não pode ser lido como falha');
ok(!casaSituacao(null, 'critico'));
ok(casaSituacao(null, 'sem_meta'));
ok(casaSituacao(null, 'todas'));
ok(!casaSituacao(50, 'critico'), 'crítico não engloba abaixo');

// ── ordenação: vazio SEMPRE no fim, nas duas direções ──
const base = [
  linha('Alfa',  { cpl: 30, pctCpl: 40 }),
  linha('Bravo', { cpl: 0,  pctCpl: null }),   // sem CPL
  linha('Charlie', { cpl: 10, pctCpl: 90 }),
];
eq(ordenarLinhas(base, 'cpl', 'asc').map(l => l.nome), ['Charlie', 'Alfa', 'Bravo'],
   '⚠️ menor CPL não pode trazer quem não tem CPL para o topo');
eq(ordenarLinhas(base, 'cpl', 'desc').map(l => l.nome), ['Alfa', 'Charlie', 'Bravo'],
   'e no desc o vazio continua no fim');
eq(ordenarLinhas(base, null, 'asc').map(l => l.nome), ['Alfa', 'Bravo', 'Charlie'],
   'sem coluna = ordem original');

// não muta a lista de entrada
const orig = [linha('B', { leads: 2 }), linha('A', { leads: 9 })];
const copia = orig.map(l => l.nome);
ordenarLinhas(orig, 'leads', 'desc');
eq(orig.map(l => l.nome), copia, 'ordenar não pode mutar o array do estado');

// desempate estável por nome
const empate = [linha('Zulu', { leads: 5 }), linha('Alfa', { leads: 5 })];
eq(ordenarLinhas(empate, 'leads', 'desc').map(l => l.nome), ['Alfa', 'Zulu'], 'empate desempata por nome');

// nome com acento e caixa
const nomes = [linha('ônix'), linha('Alfa'), linha('Zulu')];
eq(ordenarLinhas(nomes, 'cliente', 'asc').map(l => l.nome), ['Alfa', 'ônix', 'Zulu'], 'ordem alfabética pt-BR');

// pct 0 é valor válido de ordenação (não é vazio)
const zeros = [linha('A', { pctResult: 0 }), linha('B', { pctResult: null }), linha('C', { pctResult: 50 })];
eq(ordenarLinhas(zeros, 'pct', 'asc').map(l => l.nome), ['A', 'C', 'B'], '0% ordena; sem meta vai pro fim');

// ── filtro ──
const carteira = [
  linha('Clin A', { categoria: 'Clínica',  pctCpl: 20 }),
  linha('Clin B', { categoria: 'Clínica',  pctCpl: 90 }),
  linha('Pizza',  { categoria: 'Pizzaria', pctCpl: 10 }),
  linha('SemCfg', { categoria: 'Clínica',  pctCpl: null }),
];
eq(filtrarLinhas(carteira, { categoria: 'Clínica', metrica: 'cpl', situacao: 'abaixo' }).map(l => l.nome),
   ['Clin A'], 'categoria + abaixo da meta, sem arrastar quem não tem meta');
eq(filtrarLinhas(carteira, { categoria: '', metrica: 'cpl', situacao: 'abaixo' }).map(l => l.nome),
   ['Clin A', 'Pizza']);
eq(filtrarLinhas(carteira, { categoria: '', metrica: 'cpl', situacao: 'sem_meta' }).map(l => l.nome),
   ['SemCfg']);
eq(filtrarLinhas(carteira, { categoria: 'Clínica', metrica: 'cpl', situacao: 'todas' }).length, 3);
// métrica diferente muda o recorte
eq(filtrarLinhas(carteira, { categoria: '', metrica: 'leads', situacao: 'abaixo' }).length, 0,
   'ninguém tem meta de leads aqui — logo ninguém "está abaixo"');

eq(pctDaMetrica(linha('x', { pctCac: 44 }), 'cac'), 44);

// ── categorias ──
eq(categoriasDisponiveis([linha('a', { categoria: 'Pizzaria' }), linha('b', { categoria: '' }), linha('c', { categoria: 'Clínica' }), linha('d', { categoria: 'Clínica' })]),
   ['Clínica', 'Pizzaria'], 'sem duplicata e sem categoria vazia');

// ── ciclo do cabeçalho ──
let o = { coluna: null, direcao: 'desc' };
o = proximaOrdem(o, 'cpl');            eq(o, { coluna: 'cpl', direcao: 'desc' });
o = proximaOrdem(o, 'cpl');            eq(o, { coluna: 'cpl', direcao: 'asc' });
o = proximaOrdem(o, 'cpl');            eq(o, { coluna: null, direcao: 'desc' }, '3º clique limpa');
o = proximaOrdem({ coluna: 'cpl', direcao: 'asc' }, 'leads');
eq(o, { coluna: 'leads', direcao: 'desc' }, 'trocar de coluna começa no padrão');
eq(proximaOrdem({ coluna: null, direcao: 'desc' }, 'cliente', 'asc'), { coluna: 'cliente', direcao: 'asc' },
   'nome começa em A→Z');

console.log(`✅ ${n} asserts`);

// ── cliente sem meta NENHUMA sai do Radar ──
{
  const { temAlgumaMeta } = await import('./build/radar-tabela.mjs');
  const vazio = { metaTarget: 0, metaLeads: 0, metaCpl: 0, metaCac: 0, metaFunil: [0,0,0,0,0] };
  ok(!temAlgumaMeta(vazio), 'nenhuma meta → fora do Radar');
  ok(temAlgumaMeta({ ...vazio, metaTarget: 1000 }), 'meta de faturamento basta');
  ok(temAlgumaMeta({ ...vazio, metaCpl: 20 }), 'só CPL já mantém o cliente na tela');
  ok(temAlgumaMeta({ ...vazio, metaLeads: 5 }));
  ok(temAlgumaMeta({ ...vazio, metaCac: 80 }));
  ok(temAlgumaMeta({ ...vazio, metaFunil: [0,0,0,0,3] }), 'meta só num degrau do funil conta');
  ok(!temAlgumaMeta({ metaTarget: 0, metaLeads: 0, metaCpl: 0, metaCac: 0 }), 'sem funil informado não quebra');
  console.log(`✅ +${7} asserts (temAlgumaMeta)`);
}

// funil como OBJETO por etapa (formato real da tela)
{
  const { temAlgumaMeta } = await import('./build/radar-tabela.mjs');
  const z = { metaTarget: 0, metaLeads: 0, metaCpl: 0, metaCac: 0 };
  ok(!temAlgumaMeta({ ...z, metaFunil: { contatos:0, qualificados:0, agendamentos:0, comparecimentos:0, fechamentos:0 } }));
  ok(temAlgumaMeta({ ...z, metaFunil: { contatos:0, qualificados:0, agendamentos:0, comparecimentos:0, fechamentos:4 } }),
     'objeto do funil com um degrau preenchido mantém o cliente');
  console.log('✅ +2 asserts (funil como objeto)');
}
