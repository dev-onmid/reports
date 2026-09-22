import { createRoot } from 'react-dom/client';
import { WebhooksCard } from '@/app/(dashboard)/clientes/[id]/webhooks-card';

const BASE = 'https://reports.onmid.app/api/integrations/webhook';
type W = { id: string; nome: string; enabled: boolean; last_received_at: string | null; url: string };
let webhooks: W[] = [
  { id: 'w1', nome: 'Datalytics', enabled: true, last_received_at: '2026-09-22T19:23:37Z', url: `${BASE}/4f2a9c1e8b7d6a5f4e3c2b1a0987654321fedcba98765432` },
  { id: 'w2', nome: 'Formulário do site', enabled: false, last_received_at: null, url: `${BASE}/aa11bb22cc33dd44ee55ff6677889900aabbccddeeff0011` },
];
const logs = [
  { id: 'l1', resultado: 'criado', detalhe: 'Maria Souza · entrou em "Novo lead"', lead_id: 'lead-1', conexao_id: 'w1', webhook_nome: 'Datalytics', raw: { lead: { name: 'Maria Souza', phoneWithDialCode: '+5543999887766' } }, created_at: '2026-09-22T19:23:37Z' },
  { id: 'l2', resultado: 'atualizado', detalhe: 'João Lima · "Novo lead" → "Agendado"', lead_id: 'lead-2', conexao_id: 'w1', webhook_nome: 'Datalytics', raw: { stage: 'Agendado' }, created_at: '2026-09-22T18:02:00Z' },
  { id: 'l3', resultado: 'sem_telefone', detalhe: 'payload sem telefone reconhecível', lead_id: null, conexao_id: 'w2', webhook_nome: 'Formulário do site', raw: { email: 'x@y.com' }, created_at: '2026-09-21T10:00:00Z' },
  { id: 'l4', resultado: 'criado', detalhe: 'lead de antes desta tela', lead_id: null, conexao_id: null, webhook_nome: null, raw: { antigo: true }, created_at: '2026-08-12T01:35:00Z' },
];

(window as unknown as { __chamadas: string[] }).__chamadas = [];
const chamadas = (window as unknown as { __chamadas: string[] }).__chamadas;

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input); const m = init?.method ?? 'GET';
  chamadas.push(`${m} ${u}${init?.body ? ' ' + init.body : ''}`);
  const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (m === 'POST') {
    const b = JSON.parse(String(init!.body)) as { nome: string };
    const novo = { id: 'w' + (webhooks.length + 1), nome: b.nome, enabled: true, last_received_at: null, url: `${BASE}/${'c'.repeat(48)}` };
    webhooks = [...webhooks, novo];
    return j({ ok: true, webhook: novo });
  }
  if (m === 'PATCH') {
    const b = JSON.parse(String(init!.body)) as { id: string; nome?: string; enabled?: boolean };
    webhooks = webhooks.map(w => w.id === b.id ? { ...w, ...(b.nome !== undefined ? { nome: b.nome } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}) } : w);
    return j({ ok: true });
  }
  if (m === 'DELETE') {
    const id = new URL(u, 'http://x').searchParams.get('webhookId');
    webhooks = webhooks.filter(w => w.id !== id);
    return j({ ok: true });
  }
  return j({ webhooks, logs });
}) as typeof fetch;
window.confirm = () => true;

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-background p-6">
    <div className="mx-auto max-w-4xl"><WebhooksCard clientId="c1" /></div>
  </div>,
);
