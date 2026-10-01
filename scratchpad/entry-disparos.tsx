// Monta a PÁGINA REAL de Disparos isolada, com fetch mockado — é o que permite
// conferir a seção de rodízio de imagens e o preview sem banco local.
import { createRoot } from 'react-dom/client';
import DisparosPage from '@/app/(dashboard)/disparos/page';

const J = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });
const destinos = {
  destinos: [{
    clientId: 'c-pico', clientName: 'PicoLocos Guanabara', disponivel: true,
    instancias: [{ instanceId: 'picolocos-guanabara---43-9978-0123', nome: 'Guanabara', provider: 'evolution', existe: true, conectada: true, impedimento: '' }],
  }],
  orfas: [],
};
const real = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : (input as Request).url ?? String(input);
  if (url.includes('/api/disparos/destinos')) return J(destinos);
  if (url.includes('/api/disparos/campaigns')) return J([]);
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
