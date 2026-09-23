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

// ── tabela por região (CondoStore, 3 meses — nomes e números reais) ──
import { montarTabelaRegioes } from './build-regiao/regiao-recorte.js';
{
  const camps = [
    { name: '[ON] [FRANQUEADO] [CONDO_STORE] [CWB]', platform: 'meta', spend: 225.14, leads: 59 },
    { name: '[ON] [SEARCH] [FRANQUIA] [MARINGÁ] - 09/09', platform: 'meta', spend: 410.13, leads: 13 },
    { name: '[ON] [FORMS] [JOINVILLE] - 01/09', platform: 'meta', spend: 319.40, leads: 9 },
    { name: '[ON] [FORMS] [NACIONAL] - 01/09', platform: 'meta', spend: 716.49, leads: 54 },
    { name: '🟥  [ON] [FORMS] [DIRETO] [JUNH] [VENDA] #3', platform: 'meta', spend: 5308.54, leads: 181 },
  ];
  const cidades = [
    { regiao: 'Curitiba', uf: 'PR', leads: 45, agendamentos: 6, comparecimentos: 3, fechamentos: 1, receita: 15000 },
    { regiao: 'Londrina', uf: 'PR', leads: 20, agendamentos: 2, comparecimentos: 1, fechamentos: 0, receita: 0 },
    { regiao: 'Maringá', uf: 'PR', leads: 4, agendamentos: 1, comparecimentos: 0, fechamentos: 0, receita: 0 },
    { regiao: 'Bauru', uf: 'SP', leads: 1, agendamentos: 0, comparecimentos: 0, fechamentos: 0, receita: 0 },
  ];
  const t = montarTabelaRegioes(camps, cidades, [{ regiao: 'PR', uf: 'PR', leads: 121, agendamentos: 10, comparecimentos: 5, fechamentos: 1, receita: 15000 }]);
  eq(t.map(l => l.rotulo), ['Maringá/PR', 'Joinville/SC', 'Curitiba/PR', 'Londrina/PR', 'Nacional / sem região no nome'], 'ordem: investimento desc, depois leads; nacional por último');
  eq(t[2].crm?.leads, 45, 'Curitiba casa o funil do CRM');
  eq(t[2].leadsPlataforma, 59, 'Curitiba leads da plataforma');
  eq(t[1].crm, null, 'Joinville tem campanha mas nenhum lead → crm null (tela mostra 0)');
  eq(t[3].investimento, 0, 'Londrina: só leads, sem campanha');
  assert.ok(!t.some(l => l.rotulo.startsWith('Bauru')), 'Bauru 1 lead e sem campanha fica fora'); n++;
  const nac = t.at(-1);
  eq([nac.campanhas, Math.round(nac.investimento), nac.leadsPlataforma, nac.crm], [2, 6025, 235, null], 'nacional + sem região juntos, sem CRM');
  eq(montarTabelaRegioes([], [], []), [], 'nada → tabela some');
  eq(montarTabelaRegioes([{ name: '[VENDA]', platform: 'meta', spend: 10, leads: 1 }], [], []), [], 'só campanha sem região → some (nacional sozinho não é tabela)');
  const comUf = montarTabelaRegioes([{ name: '[ON] [TDW] [SP]', platform: 'meta', spend: 100, leads: 5 }], [], [{ regiao: 'SP', uf: 'SP', leads: 42, agendamentos: 3, comparecimentos: 1, fechamentos: 0, receita: 0 }]);
  eq([comUf[0].rotulo, comUf[0].tipo, comUf[0].crm?.leads], ['SP', 'uf', 42], 'campanha por UF casa o funil da UF');
  console.log(`OK — tabela por região`);
}
