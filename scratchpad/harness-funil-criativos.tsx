// Harness do Funil de criativos com dados REAIS (scratchpad/build-ga4/funil-criativos.json, não versionar).
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FunilCriativosPanel } from '@/components/dashboard/funil-criativos';
function App() {
  const [d, setD] = useState<Record<string, { crm: never[]; meta: never[] }> | null>(null);
  const cli = new URLSearchParams(location.search).get('c') ?? 'Sorrifácil Cambé';
  useEffect(() => { fetch('funil-criativos.json').then(r => r.json()).then(setD); }, []);
  return (
    <div style={{ padding: 24 }}>
      <FunilCriativosPanel criativos={d?.[cli]?.meta ?? []} crm={d?.[cli]?.crm ?? []} loading={!d} onPreview={c => alert(c.adName)} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
