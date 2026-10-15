'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Phone, PhoneMissed, Voicemail, Ban, Check, SkipForward, Plus, MessageCircle,
  Trash2, Archive, ArchiveRestore, Clock, RotateCcw, Search, ListChecks, ChevronRight,
} from 'lucide-react';
import { useClients } from '@/lib/client-store';
import { cn } from '@/lib/utils';
import { notificar } from '@/components/ui/toast';
import { DictateButton } from '@/components/ui/dictate-button';
import {
  formatarTelefone, telHref, whatsappHref, ROTULO_RESULTADO, ROTULO_INTERESSE, MAX_TENTATIVAS,
  type Contato, type Contadores, type Resultado, type Interesse,
} from '@/lib/discador';
import { ImportarLista } from './importar-lista';

/**
 * Discador — a pessoa só faz duas coisas: LIGAR e dizer COMO FOI. O resto
 * (quem é o próximo, quantas vezes já tentou, levar para o CRM) é do sistema.
 * Pensado para teclado no Mac (1–4 = resultado, L = ligar, P = pular) e para
 * o polegar no iPhone (botões grandes, uma coluna).
 */

type Lista = {
  id: string; nome: string; client_id: string | null; client_name: string | null; arquivada: boolean;
  created_at: string; total: number; fila: number; ligados: number; atenderam: number; leads: number;
};
type Chamada = {
  id: string; contato_id: string; resultado: Resultado; interesse: Interesse | null; observacao: string | null;
  registrada_at: string; empresa: string | null; nome_contato: string | null; telefone: string; lead_id: string | null;
};
type Motivo = 'retorno' | 'fila' | 'nova_tentativa' | null;
type Detalhe = {
  lista: Lista; contadores: Contadores; proximo: Contato | null; motivo: Motivo;
  pendentes: { agora: number; depois: number }; historico: Chamada[];
};

const CHAVE_ULTIMA = 'discador-lista';

const RESULTADO_UI: Array<{ k: Resultado; tecla: string; icone: React.ElementType; classe: string }> = [
  { k: 'nao_atendeu', tecla: '1', icone: PhoneMissed, classe: 'border-border hover:border-amber-400/60 hover:bg-amber-400/10' },
  { k: 'caixa_postal', tecla: '2', icone: Voicemail, classe: 'border-border hover:border-sky-400/60 hover:bg-sky-400/10' },
  { k: 'numero_errado', tecla: '3', icone: Ban, classe: 'border-border hover:border-red-400/60 hover:bg-red-400/10' },
  { k: 'atendeu', tecla: '4', icone: Check, classe: 'border-primary/70 bg-primary/10 text-primary hover:bg-primary/20' },
];

const STATUS_CHIP: Record<Contato['status'], { rotulo: string; classe: string }> = {
  fila: { rotulo: 'Na fila', classe: 'bg-muted text-muted-foreground' },
  nao_atendeu: { rotulo: 'Não atendeu', classe: 'bg-amber-400/15 text-amber-300' },
  caixa_postal: { rotulo: 'Caixa postal', classe: 'bg-sky-400/15 text-sky-300' },
  numero_errado: { rotulo: 'Número errado', classe: 'bg-red-400/15 text-red-300' },
  atendeu: { rotulo: 'Atendeu', classe: 'bg-primary/15 text-primary' },
  retornar: { rotulo: 'Retornar', classe: 'bg-violet-400/15 text-violet-300' },
};

const FILTROS_TABELA: Array<{ k: string; rotulo: string }> = [
  { k: 'fila', rotulo: 'Na fila' },
  { k: 'atenderam', rotulo: 'Atenderam' },
  { k: 'sem_resposta', rotulo: 'Sem resposta' },
  { k: 'numero_errado', rotulo: 'Número errado' },
  { k: 'leads', rotulo: 'Leads' },
  { k: 'todos', rotulo: 'Todos' },
];

