'use client';

import { useState } from 'react';
import { formatCurrencyBRL } from '@/lib/utils';

/**
 * "Quem vendeu mais" e "Categorias mais vendidas" — espelham os dois painéis
 * do Agendor que o Matheus mandou.
 *
 * ⚠️ As três colunas de vendedor têm réguas de data DIFERENTES (ganho pela data
 * do ganho, perdido pela da perda, novo pela da criação) — a rota
 * /api/crm/desempenho explica por quê. Aqui só se exibe.
 */

export type LinhaVendedor = {
  responsavel: string;
  ganhos: number; ganhos_valor: number;
  perdidos: number; perdidos_valor: number;
  novos: number; novos_valor: number;
};

export type LinhaCategoria = { categoria: string; negocios: number; valor: number };

/** Iniciais para o avatar, no padrão do Agendor (até 3 letras). */
function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).slice(0, 3).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function Celula({ valor, quantidade, tom }: { valor: number; quantidade: number; tom: string }) {
  return (
    <td className="px-2 py-3 text-right">
      <p className={`text-sm font-black leading-tight ${tom}`}>{formatCurrencyBRL(valor)}</p>
      <p className="text-[11px] text-[#9aa4aa]">{quantidade.toLocaleString('pt-BR')}</p>
    </td>
  );
}

export function VendedoresCard({ linhas, loading }: { linhas: LinhaVendedor[]; loading: boolean }) {
  if (loading) {
    return <div className="h-56 animate-pulse rounded-xl bg-white/[0.06]" />;
  }
  if (!linhas.length) {
    return (
      <p className="py-8 text-center text-sm text-[#9aa4aa]">
        Nenhum negócio com responsável no período.
      </p>
    );
  }
  return (
    <div className="max-h-[340px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#2a2d3a_transparent]">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 bg-[#0d1519] px-2 py-2 text-left text-[10px] font-black uppercase tracking-wider text-[#dce4e8]">Usuários</th>
            <th className="sticky top-0 z-10 bg-[#0d1519] px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider text-[#6cff2f]">Ganhos</th>
            <th className="sticky top-0 z-10 bg-[#0d1519] px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider text-[#ff5a5a]">Perdidos</th>
            <th className="sticky top-0 z-10 bg-[#0d1519] px-2 py-2 text-right text-[10px] font-black uppercase tracking-wider text-[#dce4e8]">Novos</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.responsavel} className={i % 2 === 1 ? 'bg-white/[0.025]' : undefined}>
              <td className="px-2 py-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.09] text-[10px] font-black text-[#dce4e8]">
                    {iniciais(l.responsavel)}
                  </span>
                  <span className="truncate text-xs font-bold text-[#f4f7f8]" title={l.responsavel}>{l.responsavel}</span>
                </div>
              </td>
              <Celula valor={l.ganhos_valor} quantidade={l.ganhos} tom="text-[#6cff2f]" />
              <Celula valor={l.perdidos_valor} quantidade={l.perdidos} tom="text-[#ff5a5a]/80" />
              <Celula valor={l.novos_valor} quantidade={l.novos} tom="text-[#dce4e8]" />
            </tr>
          ))}
        </tbody>
      </table>
      {/* ⚠️ Sem esta linha, o valor de PERDIDOS e NOVOS é lido como dinheiro
          real. É a estimativa que o vendedor digitou no CRM — na Londrigifts
          isso dá R$ 1,02 mi em perdidos de um vendedor só. Ganhos, esses sim,
          são o faturamento gravado. */}
      <p className="mt-2 px-2 text-[10px] leading-snug text-[#9aa4aa]">
        Ganhos = faturamento registrado · Perdidos e novos = valor estimado no CRM
      </p>
    </div>
  );
}

export function CategoriasCard({ linhas, loading }: { linhas: LinhaCategoria[]; loading: boolean }) {
  // "Por negócios" (quantidade de itens) ou "Por valor" — o painel do Agendor
  // tem o mesmo seletor, e as duas leituras discordam com frequência: muita
  // caneta barata contra poucas mochilas caras.
  const [modo, setModo] = useState<'negocios' | 'valor'>('negocios');

  if (loading) return <div className="h-56 animate-pulse rounded-xl bg-white/[0.06]" />;
  if (!linhas.length) {
    return (
      <p className="py-8 text-center text-sm text-[#9aa4aa]">
        Nenhum produto lançado nos negócios ganhos do período.
      </p>
    );
  }

  const valorDe = (l: LinhaCategoria) => (modo === 'negocios' ? l.negocios : l.valor);
  const ordenadas = [...linhas].sort((a, b) => valorDe(b) - valorDe(a));
  const total = ordenadas.reduce((s, l) => s + valorDe(l), 0);
  // Cauda vira "Outros": 30 barras não são um gráfico, são uma lista.
  const TOPO = 9;
  const topo = ordenadas.slice(0, TOPO);
  const resto = ordenadas.slice(TOPO);
  const linhasFinais = resto.length > 0
    ? [...topo, { categoria: `Outros (${resto.length})`, negocios: resto.reduce((s, l) => s + l.negocios, 0), valor: resto.reduce((s, l) => s + l.valor, 0) }]
    : topo;

  return (
    <div>
      <div className="mb-3 flex justify-end gap-1">
        {([['negocios', 'Por itens'], ['valor', 'Por valor']] as const).map(([k, rot]) => (
          <button
            key={k}
            type="button"
            onClick={() => setModo(k)}
            className={`rounded px-2 py-1 text-[10px] font-black uppercase tracking-wider transition ${
              modo === k ? 'bg-[#6cff2f] text-black' : 'bg-white/[0.06] text-[#9aa4aa] hover:text-[#dce4e8]'
            }`}
          >
            {rot}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {linhasFinais.map(l => {
          const v = valorDe(l);
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <div key={l.categoria} className="flex items-center gap-2">
              <span className="w-[38%] shrink-0 truncate text-right text-[11px] text-[#dce4e8]" title={l.categoria}>
                {l.categoria}
              </span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-white/[0.06]">
                <div className="h-full rounded bg-[#6cff2f]/75" style={{ width: `${Math.max(1, pct)}%` }} />
              </div>
              <span className="w-[70px] shrink-0 text-[11px] font-black text-[#f4f7f8]">
                {pct.toFixed(1).replace('.', ',')}%
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] text-[#9aa4aa]">
        Participação {modo === 'negocios' ? 'por itens vendidos' : 'por valor'} · só negócios ganhos no período
      </p>
    </div>
  );
}
