"use client";

import { useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Undo2, X } from 'lucide-react';
import type { ToastState } from '@/lib/optimizer-ui';

// Toast de confirmação (com Desfazer) — auto-fecha em 7s.
export function ConfirmToast({ toast, onUndo, onClose }: { toast: ToastState; onUndo: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return (
    <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3 shadow-xl">
        {toast.erro
          ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          : <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
        <span className="text-sm text-foreground">{toast.text}</span>
        {toast.undo && (
          <button onClick={onUndo} className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            <Undo2 className="h-3.5 w-3.5" /> Desfazer
          </button>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  );
}
