// node scratchpad/test-biblioteca-anuncios.mjs  (recompilar antes: npx esbuild src/lib/biblioteca-anuncios-ui.ts --format=esm --outfile=scratchpad/build/biblioteca-anuncios-ui.mjs)
import assert from 'node:assert/strict';
import { cidadesCitadas, alertaDeCidade, statusDaMeta, filtrarEOrdenar, resumoBiblioteca, CIDADES_BASE } from './build/biblioteca-anuncios-ui.mjs';
let n=0; const ok=(c,m)=>{assert.ok(c,m);n++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};

// --- cidadesCitadas
eq(cidadesCitadas('Já são mais de 200 empreendedores — e Joinville está aberta'), ['Joinville'], 'cidade simples');
eq(cidadesCitadas('você também pode fazer parte disso aqui em Curitiba!'), ['Curitiba'], 'com pontuação');
eq(cidadesCitadas('Vagas em RIBEIRAO PRETO e Bauru'), ['Ribeirão Preto','Bauru'], 'sem acento + caixa alta');
eq(cidadesCitadas('Ribeirão Prêto está aberta'), ['Ribeirão Preto'], 'grafia da Meta com ê');
eq(cidadesCitadas('Franquia em São José do Rio Preto'), ['São José do Rio Preto'], 'nome longo não vira "São José"');
eq(cidadesCitadas('Clínica em São José dos Pinhais'), ['São José dos Pinhais'], 'idem para Pinhais');
eq(cidadesCitadas('Sorrifácil São José'), ['São José'], 'São José sozinho ainda casa');
eq(cidadesCitadas('Fature acima de R$ 100 mil por mês'), [], 'sem cidade');
eq(cidadesCitadas('curitibano de coração'), [], 'palavra inteira: curitibano não é Curitiba');
eq(cidadesCitadas('unidade em Jataizinho', [...CIDADES_BASE,'Jataizinho']), ['Jataizinho'], 'catálogo dinâmico (geo da conta)');
eq(cidadesCitadas('a Rio das Ostras', ['Rio','Rio das Ostras']), ['Rio das Ostras'], 'nome curto (<4) ignorado');
eq(cidadesCitadas('Maringá Maringá Maringá'), ['Maringá'], 'deduplica');

// --- alertaDeCidade
eq(alertaDeCidade(['Joinville'], ['Curitiba']), 'cidade', 'vídeo de Curitiba em campanha de Joinville');
eq(alertaDeCidade(['Curitiba'], ['Curitiba']), null, 'mesma cidade');
eq(alertaDeCidade(['Curitiba','Paraná'], ['Curitiba']), null, 'região no alvo não atrapalha');
eq(alertaDeCidade([], ['Curitiba']), 'cidade_fraco', 'campanha nacional citando cidade = fraco');
eq(alertaDeCidade(['Paraná'], ['Curitiba']), 'cidade_fraco', 'só estado no alvo = fraco');
eq(alertaDeCidade(['Joinville'], []), null, 'criativo sem cidade');
eq(alertaDeCidade(['Bauru'], ['Bauru','Curitiba']), 'cidade', 'cita a certa E outra = alerta');
eq(alertaDeCidade(['Joinville'], ['Joinville','Curitiba']), 'cidade', 'idem');
eq(alertaDeCidade([], ['Curitiba'], CIDADES_BASE, {alvoIndefinido:true}), null, 'pin sem nome resolvido: alvo indeterminável, sem alerta');
eq(alertaDeCidade(['Curitiba'], ['Londrina'], CIDADES_BASE, {alvoIndefinido:true}), 'cidade', 'pin resolvido para Curitiba + cita Londrina = alerta forte');

// --- statusDaMeta
eq(statusDaMeta('ACTIVE'),'ativo'); eq(statusDaMeta('CAMPAIGN_PAUSED'),'pausado'); eq(statusDaMeta('ADSET_PAUSED'),'pausado');
eq(statusDaMeta('WITH_ISSUES'),'problema'); eq(statusDaMeta('DISAPPROVED'),'problema'); eq(statusDaMeta('PENDING_REVIEW'),'revisao');
eq(statusDaMeta('IN_PROCESS'),'revisao'); eq(statusDaMeta('ARCHIVED'),'arquivado'); eq(statusDaMeta(undefined),'pausado');

// --- filtrarEOrdenar / resumo
const mk=(o)=>({client_id:'c1',client_name:'CondoStore',account_id:'act_1',ad_id:'1',ad_name:'AD',campaign_id:'',campaign_name:'[FORMS] [JOINVILLE]',adset_id:'',adset_name:'',spend:10,impressions:100,clicks:5,leads:1,conversas:0,status:'ativo',created_time:'2026-09-01',preview_url:null,thumb_url:null,tipo:'video',duracao_seg:30,titulo:'',corpo:'',cidades_alvo:['Joinville'],cidades_citadas:[],alerta:null,...o});
const rows=[mk({ad_id:'1',spend:10,leads:1}),mk({ad_id:'2',spend:50,leads:0,alerta:'cidade',cidades_citadas:['Curitiba'],status:'pausado',tipo:'imagem',created_time:'2026-09-20',client_id:'c2',client_name:'Panino'}),mk({ad_id:'3',spend:20,leads:5,cidades_alvo:['Maringá'],campaign_name:'[FORMS] [MARINGÁ]'})];
const base={busca:'',clientId:'',cidade:'',status:'',tipo:'',soAlerta:false,ordem:'gasto'};
eq(filtrarEOrdenar(rows,base).map(r=>r.ad_id),['2','3','1'],'ordem por gasto');
eq(filtrarEOrdenar(rows,{...base,ordem:'leads'}).map(r=>r.ad_id),['3','1','2'],'ordem por leads');
eq(filtrarEOrdenar(rows,{...base,ordem:'recentes'}).map(r=>r.ad_id)[0],'2','mais recentes');
eq(filtrarEOrdenar(rows,{...base,soAlerta:true}).map(r=>r.ad_id),['2'],'só alerta');
eq(filtrarEOrdenar(rows,{...base,cidade:'maringá'}).map(r=>r.ad_id),['3'],'cidade sem caixa');
eq(filtrarEOrdenar(rows,{...base,status:'pausado'}).map(r=>r.ad_id),['2'],'status');
eq(filtrarEOrdenar(rows,{...base,tipo:'imagem'}).map(r=>r.ad_id),['2'],'tipo');
eq(filtrarEOrdenar(rows,{...base,clientId:'c2'}).map(r=>r.ad_id),['2'],'cliente');
eq(filtrarEOrdenar(rows,{...base,busca:'panino'}).map(r=>r.ad_id),['2'],'busca por cliente');
eq(filtrarEOrdenar(rows,{...base,busca:'JOINVILLE'}).map(r=>r.ad_id),['2','1'],'busca por campanha, sem caixa');
const res=resumoBiblioteca(rows); eq([res.anuncios,res.gasto,res.leads,res.videos,res.imagens,res.alertas],[3,80,6,2,1,1],'resumo');
console.log(`OK — ${n} asserts`);
