'use client';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SeletorCliente } from '@/components/disparos/seletor-cliente';
import { ConfirmarClienteModal } from '@/components/disparos/confirmar-cliente-modal';
import type { DestinoCliente, InstanciaOrfa } from '@/lib/disparos-destinos';

// Espelha o estado REAL de producao lido em 20/08.
const DESTINOS: DestinoCliente[] = [
  { clientId: 'c-dom', clientName: 'Dominos', disponivel: true,
    instancias: [{ instanceId: 'dominos-69-3222-6446', nome: 'Dominos', provider: 'evolution', existe: true, conectada: true, impedimento: '' }] },
  { clientId: 'c-pico', clientName: 'PicoLocos', disponivel: true,
    instancias: [
      { instanceId: 'picolocos-prochet-43-8477-7390', nome: 'Prochet', provider: 'evolution', existe: true, conectada: true, impedimento: '' },
      { instanceId: 'picolocos-guanabara---43-9978-0123', nome: 'Guanabara', provider: 'evolution', existe: true, conectada: false, impedimento: 'desconectada' },
    ] },
  { clientId: 'c-cambe', clientName: 'Sorrifácil Cambé', disponivel: true,
    instancias: [{ instanceId: 'sorrifacil-cambe-43-9115-1017', nome: 'Cambé', provider: 'evolution', existe: true, conectada: true, impedimento: '' }] },
  { clientId: 'c-saac', clientName: 'Saac Equipamentos', disponivel: false,
    instancias: [{ instanceId: 'saac-43-9616-7637', nome: 'SAAC', provider: 'evolution', existe: true, conectada: false, impedimento: 'desconectada' }] },
];
const ORFAS: InstanciaOrfa[] = [
  { instanceId: 'disparo-saac-2-0-mt1up1py', nome: 'disparo-saac-2-0-mt1up1py', conectada: true, emDisparos: true },
  { instanceId: 'Onmid Assistente', nome: 'Onmid Assistente', conectada: true, emDisparos: true },
];

function App() {
  const [sel, setSel] = useState({ onmidClientId: '', instanceId: '' });
  const [aberto, setAberto] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const cli = DESTINOS.find(d => d.clientId === sel.onmidClientId);
  return (
    <div style={{ padding: 24, maxWidth: 460 }}>
      <SeletorCliente destinos={DESTINOS} orfas={ORFAS}
        onmidClientId={sel.onmidClientId} instanceId={sel.instanceId} onChange={setSel} />
      <button id="btn-criar" style={{ marginTop: 16, padding: '8px 14px' }}
        disabled={!sel.onmidClientId || !sel.instanceId}
        onClick={() => setAberto(true)}>Criar campanha</button>
      <pre id="log" style={{ marginTop: 12, fontSize: 11 }}>{log.join('\n')}</pre>
      <ConfirmarClienteModal
        aberto={aberto}
        clienteNome={cli?.clientName ?? ''}
        instanciaNome={sel.instanceId}
        totalContatos={988}
        acao="criar"
        onCancelar={() => setAberto(false)}
        onConfirmar={n => { setLog(l => [...l, `POST {onmidClientId:${sel.onmidClientId}, instanceId:${sel.instanceId}, confirmClientName:"${n}"}`]); setAberto(false); }}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
