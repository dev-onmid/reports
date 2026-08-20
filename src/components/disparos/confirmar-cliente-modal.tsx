'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X, Send } from 'lucide-react';
import { nomeConfere } from '@/lib/disparos-destinos';

/**
 * Trava de digitação antes de soltar mensagem na lista de um cliente.
 *
 * O nome digitado é comparado com `nomeConfere` (a mesma régua do matcher de
 * clientes: ignora acento/caixa/pontuação, mas não aceita prefixo) — "Sorrifácil"
 * não abre a campanha da "Sorrifácil Cambé", que é justamente o erro caro quando
 * a carteira tem cinco clientes com o mesmo primeiro nome.
 */
export function ConfirmarClienteModal({
  aberto, clienteNome, instanciaNome, totalContatos, acao, erro, enviando, onCancelar, onConfirmar,
}: {
  aberto: boolean;
  clienteNome: string;
  instanciaNome: string;
  /** Quantos contatos vão receber (omitido no "retomar"). */
  totalContatos?: number;
  acao: 'criar' | 'retomar';
  erro?: string;
  enviando?: boolean;
  onCancelar: () => void;
  onConfirmar: (nomeDigitado: string) => void;
}) {
  const [texto, setTexto] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reabrir sempre começa em branco: campo pré-preenchido anularia a trava.
  useEffect(() => {
    if (aberto) {
      setTexto('');
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancelar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, onCancelar]);

  if (!aberto) return null;

  const confere = nomeConfere(texto, clienteNome);
  const verbo = acao === 'criar' ? 'Disparar' : 'Retomar';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      onClick={onCancelar}>
      <div className="w-full max-w-md rounded-[var(--radius)] border border-border bg-card overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="h-1 w-full bg-amber-400" />
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-lg p-1.5 shrink-0" style={{ background: 'rgba(251,191,36,0.15)' }}>
              <AlertTriangle className="h-4 w-4 text-amber-400" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold leading-tight">
                {acao === 'criar' ? 'Confirmar disparo' : 'Confirmar retomada'}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                Enviando pelo WhatsApp de <span className="font-mono">{instanciaNome}</span>
              </p>
            </div>
          </div>
          <button type="button" onClick={onCancelar}
            className="text-muted-foreground hover:text-foreground shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-3">
          <div className="rounded-lg border border-border bg-background p-3">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Cliente</p>
            <p className="text-lg font-bold leading-tight mt-0.5">{clienteNome}</p>
            {typeof totalContatos === 'number' && (
              <p className="text-xs text-muted-foreground mt-1">
                {totalContatos.toLocaleString('pt-BR')} contato(s) vão receber esta mensagem.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Digite o nome do cliente para confirmar
            </label>
            <input
              ref={inputRef}
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && confere && !enviando) onConfirmar(texto); }}
              placeholder={clienteNome}
              autoComplete="off"
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            {texto.length > 0 && !confere && (
              <p className="text-[11px] text-amber-400">O nome não confere com o cliente selecionado.</p>
            )}
          </div>

          {erro && (
            <p className="text-[11px] text-red-400 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5">{erro}</p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={onCancelar}
              className="h-9 flex-1 rounded-lg border border-border text-sm font-semibold hover:bg-muted/40">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!confere || enviando}
              onClick={() => onConfirmar(texto)}
              className="h-9 flex-1 rounded-lg bg-primary text-sm font-bold text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" />
              {enviando ? 'Enviando...' : verbo}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
