// Funil da planilha da Romanza. Compilar antes:
// npx esbuild src/lib/funil-planilha.ts --format=esm --outfile=scratchpad/build/funil-planilha.mjs
// npx esbuild src/lib/google-sheets.ts --bundle --platform=node --format=esm --outfile=scratchpad/build/google-sheets.mjs
// Planilha real em ARQ (export xlsx da Romanza); sem ela só os casos sintéticos rodam.
import { contarAbaPlanilha, configFunilPlanilha, dataDaCelula, normalizarCelula, montarFunilPlanilha } from './build/funil-planilha.mjs';
import { periodoDaAba } from './build/google-sheets.mjs';
import XLSX from 'xlsx'; import fs from 'fs';
let ok = 0, falhas = 0;
const t = (n, c) => { if (c) ok++; else { falhas++; console.log('FALHOU:', n); } };
const cfg = configFunilPlanilha('client-1778639756911');
const soma = c => [...c.porDia.values()].reduce((a, v) => a.map((x, i) => x + v[i]), cfg.etapas.map(() => 0));
const somaD = c => [...c.desviosPorDia.values()].reduce((a, v) => a.map((x, i) => x + v[i]), cfg.desvios.map(() => 0));

t('cliente sem funil devolve null', configFunilPlanilha('outro') === null);
t('normaliza acento e caixa', normalizarCelula(' Restrição ') === 'RESTRICAO');
t('serial do Excel', dataDaCelula(46276)?.toISOString().slice(0, 10) === '2026-09-11');
t('texto dd/mm/aaaa', dataDaCelula('05/09/2026')?.toISOString().slice(0, 10) === '2026-09-05');
t('lixo não é data', dataDaCelula('abc') === null && dataDaCelula(3) === null);

const cab = ['DATA', 'NOME', 'CANAL', '1º CONTATO', '2º CONTATO', '3º CONTATO', 'STATUS'];
const sint = [cab,
  [46276, 'A', 'Facebook', '✅', '', '', 'Cadastrou'],
  [46277, 'B', 'Site', '', '', '', 'Restrição'],
  [46100, 'C', 'Instagram', '', '✅', '', 'aprovado'],   // data de outro mês: cai no dia 1
  ['', 'D', '', '✅', '', '', 'Cadastrou'],               // sem canal: não é lead
];
const c = contarAbaPlanilha(sint, cfg, { ano: 2026, mes: 8 });
t('3 leads (sem canal fica fora)', c.linhas === 3);
t('etapas sintéticas', JSON.stringify(soma(c)) === '[3,2,2,1,1,1]');
t('restrições', somaD(c)[0] === 1);
t('data fora do mês vai pro dia 1', c.porDia.has('2026-09-01'));
t('status sem caixa casa (aprovado)', soma(c)[2] === 2);
const comBranco = [[' ', ...cab], ['', ...sint[1]]];
t('cabeçalho com coluna em branco antes', contarAbaPlanilha(comBranco, cfg, { ano: 2026, mes: 8 })?.linhas === 1);
t('aba sem CANAL é ignorada', contarAbaPlanilha([['X', 'Y'], [1, 2]], cfg, { ano: 2026, mes: 8 }) === null);
t('aba sem colunas de contato avisa', contarAbaPlanilha([['DATA', 'CANAL', 'STATUS'], [46276, 'Site', 'Aprovado']], cfg, { ano: 2026, mes: 8 }).colunasAusentes.includes('1º CONTATO'));
const f = montarFunilPlanilha(cfg, [10, 8, 3, 2, 2, 1], [4]);
t('montar funil', f.degraus.length === 6 && f.degraus[5].rotulo === 'Cadastros' && f.desvios[0].valor === 4);

const ARQ = process.env.ARQ;
if (ARQ && fs.existsSync(ARQ)) {
  const wb = XLSX.read(fs.readFileSync(ARQ), { type: 'buffer' });
  const ler = aba => XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: '' });
  const esperado = { 'SET 2026': [[253, 213, 26, 13, 13, 12], 82], 'AGOS2026': [[214, 179, 24, 13, 13, 12], 82], 'JUL2026': [[190, 154, 20, 17, 17, 15], 71] };
  for (const [aba, [etapas, restr]] of Object.entries(esperado)) {
    const r = contarAbaPlanilha(ler(aba), cfg, periodoDaAba(aba));
    t(aba + ' bate com a planilha ' + JSON.stringify(soma(r)), JSON.stringify(soma(r)) === JSON.stringify(etapas));
    t(aba + ' restrições ' + somaD(r)[0], somaD(r)[0] === restr);
  }
  t('SET 2026 é setembro/2026', JSON.stringify(periodoDaAba('SET 2026')) === '{"ano":2026,"mes":8}');
  t('aba-resumo FUNIL ATUAL não é aba de mês', periodoDaAba('FUNIL ATUAL') === null);
}
console.log(ok + ' ok, ' + falhas + ' falhas'); process.exit(falhas ? 1 : 0);
