import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BotaoTags, FiltroTag, TagChips, TagsConfigModal, salvarTagsDoLead, useTagsDoCliente, type CrmTag } from '../src/app/(dashboard)/crm/tags';
import { Toasts } from '../src/components/ui/toast';

// Estado "do servidor", em memória — e o registro de requisições para conferir
const g = globalThis as unknown as { __tags: CrmTag[]; __lead: string[]; __reqs: { m: string; u: string; b: unknown }[] };
g.__tags = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Implante', color: '#0ea5e9', lead_count: 3 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Convênio', color: '#f59e0b', lead_count: 1 },
];
g.__lead = ['11111111-1111-4111-8111-111111111111'];
g.__reqs = [];
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const m = (init?.method ?? 'GET').toUpperCase();
  const b = init?.body ? JSON.parse(String(init.body)) : null;
  g.__reqs.push({ m, u, b });
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });
  if (u.startsWith('/api/crm/tags?')) return json(g.__tags);
  if (u === '/api/crm/tags' && m === 'POST') {
    if (b.name === 'Erro') return json({ error: 'Já existe uma tag com esse nome.' }, 409);
    const t = { id: `33333333-3333-4333-8333-${String(g.__tags.length).padStart(12, '0')}`, name: b.name, color: b.color, lead_count: 0 };
    g.__tags = [...g.__tags, t]; return json(t, 201);
  }
  const mt = u.match(/^\/api\/crm\/tags\/([^/]+)$/);
  if (mt && m === 'PATCH') { g.__tags = g.__tags.map(t => (t.id === mt[1] ? { ...t, ...b } : t)); return json(g.__tags.find(t => t.id === mt[1])); }
  if (mt && m === 'DELETE') { g.__tags = g.__tags.filter(t => t.id !== mt[1]); return json({ ok: true }); }
  const ml = u.match(/^\/api\/crm\/([^/]+)\/tags$/);
  if (ml && m === 'PUT') { g.__lead = b.tagIds; return json({ tags: g.__tags.filter(t => b.tagIds.includes(t.id)) }); }
  return realFetch(input, init);
};

function App() {
  const { tags, setTags, recarregar } = useTagsDoCliente('client-1');
  const [leadTags, setLeadTags] = useState<CrmTag[]>(() => g.__tags.filter(t => g.__lead.includes(t.id)));
  const [filtro, setFiltro] = useState('');
  const [config, setConfig] = useState(false);
  async function definir(ids: string[]) {
    setLeadTags(tags.filter(t => ids.includes(t.id)));
    setLeadTags(await salvarTagsDoLead('lead-1', ids));
    void recarregar();
  }
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <div className="mb-4 flex items-center gap-2">
        <FiltroTag tags={tags} valor={filtro} onChange={setFiltro} />
        <button type="button" onClick={() => setConfig(true)} data-test="abrir-config" className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold">Tags</button>
        <span data-test="filtro-valor" className="text-xs text-muted-foreground">filtro={filtro || '(todas)'}</span>
      </div>
      <div className="w-[232px]">
        <div data-test="card" className="group relative rounded-md border border-border bg-card px-2.5 py-2">
          <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded-md bg-card/95">
            <BotaoTags tags={tags} selecionadas={leadTags.map(t => t.id)} onChange={ids => void definir(ids)} onConfigurar={() => setConfig(true)} />
          </div>
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">Maria da Silva</p>
          <TagChips tags={leadTags} className="mt-0.5" />
          <p className="mt-0.5 text-[10px] text-muted-foreground">(43) 99999-8888</p>
        </div>
      </div>
      {config && <TagsConfigModal clientId="client-1" tags={tags} onChange={setTags} onClose={() => setConfig(false)} />}
      <Toasts />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
