// Relatório de performance — páginas de CRM (visão geral, funil, canais).
// Compilar antes (o teste importa o BUILD, não o fonte):
//   npx esbuild scratchpad/entry-relatorio-crm.ts --bundle --format=esm --platform=node \
//     --packages=external --tsconfig=tsconfig.json --outfile=scratchpad/build/relatorio-crm.mjs
import assert from 'node:assert/strict';
import { ehMesCheio, degrausDoFunil, sFunilComercial, sCanais, sVisaoGeral, sInstagram, ganhoNoPeriodo, serieDaResposta, CRM_PERIODO_SQL } from './build/relatorio-crm.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

// ── ehMesCheio: a meta é MENSAL, só vale em mês-calendário cheio ──
ok(ehMesCheio('2026-09-01', '2026-09-30'), 'setembro cheio');
ok(ehMesCheio('2026-02-01', '2026-02-28'), 'fevereiro cheio');
ok(ehMesCheio('2028-02-01', '2028-02-29'), 'fevereiro bissexto');
ok(!ehMesCheio('2028-02-01', '2028-02-28'), 'bissexto sem o dia 29 não é cheio');
ok(!ehMesCheio('2026-09-01', '2026-09-29'), 'faltando um dia');
ok(!ehMesCheio('2026-09-02', '2026-09-30'), 'não começa no dia 1');
ok(!ehMesCheio('2026-08-01', '2026-09-30'), 'dois meses');
ok(!ehMesCheio('2025-09-01', '2026-09-30'), 'anos diferentes');

// ── A query é a da dashboard: duas réguas + lei de contagem ──
ok(/COALESCE\(fechado_em, lead_date, data\)/.test(CRM_PERIODO_SQL), 'receita pela data do GANHO');
ok(/COALESCE\(lead_date, data\) BETWEEN \$2 AND \$3/.test(CRM_PERIODO_SQL), 'leads pela data de CRIAÇÃO');
ok(/porta/.test(CRM_PERIODO_SQL), 'lei de contagem (porta) aplicada');
ok(!/created_at::date\) BETWEEN/.test(CRM_PERIODO_SQL), 'não é a régua antiga do relatório');

// ── degrausDoFunil: Kanban real × semântico ──
const funilBase = { contatos: 233, qualificados: 77, agendamentos: 61, comparecimentos: 21, fechamentos: 21 };
const real = degrausDoFunil({ funil: funilBase, vendasCohort: null, funilStages: { perdidos: 0, degraus: [
  { label: 'Entrada do lead', color: '#7dd3fc', etapa: 'contato', index: 0, alcancaram: 233, atuais: 150 },
  { label: 'Engajado', color: '#0ea5e9', etapa: 'qualificado', index: 1, alcancaram: 77, atuais: 16 },
  { label: 'Negociação', color: '#8b5cf6', etapa: 'agendamento', index: 2, alcancaram: 61, atuais: 40 },
  { label: 'Fechado', color: '#10b981', etapa: 'fechamento', index: 3, alcancaram: 21, atuais: 21 },
] } });
ok(real.length === 4, 'um degrau por etapa do Kanban');
ok(real[0].label === 'Leads' && real[1].label === 'Engajados', 'topo e 2º degrau com rótulo fixo');
ok(real[2].label === 'Negociação', 'do 3º em diante, o nome real da coluna');
ok(real.map(d => d.valor).join() === '233,77,61,21', 'valores = quem ALCANÇOU');
const sem = degrausDoFunil({ funil: funilBase, vendasCohort: null, funilStages: null });
ok(sem.length === 5 && sem[4].label === 'Fechamentos' && sem[4].valor === 21, 'sem Kanban → 5 degraus semânticos');
ok(degrausDoFunil({ funil: funilBase, vendasCohort: null, funilStages: { perdidos: 0, degraus: [] } }).length === 5, 'Kanban vazio também cai no semântico');

