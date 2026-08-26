"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Loader2, MoreVertical, Pencil, PowerOff, RefreshCw, Save,
  Search, Send, ShieldCheck, Ticket, Trash2, Upload, X, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { lerArquivoContatos } from '@/lib/contatos-arquivo';
import {
  MODELOS_FIDELIDADE, VARIAVEIS, DIAS_SEMANA_LABEL, PISO_INTERVALO_SEG,
  STATUS_ENVIO_LABEL, aplicarVars, capacidadeDaJanela, diasParaTerminar,
  progressoDaExecucao, proximasExecucoes, rotuloMotivo, varsDoDestinatario,
  variaveisDesconhecidas, variaveisIndisponiveis, validarCampanha,
  type FonteCampanha, type ModeloId, type ParamsRegua, type Travas,
} from '@/lib/fidelidade';

/**
 * Aba Fidelidade — painel de campanhas.
 *
 * ⚠️ Layout em GRADE, não em pilha. As duas versões anteriores empilhavam
 * tudo numa coluna só (KPIs, travas, listas, cada campanha aberta inteira),
 * e a página virava um documento de rolar em vez de um painel: não dava para
 * bater o olho e comparar campanhas, que é a única coisa que se faz aqui.
 *
 * A edição vive num PAINEL LATERAL. Expandir no meio da lista empurrava tudo
 * para baixo e fazia perder o lugar.
 */

// ────────────────────────────────────────────────────────────────────── Tipos

type PessoaAmostra = {
  nome: string | null; telefone: string | null; pedidos: number;
  receita: number; ticketMedio: number; diasDesdeUltima: number; ultimaCompra: string;
};

type Segmento = {
  modelo: ModeloId;
  resumo: { pessoas: number; receitaHistorica: number; ticketMedio: number; diasParadoMediano: number | null };
  amostra: PessoaAmostra[];
};

type Campanha = {
  id: string | null;
  fonte: FonteCampanha;
  modelo: ModeloId | null;
  listaId: string | null;
  nome: string;
  params: ParamsRegua;
  mensagens: string[];
  cupom: string | null;
  imagemUrl: string | null;
  diasSemana: number[];
  hora: string;
  tetoPublico: number | null;
  ativa: boolean;
  salva: boolean;
  ultimaExecucao: string | null;
};

type Lista = { id: string; nome: string; contatos: number; criadoEm: string };

type Execucao = {
  id: string; campanha_id: string; campanha: string | null; ativa: boolean | null;
  status: string; iniciada_em: string; concluida_em: string | null;
  publico: number; enviadas: number; puladas: number; falhas: number;
};

type Envio = {
  id: string; campanha_id: string; campanha: string | null; nome: string | null;
  telefone: string; status: string; motivo: string | null; erro: string | null;
  texto: string | null; cupom: string | null; criado_em: string; enviado_em: string | null;
};

type Painel = {
  ativo?: boolean; conectado: boolean; error?: string; loja?: string | null;
  regua?: { janelaDias: number; inatividadeDias: number };
  ticketMedioLoja?: number;
  base?: { clientes: number; comTelefone: number };
  instancia?: { provider: string; id: string } | null;
  travas?: Travas; campanhas?: Campanha[]; listas?: Lista[]; segmentos?: Segmento[];
};

type Acompanhamento = {
  travas?: Travas; enviadasHoje: number; porStatus: Record<string, number>;
  execucoes: Execucao[]; envios: Envio[]; temMais: boolean;
};

const COR_MODELO: Record<ModeloId, string> = {
  primeira_recompra: 'var(--primary)',
  em_risco: '#facc15',
  inativo: 'var(--destructive)',
  vip: 'var(--secondary)',
  reconquistado: '#22c55e',
};

const COR_STATUS: Record<string, string> = {
  enviada: 'text-primary',
  pulada: 'text-muted-foreground',
  falha: 'text-destructive',
  pendente: 'text-[#facc15]',
};

// ─────────────────────────────────────────────────────────────────── Pedaços

function Card({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn('rounded-[var(--radius)] border border-border bg-card', className)}>{children}</div>;
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function NumeroInput({ valor, onChange, placeholder }: {
  valor: number | null; onChange: (v: number | null) => void; placeholder?: string;
}) {
  return (
    <input
      type="number" value={valor ?? ''} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm"
    />
  );
}

function Kpi({ label, valor, sub, alerta }: { label: string; valor: string; sub?: string; alerta?: boolean }) {
  return (
    <Card className="p-3">
      <Rotulo>{label}</Rotulo>
      <p className={cn('mt-1 font-heading text-2xl leading-none', alerta && 'text-[#facc15]')}>{valor}</p>
      {sub && <p className="mt-1 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</p>}
    </Card>
  );
}

/** Métrica de card: rótulo em cima, número embaixo — a linha do painel de referência. */
function Metrica({ label, valor, cor }: { label: string; valor: string; cor?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 font-heading text-lg leading-none', cor)}>{valor}</p>
    </div>
  );
}

function Barra({ pct, cor = 'var(--primary)' }: { pct: number; cor?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor }} />
    </div>
  );
}

function hora(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function dataCurta(d: Date): { dia: string; data: string } {
  return {
    dia: d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'America/Sao_Paulo' })
      .replace('.', '').slice(0, 3).toUpperCase(),
    data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }),
  };
}

