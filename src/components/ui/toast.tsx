'use client';

/**
 * Toast global mínimo, sem dependência nova.
 *
 * Existe porque a auditoria de 2026-08-22 achou ~30 ações que falhavam EM
 * SILÊNCIO (fetch sem checar res.ok, catch vazio) — cada tela inventava seu
 * próprio aviso ou não avisava nada. `notificar()` pode ser chamado de
 * qualquer client component; o <Toasts/> montado no shell renderiza a pilha.
 *
 * Uso:  import { notificar } from '@/components/ui/toast';
 *       notificar('Não foi possível salvar — tente de novo.', 'erro');
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type TipoToast = 'erro' | 'ok' | 'aviso';
type Toast = { id: number; texto: string; tipo: TipoToast };

type Ouvinte = (t: Toast) => void;
let ouvinte: Ouvinte | null = null;
let seq = 0;
const fila: Toast[] = []; // toasts disparados antes do <Toasts/> montar

export function notificar(texto: string, tipo: TipoToast = 'erro') {
  const t = { id: ++seq, texto, tipo };
  if (ouvinte) ouvinte(t);
  else fila.push(t);
}

const ESTILO: Record<TipoToast, string> = {
  erro: 'border-red-400/40 bg-red-950/90 text-red-100',
  ok: 'border-emerald-400/40 bg-emerald-950/90 text-emerald-100',
  aviso: 'border-amber-400/40 bg-amber-950/90 text-amber-100',
};

export function Toasts() {
  const [itens, setItens] = useState<Toast[]>([]);

  useEffect(() => {
    ouvinte = (t) => {
      setItens((prev) => [...prev.slice(-3), t]); // no máximo 4 na tela
      // erro fica mais tempo na tela que confirmação
      setTimeout(() => setItens((prev) => prev.filter((x) => x.id !== t.id)), t.tipo === 'erro' ? 7000 : 3500);
    };
    for (const t of fila.splice(0)) ouvinte(t);
    return () => { ouvinte = null; };
  }, []);

  if (itens.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[min(92vw,380px)] flex-col gap-2">
      {itens.map((t) => (
        <div
          key={t.id}
          role={t.tipo === 'erro' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto rounded-lg border px-4 py-3 text-xs font-semibold shadow-xl backdrop-blur-sm',
            ESTILO[t.tipo],
          )}
          onClick={() => setItens((prev) => prev.filter((x) => x.id !== t.id))}
        >
          {t.texto}
        </div>
      ))}
    </div>
  );
}
