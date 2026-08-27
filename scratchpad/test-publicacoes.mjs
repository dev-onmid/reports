// Testes do Planejador de Publicacoes (post-agendamento.ts).
//
// Compilar antes (a lib e TS e o Node nao le TS direto). esbuild com bundle
// porque post-agendamento importa `proximaExecucao` de '@/lib/fidelidade':
//   npx esbuild src/lib/post-agendamento.ts --bundle --outfile=scratchpad/build/post-agendamento.mjs --format=esm --log-level=warning
//   node scratchpad/test-publicacoes.mjs
//
// ATENCAO: rodar sem recompilar exercita o codigo ANTIGO e da falso "OK".

import assert from 'node:assert';
import {
  montarAlvos, proximaOcorrencia, proximasOcorrencias, validarPublicacao,
  resumoAgendamento, LEGENDA_MAX, TETO_META_24H, MIN_ANTECEDENCIA_MIN,
} from './build/post-agendamento.mjs';

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// Helper: instante UTC a partir de horario BRT.
const brt = (s) => new Date(`${s}-03:00`);

// ---------------------------------------------------------------- montarAlvos

const CONTAS = [
  { clientId: 'a', clientName: 'Alfa',  igId: '111', username: 'alfa' },
  { clientId: 'b', clientName: 'Beta',  igId: '222', username: 'beta' },
  { clientId: 'c', clientName: 'Gama',  igId: null,  username: null   },
  // Delta aponta para a MESMA conta da Alfa (acontece de verdade: dois clientes
  // da carteira compartilhando o mesmo Instagram).
  { clientId: 'd', clientName: 'Delta', igId: '111', username: 'alfa' },
];

{
  const r = montarAlvos(['a', 'b'], CONTAS);
  eq(r.alvos.map(x => x.igId), ['111', '222'], 'dois clientes distintos viram dois alvos');
  eq(r.descartados, [], 'nada descartado');
}
{
  const r = montarAlvos(['c'], CONTAS);
  eq(r.alvos, [], 'cliente sem Instagram nao vira alvo');
  ok(/sem conta/.test(r.descartados[0].motivo), 'e o motivo diz que falta conta');
}
{
  // ⚠️ O caso que evita publicar duas vezes na mesma conta.
  const r = montarAlvos(['a', 'd'], CONTAS);
  eq(r.alvos.length, 1, 'mesma conta em dois clientes gera UM alvo so');
  eq(r.alvos[0].clientId, 'a', 'o primeiro selecionado fica com a conta');
  const motivo = r.descartados[0].motivo;
  ok(/mesma conta/.test(motivo) && /Alfa/.test(motivo) && /@alfa/.test(motivo),
     'o segundo e descartado dizendo qual conta e quem ficou com ela');
}
{
  const r = montarAlvos(['a', 'a', 'a'], CONTAS);
  eq(r.alvos.length, 1, 'cliente repetido na selecao nao duplica alvo');
  eq(r.descartados.length, 0, 'e repeticao nao vira "descarte" ruidoso');
}
{
  const r = montarAlvos(['zzz'], CONTAS);
  eq(r.alvos, [], 'cliente inexistente nao vira alvo');
  ok(/encontrado/.test(r.descartados[0].motivo), 'com motivo proprio');
}

// ------------------------------------------------------------ proximaOcorrencia

{
  // Quarta-feira 26/08/2026, 10:00 BRT.
  const agora = brt('2026-08-26T10:00:00');
  const ag = { modo: 'recorrente', dias: [1, 4], hora: '09:00', ate: null }; // seg e qui
  const p = proximaOcorrencia(ag, agora);
  eq(p.toISOString(), brt('2026-08-27T09:00:00').toISOString(), 'quarta 10h -> proxima quinta 9h');
}
{
  // Mesmo dia, horario ainda por vir.
  const agora = brt('2026-08-27T08:00:00'); // quinta
  const ag = { modo: 'recorrente', dias: [4], hora: '09:00', ate: null };
  eq(proximaOcorrencia(ag, agora).toISOString(), brt('2026-08-27T09:00:00').toISOString(),
     'hoje mais tarde conta como proxima');
}
{
  // Horario ja passou hoje -> so na semana que vem.
  const agora = brt('2026-08-27T10:00:00');
  const ag = { modo: 'recorrente', dias: [4], hora: '09:00', ate: null };
  eq(proximaOcorrencia(ag, agora).toISOString(), brt('2026-09-03T09:00:00').toISOString(),
     'passou da hora -> proxima quinta, atravessando o mes');
}
{
  const ag = { modo: 'recorrente', dias: [], hora: '09:00', ate: null };
  eq(proximaOcorrencia(ag, brt('2026-08-26T10:00:00')), null, 'sem dia escolhido nao tem proxima');
}
{
  // ⚠️ Limite INCLUSIVO: repetir "ate 27/08" tem de incluir o dia 27 inteiro.
  const agora = brt('2026-08-26T10:00:00');
  const ag = { modo: 'recorrente', dias: [4], hora: '09:00', ate: '2026-08-27' };
  ok(proximaOcorrencia(ag, agora) !== null, 'ocorrencia no proprio dia limite ainda vale');

  const depois = { modo: 'recorrente', dias: [4], hora: '09:00', ate: '2026-08-26' };
  eq(proximaOcorrencia(depois, agora), null, 'passou da data final -> serie encerrada');
}
{
  const ag = { modo: 'recorrente', dias: [1], hora: '25:00', ate: null };
  eq(proximaOcorrencia(ag, brt('2026-08-26T10:00:00')), null, 'hora invalida nao produz data');
}
{
  const ag = { modo: 'unico', quando: brt('2026-09-01T15:00:00').toISOString() };
  eq(proximaOcorrencia(ag, brt('2026-08-26T10:00:00')).toISOString(),
     brt('2026-09-01T15:00:00').toISOString(), 'agendamento unico devolve a propria data');
  eq(proximaOcorrencia({ modo: 'unico', quando: 'lixo' }, new Date()), null, 'data invalida -> null');
}
{
  // Virada de ano.
  const agora = brt('2026-12-31T23:00:00'); // quinta
  const ag = { modo: 'recorrente', dias: [5], hora: '08:00', ate: null }; // sexta
  eq(proximaOcorrencia(ag, agora).toISOString(), brt('2027-01-01T08:00:00').toISOString(),
     'atravessa a virada de ano');
}

