'use client';

import { useEffect, useRef, useState } from 'react';
import { BellRing, X, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AlarmeItem = { id: string; titulo: string; descricao: string | null };

/**
 * O alarme do lembrete — pedido do Matheus em 16/09/2026: "tem que ter um apino,
 * realmente aparecer na tela e ficar tremendo chamando a atenção".
 *
 * ⚠️ Fica até a pessoa responder (Vi / Lembrar em 10 min). Alarme que some sozinho é
 * alarme que não cumpre a função — o lembrete existe justamente para os momentos em
 * que a pessoa está com a cabeça em outra coisa.
 */
export function LembreteAlarme({ itens, onVi, onAdiar }: {
  itens: AlarmeItem[];
  onVi: (id: string) => void;
  onAdiar: (id: string) => void;
}) {
  const atual = itens[0] ?? null;
  const jaTocou = useRef<Set<string>>(new Set());
  // ⚠️ Respeita quem configurou o sistema para menos animação: o card continua
  // aparecendo e o som continua tocando, só não sacode.
  // Lido na INICIALIZAÇÃO (não num effect) para não disparar render em cascata — e com
  // guarda de SSR, já que `window` não existe no servidor.
  const [reduzMovimento, setReduzMovimento] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const ouvir = () => setReduzMovimento(mq.matches);
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, []);

  useEffect(() => {
    if (!atual || jaTocou.current.has(atual.id)) return;
    jaTocou.current.add(atual.id);
    tocarApito();
  }, [atual]);

  if (!atual) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={`Lembrete: ${atual.titulo}`}
      className={cn(
        'fixed bottom-5 right-5 z-[300] w-[min(380px,calc(100vw-2.5rem))]',
        'rounded-lg border border-primary/60 bg-card shadow-2xl shadow-primary/20',
        !reduzMovimento && 'animate-[lembrete-tremor_0.6s_ease-in-out_infinite]',
      )}
    >
      <div className="h-0.5 w-full bg-primary" />
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <BellRing className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Lembrete</p>
          <p className="mt-0.5 break-words text-sm font-semibold text-foreground">{atual.titulo}</p>
          {atual.descricao && (
            <p className="mt-1 break-words text-xs text-muted-foreground">{atual.descricao}</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onVi(atual.id)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:brightness-110 transition"
            >
              Vi
            </button>
            <button
              type="button"
              onClick={() => onAdiar(atual.id)}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition"
            >
              <Clock className="h-3 w-3" /> 10 min
            </button>
            {itens.length > 1 && (
              <span className="ml-auto text-[10px] text-muted-foreground">+{itens.length - 1} na fila</span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Fechar"
          onClick={() => onVi(atual.id)}
          className="text-muted-foreground hover:text-foreground transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * O "apito", gerado na hora pela Web Audio API.
 *
 * ⚠️ Sem arquivo de áudio de propósito: um .mp3 precisaria ser servido, versionado e
 * carregado antes de tocar — e falharia calado justamente na primeira vez.
 *
 * ⚠️ O navegador BLOQUEIA som antes de qualquer interação da pessoa com a página. Como
 * o lembrete toca com o sistema já em uso, na prática o áudio passa; se não passar, o
 * card ainda aparece e sacode. Por isso o som é um reforço, nunca o único aviso.
 */
function tocarApito() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // dois bipes curtos: mais fácil de distinguir de som de sistema que um bipe só
    [0, 0.28].forEach((atraso, i) => {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1046;
      vol.gain.setValueAtTime(0.0001, ctx.currentTime + atraso);
      vol.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + atraso + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + atraso + 0.22);
      osc.connect(vol); vol.connect(ctx.destination);
      osc.start(ctx.currentTime + atraso);
      osc.stop(ctx.currentTime + atraso + 0.24);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 1200);
  } catch {
    // som é reforço; falhar aqui não pode derrubar o alarme visual
  }
}
