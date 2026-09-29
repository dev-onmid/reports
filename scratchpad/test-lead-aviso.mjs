// Recompilar: npx esbuild src/lib/lead-aviso.ts --bundle --format=esm --platform=node \
//   --alias:@=./src --external:pg --outfile=scratchpad/build/lead-aviso.mjs
import { fonteDoEvento, parseFontes, formatarTelefone, montarMensagem, FONTES_AVISO,
  respostasDoFormulario, humanizarPergunta, humanizarValor, emailDoFormulario,
  proximaTentativa, MAX_TENTATIVAS, MINUTOS_ATE_DESTRAVAR } from './build/lead-aviso.mjs';

let n = 0, f = 0;
const ok = (c, nome) => { n++; if (!c) { f++; console.log('  ✗', nome); } };

// ── De onde veio ───────────────────────────────────────────────────────────
ok(fonteDoEvento('leadgen:1013737745011285') === 'meta_forms', 'leadgen: → Meta');
ok(fonteDoEvento('lp:abc:hash') === 'landing_page', 'lp: → landing page');
ok(fonteDoEvento('qualquer-coisa') === null, 'webhook genérico fica de fora');
ok(fonteDoEvento(null) === null, 'null fica de fora');
ok(fonteDoEvento('') === null, 'vazio fica de fora');

// ── Fontes configuradas ────────────────────────────────────────────────────
ok(parseFontes('meta_forms').length === 1, 'uma fonte só');
ok(parseFontes('meta_forms,landing_page').length === 2, 'as duas');
ok(parseFontes('meta_forms,meta_forms').length === 1, 'não duplica');
ok(parseFontes('inventado').length === 2, 'valor inválido vira "todas" em vez de silêncio');
ok(parseFontes('').length === 2, 'vazio vira "todas"');
ok(parseFontes(null).length === 2, 'null vira "todas"');
ok(parseFontes('meta_forms,lixo')[0] === 'meta_forms', 'mantém a boa e descarta a ruim');

// ── Telefone legível ───────────────────────────────────────────────────────
ok(formatarTelefone('5514996358710') === '+55 (14) 99635-8710', 'celular com DDI');
ok(formatarTelefone('554488767197') === '+55 (44) 8876-7197', 'fixo/8 dígitos');
ok(formatarTelefone('14996358710') === '+55 (14) 99635-8710', 'sem DDI');
ok(formatarTelefone('') === null, 'vazio');
ok(formatarTelefone('123') === '123', 'lixo curto volta como veio, não vira null enganoso');