function chaveCampanha(c: Campanha): string {
  return c.fonte === 'segmento' ? (c.modelo ?? 'sem-modelo') : (c.id ?? 'nova');
}

/** Painel lateral. Editar sem empurrar a grade para baixo. */
function Drawer({ titulo, subtitulo, onClose, children }: {
  titulo: string; subtitulo?: string; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-xl uppercase leading-none">{titulo}</h3>
            {subtitulo && <p className="mt-1 text-xs text-muted-foreground">{subtitulo}</p>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function MenuAcoes({ itens }: { itens: { label: string; onClick: () => void; perigo?: boolean }[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setAberto(a => !a)} className="text-muted-foreground hover:text-foreground">
        <MoreVertical className="h-4 w-4" />
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-[var(--radius)] border border-border bg-card p-1 shadow-xl">
            {itens.map((it) => (
              <button
                key={it.label}
                onClick={() => { setAberto(false); it.onClick(); }}
                className={cn(
                  'w-full rounded-[var(--radius)] px-3 py-2 text-left text-xs font-medium hover:bg-background',
                  it.perigo ? 'text-destructive' : 'text-foreground',
                )}
              >
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────── Componente

export function ClientFidelidadeTab({ clientId }: { clientId: string }) {
  const [vista, setVista] = useState<'campanhas' | 'acompanhamento'>('campanhas');
  const [painel, setPainel] = useState<Painel | null>(null);
  const [acomp, setAcomp] = useState<Acompanhamento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<string | null>(null);
  const [travasAbertas, setTravasAbertas] = useState(false);
  const [novaLista, setNovaLista] = useState(false);
  const [rascunhos, setRascunhos] = useState<Record<string, Campanha>>({});
  const [travasDraft, setTravasDraft] = useState<Travas | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroAtivas, setFiltroAtivas] = useState<'' | 'ativas' | 'pausadas'>('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroCampanha, setFiltroCampanha] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`);
      const data = await r.json() as Painel;
      setPainel(data);
      if (data.campanhas) setRascunhos(Object.fromEntries(data.campanhas.map(c => [chaveCampanha(c), c])));
      if (data.travas) setTravasDraft(data.travas);
    } catch {
      setPainel({ conectado: false, error: 'Falha ao carregar' });
    } finally { setCarregando(false); }
  }, [clientId]);

  const carregarAcomp = useCallback(async () => {
    const q = new URLSearchParams();
    if (filtroStatus) q.set('status', filtroStatus);
    if (filtroCampanha) q.set('campanhaId', filtroCampanha);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/acompanhamento?${q}`);
      setAcomp(await r.json() as Acompanhamento);
    } catch { /* mantém o estado anterior */ }
  }, [clientId, filtroStatus, filtroCampanha]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (painel?.ativo !== false) void carregarAcomp(); }, [carregarAcomp, painel?.ativo]);

  const patch = useCallback(async (corpo: unknown, tag: string) => {
    setSalvando(tag); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({})) as { error?: string };
        setErro(d.error ?? 'Não foi possível salvar.');
        return false;
      }
      await carregar();
      return true;
    } finally { setSalvando(null); }
  }, [clientId, carregar]);

  const disparar = useCallback(async (campanhaId: string) => {
    setSalvando(campanhaId); setErro(null); setResultado(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/disparar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campanhaId }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; resultado?: Record<string, unknown> };
      if (!r.ok) { setErro(d.error ?? 'Não foi possível disparar.'); return; }
      const res = d.resultado ?? {};
      if (res.enviada === true) setResultado(`Mensagem enviada para ${res.telefone}.`);
      else if (res.enviada === false) setResultado(`O envio para ${res.telefone} falhou — o erro está em Acompanhamento.`);
      else if (res.pulou === 'teto_diario') setResultado(`Teto diário já atingido (${res.enviadas_hoje} hoje). Nada foi enviado.`);
      else if (res.pulou === 'instancia') setResultado('O WhatsApp deste cliente não está conectado agora.');
      else if (res.concluida) setResultado('A fila desta campanha acabou.');
      else if (res.publico === 0) setResultado('Ninguém entrou na fila: público vazio, ou todos em cooldown/opt-out.');
      else setResultado('Nada foi enviado nesta chamada.');
      await Promise.all([carregar(), carregarAcomp()]);
    } finally { setSalvando(null); }
  }, [clientId, carregar, carregarAcomp]);

  const reenviar = useCallback(async (envioId: string) => {
    setSalvando(envioId); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade/acompanhamento`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reenviar: envioId }),
      });
      if (!r.ok) { setErro('Não foi possível reenfileirar.'); return; }
      setResultado('Pessoa devolvida para a fila.');
      await carregarAcomp();
    } finally { setSalvando(null); }
  }, [clientId, carregarAcomp]);

  const criarCampanhaDaLista = useCallback(async (lista: Lista) => {
    const existente = Object.values(rascunhos).find(c => c.fonte === 'lista' && c.listaId === lista.id);
    if (existente?.id) { setEditando(existente.id); return; }
    setSalvando('lista'); setErro(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/fidelidade`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fonte: 'lista', listaId: lista.id, nome: `Oferta — ${lista.nome}`,
          mensagens: [], diasSemana: [1, 2, 3, 4, 5, 6], hora: '18:00', ativa: false,
        }),
      });
      const d = await r.json().catch(() => ({})) as { error?: string; campanha?: Campanha };
      if (!r.ok || !d.campanha?.id) { setErro(d.error ?? 'Não foi possível criar a campanha.'); return; }
      await carregar();
      setEditando(d.campanha.id);
    } finally { setSalvando(null); }
  }, [clientId, carregar, rascunhos]);

  const capacidade = useMemo(() => (travasDraft ? capacidadeDaJanela(travasDraft) : 0), [travasDraft]);

  if (carregando && !painel) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  if (painel && painel.ativo === false) {
    return (
      <Card className="mt-4 p-4">
        <div className="flex items-start gap-3">
          <PowerOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h3 className="font-heading text-lg uppercase leading-none">Fidelidade desativada</h3>
            <p className="text-sm text-muted-foreground">
              Para ligar, use o botão <strong className="text-foreground">Fidelidade</strong> na faixa
              <strong className="text-foreground"> Configurações do cliente</strong>, no topo da página.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const travas = travasDraft;
  const todas = Object.values(rascunhos);
  const ativas = todas.filter(c => c.ativa).length;
  const naFila = acomp?.porStatus.pendente ?? 0;
  const execPorCampanha = new Map((acomp?.execucoes ?? []).map(e => [e.campanha_id, e]));

  const visiveis = todas.filter((c) => {
    if (c.fonte === 'segmento' && !painel?.conectado) return false;
    if (filtroAtivas === 'ativas' && !c.ativa) return false;
    if (filtroAtivas === 'pausadas' && c.ativa) return false;
    if (busca.trim()) {
      const alvo = `${c.nome} ${c.mensagens.join(' ')} ${c.cupom ?? ''}`.toLowerCase();
      if (!alvo.includes(busca.trim().toLowerCase())) return false;
    }
    return true;
  });

  const campEditando = editando ? todas.find(c => (c.id ?? chaveCampanha(c)) === editando) : null;

  return (
    <div className="mt-4 space-y-4">
      {/* Barra de navegação */}
      <div className="flex flex-wrap items-center gap-2">
        {([['campanhas', 'Campanhas'], ['acompanhamento', 'Acompanhamento']] as const).map(([v, label]) => (
          <button
            key={v} onClick={() => setVista(v)}
            className={cn(
              'h-9 rounded-[var(--radius)] px-4 text-xs font-bold uppercase tracking-wider transition-colors',
              vista === v ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {v === 'acompanhamento' && naFila > 0 && (
              <span className="ml-1.5 rounded-full bg-[#facc15]/20 px-1.5 py-0.5 text-[9px] text-[#facc15]">{naFila}</span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setTravasAbertas(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Travas
          </button>
          <button
            onClick={() => { void carregar(); void carregarAcomp(); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-xs font-bold uppercase text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', carregando && 'animate-spin')} /> Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-destructive/40 bg-destructive/[0.08] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-xs text-destructive">{erro}</p>
        </div>
      )}
      {resultado && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-primary/40 bg-primary/[0.06] p-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-xs text-foreground">{resultado}</p>
        </div>
      )}

      {/* KPIs — sempre visíveis, nas duas vistas */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Campanhas ativas" valor={String(ativas)} sub={`de ${todas.length} configuradas`} />
        <Kpi label="Enviadas hoje" valor={`${acomp?.enviadasHoje ?? 0} / ${travas?.tetoDiario ?? 0}`}
          sub="teto do número, somando tudo" />
        <Kpi label="Na fila" valor={String(naFila)} sub="pessoas esperando envio" alerta={naFila > 0} />
        <Kpi label="Número de envio" valor={painel?.instancia ? '✓ conectado' : '— sem instância'}
          sub={painel?.instancia?.id ?? 'vincule na aba Rastreio'} alerta={!painel?.instancia} />
      </div>

      {vista === 'acompanhamento' ? (
        <Acompanhar
          acomp={acomp} travas={travas} campanhas={todas}
          filtroStatus={filtroStatus} setFiltroStatus={setFiltroStatus}
          filtroCampanha={filtroCampanha} setFiltroCampanha={setFiltroCampanha}
          salvando={salvando} onReenviar={reenviar}
        />
      ) : (
        <>
          {/* Barra de ferramentas da grade */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar campanha, texto ou cupom"
                className="h-9 w-full rounded-[var(--radius)] border border-border bg-background pl-7 pr-2 text-sm"
              />
            </div>
            {([['', 'Todas'], ['ativas', 'Ativas'], ['pausadas', 'Pausadas']] as const).map(([v, label]) => {
              const n = v === '' ? todas.length : v === 'ativas' ? ativas : todas.length - ativas;
              return (
                <button
                  key={v || 'todas'} onClick={() => setFiltroAtivas(v)}
                  className={cn(
                    'h-9 rounded-[var(--radius)] border px-3 text-[11px] font-bold uppercase',
                    filtroAtivas === v ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label} <span className="ml-1 opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          {/* GRADE de campanhas */}
          {visiveis.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                {todas.length === 0 ? 'Nenhuma campanha ainda.' : 'Nenhuma campanha com esse filtro.'}
              </p>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visiveis.map((c) => (
                <CampanhaCard
                  key={chaveCampanha(c)} campanha={c}
                  cor={c.modelo ? COR_MODELO[c.modelo] : 'var(--secondary)'}
                  publico={
                    c.fonte === 'lista'
                      ? (painel?.listas?.find(l => l.id === c.listaId)?.contatos ?? 0)
                      : (painel?.segmentos?.find(s => s.modelo === c.modelo)?.resumo.pessoas ?? 0)
                  }
                  objetivo={c.modelo ? MODELOS_FIDELIDADE[c.modelo].objetivo
                    : (painel?.listas?.find(l => l.id === c.listaId)?.nome ?? 'Lista removida')}
                  execucao={c.id ? execPorCampanha.get(c.id) : undefined}
                  travas={travas} salvando={salvando === (c.id ?? chaveCampanha(c))}
                  onEditar={() => setEditando(c.id ?? chaveCampanha(c))}
                  onDisparar={c.id && c.salva ? () => disparar(c.id!) : undefined}
                  onAlternar={() => patch({ ...c, ativa: !c.ativa }, c.id ?? chaveCampanha(c))}
                  onVerEnvios={c.id ? () => { setFiltroCampanha(c.id!); setVista('acompanhamento'); } : undefined}
                  onExcluir={c.fonte === 'lista' && c.id ? () => patch({ excluirCampanha: c.id }, c.id!) : undefined}
                />
              ))}
            </div>
          )}

          {/* Listas em TABELA */}
          <TabelaListas
            listas={painel?.listas ?? []} salvando={salvando}
            onNova={() => setNovaLista(true)}
            onExcluir={(id) => patch({ excluirLista: id }, 'lista')}
            onCriarCampanha={(l) => void criarCampanhaDaLista(l)}
          />

          {!painel?.conectado && (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              As campanhas por consumo (comprou uma vez só, em risco, inativo, VIP) precisam do
              Cardápio Web ou do Anota AI conectado — sem integração, elas nem aparecem na grade.
            </p>
          )}
        </>
      )}

      {/* Painéis laterais */}
      {campEditando && (
        <Drawer
          titulo={campEditando.modelo ? MODELOS_FIDELIDADE[campEditando.modelo].nome : campEditando.nome}
          subtitulo={campEditando.fonte === 'lista' ? 'Campanha por lista' : 'Campanha por consumo'}
          onClose={() => setEditando(null)}
        >
          <EditorCampanha
            campanha={campEditando}
            amostra={painel?.segmentos?.find(s => s.modelo === campEditando.modelo)?.amostra ?? []}
            loja={painel?.loja ?? 'nossa loja'} ticketMedioLoja={painel?.ticketMedioLoja ?? 0}
            salvando={salvando === (campEditando.id ?? chaveCampanha(campEditando))}
            onChange={(c) => setRascunhos(r => ({ ...r, [chaveCampanha(c)]: c }))}
            onSalvar={async (c) => { const ok = await patch(c, c.id ?? chaveCampanha(c)); if (ok) setEditando(null); }}
          />
        </Drawer>
      )}

      {travasAbertas && travas && (
        <Drawer titulo="Travas de segurança"
          subtitulo="Valem para TODAS as campanhas deste cliente — a reputação é do número."
          onClose={() => setTravasAbertas(false)}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Rotulo>1 mensagem a cada (seg)</Rotulo>
                <NumeroInput valor={travas.intervaloMinSeg}
                  onChange={(v) => setTravasDraft({ ...travas, intervaloMinSeg: Math.max(PISO_INTERVALO_SEG, v ?? 120) })} />
                <p className="text-[10px] text-muted-foreground">Mínimo permitido: {PISO_INTERVALO_SEG}s</p>
              </div>
              <div className="space-y-1">
                <Rotulo>Máximo por dia</Rotulo>
                <NumeroInput valor={travas.tetoDiario} onChange={(v) => setTravasDraft({ ...travas, tetoDiario: v ?? 50 })} />
                <p className="text-[10px] text-muted-foreground">Entrega real: {capacidade}/dia</p>
              </div>
              <div className="space-y-1">
                <Rotulo>Só entre</Rotulo>
                <div className="flex items-center gap-1">
                  <input type="time" value={travas.janelaInicio}
                    onChange={(e) => setTravasDraft({ ...travas, janelaInicio: e.target.value })}
                    className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
                  <input type="time" value={travas.janelaFim}
                    onChange={(e) => setTravasDraft({ ...travas, janelaFim: e.target.value })}
                    className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Rotulo>Mesma pessoa a cada (dias)</Rotulo>
                <NumeroInput valor={travas.cooldownDias} onChange={(v) => setTravasDraft({ ...travas, cooldownDias: v ?? 7 })} />
                <p className="text-[10px] text-muted-foreground">Vale entre TODAS as campanhas</p>
              </div>
            </div>
            <div className="space-y-2">
              <Rotulo>Dias liberados</Rotulo>
              <div className="flex flex-wrap gap-1">
                {DIAS_SEMANA_LABEL.map((label, dia) => {
                  const on = travas.diasSemana.includes(dia);
                  return (
                    <button key={dia}
                      onClick={() => setTravasDraft({
                        ...travas,
                        diasSemana: on ? travas.diasSemana.filter(d => d !== dia) : [...travas.diasSemana, dia].sort(),
                      })}
                      className={cn('h-8 rounded-[var(--radius)] border px-3 text-[10px] font-bold uppercase',
                        on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={travas.optoutAtivo}
                onChange={(e) => setTravasDraft({ ...travas, optoutAtivo: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--primary)]" />
              <span className="text-muted-foreground">Tirar da lista quem responder pedindo para não receber</span>
            </label>
            <button
              onClick={async () => { const ok = await patch({ travas: travasDraft }, 'travas'); if (ok) setTravasAbertas(false); }}
              disabled={salvando === 'travas'}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[var(--radius)] bg-primary text-xs font-bold uppercase text-primary-foreground disabled:opacity-60"
            >
              {salvando === 'travas' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar travas
            </button>
          </div>
        </Drawer>
      )}

      {novaLista && (
        <Drawer titulo="Nova lista" subtitulo="Telefones que você mesmo sobe — sem depender de integração"
          onClose={() => setNovaLista(false)}>
          <FormLista
            salvando={salvando === 'lista'}
            onSalvar={async (l) => { const ok = await patch({ lista: l }, 'lista'); if (ok) setNovaLista(false); return ok; }}
          />
        </Drawer>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── Card de campanha

function CampanhaCard({
  campanha, cor, publico, objetivo, execucao, travas, salvando,
  onEditar, onDisparar, onAlternar, onVerEnvios, onExcluir,
}: {
  campanha: Campanha; cor: string; publico: number; objetivo: string;
  execucao?: Execucao; travas: Travas | null; salvando: boolean;
  onEditar: () => void; onDisparar?: () => void; onAlternar: () => void;
  onVerEnvios?: () => void; onExcluir?: () => void;
}) {
  const p = execucao ? progressoDaExecucao(execucao) : null;
  const rodando = execucao?.status === 'rodando';
  const proximas = useMemo(
    () => proximasExecucoes(campanha.diasSemana, campanha.hora, new Date(), 4),
    [campanha.diasSemana, campanha.hora],
  );

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="h-1 w-full shrink-0" style={{ background: cor }} />

      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-heading text-lg uppercase leading-none">
              {campanha.modelo ? MODELOS_FIDELIDADE[campanha.modelo].nome : campanha.nome}
            </h3>
            <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{objetivo}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {campanha.cupom && (
              <span className="inline-flex items-center gap-1 rounded-full border border-secondary/40 bg-secondary/10 px-2 py-0.5 text-[9px] font-bold uppercase text-secondary">
                <Ticket className="h-2.5 w-2.5" />{campanha.cupom}
              </span>
            )}
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase',
              campanha.ativa ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
            )}>
              {campanha.ativa ? 'Ativa' : 'Pausada'}
            </span>
          </div>
        </div>

        {/* Prévia da mensagem, como no painel de referência */}
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {campanha.mensagens.find(Boolean) ?? 'Sem mensagem escrita.'}
        </p>

        {/* Linha de métricas */}
        <div className="mt-3 grid grid-cols-4 gap-2 border-t border-border pt-3">
          <Metrica label="Público" valor={String(publico)} />
          <Metrica label="Enviadas" valor={String(p?.enviadas ?? 0)} cor="text-primary" />
          <Metrica label="Na fila" valor={String(p?.pendentes ?? 0)} />
          <Metrica label="Falhas" valor={String(p?.falhas ?? 0)} cor={p?.falhas ? 'text-destructive' : undefined} />
        </div>

        {rodando && p && (
          <div className="mt-3">
            <Barra pct={p.pct} cor={cor} />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {p.pct}% da rodada
              {travas && p.pendentes > 0 && (() => {
                const d = diasParaTerminar(p.pendentes, travas, 0, new Date());
                return d > 1 ? ` · ~${d} dias para terminar` : '';
              })()}
            </p>
          </div>
        )}

        {/* Próximas datas — "roda às terças" é abstrato; a data, não. */}
        <div className="mt-3 flex flex-wrap gap-1">
          {proximas.length === 0 ? (
            <span className="text-[10px] text-destructive">Nenhum dia marcado — não vai rodar</span>
          ) : proximas.map((d, i) => {
            const { dia, data } = dataCurta(d);
            return (
              <span key={i} className={cn(
                'rounded-[var(--radius)] px-2 py-1 text-center text-[9px] font-bold leading-tight',
                i === 0 && campanha.ativa ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground',
              )}>
                {dia}<br />{data}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-2">
        <button
          onClick={onEditar}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> Editar
        </button>
        {onDisparar && (
          <button
            onClick={() => { if (confirm('Isto envia UMA mensagem AGORA, de verdade. Continuar?')) onDisparar(); }}
            disabled={salvando}
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {salvando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Disparar 1
          </button>
        )}
        <div className="ml-auto">
          <MenuAcoes itens={[
            { label: campanha.ativa ? 'Pausar disparo' : 'Ativar disparo', onClick: () => {
              if (!campanha.ativa && !confirm(
                'Ativar faz o sistema ENVIAR mensagens sozinho pelo WhatsApp deste cliente. Confirmar?')) return;
              onAlternar();
            } },
            ...(onVerEnvios ? [{ label: 'Ver envios', onClick: onVerEnvios }] : []),
            ...(onExcluir ? [{ label: 'Excluir campanha', onClick: () => {
              if (confirm('Excluir esta campanha?')) onExcluir();
            }, perigo: true }] : []),
          ]} />
        </div>
      </div>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────── Listas (tabela)

function TabelaListas({ listas, salvando, onNova, onExcluir, onCriarCampanha }: {
  listas: Lista[]; salvando: string | null; onNova: () => void;
  onExcluir: (id: string) => void; onCriarCampanha: (l: Lista) => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between gap-2 border-b border-border p-3">
        <h3 className="font-heading text-lg uppercase leading-none">Listas</h3>
        <button
          onClick={onNova}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-3 text-[11px] font-bold uppercase text-primary-foreground"
        >
          <Upload className="h-3 w-3" /> Nova lista
        </button>
      </div>
      {listas.length === 0 ? (
        <p className="p-4 text-xs text-muted-foreground">
          Nenhuma lista. Suba um Excel/CSV ou cole os telefones para disparar sem depender de integração.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-3 py-2 font-bold">Lista</th>
                <th className="px-3 py-2 text-right font-bold">Contatos</th>
                <th className="px-3 py-2 font-bold">Criada em</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {listas.map((l) => (
                <tr key={l.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2">{l.nome}</td>
                  <td className="px-3 py-2 text-right font-heading text-base">{l.contatos}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(l.criadoEm).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => onCriarCampanha(l)}
                        disabled={salvando === 'lista'}
                        className="text-[10px] font-bold uppercase tracking-wide text-primary disabled:opacity-50">
                        Criar campanha
                      </button>
                      <button
                        onClick={() => { if (confirm(`Excluir a lista "${l.nome}"? As campanhas que usam ela são desativadas.`)) onExcluir(l.id); }}
                        className="text-muted-foreground hover:text-destructive" title="Excluir lista">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function FormLista({ salvando, onSalvar }: {
  salvando: boolean; onSalvar: (l: { nome: string; texto: string }) => Promise<boolean>;
}) {
  const [nome, setNome] = useState('');
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const linhas = texto.split('\n').filter(l => l.trim()).length;

  async function importar(file: File) {
    setLendo(true); setAviso(null);
    try {
      const conteudo = await lerArquivoContatos(file);
      const n = conteudo.split('\n').filter(Boolean).length;
      setTexto(t => (t.trim() ? `${t.trim()}\n${conteudo}` : conteudo));
      setAviso(n > 0 ? `${n} contato(s) lidos de ${file.name}.` : `Nenhum telefone encontrado em ${file.name}.`);
      if (!nome.trim()) setNome(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setAviso('Não consegui ler esse arquivo. Tente CSV ou Excel (.xlsx).');
    } finally { setLendo(false); }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Rotulo>Nome da lista</Rotulo>
        <input value={nome} onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: Clientes do salão"
          className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
      </div>

      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-primary/50 bg-primary/[0.04] p-4 text-xs font-bold uppercase text-primary">
        {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Escolher arquivo Excel ou CSV
        <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importar(f); e.target.value = ''; }} />
      </label>
      {aviso && <p className="text-[11px] text-primary">{aviso}</p>}

      <div className="space-y-1">
        <Rotulo>Ou cole os telefones</Rotulo>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={8}
          placeholder={'5543999990000,Maria\n5511988887777,João'}
          className="w-full rounded-[var(--radius)] border border-border bg-background p-2 font-mono text-xs" />
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Uma linha por pessoa: <code className="rounded bg-background px-1">telefone</code> ou{' '}
          <code className="rounded bg-background px-1">telefone,nome</code>. Na planilha o sistema acha
          sozinho a coluna do telefone e a do nome. Repetidos são descartados.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{linhas} linha(s)</span>
        <button
          disabled={!nome.trim() || linhas === 0 || salvando}
          onClick={() => void onSalvar({ nome, texto })}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius)] bg-primary px-4 text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Salvar lista
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── Acompanhamento

function Acompanhar({
  acomp, travas, campanhas, filtroStatus, setFiltroStatus, filtroCampanha, setFiltroCampanha,
  salvando, onReenviar,
}: {
  acomp: Acompanhamento | null; travas: Travas | null; campanhas: Campanha[];
  filtroStatus: string; setFiltroStatus: (v: string) => void;
  filtroCampanha: string; setFiltroCampanha: (v: string) => void;
  salvando: string | null; onReenviar: (id: string) => void;
}) {
  const [expandido, setExpandido] = useState<string | null>(null);

  if (!acomp) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
      </div>
    );
  }

  const rodando = acomp.execucoes.filter(e => e.status === 'rodando');
  const contadores = [
    { chave: '', label: 'Tudo', n: Object.values(acomp.porStatus).reduce((s, v) => s + v, 0) },
    { chave: 'enviada', label: 'Enviadas', n: acomp.porStatus.enviada ?? 0 },
    { chave: 'pendente', label: 'Na fila', n: acomp.porStatus.pendente ?? 0 },
    { chave: 'pulada', label: 'Puladas', n: acomp.porStatus.pulada ?? 0 },
    { chave: 'falha', label: 'Falhas', n: acomp.porStatus.falha ?? 0 },
  ];

  return (
    <div className="space-y-4">
      {rodando.length > 0 && (
        <div className="grid gap-3 lg:grid-cols-2">
          {rodando.map((e) => {
            const p = progressoDaExecucao(e);
            const dias = travas ? diasParaTerminar(p.pendentes, travas, acomp.enviadasHoje, new Date()) : 0;
            return (
              <Card key={e.id} className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate font-heading text-lg uppercase leading-none">{e.campanha ?? 'Campanha'}</h3>
                  <span className="shrink-0 text-[10px] text-muted-foreground">desde {hora(e.iniciada_em)}</span>
                </div>
                <div className="mt-3"><Barra pct={p.pct} /></div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <Metrica label="Enviadas" valor={String(p.enviadas)} cor="text-primary" />
                  <Metrica label="Na fila" valor={String(p.pendentes)} />
                  <Metrica label="Puladas" valor={String(p.puladas)} />
                  <Metrica label="Falhas" valor={String(p.falhas)} cor={p.falhas ? 'text-destructive' : undefined} />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {p.pct}% concluído
                  {dias > 0 && (dias === 1 ? ' · termina hoje' : ` · termina em ~${dias} dias`)}
                  {dias < 0 && <span className="text-destructive"> · sem dia liberado nas travas</span>}
                </p>
              </Card>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {contadores.map(c => (
          <button
            key={c.chave || 'tudo'} onClick={() => setFiltroStatus(c.chave)}
            className={cn(
              'h-9 rounded-[var(--radius)] border px-3 text-[11px] font-bold uppercase',
              filtroStatus === c.chave ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {c.label} <span className="ml-1 opacity-70">{c.n}</span>
          </button>
        ))}
        <select
          value={filtroCampanha} onChange={(e) => setFiltroCampanha(e.target.value)}
          className="ml-auto h-9 rounded-[var(--radius)] border border-border bg-background px-2 text-xs"
        >
          <option value="">Todas as campanhas</option>
          {campanhas.filter(c => c.id).map(c => (
            <option key={c.id} value={c.id!}>
              {c.modelo ? MODELOS_FIDELIDADE[c.modelo].nome : c.nome}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-3 py-2 font-bold">Cliente</th>
                <th className="px-3 py-2 font-bold">Telefone</th>
                <th className="px-3 py-2 font-bold">Campanha</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold">Quando</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {acomp.envios.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Nenhum envio com esse filtro.
                </td></tr>
              )}
              {acomp.envios.map((e) => {
                const aberto = expandido === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className="border-b border-border/50 hover:bg-background/40">
                      <td className="px-3 py-2">{e.nome ?? <span className="text-muted-foreground">sem nome</span>}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.telefone}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted-foreground">{e.campanha ?? '—'}</td>
                      <td className={cn('px-3 py-2 text-[10px] font-bold uppercase', COR_STATUS[e.status])}>
                        {STATUS_ENVIO_LABEL[e.status] ?? e.status}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{hora(e.enviado_em ?? e.criado_em)}</td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => setExpandido(aberto ? null : e.id)}
                          className="text-[10px] font-bold uppercase text-primary">
                          {aberto ? 'Fechar' : 'Ver mensagem'}
                        </button>
                      </td>
                    </tr>
                    {aberto && (
                      <tr className="border-b border-border/50 bg-background/30">
                        <td colSpan={6} className="px-3 py-3">
                          {e.texto ? (
                            <p className="max-w-lg rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
                              {e.texto}
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              {e.status === 'pendente'
                                ? 'Ainda não enviada — o texto é sorteado entre as variações na hora do envio.'
                                : 'Sem texto registrado (envio anterior a este registro).'}
                            </p>
                          )}
                          {e.status === 'pulada' && (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              Motivo: <strong className="text-foreground">{rotuloMotivo(e.motivo, travas ?? undefined)}</strong>
                            </p>
                          )}
                          {e.status === 'falha' && (
                            <p className="mt-2 text-[11px] text-destructive">Erro: {e.erro ?? 'desconhecido'}</p>
                          )}
                          {(e.status === 'falha' || e.status === 'pulada') && (
                            <button onClick={() => onReenviar(e.id)} disabled={salvando === e.id}
                              className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[var(--radius)] border border-border px-3 text-[11px] font-bold uppercase text-muted-foreground hover:text-foreground disabled:opacity-50">
                              {salvando === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                              Colocar de volta na fila
                            </button>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {acomp.temMais && (
          <p className="border-t border-border p-3 text-[11px] text-muted-foreground">
            Mostrando os 100 mais recentes. Use os filtros para achar o resto.
          </p>
        )}
      </Card>
    </div>
  );
}

// ───────────────────────────────────────────────────── Editor (painel lateral)

function EditorCampanha({
  campanha, amostra, loja, ticketMedioLoja, salvando, onChange, onSalvar,
}: {
  campanha: Campanha; amostra: PessoaAmostra[]; loja: string; ticketMedioLoja: number;
  salvando: boolean; onChange: (c: Campanha) => void; onSalvar: (c: Campanha) => void;
}) {
  const meta = campanha.modelo ? MODELOS_FIDELIDADE[campanha.modelo] : null;
  const exemplo = amostra[0];
  const base = { chave: '', telefone: '', nome: exemplo?.nome ?? 'Maria Souza' };
  const destinatario = campanha.fonte === 'lista' ? base : {
    ...base,
    consumo: {
      pedidos: exemplo?.pedidos ?? 3,
      ticketMedio: exemplo?.ticketMedio ?? ticketMedioLoja,
      diasDesdeUltima: exemplo?.diasDesdeUltima ?? 42,
    },
  };
  const vars = varsDoDestinatario(destinatario, loja, campanha.cupom);
  const varsSemNome = varsDoDestinatario({ ...destinatario, nome: null }, loja, campanha.cupom);
  const usaNome = campanha.mensagens.some(m => m && (m.includes('{{primeiro_nome}}') || m.includes('{{nome}}')));
  const erros = validarCampanha(campanha.mensagens, campanha.fonte, campanha.cupom);

  return (
    <div className="space-y-4">
      {campanha.fonte === 'lista' && (
        <div className="space-y-1">
          <Rotulo>Nome da campanha</Rotulo>
          <input value={campanha.nome} onChange={(e) => onChange({ ...campanha, nome: e.target.value })}
            className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
        </div>
      )}

      {meta && (
        <div>
          <Rotulo>Quem entra</Rotulo>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {meta.campos.map((campo) => (
              <div key={campo.chave} className="space-y-1">
                <label className="text-xs font-medium">
                  {campo.rotulo}<span className="ml-1 text-muted-foreground">({campo.sufixo})</span>
                </label>
                <NumeroInput
                  valor={campanha.params[campo.chave] ?? null}
                  placeholder={campo.padrao === null ? 'automático' : String(campo.padrao)}
                  onChange={(v) => onChange({ ...campanha, params: { ...campanha.params, [campo.chave]: v } })}
                />
                <p className="text-[10px] leading-relaxed text-muted-foreground">{campo.ajuda}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Rotulo>Cupom</Rotulo>
          <input value={campanha.cupom ?? ''}
            onChange={(e) => onChange({ ...campanha, cupom: e.target.value.toUpperCase() })}
            placeholder="VOLTA10"
            className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 font-mono text-sm uppercase" />
        </div>
        <div className="space-y-1">
          <Rotulo>Começa às</Rotulo>
          <input type="time" value={campanha.hora}
            onChange={(e) => onChange({ ...campanha, hora: e.target.value })}
            className="h-9 w-full rounded-[var(--radius)] border border-border bg-background px-2 text-sm" />
        </div>
        <div className="space-y-1">
          <Rotulo>Máx. por rodada</Rotulo>
          <NumeroInput valor={campanha.tetoPublico} placeholder="sem limite"
            onChange={(v) => onChange({ ...campanha, tetoPublico: v })} />
        </div>
      </div>
      <p className="-mt-2 text-[10px] leading-relaxed text-muted-foreground">
        O cupom é criado no painel do cardápio (validade e limite de uso ficam lá); aqui vai só o código,
        usado com <code className="rounded bg-background px-1">{'{{cupom}}'}</code> na mensagem.
      </p>

      <div className="space-y-1">
        <Rotulo>Roda nos dias</Rotulo>
        <div className="flex flex-wrap gap-1">
          {DIAS_SEMANA_LABEL.map((label, dia) => {
            const on = campanha.diasSemana.includes(dia);
            return (
              <button key={dia}
                onClick={() => onChange({
                  ...campanha,
                  diasSemana: on ? campanha.diasSemana.filter(d => d !== dia) : [...campanha.diasSemana, dia].sort(),
                })}
                className={cn('h-8 rounded-[var(--radius)] border px-3 text-[10px] font-bold uppercase',
                  on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Rotulo>Mensagens (rodízio entre as três)</Rotulo>
          <p className="text-[10px] text-muted-foreground">
            {VARIAVEIS.filter(v => campanha.fonte !== 'lista' || !v.consumo).map(v => `{{${v.chave}}}`).join('  ')}
          </p>
        </div>
        <div className="mt-2 space-y-3">
          {[0, 1, 2].map((i) => {
            const texto = campanha.mensagens[i] ?? '';
            const desconhecidas = variaveisDesconhecidas(texto);
            const indisponiveis = variaveisIndisponiveis(texto, campanha.fonte);
            return (
              <div key={i} className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Variação {i + 1}
                </label>
                <textarea
                  value={texto} rows={3}
                  onChange={(e) => {
                    const novas = [...campanha.mensagens];
                    novas[i] = e.target.value;
                    onChange({ ...campanha, mensagens: novas });
                  }}
                  className="w-full rounded-[var(--radius)] border border-border bg-background p-2 text-xs leading-relaxed"
                />
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{texto.length} caracteres</span>
                  {desconhecidas.length > 0 && (
                    <span className="text-[10px] text-[#facc15]">{desconhecidas.map(d => `{{${d}}}`).join(', ')} não existe</span>
                  )}
                  {indisponiveis.length > 0 && (
                    <span className="text-[10px] text-destructive">
                      {indisponiveis.map(d => `{{${d}}}`).join(', ')} não existe em lista
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Rotulo>Como chega no WhatsApp</Rotulo>
        <div className="mt-2 space-y-2">
          {campanha.mensagens.filter(Boolean).map((m, i) => (
            <p key={i} className="rounded-[var(--radius)] bg-[#075E54]/15 px-3 py-2 text-xs leading-relaxed">
              {aplicarVars(m, vars, 'envio')}
            </p>
          ))}
        </div>
        {usaNome && (
          <div className="mt-3">
            <Rotulo>E em quem não tem nome cadastrado</Rotulo>
            <div className="mt-2 space-y-2">
              {campanha.mensagens.filter(Boolean).map((m, i) => (
                <p key={i} className="rounded-[var(--radius)] border border-dashed border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {aplicarVars(m, varsSemNome, 'envio')}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      {erros.length > 0 && (
        <div className="space-y-1 rounded-[var(--radius)] border border-destructive/40 bg-destructive/[0.06] p-2">
          {erros.map((e, i) => <p key={i} className="text-[11px] text-destructive">{e}</p>)}
        </div>
      )}

      <button
        onClick={() => onSalvar(campanha)}
        disabled={salvando || erros.length > 0}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[var(--radius)] bg-primary text-xs font-bold uppercase text-primary-foreground disabled:opacity-50"
      >
        {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
        Salvar campanha
      </button>
    </div>
  );
}
