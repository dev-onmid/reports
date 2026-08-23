// Testes da semantica do Funil de Performance (funil-etapas.ts).
//
// Compilar antes (a lib e TS e o Node nao le TS direto):
//   npx tsc src/lib/funil-etapas.ts --outDir scratchpad/build \
//     --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
//   mv scratchpad/build/funil-etapas.js scratchpad/build/funil-etapas.mjs
//   node scratchpad/test-funil-etapas.mjs

import assert from 'node:assert';
import {
  classificarEtapa, postoDaEtapa, normalizarEtiqueta, contarFunil, somarFunis,
  resolverTopoFunil, rotuloFonteTopo, normalizarFonteTopo, ETAPAS_PADRAO, FUNIL_VAZIO,
} from './build/funil-etapas.mjs';
let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (c, m) => { assert.ok(c, m); n++; };

// ---------------------------------------------------------- classificarEtapa
// Os 12 status reais da planilha da clinica (Sorrifacil)
eq(classificarEtapa('Não Contactado'), 'contato', 'nao contactado');
eq(classificarEtapa('Em Atendimento'), 'qualificado', 'em atendimento');
eq(classificarEtapa('Avaliação Agendada'), 'agendamento', 'avaliacao agendada');
eq(classificarEtapa('Avaliação Remarcada'), 'agendamento', 'remarcada');
eq(classificarEtapa('Avaliação Com Falta'), 'agendamento', 'com falta = agendou mas nao compareceu');
eq(classificarEtapa('Avaliação Realizada'), 'comparecimento', 'realizada = compareceu');
eq(classificarEtapa('Avaliação Efetivada'), 'fechamento', 'efetivada = vendeu');
eq(classificarEtapa('Paciente'), 'fechamento', 'paciente');
eq(classificarEtapa('Não Retorna'), 'qualificado', 'nao retorna preserva getStage antigo');
eq(classificarEtapa('Distante'), 'qualificado', 'distante preserva getStage antigo');
eq(classificarEtapa('Sem Interesse'), 'perdido', 'sem interesse');
eq(classificarEtapa('Desqualificado'), 'perdido', 'desqualificado nao casa em qualificad');

// Vocabulario padrao do CRM
eq(classificarEtapa('Agendado'), 'agendamento', 'agendado');
eq(classificarEtapa('Reagendado'), 'agendamento', 'reagendado');
eq(classificarEtapa('Fechado'), 'fechamento', 'fechado');
eq(classificarEtapa('Comprou'), 'fechamento', 'comprou');

// Outros vocabularios vivos no repo
eq(classificarEtapa('Perca Qualificada'), 'perdido', 'perca qualificada e perda, nao qualificado');
eq(classificarEtapa('Proposta'), 'qualificado', 'proposta');
eq(classificarEtapa('Negociação'), 'qualificado', 'negociacao');
eq(classificarEtapa('Orçamento enviado'), 'qualificado', 'orcamento');
eq(classificarEtapa('No-Show'), 'agendamento', 'no-show = agendou e faltou');
eq(classificarEtapa('Show'), 'comparecimento', 'show = compareceu');
eq(classificarEtapa(''), 'contato', 'vazio vira contato');
eq(classificarEtapa(null), 'contato', 'null vira contato');
eq(classificarEtapa('Etapa Nova Qualquer'), 'contato', 'desconhecido vira contato');
eq(classificarEtapa('AVALIAÇÃO EFETIVADA'), 'fechamento', 'caixa alta com acento');
eq(classificarEtapa('avaliacao efetivada'), 'fechamento', 'sem acento');

// postoDaEtapa
eq(postoDaEtapa('contato'), 0, 'posto contato');
eq(postoDaEtapa('qualificado'), 1, 'posto qualificado');
eq(postoDaEtapa('agendamento'), 2, 'posto agendamento');
eq(postoDaEtapa('comparecimento'), 3, 'posto comparecimento');
eq(postoDaEtapa('fechamento'), 4, 'posto fechamento');
eq(postoDaEtapa('perdido'), -1, 'perdido fora da escada');

