import { createRoot } from 'react-dom/client';
import { CreativeLibrary } from '@/components/creative-library';

const linhas = [
  { client_id:'c1', client_name:'Sorrifácil ingleses', segment:'Clínicas', ad_key:'a1', source_id:'1', ad_name:'DARK - FACETAS 01',
    creative_name:null, campaign_name:'[ON] FACETAS', adset_name:'AMPLO', source_url:null,
    leads:134, conversas:52, comparecimentos:19, qualificados:23, engajados:48, vendas:12, receita:14188.27,
    ig_leads:90, fb_leads:44, por_status:{ 'Agendado': 22, 'Fechado': 12 }, last_lead_at:new Date().toISOString() },
  { client_id:'c1', client_name:'Sorrifácil ingleses', segment:'Clínicas', ad_key:'a2', source_id:'2', ad_name:'DARK - PERDEU UM DENTE',
    creative_name:null, campaign_name:'[ON] IMPLANTE', adset_name:'40+', source_url:null,
    leads:51, conversas:20, comparecimentos:7, qualificados:37, engajados:44, vendas:4, receita:8950,
    ig_leads:30, fb_leads:21, por_status:{ 'Agendado': 9 }, last_lead_at:new Date().toISOString() },
];

const origFetch = window.fetch;
window.fetch = (async (url: any, init?: any) => {
  const u = String(typeof url === 'string' ? url : url?.url ?? url);
  if (u.includes('/api/creative-library/enrich')) return new Response(JSON.stringify({ items: [] }), { headers:{'Content-Type':'application/json'} });
  if (u.includes('/api/creative-library')) return new Response(JSON.stringify({ creatives: linhas }), { headers:{'Content-Type':'application/json'} });
  return origFetch(url, init);
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(
  <div style={{ background:'#0e0f14', minHeight:'100vh', padding:16 }}><CreativeLibrary /></div>
);
