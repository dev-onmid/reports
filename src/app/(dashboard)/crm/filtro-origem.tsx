'use client';

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TETO_SEM_ANUNCIO } from '@/lib/crm-origem-filtro';

/**
 * Filtro de origem do CRM: tráfego (padrão), todas as conversas, só as sem
 * anúncio, ou um canal. O valor vai para /api/crm como `origem`
 * (crm-origem-filtro.ts) e é o servidor quem filtra, para a tela não baixar
 * milhares de conversas. As contagens do período vêm de /api/crm/origens.
 */

type Opcoes = {
  total: number;
  trafego: number;
  semAnuncio: number;
  canais: { canal: string; rotulo: string; total: number; trafego: number }[];
};

const CHAVE = 'crm:origem';

export function lerOrigemSalva(): string {
  try { return localStorage.getItem(CHAVE) || 'trafego'; } catch { return 'trafego'; }
}
export function salvarOrigem(v: string) {
  try { localStorage.setItem(CHAVE, v); } catch { /* ignore */ }
}

export function FiltroOrigem({ clientId, funnelId, from, to, valor, onChange }: {
  clientId: string;
  funnelId: string;
  from: string;
  to: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const chave = `${clientId}|${funnelId}|${from}|${to}`;

  useEffect(() => {
    if (!clientId) return;
    let vivo = true;
    const qs = new URLSearchParams({ clientId });
    if (funnelId) qs.set('funnelId', funnelId);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    fetch(`/api/crm/origens?${qs}`)
      .then(r => (r.ok ? r.json() as Promise<Opcoes> : null))
      .then(j => { if (vivo) setOpcoes(j); })
      .catch(() => { if (vivo) setOpcoes(null); });
    return () => { vivo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (v: number | undefined) => (typeof v === 'number' ? ` (${v.toLocaleString('pt-BR')})` : '');
  const canalSelecionado = valor.startsWith('canal:') ? valor.slice(6) : null;
  const canais = opcoes?.canais ?? [];
  // O canal escolhido continua na lista mesmo se sumir do período, senão o
  // select mostraria um valor que não existe.
  const faltaSelecionado = canalSelecionado !== null && !canais.some(c => c.canal.toLowerCase() === canalSelecionado.toLowerCase());

  const canalAtual = canalSelecionado !== null ? canais.find(c => c.canal.toLowerCase() === canalSelecionado.toLowerCase()) : undefined;
  const semAnuncioDoFiltro = valor === 'trafego' ? 0
    : canalSelecionado !== null ? (canalAtual ? canalAtual.total - canalAtual.trafego : 0)
    : (opcoes?.semAnuncio ?? 0);
  const cortado = semAnuncioDoFiltro > TETO_SEM_ANUNCIO;

  return (
    <div className="flex items-center gap-2">
    <div className="relative">
      <select
        value={valor}
        onChange={e => onChange(e.target.value)}
        title="Quais conversas aparecem no quadro. Os números do topo e o dashboard contam só o tráfego."
        className={cn('h-10 max-w-[230px] appearance-none rounded-lg border border-border bg-card pl-8 pr-7 text-sm font-semibold outline-none transition-colors hover:bg-muted/50',
          valor === 'trafego' ? 'text-muted-foreground' : 'text-foreground')}
      >
        <option value="trafego">Tráfego{n(opcoes?.trafego)}</option>
        <option value="todos">Todas as conversas{n(opcoes?.total)}</option>
        <option value="sem_anuncio">Sem anúncio{n(opcoes?.semAnuncio)}</option>
        {(canais.length > 0 || faltaSelecionado) && (
          <optgroup label="Por origem">
            {canais.map(c => (
              <option key={c.canal || 'sem'} value={`canal:${c.canal}`}>{c.rotulo}{n(c.total)}</option>
            ))}
            {faltaSelecionado && <option value={valor}>{canalSelecionado || 'Sem canal informado'}</option>}
          </optgroup>
        )}
      </select>
      <Megaphone className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">▾</span>
    </div>
    {cortado && (
      <span className="whitespace-nowrap text-[11px] text-muted-foreground"
        title="Para o CRM não ficar lento, as conversas sem anúncio vêm só as mais recentes. Use a busca ou um período menor para achar as outras.">
        {TETO_SEM_ANUNCIO} mais recentes de {semAnuncioDoFiltro.toLocaleString('pt-BR')} sem anúncio
      </span>
    )}
    </div>
  );
}
