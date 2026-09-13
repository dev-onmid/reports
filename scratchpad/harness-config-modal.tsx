// Harness do modal "Configurar cliente" (client-config-modal.tsx) com fetch mockado.
//   npx esbuild scratchpad/harness-config-modal.tsx --bundle --outfile=public/__cfg_test/app.js \
//     --format=iife --loader:.tsx=tsx --define:process.env.NODE_ENV='"development"' --alias:@=./src --log-level=warning
//   npx @tailwindcss/cli -i src/app/globals.css -o public/__cfg_test/app.css --minify
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BarChart3, Filter, Layers, Sparkles } from 'lucide-react';
import { ClientConfigModal, CelulaAjuste, SELECT_AJUSTE } from '../src/app/(dashboard)/clientes/[id]/client-config-modal';

const url = new URL(location.href);
const inativo = url.searchParams.get('inativo') === '1';
const semContas = url.searchParams.get('semcontas') === '1';

window.fetch = async (input: RequestInfo | URL) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  (window as unknown as { chamadas: string[] }).chamadas ??= [];
  (window as unknown as { chamadas: string[] }).chamadas.push(u);
  if (u.includes('/billing-mode')) return new Response(JSON.stringify({ mode: 'prepaid' }), { headers: { 'Content-Type': 'application/json' } });
  return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
};

function App() {
  const [open, setOpen] = useState(true);
  const [fid, setFid] = useState(false);
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <button className="rounded border border-border px-3 py-1 text-sm" onClick={() => setOpen(true)}>Abrir modal</button>
      <ClientConfigModal open={open} onClose={() => setOpen(false)} clientId="c1" clientName="CondoStore"
        statusCliente={inativo ? 'Inativo' : 'Ativo'} inativo={inativo}
        contas={semContas ? { meta: 0, google: 0 } : { meta: 1, google: 0 }}
        onVincularContas={() => console.log('vincular')} onIrParaIntegracoes={() => console.log('integracoes')}
        onAlterarStatus={() => console.log('status')} onAcaoCrm={(a) => console.log('crm', a)}
        ajustes={(
          <>
            <CelulaAjuste icone={Layers} rotulo="Categoria"><select className={SELECT_AJUSTE} defaultValue=""><option value="">Sem categoria</option><option>Clínicas</option></select></CelulaAjuste>
            <CelulaAjuste icone={BarChart3} rotulo="Dashboard"><select className={SELECT_AJUSTE} defaultValue="leads"><option value="leads">Leads</option><option value="food">Food / Delivery</option></select></CelulaAjuste>
            <CelulaAjuste icone={Filter} rotulo="Topo do funil"><select className={SELECT_AJUSTE} defaultValue="auto"><option value="auto">Automático (CRM se houver)</option></select></CelulaAjuste>
            <CelulaAjuste icone={Sparkles} rotulo="Fidelidade">
              <button type="button" onClick={() => setFid(v => !v)} className={'mt-0.5 h-7 rounded-md border px-2.5 text-xs font-bold uppercase tracking-wider ' + (fid ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>{fid ? 'Ativa' : 'Desativada'}</button>
            </CelulaAjuste>
          </>
        )} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
