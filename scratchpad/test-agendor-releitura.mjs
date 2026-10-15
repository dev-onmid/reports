// Regras da releitura diária do Agendor. Compilar antes:
// npx esbuild src/lib/agendor-releitura-regras.ts --format=esm --outfile=scratchpad/build/agendor-releitura-regras.mjs
import { decidirReleitura, mesesConferidos, compararTotais, sumicoSuspeito, mesDoGanho } from './build/agendor-releitura-regras.mjs';
let ok = 0, falhas = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhas++; console.log('FALHOU:', nome); } };
const neg = (o = {}) => ({ status: 'ganho', valor: 1000, ganhoEm: '2026-08-10T12:04:18.000Z', origemPersonalizada: null, organizacaoId: '1', pessoa: { id: null }, ...o });
const lin = (o = {}) => ({ valor: 1000, fechadoEm: '2026-08-10', origemPers: null, temIdsDeOrigem: true, ...o });

t('ausente no sistema reingere', decidirReleitura(neg(), null, true).reingerir);
t('igual não faz nada', !decidirReleitura(neg(), lin(), true).reingerir && !decidirReleitura(neg(), lin(), true).desfazerVenda);
// Sandro: linha com o valor do OUTRO negócio dele
t('valor trocado reingere', decidirReleitura(neg({ valor: 475 }), lin({ valor: 1200 }), true).reingerir);
t('centavo de arredondamento não reingere', !decidirReleitura(neg({ valor: 1000.004 }), lin(), true).reingerir);
t('data do ganho mudou reingere', decidirReleitura(neg({ ganhoEm: '2026-09-02T10:00:00Z' }), lin(), true).reingerir);
t('ganho sem data no payload não reingere por data', !decidirReleitura(neg({ ganhoEm: null }), lin(), true).reingerir);
// Júlia: negócio em andamento segurando valor do ganho
t('em andamento com valor desfaz', decidirReleitura(neg({ status: 'andamento' }), lin({ valor: 1095 }), true).desfazerVenda);
t('perdido com valor desfaz', decidirReleitura(neg({ status: 'perdido' }), lin(), true).desfazerVenda);
t('⚠️ status NÃO explícito não desfaz venda', !decidirReleitura(neg({ status: 'andamento' }), lin(), false).desfazerVenda);
t('em andamento sem valor não faz nada', !decidirReleitura(neg({ status: 'andamento' }), lin({ valor: 0 }), true).desfazerVenda);
t('desfazer não reingere', !decidirReleitura(neg({ status: 'perdido' }), lin(), true).reingerir);
// Cinfel: opção renomeada
t('origem personalizada renomeada reingere', decidirReleitura(neg({ origemPersonalizada: 'Instagram/Facebook' }), lin({ origemPers: 'Instagram' }), true).reingerir);
t('mesma origem (espaços) não reingere', !decidirReleitura(neg({ origemPersonalizada: 'Instagram ' }), lin({ origemPers: 'Instagram' }), true).reingerir);
t('origem personalizada apagada não reingere (campo limpo cai pelo filtro)', !decidirReleitura(neg({ origemPersonalizada: null }), lin({ origemPers: 'Instagram' }), true).reingerir);
const semIds = decidirReleitura(neg(), lin({ temIdsDeOrigem: false }), true);
t('linha antiga sem ids reingere', semIds.reingerir);
t('linha antiga sem ids NÃO conta como correção', semIds.motivo === null);
t('motivo explica valor', /475/.test(decidirReleitura(neg({ valor: 475 }), lin({ valor: 1200 }), true).motivo));

t('meses conferidos', JSON.stringify(mesesConferidos(new Date('2026-10-07T12:00:00Z'))) === '["2026-10","2026-09","2026-08"]');
t('meses atravessam o ano', JSON.stringify(mesesConferidos(new Date('2026-01-15T12:00:00Z'))) === '["2026-01","2025-12","2025-11"]');
t('mês do ganho', mesDoGanho('2026-08-10T12:04:18.000Z') === '2026-08' && mesDoGanho(null) === null);

const meses = ['2026-10', '2026-09', '2026-08'];
// Incorpast antes da correção: GPI a mais em agosto
const div = compararTotais(meses, new Map([['2026-08', 49000]]), new Map([['2026-08', 54995]]));
t('acusa divergência', div.length === 1 && div[0].diferenca === 5995);
t('R$ 1 de diferença não acusa', compararTotais(meses, new Map([['2026-09', 100]]), new Map([['2026-09', 100.99]])).length === 0);
t('mês sem nada dos dois lados não acusa', compararTotais(meses, new Map(), new Map()).length === 0);
t('mês que só existe no Agendor acusa (venda que não entrou)', compararTotais(meses, new Map([['2026-10', 500]]), new Map()).length === 1);

t('sumiço pequeno é real', !sumicoSuspeito(3, 1250));
t('sumiço grande é suspeito', sumicoSuspeito(300, 1250));
t('base pequena: 21 de 30 é suspeito', sumicoSuspeito(21, 30));
t('até 20 nunca trava', !sumicoSuspeito(20, 25));
console.log(`${ok} ok, ${falhas} falhas`); process.exit(falhas ? 1 : 0);
