// Monta a PÁGINA REAL de Disparos isolada, com fetch mockado — é o que permite
// conferir a seção de rodízio de imagens e o preview sem banco local.
import { createRoot } from 'react-dom/client';
import DisparosPage from '@/app/(dashboard)/disparos/page';

const J = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const destinos = {
  clientes: [{
    clientId: 'c-pico', clientName: 'PicoLocos Guanabara', disponivel: true,
    instancias: [{ instanceId: 'picolocos-guanabara---43-9978-0123', nome: 'Guanabara', provider: 'evolution', existe: true, conectada: true, impedimento: '' }],
  }],
  orfas: [],
  erroEvolution: '',
};
const real = window.fetch.bind(window);
(window as unknown as { __posts: unknown[] }).__posts = [];
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
  if (init?.method === 'POST' && url.includes('/api/disparos/campaigns')) {
    (window as unknown as { __posts: unknown[] }).__posts.push(JSON.parse(String(init.body)));
    return J({ id: 'novo', invalid_count: 0 }, 201);
  }
  if (url.includes('/api/disparos/destinos')) return J(destinos);
  if (url.includes('/api/disparos/etiquetas')) return J({ etiquetas: [
    { id: '16', name: 'Agendou', color: '12' },
    { id: '12', name: 'LEAD WHATSAPP NORMAL', color: '8' },
    { id: '10', name: 'LEAD SITE', color: '6' },
  ], erro: '' });
  if (url.includes('/api/disparos/respostas')) return J({
    'cmp-1': { campaignId: 'cmp-1', mensuravel: true, enviados: 1288, responderam: 24, taxa: 1.863 },
    'cmp-2': { campaignId: 'cmp-2', mensuravel: true, enviados: 62, responderam: 3, taxa: 4.838 },
    'cmp-3': { campaignId: 'cmp-3', mensuravel: false, enviados: 40, responderam: 0, taxa: null },
  });
  if (url.includes('/api/disparos/campaigns')) return J([
    { id: 'cmp-1', name: 'TOUR 2025 | 2 BOWL + PINK', client_name: 'PicoLocos Guanabara', status: 'running',
      total: 2078, sent: 1288, failed: 20, starts_at: new Date().toISOString(), interval_min: 500, interval_max: 530,
      message: 'oi', created_at: new Date().toISOString() },
    { id: 'cmp-2', name: 'PICOLOCOS - CLIENTE DA CASA', client_name: 'PicoLocos Guanabara', status: 'running',
      total: 515, sent: 62, failed: 0, starts_at: new Date().toISOString(), interval_min: 180, interval_max: 300,
      message: 'oi', created_at: new Date().toISOString() },
    { id: 'cmp-3', name: 'CAMPANHA SEM VINCULO NO CRM', client_name: 'Outro', status: 'paused',
      total: 100, sent: 40, failed: 0, starts_at: new Date().toISOString(), interval_min: 90, interval_max: 210,
      message: 'oi', created_at: new Date().toISOString() },
  ]);
  if (url.includes('/api/disparos/clients')) return J([]);
  if (url.includes('/api/clients')) return J([{ id: 'c-pico', name: 'PicoLocos Guanabara', status: 'Ativo' }]);
  if (url.includes('/api/ai/whatsapp-variations')) {
    // 4 variações => 5 textos no total, o cenário real das campanhas de produção.
    return J([1, 2, 3, 4].map(i => ({ text: `Variação ${i} da mensagem`, label: `Ângulo ${i}` })));
  }
  if (url.includes('/api/')) return J([]);
  return real(input as RequestInfo, init);
};
window.localStorage.setItem('onmid-session', JSON.stringify({ userId: 'u1', name: 'M', email: 'm@o.com', role: 'Administrador', team: 'onmid' }));

createRoot(document.getElementById('root')!).render(<DisparosPage />);
