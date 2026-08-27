// Harness da aba Delivery — troca de token e desconexão do Cardápio Web.
//
// A página do cliente não monta em bundle isolado (usa next/link), então a aba
// é montada sozinha com as rotas interceptadas.
import { createRoot } from 'react-dom/client';
import { ClientDeliveryTab } from '@/app/(dashboard)/clientes/[id]/delivery-tab';

const conexao = {
  client_id: 'client-1784380469744', merchant_id: '60744',
  merchant_name: 'Istambul Gastrobar', token_masked: '1avcuo••••••••••rwfV',
  webhook_token: '382eb77e82b8ee8abd3a4ccbc753ce653dfc6eab6f4f81c5',
  sandbox: false, janela_dias: 30, inatividade_dias: 60,
};
const sync = { total_pedidos: 10, ultima_sync_em: '2026-08-27T01:05:02.990Z',
  historico_concluido: true, ultimo_erro: null };

const chamadas: string[] = [];
window.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
  const url = String(u); const m = init?.method ?? 'GET';
  chamadas.push(`${m} ${url}${init?.body ? ' :: ' + String(init.body) : ''}`);
  (window as unknown as { __chamadas: string[] }).__chamadas = chamadas;
  const j = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });
  if (url.includes('/api/cardapioweb/config')) {
    if (m === 'DELETE') return j({ ok: true, pedidos_preservados: true });
    if (m === 'POST') return j({ ok: true });
    return j({ conexao });
  }
  if (url.includes('/cardapioweb')) return j({ ...sync, resumo: null });
  if (url.includes('anota-ai')) return j({ stores: [] });
  return j({});
}) as typeof fetch;
window.confirm = () => true;

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-[#0e0f14] p-6 text-foreground">
    <ClientDeliveryTab clientId="client-1784380469744" />
  </div>
);
