// Testes da segmentacao de Fidelidade (fidelidade.ts).
//
// Compilar antes (a lib e TS e o Node nao le TS direto). Aqui e esbuild, e nao
// tsc, porque a lib importa um TIPO de '@/lib/cardapioweb-recorrencia': o tsc
// solto nao resolve o alias e sai com erro (ainda que emita), enquanto o
// esbuild apaga o import de tipo e termina limpo.
//   npx esbuild src/lib/fidelidade.ts --outfile=scratchpad/build/fidelidade.mjs --format=esm --log-level=warning
//   node scratchpad/test-fidelidade.mjs
//
// ATENCAO: rodar sem recompilar exercita o codigo ANTIGO e da falso "OK".

import assert from 'node:assert';
import {
  filtrarPublico, resumirSegmento, normalizarParams, paramsPadrao, normalizarTravas,
  capacidadeDaJanela, diasParaVarrer, aplicarVars, varsDoCliente, variaveisDesconhecidas,
  limparMensagens, primeiroNome, MODELOS_FIDELIDADE, ORDEM_MODELOS, TRAVAS_PADRAO,
  PISO_INTERVALO_SEG, normalizarCupom, variaveisIndisponiveis, validarCampanha,
  varsDoDestinatario, parseListaManual, dentroDaJanela, diaPermitido, proximaExecucao,
  MENSAGENS_LISTA_PADRAO,
} from './build/fidelidade.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const REGUA = { janelaDias: 30, inatividadeDias: 60 };
const CTX = { regua: REGUA, ticketMedioLoja: 100 };

/** Cliente final sintetico com os campos que o filtro le. */
function cli(over = {}) {
  return {
    chave: over.telefone ?? '43999990000',
    nome: 'Maria Souza',
    telefone: '43999990000',
    etapa: 'recorrente',
    pedidos: 3,
    receita: 300,
    ticketMedio: 100,
    primeiraCompra: '2026-01-01T12:00:00.000Z',
    ultimaCompra: '2026-08-01T12:00:00.000Z',
    diasDesdeUltima: 5,
    intervaloMedianoDias: 20,
    ...over,
  };
}

const P = (m) => paramsPadrao(m);

// ── Trava universal: sem telefone ninguem recebe ───────────────────────────────
{
  // Cliente identificado so pelo id interno do Cardapio Web (chave "id:123").
  const semFone = cli({ telefone: null, chave: 'id:123', pedidos: 1, diasDesdeUltima: 30, etapa: 'novo' });
  for (const modelo of ORDEM_MODELOS) {
    const r = filtrarPublico([semFone], modelo, P(modelo), CTX);
    eq(r.length, 0, `${modelo}: cliente sem telefone nao pode entrar`);
  }
}

// ── Comprou uma vez so ────────────────────────────────────────────────────────
{
  const m = 'primeira_recompra'; // padrao: diasMin 10, diasMax 120
  const dentro = cli({ pedidos: 1, diasDesdeUltima: 30, etapa: 'novo' });
  const cedo = cli({ pedidos: 1, diasDesdeUltima: 3, etapa: 'novo', telefone: '4399999001' });
  const tarde = cli({ pedidos: 1, diasDesdeUltima: 200, etapa: 'inativo', telefone: '4399999002' });
  const doisPedidos = cli({ pedidos: 2, diasDesdeUltima: 30, etapa: 'em_risco', telefone: '4399999003' });

  eq(filtrarPublico([dentro, cedo, tarde, doisPedidos], m, P(m), CTX).length, 1,
    'so o cliente de 1 pedido dentro da janela de dias');
  eq(filtrarPublico([dentro], m, P(m), CTX)[0].telefone, dentro.telefone, 'e e o certo');

  // Borda: diasMin e diasMax sao INCLUSIVOS nos dois extremos.
  eq(filtrarPublico([cli({ pedidos: 1, diasDesdeUltima: 10 })], m, P(m), CTX).length, 1, 'diasMin inclusivo');
  eq(filtrarPublico([cli({ pedidos: 1, diasDesdeUltima: 120 })], m, P(m), CTX).length, 1, 'diasMax inclusivo');
  eq(filtrarPublico([cli({ pedidos: 1, diasDesdeUltima: 9 })], m, P(m), CTX).length, 0, 'um dia antes fica fora');
  eq(filtrarPublico([cli({ pedidos: 1, diasDesdeUltima: 121 })], m, P(m), CTX).length, 0, 'um dia depois fica fora');

  // Regua editada pelo gestor manda.
  eq(filtrarPublico([cli({ pedidos: 1, diasDesdeUltima: 3 })], m, { diasMin: 2, diasMax: 5 }, CTX).length, 1,
    'regua customizada substitui o padrao');
}

