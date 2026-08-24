'use client';

import { ImageIcon } from 'lucide-react';
import { formatCurrencyBRL } from '@/lib/utils';

/** Contagem: nunca com casa decimal (mesma regra do premiumValue do dashboard). */
const inteiro = (n: number) => Math.round(n).toLocaleString('pt-BR');

/**
 * Faturamento por criativo, no período — o que o anúncio TROUXE, não o que gastou.
 *
 * ⚠️ Fonte diferente da faixa de "Melhores Criativos" logo abaixo: aquela vem
 * do Meta (gasto, impressões, cliques); esta vem do CRM, cruzando a venda com
 * o criativo que originou o lead. Só passou a existir quando a ponte
 * orçamento→lead e o vínculo do Agendor ficaram prontos (2026-08-24) — antes
 * a receita atribuída a criativo era R$ 0,00 no sistema inteiro.
 *
 * Cards maiores que os de baixo de propósito: aqui o número que importa é o
 * faturamento, e ele precisa ser lido de relance.
 */
export type CriativoReceita = {
  adKey: string;
  adId: string | null;
  adName: string;
  campaignName: string | null;
  clientName: string | null;
  leads: number;
  vendas: number;
  receita: number;
  thumbnail: string | null;
};

export function CreativeRevenueStrip({ criativos, loading }: {
  criativos: CriativoReceita[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-[224px] shrink-0 animate-pulse rounded-xl bg-white/[0.06]" style={{ height: 330 }} />
        ))}
      </div>
    );
  }
  if (!criativos.length) return null;
  const total = criativos.reduce((s, c) => s + c.receita, 0);
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin] [scrollbar-color:#2a2d3a_transparent]">
      {criativos.map((c, i) => {
        const fatia = total > 0 ? (c.receita / total) * 100 : 0;
        return (
          <div
            key={c.adKey}
            className="group w-[224px] shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d1519] text-left transition hover:border-[#6cff2f]/40"
          >
            <div className="relative overflow-hidden bg-[#071014]" style={{ aspectRatio: '4/5' }}>
              {c.thumbnail ? (
                <img
                  src={c.thumbnail}
                  alt={c.adName}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <ImageIcon className="h-7 w-7 text-[#9aa4aa]/40" />
                </div>
              )}
              <span className="absolute bottom-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/85 text-[11px] font-black text-white">{i + 1}</span>
            </div>
            <div className="p-2.5">
              {c.campaignName && (
                <p className="mb-1 truncate text-[9px] font-semibold uppercase tracking-[0.05em] text-[#6cff2f]/70" title={c.campaignName}>
                  {c.campaignName}
                </p>
              )}
              <p className="mb-2 truncate text-[11px] font-bold text-[#dce4e8]" title={c.adName}>{c.adName}</p>
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#9aa4aa]">Faturamento</p>
              <p className="mb-2 text-lg font-black leading-tight text-[#6cff2f]">
                {formatCurrencyBRL(c.receita)}
              </p>
              {/* Barra: quanto este criativo representa do faturamento atribuído. */}
              <div className="mb-2 h-1 w-full overflow-hidden rounded bg-white/[0.08]">
                <div className="h-full rounded bg-[#6cff2f]/70" style={{ width: `${Math.min(100, fatia)}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div className="rounded border border-white/[0.07] bg-white/[0.04] px-1.5 py-1">
                  <p className="text-[8px] font-bold uppercase tracking-wider text-[#9aa4aa]">Vendas</p>
                  <p className="text-[11px] font-black text-[#f4f7f8]">{inteiro(c.vendas)}</p>
                </div>
                <div className="rounded border border-white/[0.07] bg-white/[0.04] px-1.5 py-1">
                  <p className="text-[8px] font-bold uppercase tracking-wider text-[#9aa4aa]">Leads</p>
                  <p className="text-[11px] font-black text-[#f4f7f8]">{inteiro(c.leads)}</p>
                </div>
              </div>
              {c.clientName && (
                <p className="mt-1.5 truncate text-[9px] text-[#9aa4aa]" title={c.clientName}>{c.clientName}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

