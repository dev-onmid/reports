"use client";

// Controles de edição ANCORADOS ao próprio elemento.
//
// ⚠️ Isto substitui o inspetor lateral. Pedido do Matheus: "quero passar o mouse
// em cima do título e decidir ali o que quero fazer com ele, apenas com ele".
// Um painel na lateral obrigava a achar o elemento numa lista e a mapear
// mentalmente lista → tela; aqui o controle nasce em cima do que se está
// editando, então não existe esse passo.
//
// O catálogo (dashboard-elementos.ts) diz o que cada elemento aceita; campo que
// o elemento não suporta simplesmente não é desenhado — melhor do que mostrar um
// controle que não faz nada.
//
// ⚠️ Liberdade total (decisão do Matheus): cor em hex livre e tamanho em px
// livre. Os limites de `LIMITE` são só sanidade — evitam fonte de 900px, não
// impõem a paleta do design system.

import {
  Wallet, ShoppingBag, Receipt, Users, UserPlus, Repeat, Clock, Target,
  BarChart3, TrendingUp, DollarSign, Tag, Heart, Star, Flame, Zap, Award,
  Package, Truck, Store, Eye, MousePointerClick, CreditCard, Percent,
  RotateCcw, X,
  type LucideIcon,
} from 'lucide-react';
import {
  LIMITE, definicaoElemento,
  type ElementoId, type EstiloElemento, type PropriedadeEditavel,
} from '@/lib/dashboard-elementos';
import { caminhoDoElemento } from '@/lib/dashboard-modelo';
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
  id: ElementoId;
  estilo: EstiloElemento;
  onChange: (patch: Partial<EstiloElemento>) => void;
  /** Zera TODO o estilo do elemento — volta ao padrão do design system. */
  onLimpar: () => void;
  onFechar: () => void;
  /** Abre para a esquerda quando o elemento está encostado na borda direita. */
  alinhar?: 'esquerda' | 'direita';
};

function Linha({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[#9aa4aa]">{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

/** Cor com botão de limpar — limpar devolve o elemento ao padrão do componente. */
function Cor({ valor, onChange }: { valor: string | null | undefined; onChange: (v: string | null) => void }) {
  return (
    <>
      <input
        type="color"
        value={valor ?? '#6cff2f'}
        onChange={(ev) => onChange(ev.target.value)}
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
        onChange={(ev) => onChange(ev.target.value === '' ? null : Number(ev.target.value))}
        className="h-6 w-14 rounded border border-white/[0.12] bg-[#071014] px-1.5 text-[11px] text-white outline-none focus:border-primary"
      />
      <span className="text-[10px] text-[#6b7478]">px</span>
    </>
  );
}

export function ControlesElemento({ id, estilo, onChange, onLimpar, onFechar, alinhar = 'esquerda' }: Props) {
  const def = definicaoElemento(id);
  if (!def) return null;
  const sup = (k: PropriedadeEditavel) => def.suporta.includes(k);

  return (
    <div
      // Para no clique: o wrapper do item da grade também escuta, e sem isto
      // arrastar dentro do painel moveria o elemento inteiro.
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => ev.stopPropagation()}
      className={cn(
        'absolute top-7 z-[70] w-[248px] rounded-[12px] border border-white/[0.14] bg-[#0d1519] p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.6)]',
        alinhar === 'direita' ? 'right-0' : 'left-0',
      )}
    >
      <div className="mb-1.5 flex items-center gap-2 border-b border-white/[0.08] pb-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-black uppercase tracking-[0.06em] text-white">
          {caminhoDoElemento(id)}
        </span>
        <button type="button" onClick={onLimpar} title="Voltar tudo ao padrão"
          className="rounded p-0.5 text-[#9aa4aa] hover:text-white">
          <RotateCcw className="h-3 w-3" />
        </button>
        <button type="button" onClick={onFechar} title="Fechar"
          className="rounded p-0.5 text-[#9aa4aa] hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {sup('texto') && (
        <input
          value={estilo.texto ?? ''}
          placeholder={def.rotulo}
          maxLength={80}
          autoFocus
          onChange={(ev) => onChange({ texto: ev.target.value || null })}
          className="mb-1 h-7 w-full rounded border border-white/[0.12] bg-[#071014] px-2 text-[12px] text-white outline-none focus:border-primary"
        />
      )}

      {sup('icone') && (
        <Linha label="Ícone">
          <select
            value={estilo.icone ?? ''}
            onChange={(ev) => onChange({ icone: ev.target.value || null })}
            className="h-6 w-[124px] rounded border border-white/[0.12] bg-[#071014] px-1 text-[11px] text-white outline-none focus:border-primary"
          >
            <option value="">padrão</option>
            {Object.keys(ICONES).map((nome) => <option key={nome} value={nome}>{nome}</option>)}
          </select>
        </Linha>
      )}

      {sup('tamanhoTexto') && (
        <Linha label="Fonte do rótulo">
          <Tamanho valor={estilo.tamanhoTexto} faixa={LIMITE.texto} onChange={(v) => onChange({ tamanhoTexto: v })} />
        </Linha>
      )}
      {sup('tamanhoValor') && (
        <Linha label="Fonte do valor">
          <Tamanho valor={estilo.tamanhoValor} faixa={LIMITE.valor} onChange={(v) => onChange({ tamanhoValor: v })} />
        </Linha>
      )}
      {sup('tamanhoIcone') && (
        <Linha label="Tamanho do ícone">
          <Tamanho valor={estilo.tamanhoIcone} faixa={LIMITE.icone} onChange={(v) => onChange({ tamanhoIcone: v })} />
        </Linha>
      )}

      {sup('corTexto') && <Linha label="Cor do rótulo"><Cor valor={estilo.corTexto} onChange={(v) => onChange({ corTexto: v })} /></Linha>}
      {sup('corValor') && <Linha label="Cor do valor"><Cor valor={estilo.corValor} onChange={(v) => onChange({ corValor: v })} /></Linha>}
      {sup('corIcone') && <Linha label="Cor do ícone"><Cor valor={estilo.corIcone} onChange={(v) => onChange({ corIcone: v })} /></Linha>}
      {sup('corFundo') && <Linha label="Cor do fundo"><Cor valor={estilo.corFundo} onChange={(v) => onChange({ corFundo: v })} /></Linha>}

      <p className="mt-1.5 border-t border-white/[0.08] pt-1.5 text-[10px] leading-snug text-[#6b7478]">
        Campo em branco herda o padrão. Vale para todos os clientes deste
        segmento e só é gravado ao salvar o modelo.
      </p>
    </div>
  );
}
