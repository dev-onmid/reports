'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { T } from '@/lib/dashboard-tipografia';

/**
 * Superfície ÚNICA do dashboard de geração de leads.
 *
 * ⚠️ Regra da página: todo bloco é UM destes cards, posto direto no fluxo
 * (grid) da página. Nada de card dentro de card nem moldura colorida com
 * brilho por plataforma — era isso que fazia Mídia paga, Landing page e
 * Instagram parecerem "outra página dentro da página". Sub-áreas internas usam
 * no máximo um divisor ou linhas `bg-white/[0.02]`, nunca outra borda.
 * (Exceção pedida pelo Matheus: o brilho verde dos cards de meta.)
 */
export const SUPERFICIE = 'min-w-0 rounded-[14px] border border-white/[0.08] bg-[#0d1519]/92 shadow-[0_18px_60px_rgba(0,0,0,0.28)]';

export function Superficie({
  titulo, sub, icone, direita, children, className, style, semPadding = false, as: Tag = 'section', title,
  vazio = false, avisoVazio,
}: {
  titulo?: ReactNode;
  /** Descrição curta ao lado/abaixo do título. */
  sub?: ReactNode;
  /** Logo/ícone antes do título (Meta, Google, Instagram…). */
  icone?: ReactNode;
  /** Controle à direita da linha de título (filtro, total, botão). */
  direita?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Tira o p-5 (faixas que desenham as próprias células). */
  semPadding?: boolean;
  as?: 'section' | 'div';
  title?: string;
  /**
   * Canal SEM dado no período: o card sai MINIMIZADO — só um aviso em
   * destaque no topo e o nome do canal embaixo, sem o corpo vazio (pedido do
   * Matheus: um painel grande dizendo "nenhuma campanha" ocupava uma seção
   * inteira pra não mostrar nada). Nunca passar `vazio` enquanto carrega.
   */
  vazio?: boolean;
  avisoVazio?: ReactNode;
}) {
  if (vazio) {
    return (
      <Tag className={cn(SUPERFICIE, 'p-3', className)} style={style} title={title}>
        <div className="flex items-center gap-2.5 rounded-lg border border-amber-400/35 bg-amber-400/[0.09] px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <p className="text-sm font-bold leading-snug text-amber-200">{avisoVazio ?? 'Sem dados no período.'}</p>
        </div>
        {titulo && (
          <div className="mt-2 flex items-center gap-2 px-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#6c767c]">
            <span className="opacity-60">{icone}</span>
            <span className="min-w-0 truncate">{titulo}</span>
          </div>
        )}
      </Tag>
    );
  }
  return (
    <Tag className={cn(SUPERFICIE, !semPadding && 'p-5', className)} style={style} title={title}>
      {(titulo || direita) && (
        <CabecalhoCard titulo={titulo} sub={sub} icone={icone} direita={direita} className={semPadding ? 'px-5 pt-5' : undefined} />
      )}
      {children}
    </Tag>
  );
}

/** Linha de título de card: título (T.cardTitulo) + sub (T.cardSub) + slot à direita. */
export function CabecalhoCard({ titulo, sub, icone, direita, className }: {
  titulo?: ReactNode; sub?: ReactNode; icone?: ReactNode; direita?: ReactNode; className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icone && <span className="flex shrink-0 items-center">{icone}</span>}
        <div className="min-w-0">
          {titulo && <h3 className={T.cardTitulo}>{titulo}</h3>}
          {sub && <p className={cn('mt-1 leading-snug', T.cardSub)}>{sub}</p>}
        </div>
      </div>
      {direita && <div className="flex shrink-0 items-center gap-2">{direita}</div>}
    </div>
  );
}

/**
 * Cabeçalho leve de grupo DENTRO de uma seção da página ("Do clique ao
 * contato", "Audiência"). Não é card nem seção: só um rótulo com fio, para
 * agrupar cards vizinhos sem criar outra moldura.
 */
export function GrupoTitulo({ titulo, sub, icone }: { titulo: string; sub?: ReactNode; icone?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
      {icone && <span className="flex shrink-0 items-center">{icone}</span>}
      <h4 className={T.grupo}>{titulo}</h4>
      {sub && <span className={T.cardSub}>{sub}</span>}
      <span className="h-px min-w-[40px] flex-1 bg-white/[0.08]" />
    </div>
  );
}

/**
 * Lista longa com corte em N itens + "Ver mais (N)". Devolve os itens
 * visíveis e o botão (null quando cabe tudo).
 */
export function useVerMais<I>(itens: I[], limite = 5): { visiveis: I[]; botao: ReactNode } {
  const [aberto, setAberto] = useState(false);
  const sobra = itens.length - limite;
  if (sobra <= 0) return { visiveis: itens, botao: null };
  return {
    visiveis: aberto ? itens : itens.slice(0, limite),
    botao: <BotaoVerMais aberto={aberto} restantes={sobra} onClick={() => setAberto(v => !v)} />,
  };
}

export function BotaoVerMais({ aberto, restantes, onClick, rotulo }: {
  aberto: boolean; restantes: number; onClick: () => void; rotulo?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-[#9aa4aa] transition-colors hover:text-[#6cff2f]"
    >
      {aberto
        ? <><ChevronUp className="h-3.5 w-3.5" /> Ver menos</>
        : <><ChevronDown className="h-3.5 w-3.5" /> {rotulo ?? 'Ver mais'} ({restantes})</>}
    </button>
  );
}
