"use client";

// Inspetor de elementos — a terceira e última peça do editor.
//
// O catálogo (dashboard-elementos.ts) já diz QUAIS elementos existem e o que
// cada um suporta; aqui só se desenha o controle correspondente. Elemento que
// não suporta "cor de valor" não mostra o campo — em vez de mostrar um controle
// que não faz nada.
//
// ⚠️ Liberdade total (decisão do Matheus): cor em hex livre e tamanho em px
// livre. Os limites de `LIMITE` são só sanidade — evitam fonte de 900px, não
// impõem a paleta do design system.

import { useMemo, useState } from 'react';
import {
  Wallet, ShoppingBag, Receipt, Users, UserPlus, Repeat, Clock, Target,
  BarChart3, TrendingUp, DollarSign, Tag, Heart, Star, Flame, Zap, Award,
  Package, Truck, Store, Eye, MousePointerClick, CreditCard, Percent,
  RotateCcw, Eye as EyeOn, EyeOff, ChevronUp, ChevronDown, X,
  type LucideIcon,
} from 'lucide-react';
import {
  LIMITE, definicaoElemento, elementosDoBloco, estiloDe,
  type ElementoId, type EstiloElemento, type EstilosPorElemento,
} from '@/lib/dashboard-elementos';
import { definicaoBloco, type BlocoId } from '@/lib/dashboard-modelo';
import { cn } from '@/lib/utils';

/**
 * Ícones oferecidos. Curado de propósito: o lucide tem mais de mil, e uma lista
 * completa viraria um seletor inútil de rolar.
 */
export const ICONES: Record<string, LucideIcon> = {
  Wallet, ShoppingBag, Receipt, Users, UserPlus, Repeat, Clock, Target,
  BarChart3, TrendingUp, DollarSign, Tag, Heart, Star, Flame, Zap, Award,
  Package, Truck, Store, Eye, MousePointerClick, CreditCard, Percent,
};

/** Resolve o nome salvo em componente. Nome desconhecido cai no de fábrica. */
export function iconePorNome(nome: string | null | undefined, fallback: LucideIcon): LucideIcon {
  return (nome && ICONES[nome]) || fallback;
}

type Props = {
  bloco: BlocoId;
  estilos: EstilosPorElemento;
  onChange: (id: ElementoId, patch: Partial<EstiloElemento>) => void;
  onFechar: () => void;
};

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[11px] text-[#9aa4aa]">{label}</span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </label>
  );
}

/** Cor com botão de limpar — limpar devolve o elemento ao padrão do componente. */
function Cor({ valor, onChange }: { valor: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <>
      <input
        type="color"
        value={valor ?? '#6cff2f'}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-9 cursor-pointer rounded border border-white/[0.12] bg-transparent p-0"
      />
      <button
        type="button"
        onClick={() => onChange(null)}
        title="Voltar ao padrão"
        className={cn('rounded p-0.5 text-[#9aa4aa] hover:text-white', !valor && 'opacity-30')}
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </>
  );
}

function Tamanho({ valor, faixa, onChange }: {
  valor: number | null | undefined; faixa: readonly [number, number]; onChange: (v: number | null) => void;
}) {
  return (
    <>
      <input
        type="number"
        min={faixa[0]}
        max={faixa[1]}
        value={valor ?? ''}
        placeholder="auto"
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="h-6 w-16 rounded border border-white/[0.12] bg-[#071014] px-1.5 text-[11px] text-white outline-none focus:border-primary"
      />
      <span className="text-[10px] text-[#6b7478]">px</span>
    </>
  );
}