// ── Em risco x Inativo: a particao por numero de pedidos ──────────────────────
{
  const umPedidoEmRisco = cli({ pedidos: 1, etapa: 'em_risco', diasDesdeUltima: 40 });
  eq(filtrarPublico([umPedidoEmRisco], 'em_risco', P('em_risco'), CTX).length, 0,
    'cliente de 1 pedido NAO entra em em_risco (e da primeira recompra)');
  eq(filtrarPublico([umPedidoEmRisco], 'primeira_recompra', P('primeira_recompra'), CTX).length, 1,
    'e entra na primeira recompra');

  const umPedidoInativo = cli({ pedidos: 1, etapa: 'inativo', diasDesdeUltima: 90 });
  eq(filtrarPublico([umPedidoInativo], 'inativo', P('inativo'), CTX).length, 0,
    'cliente de 1 pedido NAO entra em inativo');

  const doisEmRisco = cli({ pedidos: 2, etapa: 'em_risco', diasDesdeUltima: 40 });
  eq(filtrarPublico([doisEmRisco], 'em_risco', P('em_risco'), CTX).length, 1, 'em risco com 2 pedidos entra');
  eq(filtrarPublico([doisEmRisco], 'inativo', P('inativo'), CTX).length, 0, 'e nao vaza para inativo');

  // Teto de seguranca: numero muito velho fica fora (risco de denuncia).
  const sumidoDemais = cli({ pedidos: 4, etapa: 'inativo', diasDesdeUltima: 300 });
  eq(filtrarPublico([sumidoDemais], 'inativo', P('inativo'), CTX).length, 0,
    'sumido ha 300 dias fica fora do resgate (padrao 180)');
  eq(filtrarPublico([sumidoDemais], 'inativo', { pedidosMin: 2, diasMax: 365 }, CTX).length, 1,
    'mas entra se o gestor esticar a regua');

  // O teto do proprio campo e 365: nem esticando da pra alcancar quem sumiu ha
  // dois anos. E deliberado — numero antigo tende a estar trocado, e denuncia
  // derruba o WhatsApp da loja.
  eq(normalizarParams('inativo', { diasMax: 900 }).diasMax, 365, 'regua de inatividade nao passa de 365d');
  eq(filtrarPublico([cli({ pedidos: 4, etapa: 'inativo', diasDesdeUltima: 800 })],
    'inativo', { pedidosMin: 2, diasMax: 900 }, CTX).length, 0,
    'sumido ha 800 dias e inalcancavel por qualquer regua');
}

