// Página do anúncio no evento de mensagem da Meta (2026-10-23, Cost com 2 Páginas).
// Compilar antes: npx esbuild src/lib/meta-ad-resolver.ts src/lib/conversions.ts --bundle --platform=node --format=esm --packages=external --outdir=scratchpad/build --out-extension:.js=.mjs
import { paginaDoCriativo, resolverPaginaDoAnuncio } from './build/meta-ad-resolver.mjs';
import { enviarEventoMeta } from './build/conversions.mjs';

let ok = 0, falhas = 0;
const t = (nome, cond) => { if (cond) ok++; else { falhas++; console.log('FALHOU:', nome); } };
const TAYNA = '1320410274483948', COST = '1980619558831070', AD = '120251591497360751';

// --- pura
t('spec explícita vence', paginaDoCriativo({ object_story_spec: { page_id: TAYNA }, actor_id: COST }) === TAYNA);
t('sem spec usa actor', paginaDoCriativo({ actor_id: TAYNA }) === TAYNA);
t('sem spec/actor usa prefixo do post', paginaDoCriativo({ effective_object_story_id: `${TAYNA}_122118302265453812` }) === TAYNA);
t('nada → null', paginaDoCriativo({}) === null && paginaDoCriativo(null) === null);
t('lixo não-numérico ignorado', paginaDoCriativo({ actor_id: 'abc', effective_object_story_id: `${COST}_1` }) === COST);

// --- pool stub genérico
function pool({ cache = null, sourceId = AD, cfg = true } = {}) {
  const log = [];
  return {
    log,
    async query(sql, params) {
      log.push({ sql, params });
      if (sql.includes('FROM public.meta_ad_page_cache')) return { rows: cache ? [{ page_id: cache }] : [] };
      if (sql.includes('FROM public.client_account_links')) return { rows: [{ connection_id: 'cx' }] };
      if (sql.includes('FROM public.meta_connections')) return { rows: [{ id: 'cx', app_id: 'a', access_token: 'tok', token_expiry: '2099-01-01' }] };
      if (sql.includes('FROM public.crm_leads WHERE id')) return { rows: [{ source_id: sourceId }] };
      if (sql.includes('FROM public.client_conversion_config')) return { rows: cfg ? [{ meta_ativo: true, meta_pixel_id: 'px', meta_access_token: 'dt', meta_page_id: COST, meta_test_event_code: '' }] : [] };
      return { rows: [], rowCount: 0 };
    },
  };
}
let graph = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  graph.push({ u, body: opts?.body });
  if (u.includes(`/${AD}?`)) return new Response(JSON.stringify({ creative: { object_story_spec: { page_id: TAYNA } } }), { status: 200 });
  if (u.includes('/events')) return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  if (u.includes('oauth')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
  return new Response('{}', { status: 404 });
};

// --- resolver
{
  graph = [];
  const p = pool({ cache: TAYNA });
  t('cache devolve sem chamar a Graph', await resolverPaginaDoAnuncio(p, 'c1', AD) === TAYNA && !graph.some(g => g.u.includes(AD)));
}
{
  graph = [];
  const p = pool();
  t('sem cache busca na Graph', await resolverPaginaDoAnuncio(p, 'c1', AD) === TAYNA);
  t('grava no cache', p.log.some(l => l.sql.includes('INSERT INTO public.meta_ad_page_cache') && l.params[1] === TAYNA));
}
t('id que não é da Meta → null sem chamada', await resolverPaginaDoAnuncio(pool(), 'c1', 'Já é paciente') === null);

// --- payload enviado à Meta
async function payload(lead, opts) {
  graph = [];
  await enviarEventoMeta(pool(opts), 'c1', 'Lead', lead);
  const ev = graph.find(g => g.u.includes('/events'));
  return ev ? JSON.parse(ev.body).data[0].user_data : null;
}
{
  const ud = await payload({ id: '1d4eeff1-2e87-40dd-97ab-6ecc131ab328', phone: '5548999999999', ctwaClid: 'Afg...' });
  t('lead CTWA da Tayná vai com a Página da Tayná', ud?.page_id === TAYNA && ud?.ctwa_clid === 'Afg...');
}
{
  const ud = await payload({ id: 'x', phone: '5548999999999', ctwaClid: 'Afg...', sourceId: AD }, { sourceId: null });
  t('sourceId passado direto é usado', ud?.page_id === TAYNA);
}
{
  const ud = await payload({ id: 'x', phone: '5548999999999', ctwaClid: 'Afg...' }, { sourceId: null });
  t('CTWA sem anúncio conhecido cai na Página do config', ud?.page_id === COST);
}
{
  const ud = await payload({ id: 'x', phone: '5548999999999' });
  t('sem ctwa_clid: Página do config e nenhuma busca de anúncio', ud?.page_id === COST && !graph.some(g => g.u.includes(AD)));
}

console.log(`${ok} ok, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
