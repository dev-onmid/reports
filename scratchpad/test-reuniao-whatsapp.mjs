// Recompilar antes de rodar (senão exercita a versão ANTIGA e passa à toa):
//   npx esbuild src/lib/reuniao-whatsapp.ts --bundle --format=esm --platform=node \
//     --outfile=scratchpad/build/reuniao-whatsapp.mjs --alias:@=$PWD/src --external:pg
//   node scratchpad/test-reuniao-whatsapp.mjs
import { ehCabecalho, montarMensagemChecklist } from './build/reuniao-whatsapp.mjs';

let ok = 0, fail = 0;
const t = (nome, cond) => { if (cond) { ok++; } else { fail++; console.log('✗', nome); } };
const item = (texto, feito = false) => ({ texto, feito });

// --- ehCabecalho: cabeçalhos REAIS vindos do banco de produção
for (const h of ['📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS', '🏢 AGÊNCIA ONMID', '👥 CLIENTE'])
  t(`cabeçalho: ${h}`, ehCabecalho(h) === true);

// --- ehCabecalho: ações REAIS (Cost Odonto / Sorrifácil Londrina, 09 e 25/09)
for (const a of [
  'Migrar 100% dos dados/conversas do sistema atual para o CRM Reports',
  'Liberar acesso ao CRM Reports para o time usar',
  'Criar link pages para HOF, Ortodontia e Implantes/Protocolos',
  'Enviar para o Gabriel, no WhatsApp, os valores de investimento alinhados com a Fran',
  'Testar por 7 dias campanhas separadas no Instagram vs Facebook',
]) t(`ação: ${a.slice(0, 30)}…`, ehCabecalho(a) === false);

// ⚠️ Ação LONGA e em caixa alta não pode virar cabeçalho só por estar gritando.
t('ação longa em caixa alta continua ação',
  ehCabecalho('ENVIAR PARA O GABRIEL TODOS OS VALORES DE INVESTIMENTO ALINHADOS COM A FRAN AINDA HOJE') === false);
t('item só com emoji é separador', ehCabecalho('✅') === true);
t('acento em caixa alta é cabeçalho', ehCabecalho('🏢 AGÊNCIA') === true);

// --- montarMensagemChecklist: réplica do formato histórico
const reuniaoEm = new Date('2026-09-25T20:33:00Z'); // 17:33 BRT
const real = [
  item('📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS'),
  item('🏢 AGÊNCIA ONMID'),
  item('Migrar 100% dos dados/conversas do sistema atual para o CRM Reports'),
  item('Liberar acesso ao CRM Reports para o time usar'),
  item('👥 CLIENTE'),
  item('Enviar ao Matheus as novas mensagens/textos ajustados'),
];
const msg = montarMensagemChecklist({ cliente: 'Sorrifácil Londrina', reuniaoEm, checklist: real });

t('título no formato do Make', msg.startsWith('*CheckList de Reunião | Sorrifácil Londrina*'));
t('data em BRT (25/09, não 26/09)', msg.includes('Data: 25/09/2026'));
t('cabeçalho geral preservado', msg.includes('📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS'));
t('seção agência sem [ ]', msg.includes('\n🏢 AGÊNCIA ONMID\n') && !msg.includes('[ ] 🏢'));
t('seção cliente sem [ ]', msg.includes('\n👥 CLIENTE\n') && !msg.includes('[ ] 👥'));
t('ação com [ ]', msg.includes('[ ] Migrar 100% dos dados/conversas do sistema atual para o CRM Reports'));
t('ordem agência antes de cliente', msg.indexOf('🏢 AGÊNCIA') < msg.indexOf('👥 CLIENTE'));
t('nunca 3 quebras seguidas', !/\n{3,}/.test(msg));
t('não começa nem termina em branco', msg === msg.trim());

// item já marcado volta como [x] (reenvio depois de alguém marcar na tela)
const marcado = montarMensagemChecklist({
  cliente: 'X', reuniaoEm, checklist: [item('🏢 AGÊNCIA ONMID'), item('Subir campanha', true)],
});
t('item feito vira [x]', marcado.includes('[x] Subir campanha'));

// ⚠️ Checklist só com cabeçalho NÃO vira mensagem — grupo não recebe lista vazia
t('só cabeçalhos → null', montarMensagemChecklist({
  cliente: 'X', reuniaoEm, checklist: [item('📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS'), item('👥 CLIENTE')],
}) === null);
t('checklist nulo → null', montarMensagemChecklist({ cliente: 'X', reuniaoEm, checklist: null }) === null);
t('checklist vazio → null', montarMensagemChecklist({ cliente: 'X', reuniaoEm, checklist: [] }) === null);
t('item em branco não conta como ação', montarMensagemChecklist({
  cliente: 'X', reuniaoEm, checklist: [item('👥 CLIENTE'), item('   ')],
}) === null);

// Sem o cabeçalho geral (Make mudar o texto), injeta para a mensagem seguir reconhecível
const semCab = montarMensagemChecklist({ cliente: 'Y', reuniaoEm, checklist: [item('Fazer X')] });
t('injeta cabeçalho quando falta', semCab.includes('📋 CHECKLIST OPERACIONAL — AÇÕES ACORDADAS'));
t('e mantém a ação', semCab.includes('[ ] Fazer X'));

// Virada de dia em BRT: 02:00Z de 26/09 ainda é 25/09 no Brasil
t('23:00 BRT não vira o dia', montarMensagemChecklist({
  cliente: 'X', reuniaoEm: new Date('2026-09-26T02:00:00Z'), checklist: [item('Fazer X')],
}).includes('Data: 25/09/2026'));

console.log(`\n${ok} asserts OK, ${fail} falharam`);
process.exit(fail ? 1 : 0);