// ── VIP: OU pedidos OU ticket, e so cliente vivo ─────────────────────────────
{
  const m = 'vip'; // padrao: pedidosMin 4, ticketMin null => 1,5x ticket da loja (150)
  const porVolume = cli({ pedidos: 6, ticketMedio: 50, etapa: 'recorrente' });
  const porTicket = cli({ pedidos: 2, ticketMedio: 200, etapa: 'recorrente', telefone: '4399999011' });
  const comum = cli({ pedidos: 2, ticketMedio: 80, etapa: 'recorrente', telefone: '4399999012' });
  const vipSumido = cli({ pedidos: 9, ticketMedio: 300, etapa: 'inativo', telefone: '4399999013' });
  const vipEmRisco = cli({ pedidos: 9, ticketMedio: 300, etapa: 'em_risco', telefone: '4399999014' });

  const r = filtrarPublico([porVolume, porTicket, comum, vipSumido, vipEmRisco], m, P(m), CTX);
  eq(r.length, 2, 'entra por volume OU por ticket, e ninguem mais');
  ok(r.some(c => c.telefone === porVolume.telefone), 'quem tem muitos pedidos entra');
  ok(r.some(c => c.telefone === porTicket.telefone), 'quem tem ticket alto entra');
  ok(!r.some(c => c.telefone === vipSumido.telefone), 'VIP inativo NAO recebe elogio — e caso de resgate');
  ok(!r.some(c => c.telefone === vipEmRisco.telefone), 'VIP em risco tambem nao');

  // Ticket automatico segue a loja: na loja cara, o mesmo cliente deixa de ser VIP.
  const lojaCara = { regua: REGUA, ticketMedioLoja: 400 }; // limiar vira 600
  eq(filtrarPublico([porTicket], m, P(m), lojaCara).length, 0,
    'regua relativa acompanha o ticket medio da loja');
  eq(filtrarPublico([porTicket], m, { pedidosMin: 4, ticketMin: 150 }, lojaCara).length, 1,
    'ticket explicito vence o automatico');

  // Reconquistado tambem e cliente vivo.
  eq(filtrarPublico([cli({ pedidos: 8, etapa: 'reconquistado' })], m, P(m), CTX).length, 1,
    'reconquistado com muitos pedidos entra no VIP');
}

// ── Reconquistado: janela curta ──────────────────────────────────────────────
{
  const m = 'reconquistado'; // padrao: diasMax 15
  eq(filtrarPublico([cli({ etapa: 'reconquistado', diasDesdeUltima: 3 })], m, P(m), CTX).length, 1,
    'voltou ha 3 dias entra');
  eq(filtrarPublico([cli({ etapa: 'reconquistado', diasDesdeUltima: 40 })], m, P(m), CTX).length, 0,
    'voltou ha 40 dias ja passou da janela de reforco');
  eq(filtrarPublico([cli({ etapa: 'recorrente', diasDesdeUltima: 3 })], m, P(m), CTX).length, 0,
    'recorrente comum nao e reconquistado');
}

// ── Nenhum modelo alcanca quem so tem pedido cancelado ───────────────────────
{
  // `agruparPorCliente` ja devolve etapa null nesse caso e o cliente nem chega
  // aqui; o teste garante que ninguem inventou um ramo que aceite etapa vazia.
  const semEtapa = cli({ etapa: null, pedidos: 0, diasDesdeUltima: 10 });
  for (const modelo of ORDEM_MODELOS) {
    eq(filtrarPublico([semEtapa], modelo, P(modelo), CTX).length,
      modelo === 'primeira_recompra' ? 0 : 0, `${modelo}: sem etapa valida fica fora`);
  }
}

// ── Resumo do segmento ───────────────────────────────────────────────────────
{
  const vazio = resumirSegmento([]);
  eq(vazio.pessoas, 0, 'segmento vazio: zero pessoas');
  eq(vazio.diasParadoMediano, null, 'segmento vazio nao inventa mediana');

  const r = resumirSegmento([
    cli({ pedidos: 2, receita: 200, diasDesdeUltima: 10 }),
    cli({ pedidos: 3, receita: 600, diasDesdeUltima: 50 }),
    cli({ pedidos: 5, receita: 200, diasDesdeUltima: 90 }),
  ]);
  eq(r.pessoas, 3, 'conta as pessoas');
  eq(r.receitaHistorica, 1000, 'soma a receita historica');
  eq(r.ticketMedio, 100, 'ticket = receita total / pedidos totais (1000/10)');
  eq(r.diasParadoMediano, 50, 'mediana, nao media (media seria 50 aqui tambem: use par)');

  const par = resumirSegmento([
    cli({ diasDesdeUltima: 10 }), cli({ diasDesdeUltima: 20 }),
    cli({ diasDesdeUltima: 30 }), cli({ diasDesdeUltima: 1000 }),
  ]);
  eq(par.diasParadoMediano, 25, 'mediana de lista par ignora a cauda longa (media seria 265)');
}

