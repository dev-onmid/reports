'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronRight, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Chrome compartilhado da sub-aba Conversões (Clientes → Rastreio).
 *
 * A tela antes empilhava os 4 formulários completos de uma vez — parede de
 * campos sem contexto de "onde eu acho esse valor". Agora cada assunto é um
 * BOTÃO (`ConversaoTile`) que abre um passo a passo (`GuideStepModal`), no mesmo
 * espírito do wizard de cliente novo (`clientes/novo`): um campo por vez, com o
 * guia de como obter o valor ao lado — os textos de guia são os mesmos que
 * viviam escondidos nos tooltips de interrogação.
 */

export type GuideStep = {
  /** Rótulo curto no stepper. */
  label: string;
  /** Passo a passo de como obter o valor. Uma linha por item; "1." etc. no texto. */
  guide?: string;
  /** Campos do passo. */
  body: React.ReactNode;
  /** Passo que pode ficar vazio — só muda o texto do botão de avanço. */
  optional?: boolean;
};

function GuideBox({ text }: { text: string }) {
  const linhas = text.split('\n').filter(l => l.trim().length > 0);
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-primary">Como conseguir</p>
      <div className="space-y-1.5">
        {linhas.map((linha, i) => (
          <p key={i} className={cn(
            'text-xs leading-relaxed',
            linha.trimStart().startsWith('⚠️') ? 'font-medium text-amber-300' : 'text-muted-foreground',
          )}>
            {linha}
          </p>
        ))}
      </div>
    </div>
  );
}

export function GuideStepModal({
  open, onClose, icon: Icon, iconColor = 'text-primary', title, subtitle,
  steps, onFinish, finishing, finishLabel = 'Salvar', footerExtra,
}: {
  open: boolean;
  onClose: () => void;
  icon: React.ElementType;
  iconColor?: string;
  title: string;
  subtitle?: string;
  steps: GuideStep[];
  onFinish: () => void | Promise<void>;
  finishing?: boolean;
  finishLabel?: string;
  /** Ex.: botão "Testar conexão", exibido no último passo. */
  footerExtra?: React.ReactNode;
}) {
  const [step, setStep] = useState(0);

  // Reabrir sempre começa do início — modal fechado no passo 3 e reaberto
  // parecia "quebrado" (campos do meio sem contexto).
  useEffect(() => { if (open) setStep(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const atual = steps[step];
  const ultimo = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
              <Icon className={cn('h-5 w-5', iconColor)} />
            </div>
            <div>
              <h3 className="font-heading text-lg font-normal uppercase tracking-wide text-foreground">{title}</h3>
              {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Stepper */}
        {steps.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            {steps.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold transition-colors',
                    i === step ? 'border-primary bg-primary/20 text-primary'
                      : i < step ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </button>
                <span className={cn('text-[11px] font-semibold', i === step ? 'text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </span>
                {i < steps.length - 1 && <div className="h-px w-5 bg-border" />}
              </div>
            ))}
          </div>
        )}

        {/* Corpo do passo */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {atual.guide && <GuideBox text={atual.guide} />}
          {atual.body}
        </div>

        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5">
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
              >
                Voltar
              </button>
            )}
            {steps.length > 1 && (
              <span className="text-[11px] text-muted-foreground">Etapa {step + 1} de {steps.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ultimo && footerExtra}
            {ultimo ? (
              <button
                onClick={() => void onFinish()}
                disabled={finishing}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-black transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {finishing && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                {finishLabel}
              </button>
            ) : (
              <button
                onClick={() => setStep(s => s + 1)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-black transition-colors hover:bg-primary/90"
              >
                {atual.optional ? 'Pular' : 'Avançar'}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Botão-categoria da grade de Conversões. */
export function ConversaoTile({
  icon: Icon, iconColor = 'text-primary', title, description, status, onClick,
}: {
  icon: React.ElementType;
  iconColor?: string;
  title: string;
  description: string;
  /** Selo do estado atual: verde = ligado/ok, âmbar = falta algo, cinza = vazio. */
  status: { label: string; tone: 'on' | 'partial' | 'off' };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40 hover:bg-card/80"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background">
          <Icon className={cn('h-5 w-5', iconColor)} />
        </div>
        <span className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
          status.tone === 'on' ? 'border-primary/30 bg-primary/10 text-primary'
            : status.tone === 'partial' ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
            : 'border-border bg-muted text-muted-foreground',
        )}>
          {status.label}
        </span>
      </div>
      <div>
        <p className="flex items-center gap-1 font-bold text-sm text-foreground">
          {title}
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
