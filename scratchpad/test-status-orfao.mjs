// node scratchpad/test-status-orfao.mjs
import assert from 'node:assert';
import { planejarStatusOrfaos, normalizarRotulo } from './build/crm-status-orfao.mjs';
let n = 0;
const eq = (a,b,m) => { assert.strictEqual(a,b,m); n++; };
const ok = (c,m) => { assert.ok(c,m); n++; };

// o caso real que motivou a distinção
eq(normalizarRotulo('Sem  Interesse'), normalizarRotulo('Sem Interesse'), 'espaço duplo casa com espaço simples');
eq(normalizarRotulo('Avaliação Realizada'), normalizarRotulo('avaliacao realizada'), 'acento e caixa fora do caminho');
eq(normalizarRotulo('  '), '', 'só espaço vira vazio');

{
  const plano = planejarStatusOrfaos(
    [{ status: 'Sem  Interesse', leads: 261 }, { status: 'Não Contactado', leads: 4788 }],
    [{ id: 's1', label: 'Sem Interesse', leads: 40 }, { id: 's2', label: 'Agendado', leads: 12 }],
  );
  eq(plano.corrigirGrafia.length, 1, '"Sem  Interesse" NÃO vira coluna: corrige o lead');
  eq(plano.corrigirGrafia[0].paraRotulo, 'Sem Interesse', 'aponta para o rótulo EXATO da coluna que existe');
  eq(plano.criarColunas.length, 1, 'só "Não Contactado" vira coluna');
  eq(plano.criarColunas[0].label, 'Não Contactado', 'mantém a grafia do cliente');
  eq(plano.criarColunas[0].etapa, 'contato', 'grau vem de classificarEtapa, não de chute');
  ok(/^#/.test(plano.criarColunas[0].cor), 'cor sai da paleta do degrau');
}
// ⚠️ coluna COM lead nunca é excluída — apagá-la recriaria o problema
{
  const plano = planejarStatusOrfaos(
    [{ status: 'Fechado', leads: 61 }],
    [{ id: 'x', label: 'fechado', leads: 0 }, { id: 'y', label: 'Fechado ', leads: 99 }],
  );
  eq(plano.criarColunas.length, 0, 'status que casa (normalizado) com coluna existente não cria nada');
  eq(plano.excluirVazias.length, 0, 'nada a excluir quando não se criou coluna');
}
{
  const plano = planejarStatusOrfaos(
    [{ status: 'Resgate', leads: 251 }],
    [{ id: 'v', label: 'resgate ', leads: 0 }],
  );
  // "resgate " (com espaço) normaliza igual a "Resgate" → é correção de grafia, não coluna nova
  eq(plano.criarColunas.length, 0, 'coluna vazia mas equivalente não vira duplicata');
  eq(plano.corrigirGrafia.length, 1, 'os leads passam a apontar para a coluna que já existe');
}
// duas grafias do mesmo status no mesmo cliente colapsam num registro só
{
  const plano = planejarStatusOrfaos(
    [{ status: 'Venda Nova', leads: 800 }, { status: 'venda nova', leads: 33 }],
    [{ id: 'a', label: 'Agendado', leads: 5 }],
  );
  eq(plano.criarColunas.length, 1, 'duas grafias → uma coluna só');
  eq(plano.criarColunas[0].label, 'Venda Nova', 'sobrevive a grafia mais usada');
  eq(plano.criarColunas[0].leads, 833, 'os leads das duas grafias somam');
}
// status vazio não gera nada
{
  const plano = planejarStatusOrfaos([{ status: '   ', leads: 9 }], [{ id:'a', label:'X', leads:1 }]);
  eq(plano.criarColunas.length, 0, 'status em branco não vira coluna fantasma');
}
console.log(`OK — ${n} asserts`);