// ---------------------------------------------------------- proximasOcorrencias

{
  const agora = brt('2026-08-26T10:00:00'); // quarta
  const ag = { modo: 'recorrente', dias: [1, 4], hora: '09:00', ate: null };
  const lista = proximasOcorrencias(ag, agora, 3);
  eq(lista.length, 3, 'devolve tres datas');
  eq(lista.map(d => d.toISOString()), [
    brt('2026-08-27T09:00:00').toISOString(), // qui
    brt('2026-08-31T09:00:00').toISOString(), // seg
    brt('2026-09-03T09:00:00').toISOString(), // qui
  ], 'em ordem, sem repetir a mesma data');
}
{
  const ag = { modo: 'unico', quando: brt('2026-09-01T15:00:00').toISOString() };
  eq(proximasOcorrencias(ag, brt('2026-08-26T10:00:00'), 3).length, 1,
     'agendamento unico tem exatamente uma ocorrencia');
}
{
  // Serie que acaba antes de completar as 3.
  const ag = { modo: 'recorrente', dias: [4], hora: '09:00', ate: '2026-09-03' };
  eq(proximasOcorrencias(ag, brt('2026-08-26T10:00:00'), 5).length, 2,
     'para de listar quando a serie termina, em vez de inventar datas');
}

// --------------------------------------------------------------- validacao

const ALVO = [{ clientId: 'a', clientName: 'Alfa', igId: '111', username: 'alfa' }];
const AGORA = brt('2026-08-26T10:00:00');
const base = {
  tipo: 'feed', legenda: 'oi', midiaId: 'm1', clientIds: ['a'],
  agendamento: { modo: 'unico', quando: brt('2026-08-26T12:00:00').toISOString() },
};

eq(validarPublicacao(base, ALVO, AGORA), [], 'publicacao valida nao acusa nada');

ok(validarPublicacao({ ...base, midiaId: '' }, ALVO, AGORA).some(e => /imagem/i.test(e)),
   'sem imagem e recusado');
ok(validarPublicacao(base, [], AGORA).some(e => /conta/i.test(e)),
   'sem nenhuma conta e recusado');
ok(validarPublicacao({ ...base, legenda: 'x'.repeat(LEGENDA_MAX + 1) }, ALVO, AGORA)
     .some(e => e.includes(String(LEGENDA_MAX))),
   'legenda acima do limite do Instagram e recusada, dizendo o limite');
{
  // ⚠️ Story nao tem legenda no Instagram — o texto sumiria sem aviso.
  const erros = validarPublicacao({ ...base, tipo: 'story', legenda: 'texto' }, ALVO, AGORA);
  ok(erros.some(e => /story/i.test(e)), 'story com legenda e recusado');
  eq(validarPublicacao({ ...base, tipo: 'story', legenda: '' }, ALVO, AGORA), [],
     'story sem legenda passa');
}
{
  const passado = { ...base, agendamento: { modo: 'unico', quando: brt('2026-08-26T09:00:00').toISOString() } };
  ok(validarPublicacao(passado, ALVO, AGORA).some(e => /minutos/.test(e)),
     'horario no passado e recusado');

  const emCima = {
    ...base,
    agendamento: { modo: 'unico', quando: new Date(AGORA.getTime() + 30_000).toISOString() },
  };
  ok(validarPublicacao(emCima, ALVO, AGORA).length > 0,
     `menos de ${MIN_ANTECEDENCIA_MIN} min de antecedencia e recusado (o cron nao alcancaria)`);
}
{
  const semDia = { ...base, agendamento: { modo: 'recorrente', dias: [], hora: '09:00', ate: null } };
  ok(validarPublicacao(semDia, ALVO, AGORA).some(e => /dia da semana/i.test(e)),
     'recorrencia sem dia e recusada');

  const vencida = { ...base, agendamento: { modo: 'recorrente', dias: [4], hora: '09:00', ate: '2020-01-01' } };
  ok(validarPublicacao(vencida, ALVO, AGORA).some(e => /data futura/i.test(e)),
     'recorrencia que ja terminou e recusada em vez de nascer morta');
}

// ------------------------------------------------------------------ resumo

{
  const r = resumoAgendamento({ modo: 'recorrente', dias: [4, 1], hora: '09:00', ate: null });
  ok(/toda seg, qui/.test(r) && /09:00/.test(r), 'resumo ordena os dias e nao repete');
}
ok(/todo dia/.test(resumoAgendamento({ modo: 'recorrente', dias: [0,1,2,3,4,5,6], hora: '08:00', ate: null })),
   'sete dias viram "todo dia"');
ok(/27\/08\/2026/.test(resumoAgendamento({ modo: 'recorrente', dias: [4], hora: '09:00', ate: '2026-08-27' })),
   'data final aparece em dd/mm/aaaa');
ok(/sem dia escolhido/.test(resumoAgendamento({ modo: 'recorrente', dias: [], hora: '09:00', ate: null })),
   'recorrencia vazia se explica em vez de mostrar frase quebrada');

eq(TETO_META_24H, 100, 'teto da Meta documentado no codigo');

console.log(`OK — ${n} asserts`);
