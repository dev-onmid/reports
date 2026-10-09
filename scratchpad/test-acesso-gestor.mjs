// Regras de acesso do usuário de CLIENTE (gestor/atendente) — src/lib/acesso.ts.
// Compilar antes: npx esbuild src/lib/acesso.ts --bundle --platform=node --format=esm --packages=external --outfile=scratchpad/build/acesso.mjs
import { regraCliente, clientesCitados, escopoDoCliente } from './build/acesso.mjs';
let ok = 0, falhas = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhas++; console.log('FALHOU:', nome); } };
const U = '0f5b6c1e-1111-4222-8333-944444444444';

// ── gestor: dashboard e atendimento liberados; atendente não
for (const [p, m] of [['/api/clients/x/metrics','GET'],['/api/clients/x/ga4','GET'],['/api/clients/x/cardapioweb','GET'],['/api/clients/bulk-settings','GET'],
  ['/api/clients/avatars','GET'],['/api/clients/delivery-flags','GET'],['/api/crm/summary','GET'],['/api/crm/por-canal','GET'],['/api/crm/funil-leads','GET'],
  ['/api/campaigns','GET'],['/api/audience','GET'],['/api/google/keywords','GET'],['/api/meta/top-creatives','GET'],['/api/meta/page-insights','GET'],['/api/meta/ig-posts','GET'],
  ['/api/creative-library','GET'],['/api/creative-library/enrich','POST'],['/api/dashboard/modelo','GET'],
  ['/api/crm/attendance','GET'],['/api/crm/attendance/audit','GET'],['/api/crm/attendance/relatorio','GET'],['/api/crm/equipe-cliente','POST']]) {
  t(`gestor pode ${m} ${p}`, regraCliente(p, m, true) !== null);
  t(`atendente NÃO pode ${m} ${p}`, regraCliente(p, m, false) === null);
}
// ── nem o gestor: saldo, modelo (escrita), auditoria nova, detalhe por id de campanha, ações
for (const [p, m] of [['/api/meta/account-balances','GET'],['/api/google/account-balances','GET'],['/api/clients/links','GET'],
  ['/api/dashboard/modelo','PUT'],['/api/dashboard/modelo','DELETE'],['/api/crm/attendance/audit','POST'],
  ['/api/meta/campaigns/123/adsets','GET'],['/api/google/campaigns/123/adgroups','GET'],['/api/meta/campaigns/123/action','POST'],
  ['/api/ai/insights','POST'],['/api/clients/x/acessos','GET'],['/api/clients','POST'],['/api/users','GET']]) {
  t(`gestor NÃO pode ${m} ${p}`, regraCliente(p, m, true) === null);
}
// ── as que listam todos não exigem cliente citado (o handler recorta pelo cabeçalho)
t('summary sem exigir cliente', regraCliente('/api/crm/summary','GET',true).exigeCliente === false);
t('metrics exige cliente', regraCliente('/api/clients/x/metrics','GET',true).exigeCliente === true);
t('enrich exige cliente', regraCliente('/api/creative-library/enrich','POST',true).exigeCliente === true);
// ── items[].clientId do enrich é visto pelo proxy
t('items[].clientId citado', JSON.stringify(clientesCitados(new URLSearchParams(), { items: [{ clientId: 'a', adIds: ['1'] }, { clientId: 'b' }, null, 7] })) === '["a","b"]');
t('items sem clientId não cita', clientesCitados(new URLSearchParams(), { items: [{ adIds: ['1'] }] }).length === 0);
t('clientIds csv + body', JSON.stringify(clientesCitados(new URLSearchParams('clientIds=a,b'), { clientId: 'c' })) === '["a","b","c"]');
// ── escopo pelo cabeçalho
t('equipe Onmid sem escopo', escopoDoCliente(new Headers({ 'x-onmid-team': 'onmid', 'x-onmid-clientes': 'a' })) === null);
t('cliente com lista', JSON.stringify(escopoDoCliente(new Headers({ 'x-onmid-team': 'cliente', 'x-onmid-clientes': 'a, b' }))) === '["a","b"]');
t('cliente sem lista = vazio (nada)', escopoDoCliente(new Headers({ 'x-onmid-team': 'cliente' })).length === 0);
t('sem cabeçalho = sem escopo', escopoDoCliente(new Headers()) === null);
// ── rotas antigas do atendente seguem
t('atendente lê lead', regraCliente(`/api/crm/${U}`,'GET',false) !== null);
t('atendente NÃO lê attendance', regraCliente('/api/crm/attendance','GET',false) === null);
console.log(`${ok} ok, ${falhas} falhas`); process.exit(falhas ? 1 : 0);
