// node scratchpad/test-lembretes.mjs
import assert from 'node:assert';
import { normalizarLembrete, proximoDisparo, proximoDepoisDeDisparar, ROTULO_RECORRENCIA }
  from './build/lembretes.mjs';
let n = 0;
const ok = (c,m) => { assert.ok(c,m); n++; };
const eq = (a,b,m) => { assert.strictEqual(a,b,m); n++; };
const brt = d => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// validação fala português, não joga exceção
{
  const r = normalizarLembrete({});
  ok(!r.ok && /do que é o lembrete/i.test(r.erro), 'sem título: erro legível');
  const r2 = normalizarLembrete({ titulo: 'x', recorrencia: 'once' });
  ok(!r2.ok && /data e a hora/i.test(r2.erro), 'once sem data: erro legível');
  const r3 = normalizarLembrete({ titulo: 'x', recorrencia: 'daily' });
  ok(!r3.ok && /hora/i.test(r3.erro), 'diário sem hora: erro legível');
  const r4 = normalizarLembrete({ titulo: 'x', recorrencia: 'inventada', hora: '09:00' });
  ok(!r4.ok, 'recorrência inválida é recusada');
}
// normalização
{
  const r = normalizarLembrete({ titulo: '  Ligar pro cliente  ', recorrencia: 'once', run_at: '2026-09-20T14:30' });
  ok(r.ok, 'once válido passa');
  eq(r.valor.titulo, 'Ligar pro cliente', 'título é aparado');
  eq(r.valor.hora, null, 'once não guarda hora solta');

  const w = normalizarLembrete({ titulo: 'x', recorrencia: 'weekly', hora: '09:00', dia_semana: 9 });
  eq(w.valor.dia_semana, 6, 'dia da semana fora da faixa é preso no limite');
  const mo = normalizarLembrete({ titulo: 'x', recorrencia: 'monthly', hora: '09:00', dia_mes: 31 });
  eq(mo.valor.dia_mes, 28, '⚠️ dia 31 vira 28: senão o lembrete pularia fevereiro inteiro');
}
// horário é BRT, não UTC — o erro clássico
{
  const d = proximoDisparo({ recorrencia: 'once', run_at: '2026-09-20T14:30', hora: null, dia_semana: null, dia_mes: null });
  ok(brt(d).includes('14:30'), `once às 14:30 BRT toca 14:30 em Brasília (deu ${brt(d)})`);

  const base = Date.UTC(2026, 8, 16, 18, 0); // 15h BRT
  const dia = proximoDisparo({ recorrencia: 'daily', hora: '09:00', run_at: null, dia_semana: null, dia_mes: null }, base);
  ok(brt(dia).includes('09:00'), 'diário às 09:00 BRT');
  ok(dia.getTime() > base, 'como as 9h de hoje já passaram, agenda para amanhã');
}
// ⚠️ o "uma vez" precisa MORRER depois de tocar
{
  const umaVez = { recorrencia: 'once', run_at: '2026-09-20T14:30', hora: null, dia_semana: null, dia_mes: null };
  eq(proximoDepoisDeDisparar(umaVez), null, 'lembrete de uma vez não reagenda — vira alarme eterno senão');
  const diario = { recorrencia: 'daily', hora: '09:00', run_at: null, dia_semana: null, dia_mes: null };
  ok(proximoDepoisDeDisparar(diario) instanceof Date, 'diário reagenda');
}
// rótulos existem para toda recorrência (senão a tela mostra a chave crua)
for (const k of ['once','daily','weekly','monthly']) ok(!!ROTULO_RECORRENCIA[k], `rótulo de ${k}`);
console.log(`OK — ${n} asserts`);
