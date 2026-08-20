// Testes do destino de disparo por CLIENTE (disparos-destinos.ts).
//
// Compilar antes (bundle porque a lib importa @/lib/client-name em runtime):
//   npx esbuild src/lib/disparos-destinos.ts --outfile=scratchpad/build/disparos-destinos.mjs \
//     --format=esm --bundle --external:pg --alias:@=./src --log-level=warning
//   node scratchpad/test-disparos-destinos.mjs
//
// ATENCAO: rodar sem recompilar exercita o codigo ANTIGO e da falso "OK".

import assert from 'node:assert';
import {
  estaConectada, montarDestinos, instanciasOrfas, nomeConfere,
  classificarErroEnvio, mensagemPausaAutomatica,
} from './build/disparos-destinos.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// ── estaConectada: só 'open' envia ──────────────────────────────────
eq(estaConectada('open'), true, 'open conecta');
eq(estaConectada('OPEN'), true, 'caixa alta conecta');
eq(estaConectada('close'), false, 'close nao conecta');
eq(estaConectada('connecting'), false, 'connecting NAO conecta (envio ali falha)');
eq(estaConectada(null), false, 'null nao conecta');
eq(estaConectada(undefined), false, 'undefined nao conecta');
eq(estaConectada(''), false, 'vazio nao conecta');

// ── Cenário REAL de producao (20/08) ────────────────────────────────
const vivas = [
  { name: 'saac-43-9616-7637', connectionStatus: 'close' },
  { name: 'dominos-69-3222-6446', connectionStatus: 'open' },
  { name: 'picolocos-prochet-43-8477-7390', connectionStatus: 'open' },
  { name: 'picolocos-guanabara---43-9978-0123', connectionStatus: 'close' },
  { name: 'disparo-saac-2-0-mt1up1py', connectionStatus: 'open' },
  { name: 'Onmid Assistente', connectionStatus: 'open' },
];
const vinculos = [
  { clientId: 'c-saac', clientName: 'Saac Equipamentos', instanceId: 'saac-43-9616-7637', nome: 'SAAC', provider: 'evolution' },
  { clientId: 'c-dom', clientName: 'Dominos', instanceId: 'dominos-69-3222-6446', nome: 'Dominos', provider: 'evolution' },
  { clientId: 'c-pico', clientName: 'PicoLocos', instanceId: 'picolocos-prochet-43-8477-7390', nome: 'Prochet', provider: 'evolution' },
  { clientId: 'c-pico', clientName: 'PicoLocos', instanceId: 'picolocos-guanabara---43-9978-0123', nome: 'Guanabara', provider: 'evolution' },
  // O caso que quebrou: vinculo aponta pra instancia que a Evolution nao tem mais.
  { clientId: 'c-morto', clientName: 'Cliente Fantasma', instanceId: 'disparo-saac-msxk52o2', nome: 'SAAC velha', provider: 'evolution' },
];

const dest = montarDestinos(vinculos, vivas);
eq(dest.length, 4, '4 clientes distintos');

const dom = dest.find(d => d.clientId === 'c-dom');
eq(dom.disponivel, true, 'Dominos disponivel');
eq(dom.instancias[0].conectada, true, 'instancia do Dominos conectada');
eq(dom.instancias[0].impedimento, '', 'sem impedimento');

const saac = dest.find(d => d.clientId === 'c-saac');
eq(saac.disponivel, false, 'Saac indisponivel (WhatsApp close)');
eq(saac.instancias[0].existe, true, 'instancia da Saac EXISTE no servidor');
eq(saac.instancias[0].impedimento, 'desconectada', 'motivo: desconectada');
ok(dest.some(d => d.clientId === 'c-saac'), 'cliente indisponivel APARECE na lista (nao some)');

// A armadilha do dia 20/08: instancia vinculada que nao existe mais.
const morto = dest.find(d => d.clientId === 'c-morto');
eq(morto.instancias[0].existe, false, 'instancia apagada: existe=false');
eq(morto.instancias[0].conectada, false, 'instancia apagada nao conecta');
eq(morto.instancias[0].impedimento, 'inexistente', 'motivo distingue apagada de desconectada');
eq(morto.disponivel, false, 'cliente com instancia apagada fica indisponivel');

// Cliente com 2 instancias: conectada primeiro.
const pico = dest.find(d => d.clientId === 'c-pico');
eq(pico.instancias.length, 2, 'PicoLocos com 2 instancias');
eq(pico.instancias[0].nome, 'Prochet', 'conectada vem primeiro no seletor');
eq(pico.instancias[1].conectada, false, 'a desconectada vem depois');
eq(pico.disponivel, true, 'basta UMA conectada pra ficar disponivel');

// Ordenacao geral: disponiveis antes dos bloqueados.
eq(dest[0].disponivel, true, 'primeiro da lista e disponivel');
eq(dest[dest.length - 1].disponivel, false, 'ultimo e bloqueado');

// Dedupe: mesma instancia duplicada pro mesmo cliente entra uma vez so.
const dup = montarDestinos(
  [vinculos[1], { ...vinculos[1], nome: 'Dominos copia' }], vivas);
eq(dup[0].instancias.length, 1, 'instancia duplicada nao duplica no seletor');

// Vinculo sem cliente/instancia e ignorado em vez de virar linha quebrada.
eq(montarDestinos([{ clientId: '', clientName: 'X', instanceId: 'a', nome: 'a', provider: 'evolution' }], vivas).length, 0, 'vinculo sem clientId fora');
eq(montarDestinos([{ clientId: 'c', clientName: 'X', instanceId: '', nome: 'a', provider: 'evolution' }], vivas).length, 0, 'vinculo sem instancia fora');

