"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bell, Calendar, Check, ChevronDown, ChevronRight, Clock,
  Loader2, Plus, Star, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CardQuadro, GrupoConta, ItemFeed, Severidade } from '@/lib/painel-gestor';

/**
 * Quadro do Gestor + Notificações.
 *
 * Estrutura vem do mockup do Matheus (quadro à esquerda, feed à direita); a pele
 * é a do DESIGN_SYSTEM.md — dark, verde #55f52f, Bebas nos títulos, barra no
 * topo do card + quadradinho no canto. O mockup original era claro e azul, de
 * outro produto.
 */

type Aviso = { texto: string; href: string };
type ClienteOpcao = { id: string; name: string; meu: boolean };
type EventoAgenda = {
  id: string; titulo: string; inicio: string; fim: string | null;
  clienteNome: string | null; meu: boolean; meeting_url: string | null;
};

type PainelData = {
  clientes: ClienteOpcao[];
  quadro: { rapida: CardQuadro[]; andamento: CardQuadro[] };
  feed: { meus: GrupoConta[]; outros: GrupoConta[] };
  contadores: { naoLidas: number; importantes: number };
  agenda: EventoAgenda[];
  avisos: Aviso[];
};

type Filtro = 'todas' | 'importantes' | 'lidas';

/** Cor por severidade — mesmos tokens de alerta do design system. */
const COR: Record<Severidade, string> = {
  critico: 'var(--destructive)',
  atencao: '#facc15',
  info: 'var(--primary)',
};

const LABEL_SEV: Record<Severidade, string> = { critico: 'Urgente', atencao: 'Atenção', info: 'Info' };