// ── Funil ──
const f = sFunilComercial(real, { vendasDoMes: 31, vendasDeLeadsAnteriores: 13, periodo: 'Setembro/2026' }, 3, 18);
ok(f.includes('33,0%') && f.includes('79,2%') && f.includes('34,4%'), 'conversão de cada degrau sobre o ANTERIOR');
ok(f.includes('9,01%'), 'conversão geral = último ÷ topo, 2 casas');
ok(f.includes('As 31 vendas fechadas no mês incluem 13 de leads'), 'explica a diferença entre vendas do mês e fundo do funil');
ok(/maior perda está de leads para engajados/.test(f), 'gargalo = passagem que menos converte');
ok(!sFunilComercial(real, { vendasDoMes: 21, vendasDeLeadsAnteriores: 0, periodo: 'Setembro/2026' }, 3, 18).includes('vendas fechadas no mês incluem'), 'sem venda de lead antigo, sem a frase');
const zerado = sFunilComercial([{ label: 'Leads', cor: '#7dd3fc', valor: 10 }, { label: 'Engajados', cor: '#0ea5e9', valor: 0 }, { label: 'Fechado', cor: '#10b981', valor: 0 }], { vendasDoMes: 0, vendasDeLeadsAnteriores: 0, periodo: 'X' }, 3, 18);
ok(zerado.includes('>—<'), 'degrau anterior zerado → traço, nunca NaN%');
ok(!/NaN|Infinity|undefined/.test(zerado + f), 'nada de NaN/Infinity/undefined');
ok(sFunilComercial([{ label: '<b>x</b>', cor: '#7dd3fc', valor: 5 }, { label: 'Fim', cor: '#10b981', valor: 1 }], { vendasDoMes: 0, vendasDeLeadsAnteriores: 0, periodo: 'X' }, 3, 18).includes('&lt;B&gt;X&lt;/B&gt;'), 'rótulo de etapa é escapado');