// ── Params: normalizacao e limites ───────────────────────────────────────────
{
  eq(normalizarParams('em_risco', { pedidosMin: 999 }).pedidosMin, 50, 'grampeia no maximo do campo');
  eq(normalizarParams('em_risco', { pedidosMin: 0 }).pedidosMin, 2, 'grampeia no minimo do campo');
  eq(normalizarParams('em_risco', { pedidosMin: 'abc' }).pedidosMin, 2, 'texto invalido cai no padrao');
  eq(normalizarParams('em_risco', {}).diasMax, 90, 'campo ausente cai no padrao');
  eq(normalizarParams('vip', { ticketMin: null }).ticketMin, null, 'ticket null continua automatico');
  eq(normalizarParams('vip', { ticketMin: 250 }).ticketMin, 250, 'ticket explicito e preservado');
  eq(normalizarParams('em_risco', null).pedidosMin, 2, 'params nulo nao quebra');

  // Um param invalido nao pode fazer o filtro cuspir a base inteira.
  const base = [cli({ pedidos: 1, diasDesdeUltima: 300, etapa: 'inativo' })];
  eq(filtrarPublico(base, 'primeira_recompra', { diasMin: 'x', diasMax: null }, CTX).length, 0,
    'params corrompidos caem no padrao, nao viram "sem filtro"');
}

// ── Travas ───────────────────────────────────────────────────────────────────
{
  eq(normalizarTravas({ intervaloMinSeg: 5 }).intervaloMinSeg, PISO_INTERVALO_SEG,
    'nenhuma campanha nasce abaixo do piso anti-bloqueio de 90s');
  eq(normalizarTravas({}).intervaloMinSeg, 120, 'padrao combinado: 1 msg a cada 2 min');
  eq(normalizarTravas({}).tetoDiario, 50, 'padrao combinado: 50 por dia');
  eq(normalizarTravas({ tetoDiario: 0 }).tetoDiario, 1, 'teto zero viraria campanha morta');
  eq(normalizarTravas({ janelaInicio: '25:00' }).janelaInicio, '09:00', 'hora invalida cai no padrao');
  eq(normalizarTravas({ diasSemana: [] }).diasSemana, TRAVAS_PADRAO.diasSemana,
    'sem dia nenhum a campanha nunca rodaria');
  eq(normalizarTravas({ diasSemana: [1, 1, 9, 3] }).diasSemana, [1, 3], 'dedupe e descarte de dia invalido');
  eq(normalizarTravas({ optoutAtivo: false }).optoutAtivo, false, 'opt-out pode ser desligado explicitamente');
  eq(normalizarTravas({}).optoutAtivo, true, 'mas vem ligado por padrao');

  // Capacidade real: o teto declarado nao vale se a janela nao comporta.
  const t = normalizarTravas({ intervaloMinSeg: 120, tetoDiario: 50, janelaInicio: '09:00', janelaFim: '20:00' });
  eq(capacidadeDaJanela(t), 50, '11h a 1/2min cabem 330 — o teto de 50 e quem limita');
  const curta = normalizarTravas({ intervaloMinSeg: 120, tetoDiario: 50, janelaInicio: '18:00', janelaFim: '19:00' });
  eq(capacidadeDaJanela(curta), 30, 'em 1h a cada 2min so cabem 30, nao 50');
  const virada = normalizarTravas({ intervaloMinSeg: 3600, tetoDiario: 500, janelaInicio: '22:00', janelaFim: '02:00' });
  eq(capacidadeDaJanela(virada), 4, 'janela que vira o dia conta 4h, nao -20h');

  eq(diasParaVarrer(600, t), 12, '600 pessoas a 50/dia sao 12 dias de fila');
  eq(diasParaVarrer(0, t), 0, 'publico vazio nao gera fila');
  eq(diasParaVarrer(10, t), 1, 'publico menor que o teto sai em um dia');
}

