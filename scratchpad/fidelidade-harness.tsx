// Harness da aba Fidelidade — renderiza o componente REAL com a rota mockada.
//
// A página do cliente inteira não monta fora do runtime do Next (usa next/link
// e o auth-guard), e o dev local não tem DATABASE_URL. Por isso o componente é
// montado sozinho, com um /api/clients/:id/fidelidade falso que devolve o
// mesmo shape da rota de verdade.
//
//   npx esbuild scratchpad/fidelidade-harness.tsx --bundle --outfile=public/__fid_test/app.js \
//     --loader:.tsx=tsx --define:process.env.NODE_ENV='"development"' --format=iife
//   npx @tailwindcss/cli -i src/app/globals.css -o public/__fid_test/app.css
//   abrir http://localhost:3000/__fid_test/
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientFidelidadeTab } from '../src/app/(dashboard)/clientes/[id]/fidelidade-tab';

const PESSOAS = (n: number, base: number) =>
  Array.from({ length: n }, (_, i) => ({
    nome: i === 3 ? null : `Cliente ${base + i}`,
    telefone: `4399${String(900000 + base + i)}`,
    pedidos: 1 + (i % 5),
    receita: 80 + i * 37,
    ticketMedio: 60 + i * 9,
    diasDesdeUltima: base + i * 3,
    ultimaCompra: '2026-07-01T12:00:00.000Z',
  }));

const RESPOSTA = {
  conectado: true,
  loja: 'Tokio Maki',
  regua: { janelaDias: 30, inatividadeDias: 60 },
  ticketMedioLoja: 104.5,
  base: { clientes: 1840, comTelefone: 1792 },
  instancia: { provider: 'evolution', id: 'tokiomaki-oficial' },
  travas: {
    intervaloMinSeg: 120, tetoDiario: 50, janelaInicio: '09:00', janelaFim: '20:00',
    diasSemana: [1, 2, 3, 4, 5, 6], cooldownDias: 7, optoutAtivo: true,
  },
  campanhas: [
    { modelo: 'primeira_recompra', params: { diasMin: 10, diasMax: 120 },
      mensagens: ['Oi, {{primeiro_nome}}! Vi que faz {{dias}} dias que você pediu na {{loja}} pela primeira vez 😊 Bora repetir?',
        'E aí, {{primeiro_nome}}! Que tal a segunda rodada?', 'Oi {{primeiro_nome}}, usa o {{cupom10}} hoje!'],
      imagemUrl: null, diasSemana: [4], hora: '18:00', tetoPublico: null, ativa: false, salva: true },
    { modelo: 'em_risco', params: { pedidosMin: 2, diasMax: 90 },
      mensagens: ['Oi, {{primeiro_nome}}! Faz {{dias}} dias que a gente não te vê 👀'],
      imagemUrl: null, diasSemana: [2], hora: '18:00', tetoPublico: null, ativa: false, salva: false },
    { modelo: 'inativo', params: { pedidosMin: 2, diasMax: 180 },
      mensagens: ['{{primeiro_nome}}, faz {{dias}} dias que você não pede na {{loja}}...'],
      imagemUrl: null, diasSemana: [3], hora: '17:00', tetoPublico: 200, ativa: false, salva: false },
    { modelo: 'vip', params: { pedidosMin: 4, ticketMin: null },
      mensagens: ['Oi, {{primeiro_nome}}! Você é um dos que mais pede na {{loja}} 💜'],
      imagemUrl: null, diasSemana: [5], hora: '17:00', tetoPublico: null, ativa: false, salva: false },
    { modelo: 'reconquistado', params: { diasMax: 15 },
      mensagens: ['Que bom te ver de volta, {{primeiro_nome}}! 🎉'],
      imagemUrl: null, diasSemana: [1], hora: '18:00', tetoPublico: null, ativa: false, salva: false },
  ],
  segmentos: [
    { modelo: 'primeira_recompra',
      resumo: { pessoas: 612, receitaHistorica: 58_430.5, ticketMedio: 95.47, diasParadoMediano: 47 },
      amostra: PESSOAS(25, 12) },
    { modelo: 'em_risco',
      resumo: { pessoas: 134, receitaHistorica: 41_220, ticketMedio: 118.3, diasParadoMediano: 38 },
      amostra: PESSOAS(25, 34) },
    { modelo: 'inativo',
      resumo: { pessoas: 289, receitaHistorica: 96_110, ticketMedio: 121.9, diasParadoMediano: 96 },
      amostra: PESSOAS(25, 70) },
    { modelo: 'vip',
      resumo: { pessoas: 47, receitaHistorica: 88_940, ticketMedio: 187.4, diasParadoMediano: 9 },
      amostra: PESSOAS(25, 2) },
    // Segmento VAZIO de propósito: a tela precisa aguentar zero pessoas.
    { modelo: 'reconquistado',
      resumo: { pessoas: 0, receitaHistorica: 0, ticketMedio: 0, diasParadoMediano: null },
      amostra: [] },
  ],
};

const chamadas: { url: string; body: unknown }[] = [];
(window as unknown as { __chamadas: typeof chamadas }).__chamadas = chamadas;

const original = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/fidelidade')) {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url: `${init?.method ?? 'GET'} ${url}`, body });
    await new Promise(r => setTimeout(r, 120));
    return new Response(JSON.stringify(RESPOSTA), { headers: { 'Content-Type': 'application/json' } });
  }
  return original(input as RequestInfo, init);
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(
  <div className="mx-auto max-w-6xl bg-background p-6 text-foreground">
    <ClientFidelidadeTab clientId="cli-teste" />
  </div>,
);
