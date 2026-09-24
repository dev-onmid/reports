'use client';

import { useState } from 'react';
import { X, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SeletorModeloFunil } from '@/components/crm/seletor-modelo-funil';

const MANTER = '__manter__';

type Plano = {
  manter: { id: string; label: string }[];
  criar: { label: string }[];
  remover: { id: string; label: string; leads: number; destino: string }[];
  conservar: { id: string; label: string; leads: number }[];
  destinosPossiveis: string[];
  leadsAfetados: number;
};

/**
 * Aplicar um modelo num funil que JÁ EXISTE.
 *
 * ⚠️ A prévia não é enfeite: `crm_leads.status` é texto livre, então toda
 * coluna que sai leva os leads dela para outra — e isso não tem desfazer. A
 * tela mostra quantos leads se mexem e para onde ANTES de gravar, e deixa
 * trocar o destino coluna a coluna (ou conservar a coluna fora do modelo).
 */
export function AplicarModeloFunil({
  funnelId, clientId, onAplicado, onClose,
}: {
  funnelId: string;
  clientId: string;
  onAplicado: () => void;
  onClose: () => void;
}) {
  const [modeloId, setModeloId] = useState('');
  const [modeloNome, setModeloNome] = useState('');
  const [plano, setPlano] = useState<Plano | null>(null);
  const [destinos, setDestinos] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function pedirPrevia(id: string, novosDestinos: Record<string, string>) {
    if (!id) { setPlano(null); return; }
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/crm/funnels/${funnelId}/aplicar-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, modeloId: id, destinos: novosDestinos, previa: true }),
      });
      if (!res.ok) { setErro('Não foi possível calcular a prévia.'); setPlano(null); return; }
      const d = await res.json() as { plano: Plano };
      setPlano(d.plano);
    } catch {
      setErro('Erro de conexão ao calcular a prévia.');
    } finally {
      setCarregando(false);
    }
  }

  function escolher(id: string, nome: string) {
    setModeloId(id);
    setModeloNome(nome);
    setDestinos({});
    void pedirPrevia(id, {});
  }

  function trocarDestino(label: string, destino: string) {
    const novos = { ...destinos, [label]: destino };
    setDestinos(novos);
    void pedirPrevia(modeloId, novos);
  }

  async function aplicar() {
    if (!modeloId || aplicando) return;
    setAplicando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/crm/funnels/${funnelId}/aplicar-modelo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, modeloId, destinos, previa: false }),
      });
      if (!res.ok) { setErro('Não foi possível aplicar o modelo.'); return; }
      onAplicado();
    } catch {
      setErro('Erro de conexão ao aplicar o modelo.');
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-bold">Aplicar modelo neste funil</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <SeletorModeloFunil modeloId={modeloId} onEscolher={escolher} />

          {carregando && <p className="py-2 text-center text-xs text-muted-foreground">Calculando o que muda…</p>}

          {plano && !carregando && (
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">O que vai acontecer</p>

              <div className="flex flex-wrap gap-3 text-xs">
                <span className="text-muted-foreground">{plano.manter.length} coluna(s) <strong className="text-foreground">continuam</strong></span>
                <span className="text-muted-foreground">{plano.criar.length} <strong className="text-foreground">criadas</strong></span>
                <span className="text-muted-foreground">{plano.remover.length} <strong className="text-foreground">saem</strong></span>
              </div>

              {plano.criar.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Novas: {plano.criar.map(c => c.label).join(' · ')}
                </p>
              )}

              {plano.remover.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-500/5 px-2.5 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Estas colunas saem do funil. <strong className="text-foreground">{plano.leadsAfetados} lead(s)</strong> mudam
                      de coluna — confira o destino de cada uma. Não tem desfazer.
                    </p>
                  </div>
                  {plano.remover.map(r => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold text-foreground">{r.label}</span>
                        <span className="text-muted-foreground"> · {r.leads} lead(s)</span>
                      </span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <select
                        value={destinos[r.label] ?? r.destino}
                        onChange={e => trocarDestino(r.label, e.target.value)}
                        className="w-[46%] shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {plano.destinosPossiveis.map(d => <option key={d} value={d}>{d}</option>)}
                        <option value={MANTER}>— manter a coluna —</option>
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {plano.conservar.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Conservadas fora do modelo: {plano.conservar.map(c => `${c.label} (${c.leads})`).join(' · ')}
                </p>
              )}

              {plano.remover.length === 0 && plano.criar.length === 0 && (
                <p className="text-[11px] text-muted-foreground">Este funil já está igual ao modelo — nada muda.</p>
              )}
            </div>
          )}

          {erro && <p className="text-xs text-red-400">{erro}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground">
            Cancelar
          </button>
          <button
            onClick={() => void aplicar()}
            disabled={!plano || aplicando || carregando}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50',
              'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {aplicando ? 'Aplicando…' : plano && plano.leadsAfetados > 0
              ? `Aplicar e mover ${plano.leadsAfetados} lead(s)`
              : `Aplicar ${modeloNome || 'modelo'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