function horaBR(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function quandoBR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia ? `Hoje às ${horaBR(iso)}` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Card de dados do projeto: barra no topo + quadradinho no canto. */
function Painel({ cor, children, className }: { cor?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('relative overflow-hidden rounded-[var(--radius)] border border-border bg-card p-5', className)}>
      {cor && <>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5" style={{ backgroundColor: cor }} />
        <div className="pointer-events-none absolute top-0 left-0 h-3 w-3" style={{ backgroundColor: cor }} />
      </>}
      {children}
    </section>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export function PainelGestor() {
  const [data, setData] = useState<PainelData | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [verOutros, setVerOutros] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ cliente_id: '', texto: '', categoria: '' });

  const carregar = useCallback(async (f: Filtro) => {
    try {
      const res = await fetch(`/api/inicio/painel?filtro=${f}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as PainelData);
      setErro('');
    } catch {
      // O painel some, o resto do Início continua de pé.
      setErro('Não foi possível carregar o painel agora.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(filtro); }, [carregar, filtro]);

  /**
   * Marcar é otimista e NÃO recarrega o painel inteiro.
   *
   * O PATCH já devolve os contadores atualizados; refazer o GET completo a cada
   * clique custava um round-trip e fazia o número piscar de volta ao valor
   * antigo antes de assentar. Só em falha resincronizamos.
   */
  async function marcar(id: string, patch: { lida?: boolean; importante?: boolean }) {
    setData(d => d && aplicarPatchLocal(d, id, patch));
    try {
      const res = await fetch('/api/notificacoes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { contadores?: { naoLidas: number; importantes: number } };
      if (json.contadores) setData(d => d && { ...d, contadores: json.contadores! });
    } catch {
      void carregar(filtro); // falhou: volta ao estado real do servidor
    }
  }

  async function moverNota(id: string, status: 'rapida' | 'andamento' | 'concluida') {
    // Concluir tira do quadro; mover troca de coluna. Antes isto removia nos
    // dois casos, então "→ Em andamento" fazia o card desaparecer.
    setData(d => d && (status === 'concluida' ? removerNota(d, id) : moverColuna(d, id, status)));
    try {
      const res = await fetch('/api/otimizador/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      void carregar(filtro);
    }
  }

  async function criarNota() {
    if (!form.cliente_id || !form.texto.trim()) return;
    setSalvando(true);
    try {
      await fetch('/api/otimizador/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: form.cliente_id, nivel: 'cliente',
          texto: form.texto.trim(), categoria: form.categoria.trim() || null,
        }),
      });
      setForm({ cliente_id: '', texto: '', categoria: '' });
      setNovaAberta(false);
      await carregar(filtro);
    } finally {
      setSalvando(false);
    }
  }

  const totalFeed = useMemo(
    () => (data ? data.feed.meus.length + data.feed.outros.length : 0),
    [data],
  );

  if (carregando) {
    return (
      <Painel className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando seu dia…
      </Painel>
    );
  }
  if (erro || !data) {
    return (
      <Painel className="text-sm text-muted-foreground">
        {erro || 'Painel indisponível.'}
      </Painel>
    );
  }

  const nadaNoQuadro = data.quadro.rapida.length === 0 && data.quadro.andamento.length === 0;

  return (
    <div className="space-y-4">
      {data.avisos.length > 0 && (
        <div className="space-y-2">
          {data.avisos.map((a, i) => (
            <Link
              key={i}
              href={a.href}
              className="flex items-start gap-3 rounded-[var(--radius)] border border-yellow-400/30 bg-yellow-400/10 p-3 text-yellow-400 transition-colors hover:bg-yellow-400/15"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-xs">{a.texto}</p>
            </Link>
          ))}
        </div>
      )}

      {data.agenda.length > 0 && (
        <Painel cor="var(--secondary)">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-secondary" />
            <Rotulo>Sua agenda de hoje</Rotulo>
          </div>
          <ul className="space-y-2">
            {/* A rota já ordena por início, mas ordem cronológica é o sentido da
                agenda — ordenar aqui também evita que uma mudança na consulta
                passe a mostrar o dia embaralhado sem ninguém notar. */}
            {[...data.agenda].sort((a, b) => a.inicio.localeCompare(b.inicio)).map(e => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-heading text-lg leading-none text-foreground">{horaBR(e.inicio)}</span>
                <span className="text-foreground">{e.titulo}</span>
                {e.clienteNome && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {e.clienteNome}
                  </span>
                )}
                {e.meu && <span className="text-[10px] font-bold uppercase tracking-wider text-primary">seu cliente</span>}
                {e.meeting_url && (
                  <a href={e.meeting_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">
                    entrar
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Painel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------ Quadro */}
        <Painel>
          <div className="mb-1 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-heading text-2xl uppercase leading-none text-foreground">Quadro do Gestor</h2>
              <p className="mt-1 text-xs text-muted-foreground">Suas anotações de gestão. Elas também viram contexto para a IA do Otimizador.</p>
            </div>
            <button
              type="button"
              onClick={() => setNovaAberta(v => !v)}
              className="flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" /> Nova anotação
            </button>
          </div>

          {novaAberta && (
            <div className="mt-4 space-y-2 rounded-[var(--radius)] border border-border bg-surface-soft p-3">
              <select
                value={form.cliente_id}
                onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
                className="w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm text-foreground"
              >
                <option value="">Escolha o cliente…</option>
                {data.clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.meu ? ' · seu' : ''}</option>
                ))}
              </select>
              <textarea
                value={form.texto}
                onChange={e => setForm(f => ({ ...f, texto: e.target.value }))}
                placeholder="O que precisa ser feito ou lembrado?"
                rows={2}
                className="w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm text-foreground"
              />
              <input
                value={form.categoria}
                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}
                placeholder="Categoria (ex: Estratégia, Criativos)"
                className="w-full rounded-[var(--radius)] border border-border bg-card px-3 py-2 text-sm text-foreground"
              />
              <button
                type="button"
                disabled={salvando || !form.cliente_id || !form.texto.trim()}
                onClick={() => void criarNota()}
                className="w-full rounded-[var(--radius)] bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-40"
              >
                {salvando ? 'Salvando…' : 'Adicionar'}
              </button>
            </div>
          )}

          {nadaNoQuadro ? (
            <div className="mt-4 flex items-start gap-3 rounded-[var(--radius)] border border-primary/30 bg-primary/10 p-4 text-primary">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm">Nada anotado. Quadro limpo.</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Coluna titulo="Notas rápidas" cards={data.quadro.rapida} onMover={moverNota} />
              <Coluna titulo="Em andamento" cards={data.quadro.andamento} onMover={moverNota} />
            </div>
          )}
        </Painel>

        {/* ------------------------------------------------ Feed */}
        <Painel>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Bell className="h-4 w-4 text-foreground" />
            <h2 className="font-heading text-2xl uppercase leading-none text-foreground">Notificações</h2>
            {data.contadores.naoLidas > 0 && (
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                {data.contadores.naoLidas} {data.contadores.naoLidas === 1 ? 'não lida' : 'não lidas'}
              </span>
            )}
            {data.contadores.importantes > 0 && (
              <span className="rounded-md bg-yellow-400/10 px-2 py-0.5 text-[11px] font-bold text-yellow-400">
                {data.contadores.importantes} {data.contadores.importantes === 1 ? 'importante' : 'importantes'}
              </span>
            )}
          </div>

          <div className="mb-4 flex gap-1">
            {(['todas', 'importantes', 'lidas'] as Filtro[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                className={cn(
                  'rounded-[var(--radius)] px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors',
                  filtro === f ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {f === 'todas' ? 'Todas' : f === 'importantes' ? 'Importantes' : 'Lidas'}
              </button>
            ))}
          </div>

          {totalFeed === 0 ? (
            <div className="flex items-start gap-3 rounded-[var(--radius)] border border-primary/30 bg-primary/10 p-4 text-primary">
              <Check className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider">Tudo em dia</p>
                <p className="mt-0.5 text-sm">Nada precisa de você agora.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {data.feed.meus.map(g => <Grupo key={g.clientId ?? 'ag'} grupo={g} onMarcar={marcar} />)}

              {data.feed.outros.length > 0 && (
                <div className="border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={() => setVerOutros(v => !v)}
                    className="flex w-full items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"
                  >
                    {verOutros ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    Resto da agência ({data.feed.outros.length})
                  </button>
                  {verOutros && (
                    <div className="mt-3 space-y-4">
                      {data.feed.outros.map(g => <Grupo key={g.clientId ?? 'ag'} grupo={g} onMarcar={marcar} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Painel>
      </div>
    </div>
  );
}

function Coluna({
  titulo, cards, onMover,
}: {
  titulo: string;
  cards: CardQuadro[];
  onMover: (id: string, status: 'rapida' | 'andamento' | 'concluida') => void;
}) {
  const emAndamento = titulo === 'Em andamento';
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-soft p-3">
      <div className="mb-3 flex items-center gap-2">
        <Rotulo>{titulo}</Rotulo>
        <span className="text-[11px] font-bold text-muted-foreground">{cards.length}</span>
      </div>
      {cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">Vazio.</p>
      ) : (
        <ul className="space-y-2">
          {cards.map(c => (
            <li
              key={c.id}
              className="group relative rounded-[var(--radius)] border border-border bg-card p-3"
              style={c.atrasada ? { borderLeftWidth: 3, borderLeftColor: 'var(--destructive)' } : undefined}
            >
              <p className="text-[13px] leading-snug text-foreground">{c.texto}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {c.categoria && (
                  <span className="rounded bg-secondary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-secondary">
                    {c.categoria}
                  </span>
                )}
                {c.clienteNome && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {c.clienteNome}
                  </span>
                )}
                {c.prazoEm && (
                  <span className={cn('flex items-center gap-1 text-[10px]', c.atrasada ? 'font-bold text-destructive' : 'text-muted-foreground')}>
                    <Clock className="h-3 w-3" />
                    {c.atrasada ? 'atrasada · ' : ''}{quandoBR(c.prazoEm)}
                  </span>
                )}
              </div>
              {/* max-md:opacity-100 — no touch não existe hover, e a ação
                  ficaria inalcançável no celular. */}
              <div className="mt-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
                {!emAndamento && (
                  <button type="button" onClick={() => onMover(c.id, 'andamento')} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                    → Em andamento
                  </button>
                )}
                <button type="button" onClick={() => onMover(c.id, 'concluida')} className="text-[10px] font-bold uppercase tracking-wider text-primary hover:opacity-80">
                  ✓ Concluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Grupo({
  grupo, onMarcar,
}: {
  grupo: GrupoConta;
  onMarcar: (id: string, patch: { lida?: boolean; importante?: boolean }) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0" style={{ backgroundColor: COR[grupo.pior] }} />
        <p className="text-[11px] font-bold uppercase tracking-widest text-foreground">
          {grupo.clienteNome ?? 'Da agência'}
        </p>
        {grupo.meu && <span className="text-[10px] font-bold uppercase tracking-wider text-primary">seu</span>}
      </div>
      <ul className="space-y-2">
        {grupo.itens.map(it => <Linha key={it.id} item={it} onMarcar={onMarcar} />)}
      </ul>
    </div>
  );
}

const ICONE: Record<string, typeof Wallet> = {
  saldo: Wallet, agenda: Calendar, reuniao: Calendar, cpl: AlertTriangle,
  social: Bell, instancia: AlertTriangle, relatorio: Bell, sistema: Bell,
};

function Linha({
  item, onMarcar,
}: {
  item: ItemFeed;
  onMarcar: (id: string, patch: { lida?: boolean; importante?: boolean }) => void;
}) {
  const Icone = ICONE[item.tipo] ?? Bell;
  const cor = COR[item.severidade];
  return (
    <li
      className={cn(
        'group flex items-start gap-3 rounded-[var(--radius)] border border-border p-3 transition-colors',
        item.lida ? 'bg-transparent opacity-70' : 'bg-surface-soft',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: cor }}
    >
      <Icone className="mt-0.5 h-4 w-4 shrink-0" style={{ color: cor }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-semibold leading-snug text-foreground">{item.titulo}</p>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: cor }}>
            {LABEL_SEV[item.severidade]}
          </span>
        </div>
        {item.descricao && <p className="mt-0.5 text-xs text-muted-foreground">{item.descricao}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <span className="text-[10px] text-muted-foreground">{quandoBR(item.criadoEm)}</span>
          {/* Um CTA por linha: o painel encaminha, não executa. */}
          {item.href && item.href !== '#' && (
            <Link href={item.href} className="text-[10px] font-bold uppercase tracking-wider text-primary hover:underline">
              Abrir
            </Link>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        <button
          type="button"
          title={item.importante ? 'Remover destaque' : 'Marcar como importante'}
          onClick={() => onMarcar(item.id, { importante: !item.importante })}
        >
          <Star className={cn('h-3.5 w-3.5', item.importante ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground hover:text-foreground')} />
        </button>
        {!item.lida && (
          <button type="button" title="Marcar como lida" onClick={() => onMarcar(item.id, { lida: true })}>
            <Check className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
          </button>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------ updates otimistas

function aplicarPatchLocal(d: PainelData, id: string, patch: { lida?: boolean; importante?: boolean }): PainelData {
  const mapa = (g: GrupoConta): GrupoConta => ({
    ...g,
    itens: g.itens.map(it => it.id === id
      ? { ...it, lida: patch.lida ?? it.lida, importante: patch.importante ?? it.importante }
      : it),
  });
  return {
    ...d,
    feed: { meus: d.feed.meus.map(mapa), outros: d.feed.outros.map(mapa) },
    contadores: patch.lida
      ? { ...d.contadores, naoLidas: Math.max(0, d.contadores.naoLidas - 1) }
      : d.contadores,
  };
}

function moverColuna(d: PainelData, id: string, status: 'rapida' | 'andamento'): PainelData {
  const todos = [...d.quadro.rapida, ...d.quadro.andamento]
    .map(c => (c.id === id ? { ...c, status } : c));
  return {
    ...d,
    quadro: {
      rapida: todos.filter(c => c.status === 'rapida'),
      andamento: todos.filter(c => c.status === 'andamento'),
    },
  };
}

function removerNota(d: PainelData, id: string): PainelData {
  return {
    ...d,
    quadro: {
      rapida: d.quadro.rapida.filter(c => c.id !== id),
      andamento: d.quadro.andamento.filter(c => c.id !== id),
    },
  };
}
