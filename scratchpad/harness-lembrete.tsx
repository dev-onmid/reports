import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LembreteAlarme } from '@/components/layout/lembrete-alarme';
import { NovoLembrete } from '@/components/layout/novo-lembrete';

// mocks das rotas que o modal consulta
const origFetch = window.fetch;
window.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(typeof url === 'string' ? url : (url as Request).url ?? url);
  if (u.includes('/api/users')) {
    return new Response(JSON.stringify([
      { id: 'u2', name: 'Letícia Ribeiro' }, { id: 'u3', name: 'Diego Comercial' },
    ]), { headers: { 'Content-Type': 'application/json' } });
  }
  if (u.includes('/api/lembretes')) {
    (window as any).__ultimoPost = JSON.parse(String(init?.body ?? '{}'));
    return new Response(JSON.stringify({ id: 'novo' }), { headers: { 'Content-Type': 'application/json' } });
  }
  return origFetch(url as any, init);
}) as typeof window.fetch;

function App() {
  const [itens, setItens] = useState([
    { id: 'a1', titulo: 'Ligar para o cliente sobre a proposta', descricao: 'Ele pediu retorno hoje até as 18h' },
    { id: 'a2', titulo: 'Revisar orçamento da Londrigifts', descricao: null },
  ]);
  return (
    <div style={{ minHeight: '100vh', background: '#0e0f14', color: '#fff', padding: 24 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontSize: 12, opacity: .6 }}>header simulado →</span>
        <NovoLembrete />
      </div>
      <button id="rearmar" onClick={() => setItens([{ id: 'a' + Date.now(), titulo: 'Lembrete novo', descricao: 'teste' }])}
        style={{ padding: '8px 12px', fontSize: 12 }}>Rearmar alarme</button>
      <LembreteAlarme
        itens={itens}
        onVi={id => setItens(v => v.filter(i => i.id !== id))}
        onAdiar={id => setItens(v => v.filter(i => i.id !== id))}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
