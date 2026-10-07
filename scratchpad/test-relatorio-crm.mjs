// Relatório de performance — páginas de CRM (visão geral, funil, canais).
// Compilar antes (o teste importa o BUILD, não o fonte):
//   npx esbuild scratchpad/entry-relatorio-crm.ts --bundle --format=esm --platform=node \
//     --packages=external --tsconfig=tsconfig.json --outfile=scratchpad/build/relatorio-crm.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ehMesCheio, degrausDoFunil, sFunilComercial, sCanais, sVisaoGeral, sInstagram, sInstagramCalendar, sGoogleAdsResumo, sGoogleAdsCampanhas, sPaidTrafficResumo, sSiteResumo, sSiteAudiencia, agruparSerieDiaria, seletorContatos, categorizeGoogleCampaign, comprasReaisGoogle, rotuloPeriodo, mesesCheios, autoPreviousPeriod, postsParaListar, sInstagramPosts, sInstagramSpotlight, sInstagramTodosConteudos, TODOS_CONTEUDOS_MAX_PAGINAS, ganhoNoPeriodo, serieDaResposta, CRM_PERIODO_SQL } from './build/relatorio-crm.mjs';

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

// ── Google: "Vendas / Shopping" só com COMPRA de verdade ──
// O Google dá R$ 1,00 de valor padrão a toda conversão; a régua antiga (valor > 0)
// classificava campanha de lead como venda em 14 de 17 clientes.
const gc = (tipo, conv, valor, compras = 0, valorCompras = 0, inv = 500) => ({ nome: 'c', tipo, metricas: { investimento: inv, impressoes: 1000, cliques: 100, conversoes: conv, valorConversoes: valor, compras, valorCompras } });
ok(categorizeGoogleCampaign(gc('SEARCH', 39.5, 39.5)) === 'leads', 'lead com valor padrão (R$1/conv) NÃO é venda');
ok(categorizeGoogleCampaign(gc('SEARCH', 0, 0)) === 'leads', 'Pesquisa sem conversão no mês continua sendo campanha de lead (não existe "tráfego" no Google)');
ok(categorizeGoogleCampaign(gc('PERFORMANCE_MAX', 20, 20)) === 'leads', 'PMax de lead → leads');
ok(categorizeGoogleCampaign(gc('SHOPPING', 0, 0)) === 'vendas', 'Shopping é venda por definição');
ok(categorizeGoogleCampaign(gc('SEARCH', 30, 9000, 30, 9000)) === 'vendas', 'compra com valor real → venda');
ok(categorizeGoogleCampaign(gc('DISPLAY', 5, 5)) === 'alcance', 'display continua alcance');
ok(categorizeGoogleCampaign({ nome: 'c', tipo: 'SEARCH', metricas: { investimento: 1, impressoes: 1, cliques: 1, conversoes: 3, valorConversoes: 999 } }) === 'leads', 'sem o campo compras, valor de conversão sozinho nunca vira venda');
ok(comprasReaisGoogle('SEARCH', 87, 16.335).compras === 0, 'categoria "Compra" com valor de centavos (Londrigifts) não conta');
ok(comprasReaisGoogle('SEARCH', 50, 50).compras === 0, 'valor = quantidade é o padrão do Google, não venda');
ok(comprasReaisGoogle('SEARCH', 30, 9000).valorCompras === 9000, 'valor real passa');
ok(comprasReaisGoogle('SHOPPING', 4, 0).compras === 4, 'Shopping fica como veio');
ok(comprasReaisGoogle('SEARCH', 0, 0).compras === 0, 'zero é zero');
const gLeads = { investimento: 1150.77, impressoes: 4817, cliques: 627, conversoes: 50, valorConversoes: 50, compras: 0, valorCompras: 0, palavrasChave: [],
  campanhas: [gc('SEARCH', 10.5, 10.5, 0, 0, 611.59), gc('SEARCH', 39.5, 39.5, 0, 0, 279.29), gc('SEARCH', 0, 0, 0, 0, 259.89)] };
const resumoG = sGoogleAdsResumo(gLeads, 8, 18);
ok(!resumoG.includes('Vendas / Shopping') && !/ROAS/.test(resumoG), 'Cinfel: sem card de vendas e sem ROAS');
ok(!resumoG.includes('Pesquisa / tráfego') && !resumoG.includes('Geração de leads'), 'resumo do Google sem cards por "objetivo"');
ok(resumoG.includes('23,02'), 'custo por conversão geral continua no topo');
ok(!/ROAS|Valor de venda|Compras/.test(sGoogleAdsCampanhas(gLeads, 9, 18, 'Setembro/2026')), 'cards por campanha sem ROAS/compras');
ok(!/receita atribuída/.test(sPaidTrafficResumo(null, gLeads, 4, 18)), 'resumo de tráfego não trata valor padrão como receita');
const gVenda = { ...gLeads, compras: 30, valorCompras: 9000, campanhas: [gc('SEARCH', 30, 9000, 30, 9000, 1000)] };
ok(/ROAS de 9,00/.test(sGoogleAdsResumo(gVenda, 8, 18)), 'venda real continua na leitura, com ROAS');