function quando(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function emInput(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Valor padrão do "retornar em": amanhã às 9h, no formato do datetime-local. */
function amanha9h() {
  const d = new Date();
  d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DiscadorPage() {
  const { clients } = useClients();
  const [listas, setListas] = useState<Lista[]>([]);
  const [listaId, setListaId] = useState<string>('');
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [atual, setAtual] = useState<Contato | null>(null);
  const [motivo, setMotivo] = useState<Motivo>(null);
  const [ligadoEm, setLigadoEm] = useState<number | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [salvando, setSalvando] = useState(false);
  const [painelAtendeu, setPainelAtendeu] = useState(false);
  const [form, setForm] = useState({ nome_contato: '', interesse: 'proposta' as Interesse, observacao: '', retornar_em: amanha9h(), criar_lead: true });
  const [showImport, setShowImport] = useState(false);
  const [mostrarArquivadas, setMostrarArquivadas] = useState(false);
  const [filtro, setFiltro] = useState('fila');
  const [busca, setBusca] = useState('');
  const [tabela, setTabela] = useState<Contato[]>([]);
  const [carregandoTabela, setCarregandoTabela] = useState(false);
  const nomeRef = useRef<HTMLInputElement>(null);

  // ── carga ───────────────────────────────────────────────────────────────
  const carregarListas = useCallback(async () => {
    try {
      const res = await fetch('/api/discador/listas');
      if (!res.ok) throw new Error();
      const data = await res.json() as Lista[];
      setListas(data);
      return data;
    } catch {
      notificar('Não foi possível carregar as listas.', 'erro');
      return [] as Lista[];
    }
  }, []);

  const carregarDetalhe = useCallback(async (id: string, opts?: { manterAtual?: boolean }) => {
    try {
      const res = await fetch(`/api/discador/listas/${id}`);
      if (!res.ok) throw new Error();
      const d = await res.json() as Detalhe;
      setDetalhe(d);
      if (!opts?.manterAtual) { setAtual(d.proximo); setMotivo(d.motivo); setLigadoEm(null); setPainelAtendeu(false); }
    } catch {
      notificar('Não foi possível abrir a lista.', 'erro');
    }
  }, []);

  const carregarTabela = useCallback(async (id: string, f: string, q: string) => {
    setCarregandoTabela(true);
    try {
      const sp = new URLSearchParams({ filtro: f });
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/discador/listas/${id}/contatos?${sp}`);
      setTabela(res.ok ? await res.json() as Contato[] : []);
    } finally {
      setCarregandoTabela(false);
    }
  }, []);

  // Abre a última lista usada (ou a da URL). O setTimeout é só para a carga
  // inicial não disparar setState dentro do próprio efeito.
  const inicializar = useCallback(async () => {
    const data = await carregarListas();
    const daUrl = new URLSearchParams(window.location.search).get('lista');
    const lembrada = localStorage.getItem(CHAVE_ULTIMA);
    const alvo = [daUrl, lembrada].find(x => x && data.some(l => l.id === x)) ?? data.find(l => !l.arquivada)?.id ?? '';
    if (alvo) setListaId(alvo);
  }, [carregarListas]);

  useEffect(() => {
    const t = setTimeout(() => { void inicializar(); }, 0);
    return () => clearTimeout(t);
  }, [inicializar]);

  useEffect(() => {
    if (!listaId) return;
    localStorage.setItem(CHAVE_ULTIMA, listaId);
    const url = new URL(window.location.href); url.searchParams.set('lista', listaId);
    window.history.replaceState(null, '', url.toString());
    const t = setTimeout(() => { void carregarDetalhe(listaId); }, 0);
    return () => clearTimeout(t);
  }, [listaId, carregarDetalhe]);

  useEffect(() => {
    if (!listaId) return;
    const t = setTimeout(() => void carregarTabela(listaId, filtro, busca), busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [listaId, filtro, busca, carregarTabela]);

  // relógio do "ligando há"
  useEffect(() => {
    if (!ligadoEm) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ligadoEm]);

  // ── ações ───────────────────────────────────────────────────────────────
  const ligar = useCallback(() => {
    if (!atual) return;
    setLigadoEm(Date.now());
    window.location.href = telHref(atual.telefone);
  }, [atual]);

  const registrar = useCallback(async (resultado: Resultado, extra?: Partial<typeof form>) => {
    if (!atual || salvando) return;
    setSalvando(true);
    try {
      const f = { ...form, ...extra };
      const res = await fetch(`/api/discador/contatos/${atual.id}/resultado`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultado,
          iniciada_at: ligadoEm ? new Date(ligadoEm).toISOString() : null,
          ...(resultado === 'atendeu' ? {
            nome_contato: f.nome_contato, interesse: f.interesse, observacao: f.observacao,
            retornar_em: f.interesse === 'retornar' ? new Date(f.retornar_em).toISOString() : null,
            criar_lead: f.criar_lead,
          } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as Partial<Detalhe> & { error?: string; lead_id?: string | null; crm_erro?: string | null };
      if (!res.ok) { notificar(data.error ?? 'Não foi possível registrar.', 'erro'); return; }
      if (data.crm_erro) notificar(data.crm_erro, 'aviso');
      else if (resultado === 'atendeu' && f.criar_lead && data.lead_id && !atual.lead_id) notificar('Lead criado no CRM.', 'ok');
      setAtual(data.proximo ?? null);
      setMotivo(data.motivo ?? null);
      setLigadoEm(null);
      setPainelAtendeu(false);
      setForm({ nome_contato: '', interesse: 'proposta', observacao: '', retornar_em: amanha9h(), criar_lead: true });
      setDetalhe(prev => prev ? { ...prev, contadores: data.contadores ?? prev.contadores, pendentes: data.pendentes ?? prev.pendentes } : prev);
      void carregarDetalhe(listaId, { manterAtual: true });
      void carregarTabela(listaId, filtro, busca);
      void carregarListas();
    } catch {
      notificar('Falha de rede ao registrar.', 'erro');
    } finally {
      setSalvando(false);
    }
  }, [atual, salvando, form, ligadoEm, listaId, filtro, busca, carregarDetalhe, carregarTabela, carregarListas]);

  const pular = useCallback(async () => {
    if (!atual) return;
    await fetch(`/api/discador/contatos/${atual.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'pular' }) });
    void carregarDetalhe(listaId);
  }, [atual, listaId, carregarDetalhe]);

  async function ligarPara(c: Contato) {
    setAtual(c); setMotivo(null); setLigadoEm(null); setPainelAtendeu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function voltarParaFila(c: Contato) {
    const res = await fetch(`/api/discador/contatos/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'voltar_fila' }) });
    if (!res.ok) { notificar('Não foi possível devolver para a fila.', 'erro'); return; }
    void carregarTabela(listaId, filtro, busca);
    // Se o devolvido é o que está na tela, recarrega o card (o chip de "nova tentativa" ficaria velho).
    void carregarDetalhe(listaId, { manterAtual: !!atual && atual.id !== c.id });
  }

  function selecionarLista(id: string) {
    setListaId(id);
    if (!id) { setDetalhe(null); setAtual(null); setMotivo(null); setTabela([]); }
  }

  async function arquivar(l: Lista, arquivada: boolean) {
    await fetch(`/api/discador/listas/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ arquivada }) });
    const data = await carregarListas();
    if (arquivada && listaId === l.id) selecionarLista(data.find(x => !x.arquivada)?.id ?? '');
  }

  async function apagar(l: Lista) {
    if (!window.confirm(`Apagar a lista "${l.nome}" e seus ${l.total} contatos? Os leads que já foram para o CRM continuam lá.`)) return;
    const res = await fetch(`/api/discador/listas/${l.id}`, { method: 'DELETE' });
    if (!res.ok) { notificar('Não foi possível apagar.', 'erro'); return; }
    const data = await carregarListas();
    if (listaId === l.id) selecionarLista(data.find(x => !x.arquivada)?.id ?? '');
  }

  async function trocarCliente(clientId: string) {
    if (!detalhe) return;
    const res = await fetch(`/api/discador/listas/${detalhe.lista.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId || null }) });
    if (!res.ok) { notificar('Não foi possível trocar o cliente.', 'erro'); return; }
    void carregarDetalhe(listaId, { manterAtual: true });
    void carregarListas();
  }

  // ── teclado ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showImport || !atual || e.metaKey || e.ctrlKey || e.altKey) return;
      if (painelAtendeu) {
        if (e.key === 'Escape') { setPainelAtendeu(false); return; }
        if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void registrar('atendeu'); }
        return;
      }
      if (emInput(e.target)) return;
      const r = RESULTADO_UI.find(x => x.tecla === e.key);
      if (r) { e.preventDefault(); if (r.k === 'atendeu') abrirAtendeu(); else void registrar(r.k); return; }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); ligar(); }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); void pular(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImport, atual, painelAtendeu, registrar, ligar, pular]);

  function abrirAtendeu() {
    setForm(f => ({ ...f, nome_contato: atual?.nome_contato ?? '', criar_lead: !!detalhe?.lista.client_id }));
    setPainelAtendeu(true);
    setTimeout(() => nomeRef.current?.focus(), 30);
  }

  // ── derivados ───────────────────────────────────────────────────────────
  const listasVisiveis = useMemo(() => listas.filter(l => mostrarArquivadas || !l.arquivada), [listas, mostrarArquivadas]);
  const temArquivadas = listas.some(l => l.arquivada);
  const c = detalhe?.contadores;
  const progresso = c && c.total ? Math.round((c.ligados / c.total) * 100) : 0;
  const segundos = ligadoEm ? Math.max(0, Math.floor((agora - ligadoEm) / 1000)) : 0;
  const rotuloMotivo = motivo === 'retorno' ? 'Retorno combinado' : motivo === 'nova_tentativa' ? `Nova tentativa (${(atual?.tentativas ?? 0) + 1}ª de ${MAX_TENTATIVAS})` : motivo === 'fila' ? 'Próximo da fila' : atual ? 'Escolhido na tabela' : '';

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Discador</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Ligue um a um pela lista, anote como foi e quem atendeu já vira lead no CRM.
          </p>
        </div>
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-bold text-black shadow-[0_0_16px_rgba(85,245,47,0.35)] transition-colors hover:bg-[var(--primary-dark)]"
        >
          <Plus className="h-4 w-4" /> Nova lista
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Listas */}
        <aside className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Listas</p>
            {temArquivadas && (
              <button onClick={() => setMostrarArquivadas(v => !v)} className="text-[11px] text-muted-foreground hover:text-foreground">
                {mostrarArquivadas ? 'ocultar arquivadas' : 'ver arquivadas'}
              </button>
            )}
          </div>
          {listasVisiveis.length === 0 && (
            <div className="rounded-[var(--radius)] border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Nenhuma lista ainda. Clique em <strong className="text-foreground">Nova lista</strong> e importe a planilha.
            </div>
          )}
          <div className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
            {listasVisiveis.map(l => {
              const ativa = l.id === listaId;
              const pct = l.total ? Math.round((l.ligados / l.total) * 100) : 0;
              return (
                <button
                  key={l.id}
                  onClick={() => setListaId(l.id)}
                  className={cn(
                    'w-56 shrink-0 rounded-[var(--radius)] border p-3 text-left transition-colors lg:w-full',
                    ativa ? 'border-primary/60 bg-primary/5' : 'border-border bg-card hover:border-hairline-strong',
                    l.arquivada && 'opacity-60',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{l.nome}</p>
                    {l.arquivada && <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{l.client_name ?? 'sem CRM'} · {new Date(l.created_at).toLocaleDateString('pt-BR')}</p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-border">
                    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                    <span>{l.ligados}/{l.total} ligados</span>
                    <span><span className="text-primary">{l.atenderam}</span> atend. · {l.leads} leads</span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Área de discagem */}
        <section className="min-w-0 space-y-4">
          {detalhe && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{detalhe.lista.nome}</p>
                <p className="text-[11px] text-muted-foreground">
                  {c?.ligados} de {c?.total} ligados ({progresso}%) · <span className="text-primary">{c?.atenderam} atenderam</span> · {c?.leads} leads
                  {detalhe.pendentes.depois > 0 && <> · {detalhe.pendentes.depois} voltam mais tarde</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  CRM:
                  <select value={detalhe.lista.client_id ?? ''} onChange={e => void trocarCliente(e.target.value)}
                    className="max-w-[160px] rounded-[var(--radius)] border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary">
                    <option value="">não mandar</option>
                    {clients.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                  </select>
                </label>
                <button onClick={() => void arquivar(detalhe.lista, !detalhe.lista.arquivada)} title={detalhe.lista.arquivada ? 'Desarquivar' : 'Arquivar'}
                  className="rounded-[var(--radius)] border border-border p-1.5 text-muted-foreground hover:text-foreground">
                  {detalhe.lista.arquivada ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </button>
                <button onClick={() => void apagar(detalhe.lista)} title="Apagar lista"
                  className="rounded-[var(--radius)] border border-border p-1.5 text-muted-foreground hover:border-red-400/60 hover:text-red-300">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Card do contato */}
          {atual ? (
            <div className="rounded-[var(--radius)] border border-border bg-card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                  motivo === 'retorno' ? 'bg-violet-400/15 text-violet-300' : motivo === 'nova_tentativa' ? 'bg-amber-400/15 text-amber-300' : 'bg-muted text-muted-foreground')}>
                  {rotuloMotivo}
                </span>
                {atual.tentativas > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {atual.tentativas} {atual.tentativas === 1 ? 'tentativa' : 'tentativas'} · última {quando(atual.ultima_tentativa_at)}
                  </span>
                )}
              </div>

              <h2 className="mt-3 break-words font-heading text-4xl leading-none tracking-wide sm:text-5xl">
                {atual.empresa || formatarTelefone(atual.telefone)}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {[atual.nome_contato, atual.segmento, atual.cidade].filter(Boolean).join(' · ') || ' '}
              </p>

              <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-heading text-3xl tracking-wider">{formatarTelefone(atual.telefone)}</span>
                {atual.telefone2 && (
                  <a href={telHref(atual.telefone2)} onClick={() => setLigadoEm(Date.now())} className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    ou {formatarTelefone(atual.telefone2)}
                  </a>
                )}
              </div>

              {(atual.observacao || atual.email) && (
                <div className="mt-3 space-y-1 rounded-[var(--radius)] bg-background/60 p-3 text-xs">
                  {atual.email && <p className="text-muted-foreground">{atual.email}</p>}
                  {atual.observacao && <p className="whitespace-pre-line">{atual.observacao}</p>}
                </div>
              )}

              {/* Ligar */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <a
                  href={telHref(atual.telefone)}
                  onClick={() => setLigadoEm(Date.now())}
                  className="flex h-14 flex-1 items-center justify-center gap-2 rounded-[var(--radius)] bg-primary px-6 text-lg font-bold text-black shadow-[0_0_18px_rgba(85,245,47,0.35)] transition-colors hover:bg-[var(--primary-dark)] sm:flex-none sm:min-w-[220px]"
                >
                  <Phone className="h-5 w-5" /> {ligadoEm ? `Ligando há ${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}` : 'Ligar'}
                  <kbd className="ml-1 hidden rounded border border-black/30 px-1 text-[10px] font-semibold sm:inline">L</kbd>
                </a>
                <a href={whatsappHref(atual.telefone)} target="_blank" rel="noreferrer" title="Abrir WhatsApp"
                  className="flex h-14 items-center gap-1.5 rounded-[var(--radius)] border border-border px-4 text-sm font-semibold text-muted-foreground hover:border-emerald-400/60 hover:text-emerald-300">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
                <button onClick={() => void pular()} title="Pular (vai para o fim da fila)"
                  className="flex h-14 items-center gap-1.5 rounded-[var(--radius)] border border-border px-4 text-sm font-semibold text-muted-foreground hover:text-foreground">
                  <SkipForward className="h-4 w-4" /> Pular <kbd className="hidden rounded border border-border px-1 text-[10px] sm:inline">P</kbd>
                </button>
              </div>

              {/* Resultado */}
              {!painelAtendeu ? (
                <div className="mt-5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Como foi?</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {RESULTADO_UI.map(r => (
                      <button
                        key={r.k}
                        disabled={salvando}
                        onClick={() => (r.k === 'atendeu' ? abrirAtendeu() : void registrar(r.k))}
                        className={cn('flex h-16 flex-col items-center justify-center gap-1 rounded-[var(--radius)] border text-sm font-semibold transition-colors disabled:opacity-40', r.classe)}
                      >
                        <span className="flex items-center gap-1.5"><r.icone className="h-4 w-4" /> {ROTULO_RESULTADO[r.k]}</span>
                        <kbd className="hidden rounded border border-current/30 px-1 text-[10px] opacity-70 sm:inline">{r.tecla}</kbd>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-5 space-y-3 rounded-[var(--radius)] border border-primary/40 bg-primary/5 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Atendeu — e aí?</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Quem atendeu</label>
                      <input ref={nomeRef} value={form.nome_contato} onChange={e => setForm(f => ({ ...f, nome_contato: e.target.value }))}
                        placeholder="Nome (opcional)"
                        className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Interesse</label>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(Object.keys(ROTULO_INTERESSE) as Interesse[]).map(k => (
                          <button key={k} type="button" onClick={() => setForm(f => ({ ...f, interesse: k, criar_lead: k === 'sem_interesse' ? false : !!detalhe?.lista.client_id }))}
                            className={cn('rounded-[var(--radius)] border px-2 py-1.5 text-xs font-semibold',
                              form.interesse === k ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground')}>
                            {ROTULO_INTERESSE[k]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {form.interesse === 'retornar' && (
                    <div>
                      <label className="mb-1 block text-[11px] text-muted-foreground">Retornar em</label>
                      <input type="datetime-local" value={form.retornar_em} onChange={e => setForm(f => ({ ...f, retornar_em: e.target.value }))}
                        className="rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                      <p className="mt-1 text-[11px] text-muted-foreground">Na hora marcada ele volta para o topo da fila.</p>
                    </div>
                  )}
                  <div>
                    <label className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Observação</span>
                      <DictateButton onTranscript={t => setForm(f => ({ ...f, observacao: (f.observacao ? `${f.observacao} ` : '') + t }))} />
                    </label>
                    <textarea value={form.observacao} onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))} rows={2}
                      placeholder="O que a pessoa disse, o que ficou combinado…"
                      className="w-full rounded-[var(--radius)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <label className={cn('flex items-center gap-2 text-sm', !detalhe?.lista.client_id && 'text-muted-foreground')}>
                    <input type="checkbox" checked={form.criar_lead && !!detalhe?.lista.client_id} disabled={!detalhe?.lista.client_id}
                      onChange={e => setForm(f => ({ ...f, criar_lead: e.target.checked }))} className="accent-[var(--primary)]" />
                    {detalhe?.lista.client_id
                      ? <>Criar lead no CRM de <strong>{detalhe.lista.client_name}</strong>{atual.lead_id ? ' (já existe — a conversa entra no lead)' : ''}</>
                      : 'Escolha um cliente do CRM na lista para criar o lead'}
                  </label>
                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    <button onClick={() => setPainelAtendeu(false)} className="rounded-[var(--radius)] px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancelar <kbd className="ml-1 hidden rounded border border-border px-1 text-[10px] sm:inline">Esc</kbd></button>
                    <button onClick={() => void registrar('atendeu')} disabled={salvando}
                      className="flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-bold text-black hover:bg-[var(--primary-dark)] disabled:opacity-40">
                      <Check className="h-4 w-4" /> {salvando ? 'Salvando…' : 'Salvar e próximo'} <kbd className="ml-1 hidden rounded border border-black/30 px-1 text-[10px] sm:inline">↵</kbd>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : detalhe ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-8 text-center">
              <ListChecks className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-heading text-3xl tracking-wide">Fila vazia por agora</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {c?.ligados} ligados, <span className="text-primary">{c?.atenderam} atenderam</span>, {c?.leads} leads no CRM.
                {detalhe.pendentes.depois > 0 && <> {detalhe.pendentes.depois} {detalhe.pendentes.depois === 1 ? 'contato volta' : 'contatos voltam'} mais tarde (retorno combinado ou nova tentativa em outro horário).</>}
              </p>
              <button onClick={() => void carregarDetalhe(listaId)} className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Conferir de novo
              </button>
            </div>
          ) : listas.length === 0 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border bg-card p-8 text-center">
              <Phone className="mx-auto h-8 w-8 text-primary" />
              <p className="mt-3 font-heading text-3xl tracking-wide">Comece por uma lista</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Exporte a planilha do ON Prospecção (ou cole os telefones) e a fila fica pronta. No Mac, o botão Ligar disca pelo iPhone; no celular, disca direto.
              </p>
              <button onClick={() => setShowImport(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 py-2 text-sm font-bold text-black hover:bg-[var(--primary-dark)]">
                <Plus className="h-4 w-4" /> Nova lista
              </button>
            </div>
          ) : null}

          {/* Histórico recente */}
          {detalhe && detalhe.historico.length > 0 && (
            <div className="rounded-[var(--radius)] border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Últimas ligações</p>
              </div>
              <ul className="divide-y divide-border/60">
                {detalhe.historico.map(h => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
                    <span className="w-12 shrink-0 text-muted-foreground">{quando(h.registrada_at)}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase',
                      h.resultado === 'atendeu' ? 'bg-primary/15 text-primary' : h.resultado === 'numero_errado' ? 'bg-red-400/15 text-red-300' : 'bg-muted text-muted-foreground')}>
                      {ROTULO_RESULTADO[h.resultado]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{h.empresa || formatarTelefone(h.telefone)}{h.nome_contato ? <span className="font-normal text-muted-foreground"> · {h.nome_contato}</span> : null}</span>
                    {h.interesse && <span className="text-muted-foreground">{ROTULO_INTERESSE[h.interesse]}</span>}
                    {h.lead_id && <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300">CRM</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tabela da lista */}
          {detalhe && (
            <div className="rounded-[var(--radius)] border border-border bg-card">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {FILTROS_TABELA.map(f => (
                    <button key={f.k} onClick={() => setFiltro(f.k)}
                      className={cn('rounded-[var(--radius)] px-2.5 py-1 text-xs font-semibold', filtro === f.k ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                      {f.rotulo}
                      {f.k === 'fila' && c ? ` ${c.fila}` : f.k === 'atenderam' && c ? ` ${c.atenderam}` : f.k === 'sem_resposta' && c ? ` ${c.sem_resposta}` : f.k === 'leads' && c ? ` ${c.leads}` : f.k === 'numero_errado' && c ? ` ${c.numero_errado}` : f.k === 'todos' && c ? ` ${c.total}` : ''}
                    </button>
                  ))}
                </div>
                <div className="relative ml-auto">
                  <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar empresa, cidade, telefone"
                    className="w-56 rounded-[var(--radius)] border border-border bg-background py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Empresa</th>
                      <th className="px-3 py-2 text-left">Telefone</th>
                      <th className="hidden px-3 py-2 text-left md:table-cell">Cidade</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="hidden px-3 py-2 text-left sm:table-cell">Tent.</th>
                      <th className="hidden px-3 py-2 text-left lg:table-cell">Observação</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {tabela.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{carregandoTabela ? 'Carregando…' : 'Nada aqui.'}</td></tr>
                    )}
                    {tabela.map(r => (
                      <tr key={r.id} className={cn('border-t border-border/60', atual?.id === r.id && 'bg-primary/5')}>
                        <td className="max-w-[220px] px-3 py-2">
                          <p className="truncate font-semibold">{r.empresa || '—'}</p>
                          {(r.nome_contato || r.segmento) && <p className="truncate text-[11px] text-muted-foreground">{[r.nome_contato, r.segmento].filter(Boolean).join(' · ')}</p>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">{formatarTelefone(r.telefone)}</td>
                        <td className="hidden px-3 py-2 md:table-cell">{r.cidade}</td>
                        <td className="px-3 py-2">
                          <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', STATUS_CHIP[r.status]?.classe)}>{STATUS_CHIP[r.status]?.rotulo ?? r.status}</span>
                          {r.status === 'retornar' && r.proxima_tentativa_at && <p className="mt-0.5 whitespace-nowrap text-[10px] text-muted-foreground">{quando(r.proxima_tentativa_at)}</p>}
                          {r.lead_id && <span className="ml-1 rounded bg-emerald-400/15 px-1 py-0.5 text-[9px] font-bold uppercase text-emerald-300">CRM</span>}
                        </td>
                        <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{r.tentativas || ''}</td>
                        <td className="hidden max-w-[260px] truncate px-3 py-2 text-muted-foreground lg:table-cell" title={r.observacao ?? ''}>{r.observacao}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {(r.status === 'nao_atendeu' || r.status === 'caixa_postal' || r.status === 'numero_errado') && (
                            <button onClick={() => void voltarParaFila(r)} title="Devolver para a fila" className="mr-1 rounded-[var(--radius)] border border-border p-1 text-muted-foreground hover:text-foreground">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => void ligarPara(r)} className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-border px-2 py-1 font-semibold text-muted-foreground hover:border-primary/60 hover:text-primary">
                            Ligar <ChevronRight className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {showImport && (
        <ImportarLista
          clients={clients}
          onClose={() => setShowImport(false)}
          onCriada={async (id) => { setShowImport(false); await carregarListas(); setListaId(id); }}
        />
      )}
    </div>
  );
}
