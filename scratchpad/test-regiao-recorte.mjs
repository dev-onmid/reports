// Recorte por região: chave, SQL, região pelo nome da campanha, opções.
//   npx tsc src/lib/regiao-recorte.ts --outDir scratchpad/build-regiao --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   node scratchpad/test-regiao-recorte.mjs
import assert from 'node:assert/strict';
import { parseRecorte, filtroRegiaoSql, regiaoDaCampanha, rotuloRegiaoCampanha, campanhaCasaRecorte, opcoesDeRecorte, ufDaCidade } from './build-regiao/regiao-recorte.js';
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; };
// chave
eq(parseRecorte('uf:pr'), { tipo: 'uf', valor: 'PR' }, 'uf normaliza');
eq(parseRecorte('uf:XX'), null, 'uf inválida');
eq(parseRecorte('cidade:Curitiba'), { tipo: 'cidade', valor: 'Curitiba' }, 'cidade');
eq(parseRecorte('lixo'), null, 'sem tipo'); eq(parseRecorte(''), null, 'vazio'); eq(parseRecorte(null), null, 'null');
// SQL
eq(filtroRegiaoSql(null, 4), { sql: '', params: [] }, 'sem recorte = nada');
eq(filtroRegiaoSql({ tipo: 'uf', valor: 'PR' }, 4), { sql: ' AND UPPER(regiao_uf) = $4', params: ['PR'] }, 'uf → $4');
eq(filtroRegiaoSql({ tipo: 'cidade', valor: 'São Paulo' }, 2, 'l').params, ['SAO PAULO'], 'cidade sem acento');
assert.ok(filtroRegiaoSql({ tipo: 'cidade', valor: 'X' }, 2, 'l').sql.includes('l.regiao_cidade'), 'alias'); n++;
// campanhas REAIS da CondoStore (produção, 2026-09-23)
eq(regiaoDaCampanha('[ON] [FRANQUEADO] [CONDO_STORE] [CWB]'), { tipo: 'cidade', cidade: 'Curitiba', uf: 'PR' }, 'CWB');
eq(regiaoDaCampanha('[ON] [FORMS] [JOINVILLE] - 01/09'), { tipo: 'cidade', cidade: 'Joinville', uf: 'SC' }, 'JOINVILLE');
eq(regiaoDaCampanha('[ON] [SEARCH] [FRANQUIA] [MARINGÁ] - 09/09'), { tipo: 'cidade', cidade: 'Maringá', uf: 'PR' }, 'MARINGÁ com acento');
eq(regiaoDaCampanha('[ON] [SEARCH] [FRANQUIA] [RIBEIRÃO PRETO]'), { tipo: 'cidade', cidade: 'Ribeirão Preto', uf: 'SP' }, 'duas palavras');
eq(regiaoDaCampanha('[ON] [FORMS] [NACIONAL] - 01/09'), { tipo: 'nacional' }, 'NACIONAL');
eq(regiaoDaCampanha('🟥  [ON] [FORMS] [DIRETO] [JUNH] [VENDA] #3'), null, 'sem região no nome');
eq(regiaoDaCampanha('VENDA DE UNIDADE TAUBATÉ 12/08 - MIGRADA'), { tipo: 'cidade', cidade: 'Taubaté', uf: 'SP' }, 'cidade solta no texto');
eq(regiaoDaCampanha('[ON] [ALCANCE] [CONDOMÍNIOS_SELECIONADOS]'), null, 'nada');
// armadilhas
eq(regiaoDaCampanha('[ON] [AR RESIDENCIAL] [BOTUCATU - SP]'), { tipo: 'cidade', cidade: 'Botucatu', uf: 'SP' }, 'cidade vence a UF solta');
eq(regiaoDaCampanha('[ON] [TDW] [SP] - 16/09'), { tipo: 'uf', uf: 'SP' }, 'UF só entre colchetes');
eq(regiaoDaCampanha('[ON] [AR] [MIX] - RK'), null, 'AR/RK não são UF');
eq(regiaoDaCampanha('ABCD BC'), { tipo: 'cidade', cidade: 'Balneário Camboriú', uf: 'SC' }, 'BC isolado casa');
eq(regiaoDaCampanha('ABCDX'), null, 'BC dentro de palavra não casa');
eq(regiaoDaCampanha('[ON] SAO JOSE DOS CAMPOS'), { tipo: 'cidade', cidade: 'São José dos Campos', uf: 'SP' }, 'nome longo antes do curto');
eq(rotuloRegiaoCampanha(regiaoDaCampanha('[CWB]')), 'Curitiba/PR', 'rótulo');
eq(rotuloRegiaoCampanha(null), 'Sem região', 'rótulo vazio');
// casamento
assert.ok(campanhaCasaRecorte('[ON] [CWB]', { tipo: 'cidade', valor: 'curitiba' }), 'cidade casa sem caixa'); n++;
assert.ok(campanhaCasaRecorte('[ON] [CWB]', { tipo: 'uf', valor: 'PR' }), 'uf casa cidade da uf'); n++;
assert.ok(!campanhaCasaRecorte('[ON] [CWB]', { tipo: 'uf', valor: 'SC' }), 'uf errada'); n++;
assert.ok(!campanhaCasaRecorte('[NACIONAL]', { tipo: 'uf', valor: 'PR' }), 'nacional nunca casa'); n++;
assert.ok(!campanhaCasaRecorte('[VENDA] #3', { tipo: 'uf', valor: 'PR' }), 'sem região nunca casa'); n++;
eq(ufDaCidade('Joinville'), 'SC', 'ufDaCidade');
// opções (CondoStore real: 301 leads, 88% com UF)
const condo = { total: 301, uf: { PR: 156, SP: 44, SC: 19, RJ: 13, MG: 12, BA: 7, MT: 7, MA: 6, XX: 2 }, cidade: { Curitiba: 66, Londrina: 23, 'São Paulo': 8, Joinville: 7, Maringá: 4, Bauru: 1 } };
const ops = opcoesDeRecorte([condo]);
eq(ops[0], { key: 'uf:PR', rotulo: 'PR', leads: 156 }, 'UF maior primeiro');
assert.ok(!ops.some(o => o.key === 'uf:XX'), '2 leads não vira chip'); n++;
assert.ok(ops.some(o => o.key === 'cidade:Maringá' && o.leads === 4), 'Maringá (4) entra'); n++;
assert.ok(!ops.some(o => o.key === 'cidade:Bauru'), 'Bauru (1) não entra'); n++;
eq(opcoesDeRecorte([{ total: 100, uf: { PR: 10 }, cidade: {} }]), [], 'cobertura 10% → sem recorte');
eq(opcoesDeRecorte([{ total: 0, uf: {}, cidade: {} }]), [], 'sem leads');
eq(opcoesDeRecorte([{ total: 10, uf: { PR: 6 }, cidade: {} }, { total: 10, uf: { PR: 6 }, cidade: {} }])[0].leads, 12, 'soma clientes');
console.log(`OK — ${n} asserts`);
