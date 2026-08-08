"use client";

// Histórico de Otimizações — pedido do Matheus (2026-08-07): registrar o que
// foi feito em cada conta (canal, tipos de ação, justificativa — digitado ou
// ditado por voz), ver quando cada conta foi otimizada pela última vez, e uma
// programação por cliente/canal com alerta quando estoura o prazo. Filtro
// padrão: cada gestor vê os próprios clientes (clients.gestor_id), com botão
// "Todos". Backend em /api/otimizacoes (+/overview, +/agenda).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight,
  History, Megaphone, Mic, Plus, Search, Trash2, X,
} from 'lucide-react';
import { getAuthSession, type AuthSession } from '@/lib/auth-store';
import { useClients } from '@/lib/client-store';
import { ClientAvatar } from '@/components/client-avatar';
import { cn } from '@/lib/utils';
import type { Client } from '@/lib/mock-data';
import {
  ACOES_OTIMIZACAO, CANAIS_OTIMIZACAO, FREQ_PADRAO_DIAS, PESO_ESTADO,
  acaoLabel, canalLabel, diasDesde, piorEstado, statusOtimizacao,
  type EstadoOtimizacao, type StatusOtimizacao,
} from '@/lib/otimizacao-ui';

type UltimaPorCanal = {
  client_id: string;
  canal: string;
  canal_detalhe: string | null;
  user_name: string | null;
  acoes: string[];
  resumo: string;
  created_at: string;
};

type AgendaRow = { client_id: string; canal: string; frequencia_dias: number };

type Registro = {
  id: string;
  client_id: string;
  user_id: string | null;
  user_name: string | null;
  canal: string;
  canal_detalhe: string | null;
  acoes: string[];
  descricao: string;
  origem: string;
  created_at: string;
};

type CanalStatus = {
  canal: string;
  freq: number | null;
  ultima: UltimaPorCanal | null;
  status: StatusOtimizacao | null; // null = canal sem programação (chip informativo)
};

type Linha = {
  client: Client;
  canais: CanalStatus[];
  estado: EstadoOtimizacao;
  diasAtraso: number;
  ultimaGeral: UltimaPorCanal | null;
  total: number;
  semProgramacao: boolean;
};

const ESTADO_STYLE: Record<EstadoOtimizacao, { badge: string; border: string; label: string }> = {
  atrasado:     { badge: 'bg-red-500/15 border-red-400/30 text-red-300',           border: 'border-l-red-500',     label: 'Atrasado' },
  sem_registro: { badge: 'bg-orange-500/15 border-orange-400/30 text-orange-300',  border: 'border-l-orange-400',  label: 'Nunca registrado' },
  vence_hoje:   { badge: 'bg-yellow-500/15 border-yellow-400/30 text-yellow-300',  border: 'border-l-yellow-400',  label: 'Vence hoje' },
  em_dia:       { badge: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300', border: 'border-l-emerald-500', label: 'Em dia' },
};

// Logos reais das plataformas (mesmos arquivos de platform-icons.tsx / lista de
// Clientes). "Outro" não tem marca — cai num ícone genérico.
function CanalLogo({ canal, className }: { canal: string; className?: string }) {
  const cls = cn('shrink-0 object-contain', className ?? 'h-3.5 w-3.5');
  /* eslint-disable @next/next/no-img-element */
  if (canal === 'meta') return <img src="/brand/meta-ads-logo.webp" alt="Meta Ads" className={cls} />;
  if (canal === 'google') return <img src="/brand/google-ads-logo.png" alt="Google Ads" className={cls} />;
  /* eslint-enable @next/next/no-img-element */
  return <Megaphone className={cn('shrink-0 text-purple-300', className ?? 'h-3.5 w-3.5')} />;
}

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
});

function haDias(iso: string | null | undefined): string {
  const d = diasDesde(iso);
  if (d === null) return 'nunca';
  if (d === 0) return 'hoje';
  if (d === 1) return 'ontem';
  return `há ${d}d`;
}

function estadoBadgeText(estado: EstadoOtimizacao, diasAtraso: number): string {
  if (estado === 'atrasado') return `${diasAtraso}d de atraso`;
  return ESTADO_STYLE[estado].label;
}

