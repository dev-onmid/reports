// Recompile antes de rodar:
//   npx esbuild src/lib/motivo-perda.ts --bundle --format=esm --outfile=scratchpad/build/motivo-perda.mjs --log-level=error
// Exercita a lib REAL — replicar a regra aqui faria o teste passar com o código errado.
// Exercita as REGRAS reais da lib (importadas, não replicadas).
import { motivoValido, motivoCompleto, rotuloMotivo, MOTIVOS_PERDA } from './build/motivo-perda.mjs';
let ok=0, fail=0;
const t=(n,c)=>{ if(c){ok++;} else {fail++; console.log('✗',n);} };

t('8 motivos no catálogo', MOTIVOS_PERDA.length === 8);
t('ids únicos', new Set(MOTIVOS_PERDA.map(m=>m.id)).size === 8);
t('todo motivo tem ajuda', MOTIVOS_PERDA.every(m=>m.ajuda && m.ajuda.length > 10));

t('motivo conhecido passa', motivoValido('preco'));
t('motivo inventado NÃO passa', !motivoValido('porque_sim'));
t('null não passa', !motivoValido(null));
t('vazio não passa', !motivoValido(''));

t('preço sem detalhe é completo', motivoCompleto('preco', null));
t('⚠️ outro SEM detalhe é incompleto', !motivoCompleto('outro', null));
t('⚠️ outro com detalhe curto é incompleto', !motivoCompleto('outro', 'x'));
t('⚠️ outro com só espaços é incompleto', !motivoCompleto('outro', '   '));
t('outro com detalhe real passa', motivoCompleto('outro', 'mudou de cidade'));
t('motivo inválido nunca é completo', !motivoCompleto('inexistente', 'detalhe bom'));

t('rótulo legível', rotuloMotivo('concorrente') === 'Fechou com concorrente');
t('rótulo de id inválido é null', rotuloMotivo('nada') === null);
console.log(`\n${ok} asserts OK${fail?`, ${fail} FALHARAM`:''}`);
process.exit(fail?1:0);
