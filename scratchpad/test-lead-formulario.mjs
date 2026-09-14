// Rebuild antes de rodar (o teste importa o BUILD, não o .ts):
//   npx esbuild src/lib/lead-formulario.ts --bundle --platform=node --format=esm --outfile=scratchpad/build/lead-formulario.mjs
import assert from 'node:assert/strict';
import { extrairRespostas, humanizarRotulo, humanizarValor, localDoLead } from './build/lead-formulario.mjs';

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

// ── humanizar ──
eq(humanizarRotulo('qual_procedimento_você_está_interessado_'), 'Qual procedimento você está interessado', 'slug com underscore final');
eq(humanizarRotulo('qual_o_melhor_horário_para_você_realizar_sua_avaliação?'), 'Qual o melhor horário para você realizar sua avaliação?', 'mantém ? que a Meta preservou');
eq(humanizarRotulo('   '), '', 'só espaço vira vazio');
eq(humanizarValor('implante_unitário_'), 'Implante unitário', 'opção slugada');
eq(humanizarValor('tarde_—_das_14h_às_18h'), 'Tarde — das 14h às 18h', 'travessão sobrevive');
eq(humanizarValor('Restaurante'), 'Restaurante', 'texto livre intacto');
eq(humanizarValor('50'), '50', 'número intacto');
eq(humanizarValor('goulartf261@gmail.com'), 'goulartf261@gmail.com', 'e-mail NÃO é capitalizado (parte local é sensível a caixa)');
eq(humanizarValor('não sei'), 'Não sei', 'texto livre ganha maiúscula');

// ── Meta Lead Ads: o raw REAL medido em produção (13/09) ──
const rawMeta = {
  ad_id: '120247949343020601', form_id: '1092513873432444', page_id: '108128822284776',
  adset_id: '120247311779530601', is_organic: false, leadgen_id: '1073698285516469',
  campaign_id: '120247276109650601', created_time: '2026-09-14T01:08:08+0000',
  field_data: [
    { name: 'qual_procedimento_você_está_interessado_', values: ['implante_unitário_'] },
    { name: 'qual_o_melhor_horário_para_você_realizar_sua_avaliação?', values: ['tarde_—_das_14h_às_18h'] },
    { name: 'full_name', values: ['Wanesa Francis Palmeira Luz'] },
    { name: 'phone_number', values: ['+5534991473484'] },
  ],
};
const rMeta = extrairRespostas(rawMeta);
eq(rMeta.length, 2, 'só as 2 perguntas custom — nome e telefone já são cadastro');
eq(rMeta[0], { pergunta: 'Qual procedimento você está interessado', resposta: 'Implante unitário' }, '1ª resposta');
eq(rMeta[1], { pergunta: 'Qual o melhor horário para você realizar sua avaliação?', resposta: 'Tarde — das 14h às 18h' }, '2ª resposta');
ok(!rMeta.some(r => /wanesa|5534/i.test(r.resposta)), 'identidade nunca vaza como resposta');

// ⚠️ campo sem `values` (visto em produção: email_profissional) não vira linha vazia
const rVazio = extrairRespostas({ field_data: [
  { name: 'email_profissional' },
  { name: 'quantas_unidades_está_pensando_em_adquirir?', values: ['50'] },
] });
eq(rVazio.length, 1, 'campo sem resposta é descartado');
eq(rVazio[0].resposta, '50', 'a resposta que existe fica');

// múltipla escolha
eq(extrairRespostas({ field_data: [{ name: 'servicos', values: ['limpeza', 'clareamento'] }] })[0].resposta,
   'Limpeza, Clareamento', 'multi-valor junta com vírgula');

// ── LP / webhook genérico: objeto plano ──
const rLp = extrairRespostas({
  nome: 'Fulano', telefone: '43999999999', email: 'f@x.com', cidade: 'Londrina', estado: 'PR',
  utm_source: 'google', gclid: 'abc', page_url: 'https://x/y', client_id: 'c1',
  faturamento_mensal: 'acima_de_50_mil', quando_pretende_abrir: 'em_3_meses',
});
eq(rLp.length, 2, 'identidade + rastreio fora; só as 2 perguntas do formulário');
eq(rLp.map(r => r.pergunta).sort(), ['Faturamento mensal', 'Quando pretende abrir'], 'perguntas humanizadas');
eq(rLp.find(r => r.pergunta === 'Faturamento mensal').resposta, 'Acima de 50 mil', 'valor humanizado');

// Datalytics: wrapper `{lead:{...}}`
eq(extrairRespostas({ type: 'lead.create', lead: { name: 'X', phone: '43', interesse_principal: 'financiamento' } }),
   [{ pergunta: 'Interesse principal', resposta: 'Financiamento' }], 'entra um nível no wrapper');

// lixo nunca explode
eq(extrairRespostas(null), [], 'null');
eq(extrairRespostas('texto'), [], 'string');
eq(extrairRespostas([1, 2]), [], 'array solto');
eq(extrairRespostas({ field_data: 'nao-e-array' }), [], 'field_data corrompido cai no caminho plano e não acha nada');
eq(extrairRespostas({ obj: { a: 1 } }), [], 'valor aninhado não vira "[object Object]"');

// ── localização: a distinção que motivou a função ──
eq(localDoLead({ city: 'Londrina', regiao_uf: 'PR', regiao_cidade: 'Londrina', regiao_fonte: 'ddd' }),
   { texto: 'Londrina / PR', fonte: 'formulario', rotulo: 'Cidade', detalhe: 'informada pela pessoa no formulário' },
   'cidade declarada VENCE a região do DDD');

const ddd = localDoLead({ regiao_cidade: 'Bauru / Marília', regiao_uf: 'SP', regiao_fonte: 'ddd' });
eq(ddd.rotulo, 'Região', '⚠️ região de DDD NUNCA é rotulada Cidade');
eq(ddd.texto, 'Bauru / Marília / SP', 'texto da região');
eq(ddd.detalhe, 'estimada pelo DDD do telefone', 'diz de onde saiu');

eq(localDoLead({ regiao_cidade: 'Curitiba', regiao_uf: 'PR', regiao_fonte: 'form' }).rotulo, 'Cidade',
   'regiao_fonte=form (leads antigos, antes da coluna city) conta como declarada');
eq(localDoLead({ regiao_cidade: 'São Paulo', regiao_uf: 'SP', regiao_fonte: 'ip' }).rotulo, 'Região', 'IP é estimativa');
eq(localDoLead({ regiao_uf: 'PR', regiao_fonte: 'ddd' }).texto, 'PR', 'só UF ainda informa algo');
eq(localDoLead({}), null, 'lead sem nada devolve null — a tela esconde em vez de mostrar "—"');
eq(localDoLead({ city: '  ', regiao_cidade: '  ', regiao_uf: null }), null, 'string em branco não é dado');

console.log(`✅ ${n} asserts`);
