// Harness do editor por ELEMENTO.
//
// A página real do dashboard não monta em bundle isolado (usa next/link e exige
// DATABASE_URL), então o editor é montado sozinho com dados mockados e a rota
// /api/dashboard/modelo interceptada.

import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { ModeloEditor } from '@/components/dashboard/modelo-editor';
import { elementosDelivery } from '@/components/dashboard/delivery-view';
import { modeloPadrao } from '@/lib/dashboard-modelo';
import { estiloDe } from '@/lib/dashboard-elementos';
import { Chapter } from '@/components/dashboard';
import { LayoutDashboard } from 'lucide-react';
import type { DadosDelivery } from '@/types/dashboard';

const w = window as unknown as { __salvo?: unknown };
const real = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.includes('/api/dashboard/modelo')) {
    if (init?.method === 'PUT') {
      w.__salvo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ ok: true, modelo: (w.__salvo as { modelo: unknown }).modelo }), { status: 200 });
    }
    return new Response(JSON.stringify({ modelo: modeloPadrao('food') }), { status: 200 });
  }
  return real(input as RequestInfo, init);
}) as typeof window.fetch;

const dados: DadosDelivery = {
  periodo: { de: '2026-07-16', ate: '2026-08-15' },
  fonte: { status: 'ok', atualizadoEm: '2026-08-15T12:00:00Z' },
  vendas: { receita: 184320, pedidos: 2461, ticket: 74.9, novosClientes: 318, dias: 31 },
  anterior: { receita: 160200, pedidos: 2210 },
  variacao: { receita: 0.15, pedidos: 0.113, ticket: 0.034 },
  serie: Array.from({ length: 31 }, (_, i) => ({
    data: `2026-07-${String(i + 1).padStart(2, '0')}`,
    label: `${i + 1}/07`,
    receita: 4000 + Math.round(Math.sin(i / 3) * 1800) + i * 40,
    pedidos: 60 + Math.round(Math.cos(i / 4) * 18) + i,
    novos: 8 + (i % 5),
    investimento: 400 + (i % 7) * 30,
  })),
  funil: { acessos: null, viuItens: null, carrinho: null, checkout: null, pedidos: 2461 },
  heatmap: {
    faixas: ['11h–14h', '14h–18h', '18h–21h', '21h–00h'],
    matriz: [
      [12, 8, 9, 10, 11, 18, 21],
      [6, 4, 5, 5, 7, 9, 12],
      [34, 22, 25, 27, 31, 48, 52],
      [18, 9, 10, 12, 15, 29, 33],
    ],
    max: 52,
  },
  clientes: {
    ativos: 1420, emRisco: 380, inativos: 640, taxaRecorrencia: 0.42,
    recorrencia: [
      { nome: 'Comprou 1 vez', clientes: 1380, tom: 'muted' },
      { nome: '2 a 4 pedidos', clientes: 740, tom: 'blue' },
      { nome: '5 a 9 pedidos', clientes: 240, tom: 'orange' },
      { nome: '10+ pedidos', clientes: 80, tom: 'primary' },
    ],
  },
  canais: [],
  criativos: [],
  instagram: {
    seguidores: null, novosSeguidores: null, alcance: null,
    interacoes: null, salvamentos: null, visitasPerfil: null, engajamento: null,
  },
  saldos: [
    { canal: 'meta', saldo: 1240, diasRestantes: 9 },
    { canal: 'google', saldo: 380, diasRestantes: 3 },
  ],
};

function App() {
  const [modelo, setModelo] = useState(() => modeloPadrao('food'));
  const [editando, setEditando] = useState(false);
  return (
    <div className="min-h-screen bg-[#05090B] px-8 py-6">
      <Chapter
        icon={LayoutDashboard}
        titulo="Resumo"
        sub="16/07/2026 a 15/08/2026 · 31 dias"
        right={!editando ? (
          <button type="button" id="btn-editar" onClick={() => setEditando(true)}
            className="rounded-[var(--radius)] border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            Editar modelo
          </button>
        ) : undefined}
      />
      <ModeloEditor
        modelo={modelo}
        editando={editando}
        onSair={() => setEditando(false)}
        onSalvou={setModelo}
        render={(estilos) => ({
          'resultado.faturamento': (
            <div className="flex h-full flex-col justify-center rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-5">
              <p className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]"
                style={estiloDe(estilos, 'resultado.faturamento').corTexto ? { color: estiloDe(estilos, 'resultado.faturamento').corTexto! } : undefined}>
                {estiloDe(estilos, 'resultado.faturamento').texto ?? 'Faturamento'}
              </p>
              <p className="mt-3 font-heading text-3xl text-[#f4f7f8]">R$ 184.320</p>
            </div>
          ),
          'resultado.ticket': (
            <div className="flex h-full flex-col justify-center rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 p-5">
              <p className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">Ticket médio</p>
              <p className="mt-3 font-heading text-3xl text-[#f4f7f8]">R$ 74,90</p>
            </div>
          ),
          ...elementosDelivery(dados, estilos),
        })}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
