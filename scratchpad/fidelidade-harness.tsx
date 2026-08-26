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
//
// Cenários por query:
//   ?desativada=1  → cliente com o interruptor desligado
//   ?semdelivery=1 → cliente sem Cardápio Web/Anota AI (só listas manuais)
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientFidelidadeTab } from '../src/app/(dashboard)/clientes/[id]/fidelidade-tab';

const q = new URLSearchParams(location.search);
const DESATIVADA = q.has('desativada');
const SEM_DELIVERY = q.has('semdelivery');
// ?vazio=1 → cliente novo, sem nenhuma campanha criada (o estado inicial real)
const VAZIO = q.has('vazio');

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

const campanhaSegmento = (modelo: string, params: Record<string, number | null>, msgs: string[], extra = {}) => ({
  id: `id-${modelo}`, fonte: 'segmento', modelo, listaId: null, nome: modelo,
  params, mensagens: msgs, cupom: null, imagemUrl: null,
  diasSemana: [4], hora: '18:00', tetoPublico: null, ativa: false, salva: true,
  ultimaExecucao: null, criadoEm: '2026-05-14T12:00:00.000Z', ...extra,
});

const RESPOSTA = {
  ativo: true,
  conectado: !SEM_DELIVERY,
  loja: 'Tokio Maki',
  regua: { janelaDias: 30, inatividadeDias: 60 },
  ticketMedioLoja: SEM_DELIVERY ? 0 : 104.5,
  base: SEM_DELIVERY ? { clientes: 0, comTelefone: 0 } : { clientes: 1840, comTelefone: 1792 },
  instancia: { provider: 'evolution', id: 'tokiomaki-oficial' },
  travas: {
    intervaloMinSeg: 120, tetoDiario: 50, janelaInicio: '09:00', janelaFim: '20:00',
    diasSemana: [1, 2, 3, 4, 5, 6], cooldownDias: 7, optoutAtivo: true,
  },
  campanhas: VAZIO ? [] : [
    campanhaSegmento('primeira_recompra', { diasMin: 10, diasMax: 120 }, [
      'Oi, {{primeiro_nome}}! Faz {{dias}} dias do seu primeiro pedido na {{loja}} 😊 Use o cupom {{cupom}} e volte hoje.',
      'E aí, {{primeiro_nome}}! Que tal a segunda rodada? {{cupom}} é seu.',
    ], { cupom: 'VOLTA10', ativa: true }),
    campanhaSegmento('em_risco', { pedidosMin: 2, diasMax: 90 },
      ['Oi, {{primeiro_nome}}! Faz {{dias}} dias que a gente não te vê 👀']),
    campanhaSegmento('inativo', { pedidosMin: 2, diasMax: 180 },
      ['{{primeiro_nome}}, faz {{dias}} dias que você não pede na {{loja}}...']),
    campanhaSegmento('vip', { pedidosMin: 4, ticketMin: null },
      ['Oi, {{primeiro_nome}}! Você é um dos que mais pede na {{loja}} 💜']),
    campanhaSegmento('reconquistado', { diasMax: 15 },
      ['Que bom te ver de volta, {{primeiro_nome}}! 🎉']),
    // Campanha de LISTA com uma variação inválida de propósito: {{dias}} não
    // existe em lista manual, e a tela precisa recusar o salvamento.
    {
      id: 'camp-lista-1', fonte: 'lista', modelo: null, listaId: 'lista-1',
      nome: 'Oferta — Clientes do salão',
      params: {}, mensagens: [
        'Oi, {{primeiro_nome}}! Passando pra avisar de uma novidade da {{loja}} 😊',
        '{{primeiro_nome}}, tudo bem? A {{loja}} tem uma oferta esperando por você 😉',
        'Faz {{dias}} dias!',
      ],
      cupom: 'SALAO15', imagemUrl: null, diasSemana: [2], hora: '18:00',
      tetoPublico: null, ativa: false, salva: true, ultimaExecucao: null,
      criadoEm: '2026-05-14T12:00:00.000Z',
    },
  ],
  listas: [
    { id: 'lista-1', nome: 'Clientes do salão', contatos: 342, criadoEm: '2026-08-01T12:00:00.000Z' },
    { id: 'lista-2', nome: 'Evento de julho', contatos: 87, criadoEm: '2026-07-20T12:00:00.000Z' },
  ],
  segmentos: SEM_DELIVERY ? [] : [
    { modelo: 'primeira_recompra', resumo: { pessoas: 612, receitaHistorica: 58_430.5, ticketMedio: 95.47, diasParadoMediano: 47 }, amostra: PESSOAS(25, 12) },
    { modelo: 'em_risco', resumo: { pessoas: 134, receitaHistorica: 41_220, ticketMedio: 118.3, diasParadoMediano: 38 }, amostra: PESSOAS(25, 34) },
    { modelo: 'inativo', resumo: { pessoas: 289, receitaHistorica: 96_110, ticketMedio: 121.9, diasParadoMediano: 96 }, amostra: PESSOAS(25, 70) },
    { modelo: 'vip', resumo: { pessoas: 47, receitaHistorica: 88_940, ticketMedio: 187.4, diasParadoMediano: 9 }, amostra: PESSOAS(25, 2) },
    { modelo: 'reconquistado', resumo: { pessoas: 0, receitaHistorica: 0, ticketMedio: 0, diasParadoMediano: null }, amostra: [] },
  ],
  resultados: {
    'id-primeira_recompra': { enviadas: 173, pedidos: 3, receita: 221.9, conversao: 0.017, ticketMedio: 73.97, porCupom: 2 },
    'id-vip': { enviadas: 9, pedidos: 4, receita: 596.9, conversao: 0.444, ticketMedio: 149.23, porCupom: 0 },
    'camp-lista-1': { enviadas: 120, pedidos: 12, receita: 1283.5, conversao: 0.1, ticketMedio: 106.96, porCupom: 8 },
    'id-em_risco': { enviadas: 0, pedidos: 0, receita: 0, conversao: null, ticketMedio: null, porCupom: 0 },
  },
  execucoes: [
    { id: 'e1', campanha: 'Comprou uma vez só', iniciada_em: '2026-08-24T21:00:00.000Z', status: 'rodando', publico: 612, enviadas: 41, falhas: 1, puladas: 128 },
    { id: 'e2', campanha: 'Oferta — Clientes do salão', iniciada_em: '2026-08-19T21:00:00.000Z', status: 'concluida', publico: 342, enviadas: 300, falhas: 4, puladas: 38 },
  ],
};

