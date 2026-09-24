// Asserts da alteração de ação de conversão do Google Ads (sem rede).
// Compilar antes:
//   npx esbuild src/lib/google-conversion-actions.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build-conv/conv.mjs --tsconfig=tsconfig.json --external:pg
//   node scratchpad/test-conversao-atualizar.mjs
import assert from 'node:assert/strict';
import { operacaoAtualizar, operacaoCriar, acharPorNome } from './build-conv/conv.mjs';

let n = 0; const t = (nome, fn) => { fn(); n++; };

t('secundária: muda só primary_for_goal e manda a máscara', () => {
  const op = operacaoAtualizar('7760673034', '3928189692', { principal: false });
  assert.equal(op.updateMask, 'primary_for_goal');
  assert.deepEqual(op.update, {
    resourceName: 'customers/3928189692/conversionActions/7760673034',
    primaryForGoal: false,
  });
  assert.equal('status' in op.update, false, 'não pode mexer no status sem pedir');
});
t('voltar a principal', () => {
  const op = operacaoAtualizar('1', '2', { principal: true });
  assert.equal(op.update.primaryForGoal, true);
});
t('pausar usa REMOVED (é como o Google chama "remover da lista")', () => {
  const op = operacaoAtualizar('1', '2', { pausar: true });
  assert.equal(op.update.status, 'REMOVED');
  assert.equal(op.updateMask, 'status');
});
t('os dois campos juntos entram na máscara na ordem certa', () => {
  const op = operacaoAtualizar('1', '2', { principal: false, pausar: false });
  assert.equal(op.updateMask, 'primary_for_goal,status');
  assert.equal(op.update.status, 'ENABLED');
});
t('sem campo nenhum → máscara vazia (a função de rede recusa)', () => {
  const op = operacaoAtualizar('1', '2', {});
  assert.equal(op.updateMask, '');
});
t('criação continua nascendo como principal (não regredi nada)', () => {
  assert.equal(operacaoCriar({ nome: 'X' }).create.primaryForGoal, true);
});
t('achar por nome ignora caixa e espaço — o alvo vem digitado à mão', () => {
  const lista = [{ id: '9', nome: 'Click Telefone | Lead' }];
  assert.equal(acharPorNome(lista, '  click telefone | lead ')?.id, '9');
  assert.equal(acharPorNome(lista, 'outro'), undefined);
});

console.log(`${n} asserts ok`);