// ── A mensagem ─────────────────────────────────────────────────────────────
const completo = montarMensagem({
  nome: 'Gessica Barbosa', numero: '5514996358710', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: '[ON] [FORMS] [MAIO]', anuncio: 'AD4 ANDREIA 2',
  cidade: 'Bauru', uf: 'SP',
});
ok(completo.includes('Gessica Barbosa'), 'nome na mensagem');
ok(completo.includes('*+55 (14) 99635-8710*'), 'telefone em negrito');
ok(completo.includes('Formulário Meta'), 'fonte no título');
ok(completo.includes('[ON] [FORMS] [MAIO]'), 'campanha');
ok(completo.includes('AD4 ANDREIA 2'), 'anúncio');
ok(completo.includes('Bauru · SP'), 'região');
// ⚠️ NENHUMA url na mensagem: o WhatsApp pré-visualiza o primeiro link e a
// miniatura ocupava mais espaço que o lead inteiro. O telefone em formato
// internacional já é tocável — era só isso que o atalho `wa.me` entregava.
ok(!/https?:\/\//.test(completo), 'sem link nenhum — a pré-visualização engolia o aviso');
ok(!completo.includes('wa.me'), 'sem atalho wa.me');
ok(!completo.includes('/crm?'), 'NÃO manda link do nosso CRM (o grupo é do cliente, sem login aqui)');

const semNada = montarMensagem({
  nome: null, numero: null, fonte: 'landing_page',
  canal: null, campanha: null, anuncio: null, cidade: null, uf: null,
});
ok(semNada.includes('Sem nome'), 'lead sem nome não vira linha vazia');
ok(semNada.includes('Landing page'), 'rótulo da landing page');
ok(!/https?:\/\//.test(semNada), 'lead sem telefone também sai sem link');
ok(!semNada.includes('undefined') && !semNada.includes('null'), 'nada de "undefined" no grupo do cliente');

const soCanal = montarMensagem({
  nome: 'João', numero: '5543999998888', fonte: 'landing_page',
  canal: 'LP | CondoStore', campanha: null, anuncio: null, cidade: null, uf: null,
});
ok(soCanal.includes('LP | CondoStore'), 'sem campanha, mostra a origem da LP');

const canalIgual = montarMensagem({
  nome: 'Ana', numero: '5543999998888', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: null, anuncio: null, cidade: null, uf: null,
});
ok((canalIgual.match(/Formulário Meta/g) || []).length === 1, 'não repete o rótulo quando canal == fonte');


// ── Criativo e respostas do formulário ─────────────────────────────────────
// Os dois `raw` abaixo são cópias LITERAIS de eventos reais de produção
// (medidos em 29/09/2026) — se o formato mudar, o teste cai antes do grupo ver.
const RAW_META = {
  ad_id: '120269711352900362', form_id: '2247926169369287', page_id: '109261071624305',
  adset_id: '120267261156750362',
  field_data: [
    { name: 'full_name', values: ['Gessica'] },
    { name: 'email', values: ['gessica.mb@hotmail.com'] },
    { name: 'email_profissional' },
    { name: 'phone_number', values: ['14996358710'] },
    { name: 'quantas_unidades_está_pensando_em_adquirir?', values: ['10'] },
    { name: 'qual_nome_da_empresa?', values: ['Nexxon solar'] },
  ],
  is_organic: false, leadgen_id: '1013737745011285', campaign_id: '120261293401350362',
};
const RAW_LP = {
  nome: 'Walmir Rosário', cidade: 'Guarapuava pr', telefone: '42984347502',
  page_url: 'https://www.condostore.com.br/?utm_source=google',
  observacao: 'Capital disponível: R$ 65 mil a R$ 100 mil\nSimulação: unidades: 150 · investimento: 65000 · lucroAnual: 49680 · paybackMeses: 16',
};

const rMeta = respostasDoFormulario(RAW_META, 'meta_forms');
ok(rMeta.length === 2, 'Meta: só as PERGUNTAS viram resposta (nome/telefone/email ficam de fora)');
ok(rMeta[0].pergunta === 'Quantas unidades está pensando em adquirir?', 'slug do Meta humanizado');
ok(rMeta[0].resposta === '10', 'valor da resposta');
ok(!rMeta.some(r => /_/.test(r.pergunta)), 'nenhum underscore chega no grupo');
ok(!rMeta.some(r => r.pergunta.toLowerCase().includes('email_profissional')), 'campo em branco não vira linha vazia');
ok(humanizarPergunta('qual_procedimento_você_está_interessado_') === 'Qual procedimento você está interessado', 'underscore pendurado no fim');
ok(humanizarPergunta('materia_desejada_para_o_curso:_') === 'Materia desejada para o curso', 'dois-pontos pendurado não vira "::"');
ok(emailDoFormulario(RAW_META, null) === 'gessica.mb@hotmail.com', 'e-mail vem do field_data');
ok(emailDoFormulario({}, ' fulano@x.com ') === 'fulano@x.com', 'sem raw, cai no e-mail do cadastro');
ok(emailDoFormulario({}, '') === null, 'sem e-mail em lugar nenhum → null, não string vazia');

const rLp = respostasDoFormulario(RAW_LP, 'landing_page');
ok(rLp.some(r => r.pergunta === 'Cidade' && r.resposta === 'Guarapuava pr'), 'LP: cidade é campo próprio');
ok(rLp.some(r => r.pergunta === 'Capital disponível'), 'LP: pergunta da observação');
ok(rLp.some(r => r.pergunta === 'Simulação' && r.resposta.includes('unidades: 150')), 'LP: valor com ":" dentro não é cortado');
ok(respostasDoFormulario(null, 'meta_forms').length === 0, 'raw nulo não quebra');
ok(respostasDoFormulario('texto', 'landing_page').length === 0, 'raw que não é objeto não quebra');
ok(respostasDoFormulario({ field_data: 'nao-e-array' }, 'meta_forms').length === 0, 'field_data corrompido não quebra');

const comTudo = montarMensagem({
  nome: 'Gessica Barbosa', numero: '5514996358710', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: '[ON] [FORMS] [MAIO]',
  conjunto: '[AMPLO] [+25]', anuncio: 'AD4 ANDREIA 2',
  cidade: 'Bauru', uf: 'SP',
  email: emailDoFormulario(RAW_META, null), respostas: rMeta,
});
ok(comTudo.includes('*Conjunto:* [AMPLO] [+25]'), 'conjunto com rótulo em negrito');
ok(comTudo.includes('*Criativo:* AD4 ANDREIA 2'), 'criativo com rótulo em negrito');
ok(comTudo.includes('*gessica.mb@hotmail.com*'), 'e-mail em negrito');
ok(comTudo.includes('*Respostas do formulário*'), 'bloco de respostas');
ok(comTudo.includes('• *Qual nome da empresa?* Nexxon solar'), 'pergunta em negrito, sem dois-pontos depois do "?"');
ok(!/https?:\/\//.test(comTudo), 'segue sem link nenhum');

const semRespostas = montarMensagem({
  nome: 'João', numero: '5543999998888', fonte: 'landing_page', canal: 'LP | CondoStore',
  campanha: null, conjunto: null, anuncio: null, cidade: null, uf: null,
});
ok(!semRespostas.includes('Respostas do formulário'), 'sem respostas, o bloco não aparece vazio');
ok(!semRespostas.includes('Conjunto:') && !semRespostas.includes('Criativo:'), 'LP sem criativo não ganha linha em branco');


// ── Valor também vem como slug no Meta (caso real da SorriLeve) ────────────
ok(humanizarValor('implante_unitário_') === 'Implante unitário', 'opção de múltipla escolha vira texto');
ok(humanizarValor('tarde_—_das_14h_às_18h') === 'Tarde — das 14h às 18h', 'travessão e horas preservados');
ok(humanizarValor('Nexxon solar') === 'Nexxon solar', 'texto digitado pela pessoa não é tocado');
ok(humanizarValor('10') === '10', 'número intacto');
ok(humanizarValor('joao_silva@x.com') === 'joao_silva@x.com', 'e-mail com underscore NÃO é estragado');
ok(humanizarValor('/lp-sorrifacil/') === '/lp-sorrifacil/', 'caminho de url intacto');
ok(humanizarValor('https://x.com/a_b') === 'https://x.com/a_b', 'url intacta');
const rSorri = respostasDoFormulario({ field_data: [
  { name: 'qual_procedimento_você_está_interessado_', values: ['implante_unitário_'] },
  { name: 'qual_o_melhor_horário_para_você_realizar_sua_avaliação?', values: ['tarde_—_das_14h_às_18h'] },
]}, 'meta_forms');
ok(rSorri[0].resposta === 'Implante unitário', 'caso real SorriLeve: resposta legível');
ok(rSorri[1].resposta === 'Tarde — das 14h às 18h', 'caso real SorriLeve: horário legível');


// ── Fila de envios ─────────────────────────────────────────────────────────
const T0 = new Date('2026-09-29T12:00:00.000Z');
const min = (d) => Math.round((d.getTime() - T0.getTime()) / 60000);
ok(min(proximaTentativa(1, T0)) === 1, '1ª falha: tenta de novo em 1 min');
ok(min(proximaTentativa(2, T0)) === 2, '2ª falha: 2 min');
ok(min(proximaTentativa(3, T0)) === 5, '3ª falha: 5 min');
ok(min(proximaTentativa(4, T0)) === 15, '4ª falha: 15 min');
ok(min(proximaTentativa(5, T0)) === 30, '5ª falha: 30 min');
ok(min(proximaTentativa(6, T0)) === 60, '6ª falha: 1 h');
ok(min(proximaTentativa(20, T0)) === 60, 'espera satura em 1 h — não cresce para sempre');
ok(min(proximaTentativa(0, T0)) === 1, 'contagem zerada não quebra o índice');
ok(min(proximaTentativa(-5, T0)) === 1, 'contagem negativa não vira data no passado');
ok(proximaTentativa(3, T0) > T0, 'a próxima tentativa NUNCA cai no passado');
ok(MAX_TENTATIVAS >= 12, 'insiste por horas antes de desistir');
ok(MINUTOS_ATE_DESTRAVAR >= 5, 'só destrava "enviando" depois de tempo suficiente para um envio lento terminar');

// Com a escala de espera, quanto tempo o sistema insiste antes de desistir?
let acumulado = 0;
for (let t = 1; t <= MAX_TENTATIVAS; t++) acumulado += min(proximaTentativa(t, T0));
ok(acumulado > 60 * 12, `insiste por mais de 12 h no total (deu ${Math.round(acumulado / 60)} h)`);


// ── Negrito (pedido do Matheus em 29/09) ───────────────────────────────────
const NEG = montarMensagem({
  nome: 'Augusto Mikael Pierre', numero: '5585988488991', fonte: 'meta_forms',
  canal: 'Formulário Meta', campanha: '[ON] [FORMS] [MAIO]', conjunto: '[AMPLO] [+25]',
  anuncio: '[AD10] Pasta Convenção', cidade: 'Fortaleza', uf: 'CE',
  email: 'mikael-pierre@uol.com.br',
  respostas: [
    { pergunta: 'Quantas unidades está pensando em adquirir?', resposta: '10' },
    { pergunta: 'Qual nome da empresa?', resposta: 'Grupo Odres' },
    { pergunta: 'Cidade', resposta: 'Londrina' },
  ],
});
ok(NEG.includes('*Augusto Mikael Pierre*'), 'nome em negrito');
ok(NEG.includes('*+55 (85) 98848-8991*'), 'telefone em negrito');
ok(NEG.includes('*mikael-pierre@uol.com.br*'), 'e-mail em negrito');
ok(NEG.includes('*Campanha:* [ON] [FORMS] [MAIO]'), 'rótulo Campanha em negrito, valor normal');
ok(NEG.includes('*Região:* Fortaleza · CE'), 'rótulo Região em negrito');
ok(NEG.includes('• *Quantas unidades está pensando em adquirir?* 10'), 'pergunta em negrito');
ok(NEG.includes('• *Cidade:* Londrina'), 'pergunta sem "?" ganha dois-pontos');
ok(!NEG.includes('?:'), 'nunca sai "?:" — pontuação em cima de pontuação');
// o número de asteriscos tem que ser PAR, senão o WhatsApp deixa um negrito aberto
ok((NEG.match(/\*/g) || []).length % 2 === 0, 'asteriscos pareados: nenhum negrito fica aberto');

const SUJO = montarMensagem({
  nome: 'Fulano *da* Silva', numero: '5543999998888', fonte: 'landing_page',
  canal: 'LP *promo*', campanha: 'Campanha *X*', conjunto: null, anuncio: null,
  cidade: null, uf: null, email: null,
  respostas: [{ pergunta: 'Qual *item*', resposta: 'resposta *com* asterisco' }],
});
ok(!SUJO.includes('*da*'), 'asterisco vindo no dado é removido');
ok((SUJO.match(/\*/g) || []).length % 2 === 0, 'dado com asterisco não desalinha o negrito');
ok(SUJO.includes('Fulano da Silva'), 'o texto em si é preservado, só o marcador sai');

console.log(f === 0 ? `\n✅ ${n} asserts OK` : `\n❌ ${f} de ${n} falharam`);
process.exit(f === 0 ? 0 : 1);