// normalizarEtiqueta
eq(normalizarEtiqueta('  Avaliação—Agendada  '), 'avaliacao agendada', 'travessao + acento');
eq(normalizarEtiqueta(null), '', 'null vira vazio');

// --------------------------------------------------------------- contarFunil
const lead = (over = {}) => ({
  status: null, funnelId: null, compareceu: false, fechou: false,
  agendou: false, dataAgendada: null, receita: 0, ...over,
});

// Cliente SEM stages cadastrados (so planilha): tudo via texto + booleanos
{
  const c = contarFunil([
    lead({ status: 'Não Contactado' }),
    lead({ status: 'Em Atendimento' }),
    lead({ status: 'Avaliação Agendada', agendou: true }),
    lead({ status: 'Avaliação Com Falta', agendou: true }),
    lead({ status: 'Avaliação Realizada', agendou: true, compareceu: true }),
    lead({ status: 'Avaliação Efetivada', agendou: true, compareceu: true, fechou: true, receita: 500 }),
    lead({ status: 'Sem Interesse' }),
  ], []);
  eq(c.contatos, 7, 'contatos = todos, inclusive perdido e nao contactado');
  eq(c.qualificados, 5, 'qualificados = engajou (sem nao-contactado, sem perdido parado)');
  eq(c.agendamentos, 4, 'agendamentos cumulativo inclui falta, realizada e efetivada');
  eq(c.comparecimentos, 2, 'comparecimentos inclui quem fechou');
  eq(c.fechamentos, 1, 'fechamento');
  eq(c.perdidos, 1, 'perdido paralelo');
  eq(c.receita, 500, 'receita dos fechados');
  ok(c.contatos >= c.qualificados && c.qualificados >= c.agendamentos
    && c.agendamentos >= c.comparecimentos && c.comparecimentos >= c.fechamentos,
    'funil nao-crescente');
}

// Monotonicidade: fechou implica tudo, mesmo com status atrasado
{
  const c = contarFunil([lead({ status: 'Não Contactado', fechou: true, receita: 100 })], []);
  eq([c.qualificados, c.agendamentos, c.comparecimentos, c.fechamentos], [1, 1, 1, 1],
    'fechou implica todas as etapas anteriores');
}

// Perdido que CHEGOU longe: conta nas etapas alcancadas E em perdidos
{
  const c = contarFunil([lead({ status: 'Desqualificado', compareceu: true })], []);
  eq(c.perdidos, 1, 'desqualificado conta em perdidos');
  eq(c.comparecimentos, 1, 'mas o comparecimento dele aconteceu');
  eq(c.agendamentos, 1, 'e o agendamento por cumulatividade');
  eq(c.qualificados, 1, 'e a qualificacao');
  eq(c.fechamentos, 0, 'sem fechar');
}

// Perdido parado nao sobe degrau nenhum
{
  const c = contarFunil([lead({ status: 'Sem Interesse' })], []);
  eq([c.contatos, c.qualificados, c.perdidos], [1, 0, 1], 'perdido parado so conta no topo e em perdidos');
}

// data_agendada sozinha = agendou
{
  const c = contarFunil([lead({ status: 'Em Atendimento', dataAgendada: '2026-08-01' })], []);
  eq(c.agendamentos, 1, 'data_agendada preenche agendamento');
}

// Stage com etapa_funil EXPLICITA vence a auto-classificacao
{
  const stages = [{ funnelId: 'f1', label: 'Congelados', etapa: 'perdido' }];
  const c = contarFunil([lead({ status: 'Congelados', funnelId: 'f1' })], stages);
  eq(c.perdidos, 1, 'classificacao explicita do stage vale');
  // sem o stage, "Congelados" viraria contato
  eq(contarFunil([lead({ status: 'Congelados', funnelId: 'f1' })], []).perdidos, 0, 'sem stage cai no default');
}

// Stage com etapa null cai na auto-classificacao do rotulo
{
  const stages = [{ funnelId: 'f1', label: 'Avaliação Agendada', etapa: null }];
  const c = contarFunil([lead({ status: 'Avaliação Agendada', funnelId: 'f1' })], stages);
  eq(c.agendamentos, 1, 'etapa null auto-classifica');
}

