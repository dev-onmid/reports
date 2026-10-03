'use client';

import { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { MOTIVOS_PERDA, motivoCompleto, type MotivoPerdaId } from '@/lib/motivo-perda';
import { cn } from '@/lib/utils';

/**
 * Pede o motivo no ATO de perder o lead.
 *
 * ⚠️ Não tem "pular". Na auditoria de 02/10/2026 a Tapeçaria Chic tinha 30 leads
 * em "Sem Interesse" e apenas DOIS motivos registrados — e esses dois apontaram
 * falta de produto e política de preço por volume, as duas coisas mais
 * acionáveis do mês. Um botão de pular devolve a tela ao estado anterior.
 *
 * Fechar no X ou no backdrop CANCELA a mudança de etapa: o lead não é perdido
 * pela metade, sem motivo.
 */
export default function MotivoPerdaModal({
  leadNome,
  etapaDestino,
  salvando,
  onCancelar,
  onConfirmar,
}: {
  leadNome: string;
  etapaDestino: string;
  salvando: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: MotivoPerdaId, detalhe: string | null) => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPerdaId | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const podeConfirmar = motivoCompleto(motivo, detalhe) && !salvando;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
         onClick={() => { if (!salvando) onCancelar(); }}>
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-bold">Por que perdemos este lead?</h2>
          </div>
          <button type="button" onClick={onCancelar} disabled={salvando}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{leadNome}</span> está indo para{' '}
            <span className="font-semibold text-foreground">{etapaDestino}</span>. O motivo é o que
            mostra, no fim do mês, o que ajustar na compra e no preço.
          </p>

          <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {MOTIVOS_PERDA.map(m => (
              <button key={m.id} type="button" onClick={() => setMotivo(m.id)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  motivo === m.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-surface-elevated hover:border-primary/40',
                )}>
                <span className="block text-xs font-semibold text-foreground">{m.label}</span>
                <span className="mt-0.5 block text-[10px] leading-tight text-muted-foreground">{m.ajuda}</span>
              </button>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Detalhe {motivo === 'outro' ? '(obrigatório)' : '(opcional)'}
            </span>
            <input
              value={detalhe}
              onChange={e => setDetalhe(e.target.value.slice(0, 300))}
              autoFocus={motivo === 'outro'}
              placeholder={
                motivo === 'preco' ? 'Ex.: concorrente cobrou R$ 420 o rolo'
                : motivo === 'produto' ? 'Ex.: queria branco de fio baixo, não temos'
                : 'O que aconteceu, em uma linha'
              }
              className="mt-1.5 w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs text-foreground outline-none focus:border-primary/60"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <span className="text-[10px] text-muted-foreground">
            Fechar sem escolher cancela a mudança de etapa.
          </span>
          <button type="button" onClick={() => motivo && onConfirmar(motivo, detalhe.trim() || null)}
            disabled={!podeConfirmar}
            className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition-opacity disabled:opacity-40">
            {salvando ? 'Salvando…' : 'Confirmar perda'}
          </button>
        </div>
      </div>
    </div>
  );
}