// ── Orfas: a instancia que esta disparando HOJE ─────────────────────
const orfas = instanciasOrfas(vivas, vinculos, ['disparo-saac-2-0-mt1up1py', 'Onmid Assistente']);
eq(orfas.length, 2, 'duas instancias sem cliente vinculado');
ok(orfas.some(o => o.instanceId === 'disparo-saac-2-0-mt1up1py'), 'SAAC 2.0 aparece como orfa (senao sumiria da tela sem explicacao)');
ok(orfas.every(o => o.conectada), 'as duas orfas do cenario estao conectadas');
eq(orfas.find(o => o.instanceId === 'Onmid Assistente').emDisparos, true, 'marca que ja e instancia de Disparos');
ok(!orfas.some(o => o.instanceId === 'dominos-69-3222-6446'), 'instancia vinculada nao aparece como orfa');

// ── Confirmacao por digitacao ───────────────────────────────────────
eq(nomeConfere('Saac Equipamentos', 'Saac Equipamentos'), true, 'nome exato passa');
eq(nomeConfere('saac equipamentos', 'Saac Equipamentos'), true, 'caixa ignorada');
eq(nomeConfere('  Saac   Equipamentos  ', 'Saac Equipamentos'), true, 'espaco extra ignorado');
eq(nomeConfere('Sorrifacil Cambe', 'Sorrifácil Cambé'), true, 'acento ignorado (ninguem digita acento com pressa)');
eq(nomeConfere('Sorrifácil', 'Sorrifácil Cambé'), false, 'prefixo NAO passa — 5 Sorrifacil diferentes');
eq(nomeConfere('Sorrifácil Cambé', 'Sorrifácil Londrina'), false, 'cliente errado nao passa');
eq(nomeConfere('', 'Saac Equipamentos'), false, 'vazio nao passa');
eq(nomeConfere('   ', 'Saac Equipamentos'), false, 'so espaco nao passa');
eq(nomeConfere('Panino 77', "Panino'77"), true, 'pontuacao ignorada');

// ── Classificacao de erro: payloads REAIS de producao ───────────────
const erro404 = 'Evolution sendMedia failed: 5544997604966: {"status":404,"error":"Not Found","response":{"message":["The \\"disparo-saac-msxk52o2\\" instance does not exist"]}}';
eq(classificarErroEnvio(erro404), 'instancia', '404 instance does not exist = falha NOSSA');

const erroNumero = 'Evolution sendMedia failed: 554432336558: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"554432336558@s.whatsapp.net","exists":false,"number":"554432336558"}]}}';
eq(classificarErroEnvio(erroNumero), 'numero', 'exists:false = numero sem WhatsApp (queima certo)');

eq(classificarErroEnvio('Evolution sendText failed: Connection Closed'), 'instancia', 'Connection Closed = instancia');
eq(classificarErroEnvio('{"status":404,"error":"Not Found"}'), 'instancia', 'status 404 cru = instancia');
eq(classificarErroEnvio('instance is not connected'), 'instancia', 'not connected = instancia');
eq(classificarErroEnvio('{"status":500,"error":"Internal Server Error"}'), 'outro', '500 generico nao vira falso positivo de instancia');
eq(classificarErroEnvio('timeout of 20000ms exceeded'), 'outro', 'timeout e outro');
eq(classificarErroEnvio(''), 'outro', 'vazio e outro');
eq(classificarErroEnvio(null), 'outro', 'null nao explode');

// A ordem importa: um payload que tenha exists:false E 404 e do NUMERO.
eq(classificarErroEnvio('{"status":404,"message":[{"exists":false}]}'), 'numero',
  'exists:false vence 404 — nunca pausar campanha por causa de um numero ruim');

// ── Mensagem de alerta ──────────────────────────────────────────────
const msg = mensagemPausaAutomatica({
  campanha: '[ON] [SAAC]', cliente: 'Saac Equipamentos',
  instancia: 'saac-43-9616-7637', motivo: 'instância não existe mais', restantes: 899,
});
ok(msg.includes('899'), 'alerta diz quantos sobraram');
ok(msg.includes('Saac Equipamentos'), 'alerta nomeia o cliente');
ok(msg.includes('nenhum foi queimado'), 'alerta tranquiliza sobre a lista');

console.log(`OK — ${n} asserts`);

// ── classificarFalhaSonda: definitivo x passageiro ──────────────────
import { classificarFalhaSonda, estadoDoState } from './build/disparos-destinos.mjs';
let m = 0;
const eq2 = (a, b, msg) => { assert.strictEqual(a, b, msg); m++; };
eq2(classificarFalhaSonda('HTTP 404'), 'inexistente', '404 = instancia apagada (pausa)');
eq2(classificarFalhaSonda('The "x" instance does not exist'), 'inexistente', 'texto explicito = apagada');
eq2(classificarFalhaSonda('fetch failed'), 'indisponivel', 'rede caiu = passageiro (NAO pausa)');
eq2(classificarFalhaSonda('HTTP 502'), 'indisponivel', '502 = Evolution reiniciando, nao pausa campanha boa');
eq2(classificarFalhaSonda('ECONNREFUSED'), 'indisponivel', 'recusa de conexao = passageiro');
eq2(classificarFalhaSonda(''), 'indisponivel', 'sem mensagem = trata como passageiro');
eq2(estadoDoState('open'), 'conectada', 'open dispara');
eq2(estadoDoState('close'), 'desconectada', 'close pausa a campanha');
eq2(estadoDoState('connecting'), 'indisponivel', 'connecting NAO pausa — so adia (reconexao e normal)');
eq2(estadoDoState('unknown'), 'desconectada', 'estado desconhecido nao dispara');
eq2(estadoDoState(null), 'desconectada', 'null nao dispara');
console.log(`OK — +${m} asserts da sonda`);