// ── Calendário: aviso de post arquivado ──
const cal = sInstagramCalendar([], 12, 18, new Date(2026, 8, 1));
ok(cal.includes('Publicações arquivadas somem da contagem'), 'aviso presente no calendário');

// ── Gráfico: agrupamento da série diária ──
const dias = (n, ini = '2026-01-01') => Array.from({ length: n }, (_, i) => { const d = new Date(ini + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return { date: d.toISOString().slice(0, 10), barra: 10, linha: 1 }; });
ok(agruparSerieDiaria(dias(30)).length === 30 && agruparSerieDiaria(dias(30))[0].rotulo === '01/01', 'até 31 dias: um ponto por dia');
const porSemana = agruparSerieDiaria(dias(60));
ok(porSemana.length >= 9 && porSemana.length <= 10, '60 dias: por semana');
ok(porSemana.reduce((t, p) => t + p.barra, 0) === 600 && porSemana.reduce((t, p) => t + p.linha, 0) === 60, 'agrupar por semana não perde valor');
const porMes = agruparSerieDiaria(dias(273));
ok(porMes.length === 9 && porMes[0].rotulo === 'jan/26' && porMes[8].rotulo === 'set/26', '9 meses: por mês, rótulo mmm/aa');
ok(porMes.reduce((t, p) => t + p.barra, 0) === 2730, 'agrupar por mês não perde valor');
ok(agruparSerieDiaria([{ date: 'lixo', barra: 1, linha: 1 }]).length === 0, 'data inválida fica de fora');
const gDia = { ...gLeads, diario: dias(30, '2026-09-01').map((d, i) => ({ date: d.date, investimento: 30 + i, cliques: 20, conversoes: i % 3 })) };
const comGrafico = sGoogleAdsResumo(gDia, 8, 18);
ok(comGrafico.includes('<polyline') && comGrafico.includes('Investimento e conversões por dia'), 'resumo do Google ganha o gráfico diário');
ok(!sGoogleAdsResumo(gLeads, 8, 18).includes('<polyline'), 'sem série diária, sem gráfico (e sem quebrar)');
ok(!/NaN|Infinity|undefined/.test(comGrafico), 'gráfico sem NaN/Infinity/undefined');

// ── Site / landing page (GA4) — fixture REAL da Cinfel, set/2026 ──
const ga4 = JSON.parse(readFileSync(new URL('./fixtures/ga4-cinfel-2026-09.json', import.meta.url), 'utf8')).ga4;
const site = sSiteResumo(ga4, { periodo: 'Setembro/2026', prevPeriodo: 'Agosto/2026', comparar: true }, 11, 20);
ok(site.includes('>1.910<') && site.includes('>141<'), 'visitas e contatos do GA4');
ok(site.includes('7,4%') && site.includes('65,0%') && site.includes('1m 02s'), 'taxa de contato, engajamento e tempo médio');
ok(site.includes('+14,3% ↑ vs Agosto'), 'variação contra o período anterior');
ok(site.includes('Pesquisa paga') && site.includes('Busca orgânica') && !site.includes('Paid Search'), 'canais traduzidos');
ok(site.includes('72 contatos'), 'contatos por canal = WhatsApp + formulário + telefone (a régua da dashboard)');
ok(!sSiteResumo(ga4, { periodo: 'Setembro/2026', prevPeriodo: '', comparar: false }, 11, 20).includes('↑ vs'), 'sem comparativo, sem variação');
const audi = sSiteAudiencia(ga4, { periodo: 'Setembro/2026' }, 12, 20);
ok(audi.includes('Celular') && audi.includes('Computador') && audi.includes('Novos visitantes'), 'dispositivos e novos × recorrentes');
ok(audi.includes('Sao Paulo') && audi.includes('/pecasoffroad'), 'cidades e páginas de entrada');
ok(/Computador converte melhor: 13,2%/.test(audi), 'leitura aponta o dispositivo que mais converte');
ok(audi.includes('pico: terça, 17h'), 'pico de movimento');
ok(!/NaN|Infinity|undefined/.test(site + audi), 'páginas de site sem NaN/Infinity/undefined');
const semTipo = [{ valor: 'a', sessoes: 10, engajadas: 5, tempo: 1, conversoes: 4, sessoesConv: 3, whatsapp: 0, formulario: 0, telefone: 0 }];
ok(seletorContatos(semTipo)(semTipo[0]) === 4, 'sem tipo classificável, contatos = eventos-chave');
const vazio = { ...ga4, diario: [], pago: { ...ga4.pago, canais: [] }, audiencia: { dispositivos: [], cidades: [], novosRecorrentes: [], idades: [], generos: [], semanaHora: [] }, comportamento: { ...ga4.comportamento, paginasEntrada: [] } };
ok(sSiteResumo(vazio, { periodo: 'X', prevPeriodo: '', comparar: false }, 1, 2).includes('Sem origem registrada') && sSiteAudiencia(vazio, { periodo: 'X' }, 1, 2).length > 500, 'GA4 sem cortes não quebra as páginas');

// ── Rótulo do período e comparativo automático (caso Incorpast: trimestre chamado de "Julho") ──
ok(mesesCheios('2026-07-01', '2026-07-31') === 1 && mesesCheios('2026-07-01', '2026-09-30') === 3, 'conta meses cheios');
ok(mesesCheios('2026-07-01', '2026-09-15') === 0 && mesesCheios('2026-07-02', '2026-07-31') === 0, 'ponta quebrada não é mês cheio');
ok(mesesCheios('2025-11-01', '2026-01-31') === 3, 'meses cheios atravessando o ano');
ok(rotuloPeriodo('2026-07-01', '2026-07-31') === 'Julho/2026', 'mês cheio continua "Julho/2026"');
ok(rotuloPeriodo('2026-07-01', '2026-09-30') === 'Julho a Setembro/2026', 'trimestre vira "Julho a Setembro/2026"');
ok(rotuloPeriodo('2025-11-01', '2026-01-31') === 'Novembro de 2025 a Janeiro/2026', 'vários meses atravessando o ano');
ok(rotuloPeriodo('2026-07-01', '2026-09-15') === '1 de jul a 15 de set/2026', 'intervalo quebrado mostra os dias');
ok(rotuloPeriodo('2026-07-01', '2026-09-30').split('/')[0] === 'Julho a Setembro', 'o split("/")[0] dos slides continua funcionando');
ok(JSON.stringify(autoPreviousPeriod('2026-07-01', '2026-09-30')) === JSON.stringify({ from: '2026-04-01', to: '2026-06-30' }), 'trimestre compara com o trimestre anterior (não com 92 dias a partir de 31/03)');
ok(JSON.stringify(autoPreviousPeriod('2026-07-01', '2026-07-31')) === JSON.stringify({ from: '2026-06-01', to: '2026-06-30' }), 'mês cheio continua comparando com o mês anterior');
ok(JSON.stringify(autoPreviousPeriod('2026-01-01', '2026-03-31')) === JSON.stringify({ from: '2025-10-01', to: '2025-12-31' }), 'trimestre no início do ano recua para o ano anterior');
ok(JSON.stringify(autoPreviousPeriod('2026-07-01', '2026-09-15')) === JSON.stringify({ from: '2026-04-15', to: '2026-06-30' }), 'intervalo quebrado mantém a janela corrida');
const vgTri = sVisaoGeral({ ativos: 0, inativos: 0, potenciais: 0, faturamento: 123880.2, pedidos_ativos: 35, ticket: 3539.43, mensagens: 0, taxa_resposta: 0, entregas_por_dia: [], regioes: [], clientes_inativos: [] }, { ativos: 0, inativos: 0, potenciais: 0, faturamento: 50479.35, pedidos_ativos: 19, ticket: 2656.81, mensagens: 0, taxa_resposta: 0, entregas_por_dia: [], regioes: [], clientes_inativos: [] }, 2, 20, 'Julho a Setembro/2026', 'Abril a Junho/2026', { unidade: 'período', rotuloVendas: 'Vendas' });
ok(vgTri.includes('Visão Geral do Período') && vgTri.includes('Comparativo de Julho a Setembro com Abril a Junho de 2026'), 'Visão Geral do trimestre: título e comparativo falam do período inteiro');
ok(!vgTri.includes('Visão Geral do Mês'), 'trimestre não se chama "mês"');
const vgMes = sVisaoGeral({ ativos: 0, inativos: 0, potenciais: 0, faturamento: 1, pedidos_ativos: 1, ticket: 1, mensagens: 0, taxa_resposta: 0, entregas_por_dia: [], regioes: [], clientes_inativos: [] }, null, 2, 20, 'Julho/2026', 'Junho/2026', { rotuloVendas: 'Vendas' });
ok(vgMes.includes('Visão Geral do Mês'), 'mês cheio continua "Visão geral do mês"');

// ── Relatório de período longo (caso Romanza, 13 meses) ──
const postFake = (i) => ({ id: 'p' + i, caption: 'post ' + i, mediaType: 'IMAGE', thumbnailUrl: null, permalink: 'https://instagram.com/p/' + i, timestamp: new Date(Date.UTC(2025, 8, 1) + i * 86400000).toISOString(), likes: i, comments: 0, reach: 10 + i, saves: 0, videoViews: 0 });
const muitos = Array.from({ length: 337 }, (_, i) => postFake(i));
const rec = postsParaListar(muitos);
ok(rec.totalPosts === 337 && rec.paginas === TODOS_CONTEUDOS_MAX_PAGINAS && rec.lista.length === 48, '337 posts viram 8 páginas (48 posts)');
ok(rec.lista[rec.lista.length - 1].id === 'p336' && rec.lista[0].id === 'p289', 'ficam as 48 MAIS RECENTES');
const pouco = postsParaListar(muitos.slice(0, 7));
ok(pouco.lista.length === 7 && pouco.paginas === 2, 'abaixo do teto lista tudo');
ok(sInstagramTodosConteudos(rec.lista.slice(0, 6), 1, 2, 1, 8, 337).includes('as 48 publicações mais recentes de 337'), 'página diz que é recorte');
ok(!sInstagramTodosConteudos(rec.lista.slice(0, 6), 1, 2, 1, 2, 7).includes('mais recentes'), 'sem recorte, sem aviso');
ok(sInstagramPosts(muitos.slice(0, 5), 1, 2, false).includes('Top Conteúdos do Período') && sInstagramPosts(muitos.slice(0, 5), 1, 2).includes('Top Conteúdos do Mês'), 'título acompanha a unidade do período');
ok(sInstagramSpotlight(muitos.slice(0, 5), 1, 2, false).includes('Melhor Conteúdo do Período'), 'melhor conteúdo idem');
const igBaseR = { username: 'lojaromanza', followers: 11641, followers_period: 188, reach: 624089, impressions: 1356642, profile_views: 12035, website_clicks: 1082, accounts_engaged: 2200 };
const igParcialAntR = { ...igBaseR, previous: { followers_period: 0, reach: 434657, impressions: 43445, profile_views: 13451, website_clicks: 1262, accounts_engaged: 0, incompletas: ['reach', 'impressions', 'profile_views', 'website_clicks', 'accounts_engaged'] } };
const htmlAntR = sInstagram(igParcialAntR, 1, 2, 'Setembro de 2025 a Setembro/2026');
ok(!/3022|\+1\.313\.197/.test(htmlAntR) && (htmlAntR.match(/fora dos 2 anos que a Meta guarda/g) || []).length === 5, 'período anterior parcial: nenhum "+3022%", 5 cards avisam');
const igOkR = { ...igBaseR, previous: { followers_period: 0, reach: 434657, impressions: 43445, profile_views: 13451, website_clicks: 1262, accounts_engaged: 0 } };
ok(/\+3022,7%/.test(sInstagram(igOkR, 1, 2, 'x')), 'período anterior completo continua comparando');
const igParcialAtualR = { ...igBaseR, incompletas: ['reach'], previous: igOkR.previous };
const htmlAtualR = sInstagram(igParcialAtualR, 1, 2, 'x');
ok((htmlAtualR.match(/valor parcial — a Meta só guarda 2 anos/g) || []).length === 1 && /\+3022,7%/.test(htmlAtualR), 'só a métrica parcial perde o comparativo');

// ── Funil da planilha do cliente vence Kanban e semântico (Romanza, 07/10) ──
const fp = { funil: { contatos: 556, qualificados: 51, agendamentos: 1, comparecimentos: 0, fechamentos: 0, perdidos: 0, receita: 0 }, funilStages: null,
  funilPlanilha: { degraus: [{ rotulo: 'Leads', cor: '#7dd3fc', valor: 253 }, { rotulo: 'Contatos feitos', cor: '#0ea5e9', valor: 213 }, { rotulo: 'Cadastros', cor: '#10b981', valor: 12 }], desvios: [] }, vendasCohort: null };
const dp = degrausDoFunil(fp);
ok(dp.length === 3 && dp[0].valor === 253 && dp[1].label === 'Contatos feitos' && dp[2].valor === 12, 'com funil da planilha, o relatório mostra os degraus da planilha');
ok(degrausDoFunil({ ...fp, funilPlanilha: null }).length === 5, 'sem planilha, cai no semântico como antes');

console.log(`OK — ${n} asserts`);
