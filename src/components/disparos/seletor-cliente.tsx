'use client';

import { ChevronDown, Users, AlertTriangle, Link2Off } from 'lucide-react';
import type { DestinoCliente, InstanciaOrfa } from '@/lib/disparos-destinos';

/**
 * Escolhe o CLIENTE que vai disparar (e, quando ele tem mais de um número,
 * qual). A instância deixou de ser o objeto que a tela oferece — ela é
 * consequência do cliente.
 *
 * Cliente sem instância utilizável NÃO some da lista: aparece desabilitado com
 * o motivo. Sumir faria parecer que o cliente não existe, quando o problema é
 * um QR code para reconectar.
 */
export function SeletorCliente({
  destinos, orfas, onmidClientId, instanceId, onChange, erroEvolution,
}: {
  destinos: DestinoCliente[];
  orfas: InstanciaOrfa[];
  onmidClientId: string;
  instanceId: string;
  onChange: (v: { onmidClientId: string; instanceId: string }) => void;
  erroEvolution?: string;
}) {
  const cliente = destinos.find(d => d.clientId === onmidClientId);
  const usaveis = cliente?.instancias.filter(i => i.conectada) ?? [];
  const orfasConectadas = orfas.filter(o => o.conectada);

  function escolherCliente(id: string) {
    const alvo = destinos.find(d => d.clientId === id);
    const primeira = alvo?.instancias.find(i => i.conectada) ?? alvo?.instancias[0];
    onChange({ onmidClientId: id, instanceId: primeira?.instanceId ?? '' });
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          Cliente que vai disparar *
        </label>
        <div className="relative">
          <select
            value={onmidClientId}
            onChange={e => escolherCliente(e.target.value)}
            className="w-full h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm outline-none focus:ring-1 focus:ring-primary appearance-none"
          >
            <option value="">Selecione o cliente...</option>
            {destinos.map(d => (
              <option key={d.clientId} value={d.clientId} disabled={!d.disponivel}>
                {d.clientName}
                {d.disponivel
                  ? (d.instancias.length > 1 ? ` (${d.instancias.length} números)` : '')
                  : ` — ${d.instancias[0]?.impedimento === 'inexistente' ? 'instância não existe' : 'WhatsApp desconectado'}`}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Cliente com mais de um número: escolher qual fala com a lista. */}
      {cliente && cliente.instancias.length > 1 && (
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Número do cliente *
          </label>
          <div className="relative">
            <select
              value={instanceId}
              onChange={e => onChange({ onmidClientId, instanceId: e.target.value })}
              className="w-full h-9 rounded-lg border border-border bg-background pl-3 pr-8 text-sm outline-none focus:ring-1 focus:ring-primary appearance-none"
            >
              {cliente.instancias.map(i => (
                <option key={i.instanceId} value={i.instanceId} disabled={!i.conectada}>
                  {i.nome}{i.conectada ? '' : ` — ${i.impedimento === 'inexistente' ? 'não existe' : 'desconectado'}`}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      )}

      {cliente && usaveis.length === 0 && (
        <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          O WhatsApp deste cliente não está pronto. Reconecte em Configurações → Instâncias.
        </p>
      )}

      {cliente && usaveis.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-primary shrink-0" />
          Vai sair pelo WhatsApp de <span className="font-semibold text-foreground">{cliente.clientName}</span>
          <span className="font-mono text-[10px] opacity-70">· {instanceId}</span>
        </p>
      )}

      {erroEvolution && (
        <p className="text-[11px] text-red-400 flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          Não consegui falar com o servidor de WhatsApp — nenhum cliente aparece conectado. ({erroEvolution})
        </p>
      )}

      {/* Instância conectada que ninguém vinculou: sem isso ela some da tela sem explicação. */}
      {orfasConectadas.length > 0 && (
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 border-t border-border pt-2">
          <Link2Off className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>
            {orfasConectadas.length} instância(s) conectada(s) sem cliente vinculado
            {' '}(<span className="font-mono text-[10px]">{orfasConectadas.slice(0, 3).map(o => o.nome).join(', ')}</span>
            {orfasConectadas.length > 3 ? '…' : ''}).
            {' '}Vincule na aba <span className="font-semibold text-foreground">Instâncias</span> para poder disparar por ela.
          </span>
        </p>
      )}
    </div>
  );
}
