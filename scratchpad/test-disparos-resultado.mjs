/**
 * Compile antes:
 *   npx esbuild src/lib/disparos-resultado.ts --bundle --outfile=scratchpad/build/disparos-resultado.mjs --format=esm --platform=node --external:pg --alias:@=./src
 *   node scratchpad/test-disparos-resultado.mjs
 */
import assert from 'node:assert/strict';
import { classificarConversa, ehAutomatica, atribuirPedidosAosEnvios } from './build/disparos-resultado.mjs';
let n = 0; const eq = (a, b, m) => { assert.deepEqual(a, b, `${m} — veio ${JSON.stringify(a)}`); n++; };
const E = '2026-10-02T10:00:00.000Z';
const at = (min, seg = 0) => new Date(Date.parse(E) + min * 60_000 + seg * 1000).toISOString();
const cls = (msgs) => classificarConversa(E, msgs).classe;

// textos REAIS da Prospeção Clínicas (03/10)
eq(cls([{ texto: 'Olá! Você entrou em contato com o consultório do Dr André Peterlini! Agradecemos seu contato', em: at(0, 30) }]), 'automatica', 'robô de consultório');
eq(cls([{ texto: 'Olá, ficamos muito felizes com seu contato! Não estamos disponíveis no momento, mas responderemos', em: at(0, 20) }]), 'automatica', 'robô fora do horário');
eq(cls([{ texto: 'Dra Augusta Piovezan agradece seu contato. Como podemos ajudar?', em: at(10) }]), 'automatica', 'agradece seu contato = robô mesmo após 10 min');
eq(cls([{ texto: 'Seja bem-vinda(o) ao atendimento da clínica', em: at(0, 30) }]), 'automatica', 'seja bem-vinda');
eq(cls([{ texto: '✨Aqui é a Dra Soraia. Obrigada pela mensagem!! Para agilizar os atendimentos', em: at(0, 20) }, { texto: 'Bom dia! Aqui é a Cássia, secretária', em: at(15) }]), 'humana', 'robô primeiro, pessoa depois = humana');
eq(classificarConversa(E, [{ texto: 'Obrigada pela mensagem!!', em: at(0, 20) }, { texto: 'Bom dia, Cássia aqui', em: at(15) }]).principal.texto, 'Bom dia, Cássia aqui', 'principal é a 1ª humana');
eq(cls([{ texto: 'Bom dia Mateus', em: at(6) }]), 'humana', 'saudação humana');
eq(cls([{ texto: 'Oi', em: at(0, 3) }]), 'automatica', 'menos de 5 s = robô');
eq(cls([{ texto: 'Oi', em: at(0, 40) }]), 'humana', '40 s = pessoa');
eq(cls([{ texto: 'Quero um bowl, qual o valor?', em: at(20) }]), 'interesse', 'pedido/valor = interesse');
eq(cls([{ texto: 'Me manda o cardápio', em: at(20) }]), 'interesse', 'cardápio = interesse');
eq(cls([{ texto: 'Sair', em: at(5) }]), 'parar', 'opt-out');
eq(cls([{ texto: 'Não', em: at(1) }]), 'humana', '"Não" sozinho não é opt-out (detector conservador)');
eq(cls([]), 'sem_resposta', 'sem mensagem');
eq(ehAutomatica({ texto: 'Horário de atendimento: seg a sex', em: at(30) }, E), true, 'horário de atendimento');

// atribuição de pedidos
const envios = [
  { envioId: 'a1', campanhaId: 'A', chave: '4399990000', enviadoEm: '2026-09-01T12:00:00Z' },
  { envioId: 'b1', campanhaId: 'B', chave: '4399990000', enviadoEm: '2026-09-03T12:00:00Z' },
  { envioId: 'a2', campanhaId: 'A', chave: '4388880000', enviadoEm: '2026-09-01T12:00:00Z' },
];
const pedidos = [
  { chave: '4399990000', criadoEm: '2026-09-04T20:00:00Z', total: 50 },          // → b1 (mais recente)
  { chave: '4399990000', criadoEm: '2026-09-02T20:00:00Z', total: 30 },          // → a1 (b1 ainda não existia)
  { chave: '4388880000', criadoEm: '2026-09-20T20:00:00Z', total: 99 },          // fora da janela de 7 dias
  { chave: '4388880000', criadoEm: '2026-08-31T20:00:00Z', total: 99 },          // antes do envio
  { chave: '4388880000', criadoEm: '2026-09-02T20:00:00Z', total: 40, cancelado: true }, // cancelado
  { chave: '4388880000', criadoEm: '2026-09-05T20:00:00Z', total: 25.5 },        // → a2
];
const at2 = atribuirPedidosAosEnvios(envios, pedidos, 7);
eq(at2.get('b1'), { pedidos: 1, receita: 50, primeiroPedidoEm: '2026-09-04T20:00:00Z' }, 'pedido vai para o envio MAIS RECENTE');
eq(at2.get('a1'), { pedidos: 1, receita: 30, primeiroPedidoEm: '2026-09-02T20:00:00Z' }, 'pedido antes do 2º envio fica com o 1º');
eq(at2.get('a2'), { pedidos: 1, receita: 25.5, primeiroPedidoEm: '2026-09-05T20:00:00Z' }, 'fora da janela, antes do envio e cancelado não contam');
const soma = [...at2.values()].reduce((s, v) => s + v.receita, 0);
eq(soma, 105.5, 'nenhum pedido conta duas vezes (soma = 50+30+25,5)');
console.log(`\n✅ ${n} asserts passaram`);
