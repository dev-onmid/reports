// Tags de qualificação (src/lib/crm-tags.ts + regras de acesso em acesso.ts).
// Compilar antes: npx esbuild src/lib/acesso.ts src/lib/crm-tags.ts --bundle --platform=node --format=esm --packages=external --outdir=scratchpad/build --out-extension:.js=.mjs
import { normalizarCorTag, normalizarNomeTag, tagsDoLeadSql, PALETA_TAGS, COR_PADRAO_TAG, NOME_TAG_MAX, definirTagsDoLead } from './build/crm-tags.mjs';
import { regraCliente, leadsCitados } from './build/acesso.mjs';
let ok = 0, falhas = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhas++; console.log('FALHOU:', nome); } };
const U = '0f5b6c1e-1111-4222-8333-944444444444';

// cor: só hex de 6 dígitos; o resto cai no padrão
t('cor válida', normalizarCorTag('#A855F7') === '#a855f7');
t('cor curta cai no padrão', normalizarCorTag('#fff') === COR_PADRAO_TAG);
t('cor lixo cai no padrão', normalizarCorTag('red; drop table') === COR_PADRAO_TAG);
t('cor não-string', normalizarCorTag(42) === COR_PADRAO_TAG);
t('paleta toda válida', PALETA_TAGS.every(c => normalizarCorTag(c) === c));
// nome: aparado, espaços colapsados, teto
t('nome aparado', normalizarNomeTag('  Implante   dental ') === 'Implante dental');
t('nome vazio', normalizarNomeTag('   ') === null);
t('nome não-string', normalizarNomeTag(null) === null);
t('nome no teto', normalizarNomeTag('x'.repeat(100)).length === NOME_TAG_MAX);
// SQL: lateral por alias, ordenado, json vazio quando sem tag
const sql = tagsDoLeadSql('ranked');
t('sql usa o alias', sql.includes('a.lead_id = ranked.id'));
t('sql vazio é []', sql.includes("'[]'::json"));
t('sql ordena por nome', sql.includes('ORDER BY lower(t.name)'));

// definirTagsDoLead com pool stub: só tags do cliente entram, updated_at sobe, transação fecha
function poolStub({ leadDoCliente = true, validas = [] } = {}) {
  const q = [];
  return { q, query: async (sql, params) => {
    q.push([sql.replace(/\s+/g, ' ').trim(), params]);
    if (sql.includes('FROM public.crm_leads WHERE id = $1 AND client_id = $2')) return { rowCount: leadDoCliente ? 1 : 0, rows: [] };
    if (sql.includes('FROM public.crm_lead_tags WHERE client_id')) return { rows: validas.map(id => ({ id })) };
    if (sql.includes('JOIN public.crm_lead_tags t ON t.id = a.tag_id') && sql.includes('ANY($1::uuid[])')) return { rows: validas.map(id => ({ lead_id: params[0][0], id, name: 'T' + id.slice(0, 4), color: '#0ea5e9' })) };
    return { rows: [], rowCount: 0 };
  } };
}
{
  const p = poolStub({ validas: [U] });
  const r = await definirTagsDoLead(p, 'c1', 'lead-1', [U, 'nao-e-uuid', '11111111-2222-4333-8444-555555555555']);
  t('devolve só as aceitas', r.length === 1 && r[0].id === U);
  const sqls = p.q.map(x => x[0]);
  t('abre e fecha transação', sqls.includes('BEGIN') && sqls.includes('COMMIT') && !sqls.includes('ROLLBACK'));
  t('remove o que saiu da lista', sqls.some(s => s.startsWith('DELETE FROM public.crm_lead_tag_assignments')));
  t('insere as aceitas', p.q.some(([s, prm]) => s.includes('INSERT INTO public.crm_lead_tag_assignments') && prm[1].length === 1 && prm[1][0] === U));
  t('tag de outro cliente NÃO é pedida ao banco como aceita', !p.q.some(([s, prm]) => s.includes('INSERT INTO') && prm[1].includes('11111111-2222-4333-8444-555555555555')));
  t('bate updated_at do lead (poll incremental)', sqls.some(s => s.includes('UPDATE public.crm_leads SET updated_at = NOW()')));
}
{
  const p = poolStub({ leadDoCliente: false });
  t('lead de outro cliente → null, sem escrever', await definirTagsDoLead(p, 'c1', 'lead-x', [U]) === null && !p.q.some(([s]) => /INSERT|DELETE|UPDATE/.test(s)));
}
{
  const p = poolStub({ validas: [] });
  const r = await definirTagsDoLead(p, 'c1', 'lead-1', []);
  t('lista vazia limpa tudo', r.length === 0 && p.q.some(([s]) => s.startsWith('DELETE')) && !p.q.some(([s]) => s.includes('INSERT INTO')));
}

// acesso: quem pode o quê
t('atendente lê catálogo', regraCliente('/api/crm/tags', 'GET', false) !== null);
t('atendente aplica tag no lead', regraCliente(`/api/crm/${U}/tags`, 'PUT', false) !== null);
t('atendente NÃO cria tag', regraCliente('/api/crm/tags', 'POST', false) === null);
t('atendente NÃO renomeia', regraCliente(`/api/crm/tags/${U}`, 'PATCH', false) === null);
t('atendente NÃO apaga', regraCliente(`/api/crm/tags/${U}`, 'DELETE', false) === null);
t('gestor cria', regraCliente('/api/crm/tags', 'POST', true) !== null);
t('gestor renomeia', regraCliente(`/api/crm/tags/${U}`, 'PATCH', true) !== null);
t('gestor apaga', regraCliente(`/api/crm/tags/${U}`, 'DELETE', true) !== null);
t('rota antiga de assign NÃO é liberada', regraCliente(`/api/crm/tags/${U}/assign`, 'POST', true) === null);
// o lead do caminho é citado (o proxy resolve o dono); a tag do caminho não confunde com lead
t('PUT lead/tags cita o lead', leadsCitados(`/api/crm/${U}/tags`, {}).includes(U));
t('/api/crm/tags/<id> não é lido como lead', leadsCitados(`/api/crm/tags/${U}`, {}).length === 0);
console.log(`${ok} ok, ${falhas} falhas`); process.exit(falhas ? 1 : 0);