// ── Mensagem: variaveis ──────────────────────────────────────────────────────
{
  eq(primeiroNome('  Maria  Souza '), 'Maria', 'primeiro nome ignora espaco extra');
  eq(primeiroNome(null), '', 'sem nome nao inventa');

  const vars = varsDoCliente(
    { nome: 'Joao Pedro Silva', pedidos: 4, ticketMedio: 87.5, diasDesdeUltima: 42.7 }, 'Tokio Maki',
  );
  eq(vars.primeiro_nome, 'Joao', 'primeiro nome na variavel');
  eq(vars.dias, '43', 'dias arredondado (nao "42.7 dias")');
  eq(vars.pedidos, '4', 'pedidos como texto');
  eq(vars.loja, 'Tokio Maki', 'nome da loja');
  ok(vars.ticket.includes('87,50'), 'ticket formatado em reais');

  // Cliente sem nome cadastrado nao pode gerar "Oi, !".
  const anonimo = varsDoCliente({ nome: null, pedidos: 1, ticketMedio: 10, diasDesdeUltima: 3 }, 'Loja');
  eq(anonimo.primeiro_nome, 'tudo bem', 'sem nome, a saudacao ainda faz sentido');
  eq(aplicarVars('Oi, {{primeiro_nome}}!', anonimo), 'Oi, tudo bem!', 'e a frase fecha');

  eq(aplicarVars('Oi {{primeiro_nome}}, {{dias}} dias', vars), 'Oi Joao, 43 dias', 'interpolacao');
  eq(aplicarVars('Cupom {{cupom10}}', vars), 'Cupom {{cupom10}}',
    'variavel inexistente fica literal (o motor nao inventa valor)');
  // ⚠️ `{{cupom}}` era o exemplo de variavel inexistente ate o motor ganhar
  // cupom por campanha. Agora ela e VALIDA — o exemplo de invalida virou outro.
  eq(variaveisDesconhecidas('Oi {{primeiro_nome}}, use {{cupom}}'), [],
    'cupom passou a ser variavel valida');
  eq(variaveisDesconhecidas('Oi {{primeiro_nome}}, use {{desconto}} e {{desconto}}'), ['desconto'],
    'a tela consegue avisar da variavel invalida, sem repetir');
  eq(variaveisDesconhecidas('Oi {{nome}}'), [], 'variavel valida nao vira aviso');

  // Toda mensagem de fabrica so usa variavel que o motor preenche.
  for (const m of ORDEM_MODELOS) {
    for (const texto of MODELOS_FIDELIDADE[m].mensagensPadrao) {
      eq(variaveisDesconhecidas(texto), [], `${m}: mensagem padrao sem variavel invalida`);
    }
  }
}

// ── Mensagens: limpeza ───────────────────────────────────────────────────────
{
  eq(limparMensagens(['  a  ', '', '   ', 'b'], 'vip'), ['a', 'b'], 'descarta vazias e apara');
  eq(limparMensagens([], 'vip'), MODELOS_FIDELIDADE.vip.mensagensPadrao,
    'lista vazia volta pro padrao (campanha sem texto nao pode existir)');
  eq(limparMensagens(null, 'vip'), MODELOS_FIDELIDADE.vip.mensagensPadrao, 'null tambem');
  eq(limparMensagens(['a', 'b', 'c', 'd', 'e'], 'vip').length, 3, 'teto de 3 variacoes');
}

// ── Catalogo coerente ────────────────────────────────────────────────────────
{
  eq(ORDEM_MODELOS.length, 5, 'cinco modelos na v1');
  for (const m of ORDEM_MODELOS) {
    const meta = MODELOS_FIDELIDADE[m];
    eq(meta.id, m, `${m}: id bate com a chave`);
    eq(meta.mensagensPadrao.length, 3, `${m}: tres variacoes de fabrica`);
    ok(meta.campos.length > 0, `${m}: tem regua ajustavel`);
    ok(meta.cadenciaPadrao.diasSemana.length > 0, `${m}: nasce com dia definido`);
    ok(/^([01]\d|2[0-3]):[0-5]\d$/.test(meta.cadenciaPadrao.hora), `${m}: hora valida`);
    for (const campo of meta.campos) {
      ok(campo.padrao === null || (campo.padrao >= campo.min && campo.padrao <= campo.max),
        `${m}.${campo.chave}: padrao dentro da faixa`);
    }
  }
  // Modelos nascem em dias diferentes para nao brigarem pelo cooldown.
  const dias = ORDEM_MODELOS.map(m => MODELOS_FIDELIDADE[m].cadenciaPadrao.diasSemana.join(','));
  eq(new Set(dias).size, dias.length, 'cada modelo de fabrica cai num dia diferente');
}


