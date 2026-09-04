"use client";

// Bloco "Landing page" do dashboard: o que o GA4 das LPs conta (ver
// src/lib/ga4-landing.ts). Só apresentação — dados chegam prontos da rota
// /api/clients/[id]/ga4, já consolidados quando o cliente tem mais de uma LP.

import type { Ga4Consolidado, Ga4Totais } from '@/lib/ga4-landing';

const fmtN = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR');
const fmtPct = (n: number) => `${((Number.isFinite(n) ? n : 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

function Delta({ atual, anterior, inverter = false }: { atual: number; anterior: number; inverter?: boolean }) {
  if (!anterior || !Number.isFinite(atual) || !Number.isFinite(anterior)) return <span className="text-[10px] text-[#7c868c]">—</span>;
  const d = (atual - anterior) / anterior;
  const bom = inverter ? d < 0 : d > 0;
  const cor = d === 0 ? 'text-[#a7b0b6]' : bom ? 'text-[#85e45f]' : 'text-amber-300';
  return <span className={`text-[10px] font-bold ${cor}`}>{d > 0 ? '+' : ''}{(d * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>;
}

function Kpi({ rotulo, valor, atual, anterior, sub }: { rotulo: string; valor: string; atual: number; anterior: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 min-w-0">
      <p className="text-[10px] font-black uppercase tracking-[0.07em] text-[#9aa4aa] truncate">{rotulo}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-black text-[#f4f7f8] tabular-nums">{valor}</span>
        <Delta atual={atual} anterior={anterior} />
      </div>
      {sub && <p className="text-[10px] text-[#7c868c] mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

function Barras({ titulo, linhas, total }: { titulo: string; linhas: Array<{ valor: string; n: number }>; total: number }) {
  const max = Math.max(1, ...linhas.map(l => l.n));
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">{titulo}</div>
      {linhas.length === 0 ? (
        <p className="text-xs text-[#7c868c]">Sem dado no período.</p>
      ) : (
        <ul className="space-y-1.5">
          {linhas.map(l => (
            <li key={l.valor} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[#dce4e8]">{l.valor}</span>
                <span className="shrink-0 tabular-nums text-[#9aa4aa]">{fmtN(l.n)}{total > 0 && <span className="ml-1 text-[#6c767c]">({fmtPct(l.n / total)})</span>}</span>
              </div>
              <div className="mt-1 h-1 rounded-full bg-white/[0.06]"><div className="h-1 rounded-full bg-[#F9AB00]" style={{ width: `${(l.n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function resumoTotais(t: Ga4Totais) {
  return `${fmtN(t.sessoes)} sessões · ${fmtN(t.contatos)} contatos · ${fmtPct(t.taxaContato)}`;
}

export function Ga4LandingPanel({ dados, loading, aviso }: { dados: Ga4Consolidado | null; loading: boolean; aviso?: string }) {
  if (loading) return <p className="px-4 pb-4 text-xs text-[#9aa4aa]">Carregando Google Analytics…</p>;
  if (!dados) return <p className="px-4 pb-4 text-xs text-[#9aa4aa]">{aviso ?? 'Sem propriedade GA4 vinculada a este cliente.'}</p>;
  const { atual: a, anterior: b } = dados;
  const totalContatos = a.contatos || 1;

  return (
    <div className="px-4 pb-4 space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Sessões" valor={fmtN(a.sessoes)} atual={a.sessoes} anterior={b.sessoes} sub={`${fmtN(a.usuarios)} usuários`} />
        <Kpi rotulo="Contatos" valor={fmtN(a.contatos)} atual={a.contatos} anterior={b.contatos} sub="WhatsApp + telefone + formulário" />
        <Kpi rotulo="Taxa de contato" valor={fmtPct(a.taxaContato)} atual={a.taxaContato} anterior={b.taxaContato} sub="contatos por sessão" />
        <Kpi rotulo="WhatsApp" valor={fmtN(a.whatsapp)} atual={a.whatsapp} anterior={b.whatsapp} />
        <Kpi rotulo="Telefone" valor={fmtN(a.telefone)} atual={a.telefone} anterior={b.telefone} />
        <Kpi rotulo={a.leadForm > 0 ? 'Formulários' : 'Cliques em botões'} valor={fmtN(a.leadForm > 0 ? a.leadForm : a.cta)} atual={a.leadForm > 0 ? a.leadForm : a.cta} anterior={a.leadForm > 0 ? b.leadForm : b.cta} />
      </div>

      {dados.propriedades.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {dados.propriedades.map(p => (
            <span key={p.propertyId} className="rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[10px] text-[#a7b0b6]">
              <span className="font-bold text-[#dce4e8]">{p.nome}</span> · {resumoTotais(p.atual)}
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <div className="min-w-0">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.07em] text-[#dce4e8]">De onde vieram</div>
          {dados.origens.length === 0 ? <p className="text-xs text-[#7c868c]">Sem dado no período.</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-[10px] uppercase tracking-wider text-[#7c868c]"><th className="text-left font-bold pb-1">Origem</th><th className="text-right font-bold pb-1">Sessões</th><th className="text-right font-bold pb-1">Contatos</th></tr></thead>
              <tbody>
                {dados.origens.map(o => (
                  <tr key={`${o.origem}|${o.midia}`} className="border-t border-white/[0.06]">
                    <td className="py-1.5 pr-2 truncate max-w-[180px] text-[#dce4e8]">{o.origem} <span className="text-[#6c767c]">/ {o.midia}</span></td>
                    <td className="py-1.5 text-right tabular-nums text-[#9aa4aa]">{fmtN(o.sessoes)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[#dce4e8] font-bold">{fmtN(o.contatos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Barras titulo="Onde clicam para falar" linhas={dados.posicoes} total={totalContatos} />
        {dados.detalhes.map(d => (
          <Barras key={d.param} titulo={d.rotulo} linhas={d.linhas} total={d.param === 'cta_id' ? a.cta : a.whatsapp} />
        ))}
      </div>
    </div>
  );
}
