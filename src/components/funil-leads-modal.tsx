"use client";

// Modal de leads de uma etapa do Funil de Performance.
//
// Abre ao clicar num degrau do card. Por padrão lista o conjunto CUMULATIVO —
// o mesmo que o card conta ("Agendamentos: 19" abre com 19 linhas). O toggle
// "só quem está parado aqui" reduz para quem não avançou, que é a lista de
// trabalho. Manter o padrão cumulativo é deliberado: um modal que abrisse com
// menos linhas que o número clicado pareceria bug toda vez.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { ROTULOS_ETAPA, type EtapaFunil } from '@/lib/funil-etapas';
import { FunilLeadDetalhe } from './funil-lead-detalhe';
import { cn } from '@/lib/utils';

export type FunilLeadRow = {
  id: string;
  clientId: string;
  clientName: string | null;
  nome: string | null;
  numero: string | null;
  status: string | null;
  etapaAtual: string;
  perdido: boolean;
  valor: number;
  data: string | null;
  /** Canal de origem já rotulado. `null` = o CRM não registrou de onde veio. */
  canal: string | null;
  /** Data da consulta marcada ('YYYY-MM-DD'), quando existe. */
  dataAgendada: string | null;
};

type Props = {
  etapa: EtapaFunil;
  /** Rótulo do degrau como aparece no card (vem do planejamento do cliente). */
  tituloEtapa: string;
  /** Número exibido no card — o modo cumulativo tem de bater com ele. */
  totalNoCard: number;
  clientIds: string[];
  from: string;
  to: string;
  /** Quando o topo não vem do CRM não há lead para listar (é número de anúncio). */
  topoDeAnuncios?: boolean;
  onClose: () => void;
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

/** Chave interna do filtro para quem não tem canal — nunca string vazia. */
const SEM_CANAL = 'Sem canal';

/** 'YYYY-MM-DD' → 'dd/mm/aaaa'. Sem isso a data saía como texto cru de `Date`. */
function fmtData(iso: string | null): string | null {
  if (!iso) return null;
  const [a, m, d] = iso.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : null;
}

export function FunilLeadsModal({
  etapa, tituloEtapa, totalNoCard, clientIds, from, to, topoDeAnuncios, onClose,
}: Props) {
  const [modo, setModo] = useState<'alcancou' | 'atual'>('alcancou');
  const [rows, setRows] = useState<FunilLeadRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [canalFiltro, setCanalFiltro] = useState('');
  /** Lead cujo detalhe está aberto por cima da lista. */
  const [detalhe, setDetalhe] = useState<FunilLeadRow | null>(null);

  const semLista = etapa === 'contato' && topoDeAnuncios;
  // ⚠️ Dependa do VALOR, não da referência: o pai passa `[...selectedIds]`, um
  // array novo a cada render — usar o array direto no useEffect refaz o fetch
  // em toda re-renderização do dashboard (visto no harness: 3 chamadas iguais
  // em sequência).
  const clientKey = clientIds.join(',');

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  useEffect(() => {
    if (semLista) { setRows([]); return; }
    let alive = true;
    setRows(null);
    setErro(false);
    const params = new URLSearchParams({ etapa, modo, from, to, limit: '500' });
    if (clientKey) params.set('clientIds', clientKey);
    fetch(`/api/crm/funil-leads?${params}`)
      .then(r => r.json())
      .then((j: { leads?: FunilLeadRow[]; total?: number; error?: string }) => {
        if (!alive) return;
        if (j?.error) setErro(true);
        setRows(j?.leads ?? []);
        setTotal(j?.total ?? 0);
      })
      .catch(() => { if (alive) { setRows([]); setErro(true); } });
    return () => { alive = false; };
  }, [etapa, modo, from, to, clientKey, semLista]);

  /** Canais presentes na lista, para o filtro só oferecer o que existe. */
  const canais = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const k = r.canal ?? SEM_CANAL;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let out = rows ?? [];
    // ⚠️ Só aplica o filtro se o canal ainda EXISTE no recorte atual. Trocar de
    // etapa com um canal selecionado deixava a lista vazia sem explicação —
    // resolver derivando evita o efeito que só existia para "resetar".
    if (canalFiltro && canais.some(([c]) => c === canalFiltro)) {
      out = out.filter(r => (r.canal ?? SEM_CANAL) === canalFiltro);
    }
    if (q) {
      out = out.filter(r =>
        `${r.nome ?? ''} ${r.numero ?? ''} ${r.status ?? ''} ${r.clientName ?? ''} ${r.canal ?? ''}`
          .toLowerCase().includes(q),
      );
    }
    return out;
  }, [rows, busca, canalFiltro, canais]);

  const multiCliente = useMemo(() => new Set((rows ?? []).map(r => r.clientId)).size > 1, [rows]);
  const stop = useCallback((e: React.MouseEvent) => e.stopPropagation(), []);

  // Divergência entre o modal cumulativo e o card é sinal de que as duas
  // lógicas saíram de sincronia — melhor dizer do que deixar o usuário achar.
  const divergente = modo === 'alcancou' && rows !== null && !semLista && total !== totalNoCard;

  return (
    <>
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={stop}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-white/[0.10] bg-[#0b1216] shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-black uppercase tracking-[0.07em] text-[#f4f7f8]">{tituloEtapa}</h3>
            <p className="mt-0.5 text-[11px] text-[#9aa4aa]">
              {semLista
                ? 'Topo estimado por anúncios'
                : rows === null
                  ? 'Carregando…'
                  : `${total.toLocaleString('pt-BR')} lead${total === 1 ? '' : 's'}${
                      modo === 'alcancou' ? ' que chegaram nesta etapa' : ' parados nesta etapa'
                    }`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-[#9aa4aa] hover:bg-white/[0.06] hover:text-white"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!semLista && (
          <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-5 py-3">
            <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#071014] p-0.5">
              {([
                { k: 'alcancou' as const, l: 'Chegaram aqui' },
                { k: 'atual' as const, l: 'Parados aqui' },
              ]).map(o => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setModo(o.k)}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors',
                    modo === o.k ? 'bg-[#6cff2f] text-black' : 'text-[#a7b0b6] hover:text-white',
                  )}
                >
                  {o.l}
                </button>
              ))}
            </div>
            {canais.length > 1 && (
              <select
                value={canais.some(([c]) => c === canalFiltro) ? canalFiltro : ''}
                onChange={e => setCanalFiltro(e.target.value)}
                className="h-8 shrink-0 rounded-lg border border-white/[0.08] bg-[#071014] px-2 text-[11px] font-semibold text-[#f4f7f8] outline-none [color-scheme:dark] focus:border-[#6cff2f]"
              >
                <option value="">Todos os canais</option>
                {canais.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}
              </select>
            )}
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar nome, telefone, canal…"
              className="h-8 min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#071014] px-3 text-xs text-[#f4f7f8] outline-none placeholder:text-[#9aa4aa] focus:border-[#6cff2f]"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {semLista ? (
            <p className="py-8 text-center text-sm text-[#9aa4aa]">
              O topo deste funil está sendo estimado pelos números de anúncio, não pelo CRM —
              não existe uma lista de leads por trás desse número.
              <br />
              <span className="text-[11px]">
                Para listar contatos aqui, o cliente precisa ter leads no CRM (ou o topo configurado como CRM).
              </span>
            </p>
          ) : rows === null ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-[#9aa4aa]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando leads…
            </p>
          ) : erro ? (
            <p className="py-8 text-center text-sm text-[#9aa4aa]">Não foi possível carregar os leads agora.</p>
          ) : filtradas.length === 0 ? (
            <p className="py-8 text-center text-sm text-[#9aa4aa]">
              {busca ? 'Nenhum lead corresponde à busca.' : 'Nenhum lead nesta etapa no período.'}
            </p>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {filtradas.map(l => (
                <div
                  key={l.id}
                  className="group grid grid-cols-[1fr_auto] items-center gap-3 py-2.5 sm:grid-cols-[1fr_140px_150px]"
                >
                  {/* Nome abre o detalhe; o telefone e o cliente ficam embaixo. */}
                  <button
                    type="button"
                    onClick={() => setDetalhe(l)}
                    className="min-w-0 text-left"
                  >
                    <p className="truncate text-[13px] font-semibold text-[#f4f7f8] underline decoration-white/15 decoration-dotted underline-offset-4 group-hover:decoration-[#6cff2f]">
                      {l.nome?.trim() || l.numero || 'Lead sem nome'}
                    </p>
                    <p className="truncate text-[11px] text-[#9aa4aa]">
                      {[multiCliente ? l.clientName : null, l.numero, fmtData(l.data)]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </button>

                  {/* Canal — `null` é lacuna de cadastro, não um canal chamado "—". */}
                  <span className={cn(
                    'hidden truncate rounded px-1.5 py-0.5 text-center text-[10px] font-bold sm:block',
                    l.canal ? 'bg-white/[0.07] text-[#dce4e8]' : 'bg-white/[0.03] text-[#6b7478]',
                  )} title={l.canal ?? 'Canal não registrado no CRM'}>
                    {l.canal ?? 'sem canal'}
                  </span>

                  <div className="flex shrink-0 items-center justify-end gap-2">
                    {l.valor > 0 && (
                      <span className="text-[11px] font-bold text-[#6cff2f]">{fmtBRL(l.valor)}</span>
                    )}
                    {/* Etapa SEMÂNTICA do funil; o status cru do CRM fica no title. */}
                    <span
                      title={l.status ?? undefined}
                      className={cn(
                        'truncate rounded px-1.5 py-0.5 text-[10px] font-bold',
                        l.perdido ? 'bg-red-500/15 text-red-300' : 'bg-[#6cff2f]/12 text-[#6cff2f]',
                      )}
                    >
                      {l.etapaAtual}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!semLista && rows !== null && (
          <div className="border-t border-white/[0.08] px-5 py-2.5 text-[10px] text-[#9aa4aa]">
            {total > filtradas.length && !busca
              ? `Mostrando ${filtradas.length.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}.`
              : `${filtradas.length.toLocaleString('pt-BR')} na lista.`}
            {modo === 'alcancou' && (
              <> Inclui quem já avançou para etapas seguintes — é assim que o card conta.</>
            )}
            {divergente && (
              <span className="ml-1 text-amber-300">
                O card mostra {totalNoCard.toLocaleString('pt-BR')}; confira o período.
              </span>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ⚠️ Irmão do overlay, não filho: dentro dele, clicar no backdrop do
        detalhe borbulharia para o `onClose` da lista e fecharia os dois. */}
    {detalhe && (
      <FunilLeadDetalhe
        leadId={detalhe.id}
        clientId={detalhe.clientId}
        canal={detalhe.canal}
        onClose={() => setDetalhe(null)}
      />
    )}
    </>
  );
}

export const ROTULO_ETAPA_FUNIL = ROTULOS_ETAPA;