// ═══════════════════════════════════════════ Motor: cupom, lista e relógio ══

// ── Cupom ────────────────────────────────────────────────────────────────────
{
  eq(normalizarCupom('  volta10 '), 'VOLTA10', 'cupom vira caixa alta sem espaco');
  eq(normalizarCupom('VOLTA 10'), 'VOLTA10', 'espaco no meio some (codigo nao tem espaco)');
  eq(normalizarCupom(''), null, 'vazio nao e cupom');
  eq(normalizarCupom('   '), null, 'so espaco nao e cupom');
  eq(normalizarCupom(null), null, 'null nao e cupom');
  eq(normalizarCupom(123), null, 'numero nao e cupom');
  eq(normalizarCupom('x'.repeat(80)).length, 40, 'cupom absurdo e cortado');
  // O mesmo cupom escrito de dois jeitos precisa virar UM, senao a medicao de
  // resgate contra o coupon_code do pedido conta separado.
  eq(normalizarCupom('volta10'), normalizarCupom('VOLTA10'), 'caixa diferente = mesmo cupom');
}

// ── Variaveis por fonte de publico ───────────────────────────────────────────
{
  const comConsumo = 'Faz {{dias}} dias, {{primeiro_nome}}!';
  eq(variaveisIndisponiveis(comConsumo, 'segmento'), [], 'segmento preenche variavel de consumo');
  eq(variaveisIndisponiveis(comConsumo, 'lista'), ['dias'], 'lista manual NAO tem historico');
  eq(variaveisIndisponiveis('Oi {{primeiro_nome}}, use {{cupom}}', 'lista'), [],
    'nome e cupom funcionam em lista manual');
  eq(variaveisIndisponiveis('{{ticket}} {{pedidos}} {{dias}}', 'lista').sort(),
    ['dias', 'pedidos', 'ticket'], 'as tres de consumo sao pegas');
}

// ── Validacao da campanha ────────────────────────────────────────────────────
{
  eq(validarCampanha(['Oi {{primeiro_nome}}!'], 'segmento', null), [], 'mensagem simples passa');
  eq(validarCampanha([], 'segmento', null).length, 1, 'campanha sem mensagem e recusada');
  eq(validarCampanha(['   '], 'segmento', null).length, 1, 'so espaco tambem e recusada');

  ok(validarCampanha(['Faz {{dias}} dias'], 'lista', null)[0].includes('histórico'),
    'lista manual com variavel de consumo e recusada, explicando o porque');

  ok(validarCampanha(['Use {{cupom}} hoje'], 'segmento', null)[0].includes('cupom'),
    'citar {{cupom}} sem cadastrar cupom e recusado — sairia "use  hoje"');
  eq(validarCampanha(['Use {{cupom}} hoje'], 'segmento', 'VOLTA10'), [],
    'com cupom cadastrado, passa');

  ok(validarCampanha(['Oi {{nomee}}'], 'segmento', null)[0].includes('{{nomee}}'),
    'variavel inexistente aponta o nome errado');

  // Duas variacoes ruins geram dois erros, numerados — o gestor precisa saber
  // QUAL variacao consertar.
  const erros = validarCampanha(['{{dias}}', 'ok', '{{ticket}}'], 'lista', null);
  eq(erros.length, 2, 'um erro por variacao ruim');
  ok(erros[0].startsWith('Variação 1'), 'primeiro erro aponta a variacao 1');
  ok(erros[1].startsWith('Variação 3'), 'segundo aponta a variacao 3 (a 2 esta boa)');
}