// ── Canais ──
const leads = [['Google/Site', 96], ['Instagram', 72], ['Instagram/Facebook', 33], ['Meta Ads', 22], ['Facebook', 8], ['Formulário Meta', 1], ['WhatsApp', 1]].map(([label, valor]) => ({ label, valor }));
const receita = [['Google/Site', 39854.46, 26], ['Instagram', 4064.47, 4], ['Meta Ads', 814, 1]].map(([label, valor, vendas]) => ({ label, valor, vendas }));
const c = sCanais({ leads, leadsTotal: 233, receita, receitaTotal: 44732.93, semAtribuicao: 0, periodo: 'Setembro/2026' }, 4, 18);
ok(c.includes('WhatsApp') && !c.includes('Outros'), '7 canais: sobra UM → mostra o nome, sem "Outros (1)"');
ok(c.includes('R$ 44.732,93'), 'total de faturamento no card');
ok(c.includes('89,1%'), 'participação do maior canal');
ok(c.includes('26 vendas · ticket médio'), 'vendas e ticket por canal');
ok(c.includes('1 venda ·'), 'singular');
ok(/Instagram\/Facebook trouxe 33 leads e ainda não registrou venda/.test(c), 'aponta canal com volume e sem venda');
ok(!c.includes('sem canal registrado'), 'sem lacuna, sem aviso');
const cor = (html, nome) => html.split(nome)[0].match(/background:(#[0-9a-fA-F]{6});flex-shrink:0"><\/span>(?!.*background:#[0-9a-fA-F]{6};flex-shrink:0"><\/span>)/s)?.[1];
const blocos = c.split('Faturamento por canal');
ok(cor(blocos[0], 'Google/Site') === cor(blocos[1], 'Google/Site'), 'mesmo canal, mesma cor nos dois cards');
const cauda = sCanais({
  leads: [['A', 50], ['B', 40], ['C', 30], ['D', 20], ['E', 10], ['F', 9], ['G', 8], ['H', 7], ['Canal não informado', 26]].map(([label, valor]) => ({ label, valor })), leadsTotal: 200,
  receita: [['A', 700, 2], ['Canal não informado', 300, 1]].map(([label, valor, vendas]) => ({ label, valor, vendas })), receitaTotal: 1000, semAtribuicao: 300, periodo: 'X',
}, 4, 18);
ok(cauda.includes('Outros (3)'), 'cauda vira "Outros (N)"');
ok(cauda.includes('30,0% do faturamento está sem canal registrado'), 'aviso de lacuna acima de 20%');
ok(/A respondeu por 70,0%/.test(cauda), '"Canal não informado" nunca é o destaque');
ok(!/NaN|Infinity|undefined/.test(c + cauda), 'nada de NaN/Infinity/undefined');
ok(sCanais({ leads: [], leadsTotal: 0, receita: [], receitaTotal: 0, semAtribuicao: 0, periodo: 'X' }, 4, 18).includes('Sem registro no período'), 'vazio não quebra');

// ── Visão geral: rótulo e leitura do relatório de performance ──
const pd = (fat, ped) => ({ ativos: 0, inativos: 0, potenciais: 0, faturamento: fat, pedidos_ativos: ped, ticket: ped ? fat / ped : 0, uma_compra: 0, recorrentes: 0, produtos: [], inativos_faixas: [], por_dia: [] });
const perf = sVisaoGeral(pd(44732.93, 31), pd(63219.88, 23), 2, 18, 'Setembro/2026', 'Agosto/2026', { rotuloVendas: 'Vendas', leituraFinal: 'Entraram 233 leads.' });
ok(perf.includes('>Vendas<') && !perf.includes('>Pedidos<'), 'performance fala em Vendas');
ok(perf.includes('Vendas subiram') && perf.includes('Entraram 233 leads.'), 'leitura comercial');
ok(!perf.includes('clientes inativos'), 'sem o texto de delivery');
const deliv = sVisaoGeral(pd(1000, 10), pd(900, 9), 2, 9, 'Maio/2026', 'Abril/2026');
ok(deliv.includes('>Pedidos<') && deliv.includes('clientes inativos'), 'delivery segue como era');
const grande = sVisaoGeral(pd(1234567.89, 800), null, 2, 9, 'Maio/2026', '');
ok(/font-size:26px[^>]*>R\$ 1\.234\.567,89/.test(grande), 'valor de 7 dígitos encolhe para caber no card');
ok(/font-size:34px[^>]*>R\$ 44\.732,93/.test(perf), 'valor de 5 dígitos fica no tamanho cheio');

// ── Seguidores do Instagram: a Meta só entrega 30 dias ──
const AGORA = Date.parse('2026-10-05T15:00:00Z');   // "hoje" fixo: o teste não depende do relógio
const serie = serieDaResposta([
  { value: 8, end_time: '2026-09-05T07:00:00+0000' }, { value: 27, end_time: '2026-09-06T07:00:00+0000' },
  { value: 15, end_time: '2026-09-30T07:00:00+0000' }, { value: 20, end_time: '2026-10-01T07:00:00+0000' },
  { value: 0, end_time: '2026-10-04T07:00:00+0000' }, { value: 99, end_time: 'lixo' }, { end_time: '2026-10-02T07:00:00+0000' },
]);
ok(serie.length === 5 && serie[0].dia === '2026-09-05' && serie[0].ganho === 8, 'série: um por dia, pela data do end_time; lixo fora');
ok(serieDaResposta([{ value: 1, end_time: '2026-09-05T07:00:00+0000' }, { value: 7, end_time: '2026-09-05T07:00:00+0000' }]).length === 1, 'dia repetido não duplica');
const set = ganhoNoPeriodo('2026-09-01', '2026-09-30', [serie], AGORA);
ok(set.ganho === 50 && set.dias === 3 && set.esperados === 30 && set.desde === '2026-09-05' && !set.completo, 'setembro em 05/10: parcial, com "desde"');
const cheio = Array.from({ length: 30 }, (_, i) => ({ dia: `2026-09-${String(i + 1).padStart(2, '0')}`, ganho: 2 }));
const setCheio = ganhoNoPeriodo('2026-09-01', '2026-09-30', [cheio, serie], AGORA);
ok(setCheio.completo && setCheio.dias === 30, 'com o mês todo gravado, é completo');
ok(setCheio.ganho === 2 * 27 + 8 + 27 + 15, 'no mesmo dia, a série mais nova (API) vence a do banco');
const out = ganhoNoPeriodo('2026-10-01', '2026-10-05', [serie.concat([{ dia: '2026-10-02', ganho: 1 }, { dia: '2026-10-03', ganho: 1 }, { dia: '2026-10-05', ganho: 500 }])], AGORA);
ok(out.esperados === 4 && out.completo && out.ganho === 22, 'mês corrente: conta até ONTEM, hoje nunca entra');
const ago = ganhoNoPeriodo('2026-08-01', '2026-08-31', [serie], AGORA);
ok(ago.dias === 0 && ago.desde === null && !ago.completo && ago.ganho === 0, 'sem dia nenhum: indisponível');
ok(ganhoNoPeriodo('2026-10-05', '2026-10-05', [serie], AGORA).esperados === 0, 'período só de hoje: nada esperado, nunca "completo"');
ok(!ganhoNoPeriodo('2026-10-05', '2026-10-05', [serie], AGORA).completo, 'e não é completo');

const igBase = { username: 'x', followers: 14452, reach: 1000, impressions: 2000, profile_views: 10, website_clicks: 5, accounts_engaged: 50 };
const cardDe = (extra) => sInstagram({ ...igBase, ...extra }, 5, 18, 'Setembro/2026');
ok(cardDe({ followers_period: 517, followers_cobertura: { ganho: 517, dias: 26, esperados: 30, desde: '2026-09-05', completo: false } }).includes('+517 desde 05/09'), 'parcial → "desde DD/MM"');
ok(!cardDe({ followers_period: 517, followers_cobertura: { ganho: 517, dias: 26, esperados: 30, desde: '2026-09-05', completo: false } }).includes('517 no período'), 'parcial nunca é chamado de "no período"');
ok(cardDe({ followers_period: 0, followers_cobertura: { ganho: 0, dias: 0, esperados: 31, desde: null, completo: false } }).includes('ganho do período indisponível'), 'sem dado → indisponível, não "sem novos seguidores"');
const completo = { ganho: 61, dias: 4, esperados: 4, desde: '2026-10-01', completo: true };
const prevOk = { followers_period: 71, followers_cobertura: { ganho: 71, dias: 5, esperados: 5, desde: '2026-09-26', completo: true }, reach: 1, impressions: 1, profile_views: 1, website_clicks: 1, accounts_engaged: 1 };
ok(cardDe({ followers_period: 61, followers_cobertura: completo, previous: prevOk }).includes('+61 no período · -14,1% vs anterior'), 'os dois completos → compara');
const prevParcial = { ...prevOk, followers_cobertura: { ...prevOk.followers_cobertura, completo: false } };
const semComp = cardDe({ followers_period: 61, followers_cobertura: completo, previous: prevParcial });
ok(semComp.includes('+61 no período') && !semComp.includes('vs anterior<'), 'anterior incompleto → sem percentual');
ok(cardDe({ followers_period: 0, followers_cobertura: { ...completo, ganho: 0 } }).includes('sem novos seguidores no período'), 'completo e zero → pode afirmar');
ok(cardDe({ followers_period: 180 }).includes('+180 no período'), 'dado antigo sem cobertura: comportamento de antes');

console.log(`OK — ${n} asserts`);
