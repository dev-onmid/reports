'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClockPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAuthSession } from '@/lib/auth-store';

type Usuario = { id: string; name?: string | null; email?: string | null };

const RECORRENCIAS = [
  { v: 'once', r: 'Uma vez' },
  { v: 'daily', r: 'Todo dia' },
  { v: 'weekly', r: 'Toda semana' },
  { v: 'monthly', r: 'Todo mês' },
] as const;

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/** Data/hora de agora + 1h, no formato do <input type="datetime-local"> (relógio local). */
function daquiUmaHora(): string {
  const d = new Date(Date.now() + 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Criar lembrete — fica ao lado do sino, então está em toda tela do sistema.
 *
 * ⚠️ O destinatário começa SEMPRE em "para mim" (pedido do Matheus). Mandar lembrete
 * para outra pessoa é possível, mas é uma escolha deliberada: o padrão nunca deve ser
 * criar alarme tocando na tela dos outros.
 */
export function NovoLembrete() {
  const [aberto, setAberto] = useState(false);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [paraMim, setParaMim] = useState(true);
  const [destino, setDestino] = useState('');
  const [recorrencia, setRecorrencia] = useState<'once' | 'daily' | 'weekly' | 'monthly'>('once');
  const [runAt, setRunAt] = useState(daquiUmaHora);
  const [hora, setHora] = useState('09:00');
  const [diaSemana, setDiaSemana] = useState(1);
  const [diaMes, setDiaMes] = useState(1);

  const meuId = useMemo(() => getAuthSession()?.userId ?? '', []);
  const tituloRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto || usuarios.length) return;
    void fetch('/api/users')
      .then(r => r.ok ? r.json() : [])
      .then(d => setUsuarios(Array.isArray(d) ? d.filter((u: Usuario) => u.id !== meuId) : []))
      .catch(() => setUsuarios([]));
  }, [aberto, usuarios.length, meuId]);

  // Esc fecha — o modal cobre a tela inteira e não pode virar armadilha
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto]);

  function limpar() {
    setTitulo(''); setDescricao(''); setParaMim(true); setDestino('');
    setRecorrencia('once'); setRunAt(daquiUmaHora()); setHora('09:00');
    setErro(null); setOkMsg(null);
  }

  async function salvar() {
    if (!titulo.trim()) {
      setErro('Escreva do que é o lembrete.');
      tituloRef.current?.focus();
      tituloRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setErro(null); setSalvando(true);
    const corpo: Record<string, unknown> = { titulo, descricao, recorrencia };
    if (recorrencia === 'once') corpo.run_at = runAt;
    else {
      corpo.hora = hora;
      if (recorrencia === 'weekly') corpo.dia_semana = diaSemana;
      if (recorrencia === 'monthly') corpo.dia_mes = diaMes;
    }
    if (!paraMim && destino) corpo.user_id = destino;

    const res = await fetch('/api/lembretes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    }).catch(() => null);
    setSalvando(false);

    if (!res?.ok) {
      const d = await res?.json().catch(() => null) as { error?: string } | null;
      setErro(d?.error ?? 'Não consegui salvar o lembrete.');
      return;
    }
    const quem = paraMim ? 'você' : (usuarios.find(u => u.id === destino)?.name ?? 'a pessoa');
    setOkMsg(`Pronto — vai tocar para ${quem}.`);
    setTimeout(() => { setAberto(false); limpar(); }, 1400);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Criar lembrete"
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <AlarmClockPlus className="h-[18px] w-[18px]" />
      </button>

      {/* ⚠️ z-350: acima do alarme (z-300). Um lembrete que tocasse enquanto a pessoa
          estivesse criando outro cobria o botão "Criar lembrete" e travava a ação. */}
      {aberto && (
        <div className="fixed inset-0 z-[350] flex items-center justify-center bg-black/60 p-4"
             onClick={() => setAberto(false)}>
          {/* ⚠️ `max-h` + `flex-col` no CONTAINER, não só no corpo. Antes o corpo tinha
              70vh e o modal inteiro (cabeçalho + corpo + rodapé) passava da altura da
              tela: em notebook o topo saía de vista e o campo do título — o único
              obrigatório — ficava escondido, com o botão desabilitado sem explicar. */}
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg border border-border bg-card shadow-2xl"
               onClick={e => e.stopPropagation()}>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-heading text-lg uppercase tracking-wide">Novo lembrete</h2>
              <button type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                      className="text-muted-foreground hover:text-foreground transition">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lembrar de quê</label>
                <input ref={tituloRef} value={titulo} onChange={e => setTitulo(e.target.value)} autoFocus
                       placeholder="Ligar para o cliente sobre a proposta"
                       className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Detalhe (opcional)</label>
                <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Para quem</label>
                <div className="mt-1 flex gap-1.5">
                  <button type="button" onClick={() => setParaMim(true)}
                          className={cn('flex-1 rounded-md border px-3 py-2 text-xs transition',
                            paraMim ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                    Para mim
                  </button>
                  <button type="button" onClick={() => setParaMim(false)}
                          className={cn('flex-1 rounded-md border px-3 py-2 text-xs transition',
                            !paraMim ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                    Para outra pessoa
                  </button>
                </div>
                {!paraMim && (
                  <select value={destino} onChange={e => setDestino(e.target.value)}
                          className="mt-1.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm [color-scheme:dark]">
                    <option value="">Escolha quem recebe…</option>
                    {usuarios.map(u => <option key={u.id} value={u.id}>{u.name ?? u.email ?? u.id}</option>)}
                  </select>
                )}
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quando</label>
                <div className="mt-1 grid grid-cols-4 gap-1.5">
                  {RECORRENCIAS.map(o => (
                    <button key={o.v} type="button" onClick={() => setRecorrencia(o.v)}
                            className={cn('rounded-md border px-2 py-2 text-[11px] transition',
                              recorrencia === o.v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                      {o.r}
                    </button>
                  ))}
                </div>

                {recorrencia === 'once' ? (
                  <input type="datetime-local" value={runAt} onChange={e => setRunAt(e.target.value)}
                         className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm [color-scheme:dark]" />
                ) : (
                  <div className="mt-2 flex gap-1.5">
                    <input type="time" value={hora} onChange={e => setHora(e.target.value)}
                           className="h-9 w-28 rounded-md border border-border bg-background px-3 text-sm [color-scheme:dark]" />
                    {recorrencia === 'weekly' && (
                      <select value={diaSemana} onChange={e => setDiaSemana(Number(e.target.value))}
                              className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm [color-scheme:dark]">
                        {DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                    )}
                    {recorrencia === 'monthly' && (
                      <select value={diaMes} onChange={e => setDiaMes(Number(e.target.value))}
                              className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm [color-scheme:dark]">
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>Dia {d}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {recorrencia === 'monthly' && (
                  // ⚠️ O limite de 28 não é preguiça: dia 30/31 não existe em todo mês e o
                  // lembrete simplesmente não tocaria em fevereiro.
                  <p className="mt-1 text-[10px] text-muted-foreground">Vai até o dia 28 — assim o lembrete toca em todos os meses.</p>
                )}
              </div>

              {erro && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{erro}</p>}
              {okMsg && <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">{okMsg}</p>}
            </div>

            <div className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
              <button type="button" onClick={() => setAberto(false)}
                      className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition">
                Cancelar
              </button>
              {/* ⚠️ Só desabilita enquanto SALVA. Desabilitar por falta de título deixava o
                  botão apagado sem dizer o motivo — e o campo que falta pode estar fora
                  de vista. Clicar agora aponta o que falta e leva o cursor até lá. */}
              <button type="button" onClick={() => void salvar()} disabled={salvando}
                      className="rounded-md bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:brightness-110 disabled:opacity-40 transition">
                {salvando ? 'Salvando…' : 'Criar lembrete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