// ── aplicarVars: previa x envio ──────────────────────────────────────────────
{
  const vars = varsDoDestinatario({ chave: 'x', telefone: 'y', nome: 'Ana Paula' }, 'Tokio', 'VOLTA10');
  eq(vars.primeiro_nome, 'Ana', 'primeiro nome');
  eq(vars.cupom, 'VOLTA10', 'cupom entra nas variaveis');
  eq(vars.dias, undefined, 'sem consumo, nao existe {{dias}}');

  // ⚠️ O ponto mais importante do motor: na PREVIA o gestor precisa VER o erro;
  // no ENVIO o consumidor nunca pode receber "{{dias}}" literal.
  eq(aplicarVars('Faz {{dias}} dias', vars), 'Faz {{dias}} dias', 'previa mostra a chave crua');
  eq(aplicarVars('Faz {{dias}} dias', vars, 'envio'), 'Faz dias', 'envio apaga e normaliza o espaco');
  eq(aplicarVars('Oi {{primeiro_nome}}, use {{cupom}}!', vars, 'envio'), 'Oi Ana, use VOLTA10!',
    'envio normal');
  eq(aplicarVars('Oi{{x}} , tudo bem?', vars, 'envio'), 'Oi, tudo bem?',
    'espaco antes da virgula some no envio');

  const comConsumo = varsDoDestinatario(
    { chave: 'x', telefone: 'y', nome: null, consumo: { pedidos: 4, ticketMedio: 87.5, diasDesdeUltima: 42.7 } },
    'Tokio', null,
  );
  eq(comConsumo.dias, '43', 'dias arredondado');
  eq(comConsumo.primeiro_nome, 'tudo bem', 'sem nome, a saudacao ainda fecha');
  eq(comConsumo.cupom, '', 'sem cupom, a variavel existe vazia');
}

// ── Leitura da lista manual ──────────────────────────────────────────────────
{
  const norm = (raw) => {
    const d = String(raw).replace(/\D/g, '');
    if (d.length < 8) return null;
    let x = d;
    if (x.startsWith('55') && x.length >= 12) x = x.slice(2);
    if (x.length === 11) return x.slice(0, 2) + x.slice(3);
    return x.slice(-10);
  };

  const r = parseListaManual(
    '5543999990000,Maria\n43 99999-0000;Maria de novo\n(11) 98888-7777\nlixo aqui\n\n5511988887777',
    norm,
  );
  eq(r.contatos.length, 2, 'so duas pessoas distintas');
  eq(r.duplicados, 2, 'o mesmo numero em formatos diferentes conta como duplicado');
  eq(r.invalidos, ['lixo aqui'], 'a linha invalida volta INTEIRA pra tela poder mostrar qual e');
  eq(r.contatos[0].nome, 'Maria', 'nome depois da virgula');
  eq(r.contatos[1].nome, null, 'sem nome fica null');

  // Ponto e virgula e o separador do Excel em pt-BR.
  eq(parseListaManual('5543999990000;Ana', norm).contatos[0].nome, 'Ana', 'aceita ponto e virgula');
  // Nome com virgula no meio nao pode ser cortado ao meio.
  eq(parseListaManual('5543999990000,Silva, Ana', norm).contatos[0].nome, 'Silva, Ana',
    'o resto da linha inteiro e o nome');
  eq(parseListaManual('', norm).contatos.length, 0, 'texto vazio nao quebra');
  eq(parseListaManual('   \n  \n', norm).contatos.length, 0, 'linhas em branco sao ignoradas');
}