export function Inspector({ bloco, estilos, onChange, onFechar }: Props) {
  const elementos = useMemo(() => elementosDoBloco(bloco), [bloco]);
  const [aberto, setAberto] = useState<ElementoId | null>(elementos[0]?.id ?? null);
  const nomeBloco = definicaoBloco(bloco)?.rotulo ?? bloco;

  return (
    <div className="fixed right-4 top-24 z-[60] max-h-[75vh] w-[320px] overflow-auto rounded-[14px] border border-white/[0.12] bg-[#0d1519] shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
      <div className="sticky top-0 flex items-center gap-2 border-b border-white/[0.08] bg-[#0d1519] px-3 py-2.5">
        <span className="text-[11px] font-black uppercase tracking-[0.07em] text-white">{nomeBloco}</span>
        <span className="text-[10px] text-[#6b7478]">{elementos.length} elementos</span>
        <button type="button" onClick={onFechar} className="ml-auto rounded p-1 text-[#9aa4aa] hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {elementos.map((def) => {
          const e = estiloDe(estilos, def.id);
          const expandido = aberto === def.id;
          const sup = (k: string) => def.suporta.includes(k as never);
          const set = (patch: Partial<EstiloElemento>) => onChange(def.id, patch);

          return (
            <div key={def.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAberto(expandido ? null : def.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {expandido ? <ChevronUp className="h-3 w-3 shrink-0 text-[#9aa4aa]" /> : <ChevronDown className="h-3 w-3 shrink-0 text-[#9aa4aa]" />}
                  <span className="truncate text-[12px] font-semibold text-white">
                    {e.texto || def.rotulo}
                  </span>
                </button>
                {sup('visivel') && (
                  <button
                    type="button"
                    onClick={() => set({ visivel: e.visivel === false })}
                    title={e.visivel === false ? 'Mostrar' : 'Ocultar'}
                    className="rounded p-1 text-[#9aa4aa] hover:text-white"
                  >
                    {e.visivel === false ? <EyeOff className="h-3.5 w-3.5" /> : <EyeOn className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {expandido && (
                <div className="mt-1 pl-4">
                  {sup('texto') && (
                    <Campo label="Texto">
                      <input
                        value={e.texto ?? ''}
                        placeholder={def.rotulo}
                        maxLength={80}
                        onChange={(ev) => set({ texto: ev.target.value || null })}
                        className="h-6 w-40 rounded border border-white/[0.12] bg-[#071014] px-1.5 text-[11px] text-white outline-none focus:border-primary"
                      />
                    </Campo>
                  )}
                  {sup('icone') && (
                    <Campo label="Ícone">
                      <select
                        value={e.icone ?? ''}
                        onChange={(ev) => set({ icone: ev.target.value || null })}
                        className="h-6 w-28 rounded border border-white/[0.12] bg-[#071014] px-1 text-[11px] text-white outline-none focus:border-primary"
                      >
                        <option value="">padrão</option>
                        {Object.keys(ICONES).map((nome) => <option key={nome} value={nome}>{nome}</option>)}
                      </select>
                    </Campo>
                  )}
                  {sup('tamanhoTexto') && (
                    <Campo label="Tamanho do texto">
                      <Tamanho valor={e.tamanhoTexto} faixa={LIMITE.texto} onChange={(v) => set({ tamanhoTexto: v })} />
                    </Campo>
                  )}
                  {sup('tamanhoValor') && (
                    <Campo label="Tamanho do valor">
                      <Tamanho valor={e.tamanhoValor} faixa={LIMITE.valor} onChange={(v) => set({ tamanhoValor: v })} />
                    </Campo>
                  )}
                  {sup('tamanhoIcone') && (
                    <Campo label="Tamanho do ícone">
                      <Tamanho valor={e.tamanhoIcone} faixa={LIMITE.icone} onChange={(v) => set({ tamanhoIcone: v })} />
                    </Campo>
                  )}
                  {sup('corTexto') && (
                    <Campo label="Cor do texto"><Cor valor={e.corTexto} onChange={(v) => set({ corTexto: v })} /></Campo>
                  )}
                  {sup('corValor') && (
                    <Campo label="Cor do valor"><Cor valor={e.corValor} onChange={(v) => set({ corValor: v })} /></Campo>
                  )}
                  {sup('corIcone') && (
                    <Campo label="Cor do ícone"><Cor valor={e.corIcone} onChange={(v) => set({ corIcone: v })} /></Campo>
                  )}
                  {sup('corFundo') && (
                    <Campo label="Cor do fundo"><Cor valor={e.corFundo} onChange={(v) => set({ corFundo: v })} /></Campo>
                  )}
                  {sup('ordem') && (
                    <Campo label="Ordem">
                      <input
                        type="number"
                        value={e.ordem ?? ''}
                        placeholder="auto"
                        onChange={(ev) => set({ ordem: ev.target.value === '' ? null : Number(ev.target.value) })}
                        className="h-6 w-16 rounded border border-white/[0.12] bg-[#071014] px-1.5 text-[11px] text-white outline-none focus:border-primary"
                      />
                    </Campo>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="border-t border-white/[0.08] px-3 py-2 text-[10px] leading-snug text-[#6b7478]">
        Campo em branco herda o padrão. As mudanças valem para todos os clientes
        deste segmento e só são gravadas ao salvar o modelo.
      </p>
    </div>
  );
}