// Multi-funil: mesmo rotulo, classificacoes diferentes — o funil do lead vence
{
  const stages = [
    { funnelId: 'f1', label: 'Fila', etapa: 'perdido' },
    { funnelId: 'f2', label: 'Fila', etapa: 'agendamento' },
  ];
  eq(contarFunil([lead({ status: 'Fila', funnelId: 'f2' })], stages).agendamentos, 1, 'funil do lead vence');
  eq(contarFunil([lead({ status: 'Fila', funnelId: 'f1' })], stages).perdidos, 1, 'outro funil, outra etapa');
  // funnel_id NULL cai no fallback por label (primeiro funil da lista)
  eq(contarFunil([lead({ status: 'Fila', funnelId: null })], stages).perdidos, 1, 'null usa fallback do 1o funil');
}

// Casamento acento/caixa-insensivel entre status do lead e label do stage
{
  const stages = [{ funnelId: 'f1', label: 'Avaliação Agendada', etapa: 'agendamento' }];
  const c = contarFunil([lead({ status: 'avaliacao agendada', funnelId: 'f1' })], stages);
  eq(c.agendamentos, 1, 'status sem acento casa com label acentuado');
}

// somarFunis
{
  const a = contarFunil([lead({ status: 'Agendado', agendou: true })], []);
  const b = contarFunil([lead({ fechou: true, receita: 50 })], []);
  const t = somarFunis([a, b]);
  eq(t.contatos, 2, 'soma contatos');
  eq(t.fechamentos, 1, 'soma fechamentos');
  eq(t.receita, 50, 'soma receita');
  eq(somarFunis([]), FUNIL_VAZIO, 'soma vazia = zero');
}

// ------------------------------------------------------------ topo do funil
eq(resolverTopoFunil('auto', 100, 250), { topo: 100, fonte: 'crm' }, 'auto prefere CRM');
eq(resolverTopoFunil('auto', 0, 250), { topo: 250, fonte: 'anuncios' }, 'auto cai em anuncios sem CRM');
eq(resolverTopoFunil('crm', 0, 250), { topo: 0, fonte: 'crm' }, 'crm forcado fica zerado, nao mente');
eq(resolverTopoFunil('anuncios', 100, 250), { topo: 250, fonte: 'anuncios' }, 'anuncios forcado ignora CRM');
eq(rotuloFonteTopo(['crm', 'crm']), 'fonte: CRM', 'rotulo crm');
eq(rotuloFonteTopo(['anuncios']), 'estimado por anúncios', 'rotulo anuncios');
eq(rotuloFonteTopo(['crm', 'anuncios']), 'fontes mistas (CRM + anúncios)', 'rotulo misto');
eq(rotuloFonteTopo([]), '', 'sem clientes sem rotulo');
eq(normalizarFonteTopo('crm'), 'crm', 'fonte valida passa');
eq(normalizarFonteTopo('qualquer'), 'auto', 'fonte invalida vira auto');
eq(normalizarFonteTopo(null), 'auto', 'null vira auto');

// ------------------------------------------------------------ seeds padrao
eq(ETAPAS_PADRAO.length, 9, '9 etapas padrao (Comprou fundido em Fechado)');
ok(!ETAPAS_PADRAO.some(e => e.label === 'Comprou'), 'Comprou fora do seed');
ok(ETAPAS_PADRAO.some(e => e.label === 'Fechado' && e.etapa === 'fechamento'), 'Fechado segue como ganho');
// Coerencia forte: a classificacao explicita dos seeds bate com a automatica
for (const e of ETAPAS_PADRAO) {
  eq(classificarEtapa(e.label), e.etapa, `seed "${e.label}" auto-classifica igual ao explicito`);
}

console.log(`OK — ${n} asserts`);

