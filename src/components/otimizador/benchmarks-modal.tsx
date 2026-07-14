"use client";

import { useEffect, useState } from 'react';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { callerHeaders, getAuthSession } from '@/lib/auth-store';

type Row = {
  nicho: string;
  label: string;
  cpl_ideal: number;
  cpl_maximo: number;
  default_ideal: number;
  default_maximo: number;
};

// Modal admin pra editar os benchmarks de custo por nicho — a régua de referência usada quando o
// cliente não tem meta cadastrada. Salva no banco (sobrescreve os defaults do arquivo).
export function BenchmarksModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const session = getAuthSession();

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/otimizador/benchmarks');
        if (res.ok) setRows((await res.json() as { itens: Row[] }).itens ?? []);
      } finally { setLoading(false); }
    })();
  }, []);

  function setField(nicho: string, campo: 'cpl_ideal' | 'cpl_maximo', valor: number) {
    setRows((prev) => prev.map((r) => r.nicho === nicho ? { ...r, [campo]: valor } : r));
  }
  function restaurar(nicho: string) {
    setRows((prev) => prev.map((r) => r.nicho === nicho ? { ...r, cpl_ideal: r.default_ideal, cpl_maximo: r.default_maximo } : r));
  }

  async function salvar() {
    setSaving(true); setSaved(false);
    try {
      const res = await fetch('/api/otimizador/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...callerHeaders() },
        body: JSON.stringify({
          itens: rows.map((r) => ({ nicho: r.nicho, cpl_ideal: r.cpl_ideal, cpl_maximo: r.cpl_maximo })),
          updated_by: session?.name ?? undefined,
        }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[var(--radius)] border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-semibold text-foreground">Benchmarks por nicho</h2>
            <p className="text-sm text-muted-foreground">Régua de custo (por lead/conversa) usada quando o cliente não tem meta cadastrada.</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="grid grid-cols-[1fr_96px_96px_40px] items-center gap-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <span>Nicho</span>
                <span className="text-right">Custo-alvo</span>
                <span className="text-right">Teto</span>
                <span />
              </div>
              <div className="space-y-1.5">
                {rows.map((r) => {
                  const editado = r.cpl_ideal !== r.default_ideal || r.cpl_maximo !== r.default_maximo;
                  return (
                    <div key={r.nicho} className="grid grid-cols-[1fr_96px_96px_40px] items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{r.label}</p>
                        <p className="text-[10px] text-muted-foreground">padrão R$ {r.default_ideal}–{r.default_maximo}</p>
                      </div>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                        <input type="number" min={1} value={r.cpl_ideal}
                          onChange={(e) => setField(r.nicho, 'cpl_ideal', Number(e.target.value))}
                          className="h-9 w-full rounded-[var(--radius)] border border-border bg-background pl-7 pr-2 text-right text-sm text-foreground outline-none focus:border-primary" />
                      </div>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                        <input type="number" min={1} value={r.cpl_maximo}
                          onChange={(e) => setField(r.nicho, 'cpl_maximo', Number(e.target.value))}
                          className="h-9 w-full rounded-[var(--radius)] border border-border bg-background pl-7 pr-2 text-right text-sm text-foreground outline-none focus:border-primary" />
                      </div>
                      <button
                        onClick={() => restaurar(r.nicho)}
                        title="Restaurar padrão"
                        disabled={!editado}
                        className="flex h-9 w-9 items-center justify-center rounded-[var(--radius)] text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border p-4">
              {saved && <span className="text-xs text-primary">Benchmarks salvos!</span>}
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={salvar} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