const ACOMP = {
  travas: RESPOSTA.travas,
  enviadasHoje: 41,
  porStatus: { enviada: 120, pendente: 182, pulada: 38, falha: 2 },
  execucoes: [
    {
      id: 'e1', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', ativa: true,
      status: 'rodando', iniciada_em: '2026-08-25T21:00:00.000Z', concluida_em: null,
      publico: 342, enviadas: 120, puladas: 38, falhas: 2,
    },
  ],
  envios: [
    { id: 'v1', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', nome: 'Matheus Campos',
      telefone: '5543988619300', status: 'enviada', motivo: null, erro: null, cupom: 'SALAO15',
      texto: 'Oi, Matheus! Passando pra avisar de uma novidade da PicoLocos Guanabara 😊',
      criado_em: '2026-08-25T21:00:00.000Z', enviado_em: '2026-08-25T21:40:00.000Z' },
    { id: 'v2', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', nome: null,
      telefone: '5511988887777', status: 'enviada', motivo: null, erro: null, cupom: 'SALAO15',
      texto: 'Tudo bem? A PicoLocos Guanabara tem uma oferta esperando por você 😉',
      criado_em: '2026-08-25T21:00:00.000Z', enviado_em: '2026-08-25T21:38:00.000Z' },
    { id: 'v3', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', nome: 'Ana Paula',
      telefone: '5543999991234', status: 'pulada', motivo: 'cooldown', erro: null, cupom: null, texto: null,
      criado_em: '2026-08-25T21:00:00.000Z', enviado_em: null },
    { id: 'v4', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', nome: 'João',
      telefone: '5543669952409', status: 'falha', motivo: null, cupom: 'SALAO15',
      erro: 'Evolution 400: number does not exist',
      texto: 'Oi, João! Passando pra avisar de uma novidade da PicoLocos Guanabara 😊',
      criado_em: '2026-08-25T21:00:00.000Z', enviado_em: null },
    { id: 'v5', campanha_id: 'camp-lista-1', campanha: 'Oferta — Clientes do salão', nome: 'Carla',
      telefone: '5543912345678', status: 'pendente', motivo: null, erro: null, cupom: null, texto: null,
      criado_em: '2026-08-25T21:00:00.000Z', enviado_em: null },
  ],
  temMais: false,
};

const chamadas: { url: string; body: unknown }[] = [];
(window as unknown as { __chamadas: typeof chamadas }).__chamadas = chamadas;

const original = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/fidelidade/acompanhamento')) {
    chamadas.push({ url: `${init?.method ?? 'GET'} ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    await new Promise(r => setTimeout(r, 60));
    return new Response(JSON.stringify(ACOMP), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/fidelidade/disparar')) {
    chamadas.push({ url: `POST ${url}`, body: init?.body ? JSON.parse(String(init.body)) : null });
    await new Promise(r => setTimeout(r, 80));
    // Resposta real do motor quando manda: { enviada:true, telefone }.
    return new Response(JSON.stringify({ ok: true, resultado: { enviada: true, telefone: '5543999990000', variacao: 0 } }),
      { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/fidelidade')) {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    // Criação de campanha de lista: a rota real devolve { campanha } com id.
    if (body && body.fonte === 'lista' && !body.id) {
      chamadas.push({ url: `PATCH ${url}`, body });
      const nova = {
        id: 'camp-nova', fonte: 'lista', modelo: null, listaId: body.listaId,
        nome: body.nome, params: {}, mensagens: [], cupom: null, imagemUrl: null,
        diasSemana: body.diasSemana, hora: body.hora, tetoPublico: null,
        ativa: false, salva: true, ultimaExecucao: null,
      };
      (RESPOSTA.campanhas as unknown[]).push(nova);
      await new Promise(r => setTimeout(r, 60));
      return new Response(JSON.stringify({ campanha: nova }), { headers: { 'Content-Type': 'application/json' } });
    }
    chamadas.push({ url: `${init?.method ?? 'GET'} ${url}`, body });
    await new Promise(r => setTimeout(r, 80));
    const corpo = DESATIVADA ? { ativo: false, conectado: false } : RESPOSTA;
    return new Response(JSON.stringify(corpo), { headers: { 'Content-Type': 'application/json' } });
  }
  return original(input as RequestInfo, init);
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(
  <div className="mx-auto max-w-6xl bg-background p-6 text-foreground">
    <ClientFidelidadeTab clientId="cli-teste" />
  </div>,
);