// ── Quebra do degrau de AGENDAMENTOS: quem ainda vem × quem furou ───────────
//
// ⚠️ O buraco entre agendamentos e comparecimentos juntava duas coisas muito
// diferentes. Sem separar, o funil dizia "27 nao compareceram" quando boa parte
// so tem consulta marcada para depois.
{
  const HOJE = '2026-08-20';
  const stages = [];
  const lead = (o) => ({
    status: null, funnelId: null, compareceu: false, fechou: false,
    agendou: false, dataAgendada: null, receita: 0, ...o,
  });

  const base = [
    lead({ agendou: true, dataAgendada: '2026-08-25' }),               // futuro -> vem
    lead({ agendou: true, dataAgendada: '2026-08-20' }),               // hoje -> ainda vem
    lead({ agendou: true, dataAgendada: '2026-08-19' }),               // passou -> faltou
    lead({ agendou: true, dataAgendada: '2026-08-30', status: 'No-Show' }), // marcado -> faltou
    lead({ agendou: true, dataAgendada: null }),                       // sem data
    lead({ agendou: true, dataAgendada: '2026-08-01', compareceu: true }), // veio: fora da quebra
    lead({ fechou: true }),                                            // fechou: fora da quebra
  ];
  const c = contarFunil(base, stages, HOJE);
  eq(c.aComparecer, 2, 'data hoje ou futura = ainda vai comparecer');
  eq(c.faltaram, 2, 'data passada OU no-show explicito = faltou');
  eq(c.agendamentoSemData, 1, 'sem data nao vira falta nem promessa');

  // ⚠️ A invariante que impede a quebra de mentir: os tres somam exatamente a
  // distancia entre os dois degraus.
  eq(c.aComparecer + c.faltaram + c.agendamentoSemData, c.agendamentos - c.comparecimentos,
     'a quebra fecha com o buraco do funil');

  // Falta explicita vence a data futura (remarcacao nao confirmada).
  const soNoShow = contarFunil([lead({ agendou: true, dataAgendada: '2027-01-01', status: 'No-Show' })], stages, HOJE);
  eq(soNoShow.faltaram, 1, 'no-show marcado com data futura ainda e falta');
  eq(soNoShow.aComparecer, 0, 'e nao conta como "ainda vem"');

  // Quem ja compareceu ou fechou NUNCA entra na quebra.
  const avancados = contarFunil([
    lead({ agendou: true, dataAgendada: '2026-08-01', compareceu: true }),
    lead({ agendou: true, dataAgendada: '2026-08-01', fechou: true }),
  ], stages, HOJE);
  eq(avancados.aComparecer + avancados.faltaram + avancados.agendamentoSemData, 0,
     'quem avancou saiu da quebra');

  // Data em formato de Date (o driver as vezes devolve assim) tem de funcionar.
  const comDate = contarFunil([lead({ agendou: true, dataAgendada: 'Wed Aug 25 2026 00:00:00 GMT-0300' })], stages, HOJE);
  eq(comDate.aComparecer, 1, 'texto de Date tambem e entendido como data futura');
  const comDatePassada = contarFunil([lead({ agendou: true, dataAgendada: 'Mon Aug 10 2026 00:00:00 GMT-0300' })], stages, HOJE);
  eq(comDatePassada.faltaram, 1, 'texto de Date passado conta como falta');

  // Lixo em data_agendada nao pode virar falta nem promessa.
  const lixo = contarFunil([lead({ agendou: true, dataAgendada: 'amanha' })], stages, HOJE);
  eq(lixo.agendamentoSemData, 1, 'data ilegivel cai em "sem data"');

  // somarFunis leva a quebra junto — senao o dashboard multi-cliente zeraria.
  const soma = somarFunis([c, c]);
  eq(soma.aComparecer, 4, 'somarFunis soma a comparecer');
  eq(soma.faltaram, 4, 'somarFunis soma faltaram');
  eq(soma.agendamentoSemData, 2, 'somarFunis soma sem data');

  eq(FUNIL_VAZIO.aComparecer, 0, 'funil vazio comeca zerado');
  eq(FUNIL_VAZIO.faltaram, 0, 'idem faltaram');
}

console.log(`OK (com a quebra de agendamentos) — ${n} asserts`);