// ── Ditado por voz (Web Speech API — Chrome/Edge; sem backend) ──────────────
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: SpeechResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};
type SpeechResultEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
};

function makeRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  try { return Ctor ? new Ctor() : null; } catch { return null; }
}

// ── Modal de registro ────────────────────────────────────────────────────────
function RegistroModal({ client, onClose, onSaved }: {
  client: Client;
  onClose: () => void;
  onSaved: (r: Registro) => void;
}) {
  const [canal, setCanal] = useState<string>('meta');
  const [canalDetalhe, setCanalDetalhe] = useState('');
  const [acoes, setAcoes] = useState<string[]>([]);
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [gravando, setGravando] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const vozUsadaRef = useRef(false);

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* já parado */ } }, []);

  function alternarGravacao() {
    if (gravando) { try { recRef.current?.stop(); } catch { /* já parado */ } return; }
    const rec = makeRecognition();
    if (!rec) {
      setErro('Ditado por voz não é suportado neste navegador — use o Chrome ou digite o texto.');
      return;
    }
    setErro(null);
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let parcial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const txt = r[0]?.transcript ?? '';
        if (r.isFinal) {
          const limpo = txt.trim();
          if (limpo) {
            vozUsadaRef.current = true;
            setDescricao((prev) => (prev ? `${prev.replace(/\s+$/, '')} ` : '') + limpo);
          }
        } else {
          parcial += txt;
        }
      }
      setInterim(parcial);
    };
    rec.onend = () => { setGravando(false); setInterim(''); };
    rec.onerror = (ev) => {
      setGravando(false);
      setInterim('');
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setErro('Microfone bloqueado — libere a permissão do site e tente de novo.');
      }
    };
    recRef.current = rec;
    try { rec.start(); setGravando(true); } catch { setGravando(false); }
  }

  async function salvar() {
    if (!descricao.trim() || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch('/api/otimizacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          canal,
          canal_detalhe: canal === 'outro' ? canalDetalhe : null,
          acoes,
          descricao: descricao.trim(),
          origem: vozUsadaRef.current ? 'audio' : 'texto',
        }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; registro?: Registro; error?: string } | null;
      if (!res.ok || !data?.registro) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved(data.registro);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Registrar otimização</h3>
            <p className="text-xs text-muted-foreground">{client.name}</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Canal</p>
            <div className="flex flex-wrap gap-1.5">
              {CANAIS_OTIMIZACAO.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCanal(c.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                    canal === c.id
                      ? 'border-primary/60 bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted/30',
                  )}
                >
                  <CanalLogo canal={c.id} className="h-3.5 w-3.5" /> {c.label}
                </button>
              ))}
            </div>
            {canal === 'outro' && (
              <input
                value={canalDetalhe}
                onChange={(e) => setCanalDetalhe(e.target.value)}
                placeholder="Qual canal? (TikTok, LinkedIn, e-mail…)"
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/60"
                maxLength={80}
              />
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">O que foi mexido</p>
            <div className="flex flex-wrap gap-1.5">
              {ACOES_OTIMIZACAO.map((a) => {
                const on = acoes.includes(a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => setAcoes((prev) => on ? prev.filter((x) => x !== a.id) : [...prev, a.id])}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[11px] transition-colors',
                      on
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">O que foi feito e por quê</p>
              <button
                onClick={alternarGravacao}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  gravando
                    ? 'border-red-400/50 bg-red-500/15 text-red-300'
                    : 'border-border text-muted-foreground hover:bg-muted/30',
                )}
                title="Ditado por voz (pt-BR)"
              >
                <Mic className={cn('h-3.5 w-3.5', gravando && 'animate-pulse')} />
                {gravando ? 'Gravando… clique p/ parar' : 'Falar em vez de digitar'}
              </button>
            </div>
            <textarea
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              rows={5}
              placeholder={'Ex: pausei o público aberto 25-45 porque o CPL subiu pra R$32 (meta R$20); subi 3 criativos novos de vídeo focados no depoimento.'}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
            {gravando && (
              <p className="mt-1 text-[11px] italic text-muted-foreground">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400 align-middle" />
                Ouvindo… {interim || 'fale normalmente, o texto entra sozinho.'}
              </p>
            )}
          </div>

          {erro && (
            <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erro}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30">
            Cancelar
          </button>
          <button
            onClick={() => void salvar()}
            disabled={!descricao.trim() || salvando}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            {salvando ? 'Salvando…' : 'Salvar registro'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal de programação em massa ("Programar vários") ──────────────────────
type BulkModo = 'manter' | 'definir' | 'remover';

function BulkAgendaModal({ clients, onClose, onApplied }: {
  clients: Client[];
  onClose: () => void;
  /** Chamado após cada PATCH em lote bem-sucedido, pra atualizar o estado local. */
  onApplied: (clientIds: string[], canal: string, freq: number | null) => void;
}) {
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<Record<'meta' | 'google', BulkModo>>({ meta: 'manter', google: 'manter' });
  const [dias, setDias] = useState<Record<'meta' | 'google', string>>({ meta: '7', google: '7' });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q
      ? clients.filter((c) => c.name.toLowerCase().includes(q) || (c.gestor_name ?? '').toLowerCase().includes(q))
      : clients;
  }, [clients, busca]);

  function toggle(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const canaisAtivos = (['meta', 'google'] as const).filter((c) => modo[c] !== 'manter');
  const diasInvalidos = canaisAtivos.some((c) => modo[c] === 'definir' && !(Number(dias[c]) >= 1));
  const pronto = sel.size > 0 && canaisAtivos.length > 0 && !diasInvalidos;

  async function aplicar() {
    if (!pronto || salvando) return;
    setSalvando(true);
    setErro(null);
    const ids = [...sel];
    try {
      for (const canal of canaisAtivos) {
        const freq = modo[canal] === 'definir' ? Math.min(90, Math.max(1, Math.floor(Number(dias[canal])))) : null;
        const res = await fetch('/api/otimizacoes/agenda', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_ids: ids, canal, frequencia_dias: freq }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        onApplied(ids, canal, freq);
      }
      onClose();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aplicar.');
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Programar vários clientes</h3>
            <p className="text-xs text-muted-foreground">
              Define a frequência de otimização de uma vez pra todos os selecionados.
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-[1fr_240px]">
          <div className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar cliente ou gestor…"
                  className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/60"
                />
              </div>
              <button
                onClick={() => setSel(new Set(visiveis.map((c) => c.id)))}
                className="whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30"
              >
                Selecionar visíveis
              </button>
              <button
                onClick={() => setSel(new Set())}
                className="whitespace-nowrap rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30"
              >
                Limpar
              </button>
            </div>
            <div className="max-h-[46vh] space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {visiveis.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
              ) : visiveis.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/20">
                  <input
                    type="checkbox"
                    checked={sel.has(c.id)}
                    onChange={() => toggle(c.id)}
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{c.gestor_name ?? 'sem gestor'}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {(['meta', 'google'] as const).map((canal) => (
              <div key={canal} className="rounded-lg border border-border bg-muted/10 p-3">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <CanalLogo canal={canal} className="h-4 w-4" /> {canalLabel(canal)}
                </span>
                <select
                  value={modo[canal]}
                  onChange={(e) => setModo((p) => ({ ...p, [canal]: e.target.value as BulkModo }))}
                  className="mt-2 h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/60"
                >
                  <option value="manter">Não alterar</option>
                  <option value="definir">Otimizar a cada…</option>
                  <option value="remover">Remover programação</option>
                </select>
                {modo[canal] === 'definir' && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    a cada
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={dias[canal]}
                      onChange={(e) => setDias((p) => ({ ...p, [canal]: e.target.value }))}
                      className="h-7 w-16 rounded border border-border bg-background px-2 text-center text-xs outline-none focus:border-primary/60"
                    />
                    dias
                  </label>
                )}
              </div>
            ))}
            {erro && (
              <p className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{erro}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {sel.size} cliente{sel.size === 1 ? '' : 's'} selecionado{sel.size === 1 ? '' : 's'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30">
              Cancelar
            </button>
            <button
              onClick={() => void aplicar()}
              disabled={!pronto || salvando}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-40"
            >
              {salvando ? 'Aplicando…' : `Aplicar a ${sel.size} cliente${sel.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de detalhe do cliente (timeline + programação) ────────────────────
function DetalheModal({ client, agenda, me, onClose, onAgendaChange, onRegistrar, registrosVersion }: {
  client: Client;
  agenda: AgendaRow[];
  me: AuthSession | null;
  onClose: () => void;
  onAgendaChange: (clientId: string, canal: string, freq: number | null) => void;
  onRegistrar: () => void;
  /** Incrementa quando um registro novo é salvo — força reload da timeline. */
  registrosVersion: number;
}) {
  const [registros, setRegistros] = useState<Registro[] | null>(null);
  const [freqDraft, setFreqDraft] = useState<Record<string, string>>({});

  const agendaCliente = useMemo(
    () => agenda.filter((a) => a.client_id === client.id),
    [agenda, client.id],
  );

  useEffect(() => {
    setFreqDraft(Object.fromEntries(agendaCliente.map((a) => [a.canal, String(a.frequencia_dias)])));
  }, [agendaCliente]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/otimizacoes?clientId=${encodeURIComponent(client.id)}`)
      .then((r) => r.json())
      .then((d: { registros?: Registro[] }) => { if (active) setRegistros(d.registros ?? []); })
      .catch(() => { if (active) setRegistros([]); });
    return () => { active = false; };
  }, [client.id, registrosVersion]);

  async function salvarFreq(canal: string) {
    const raw = (freqDraft[canal] ?? '').trim();
    const atual = agendaCliente.find((a) => a.canal === canal)?.frequencia_dias ?? null;
    const novo = raw === '' ? null : Math.min(90, Math.max(1, Math.floor(Number(raw)) || 0)) || null;
    if (novo === atual) return;
    onAgendaChange(client.id, canal, novo);
    await fetch('/api/otimizacoes/agenda', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, canal, frequencia_dias: novo }),
    }).catch(() => {});
  }

  async function excluir(r: Registro) {
    if (!window.confirm('Excluir este registro do histórico?')) return;
    const res = await fetch(`/api/otimizacoes?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => null);
    if (res?.ok) setRegistros((prev) => (prev ?? []).filter((x) => x.id !== r.id));
  }

  const podeExcluir = (r: Registro) =>
    me?.role === 'Administrador' || (!!me?.userId && r.user_id === me.userId);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <ClientAvatar clientId={client.id} name={client.name} size="md" />
            <div>
              <h3 className="text-sm font-semibold">{client.name}</h3>
              <p className="text-xs text-muted-foreground">
                Gestor: {client.gestor_name ?? 'sem gestor definido'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onRegistrar}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" /> Registrar otimização
            </button>
            <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4">
          <div className="rounded-lg border border-border bg-muted/10 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" /> Programação de otimização
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(['meta', 'google'] as const).map((canal) => (
                <label key={canal} className="flex items-center gap-2 text-xs">
                  <CanalLogo canal={canal} className="h-4 w-4" />
                  <span className="sr-only">{canalLabel(canal)}</span>
                  a cada
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={freqDraft[canal] ?? ''}
                    onChange={(e) => setFreqDraft((p) => ({ ...p, [canal]: e.target.value }))}
                    onBlur={() => void salvarFreq(canal)}
                    placeholder="—"
                    className="h-7 w-14 rounded border border-border bg-background px-2 text-center text-xs outline-none focus:border-primary/60"
                  />
                  dias
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Sem valor = canal sem programação. Sem programação nenhuma, vale a régua padrão de {FREQ_PADRAO_DIAS} dias
              sobre o último registro de qualquer canal.
            </p>
          </div>

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <History className="h-3.5 w-3.5" /> Histórico
              {registros && <span className="text-muted-foreground/70">({registros.length})</span>}
            </div>
            {registros === null ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Carregando…</p>
            ) : registros.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                Nenhuma otimização registrada ainda — clique em “Registrar otimização” depois de mexer na conta.
              </p>
            ) : (
              <div className="space-y-2">
                {registros.map((r) => (
                  <div key={r.id} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex items-center gap-1.5" title={canalLabel(r.canal, r.canal_detalhe)}>
                          <CanalLogo canal={r.canal} className="h-4 w-4" />
                          {r.canal === 'outro' && (
                            <span className="text-[11px] text-muted-foreground">{canalLabel(r.canal, r.canal_detalhe)}</span>
                          )}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {fmtDataHora.format(new Date(r.created_at))} · {r.user_name ?? 'autor desconhecido'}
                        </span>
                        {r.origem === 'audio' && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground" title="Registrado por voz (transcrição)">
                            <Mic className="h-3 w-3" /> voz
                          </span>
                        )}
                      </div>
                      {podeExcluir(r) && (
                        <button
                          onClick={() => void excluir(r)}
                          className="rounded p-1 text-muted-foreground/60 hover:bg-red-500/10 hover:text-red-300"
                          title="Excluir registro"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {r.acoes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.acoes.map((a) => (
                          <span key={a} className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {acaoLabel(a)}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{r.descricao}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────
export default function OtimizacoesPage() {
  const { clients } = useClients();
  const [me, setMe] = useState<AuthSession | null>(null);
  const [ultimas, setUltimas] = useState<UltimaPorCanal[]>([]);
  const [agenda, setAgenda] = useState<AgendaRow[]>([]);
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);

  const [escopo, setEscopo] = useState<'meus' | 'todos' | null>(null);
  const [busca, setBusca] = useState('');
  const [estadoFiltro, setEstadoFiltro] = useState<'todos' | EstadoOtimizacao>('todos');

  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [registroPara, setRegistroPara] = useState<string | null>(null);
  const [registrosVersion, setRegistrosVersion] = useState(0);
  const [bulkAberto, setBulkAberto] = useState(false);

  useEffect(() => { setMe(getAuthSession()); }, []);

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch('/api/otimizacoes/overview');
      if (!res.ok) return;
      const data = await res.json() as {
        ultimas?: UltimaPorCanal[]; agenda?: AgendaRow[];
        contagens?: { client_id: string; total: number }[];
      };
      setUltimas(data.ultimas ?? []);
      setAgenda(data.agenda ?? []);
      setContagens(Object.fromEntries((data.contagens ?? []).map((c) => [c.client_id, c.total])));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  // Escopo padrão: "meus" quando o gestor tem clientes atribuídos; quem não tem
  // carteira própria (ou admin sem vínculo) cai em "todos" pra não abrir vazio.
  useEffect(() => {
    if (escopo !== null || clients.length === 0 || !me) return;
    const salvo = window.localStorage.getItem('otimizacoes:escopo');
    if (salvo === 'meus' || salvo === 'todos') { setEscopo(salvo); return; }
    setEscopo(clients.some((c) => c.gestor_id === me.userId) ? 'meus' : 'todos');
  }, [escopo, clients, me]);

  function mudarEscopo(novo: 'meus' | 'todos') {
    setEscopo(novo);
    window.localStorage.setItem('otimizacoes:escopo', novo);
  }

  const linhas = useMemo<Linha[]>(() => {
    const agora = new Date();
    const ordemCanal = (c: string) => (c === 'meta' ? 0 : c === 'google' ? 1 : 2);
    return clients.map((client) => {
      const ags = agenda.filter((a) => a.client_id === client.id);
      const ults = ultimas.filter((u) => u.client_id === client.id);
      const canaisIds = [...new Set([...ags.map((a) => a.canal), ...ults.map((u) => u.canal)])]
        .sort((a, b) => ordemCanal(a) - ordemCanal(b));

      const canais: CanalStatus[] = canaisIds.map((canal) => {
        const ag = ags.find((a) => a.canal === canal) ?? null;
        const ult = ults.find((u) => u.canal === canal) ?? null;
        return {
          canal,
          freq: ag?.frequencia_dias ?? null,
          ultima: ult,
          status: ag ? statusOtimizacao(ult?.created_at ?? null, ag.frequencia_dias, agora) : null,
        };
      });

      const ultimaGeral = ults.reduce<UltimaPorCanal | null>(
        (best, u) => (!best || u.created_at > best.created_at ? u : best), null,
      );

      const programados = canais.filter((k): k is CanalStatus & { status: StatusOtimizacao } => k.status !== null);
      let estado: EstadoOtimizacao;
      let diasAtraso = 0;
      if (programados.length > 0) {
        estado = piorEstado(programados.map((k) => k.status.estado));
        diasAtraso = Math.max(...programados.map((k) => k.status.diasAtraso));
      } else {
        const st = statusOtimizacao(ultimaGeral?.created_at ?? null, FREQ_PADRAO_DIAS, agora);
        estado = st.estado;
        diasAtraso = st.diasAtraso;
      }

      return {
        client, canais, estado, diasAtraso, ultimaGeral,
        total: contagens[client.id] ?? 0,
        semProgramacao: ags.length === 0,
      };
    });
  }, [clients, agenda, ultimas, contagens]);

  const linhasEscopo = useMemo(() => {
    let list = linhas;
    if (escopo === 'meus' && me) list = list.filter((l) => l.client.gestor_id === me.userId);
    const q = busca.trim().toLowerCase();
    if (q) {
      list = list.filter((l) =>
        l.client.name.toLowerCase().includes(q) ||
        (l.client.gestor_name ?? '').toLowerCase().includes(q));
    }
    return [...list].sort((a, b) =>
      PESO_ESTADO[b.estado] - PESO_ESTADO[a.estado] ||
      b.diasAtraso - a.diasAtraso ||
      a.client.name.localeCompare(b.client.name));
  }, [linhas, escopo, me, busca]);

  const porEstado = useMemo(() => {
    const c: Record<EstadoOtimizacao, number> = { atrasado: 0, sem_registro: 0, vence_hoje: 0, em_dia: 0 };
    for (const l of linhasEscopo) c[l.estado]++;
    return c;
  }, [linhasEscopo]);

  const visiveis = estadoFiltro === 'todos'
    ? linhasEscopo
    : linhasEscopo.filter((l) => l.estado === estadoFiltro);

  const detalheClient = detalheId ? clients.find((c) => c.id === detalheId) ?? null : null;
  const registroClient = registroPara ? clients.find((c) => c.id === registroPara) ?? null : null;

  function aplicarAgendaLocal(clientId: string, canal: string, freq: number | null) {
    setAgenda((prev) => {
      const sem = prev.filter((a) => !(a.client_id === clientId && a.canal === canal));
      return freq ? [...sem, { client_id: clientId, canal, frequencia_dias: freq }] : sem;
    });
  }

  function registroSalvo(r: Registro) {
    setRegistroPara(null);
    setRegistrosVersion((v) => v + 1);
    // Atualiza a última do canal na hora, sem esperar o refetch.
    setUltimas((prev) => {
      const sem = prev.filter((u) => !(u.client_id === r.client_id && u.canal === r.canal));
      return [...sem, {
        client_id: r.client_id, canal: r.canal, canal_detalhe: r.canal_detalhe,
        user_name: r.user_name, acoes: r.acoes, resumo: r.descricao.slice(0, 220),
        created_at: r.created_at,
      }];
    });
    setContagens((prev) => ({ ...prev, [r.client_id]: (prev[r.client_id] ?? 0) + 1 }));
    void loadOverview();
  }

  const FILTROS: { id: 'todos' | EstadoOtimizacao; label: string; count?: number }[] = [
    { id: 'todos',        label: 'Todas',            count: linhasEscopo.length },
    { id: 'atrasado',     label: 'Atrasadas',        count: porEstado.atrasado },
    { id: 'sem_registro', label: 'Sem registro',     count: porEstado.sem_registro },
    { id: 'vence_hoje',   label: 'Vencem hoje',      count: porEstado.vence_hoje },
    { id: 'em_dia',       label: 'Em dia',           count: porEstado.em_dia },
  ];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bebas text-3xl uppercase tracking-wide">Histórico</h1>
          <p className="text-sm text-muted-foreground">
            O que foi feito em cada conta, por quem, em qual canal — e a programação de quando otimizar de novo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setBulkAberto(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        >
          <CalendarClock className="h-3.5 w-3.5" /> Programar vários
        </button>
        <div className="flex overflow-hidden rounded-lg border border-border">
          <button
            onClick={() => mudarEscopo('meus')}
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
              escopo === 'meus' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30')}
          >
            Meus clientes
          </button>
          <button
            onClick={() => mudarEscopo('todos')}
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
              escopo === 'todos' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/30')}
          >
            Todos
          </button>
        </div>
        </div>
      </div>

      {porEstado.atrasado > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {porEstado.atrasado === 1
            ? '1 conta passou do prazo de otimização sem registro.'
            : `${porEstado.atrasado} contas passaram do prazo de otimização sem registro.`}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar cliente ou gestor…"
            className="h-8 w-56 rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary/60"
          />
        </div>
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setEstadoFiltro(f.id)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors',
              estadoFiltro === f.id
                ? 'border-primary/60 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-muted/30',
            )}
          >
            {f.label} <span className="opacity-70">({f.count})</span>
          </button>
        ))}
      </div>

      {carregando && clients.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : visiveis.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {escopo === 'meus'
            ? 'Nenhum cliente seu neste filtro — confira em "Todos" ou peça pra atribuir os clientes a você em Clientes.'
            : 'Nenhum cliente neste filtro.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visiveis.map((l) => {
            const st = ESTADO_STYLE[l.estado];
            return (
              <div
                key={l.client.id}
                role="button"
                tabIndex={0}
                onClick={() => setDetalheId(l.client.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setDetalheId(l.client.id); }}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border border-l-4 border-border bg-card p-3 transition-colors hover:bg-muted/10',
                  st.border,
                )}
              >
                <ClientAvatar clientId={l.client.id} name={l.client.name} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="text-sm font-semibold">{l.client.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {l.client.gestor_name ?? 'sem gestor'}
                      {l.total > 0 && ` · ${l.total} registro${l.total > 1 ? 's' : ''}`}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.ultimaGeral
                      ? <>Última {haDias(l.ultimaGeral.created_at)}
                          {l.ultimaGeral.user_name ? ` por ${l.ultimaGeral.user_name}` : ''}
                          {' · '}
                          <CanalLogo canal={l.ultimaGeral.canal} className="inline-block h-3 w-3 align-[-2px]" />
                          {l.ultimaGeral.canal === 'outro' ? ` ${canalLabel(l.ultimaGeral.canal, l.ultimaGeral.canal_detalhe)}` : ''}
                          {l.ultimaGeral.resumo ? ` — ${l.ultimaGeral.resumo}` : ''}</>
                      : 'Nenhuma otimização registrada ainda.'}
                  </p>
                </div>

                <div className="hidden items-center gap-1.5 md:flex">
                  {l.canais.map((k) => {
                    const cor = k.status ? ESTADO_STYLE[k.status.estado].badge : 'bg-muted/30 border-border text-muted-foreground';
                    return (
                      <span key={k.canal} className={cn('flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]', cor)}
                        title={`${canalLabel(k.canal, k.ultima?.canal_detalhe)} — ${k.freq ? `programado a cada ${k.freq} dias` : 'sem programação neste canal'}`}>
                        <CanalLogo canal={k.canal} className="h-3 w-3" /> {haDias(k.ultima?.created_at ?? null)}
                      </span>
                    );
                  })}
                  {l.semProgramacao && (
                    <span className="text-[10px] text-muted-foreground/60" title={`Sem programação — régua padrão de ${FREQ_PADRAO_DIAS} dias`}>
                      régua {FREQ_PADRAO_DIAS}d
                    </span>
                  )}
                </div>

                <span className={cn('shrink-0 rounded border px-2 py-0.5 text-[11px] font-medium', st.badge)}>
                  {l.estado === 'em_dia' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                  {estadoBadgeText(l.estado, l.diasAtraso)}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); setRegistroPara(l.client.id); }}
                  className="hidden shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/30 hover:text-foreground sm:flex"
                >
                  <Plus className="h-3 w-3" /> Registrar
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
              </div>
            );
          })}
        </div>
      )}

      {detalheClient && (
        <DetalheModal
          client={detalheClient}
          agenda={agenda}
          me={me}
          onClose={() => setDetalheId(null)}
          onAgendaChange={aplicarAgendaLocal}
          onRegistrar={() => setRegistroPara(detalheClient.id)}
          registrosVersion={registrosVersion}
        />
      )}
      {registroClient && (
        <RegistroModal
          client={registroClient}
          onClose={() => setRegistroPara(null)}
          onSaved={registroSalvo}
        />
      )}
      {bulkAberto && (
        <BulkAgendaModal
          clients={clients}
          onClose={() => setBulkAberto(false)}
          onApplied={(ids, canal, freq) => {
            for (const id of ids) aplicarAgendaLocal(id, canal, freq);
            void loadOverview();
          }}
        />
      )}
    </div>
  );
}