// ── Relogio: janela, dia e proxima execucao (BRT) ────────────────────────────
{
  const travas = normalizarTravas({ janelaInicio: '09:00', janelaFim: '20:00', diasSemana: [1, 2, 3, 4, 5] });
  // 2026-08-25 e uma TERCA. 12:00Z = 09:00 BRT (primeiro minuto da janela).
  eq(dentroDaJanela(travas, new Date('2026-08-25T12:00:00Z')), true, '09:00 BRT esta dentro');
  eq(dentroDaJanela(travas, new Date('2026-08-25T11:59:00Z')), false, '08:59 BRT esta fora');
  eq(dentroDaJanela(travas, new Date('2026-08-25T22:59:00Z')), true, '19:59 BRT ainda dentro');
  eq(dentroDaJanela(travas, new Date('2026-08-25T23:00:00Z')), false, '20:00 BRT ja fechou (fim exclusivo)');
  // ⚠️ Sem a conversao pra BRT, 03:00Z pareceria "de manha" e liberaria envio a
  // meia-noite de Brasilia.
  eq(dentroDaJanela(travas, new Date('2026-08-26T03:00:00Z')), false, 'meia-noite BRT esta fora');

  eq(diaPermitido(travas, new Date('2026-08-25T12:00:00Z')), true, 'terca permitida');
  eq(diaPermitido(travas, new Date('2026-08-23T12:00:00Z')), false, 'domingo nao permitido');
  // ⚠️ O caso que a conversao existe para resolver: 2026-08-24T00:30Z ja e
  // SEGUNDA em UTC, mas em Brasilia ainda e DOMINGO 21:30. Ler o relogio do
  // servidor liberaria envio num dia que o gestor bloqueou.
  const meiaNoiteUtc = new Date('2026-08-24T00:30:00Z');
  eq(diaPermitido(normalizarTravas({ diasSemana: [0] }), meiaNoiteUtc), true,
    'domingo em Brasilia conta como domingo');
  eq(diaPermitido(normalizarTravas({ diasSemana: [1] }), meiaNoiteUtc), false,
    'e NAO como segunda, que e o que o UTC diria');

  const virada = normalizarTravas({ janelaInicio: '22:00', janelaFim: '02:00' });
  eq(dentroDaJanela(virada, new Date('2026-08-26T02:00:00Z')), true, 'janela que vira o dia: 23h BRT dentro');
  eq(dentroDaJanela(virada, new Date('2026-08-25T18:00:00Z')), false, 'e 15h BRT fora');
}

// ── proximaExecucao ──────────────────────────────────────────────────────────
{
  // Terca 2026-08-25, 10:00 BRT (13:00Z). Campanha roda terca as 18:00 BRT.
  const agora = new Date('2026-08-25T13:00:00Z');
  const p1 = proximaExecucao([2], '18:00', agora);
  eq(p1.toISOString(), '2026-08-25T21:00:00.000Z', 'hoje mais tarde: 18:00 BRT = 21:00Z');

  // Se ja passou da hora de hoje, vai pra proxima semana.
  const p2 = proximaExecucao([2], '09:00', agora);
  eq(p2.toISOString(), '2026-09-01T12:00:00.000Z', 'hora ja passou hoje -> proxima terca');

  // Varios dias: pega o mais proximo.
  const p3 = proximaExecucao([1, 3, 5], '18:00', agora);
  eq(p3.toISOString(), '2026-08-26T21:00:00.000Z', 'quarta e o proximo dia da lista');

  // Vira o mes e o ano sem esforco (o Date.UTC normaliza o dia excedente).
  const reveillon = new Date('2026-12-31T13:00:00Z');
  const p4 = proximaExecucao([5], '18:00', reveillon);
  eq(p4.toISOString(), '2027-01-01T21:00:00.000Z', 'atravessa a virada do ano');

  eq(proximaExecucao([], '18:00', agora), null, 'sem dia escolhido nao ha proxima execucao');
  eq(proximaExecucao([9], '18:00', agora), null, 'dia invalido e descartado');

  // Nunca devolve o passado — seria uma campanha em loop, disparando a cada tick.
  for (const dia of [0, 1, 2, 3, 4, 5, 6]) {
    const p = proximaExecucao([dia], '18:00', agora);
    ok(p.getTime() > agora.getTime(), `dia ${dia}: proxima execucao esta no futuro`);
  }
}

// ── Mensagens padrao da lista manual ─────────────────────────────────────────
{
  eq(limparMensagens([], null), MENSAGENS_LISTA_PADRAO, 'campanha de lista cai no texto generico');
  eq(limparMensagens([], 'vip'), MODELOS_FIDELIDADE.vip.mensagensPadrao, 'campanha de segmento cai no do modelo');
  for (const t of MENSAGENS_LISTA_PADRAO) {
    eq(variaveisIndisponiveis(t, 'lista'), [], 'texto de fabrica da lista nao usa variavel de consumo');
    eq(variaveisDesconhecidas(t), [], 'nem variavel inexistente');
  }
}

console.log(`OK — ${n} asserts (com motor)`);
