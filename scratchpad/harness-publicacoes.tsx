// Harness da tela de Publicacoes.
//
// A pagina real nao monta em bundle isolado quando usa next/link, mas esta nao
// usa — entao da pra exercitar o componente de verdade com fetch mockado.
//
//   npx esbuild scratchpad/harness-publicacoes.tsx --bundle --outfile=public/__pub_test/app.js \
//     --format=iife --loader:.tsx=tsx --define:process.env.NODE_ENV='"development"' --log-level=warning
//   npx @tailwindcss/cli -i src/app/globals.css -o public/__pub_test/app.css --minify
//
// Apagar public/__pub_test depois.

import { createRoot } from 'react-dom/client';
import PublicacoesPage from '../src/app/(dashboard)/ferramentas/publicacoes/page';

const CONTAS = [
  { clientId: 'c1', clientName: 'Cinfel', igId: '111', username: 'cinfeloffroad', picture: null, followers: 13622 },
  { clientId: 'c2', clientName: 'La Pasta Gialla', igId: '222', username: 'lapastagiallamaringa', picture: null, followers: 8100 },
  { clientId: 'c3', clientName: 'Istambul', igId: '333', username: 'istambulgastrobar', picture: null, followers: 6068 },
  // Mesma conta da Cinfel: precisa cair no dedupe de `montarAlvos`.
  { clientId: 'c4', clientName: 'Cinfel Filial', igId: '111', username: 'cinfeloffroad', picture: null, followers: 13622 },
  { clientId: 'c5', clientName: 'Sem Instagram', igId: null, username: null, picture: null, followers: null },
];

const PUBS = [
  {
    id: 'p1', tipo: 'feed',
    legenda: 'Promoção de agosto — confira as condições especiais deste mês na loja.',
    modo: 'unico', proxima_execucao: new Date(Date.now() + 3600e3).toISOString(),
    dias_semana: null, hora: null, repetir_ate: null, status: 'agendado',
    midia_token: null, total: 3, publicados: 0, erros: 0, pendentes: 3,
  },
  {
    id: 'p2', tipo: 'story', legenda: '', modo: 'recorrente',
    proxima_execucao: new Date(Date.now() + 86400e3).toISOString(),
    dias_semana: '1,3,5', hora: '09:00', repetir_ate: '2026-09-30', status: 'agendado',
    midia_token: null, total: 5, publicados: 12, erros: 1, pendentes: 4,
  },
];

const DETALHE = {
  ok: true, publicacao: PUBS[1],
  alvos: [
    { id: 'a1', client_id: 'c1', client_name: 'Cinfel', ig_username: 'cinfeloffroad', ig_id: '111', status: 'publicado', erro: null, permalink: 'https://instagram.com/p/xyz', publicado_em: new Date().toISOString(), ocorrencia: new Date().toISOString() },
    { id: 'a2', client_id: 'c2', client_name: 'La Pasta Gialla', ig_username: 'lapastagiallamaringa', ig_id: '222', status: 'erro', erro: 'a Meta recusou a imagem (ERROR)', permalink: null, publicado_em: null, ocorrencia: new Date().toISOString() },
    { id: 'a3', client_id: 'c3', client_name: 'Istambul', ig_username: 'istambulgastrobar', ig_id: '333', status: 'pendente', erro: null, permalink: null, publicado_em: null, ocorrencia: new Date().toISOString() },
  ],
};

type Chamada = { url: string; method: string; body: unknown };
(window as unknown as { __calls: Chamada[] }).__calls = [];

const J = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
  if (init?.method && init.method !== 'GET') {
    let body: unknown = init.body;
    try { body = JSON.parse(String(init.body)); } catch { /* deixa cru */ }
    (window as unknown as { __calls: Chamada[] }).__calls.push({ url, method: init.method, body });
  }
  if (url.includes('/api/publicacoes/upload')) return J({ ok: true, midiaId: 'vid-1', token: 'a'.repeat(32), kb: 2500 });
  if (url.includes('/api/publicacoes/contas')) return J({ ok: true, contas: CONTAS });
  if (/\/api\/publicacoes\/[\w-]+$/.test(url) && !url.endsWith('/contas')) {
    if (init?.method === 'POST') return J({ ok: true, materializados: 0, resultados: [] });
    if (init?.method === 'DELETE') return J({ ok: true });
    return J(DETALHE);
  }
  if (url.includes('/api/publicacoes')) {
    if (init?.method === 'POST') return J({ ok: true, id: 'novo', contas: ['cinfeloffroad'], descartados: [] });
    return J({ ok: true, publicacoes: PUBS });
  }
  return J({ ok: true });
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(<PublicacoesPage />);
